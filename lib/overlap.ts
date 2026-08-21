// Pure calendar-event helpers: the canonical "all-day" definition and time
// conflict detection.
//
// PostgREST normalizes a date-only 'YYYY-MM-DD' into a UTC-midnight timestamptz
// on the DB round-trip, so "all-day" means either shape. All-day events span
// whole days and would conflict with everything, so conflict detection is
// limited to timed events that have an end time.
export function isAllDayIso(iso: string | null): boolean {
  return !!iso && (/^\d{4}-\d{2}-\d{2}$/.test(iso) || /T00:00:00(\.\d+)?(Z|[+-]00:00)$/.test(iso))
}

export interface OverlapInput {
  id: string
  start: string | null
  end: string | null
}

/**
 * Half-open ([start, end)) interval overlap: two events that merely touch at
 * a boundary (one ends exactly when the other starts) do NOT conflict.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Returns the ids of events involved in at least one time conflict.
 */
export function conflictingIds(events: OverlapInput[]): Set<string> {
  const timed = events.filter((e) => e.start && e.end && !isAllDayIso(e.start))
  const conflicts = new Set<string>()
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]
    const aStart = a.start ? new Date(a.start).getTime() : Number.NaN
    const aEnd = a.end ? new Date(a.end).getTime() : Number.NaN
    if (Number.isNaN(aStart) || Number.isNaN(aEnd)) continue
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j]
      const bStart = b.start ? new Date(b.start).getTime() : Number.NaN
      const bEnd = b.end ? new Date(b.end).getTime() : Number.NaN
      if (Number.isNaN(bStart) || Number.isNaN(bEnd)) continue
      if (intervalsOverlap(aStart, aEnd, bStart, bEnd)) {
        conflicts.add(a.id)
        conflicts.add(b.id)
      }
    }
  }
  return conflicts
}

/**
 * How many OTHER events overlap the given event (0 when the event has no
 * valid timed interval). Used for the quick-note popover conflict hint:
 * "Trùng lịch với N sự kiện".
 */
export function conflictCountFor(events: OverlapInput[], id: string): number {
  const target = events.find((e) => e.id === id)
  if (!target || !target.start || !target.end || isAllDayIso(target.start)) return 0
  const tStart = new Date(target.start).getTime()
  const tEnd = new Date(target.end).getTime()
  if (Number.isNaN(tStart) || Number.isNaN(tEnd)) return 0
  let count = 0
  for (const e of events) {
    if (e.id === id || !e.start || !e.end || isAllDayIso(e.start)) continue
    const s = new Date(e.start).getTime()
    const en = new Date(e.end).getTime()
    if (Number.isNaN(s) || Number.isNaN(en)) continue
    if (intervalsOverlap(tStart, tEnd, s, en)) count += 1
  }
  return count
}

/**
 * The Tailwind classes FullCalendar applies to an event block when it is
 * involved in a time conflict (see CalendarView's eventClass) — the red ring.
 * Extracted here so the ring decision is unit-testable: conflicting events
 * carry the ring classes, everyone else carries nothing.
 */
export function conflictRingClass(conflicts: ReadonlySet<string>, id: string): string {
  return conflicts.has(id) ? 'ring-2 ring-red-400/80' : ''
}
