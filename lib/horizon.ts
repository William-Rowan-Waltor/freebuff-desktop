import { isAllDayIso } from '@/lib/overlap'
import type { Block } from '@/types'

/**
 * Time horizons used to bucket dated blocks (planner) and to build the
 * "Hôm nay" digest. Shared so both views classify the same way.
 */
export type Horizon = 'overdue' | 'today' | 'week' | 'month' | 'year' | 'future'

export const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function mondayOf(d: Date): Date {
  const x = startOfDay(d)
  const dow = (d.getDay() + 6) % 7 // Mon = 0
  x.setDate(x.getDate() - dow)
  return x
}

/**
 * Local midnight of the calendar day an all-day value occupies: date-only
 * strings are that day directly; UTC-midnight instants (PostgREST's round-trip
 * of a date-only value) occupy the UTC date — the same calendar day in any
 * timezone. Returns null when the value is not an all-day shape or is
 * unparseable. Parsing date-only as UTC midnight would land the day a
 * calendar-day early in negative-offset zones.
 */
function allDayCalendarDay(value: string): Date | null {
  if (!isAllDayIso(value)) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function horizonOf(block: Block, now: Date): Horizon {
  if (!block.start_time) return 'future'
  const d = allDayCalendarDay(block.start_time) ?? new Date(block.start_time)
  if (Number.isNaN(d.getTime())) return 'future'

  const today0 = startOfDay(now)
  const d0 = startOfDay(d)

  if (d0.getTime() < today0.getTime()) return 'overdue'
  if (d0.getTime() === today0.getTime()) return 'today'

  const monday = mondayOf(now)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  if (d0 >= monday && d0 <= sunday) return 'week'

  if (d0.getMonth() === now.getMonth() && d0.getFullYear() === now.getFullYear()) return 'month'
  if (d0.getFullYear() === now.getFullYear()) return 'year'
  return 'future'
}

/** Default start time (and type) for a block created inside a given horizon. */
export function anchorFor(
  horizon: Horizon,
  now: Date,
): { type: 'event' | 'note'; start_time: string | null } {
  const at = (y: number, mo: number, d: number, h: number) => new Date(y, mo, d, h, 0, 0, 0)
  switch (horizon) {
    case 'today': {
      // Round to the next full hour, but clamp to today: at 23:xx the +1h
      // crosses midnight, so we land at 00:00 tomorrow. Instead, snap to
      // the current hour's start (or 23:00 when the current hour is 23).
      const t = new Date(now)
      const hour = t.getHours()
      t.setMinutes(0, 0, 0)
      if (hour < 23) t.setHours(hour + 1)
      else t.setHours(23)
      return { type: 'event', start_time: t.toISOString() }
    }
    case 'week': {
      const tomorrow = new Date(now)
      tomorrow.setDate(now.getDate() + 1)
      const anchor =
        mondayOf(tomorrow).getTime() === mondayOf(now).getTime()
          ? new Date(tomorrow)
          : mondayOf(tomorrow)
      anchor.setHours(9, 0, 0, 0)
      return { type: 'event', start_time: anchor.toISOString() }
    }
    case 'month': {
      return { type: 'event', start_time: at(now.getFullYear(), now.getMonth() + 1, 0, 9).toISOString() }
    }
    case 'year': {
      return { type: 'event', start_time: at(now.getFullYear(), 11, 31, 9).toISOString() }
    }
    case 'future':
      return { type: 'note', start_time: null }
    default:
      return { type: 'note', start_time: null }
  }
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Whether a block's time window is already over. Timed blocks end when their
 * end_time passes; all-day blocks (date-only or UTC-midnight instants, per
 * isAllDayIso) end when the calendar day they belong to is over, so an all-day
 * event stays visible through its whole day. Blocks without an end_time are
 * never "ended". Unparseable end times are treated as still open.
 */
export function isEnded(block: Block, now: Date): boolean {
  const raw = block.end_time
  if (!raw) return false
  let end: Date
  const allDay = allDayCalendarDay(raw)
  if (allDay) {
    // All-day (date-only or UTC-midnight): ends at the end of that local day.
    end = new Date(allDay)
    end.setDate(allDay.getDate() + 1)
  } else {
    end = new Date(raw)
    if (Number.isNaN(end.getTime())) return false
  }
  return now.getTime() >= end.getTime()
}

/**
 * Compact Vietnamese label. All-day events label with the calendar day only
 * (e.g. `T3 11/08`) — no clock time — using the local-calendar-day semantics of
 * allDayCalendarDay; timed events keep the wall-clock range
 * (`T3 11/08 · 22:00–23:00`). Returns `Chưa có ngày` when there is no start.
 */
export function dateLabel(block: Block): string {
  if (!block.start_time) return 'Chưa có ngày'
  const allDay = allDayCalendarDay(block.start_time)
  if (allDay) {
    return `${WEEKDAYS[allDay.getDay()]} ${pad(allDay.getDate())}/${pad(allDay.getMonth() + 1)}`
  }
  const d = new Date(block.start_time)
  if (Number.isNaN(d.getTime())) return ''
  let label = `${WEEKDAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (block.end_time) {
    const e = new Date(block.end_time)
    if (!Number.isNaN(e.getTime())) label += `–${pad(e.getHours())}:${pad(e.getMinutes())}`
  }
  return label
}
