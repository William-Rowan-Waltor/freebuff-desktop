import { describe, expect, it } from 'vitest'
import { isAllDayIso, conflictingIds, conflictRingClass, conflictCountFor } from './overlap'

// Timed events use absolute ISO instants (Z-suffixed so the tests are
// timezone-independent); all-day events keep date-only strings.
const t = (h: number, day = '2026-08-13') => `${day}T${String(h).padStart(2, '0')}:00:00.000Z`

describe('isAllDayIso', () => {
  it('treats date-only strings as all-day', () => {
    expect(isAllDayIso('2026-08-13')).toBe(true)
  })

  it('treats UTC-midnight instants as all-day (PostgREST normalization)', () => {
    expect(isAllDayIso('2026-08-13T00:00:00Z')).toBe(true)
    expect(isAllDayIso('2026-08-13T00:00:00.000Z')).toBe(true)
    expect(isAllDayIso('2026-08-13T00:00:00+00:00')).toBe(true)
  })

  it('treats timed instants as timed', () => {
    expect(isAllDayIso(t(22))).toBe(false)
    expect(isAllDayIso('2026-08-13T00:00:01Z')).toBe(false)
  })

  it('treats null/missing as not all-day', () => {
    expect(isAllDayIso(null)).toBe(false)
  })
})

describe('conflictingIds', () => {
  it('returns both ids for overlapping timed events', () => {
    const ids = conflictingIds([
      { id: 'a', start: t(10), end: t(12) },
      { id: 'b', start: t(11), end: t(13) },
    ])
    expect([...ids].sort()).toEqual(['a', 'b'])
  })

  it('flags events that start at exactly the same time', () => {
    const ids = conflictingIds([
      { id: 'a', start: t(22), end: t(23) },
      { id: 'b', start: t(22), end: t(23) },
    ])
    expect([...ids].sort()).toEqual(['a', 'b'])
  })

  it('does not conflict on adjacent half-open boundaries (one ends when the other starts)', () => {
    const ids = conflictingIds([
      { id: 'a', start: t(22), end: t(23) },
      { id: 'b', start: t(23), end: t(24, '2026-08-14') },
    ])
    expect(ids.size).toBe(0)
  })

  it('flags only the events actually involved in a chain overlap', () => {
    // A 10–12 overlaps B 11–13; C 13–14 only touches B's boundary.
    const ids = conflictingIds([
      { id: 'a', start: t(10), end: t(12) },
      { id: 'b', start: t(11), end: t(13) },
      { id: 'c', start: t(13), end: t(14) },
    ])
    expect([...ids].sort()).toEqual(['a', 'b'])
  })

  it('skips events without an end time (they can never conflict)', () => {
    const ids = conflictingIds([
      { id: 'a', start: t(10), end: t(12) },
      { id: 'b', start: t(11), end: t(13) },
      // Overlaps both a and b, but has no end time so must be ignored.
      { id: 'open', start: t(11), end: null },
    ])
    expect([...ids].sort()).toEqual(['a', 'b'])
  })

  it('never conflicts all-day events with anything', () => {
    const ids = conflictingIds([
      { id: 'allDay', start: '2026-08-13', end: '2026-08-14' },
      { id: 'timed', start: t(10), end: t(12) },
    ])
    expect(ids.size).toBe(0)
  })

  it('skips unparseable dates instead of throwing', () => {
    const ids = conflictingIds([
      { id: 'bad', start: 'not-a-date', end: t(12) },
      { id: 'good', start: t(10), end: t(11) },
    ])
    // 'bad' is skipped; 'good' is the only real interval left, so nothing conflicts.
    expect(ids.size).toBe(0)
  })

  it('returns an empty set for no events', () => {
    expect(conflictingIds([]).size).toBe(0)
  })
})

describe('conflictRingClass', () => {
  it('returns the red-ring classes for a conflicting event', () => {
    const conflicts = new Set(['a', 'b'])
    expect(conflictRingClass(conflicts, 'a')).toBe('ring-2 ring-red-400/80')
  })

  it('returns an empty string (no ring class) for a non-conflicting event', () => {
    const conflicts = new Set(['a'])
    expect(conflictRingClass(conflicts, 'b')).toBe('')
  })

  it('returns an empty string for every event when nothing conflicts', () => {
    const conflicts = conflictingIds([
      { id: 'a', start: t(22), end: t(23) },
      { id: 'b', start: t(23), end: t(24, '2026-08-14') },
    ])
    expect(conflictRingClass(conflicts, 'a')).toBe('')
    expect(conflictRingClass(conflicts, 'b')).toBe('')
  })
})

describe('conflictCountFor', () => {
  it('counts how many other events overlap the target', () => {
    const events = [
      { id: 'a', start: t(10), end: t(12) },
      { id: 'b', start: t(11), end: t(13) },
      { id: 'c', start: t(13), end: t(14) },
    ]
    expect(conflictCountFor(events, 'a')).toBe(1)
    expect(conflictCountFor(events, 'b')).toBe(1)
    expect(conflictCountFor(events, 'c')).toBe(0)
  })

  it('counts every overlapping event for a long interval', () => {
    const events = [
      { id: 'long', start: t(9), end: t(16) },
      { id: 'a', start: t(10), end: t(11) },
      { id: 'b', start: t(12), end: t(13) },
      { id: 'c', start: t(15), end: t(16) },
    ]
    expect(conflictCountFor(events, 'long')).toBe(3)
  })

  it('does not count the target itself or boundary-touch-only events', () => {
    const events = [
      { id: 'a', start: t(10), end: t(12) },
      { id: 'b', start: t(12), end: t(13) },
    ]
    expect(conflictCountFor(events, 'a')).toBe(0)
  })

  it('returns 0 for the target without a timed interval', () => {
    expect(conflictCountFor([{ id: 'open', start: t(10), end: null }], 'open')).toBe(0)
    expect(
      conflictCountFor([{ id: 'allDay', start: '2026-08-13', end: '2026-08-14' }], 'allDay'),
    ).toBe(0)
  })

  it('returns 0 when the target is missing or its dates are unparseable', () => {
    const events = [{ id: 'other', start: t(10), end: t(11) }]
    expect(conflictCountFor(events, 'ghost')).toBe(0)
    expect(conflictCountFor([{ id: 'bad', start: 'not-a-date', end: t(11) }], 'bad')).toBe(0)
  })

  it('returns 0 even when the target overlaps an all-day event', () => {
    const events = [
      { id: 'timed', start: t(10), end: t(12) },
      { id: 'allDay', start: '2026-08-13', end: '2026-08-14' },
    ]
    expect(conflictCountFor(events, 'timed')).toBe(0)
  })
})
