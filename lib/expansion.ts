// Recurring occurrences, expanded into per-date items for the digest (Hôm nay)
// and the planner (Kế hoạch). Both views classify occurrences with the same
// lib/horizon helpers, so a recurring series shows up in the horizon of each
// occurrence instead of as a stale master whose dtstart is in the past.
import { isAllDayIso } from '@/lib/overlap'
import { isRecurring, occurrenceDates } from '@/lib/recurrence'
import type { Block } from '@/types'

export interface OccurrenceItem {
  /** The master block (its title/content render the occurrence). */
  block: Block
  /** Occurrence start. */
  start: Date
  /** Occurrence end (master duration shifted to this occurrence), or null. */
  end: Date | null
  /** Unique occurrence id: '<blockId>@<iso>'. Kept out of the open path — open `block`. */
  occId: string
}

/** Duration between the master's start and end, or null when either is missing. */
function durationOf(master: Block): number | null {
  if (!master.start_time || !master.end_time) return null
  const s = new Date(master.start_time).getTime()
  const e = new Date(master.end_time).getTime()
  return Number.isNaN(s) || Number.isNaN(e) ? null : e - s
}

/**
 * Expand a recurring event block into its occurrences inside [from, to]
 * (inclusive), honoring exceptions. Non-recurring blocks and non-events return
 * []. Each item carries the master plus its own start/end and a unique id.
 */
export function expandBlockOccurrences(block: Block, from: Date, to: Date): OccurrenceItem[] {
  if (block.type !== 'event' || !isRecurring(block) || !block.start_time) return []
  const duration = durationOf(block)
  return occurrenceDates(block, from, to).map((d) => ({
    block,
    start: d,
    end: duration !== null ? new Date(d.getTime() + duration) : null,
    occId: `${block.id}@${d.toISOString()}`,
  }))
}

function dateOnly(d: Date): string {
  // All-day occurrences are stored as date-only strings and parse as UTC
  // midnight; format from the UTC date components so the key is the same
  // calendar day in every timezone (local getters shift it back a day in
  // negative-offset zones).
  return d.toISOString().slice(0, 10)
}

/**
 * The display block for an occurrence: the master's shape with a virtual
 * (unique) id and the occurrence's own times. All-day series keep the date-only
 * convention (matching how the app stores all-day events), timed series get the
 * shifted ISO instants. Bucketing/labels read these; the OPEN path must use the
 * master's id, never this virtual id.
 */
export function occurrenceBlock(master: Block, occ: OccurrenceItem): Block {
  const allDay = isAllDayIso(master.start_time)
  return {
    ...master,
    id: occ.occId,
    start_time: allDay ? dateOnly(occ.start) : occ.start.toISOString(),
    end_time: allDay ? dateOnly(occ.start) : occ.end ? occ.end.toISOString() : master.end_time,
  }
}

/**
 * Patch that excludes one occurrence ("Xóa lần này"): appends the occurrence's
 * start to the master's recurrence_exceptions, in the shape lib/recurrence
 * expects — date-only for all-day series, ISO instant for timed ones.
 * `occurrenceStart` may already be in either shape; it is normalized against
 * the master's all-day flag. Returns {} when the occurrence is already
 * excluded or the start is unparseable.
 */
export function excludeOccurrence(master: Block, occurrenceStart: string): Partial<Block> {
  if (isAllDayIso(master.start_time)) {
    const key = occurrenceStart.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return {}
    const exceptions = master.recurrence_exceptions ?? []
    if (exceptions.includes(key)) return {}
    return { recurrence_exceptions: [...exceptions, key] }
  }
  const t = new Date(occurrenceStart).getTime()
  if (Number.isNaN(t)) return {}
  const key = new Date(t).toISOString()
  const exceptions = master.recurrence_exceptions ?? []
  if (exceptions.includes(key)) return {}
  return { recurrence_exceptions: [...exceptions, key] }
}

export interface SeriesSplit {
  /** Exceptions to append to the OLD master (every occurrence from the split onward). */
  addExceptions: string[]
  /** Old exceptions at/after the split, carried into the NEW master's exception list. */
  carryExceptions: string[]
  /**
   * True when the split is at/before the series' first occurrence (which is
   * always the master's own start): the old master would hold no occurrences,
   * so callers should delete it instead of leaving a dead master behind a
   * full exclusion list.
   */
  coversWholeSeries: boolean
}

/**
 * "Tất cả các lần sau lần này": split the series at `newStart`. The old master
 * keeps rendering occurrences BEFORE the split; everything from the split onward
 * is excluded from it (returned as addExceptions) and will live on the new
 * master whose dtstart is `newStart`. Old exceptions at/after the split carry
 * over to the new master. Null when the block isn't a recurring event or the
 * split point is unparseable. The window is bounded so a dense series never
 * materializes unbounded exceptions.
 */
export function splitSeriesAt(master: Block, newStart: string, horizonMs = 2 * 366 * 86_400_000): SeriesSplit | null {
  if (master.type !== 'event' || !isRecurring(master) || !master.start_time) return null
  const from = new Date(newStart)
  if (Number.isNaN(from.getTime())) return null
  const allDay = isAllDayIso(master.start_time)
  const to = new Date(from.getTime() + horizonMs)
  const addExceptions = occurrenceDates(master, from, to).map((d) => (allDay ? dateOnly(d) : d.toISOString()))
  const fromKey = allDay ? dateOnly(from) : from.toISOString()
  const startMs = new Date(master.start_time).getTime()
  const startKey = allDay
    ? master.start_time.slice(0, 10)
    : Number.isNaN(startMs)
      ? null
      : new Date(startMs).toISOString()
  const coversWholeSeries = startKey !== null && fromKey <= startKey
  const carryExceptions = (master.recurrence_exceptions ?? []).filter((ex) => {
    if (allDay) return ex.slice(0, 10) >= fromKey
    const t = new Date(ex).getTime()
    if (Number.isNaN(t)) return false
    return new Date(t).toISOString() >= fromKey
  })
  return { addExceptions, carryExceptions, coversWholeSeries }
}

/**
 * True when a this-occurrence override's start is at/after the split point,
 * i.e. it belongs to the this-and-future series after a split (the old master
 * excludes that occurrence). Shape-aware like excludeOccurrence: date-only
 * compare for all-day series, ISO instants for timed ones. Returns false when
 * either value is unparseable.
 */
export function occurrenceAtOrAfter(master: Block, occurrenceStart: string, splitStart: string): boolean {
  if (isAllDayIso(master.start_time)) {
    const key = occurrenceStart.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
    return key >= splitStart.slice(0, 10)
  }
  const t = new Date(occurrenceStart).getTime()
  const s = new Date(splitStart).getTime()
  if (Number.isNaN(t) || Number.isNaN(s)) return false
  return new Date(t).toISOString() >= new Date(s).toISOString()
}
