// Recurring-event overrides: the "Chỉ lần này" (this occurrence only)
// machinery shared by the calendar (drag/resize) and the editor (datetime
// edits on a recurring master). A new non-recurring block is created at the
// occurrence's times, linked to the master via an 'attached' relation, and the
// original occurrence is excluded from the series (date-only for all-day, ISO
// instant for timed — exactly what lib/recurrence/recurrenceProps puts in
// exdate).
import { useCallback } from 'react'
import { useBlocksStore } from '@/store/useBlocksStore'
import { occurrenceAtOrAfter, splitSeriesAt } from '@/lib/expansion'
import type { Block, BlockInput, RelationType } from '@/types'

/** Store actions createOverride / splitSeries need. Kept as deps so the lib stays store-free. */
export interface OverrideDeps {
  addBlock: (input: BlockInput) => Promise<Block>
  attach: (parentId: string, childId: string, relationType: RelationType) => Promise<void>
  updateBlock: (id: string, patch: Partial<Block>) => Promise<void>
  removeBlock: (id: string) => Promise<void>
  beginBatch: () => void
  endBatch: () => void
}

export interface OverridePatch {
  start_time?: string | null
  end_time?: string | null
  content?: Block['content'] | null
}

/**
 * "Chỉ lần này": create a new non-recurring event block at the occurrence's
 * times (keeping the master's title/content unless the patch overrides it),
 * link it to the master via an 'attached' relation, and exclude the original
 * occurrence from the series. `originalStart` null (e.g. an unscheduled event)
 * skips the exception update.
 */
export async function createOverride(
  deps: OverrideDeps,
  master: Block,
  patch: OverridePatch,
  originalStart: string | null,
): Promise<void> {
  // Batch the whole logical edit (addBlock + attach + updateBlock) into one
  // undo step so Ctrl+Z reverts the entire override in one press.
  deps.beginBatch()
  try {
    const override = await deps.addBlock({
      type: 'event',
      title: master.title,
      content: patch.content ?? master.content,
      start_time: patch.start_time ?? master.start_time,
      end_time: patch.end_time ?? master.end_time,
      recurrence: null,
      recurrence_exceptions: null,
    })
    await deps.attach(master.id, override.id, 'attached')
    if (originalStart) {
      // Skip when the occurrence is already excluded (editing the same
      // occurrence twice) — appending a duplicate would list it twice in the
      // editor's "Lần đã loại trừ" and need two restores to bring it back.
      const exceptions = master.recurrence_exceptions ?? []
      if (!exceptions.includes(originalStart)) {
        await deps.updateBlock(master.id, {
          recurrence_exceptions: [...exceptions, originalStart],
        })
      }
    }
  } finally {
    deps.endBatch()
  }
}

/** Hook binding createOverride to the blocks store's actions. */
export function useOverride() {
  const addBlock = useBlocksStore((s) => s.addBlock)
  const attach = useBlocksStore((s) => s.attach)
  const updateBlock = useBlocksStore((s) => s.updateBlock)
  const removeBlock = useBlocksStore((s) => s.removeBlock)
  const beginBatch = useBlocksStore((s) => s.beginBatch)
  const endBatch = useBlocksStore((s) => s.endBatch)
  return useCallback(
    (master: Block, patch: OverridePatch, originalStart: string | null) =>
      createOverride({ addBlock, attach, updateBlock, removeBlock, beginBatch, endBatch }, master, patch, originalStart),
    [addBlock, attach, updateBlock, removeBlock, beginBatch, endBatch],
  )
}

/**
 * Optional relink deps for splitSeries: this-occurrence overrides (blocks
 * linked to the old master via 'attached') whose occurrence falls in the
 * this-and-future range are moved onto the new master, so they stay connected
 * to the series that actually renders them.
 */
export interface SplitRelink {
  detach: (parentId: string, childId: string) => Promise<void>
  /** The master's 'attached' children (this-occurrence overrides) in the store. */
  overrides: Block[]
}

/**
 * "Tất cả các lần sau lần này": split the series at the patched occurrence.
 * The OLD master keeps its past occurrences and gains exceptions for every
 * occurrence from the split onward; a NEW recurring master (same rule, dtstart
 * = the patched times) is created for this-and-future, linked to the old master
 * via 'attached', and inherits the old exceptions at/after the split. When
 * `relink` is given, this-occurrence overrides in the this-and-future range are
 * detached from the old master and re-attached to the new one.
 */
export async function splitSeries(
  deps: OverrideDeps,
  master: Block,
  patch: { start_time?: string | null; end_time?: string | null },
  relink?: SplitRelink,
): Promise<void> {
  if (!patch.start_time) return
  const split = splitSeriesAt(master, patch.start_time)
  if (!split) return
  // Batch the whole split (updateBlock + addBlock + attach + relink) into
  // one undo step so Ctrl+Z reverts the entire split in one press.
  deps.beginBatch()
  try {
    const mergedExceptions = [...new Set([...(master.recurrence_exceptions ?? []), ...split.addExceptions])]
    if (split.coversWholeSeries) {
      // Split at/before the original start: every occurrence moves to the new
      // master, so the old one would hold nothing — replace it outright instead
      // of leaving a dead master behind a full exclusion list. The new block is
      // created first so a failed delete degrades to the old (hidden) behavior.
      // All overrides relink to the new master before the old one is deleted;
      // otherwise removeBlock would orphan their relations.
      const next = await deps.addBlock({
        type: 'event',
        title: master.title,
        content: master.content,
        start_time: patch.start_time,
        end_time: patch.end_time ?? master.end_time,
        recurrence: master.recurrence,
        recurrence_exceptions: split.carryExceptions.length > 0 ? split.carryExceptions : null,
      })
      if (relink) {
        for (const ov of relink.overrides) {
          await relink.detach(master.id, ov.id)
          await deps.attach(next.id, ov.id, 'attached')
        }
      }
      await deps.removeBlock(master.id)
      return
    }
    await deps.updateBlock(master.id, {
      recurrence_exceptions: mergedExceptions.length > 0 ? mergedExceptions : null,
    })
    const next = await deps.addBlock({
      type: 'event',
      title: master.title,
      content: master.content,
      start_time: patch.start_time,
      end_time: patch.end_time ?? master.end_time,
      recurrence: master.recurrence,
      recurrence_exceptions: split.carryExceptions.length > 0 ? split.carryExceptions : null,
    })
    await deps.attach(master.id, next.id, 'attached')
    if (relink) {
      for (const ov of relink.overrides) {
        if (ov.start_time && occurrenceAtOrAfter(master, ov.start_time, patch.start_time)) {
          await relink.detach(master.id, ov.id)
          await deps.attach(next.id, ov.id, 'attached')
        }
      }
    }
  } finally {
    deps.endBatch()
  }
}
