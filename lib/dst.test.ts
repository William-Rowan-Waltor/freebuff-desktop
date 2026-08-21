import { afterEach, describe, expect, it } from 'vitest'
import { occurrenceDates } from '@/lib/recurrence'
import { expandOccurrences } from '@/lib/reminders'
import { expandBlockOccurrences, occurrenceBlock, splitSeriesAt } from '@/lib/expansion'
import { horizonOf } from '@/lib/horizon'
import type { Block } from '@/types'

function allDayMaster(overrides: Partial<Block> = {}): Block {
  return {
    id: 'm',
    type: 'event',
    title: 'Họp',
    content: { type: 'doc', content: [] },
    start_time: '2026-03-07',
    end_time: '2026-03-08',
    recurrence: 'FREQ=DAILY',
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
    ...overrides,
  }
}

// The app stores timed events as UTC instants; rrule iterates them UTC-anchored
// (exact freq*interval of milliseconds), so across a DST transition the UTC
// instant stays fixed and the LOCAL wall-clock drifts by the offset change.
// All-day series store date-only strings, which parse as UTC midnight — their
// calendar day advances exactly one day regardless of DST. These tests pin that
// contract TZ-portably (process.env.TZ re-reads at runtime, restored after each
// test so other tests in the worker keep their default timezone).
afterEach(() => {
  delete process.env.TZ
})

describe('timed recurring series across DST', () => {
  it('keeps the UTC instant fixed across a spring-forward (local wall-clock drifts)', () => {
    process.env.TZ = 'America/New_York'
    // Weekly series at 15:00Z = 10:00 EST. Spring-forward 2026-03-08
    // (02:00 EST -> 03:00 EDT): the next occurrence stays 15:00Z, i.e. 11:00 EDT.
    const rule = { recurrence: 'FREQ=WEEKLY', start_time: '2026-03-01T15:00:00Z', recurrence_exceptions: null }
    const occs = occurrenceDates(rule, new Date('2026-02-25T00:00:00Z'), new Date('2026-03-15T00:00:00Z'))
    expect(occs.map((d) => d.toISOString())).toEqual([
      '2026-03-01T15:00:00.000Z',
      '2026-03-08T15:00:00.000Z',
    ])
    // The local hour moved 10:00 -> 11:00 (1h jump) — the series is UTC-anchored.
    expect(occs[0].getHours()).toBe(10)
    expect(occs[1].getHours()).toBe(11)
  })

  it('keeps the UTC instant fixed across a fall-back (the local hour repeats)', () => {
    process.env.TZ = 'America/New_York'
    // Fall-back 2026-11-01 (02:00 EDT -> 01:00 EST): 15:00Z on 11-01 is 10:00 EST.
    const rule = { recurrence: 'FREQ=WEEKLY', start_time: '2026-10-25T15:00:00Z', recurrence_exceptions: null }
    const occs = occurrenceDates(rule, new Date('2026-10-20T00:00:00Z'), new Date('2026-11-05T00:00:00Z'))
    expect(occs.map((d) => d.toISOString())).toEqual([
      '2026-10-25T15:00:00.000Z',
      '2026-11-01T15:00:00.000Z',
    ])
    // 11:00 EDT -> 10:00 EST.
    expect(occs[1].getHours()).toBe(10)
  })

  it('yields exact 7-day UTC intervals in any timezone (no drift, no skip)', () => {
    // TZ-independent invariant: consecutive instants differ by exactly 7 days.
    const rule = { recurrence: 'FREQ=WEEKLY', start_time: '2026-03-01T15:00:00Z', recurrence_exceptions: null }
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Auckland']) {
      process.env.TZ = tz
      const occs = occurrenceDates(rule, new Date('2026-02-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z'))
      expect(occs.length).toBe(9) // 2026-03-01 .. 2026-04-26 (9 weekly) in every tz
      for (let i = 1; i < occs.length; i++) {
        expect(occs[i].getTime() - occs[i - 1].getTime()).toBe(7 * 24 * 3600_000)
      }
    }
  })
})

describe('all-day series across DST', () => {
  it('advances exactly one calendar date per step across a transition (date-only)', () => {
    process.env.TZ = 'America/New_York'
    // Date-only start parses as UTC midnight; occurrences stay UTC-midnight so
    // the calendar day always steps by one, DST or not.
    const rule = { recurrence: 'FREQ=DAILY', start_time: '2026-03-07', recurrence_exceptions: null }
    const occs = occurrenceDates(rule, new Date('2026-03-01T00:00:00Z'), new Date('2026-03-09T23:59:59Z'))
    expect(occs.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-03-07', '2026-03-08', '2026-03-09'])
  })
})

describe('all-day date keys are timezone-independent (dateOnly root fix)', () => {
  it('splitSeriesAt all-day produces the same exceptions in UTC and a negative-offset zone', () => {
    const run = (tz: string) => {
      process.env.TZ = tz
      return splitSeriesAt(allDayMaster(), '2026-03-09', 4 * 86_400_000)!.addExceptions
    }
    // Regression: local date components used to shift the keys back a day in
    // negative-offset zones (America/New_York gave 03-08..03-12).
    expect(run('America/New_York')).toEqual(run('UTC'))
    expect(run('UTC')).toEqual(['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'])
  })

  it('occurrenceBlock all-day display dates match the stored calendar day in any timezone', () => {
    const run = (tz: string) => {
      process.env.TZ = tz
      return expandBlockOccurrences(
        allDayMaster(),
        new Date('2026-03-05T00:00:00Z'),
        new Date('2026-03-10T00:00:00Z'),
      ).map((o) => occurrenceBlock(allDayMaster(), o).start_time)
    }
    // Regression: negative-offset zones used to render the PREVIOUS day
    // (03-06..03-09) for every all-day occurrence. The window is inclusive of
    // 03-10, so four occurrences.
    expect(run('America/New_York')).toEqual(run('UTC'))
    expect(run('UTC')).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
  })

  it('horizonOf buckets an all-day event on its stored calendar day in a negative-offset zone', () => {
    process.env.TZ = 'America/New_York'
    const now = new Date(2026, 2, 7, 12, 0, 0) // local noon, 2026-03-07 in NY
    // Regression: UTC-midnight parsing put the event a day early ('overdue'
    // on its own day); date-only must parse as the local calendar day.
    expect(horizonOf(allDayMaster(), now)).toBe('today')
    expect(horizonOf(allDayMaster({ start_time: '2026-03-06', end_time: '2026-03-07' }), now)).toBe('overdue')
    // Sunday of the current week (Mon 03-02 .. Sun 03-08).
    expect(horizonOf(allDayMaster({ start_time: '2026-03-08', end_time: '2026-03-09' }), now)).toBe('week')
  })
})

describe('reminder window across DST (expandOccurrences)', () => {
  it('expands exactly the occurrences inside a window that spans the transition', () => {
    process.env.TZ = 'America/New_York'
    const now = new Date('2026-03-01T14:30:00Z') // 09:30 EST
    const ev = {
      id: 'm',
      title: 'Họp',
      recurrence: 'FREQ=DAILY',
      start_time: '2026-03-01T15:00:00Z', // 10:00 EST
      recurrence_exceptions: null,
    }
    const out = expandOccurrences([ev], now, 2 * 24 * 3600_000)
    expect(out.map((e) => e.start_time)).toEqual(['2026-03-01T15:00:00.000Z', '2026-03-02T15:00:00.000Z'])
    expect(out[0].blockId).toBe('m')
    // No duplicate/skipped occurrence around the DST jump inside the window.
    expect(new Set(out.map((e) => e.id)).size).toBe(out.length)
  })

  it('honors an exception that lands on a DST transition day', () => {
    process.env.TZ = 'America/New_York'
    const now = new Date('2026-03-07T15:30:00Z')
    const ev = {
      id: 'm',
      title: 'Điểm danh',
      recurrence: 'FREQ=DAILY',
      start_time: '2026-03-07T16:00:00Z', // after `now` so it lands inside the window
      recurrence_exceptions: ['2026-03-08T16:00:00Z'],
    }
    const out = expandOccurrences([ev], now, 3 * 24 * 3600_000)
    expect(out.map((e) => e.start_time)).toEqual(['2026-03-07T16:00:00.000Z', '2026-03-09T16:00:00.000Z'])
  })
})

describe('splitSeriesAt across DST (series split)', () => {
  function eventBlock(overrides: Partial<Block> & { id: string }): Block {
    return {
      type: 'event',
      title: 'Họp',
      content: { type: 'doc', content: [] },
      start_time: '2026-03-01T15:00:00Z',
      end_time: '2026-03-01T16:00:00Z',
      recurrence: null,
      recurrence_exceptions: null,
      file_url: null,
      file_extension: null,
      owner_id: null,
      ...overrides,
    }
  }

  it('splitting around a spring-forward yields the same window + carry as in UTC', () => {
    const master = eventBlock({
      id: 'm',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-03-22T15:00:00.000Z'],
    })
    const results = ['UTC', 'America/New_York'].map((tz) => {
      process.env.TZ = tz
      return splitSeriesAt(master, '2026-03-15T15:00:00Z', 2 * 7 * 86_400_000)
    })
    // The split enumerates UTC instants, so the transition never shifts them.
    expect(results[1]).toEqual(results[0])
    expect(results[0]!.addExceptions).toEqual([
      '2026-03-15T15:00:00.000Z',
      '2026-03-29T15:00:00.000Z', // 03-22 is excluded, so it is not re-added
    ])
    expect(results[0]!.carryExceptions).toEqual(['2026-03-22T15:00:00.000Z'])
    expect(results[0]!.coversWholeSeries).toBe(false)
  })

  it('splitting around a fall-back yields the same window + carry as in UTC', () => {
    const master = eventBlock({
      id: 'm',
      start_time: '2026-10-25T15:00:00Z',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-11-15T15:00:00.000Z'],
    })
    const results = ['UTC', 'America/New_York'].map((tz) => {
      process.env.TZ = tz
      return splitSeriesAt(master, '2026-11-08T15:00:00Z', 2 * 7 * 86_400_000)
    })
    expect(results[1]).toEqual(results[0])
    expect(results[0]!.addExceptions).toEqual([
      '2026-11-08T15:00:00.000Z',
      '2026-11-22T15:00:00.000Z', // 11-15 is excluded, so it is not re-added
    ])
    expect(results[0]!.carryExceptions).toEqual(['2026-11-15T15:00:00.000Z'])
  })

  it('flags coversWholeSeries from the UTC instant, DST-independently', () => {
    const master = eventBlock({ id: 'm', recurrence: 'FREQ=WEEKLY' })
    for (const tz of ['UTC', 'America/New_York']) {
      process.env.TZ = tz
      expect(splitSeriesAt(master, '2026-03-01T15:00:00Z')!.coversWholeSeries).toBe(true)
      expect(splitSeriesAt(master, '2026-03-01T14:00:00Z')!.coversWholeSeries).toBe(true)
      expect(splitSeriesAt(master, '2026-03-08T15:00:00Z')!.coversWholeSeries).toBe(false)
    }
  })

  it('every-2-weeks keeps exact 14-day UTC spacing across a spring-forward', () => {
    const master = eventBlock({
      id: 'm',
      recurrence: 'FREQ=WEEKLY;INTERVAL=2',
    })
    const results = ['UTC', 'America/New_York'].map((tz) => {
      process.env.TZ = tz
      return splitSeriesAt(master, '2026-03-15T15:00:00Z', 2 * 7 * 86_400_000)
    })
    expect(results[1]).toEqual(results[0])
    expect(results[0]!.addExceptions).toEqual(['2026-03-15T15:00:00.000Z', '2026-03-29T15:00:00.000Z'])
  })
})
