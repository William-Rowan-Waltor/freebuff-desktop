import { create } from 'zustand'
import type { Block, BlockInput, BlockRelation, RelationType } from '@/types'
import {
  fetchBlocks,
  fetchDeletedBlocks,
  createBlock as createBlockDb,
  updateBlock as updateBlockDb,
  deleteBlock as deleteBlockDb,
  softDeleteBlock,
  restoreBlock,
  purgeDeletedBlocks,
  purgeBlock as purgeBlockDb,
  fetchRelations,
  createRelation as createRelationDb,
  deleteRelation as deleteRelationDb,
  isRecurrenceSupported,
  isSoftDeleteSupported,
  DeletedBlock,
} from '@/lib/db/blocks'
import { uploadFile as uploadFileDb, deleteFile as deleteFileDb, UploadResult } from '@/lib/db/storage'
import {
  fetchMyWorkspaces,
  ensureWorkspace,
  createWorkspace as createWorkspaceDb,
  joinWorkspaceByCode,
  setActiveWorkspaceId,
  type Workspace,
} from '@/lib/db/workspaces'
import { supabase } from '@/lib/supabase/client'

/** History cap for Ctrl/Cmd+Z across block edits (also the persisted cap). */
const HISTORY_LIMIT = 30
/** localStorage key for the last delete snapshot (banner survives reloads). */
const LAST_DELETE_KEY = 'dresplace-last-delete'
/** localStorage key for the undo/redo stacks (keyboard undo survives reloads). */
const HISTORY_KEY = 'dresplace-history'
/** localStorage key for relations removed at delete time, keyed by tombstone
 *  block id — trash restore re-creates them once both endpoints are live. */
const TRASH_RELATIONS_KEY = 'dresplace-trash-relations'
/** localStorage key for the purge history (items permanently deleted from trash). */
const PURGE_HISTORY_KEY = 'dresplace-purge-history'
/** Maximum number of purge history entries to keep. */
const PURGE_HISTORY_LIMIT = 100

interface SnapshotEntry {
  blocks: Block[]
  relations: BlockRelation[]
}

interface DeleteSnapshot {
  /** The removed blocks (full data, so undo can restore them after a reload). */
  blocks: Block[]
  /** Relations that touched the removed blocks. */
  relations: BlockRelation[]
  /** Storage paths whose file bytes were deleted (cannot be restored). */
  storagePaths: string[]
  title: string | null
  deletedAt: string
}

function saveSnapshot(snapshot: DeleteSnapshot): void {
  try {
    localStorage.setItem(LAST_DELETE_KEY, JSON.stringify(snapshot))
  } catch {
    // storage unavailable — the banner just won't survive a reload
  }
}

function loadSnapshot(): DeleteSnapshot | null {
  try {
    const raw = localStorage.getItem(LAST_DELETE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DeleteSnapshot>
    if (!Array.isArray(parsed.blocks) || !Array.isArray(parsed.relations)) return null
    return {
      blocks: parsed.blocks,
      relations: parsed.relations,
      storagePaths: Array.isArray(parsed.storagePaths) ? parsed.storagePaths : [],
      title: typeof parsed.title === 'string' ? parsed.title : null,
      deletedAt: typeof parsed.deletedAt === 'string' ? parsed.deletedAt : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

function clearSnapshot(): void {
  try {
    localStorage.removeItem(LAST_DELETE_KEY)
  } catch {
    // ignore
  }
}

function saveHistory(undoStack: SnapshotEntry[], redoStack: SnapshotEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ undoStack, redoStack }))
  } catch {
    // storage full/unavailable — undo/redo just won't survive this reload
  }
}

function loadHistory(): { undoStack: SnapshotEntry[]; redoStack: SnapshotEntry[] } | null {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { undoStack?: unknown; redoStack?: unknown }
    if (!Array.isArray(parsed.undoStack) || !Array.isArray(parsed.redoStack)) return null
    return {
      undoStack: parsed.undoStack.filter(
        (e): e is SnapshotEntry => !!e && Array.isArray((e as SnapshotEntry).blocks),
      ),
      redoStack: parsed.redoStack.filter(
        (e): e is SnapshotEntry => !!e && Array.isArray((e as SnapshotEntry).blocks),
      ),
    }
  } catch {
    return null
  }
}

/** Relations dropped with a delete, keyed by the tombstoned block id, so the
 *  trash view can re-create the tree when a block is restored. Written on
 *  removeBlock, read by restoreFromTrash, dropped on purge. */
function loadTrashRelations(): Record<string, BlockRelation[]> {
  try {
    const raw = localStorage.getItem(TRASH_RELATIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, BlockRelation[]> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) out[key] = value as BlockRelation[]
    }
    return out
  } catch {
    return {}
  }
}

function saveTrashRelations(map: Record<string, BlockRelation[]>): void {
  try {
    localStorage.setItem(TRASH_RELATIONS_KEY, JSON.stringify(map))
  } catch {
    // storage unavailable — restored blocks just come back standalone
  }
}

/** A record of a permanently purged block (for the 30-day history view). */
export interface PurgeHistoryEntry {
  id: string
  title: string | null
  type: Block['type']
  purgedAt: string
  hadFile: boolean
  /** Full block snapshot so undo can re-create the tombstone. */
  block: Block
}

function loadPurgeHistory(): PurgeHistoryEntry[] {
  try {
    const raw = localStorage.getItem(PURGE_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return []
    // Only keep entries from the last 30 days.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    return parsed.filter(
      (e): e is PurgeHistoryEntry =>
        !!e &&
        typeof (e as PurgeHistoryEntry).id === 'string' &&
        typeof (e as PurgeHistoryEntry).purgedAt === 'string' &&
        new Date((e as PurgeHistoryEntry).purgedAt).getTime() >= cutoff,
    )
  } catch {
    return []
  }
}

function savePurgeHistory(entries: PurgeHistoryEntry[]): void {
  try {
    localStorage.setItem(PURGE_HISTORY_KEY, JSON.stringify(entries))
  } catch {
    // storage unavailable — history just won't survive a reload
  }
}

interface BlocksState {
  blocks: Block[]
  /** Soft-deleted blocks (deleted_at set) for the trash view. */
  deletedBlocks: DeletedBlock[]
  relations: BlockRelation[]
  /** Workspaces the user belongs to (shared workspaces via share codes). */
  workspaces: Workspace[]
  /** The workspace new blocks land in (persisted via lib/db/workspaces). */
  activeWorkspaceId: string | null
  loading: boolean
  error: string | null
  /** True when blocks.recurrence is missing on the live schema (migration not
   *  applied): recurring events degrade to one-off instead of crashing. */
  recurrenceUnavailable: boolean
  /** Nesting counter for batch-history mode: pushHistory is suppressed while
   *  batchDepth > 0, and endBatch() pushes one snapshot for the whole edit. */
  batchDepth: number
  /** Snapshot taken right before a removeBlock, so the caller (delete
   *  affordances) can offer "Hoàn tác" for the last delete. Persisted to
   *  localStorage so the banner survives a reload (soft-delete mode). */
  lastDelete: DeleteSnapshot | null
  /** Undo/redo stacks for block edits (add/update/attach/detach), capped. */
  undoStack: SnapshotEntry[]
  redoStack: SnapshotEntry[]
  /** History of permanently purged blocks (last 30 days), for the history tab. */
  purgeHistory: PurgeHistoryEntry[]
  /** Undo the last permanent purge: re-creates the block as a tombstone. */
  undoLastPurge: () => Promise<void>
  loadBlocks: () => Promise<void>
  /** Create a workspace (creator becomes its owner member). */
  createWorkspace: (name?: string) => Promise<Workspace>
  /** Join a workspace by share code; adds it to the list (blocks appear via
   *  the next loadBlocks since RLS now grants access to them). */
  joinWorkspace: (code: string) => Promise<Workspace>
  /** Switch where new blocks land (the view is a union of all member
   *  workspaces, so no reload is needed). */
  switchWorkspace: (id: string) => void
  /** Internal: record a pre-mutation snapshot (capped) and clear the redo stack. */
  pushHistory: () => void
  addBlock: (input: BlockInput) => Promise<Block>
  updateBlock: (id: string, patch: Partial<Block>) => Promise<void>
  removeBlock: (id: string) => Promise<void>
  /** Restore one soft-deleted block from the trash (clears the tombstone). */
  restoreFromTrash: (id: string) => Promise<void>
  /** Remove the blocks created by one .ics import, wholesale (Đã nhập undo). */
  removeImportBlocks: (ids: string[]) => Promise<void>
  /** Re-create the relations a restored block had at delete time (both
   *  endpoints must be live; deferred until the partner is restored too). */
  restoreTrashRelations: (id: string) => Promise<void>
  /** Permanently delete one tombstone from the trash. */
  purgeFromTrash: (id: string) => Promise<void>
  /** Undo multiple purges at once: re-insert blocks as tombstones. */
  undoPurgeBatch: (ids: string[]) => Promise<void>
  /** Remove entries from purge history without restoring (for 'clear from history'). */
  clearPurgeHistory: (ids: string[]) => void
  /** Restore the blocks + relations captured by the last removeBlock. */
  undoDelete: () => Promise<void>
  /** Drop the undo snapshot without restoring (banner dismissed). */
  dismissUndo: () => void
  /** Revert the last block edit (or the pending delete when the banner is up). */
  undo: () => void
  /** Re-apply the last undone edit. */
  redo: () => void
  attach: (parentId: string, childId: string, relationType: RelationType) => Promise<void>
  detach: (parentId: string, childId: string) => Promise<void>
  uploadFile: (file: File, blockId: string) => Promise<UploadResult>
  clearError: () => void
  /** Begin a batch: suppress pushHistory until endBatch() is called.
   *  Supports nesting — only the outermost endBatch pushes a snapshot. */
  beginBatch: () => void
  /** End a batch: if this is the outermost, push one history snapshot. */
  endBatch: () => void
}

export const useBlocksStore = create<BlocksState>((set, get) => ({
  blocks: [],
  deletedBlocks: [],
  relations: [],
  workspaces: [],
  activeWorkspaceId: null,
  loading: false,
  error: null,
  recurrenceUnavailable: false,
  lastDelete: null,
  batchDepth: 0,
  purgeHistory: loadPurgeHistory(),
  // Rehydrate the undo/redo stacks so keyboard undo keeps working after a
  // reload. Snapshots are complete block/relation data (JSON-safe), so the
  // restored state renders identically; concurrent changes from other
  // sessions since the snapshot are not merged in (same caveat as the
  // delete banner).
  ...(loadHistory() ?? { undoStack: [], redoStack: [] }),

  loadBlocks: async () => {
    set({ loading: true, error: null })
    try {
      const [blocks, relations, deletedBlocks] = await Promise.all([
        fetchBlocks(),
        fetchRelations(),
        fetchDeletedBlocks(),
      ])
      // Workspace bootstrap: personal workspace on first run, active id
      // pointing at a workspace the user belongs to (null when offline —
      // blocks then fall back to owner-only RLS visibility).
      let workspaces: Workspace[] = []
      let activeWorkspaceId: string | null = null
      try {
        const active = await ensureWorkspace()
        workspaces = await fetchMyWorkspaces()
        activeWorkspaceId = active?.id ?? get().activeWorkspaceId
      } catch {
        workspaces = get().workspaces
        activeWorkspaceId = get().activeWorkspaceId
      }
      set({
        blocks,
        deletedBlocks,
        relations,
        workspaces,
        activeWorkspaceId,
        loading: false,
        recurrenceUnavailable: !(await isRecurrenceSupported()),
      })
      // The delete banner survives reloads: restore the persisted snapshot
      // (the soft-deleted rows are filtered from the fetch above, so the
      // snapshot's blocks are exactly the ones still hidden).
      const persisted = loadSnapshot()
      if (persisted) set({ lastDelete: persisted })
      // Best-effort purge of tombstones past the undo window.
      if (await isSoftDeleteSupported()) {
        void purgeDeletedBlocks(7).catch(() => undefined)
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Không thể tải dữ liệu', loading: false })
    }
  },

  addBlock: async (input) => {
    // Snapshot AFTER the db write so a failed create never leaves a phantom
    // undo entry (pushHistory reads the pre-write state, set applies it).
    const block = await createBlockDb(input)
    get().pushHistory()
    set((state) => ({ blocks: [...state.blocks, block] }))
    return block
  },

  updateBlock: async (id, patch) => {
    const updated = await updateBlockDb(id, patch)
    get().pushHistory()
    set((state) => ({
      blocks: state.blocks.map((b) => (b.id === id ? updated : b)),
    }))
  },

  removeBlock: async (id) => {
    const soft = await isSoftDeleteSupported()
    const block = get().blocks.find((b) => b.id === id)
    // Removing a recurring master also removes its this-occurrence override
    // children (non-recurring blocks linked via 'attached'): without this they
    // would linger as orphaned standalone blocks. Split-series masters are
    // themselves recurring, so they are their own series and stay put.
    const cascadeIds = block?.recurrence
      ? get()
          .relations.filter((r) => r.parent_id === id && r.relation_type === 'attached')
          .map((r) => r.child_id)
          .filter((childId) => !get().blocks.find((b) => b.id === childId)?.recurrence)
      : []
    const removed = new Set([id, ...cascadeIds])
    const removedBlocks = get().blocks.filter((b) => removed.has(b.id))
    const removedRelations = get().relations.filter(
      (r) => removed.has(r.parent_id) || removed.has(r.child_id),
    )
    const filePathFor = async (blockId: string, fileUrl: string | null): Promise<string | null> => {
      if (!fileUrl) return null
      const filename = fileUrl.split(`${blockId}/`)[1]
      if (!filename) return null
      const { data } = await supabase.auth.getUser()
      const base = data.user ? `${data.user.id}/${blockId}` : blockId
      return `${base}/${filename.split('?')[0]}`
    }
    // Tombstone the rows (soft) or delete them outright (fallback when the
    // deleted_at migration is missing); relations are removed either way so
    // undo can recreate exactly what the delete dropped.
    if (soft) {
      for (const blockId of removed) await softDeleteBlock(blockId)
      for (const r of removedRelations) await deleteRelationDb(r.parent_id, r.child_id)
    } else {
      await deleteBlockDb(id)
      for (const childId of cascadeIds) await deleteBlockDb(childId)
    }
    // Uploaded file bytes cannot be restored — delete them now and record ONLY
    // the paths actually removed, so the banner's "N tệp không thể khôi phục"
    // stays truthful: a failed delete leaves the bytes reachable by restore.
    const storagePaths: string[] = []
    for (const childId of cascadeIds) {
      const child = get().blocks.find((b) => b.id === childId)
      const path = await filePathFor(childId, child?.file_url ?? null)
      if (path) {
        try {
          await deleteFileDb(path)
          storagePaths.push(path)
        } catch (err) {
          // Best-effort: a storage hiccup must not abort the block delete or
          // skip the siblings, but the orphan should not go fully unnoticed.
          console.error(`[dresplace] storage delete failed (orphan risk): ${path}`, err)
        }
      }
    }
    const masterPath = await filePathFor(id, block?.file_url ?? null)
    if (masterPath) {
      try {
        await deleteFileDb(masterPath)
        storagePaths.push(masterPath)
      } catch (err) {
        console.error(`[freebuff] storage delete failed (orphan risk): ${masterPath}`, err)
      }
    }
    const snapshot: DeleteSnapshot = {
      blocks: removedBlocks,
      relations: removedRelations,
      storagePaths,
      title: block?.title ?? null,
      deletedAt: new Date().toISOString(),
    }
    saveSnapshot(snapshot)
    // Record the dropped relations per tombstoned block so trash restore can
    // re-create the tree (relations are gone from the DB either way).
    const relMap = loadTrashRelations()
    for (const blockId of removed) {
      relMap[blockId] = removedRelations.filter(
        (r) => r.parent_id === blockId || r.child_id === blockId,
      )
    }
    saveTrashRelations(relMap)
    set((state) => {
      // A delete invalidates redo; the snapshot of the pre-delete state is the
      // delete's own undo (via the banner), so history stops here.
      saveHistory(state.undoStack, [])
      return {
        blocks: state.blocks.filter((b) => !removed.has(b.id)),
        relations: state.relations.filter(
          (r) => !removed.has(r.parent_id) && !removed.has(r.child_id),
        ),
        lastDelete: snapshot,
        redoStack: [],
      }
    })
  },

  undoDelete: async () => {
    const snap = get().lastDelete
    if (!snap) return
    // Recreate exactly the rows this delete removed (blocks first, then the
    // relations). In soft-delete mode that is clearing the tombstone (the row
    // still exists with its original id); otherwise the row is re-inserted
    // with its original id. Concurrent adds since the delete are untouched.
    const haveBlock = new Set(get().blocks.map((b) => b.id))
    const missingBlocks = snap.blocks.filter((b) => !haveBlock.has(b.id))
    const haveRelation = new Set(
      get().relations.map((r) => `${r.parent_id}|${r.child_id}|${r.relation_type}`),
    )
    const missingRelations = snap.relations.filter(
      (r) => !haveRelation.has(`${r.parent_id}|${r.child_id}|${r.relation_type}`),
    )
    if (await isSoftDeleteSupported()) {
      for (const b of missingBlocks) await restoreBlock(b.id)
    } else {
      for (const b of missingBlocks) {
        // id is intentionally preserved: relations reference it, and the
        // blocks row we deleted left the uuid free (id defaults to
        // gen_random_uuid()). owner_id/timestamps are omitted so DB defaults
        // (RLS, now()) win.
        await createBlockDb({
          type: b.type,
          title: b.title,
          content: b.content,
          start_time: b.start_time,
          end_time: b.end_time,
          recurrence: b.recurrence,
          recurrence_exceptions: b.recurrence_exceptions,
          file_url: b.file_url,
          file_extension: b.file_extension,
          id: b.id,
        } as BlockInput)
      }
    }
    for (const r of missingRelations) {
      // Preserve the original sibling position so a split tree's ordering
      // survives the delete/undo round-trip.
      await createRelationDb(r.parent_id, r.child_id, r.relation_type, r.position ?? 0)
    }
    clearSnapshot()
    set((state) => {
      saveHistory(state.undoStack, [])
      return {
        blocks: [...state.blocks, ...missingBlocks],
        relations: [...state.relations, ...missingRelations],
        lastDelete: null,
        redoStack: [],
      }
    })
  },

  dismissUndo: () => {
    clearSnapshot()
    set({ lastDelete: null })
  },

  // Remove the blocks created by one .ics import, wholesale (the Đã nhập
  // tab's undo). Unlike removeBlock this is a HARD delete — an import is a
  // bulk operation, so its undo reverts fully instead of filling the trash —
  // and it cascades like removeBlock (a removed recurring master takes its
  // non-recurring this-occurrence overrides with it). Records a history
  // snapshot first so Ctrl/Cmd+Z can restore the import. Uploaded file bytes
  // are not touched: imported file refs point at foreign URLs (the .ics never
  // carries bytes), so nothing in this workspace's storage is orphaned.
  removeImportBlocks: async (ids) => {
    const live = new Set(get().blocks.map((b) => b.id))
    const targets = ids.filter((id) => live.has(id))
    if (targets.length === 0) return
    const removed = new Set(targets)
    for (const id of targets) {
      const block = get().blocks.find((b) => b.id === id)
      if (!block?.recurrence) continue
      for (const r of get().relations) {
        if (r.parent_id !== id || r.relation_type !== 'attached') continue
        const child = get().blocks.find((b) => b.id === r.child_id)
        if (child && !child.recurrence) removed.add(child.id)
      }
    }
    const removedRelations = get().relations.filter(
      (r) => removed.has(r.parent_id) || removed.has(r.child_id),
    )
    for (const id of removed) await deleteBlockDb(id)
    for (const r of removedRelations) await deleteRelationDb(r.parent_id, r.child_id)
    // Snapshot only after the deletes succeed (a throw leaves no phantom entry).
    get().pushHistory()
    set((state) => ({
      blocks: state.blocks.filter((b) => !removed.has(b.id)),
      relations: state.relations.filter((r) => !removed.has(r.parent_id) && !removed.has(r.child_id)),
    }))
  },

  restoreFromTrash: async (id) => {
    const block = get().deletedBlocks.find((b) => b.id === id)
    if (!block) return
    await restoreBlock(id)
    const restored = { ...block, deleted_at: null }
    // Guard: a live block with the same id (imported/duplicated state) stays
    // as-is — the tombstone row is cleared, but no duplicate lands in the
    // store. Titles are NOT unique (no DB constraint), so same-title blocks
    // restore normally and are told apart by their deleted-at date in the UI.
    const alreadyLive = get().blocks.some((b) => b.id === id)
    set((state) => ({
      deletedBlocks: state.deletedBlocks.filter((b) => b.id !== id),
      blocks: alreadyLive ? state.blocks : [...state.blocks, restored],
    }))
    // Re-create the relations this block had at delete time — only when BOTH
    // endpoints are live (a partner still in the trash defers; its own
    // restore later converges). The delete banner's undoDelete remains the
    // full-fidelity path; this is the trash's best-effort tree restore.
    await get().restoreTrashRelations(id)
  },

  restoreTrashRelations: async (id) => {
    const relMap = loadTrashRelations()
    const saved = relMap[id] ?? []
    const present = new Set(get().blocks.map((b) => b.id))
    const existing = new Set(
      get().relations.map((r) => `${r.parent_id}|${r.child_id}|${r.relation_type}`),
    )
    const toCreate = saved.filter(
      (r) =>
        present.has(r.parent_id) &&
        present.has(r.child_id) &&
        !existing.has(`${r.parent_id}|${r.child_id}|${r.relation_type}`),
    )
    for (const r of toCreate) {
      // Preserve the original sibling position so multi-level split series
      // come back with their ordering intact.
      await createRelationDb(r.parent_id, r.child_id, r.relation_type, r.position ?? 0)
    }
    if (toCreate.length > 0) {
      set((state) => ({ relations: [...state.relations, ...toCreate] }))
    }
    // The restored block's relations are live now — drop the saved entry so
    // it neither grows stale nor duplicates on a future restore.
    if (relMap[id]) {
      delete relMap[id]
      saveTrashRelations(relMap)
    }
  },

  purgeFromTrash: async (id) => {
    const block = get().deletedBlocks.find((b) => b.id === id)
    await purgeBlockDb(id)
    // The row is gone forever — its saved relations go with it.
    const relMap = loadTrashRelations()
    if (relMap[id]) {
      delete relMap[id]
      saveTrashRelations(relMap)
    }
    // Record the purge in history (last 30 days) before removing from state.
    if (block) {
      const entry: PurgeHistoryEntry = {
        id: block.id,
        title: block.title,
        type: block.type,
        purgedAt: new Date().toISOString(),
        hadFile: !!(block as Block).file_url,
        block: block as Block,
      }
      const history = [...get().purgeHistory, entry].slice(-PURGE_HISTORY_LIMIT)
      savePurgeHistory(history)
      set((state) => ({
        deletedBlocks: state.deletedBlocks.filter((b) => b.id !== id),
        purgeHistory: history,
      }))
    } else {
      set((state) => ({ deletedBlocks: state.deletedBlocks.filter((b) => b.id !== id) }))
    }
  },

  undoLastPurge: async () => {
    const last = get().purgeHistory.at(-1)
    if (!last) return
    // Re-insert the block as a soft-deleted tombstone so it appears in trash again.
    const tombstone = { ...last.block, deleted_at: new Date().toISOString() }
    await supabase.from('blocks').insert(tombstone)
    // Remove from history and add back to deletedBlocks.
    const history = get().purgeHistory.slice(0, -1)
    savePurgeHistory(history)
    set((state) => ({
      purgeHistory: history,
      deletedBlocks: [...state.deletedBlocks, tombstone as DeletedBlock],
    }))
  },

  undoPurgeBatch: async (ids) => {
    const entries = get().purgeHistory.filter((e) => ids.includes(e.id))
    if (entries.length === 0) return
    for (const entry of entries) {
      const tombstone = { ...entry.block, deleted_at: new Date().toISOString() }
      await supabase.from('blocks').insert(tombstone)
    }
    const history = get().purgeHistory.filter((e) => !ids.includes(e.id))
    savePurgeHistory(history)
    const restoredTombstones = entries.map((e) => ({
      ...e.block,
      deleted_at: new Date().toISOString(),
    })) as DeletedBlock[]
    set((state) => ({
      purgeHistory: history,
      deletedBlocks: [...state.deletedBlocks, ...restoredTombstones],
    }))
  },

  clearPurgeHistory: (ids) => {
    const history = get().purgeHistory.filter((e) => !ids.includes(e.id))
    savePurgeHistory(history)
    set({ purgeHistory: history })
  },

  pushHistory: () => {
    set((state) => {
      // Inside a batch, individual pushHistory calls are suppressed — only
      // endBatch() pushes a single snapshot for the whole logical edit.
      if (state.batchDepth > 0) return state
      const undoStack = [...state.undoStack, { blocks: state.blocks, relations: state.relations }].slice(
        -HISTORY_LIMIT,
      )
      saveHistory(undoStack, [])
      return { undoStack, redoStack: [] }
    })
  },

  beginBatch: () => {
    set((state) => ({ batchDepth: state.batchDepth + 1 }))
  },

  endBatch: () => {
    set((state) => {
      const depth = state.batchDepth - 1
      if (depth > 0) return { batchDepth: depth }
      // Outermost batch ends: push one snapshot for the whole logical edit.
      const undoStack = [...state.undoStack, { blocks: state.blocks, relations: state.relations }].slice(
        -HISTORY_LIMIT,
      )
      saveHistory(undoStack, [])
      return { batchDepth: 0, undoStack, redoStack: [] }
    })
  },

  undo: () => {
    // A pending delete (banner up) is the most recent action — undo restores
    // it first; otherwise pop the edit history.
    if (get().lastDelete) {
      void get().undoDelete()
      return
    }
    const prev = get().undoStack.at(-1)
    if (prev) {
      set((state) => {
        const undoStack = state.undoStack.slice(0, -1)
        const redoStack = [...state.redoStack, { blocks: state.blocks, relations: state.relations }]
        saveHistory(undoStack, redoStack)
        return { undoStack, redoStack, blocks: prev.blocks, relations: prev.relations }
      })
      return
    }
    // No edit history left — try undoing the last purge.
    if (get().purgeHistory.length > 0) {
      void get().undoLastPurge()
    }
  },

  redo: () => {
    const next = get().redoStack.at(-1)
    if (!next) return
    set((state) => {
      const redoStack = state.redoStack.slice(0, -1)
      const undoStack = [...state.undoStack, { blocks: state.blocks, relations: state.relations }]
      saveHistory(undoStack, redoStack)
      return { redoStack, undoStack, blocks: next.blocks, relations: next.relations }
    })
  },

  attach: async (parentId, childId, relationType) => {
    const relation = await createRelationDb(parentId, childId, relationType)
    get().pushHistory()
    set((state) => ({ relations: [...state.relations, relation] }))
  },

  detach: async (parentId, childId) => {
    await deleteRelationDb(parentId, childId)
    get().pushHistory()
    set((state) => ({
      relations: state.relations.filter(
        (r) => !(r.parent_id === parentId && r.child_id === childId),
      ),
    }))
  },

  uploadFile: async (file, blockId) => {
    const { data } = await supabase.auth.getUser()
    const prefix = data.user ? `${data.user.id}/${blockId}` : blockId
    const result = await uploadFileDb(file, prefix)
    await get().updateBlock(blockId, {
      file_url: result.fileUrl,
      file_extension: result.fileExtension,
    })
    return result
  },

  createWorkspace: async (name) => {
    const ws = await createWorkspaceDb(name)
    setActiveWorkspaceId(ws.id)
    set((state) => ({
      workspaces: state.workspaces.some((w) => w.id === ws.id)
        ? state.workspaces
        : [...state.workspaces, ws],
      activeWorkspaceId: ws.id,
    }))
    return ws
  },

  joinWorkspace: async (code) => {
    const ws = await joinWorkspaceByCode(code)
    set((state) => ({
      workspaces: state.workspaces.some((w) => w.id === ws.id)
        ? state.workspaces
        : [...state.workspaces, ws],
    }))
    return ws
  },

  switchWorkspace: (id) => {
    setActiveWorkspaceId(id)
    set({ activeWorkspaceId: id })
  },

  clearError: () => set({ error: null }),
}))
