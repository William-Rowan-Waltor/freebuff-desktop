// Recurring events: helpers around the `rrule` package. The app stores a plain
// RRULE string (no DTSTART — dtstart lives in the block's start_time) in
// blocks.recurrence, plus per-occurrence exceptions in blocks.recurrence_exceptions
// (date-only "YYYY-MM-DD" for all-day series, full ISO instants for timed ones —
// exactly what FullCalendar's rrule plugin expects in its `exdate` prop).
//
// CalendarView feeds recurring blocks to FullCalendar via recurrenceProps();
// occurrenceDates() expands a series for tests and other callers.
import { RRule, RRuleSet } from 'rrule'
import { isAllDayIso } from '@/lib/overlap'
import type { Block } from '@/types'

// Day-of-week codes in rrule's Monday=0 numbering.
const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

export interface RecurrenceSpec {
  /** RRule.FREQUENCIES index: 0=YEARLY 1=MONTHLY 2=WEEKLY 3=DAILY. */
  freq: number
  interval: number
  /** Weekday indices (Monday=0), e.g. [0, 2] for MO,WE. Null = no BYDAY. */
  byweekday: number[] | null
  /** Day-of-month targets, e.g. [15] or [-1] (last day). Null = no BYMONTHDAY. */
  bymonthday: number[] | null
  /** Ordinal positions within a period, e.g. [-1] for "last X". Null = no BYSETPOS. */
  bysetpos: number[] | null
  until: Date | null
  /** Total occurrence count (COUNT=). Null = no limit. */
  count: number | null
}

/**
 * Extract only the parts explicitly written in the RRULE string. rrule's
 * RRule.fromString() fills in *derived* defaults when BYDAY/BYMONTHDAY are
 * absent (weekly → the parse-time dtstart's weekday, monthly → its
 * day-of-month), which would inject a weekday based on when the rule was
 * parsed. The app stores its own dtstart (block.start_time), so those
 * dtstart-anchored defaults must stay implicit — the RRule constructor
 * re-derives them from the real dtstart at expansion time.
 */
function parseExplicitParts(recurrence: string): {
  byweekday: number[]
  bymonthday: number[]
  bysetpos: number[]
} {
  const byweekday: number[] = []
  const bymonthday: number[] = []
  const bysetpos: number[] = []
  for (const part of recurrence.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).toUpperCase()
    const value = part.slice(eq + 1)
    if (key === 'BYDAY') {
      for (const code of value.split(',')) {
        const idx = WEEKDAY_CODES.indexOf(code.trim().toUpperCase() as (typeof WEEKDAY_CODES)[number])
        if (idx !== -1) byweekday.push(idx)
      }
    } else if (key === 'BYMONTHDAY') {
      for (const v of value.split(',')) {
        const n = Number(v.trim())
        if (!Number.isNaN(n)) bymonthday.push(n)
      }
    } else if (key === 'BYSETPOS') {
      for (const v of value.split(',')) {
        const n = Number(v.trim())
        if (!Number.isNaN(n)) bysetpos.push(n)
      }
    }
  }
  return { byweekday, bymonthday, bysetpos }
}

/** Parse + validate a stored RRULE string. Null when absent or unparseable. */
export function parseRecurrence(recurrence: string | null | undefined): RecurrenceSpec | null {
  if (!recurrence) return null
  try {
    const rule = RRule.fromString(recurrence)
    const o = rule.options
    if (typeof o.freq !== 'number') return null
    const explicit = parseExplicitParts(recurrence)
    return {
      freq: o.freq,
      interval: o.interval,
      byweekday: explicit.byweekday.length > 0 ? explicit.byweekday : null,
      bymonthday: explicit.bymonthday.length > 0 ? explicit.bymonthday : null,
      bysetpos: explicit.bysetpos.length > 0 ? explicit.bysetpos : null,
      until: o.until ?? null,
      count: o.count ?? null,
      // rrule forbids UNTIL + COUNT together; prefer COUNT so downstream
      // expansion never trips the constructor guard on a stored bad string.
      ...(o.until && o.count ? { until: null } : {}),
    }
  } catch {
    return null
  }
}

export function isRecurring(block: Pick<Block, 'recurrence'>): boolean {
  return parseRecurrence(block.recurrence) !== null
}

/** Build the RRULE string the editor picker stores (no DTSTART — that is start_time). */
export function buildRRuleString(spec: {
  freq: number
  interval?: number
  byweekday?: number[] | null
  bymonthday?: number[] | null
  bysetpos?: number[] | null
  until?: Date | null
  count?: number | null
}): string {
  if (spec.until && spec.count) {
    throw new Error('buildRRuleString: UNTIL and COUNT are mutually exclusive')
  }
  const parts = [`FREQ=${(RRule.FREQUENCIES as string[])[spec.freq] ?? 'WEEKLY'}`]
  if (spec.interval && spec.interval > 1) parts.push(`INTERVAL=${spec.interval}`)
  if (spec.byweekday && spec.byweekday.length > 0) {
    parts.push(`BYDAY=${spec.byweekday.map((d) => WEEKDAY_CODES[d] ?? 'MO').join(',')}`)
  }
  if (spec.bymonthday && spec.bymonthday.length > 0) {
    parts.push(`BYMONTHDAY=${spec.bymonthday.join(',')}`)
  }
  if (spec.bysetpos && spec.bysetpos.length > 0) {
    parts.push(`BYSETPOS=${spec.bysetpos.join(',')}`)
  }
  if (spec.until) {
    parts.push(`UNTIL=${spec.until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`)
  }
  if (spec.count) {
    parts.push(`COUNT=${spec.count}`)
  }
  return parts.join(';')
}

/** Event props for FullCalendar's rrule plugin ({ rrule, exdate }). */
export interface RecurrenceEventProps {
  rrule: {
    freq: number
    interval: number
    dtstart: string
    byweekday?: number[]
    bymonthday?: number[]
    bysetpos?: number[]
    until?: string
    count?: number
  }
  exdate: string[]
}

export function recurrenceProps(block: Block): RecurrenceEventProps | null {
  const spec = parseRecurrence(block.recurrence)
  if (!spec || !block.start_time) return null
  const rrule: RecurrenceEventProps['rrule'] = {
    freq: spec.freq,
    interval: spec.interval,
    // All-day events keep the date-only shape (mirrors CalendarView's toFcDate)
    // so the rrule plugin treats them as all-day rather than timed-midnight.
    dtstart: isAllDayIso(block.start_time) ? block.start_time.slice(0, 10) : block.start_time,
  }
  if (spec.byweekday && spec.byweekday.length > 0) rrule.byweekday = spec.byweekday
  if (spec.bymonthday && spec.bymonthday.length > 0) rrule.bymonthday = spec.bymonthday
  if (spec.bysetpos && spec.bysetpos.length > 0) rrule.bysetpos = spec.bysetpos
  if (spec.until) rrule.until = spec.until.toISOString()
  if (spec.count) rrule.count = spec.count
  return { rrule, exdate: block.recurrence_exceptions ?? [] }
}

/**
 * Expand the series between `from` and `to` (inclusive), honoring exceptions —
 * the same RRuleSet the FullCalendar rrule plugin builds internally. Only the
 * recurrence fields are read, so reminder/notification callers can pass a
 * partial block.
 */
export function occurrenceDates(
  block: Pick<Block, 'recurrence' | 'start_time' | 'recurrence_exceptions'>,
  from: Date,
  to: Date,
): Date[] {
  const spec = parseRecurrence(block.recurrence)
  if (!spec || !block.start_time) return []
  const set = new RRuleSet()
  set.rrule(
    new RRule({
      freq: spec.freq,
      interval: spec.interval,
      ...(spec.byweekday && spec.byweekday.length > 0 ? { byweekday: spec.byweekday } : {}),
      ...(spec.bymonthday && spec.bymonthday.length > 0 ? { bymonthday: spec.bymonthday } : {}),
      ...(spec.bysetpos && spec.bysetpos.length > 0 ? { bysetpos: spec.bysetpos } : {}),
      ...(spec.until ? { until: spec.until } : {}),
      ...(spec.count ? { count: spec.count } : {}),
      dtstart: new Date(block.start_time),
    }),
  )
  for (const ex of block.recurrence_exceptions ?? []) {
    const d = new Date(ex)
    if (!Number.isNaN(d.getTime())) set.exdate(d)
  }
  return set.between(from, to, true)
}

/** Frequency choices shared by the editor picker and the calendar quick-add. */
export const FREQ_OPTIONS: { value: number; label: string }[] = [
  { value: RRule.DAILY, label: 'Mỗi ngày' },
  { value: RRule.WEEKLY, label: 'Mỗi tuần' },
  { value: RRule.MONTHLY, label: 'Mỗi tháng' },
  { value: RRule.YEARLY, label: 'Mỗi năm' },
]

/** Short unit names for COUNT previews ("4 lần mỗi tuần · lần cuối …"). */
export const FREQ_UNITS: Record<number, string> = {
  [RRule.DAILY]: 'ngày',
  [RRule.WEEKLY]: 'tuần',
  [RRule.MONTHLY]: 'tháng',
  [RRule.YEARLY]: 'năm',
}
