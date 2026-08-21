import { describe, expect, it } from 'vitest'
import {
  expandBlockOccurrences,
  occurrenceBlock,
  excludeOccurrence,
  occurrenceAtOrAfter,
  splitSeriesAt,
} from '@/lib/expansion'
import type { Block } from '@/types'

function block(overrides: Partial<Block> & { id: string }): Block {
  return {
    type: 'event',
    title: 'Họp',
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

describe('expandBlockOccurrences', () => {
  it('expands a weekly series inside the window with duration shifted per occurrence', () => {
    const b = block({
      id: 'm',
      recurrence: 'FREQ=WEEKLY',
      start_time: '2026-08-03T02:00:00Z',
      end_time: '2026-08-03T03:00:00Z',
    })
    const occs = expandBlockOccurrences(
      b,
      new Date('2026-08-14T00:00:00Z'),
      new Date('2026-08-24T23:00:00Z'),
    )
    expect(occs).toHaveLength(2)
    expect(occs[0].start.toISOString()).toBe('2026-08-17T02:00:00.000Z')
    expect(occs[0].end!.toISOString()).toBe('2026-08-17T03:00:00.000Z')
    expect(occs[0].occId).toBe('m@2026-08-17T02:00:00.000Z')
    expect(occs[1].start.toISOString()).toBe('2026-08-24T02:00:00.000Z')
  })

  it('returns [] for non-recurring blocks and non-events', () => {
    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-31T00:00:00Z')
    expect(
      expandBlockOccurrences(block({ id: 'a', recurrence: null, start_time: '2026-08-03T02:00:00Z' }), from, to),
    ).toEqual([])
    expect(
      expandBlockOccurrences(
        block({ id: 'b', type: 'note', recurrence: 'FREQ=WEEKLY', start_time: '2026-08-03T02:00:00Z' }),
        from,
        to,
      ),
    ).toEqual([])
  })

  it('honors recurrence_exceptions (the excluded occurrence is not expanded)', () => {
    const b = block({
      id: 'm',
      recurrence: 'FREQ=WEEKLY',
      start_time: '2026-08-03T02:00:00Z',
      recurrence_exceptions: ['2026-08-17T02:00:00Z'],
    })
    const occs = expandBlockOccurrences(
      b,
      new Date('2026-08-14T00:00:00Z'),
      new Date('2026-08-24T23:00:00Z'),
    )
    expect(occs).toHaveLength(1)
    expect(occs[0].start.toISOString()).toBe('2026-08-24T02:00:00.000Z')
  })

  it('produces date-only occurrence blocks for an all-day series', () => {
    const b = block({ id: 'm', recurrence: 'FREQ=DAILY', start_time: '2026-08-10', end_time: '2026-08-11' })
    const occs = expandBlockOccurrences(b, new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59))
    expect(occs.length).toBeGreaterThan(0)
    for (const occ of occs) {
      const vb = occurrenceBlock(b, occ)
      expect(vb.start_time).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(vb.end_time).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(vb.id).toBe(`${b.id}@${occ.start.toISOString()}`)
    }
  })

  it('shifts ISO instants and keeps a unique virtual id for timed occurrences', () => {
    const b = block({
      id: 'm',
      recurrence: 'FREQ=WEEKLY',
      start_time: '2026-08-03T02:00:00Z',
      end_time: '2026-08-03T03:00:00Z',
    })
    const [occ] = expandBlockOccurrences(
      b,
      new Date('2026-08-14T00:00:00Z'),
      new Date('2026-08-17T23:00:00Z'),
    )
    const vb = occurrenceBlock(b, occ!)
    expect(vb.start_time).toBe('2026-08-17T02:00:00.000Z')
    expect(vb.end_time).toBe('2026-08-17T03:00:00.000Z')
    expect(vb.id).toMatch(/^m@/)
    // The virtual id must never leak into the open path — title/content come
    // from the master.
    expect(vb.title).toBe('Họp')
  })
})

describe('excludeOccurrence', () => {
  it('appends a date-only exception for an all-day series from a date-only start', () => {
    const b = block({ id: 'm', type: 'event', recurrence: 'FREQ=DAILY', start_time: '2026-08-10' })
    expect(excludeOccurrence(b, '2026-08-17')).toEqual({
      recurrence_exceptions: ['2026-08-17'],
    })
  })

  it('normalizes an ISO-midnight start of an all-day series to date-only', () => {
    const b = block({ id: 'm', type: 'event', recurrence: 'FREQ=DAILY', start_time: '2026-08-10T00:00:00Z' })
    expect(excludeOccurrence(b, '2026-08-17T00:00:00.000Z')).toEqual({
      recurrence_exceptions: ['2026-08-17'],
    })
  })

  it('keeps an ISO instant for a timed series and appends to existing exceptions', () => {
    const b = block({
      id: 'm',
      type: 'event',
      recurrence: 'FREQ=WEEKLY',
      start_time: '2026-08-10T02:00:00Z',
      recurrence_exceptions: ['2026-08-24T02:00:00Z'],
    })
    expect(excludeOccurrence(b, '2026-08-17T02:00:00Z')).toEqual({
      recurrence_exceptions: ['2026-08-24T02:00:00Z', '2026-08-17T02:00:00.000Z'],
    })
  })

  it('returns {} when the occurrence is already excluded', () => {
    const b = block({
      id: 'm',
      type: 'event',
      recurrence: 'FREQ=WEEKLY',
      start_time: '2026-08-10T02:00:00Z',
      recurrence_exceptions: ['2026-08-17T02:00:00.000Z'],
    })
    expect(excludeOccurrence(b, '2026-08-17T02:00:00Z')).toEqual({})
  })

  it('returns {} for an unparseable start', () => {
    const b = block({ id: 'm', type: 'event', recurrence: 'FREQ=DAILY', start_time: '2026-08-10' })
    expect(excludeOccurrence(b, 'không-phải-ngày')).toEqual({})
  })

  it('never mutates the master (pure patch)', () => {
    const b = block({
      id: 'm',
      type: 'event',
      recurrence: 'FREQ=DAILY',
      start_time: '2026-08-10',
      recurrence_exceptions: null,
    })
    excludeOccurrence(b, '2026-08-17')
    expect(b.recurrence_exceptions).toBeNull()
  })
})

describe('splitSeriesAt', () => {
  it('excludes occurrences from the split onward and carries later exceptions (timed)', () => {
    const b = block({
      id: 'm',
      type: 'event',
      recurrence: 'FREQ=WEEKLY',
      start_time: '2026-08-10T02:00:00Z',
      recurrence_exceptions: ['2026-08-17T02:00:00.000Z', '2026-08-31T02:00:00.000Z'],
    })
    const split = splitSeriesAt(b, '2026-08-24T02:00:00Z', 3 * 7 * 86_400_000)
    expect(split).not.toBeNull()
    // 08-31 is already excluded on the master, so it is not re-added — the
    // remaining occurrences from the split onward are 08-24, 09-07, 09-14.
    expect(split!.addExceptions).toEqual([
      '2026-08-24T02:00:00.000Z',
      '2026-09-07T02:00:00.000Z',
      '2026-09-14T02:00:00.000Z',
    ])
    // Only the exception AT/after the split carries into the new master.
    expect(split!.carryExceptions).toEqual(['2026-08-31T02:00:00.000Z'])
  })

  it('uses date-only keys for an all-day series', () => {
    const b = block({
      id: 'm',
      type: 'event',
      recurrence: 'FREQ=DAILY',
      start_time: '2026-08-10',
      recurrence_exceptions: ['2026-08-12', '2026-08-18'],
    })
    const split = splitSeriesAt(b, '2026-08-17', 4 * 86_400_000)
    // 08-18 is already excluded on the master, so it is not re-added.
    expect(split!.addExceptions).toEqual(['2026-08-17', '2026-08-19', '2026-08-20', '2026-08-21'])
    expect(split!.carryExceptions).toEqual(['2026-08-18'])
  })

  it('flags coversWholeSeries when the split is at/before the original start (timed)', () => {
    const b = block({ id: 'm', type: 'event', recurrence: 'FREQ=WEEKLY', start_time: '2026-08-10T02:00:00Z' })
    expect(splitSeriesAt(b, '2026-08-10T02:00:00Z')!.coversWholeSeries).toBe(true)
    expect(splitSeriesAt(b, '2026-08-03T02:00:00Z')!.coversWholeSeries).toBe(true)
    expect(splitSeriesAt(b, '2026-08-17T02:00:00Z')!.coversWholeSeries).toBe(false)
  })

  it('flags coversWholeSeries for an all-day series using date-only compare', () => {
    const b = block({ id: 'm', type: 'event', recurrence: 'FREQ=DAILY', start_time: '2026-08-10' })
    expect(splitSeriesAt(b, '2026-08-10')!.coversWholeSeries).toBe(true)
    expect(splitSeriesAt(b, '2026-08-09')!.coversWholeSeries).toBe(true)
    expect(splitSeriesAt(b, '2026-08-11')!.coversWholeSeries).toBe(false)
  })

  it('returns false for an unparseable occurrence or split', () => {
    const b = block({ id: 'm', type: 'event', recurrence: 'FREQ=WEEKLY', start_time: '2026-08-10T02:00:00Z' })
    expect(occurrenceAtOrAfter(b, 'không-phải-ngày', '2026-08-21T02:00:00Z')).toBe(false)
    expect(occurrenceAtOrAfter(b, '2026-08-21T02:00:00Z', 'không-phải-ngày')).toBe(false)
  })

  it('returns null for non-recurring blocks and unparseable split points', () => {
    expect(splitSeriesAt(block({ id: 'a', type: 'event', recurrence: null, start_time: '2026-08-10' }), '2026-08-17')).toBeNull()
    expect(
      splitSeriesAt(block({ id: 'b', type: 'event', recurrence: 'FREQ=DAILY', start_time: '2026-08-10' }), 'không-phải-ngày'),
    ).toBeNull()
  })

  it('treats a split at a COUNT=1 series start as coversWholeSeries (its only occurrence)', () => {
    // A COUNT=1 series has exactly one occurrence, at dtstart, so splitting at
    // it empties the whole series — the dead-master branch should kick in.
    const b = block({ id: 'm', type: 'event', recurrence: 'FREQ=WEEKLY;COUNT=1', start_time: '2026-08-10T02:00:00Z' })
    const split = splitSeriesAt(b, '2026-08-10T02:00:00Z')
    expect(split).not.toBeNull()
    expect(split!.coversWholeSeries).toBe(true)
    // The one occurrence (at dtstart) is inside the split window.
    expect(split!.addExceptions).toEqual(['2026-08-10T02:00:00.000Z'])
  })
})

describe('occurrenceAtOrAfter', () => {
  it('compares ISO instants for a timed series', () => {
    const b = block({ id: 'm', type: 'event', recurrence: 'FREQ=WEEKLY', start_time: '2026-08-10T02:00:00Z' })
    expect(occurrenceAtOrAfter(b, '2026-08-21T02:00:00Z', '2026-08-21T02:00:00Z')).toBe(true)
    expect(occurrenceAtOrAfter(b, '2026-08-21T02:00:00Z', '2026-08-14T02:00:00Z')).toBe(true)
    expect(occurrenceAtOrAfter(b, '2026-08-14T02:00:00Z', '2026-08-21T02:00:00Z')).toBe(false)
  })

  it('compares date-only keys for an all-day series', () => {
    const b = block({ id: 'm', type: 'event', recurrence: 'FREQ=DAILY', start_time: '2026-08-10' })
    expect(occurrenceAtOrAfter(b, '2026-08-17', '2026-08-17')).toBe(true)
    expect(occurrenceAtOrAfter(b, '2026-08-17', '2026-08-24')).toBe(false)
  })
})
