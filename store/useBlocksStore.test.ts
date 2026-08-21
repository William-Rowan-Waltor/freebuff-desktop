/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBlocksStore } from './useBlocksStore'
import * as blocksDb from '@/lib/db/blocks'
import * as storageDb from '@/lib/db/storage'
import { supabase } from '@/lib/supabase/client'
import type { Block, BlockInput, BlockRelation, RelationType } from '@/types'

// Full mock of the db layer: removeBlock needs deleteBlock/deleteFile, undo
// needs createBlock/createRelation to re-create the rows, and the recurrence
// probe must not hit the network.
vi.mock('@/lib/db/blocks', () => ({
  fetchBlocks: vi.fn(async () => []),
  createBlock: vi.fn(async (input: BlockInput): Promise<Block> => {
    const id = (input as unknown as { id?: string }).id ?? 'new-block'
    return {
      type: input.type,
      title: input.title ?? null,
      content: input.content ?? null,
      start_time: input.start_time ?? null,
      end_time: input.end_time ?? null,
      recurrence: input.recurrence ?? null,
      recurrence_exceptions: input.recurrence_exceptions ?? null,
      file_url: input.file_url ?? null,
      file_extension: input.file_extension ?? null,
      owner_id: null,
      id,
    }
  }),
  updateBlock: vi.fn(async (id: string, patch: Partial<Block>): Promise<Block> => ({
    ...({} as Block),
    ...patch,
    id,
  })),
  deleteBlock: vi.fn(async () => undefined),
  softDeleteBlock: vi.fn(async () => undefined),
  restoreBlock: vi.fn(async () => undefined),
  purgeDeletedBlocks: vi.fn(async () => undefined),
  fetchDeletedBlocks: vi.fn(async () => []),
  purgeBlock: vi.fn(async () => undefined),
  fetchRelations: vi.fn(async () => []),
  createRelation: vi.fn(
    async (parentId: string, childId: string, relationType: RelationType): Promise<BlockRelation> => ({
      parent_id: parentId,
      child_id: childId,
      relation_type: relationType,
    }),
  ),
  deleteRelation: vi.fn(async () => undefined),
  isRecurrenceSupported: vi.fn(async () => true),
  isSoftDeleteSupported: vi.fn(async () => false),
}))

vi.mock('@/lib/db/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/storage')>()
  return {
    ...real,
    deleteFile: vi.fn(async () => undefined),
  }
})

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-123' } } })),
    },
  },
}))

// The store only reads `data.user`, so a loose mock reference sidesteps the
// real UserResponse discriminated union while keeping call assertions typed.
const getUserMock = supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>

function baseBlock(overrides: Partial<Block> & { id: string }): Block {
  return {
    type: 'note',
    title: null,
    content: { type: 'doc', content: [] },
    start_time: null,
    end_time: null,
    recurrence: null,
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useBlocksStore.setState({
    blocks: [],
    deletedBlocks: [],
    relations: [],
    loading: false,
    error: null,
    lastDelete: null,
    undoStack: [],
    redoStack: [],
  })
})

describe('removeBlock cascade for recurring masters', () => {
  it('deletes this-occurrence overrides attached to a recurring master', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({ id: 'override-1', type: 'event' }),
        baseBlock({ id: 'override-2', type: 'event' }),
        baseBlock({ id: 'unrelated', type: 'note' }),
      ],
      relations: [
        { parent_id: 'master', child_id: 'override-1', relation_type: 'attached' },
        { parent_id: 'master', child_id: 'override-2', relation_type: 'attached' },
      ],
    })

    await useBlocksStore.getState().removeBlock('master')

    expect(blocksDb.deleteBlock).toHaveBeenCalledTimes(3)
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('master')
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('override-1')
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('override-2')
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['unrelated'])
    expect(useBlocksStore.getState().relations).toEqual([])
  })

  it('keeps a split-series master (itself recurring) attached to the deleted master', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'old-master', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({ id: 'split-new', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({ id: 'override-1', type: 'event' }),
      ],
      relations: [
        { parent_id: 'old-master', child_id: 'split-new', relation_type: 'attached' },
        { parent_id: 'old-master', child_id: 'override-1', relation_type: 'attached' },
      ],
    })

    await useBlocksStore.getState().removeBlock('old-master')

    // The recurring split-new master survives; the non-recurring override does not.
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('old-master')
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('override-1')
    expect(blocksDb.deleteBlock).not.toHaveBeenCalledWith('split-new')
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['split-new'])
    // The relation to the surviving split-new master is dropped (it is orphaned
    // by the old master's delete — the split series is its own root now).
    expect(useBlocksStore.getState().relations).toEqual([])
  })

  it('deletes the storage file of an override that owns an upload (signed-in base)', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({
          id: 'override-file',
          type: 'event',
          file_url:
            'https://proj.supabase.co/storage/v1/object/public/files/user-123/override-file/photo.png?token=abc',
        }),
        baseBlock({ id: 'override-plain', type: 'event' }),
      ],
      relations: [
        { parent_id: 'master', child_id: 'override-file', relation_type: 'attached' },
        { parent_id: 'master', child_id: 'override-plain', relation_type: 'attached' },
      ],
    })

    await useBlocksStore.getState().removeBlock('master')

    // Both overrides are cascade-deleted as rows…
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('override-file')
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('override-plain')
    // …but only the one that owns an upload hits the storage layer, at the
    // signed-in path `<user>/<child>/<filename>` with the query string stripped.
    expect(storageDb.deleteFile).toHaveBeenCalledTimes(1)
    expect(storageDb.deleteFile).toHaveBeenCalledWith('user-123/override-file/photo.png')
    expect(useBlocksStore.getState().blocks).toEqual([])
  })

  it('falls back to the child-id base for the storage path when no user is signed in', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null })
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=DAILY' }),
        baseBlock({
          id: 'override-file',
          type: 'event',
          file_url: 'https://proj.supabase.co/storage/v1/object/public/files/override-file/notes.txt',
        }),
      ],
      relations: [{ parent_id: 'master', child_id: 'override-file', relation_type: 'attached' }],
    })

    await useBlocksStore.getState().removeBlock('master')

    expect(storageDb.deleteFile).toHaveBeenCalledWith('override-file/notes.txt')
  })

  it('does not cascade for a plain (non-recurring) block', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'plain', type: 'note' }),
        baseBlock({ id: 'child', type: 'note' }),
      ],
      relations: [{ parent_id: 'plain', child_id: 'child', relation_type: 'attached' }],
    })

    await useBlocksStore.getState().removeBlock('plain')

    expect(blocksDb.deleteBlock).toHaveBeenCalledTimes(1)
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('plain')
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['child'])
  })
})

describe('undo delete (removeBlock snapshot + restore)', () => {
  it('restores the removed rows with their ORIGINAL ids and re-creates relations in the db', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({ id: 'override-1', type: 'event' }),
        baseBlock({ id: 'unrelated', type: 'note' }),
      ],
      relations: [{ parent_id: 'master', child_id: 'override-1', relation_type: 'attached' }],
    })

    await useBlocksStore.getState().removeBlock('master')
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['unrelated'])
    expect(useBlocksStore.getState().relations).toEqual([])

    await useBlocksStore.getState().undoDelete()

    // Rows are re-created with the original ids (so relations survive a reload)
    // and the relation is re-created too.
    expect(blocksDb.createBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'master', recurrence: 'FREQ=WEEKLY' }),
    )
    expect(blocksDb.createBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'override-1' }))
    expect(blocksDb.createBlock).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'unrelated' }))
    expect(blocksDb.createRelation).toHaveBeenCalledWith('master', 'override-1', 'attached', 0)
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['unrelated', 'master', 'override-1'])
    expect(useBlocksStore.getState().relations).toEqual([
      { parent_id: 'master', child_id: 'override-1', relation_type: 'attached' },
    ])
    expect(useBlocksStore.getState().lastDelete).toBeNull()
  })

  it('keeps blocks added after the delete when undoing (only the removed diff returns)', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=WEEKLY' })],
      relations: [],
    })

    await useBlocksStore.getState().removeBlock('master')
    await useBlocksStore.getState().addBlock({ type: 'note', title: 'added-after' })

    await useBlocksStore.getState().undoDelete()

    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['new-block', 'master'])
    expect(useBlocksStore.getState().lastDelete).toBeNull()
  })

  it('records the deleted storage paths in the snapshot (files cannot be restored)', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'master',
          type: 'event',
          recurrence: 'FREQ=WEEKLY',
          file_url: 'https://proj.supabase.co/storage/v1/object/public/files/user-123/master/a.pdf?token=x',
        }),
        baseBlock({
          id: 'override-file',
          type: 'event',
          file_url: 'https://proj.supabase.co/storage/v1/object/public/files/user-123/override-file/b.png',
        }),
      ],
      relations: [{ parent_id: 'master', child_id: 'override-file', relation_type: 'attached' }],
    })

    await useBlocksStore.getState().removeBlock('master')

    expect(useBlocksStore.getState().lastDelete?.storagePaths).toEqual([
      'user-123/override-file/b.png',
      'user-123/master/a.pdf',
    ])
  })

  it('Bug 6: a failed storage delete is excluded from storagePaths (banner stays truthful)', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'master',
          type: 'event',
          recurrence: 'FREQ=WEEKLY',
          file_url: 'https://proj.supabase.co/storage/v1/object/public/files/user-123/master/a.pdf',
        }),
        baseBlock({
          id: 'override-file',
          type: 'event',
          file_url: 'https://proj.supabase.co/storage/v1/object/public/files/user-123/override-file/b.png',
        }),
      ],
      relations: [{ parent_id: 'master', child_id: 'override-file', relation_type: 'attached' }],
    })
    // The cascade child's file delete throws (network blip); the master's succeeds.
    vi.mocked(storageDb.deleteFile)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined)

    await useBlocksStore.getState().removeBlock('master')

    // Only the truly-removed file is reported as "cannot be restored".
    expect(useBlocksStore.getState().lastDelete?.storagePaths).toEqual([
      'user-123/master/a.pdf',
    ])
    expect(storageDb.deleteFile).toHaveBeenCalledTimes(2)
  })

  it('dismissUndo clears the snapshot without restoring anything', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=WEEKLY' })],
      relations: [],
    })

    await useBlocksStore.getState().removeBlock('master')
    useBlocksStore.getState().dismissUndo()

    expect(useBlocksStore.getState().blocks).toEqual([])
    expect(useBlocksStore.getState().lastDelete).toBeNull()
    expect(blocksDb.createBlock).not.toHaveBeenCalled()
  })

  it('undoDelete is a no-op when nothing has been deleted', async () => {
    useBlocksStore.setState({ blocks: [baseBlock({ id: 'plain', type: 'note' })], lastDelete: null })

    await useBlocksStore.getState().undoDelete()

    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['plain'])
    expect(useBlocksStore.getState().lastDelete).toBeNull()
    expect(blocksDb.createBlock).not.toHaveBeenCalled()
  })
})

describe('soft-delete undo (tombstone mode)', () => {
  const softDelete = vi.mocked(blocksDb.isSoftDeleteSupported)

  beforeEach(() => {
    softDelete.mockResolvedValue(true)
  })

  it('tombstones rows + relations instead of hard-deleting; undo clears the tombstone', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({ id: 'ov-1', type: 'event' }),
      ],
      relations: [{ parent_id: 'master', child_id: 'ov-1', relation_type: 'attached' }],
    })

    await useBlocksStore.getState().removeBlock('master')

    expect(blocksDb.deleteBlock).not.toHaveBeenCalled()
    expect(blocksDb.softDeleteBlock).toHaveBeenCalledWith('master')
    expect(blocksDb.softDeleteBlock).toHaveBeenCalledWith('ov-1')
    expect(blocksDb.deleteRelation).toHaveBeenCalledWith('master', 'ov-1')
    expect(useBlocksStore.getState().blocks).toEqual([])

    await useBlocksStore.getState().undoDelete()

    expect(blocksDb.restoreBlock).toHaveBeenCalledWith('master')
    expect(blocksDb.restoreBlock).toHaveBeenCalledWith('ov-1')
    expect(blocksDb.createBlock).not.toHaveBeenCalled()
    expect(blocksDb.createRelation).toHaveBeenCalledWith('master', 'ov-1', 'attached', 0)
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['master', 'ov-1'])
    expect(useBlocksStore.getState().lastDelete).toBeNull()
  })

  it('persists the snapshot to localStorage and rehydrates the banner on load', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'master', type: 'event', title: 'Họp tuần', recurrence: 'FREQ=WEEKLY' })],
      relations: [],
    })

    await useBlocksStore.getState().removeBlock('master')
    expect(localStorage.getItem('dresplace-last-delete')).toContain('Họp tuần')

    // A fresh page: the store resets, but loadBlocks rehydrates the banner
    // from localStorage (the tombstone is filtered from the fetch).
    useBlocksStore.setState({ blocks: [], relations: [], lastDelete: null })
    await useBlocksStore.getState().loadBlocks()

    expect(useBlocksStore.getState().lastDelete?.blocks.map((b) => b.id)).toEqual(['master'])
    // The 7-day tombstone purge fires best-effort on load.
    expect(blocksDb.purgeDeletedBlocks).toHaveBeenCalledWith(7)

    // Undoing clears both the store snapshot and the persisted one.
    await useBlocksStore.getState().undoDelete()
    expect(localStorage.getItem('dresplace-last-delete')).toBeNull()
  })

  it('dismissUndo clears the persisted snapshot too', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'm', type: 'event', recurrence: 'FREQ=DAILY' })],
      relations: [],
    })
    await useBlocksStore.getState().removeBlock('m')
    useBlocksStore.getState().dismissUndo()
    expect(localStorage.getItem('dresplace-last-delete')).toBeNull()
    expect(useBlocksStore.getState().lastDelete).toBeNull()
  })
})

describe('keyboard undo/redo history', () => {
  it('undo reverts a block edit and redo reapplies it', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'a', type: 'note', title: 'Trước' })],
      relations: [],
    })

    await useBlocksStore.getState().updateBlock('a', { title: 'Sau' })
    expect(useBlocksStore.getState().blocks[0].title).toBe('Sau')

    useBlocksStore.getState().undo()
    expect(useBlocksStore.getState().blocks[0].title).toBe('Trước')

    useBlocksStore.getState().redo()
    expect(useBlocksStore.getState().blocks[0].title).toBe('Sau')
  })

  it('a new edit after undo clears the redo stack', async () => {
    useBlocksStore.setState({ blocks: [baseBlock({ id: 'a', type: 'note', title: '1' })], relations: [] })
    await useBlocksStore.getState().updateBlock('a', { title: '2' })
    useBlocksStore.getState().undo()
    await useBlocksStore.getState().updateBlock('a', { title: '3' })
    expect(useBlocksStore.getState().redoStack).toEqual([])
  })

  it('undo restores a pending delete first (banner) and is a no-op otherwise', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'a', type: 'event', recurrence: 'FREQ=WEEKLY' })],
      relations: [],
    })
    await useBlocksStore.getState().removeBlock('a')
    useBlocksStore.getState().undo()
    // undo() routes through the async undoDelete — flush its microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useBlocksStore.getState().lastDelete).toBeNull()
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['a'])

    useBlocksStore.getState().undo()
    // No banner, no history — nothing happens.
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['a'])
  })

  it('caps the history at 30 entries', async () => {
    useBlocksStore.setState({ blocks: [], relations: [] })
    for (let i = 0; i < 40; i++) {
      await useBlocksStore.getState().addBlock({ type: 'note', title: `n${i}` })
    }
    expect(useBlocksStore.getState().undoStack).toHaveLength(30)
  })

  it('persists the stacks to localStorage and rehydrates a fresh store on load', async () => {
    useBlocksStore.setState({ blocks: [baseBlock({ id: 'a', type: 'note', title: '1' })], relations: [] })
    await useBlocksStore.getState().updateBlock('a', { title: '2' })
    expect(localStorage.getItem('dresplace-history')).toContain('"blocks"')

    // A brand-new store module rehydrates both stacks from localStorage, so
    // keyboard undo keeps working after a reload.
    vi.resetModules()
    const fresh = await import('./useBlocksStore')
    expect(fresh.useBlocksStore.getState().undoStack).toHaveLength(1)
    expect(fresh.useBlocksStore.getState().undoStack[0].blocks[0].title).toBe('1')
    fresh.useBlocksStore.getState().undo()
    expect(fresh.useBlocksStore.getState().blocks[0].title).toBe('1')
  })

  it('persists the redo stack so redo also survives a reload', async () => {
    useBlocksStore.setState({ blocks: [baseBlock({ id: 'a', type: 'note', title: '1' })], relations: [] })
    await useBlocksStore.getState().updateBlock('a', { title: '2' })
    useBlocksStore.getState().undo()
    expect(localStorage.getItem('dresplace-history')).toContain('"redoStack"')

    vi.resetModules()
    const fresh = await import('./useBlocksStore')
    fresh.useBlocksStore.getState().redo()
    expect(fresh.useBlocksStore.getState().blocks[0].title).toBe('2')
  })
})

describe('phantom history guard (Bug 2): a failed write must never push a snapshot', () => {
  it('updateBlock keeps undoStack empty when the db write throws', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'a', type: 'note', title: 'Sau' })],
      relations: [],
    })
    vi.mocked(blocksDb.updateBlock).mockRejectedValueOnce(new Error('network'))

    await expect(useBlocksStore.getState().updateBlock('a', { title: 'Sau' })).rejects.toThrow('network')

    expect(useBlocksStore.getState().undoStack).toEqual([])
    expect(useBlocksStore.getState().blocks[0].title).toBe('Sau')
    expect(localStorage.getItem('dresplace-history')).toBeNull()
  })

  it('addBlock keeps undoStack empty when the db write throws', async () => {
    useBlocksStore.setState({ blocks: [], relations: [] })
    vi.mocked(blocksDb.createBlock).mockRejectedValueOnce(new Error('conflict'))

    await expect(useBlocksStore.getState().addBlock({ type: 'note', title: 'x' })).rejects.toThrow(
      'conflict',
    )

    expect(useBlocksStore.getState().undoStack).toEqual([])
    expect(useBlocksStore.getState().blocks).toEqual([])
    expect(localStorage.getItem('dresplace-history')).toBeNull()
  })

  it('attach keeps undoStack empty when the db write throws (and relations intact)', async () => {
    useBlocksStore.setState({ blocks: [], relations: [{ parent_id: 'p', child_id: 'c', relation_type: 'attached' }] })
    vi.mocked(blocksDb.createRelation).mockRejectedValueOnce(new Error('conflict'))

    await expect(
      useBlocksStore.getState().attach('p', 'c', 'attached'),
    ).rejects.toThrow('conflict')

    expect(useBlocksStore.getState().undoStack).toEqual([])
    expect(useBlocksStore.getState().relations).toHaveLength(1)
  })

  it('detach keeps undoStack empty when the db write throws (and relations intact)', async () => {
    useBlocksStore.setState({ blocks: [], relations: [{ parent_id: 'p', child_id: 'c', relation_type: 'attached' }] })
    vi.mocked(blocksDb.deleteRelation).mockRejectedValueOnce(new Error('conflict'))

    await expect(useBlocksStore.getState().detach('p', 'c')).rejects.toThrow('conflict')

    expect(useBlocksStore.getState().undoStack).toEqual([])
    expect(useBlocksStore.getState().relations).toHaveLength(1)
  })

  it('removeImportBlocks keeps undoStack empty when a delete throws', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'imp', type: 'note', title: 'Từ ics' })],
      relations: [],
    })
    vi.mocked(blocksDb.deleteBlock).mockRejectedValueOnce(new Error('storage'))

    await expect(useBlocksStore.getState().removeImportBlocks(['imp'])).rejects.toThrow('storage')

    expect(useBlocksStore.getState().undoStack).toEqual([])
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['imp'])
    expect(localStorage.getItem('dresplace-history')).toBeNull()
  })

  it('success still pushes exactly one snapshot AFTER the write', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'a', type: 'note', title: 'Trước' })],
      relations: [],
    })

    await useBlocksStore.getState().updateBlock('a', { title: 'Sau' })

    expect(useBlocksStore.getState().undoStack).toHaveLength(1)
    useBlocksStore.getState().undo()
    expect(useBlocksStore.getState().blocks[0].title).toBe('Trước')
    expect(useBlocksStore.getState().blocks[0].id).toBe('a')
  })
})

describe('trash (soft-deleted blocks)', () => {
  it('restoreFromTrash clears the tombstone and brings the block back standalone', async () => {
    useBlocksStore.setState({
      deletedBlocks: [
        { ...baseBlock({ id: 'gone', type: 'note', title: 'Cũ' }), deleted_at: '2026-08-10T00:00:00.000Z' },
      ],
      blocks: [],
      relations: [],
    })

    await useBlocksStore.getState().restoreFromTrash('gone')

    expect(blocksDb.restoreBlock).toHaveBeenCalledWith('gone')
    expect(useBlocksStore.getState().deletedBlocks).toEqual([])
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['gone'])
    expect(useBlocksStore.getState().blocks[0].title).toBe('Cũ')
  })

  it('purgeFromTrash permanently deletes the tombstone row', async () => {
    useBlocksStore.setState({
      deletedBlocks: [
        { ...baseBlock({ id: 'gone', type: 'note' }), deleted_at: '2026-08-10T00:00:00.000Z' },
      ],
    })

    await useBlocksStore.getState().purgeFromTrash('gone')

    expect(blocksDb.purgeBlock).toHaveBeenCalledWith('gone')
    expect(useBlocksStore.getState().deletedBlocks).toEqual([])
    expect(useBlocksStore.getState().blocks).toEqual([])
  })
})

describe('trash relation-tree restore', () => {
  const softDelete = vi.mocked(blocksDb.isSoftDeleteSupported)
  const rel = (parentId: string, childId: string): BlockRelation => ({
    parent_id: parentId,
    child_id: childId,
    relation_type: 'attached',
  })
  const relMap = (map: Record<string, BlockRelation[]>) =>
    localStorage.setItem('dresplace-trash-relations', JSON.stringify(map))

  beforeEach(() => {
    softDelete.mockResolvedValue(false)
  })

  it('re-creates a relation when BOTH endpoints are live again, dropping the saved entry', async () => {
    relMap({ master: [rel('master', 'ov-1')], 'ov-1': [rel('master', 'ov-1')] })
    useBlocksStore.setState({
      blocks: [],
      relations: [],
      deletedBlocks: [
        { ...baseBlock({ id: 'master', type: 'event' }), deleted_at: '2026-08-10T00:00:00.000Z' },
        { ...baseBlock({ id: 'ov-1', type: 'event' }), deleted_at: '2026-08-10T00:00:00.000Z' },
      ],
    })

    // Restoring the master alone: the override is still in the trash, so the
    // relation is deferred (not created).
    await useBlocksStore.getState().restoreFromTrash('master')
    expect(blocksDb.createRelation).not.toHaveBeenCalled()
    expect(useBlocksStore.getState().relations).toEqual([])

    // Restoring the override converges: both endpoints are live now.
    await useBlocksStore.getState().restoreFromTrash('ov-1')
    expect(blocksDb.createRelation).toHaveBeenCalledWith('master', 'ov-1', 'attached', 0)
    expect(useBlocksStore.getState().relations).toEqual([rel('master', 'ov-1')])
    // The saved entries are dropped for both restored ids.
    const map = JSON.parse(localStorage.getItem('dresplace-trash-relations') ?? '{}')
    expect(map.master).toBeUndefined()
    expect(map['ov-1']).toBeUndefined()
  })

  it('restores a whole override tree when the master and its overrides are all restored', async () => {
    relMap({
      master: [rel('master', 'ov-1'), rel('master', 'ov-2')],
      'ov-1': [rel('master', 'ov-1')],
      'ov-2': [rel('master', 'ov-2')],
    })
    useBlocksStore.setState({
      blocks: [],
      relations: [],
      deletedBlocks: [
        { ...baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=WEEKLY' }), deleted_at: 'd1' },
        { ...baseBlock({ id: 'ov-1', type: 'event' }), deleted_at: 'd2' },
        { ...baseBlock({ id: 'ov-2', type: 'event' }), deleted_at: 'd3' },
      ],
    })

    await useBlocksStore.getState().restoreFromTrash('master')
    await useBlocksStore.getState().restoreFromTrash('ov-1')
    await useBlocksStore.getState().restoreFromTrash('ov-2')

    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['master', 'ov-1', 'ov-2'])
    expect(useBlocksStore.getState().relations).toEqual([
      rel('master', 'ov-1'),
      rel('master', 'ov-2'),
    ])
  })

  it('never duplicates a relation that already exists', async () => {
    relMap({ 'ov-1': [rel('master', 'ov-1')] })
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'master', type: 'event' }), baseBlock({ id: 'ov-1', type: 'event' })],
      relations: [rel('master', 'ov-1')],
      deletedBlocks: [{ ...baseBlock({ id: 'ov-1', type: 'event' }), deleted_at: 'd1' }],
    })

    await useBlocksStore.getState().restoreFromTrash('ov-1')

    expect(blocksDb.createRelation).not.toHaveBeenCalled()
    expect(useBlocksStore.getState().relations).toHaveLength(1)
  })

  it('guards against restoring an id already live in blocks (no duplicate)', async () => {
    relMap({ dup: [] })
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'dup', type: 'note', title: 'Còn sống' })],
      deletedBlocks: [{ ...baseBlock({ id: 'dup', type: 'note', title: 'Bản sao' }), deleted_at: 'd1' }],
    })

    await useBlocksStore.getState().restoreFromTrash('dup')

    expect(blocksDb.restoreBlock).toHaveBeenCalledWith('dup')
    // The tombstone is cleared from the trash, but the live block stays put.
    expect(useBlocksStore.getState().deletedBlocks).toEqual([])
    expect(useBlocksStore.getState().blocks.filter((b) => b.id === 'dup')).toHaveLength(1)
    expect(useBlocksStore.getState().blocks[0].title).toBe('Còn sống')
  })

  it('purgeFromTrash drops the saved relations entry with the row', async () => {
    relMap({ gone: [rel('master', 'gone')] })
    useBlocksStore.setState({
      deletedBlocks: [{ ...baseBlock({ id: 'gone', type: 'note' }), deleted_at: 'd1' }],
    })

    await useBlocksStore.getState().purgeFromTrash('gone')

    const map = JSON.parse(localStorage.getItem('dresplace-trash-relations') ?? '{}')
    expect(map.gone).toBeUndefined()
  })

  it('removeBlock records the dropped relations per tombstoned block for later restore', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({ id: 'ov-1', type: 'event' }),
      ],
      relations: [rel('master', 'ov-1')],
    })
    softDelete.mockResolvedValue(true)

    await useBlocksStore.getState().removeBlock('master')

    const map = JSON.parse(localStorage.getItem('dresplace-trash-relations') ?? '{}')
    expect(map.master).toEqual([rel('master', 'ov-1')])
    expect(map['ov-1']).toEqual([rel('master', 'ov-1')])
  })

  it('preserves the saved sibling position when re-creating a relation from trash', async () => {
    relMap({ 'ov-2': [{ ...rel('master', 'ov-2'), position: 2 }] })
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'master', type: 'event' })],
      relations: [],
      deletedBlocks: [{ ...baseBlock({ id: 'ov-2', type: 'event' }), deleted_at: 'd1' }],
    })

    await useBlocksStore.getState().restoreFromTrash('ov-2')

    // The original ordering (2, not the default 0) is threaded through.
    expect(blocksDb.createRelation).toHaveBeenCalledWith('master', 'ov-2', 'attached', 2)
    expect(useBlocksStore.getState().relations[0].position).toBe(2)
  })

  it('preserves relation positions through the delete-banner undo path too', async () => {
    softDelete.mockResolvedValue(true)
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'master', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({ id: 'split-new', type: 'event', recurrence: 'FREQ=WEEKLY' }),
      ],
      relations: [{ ...rel('master', 'split-new'), position: 3 }],
    })

    await useBlocksStore.getState().removeBlock('master')
    await useBlocksStore.getState().undoDelete()

    expect(blocksDb.createRelation).toHaveBeenCalledWith('master', 'split-new', 'attached', 3)
  })
})

describe('removeImportBlocks (Đã nhập wholesale undo)', () => {
  const rel = (parentId: string, childId: string): BlockRelation => ({
    parent_id: parentId,
    child_id: childId,
    relation_type: 'attached',
  })

  it('hard-deletes exactly the imported blocks and their relations, cascading overrides off masters', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'imp-master', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({ id: 'imp-split', type: 'event', recurrence: 'FREQ=WEEKLY' }),
        baseBlock({ id: 'imp-ov', type: 'event' }),
        baseBlock({ id: 'existing', type: 'note' }),
      ],
      relations: [
        rel('imp-master', 'imp-split'),
        rel('imp-master', 'imp-ov'),
      ],
    })

    await useBlocksStore.getState().removeImportBlocks(['imp-master', 'imp-split', 'imp-ov'])

    // The master's non-recurring override is cascade-deleted; the recurring
    // split is removed by its own id in the list. Pre-existing blocks stay.
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('imp-master')
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('imp-split')
    expect(blocksDb.deleteBlock).toHaveBeenCalledWith('imp-ov')
    expect(blocksDb.deleteBlock).not.toHaveBeenCalledWith('existing')
    expect(blocksDb.deleteRelation).toHaveBeenCalledWith('imp-master', 'imp-split')
    expect(blocksDb.deleteRelation).toHaveBeenCalledWith('imp-master', 'imp-ov')
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['existing'])
    expect(useBlocksStore.getState().relations).toEqual([])
  })

  it('is a no-op for ids that are already gone and never touches the delete banner', async () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'existing', type: 'note' })],
      relations: [],
      lastDelete: null,
    })

    await useBlocksStore.getState().removeImportBlocks(['imp-gone'])

    expect(blocksDb.deleteBlock).not.toHaveBeenCalled()
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['existing'])
    expect(useBlocksStore.getState().lastDelete).toBeNull()
  })

  it('records a history snapshot first so Ctrl/Cmd+Z restores the import', async () => {
    useBlocksStore.setState({ blocks: [], relations: [] })
    await useBlocksStore.getState().addBlock({ type: 'event', title: 'Nhập 1' })
    await useBlocksStore.getState().removeImportBlocks(['new-block'])
    expect(useBlocksStore.getState().blocks).toEqual([])

    useBlocksStore.getState().undo()
    expect(useBlocksStore.getState().blocks.map((b) => b.id)).toEqual(['new-block'])
  })
})
