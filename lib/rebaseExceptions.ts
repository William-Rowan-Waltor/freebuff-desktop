/**
 * Shift a recurring series' `recurrence_exceptions` by the same delta as the
 * dtstart move (drag/resize "Tất cả các lần"). All-day series shift by
 * calendar days; timed series shift by the ISO-instant delta.
 *
 * Returns the shifted exceptions array, or null when no shift is needed
 * (no exceptions, or dates unparseable).
 */
export function shiftExceptions(
  exceptions: string[],
  oldStart: string,
  newStart: string,
  allDay: boolean,
): string[] | null {
  if (exceptions.length === 0) return null
  const oldMs = new Date(allDay ? oldStart + 'T00:00:00Z' : oldStart).getTime()
  const newMs = new Date(allDay ? newStart + 'T00:00:00Z' : newStart).getTime()
  if (Number.isNaN(oldMs) || Number.isNaN(newMs)) return null

  if (allDay) {
    const deltaDays = Math.round((newMs - oldMs) / 86_400_000)
    if (deltaDays === 0) return null
    return exceptions.map((ex) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ex)
      if (!m) return ex
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      d.setDate(d.getDate() + deltaDays)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
  }

  // Timed: shift ISO instants by the millisecond delta.
  const deltaMs = newMs - oldMs
  if (deltaMs === 0) return null
  return exceptions.map((ex) => {
    const exMs = new Date(ex).getTime()
    if (Number.isNaN(exMs)) return ex
    return new Date(exMs + deltaMs).toISOString()
  })
}
