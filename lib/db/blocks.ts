import { supabase } from '@/lib/supabase/client'
import type { Block, BlockInput, BlockRelation, RelationType } from '@/types'
import { getActiveWorkspaceId } from '@/lib/db/workspaces'

const BLOCKS = 'blocks'
const RELATIONS = 'block_relations'

// Graceful degradation when the recurrence migration is missing on the live
// DB: PostgREST serves a schema cache without blocks.recurrence, so selecting
// it 42703s. Reads then return rows without the columns and writes that name
// them fail. isRecurrenceSupported() probes once and remembers the result;
// create/update strip the recurrence fields when unsupported so the event
// saves as a one-off instead of crashing (the UI surfaces the flag via the
// store).
let recurrenceSupported: boolean | null = null
// Same one-time probe for the soft-delete tombstone (blocks.deleted_at). When
// the column is missing (migration not applied), deletes fall back to hard
// delete + row re-creation on undo, and the banner does not survive reloads.
let softDeleteSupported: boolean | null = null
// Probe for priority/status columns — when missing, writes strip them so the
// row saves without error; reads normalise to null.
let priorityStatusSupported: boolean | null = null

/**
 * Whether blocks.recurrence / recurrence_exceptions exist on the served
 * schema. Probed once (cached); only a definitive missing-column error counts
 * as unsupported — network/RLS errors assume supported so writes surface the
 * real error instead of silently dropping recurrence.
 */
export async function isRecurrenceSupported(): Promise<boolean> {
  if (recurrenceSupported !== null) return recurrenceSupported
  const { error } = await supabase
    .from(BLOCKS)
    .select('recurrence,recurrence_exceptions')
    .limit(1)
  recurrenceSupported = !/does not exist|could not find/i.test(error?.message ?? '')
  return recurrenceSupported
}

/**
 * Whether blocks.priority / blocks.status exist on the served schema (cached
 * probe).  When missing, writes strip the fields so the row saves as-is
 * (priority/status become implicit "normal"/"draft").
 */
export async function isPriorityStatusSupported(): Promise<boolean> {
  if (priorityStatusSupported !== null) return priorityStatusSupported
  const { error } = await supabase.from(BLOCKS).select('priority,status').limit(1)
  priorityStatusSupported = !/does not exist|could not find/i.test(error?.message ?? '')
  return priorityStatusSupported
}

/**
 * Whether blocks.deleted_at exists on the served schema (cached probe).
 * Unlike the recurrence probe, ANY error (missing column, network, RLS) falls
 * back to the proven hard-delete path: soft delete is an enhancement, and a
 * delete must keep working even when the tombstone can't be probed.
 */
export async function isSoftDeleteSupported(): Promise<boolean> {
  if (softDeleteSupported !== null) return softDeleteSupported
  const { error } = await supabase.from(BLOCKS).select('deleted_at').limit(1)
  softDeleteSupported = error === null
  return softDeleteSupported
}

export type DeletedBlock = Block & { deleted_at: string | null }

/**
 * Blocks currently soft-deleted (deleted_at set), newest first — the trash
 * view. Returns [] when the tombstone column is missing (nothing to list).
 */
export async function fetchDeletedBlocks(): Promise<DeletedBlock[]> {
  if (!(await isSoftDeleteSupported())) return []
  const { data, error } = await supabase
    .from(BLOCKS)
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as DeletedBlock[]
}

/** Permanently delete one tombstone (the undo window expired / user chose it). */
export async function purgeBlock(id: string): Promise<void> {
  const { error } = await supabase.from(BLOCKS).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function fetchBlocks(): Promise<Block[]> {
  // select('*') expands to whatever columns the served schema cache knows, so
  // when the recurrence migration is missing the rows come back without the
  // recurrence fields (normalized below). When the soft-delete tombstone
  // exists, hide soft-deleted rows; otherwise everything is returned.
  let query = supabase.from(BLOCKS).select('*')
  if (await isSoftDeleteSupported()) query = query.is('deleted_at', null)
  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((b) => ({
    ...(b as Block),
    recurrence: (b as Block).recurrence ?? null,
    recurrence_exceptions: (b as Block).recurrence_exceptions ?? null,
    priority: (b as Block).priority ?? null,
    status: (b as Block).status ?? null,
  }))
}

export async function createBlock(input: BlockInput): Promise<Block> {
  // New blocks land in the active workspace (RLS requires membership-or-owner
  // of the workspace, so this is also what makes them shareable).
  const payload: Record<string, unknown> = {
    ...input,
    workspace_id: getActiveWorkspaceId() ?? undefined,
  }
  let stripped = false
  if (payload.recurrence !== undefined || payload.recurrence_exceptions !== undefined) {
    if (!(await isRecurrenceSupported())) {
      delete payload.recurrence
      delete payload.recurrence_exceptions
      stripped = true
    }
  }
  let strippedPS = false
  if (payload.priority !== undefined || payload.status !== undefined) {
    if (!(await isPriorityStatusSupported())) {
      delete payload.priority
      delete payload.status
      strippedPS = true
    }
  }
  const { data, error } = await supabase
    .from(BLOCKS)
    .insert(payload)
    .select()
    .single()
  if (error) throw new Error(error.message)
  const block = data as Block
  // The migration is missing: the row saved as a one-off — report that shape
  // so the UI treats it as non-recurring instead of echoing a rule that never
  // landed.
  let result = stripped ? { ...block, recurrence: null, recurrence_exceptions: null } : block
  if (strippedPS) result = { ...result, priority: null, status: null }
  return result
}

export async function updateBlock(id: string, patch: Partial<Block>): Promise<Block> {
  const payload: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() }
  delete payload.owner_id
  // Strip recurrence writes when the columns don't exist — even a deliberate
  // `recurrence: null` names the column in the SET clause and 42703s.
  if (
    (payload.recurrence !== undefined || payload.recurrence_exceptions !== undefined) &&
    !(await isRecurrenceSupported())
  ) {
    delete payload.recurrence
    delete payload.recurrence_exceptions
  }
  if (
    (payload.priority !== undefined || payload.status !== undefined) &&
    !(await isPriorityStatusSupported())
  ) {
    delete payload.priority
    delete payload.status
  }
  const { data, error } = await supabase
    .from(BLOCKS)
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Block
}

export async function deleteBlock(id: string): Promise<void> {
  const { error } = await supabase.from(BLOCKS).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Soft-delete: set the deleted_at tombstone (row stays for the undo window). */
export async function softDeleteBlock(id: string): Promise<void> {
  const { error } = await supabase
    .from(BLOCKS)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Undo a soft delete: clear the tombstone. */
export async function restoreBlock(id: string): Promise<void> {
  const { error } = await supabase.from(BLOCKS).update({ deleted_at: null }).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Hard-delete tombstones older than `days` (the undo window expired). Runs
 * best-effort on load; file bytes were already removed at delete time.
 */
export async function purgeDeletedBlocks(days: number): Promise<void> {
  if (!(await isSoftDeleteSupported())) return
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { error } = await supabase.from(BLOCKS).delete().lt('deleted_at', cutoff)
  if (error) throw new Error(error.message)
}

export async function fetchRelations(): Promise<BlockRelation[]> {
  const { data, error } = await supabase
    .from(RELATIONS)
    .select('*')
    .order('position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as BlockRelation[]
}

export async function createRelation(
  parentId: string,
  childId: string,
  relationType: RelationType,
  position = 0,
): Promise<BlockRelation> {
  const { data, error } = await supabase
    .from(RELATIONS)
    .insert({ parent_id: parentId, child_id: childId, relation_type: relationType, position })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as BlockRelation
}

export async function deleteRelation(parentId: string, childId: string): Promise<void> {
  const { error } = await supabase
    .from(RELATIONS)
    .delete()
    .eq('parent_id', parentId)
    .eq('child_id', childId)
  if (error) throw new Error(error.message)
}