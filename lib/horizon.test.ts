import { afterEach, describe, expect, it } from 'vitest'

import { dateLabel, horizonOf, isEnded } from '@/lib/horizon'
import type { Block } from '@/types'

function block(endTime: string | null): Block {
  return {
    id: 'b1',
    type: 'event',
    title: null,
    content: null,
    start_time: null,
    end_time: endTime,
    recurrence: null,
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
  }
}

function startBlock(startTime: string, endTime: string | null = null): Block {
  return { ...block(null), start_time: startTime, end_time: endTime }
}

afterEach(() => {
  delete process.env.TZ
})

describe('isEnded', () => {
  it('ends a timed event once its end_time passes', () => {
    const now = new Date('2026-01-20T00:00:00.000Z')
    expect(isEnded(block('2026-01-15T10:00:00.000Z'), now)).toBe(true)
    expect(isEnded(block('2026-02-01T10:00:00.000Z'), now)).toBe(false)
  })

  it('never ends a block without an end_time', () => {
    expect(isEnded(block(null), new Date())).toBe(false)
  })

  it('keeps an all-day date-only event visible through its whole day', () => {
    // Same local day as the all-day date → still visible.
    expect(isEnded(block('2026-01-15'), new Date('2026-01-15T23:00:00'))).toBe(false)
    // Once the day is over, it is done.
    expect(isEnded(block('2026-01-15'), new Date('2026-01-16T00:30:00'))).toBe(true)
  })

  it('treats a UTC-midnight all-day instant the same way', () => {
    // Wide margins so the test holds in any timezone: the instant's local day
    // is 2026-01-14 or 15, so it ends by 2026-01-16 local at the latest.
    expect(isEnded(block('2026-01-15T00:00:00.000Z'), new Date('2026-01-10T12:00:00'))).toBe(false)
    expect(isEnded(block('2026-01-15T00:00:00.000Z'), new Date('2026-01-20T12:00:00'))).toBe(true)
  })

  it('treats an unparseable end_time as still open', () => {
    expect(isEnded(block('not-a-date'), new Date())).toBe(false)
  })
})

describe('dateLabel', () => {
  it('labels an all-day date-only event with its calendar day, no clock time', () => {
    process.env.TZ = 'UTC'
    expect(dateLabel(startBlock('2026-08-11'))).toBe('T3 11/08')
  })

  it('labels a UTC-midnight all-day instant with the same calendar day in any timezone', () => {
    // PostgREST round-trips date-only to a UTC-midnight instant; both shapes
    // must render the STORED calendar day, never shift it back in
    // negative-offset zones (the regression this pins).
    const run = (tz: string) => {
      process.env.TZ = tz
      return dateLabel(startBlock('2026-08-11T00:00:00.000Z'))
    }
    for (const tz of ['America/New_York', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Ho_Chi_Minh', 'UTC']) {
      expect(run(tz)).toBe('T3 11/08')
    }
  })

  it('labels an all-day event on a DST transition day with its calendar day everywhere', () => {
    // 2026-03-08 is the US spring-forward day; Auckland (UTC+13) is already on
    // 03-08 while NY is still on 03-07 when the instant is read raw. The stored
    // calendar day must win in every zone — no date shift either way.
    const run = (tz: string) => {
      process.env.TZ = tz
      return dateLabel(startBlock('2026-03-08'))
    }
    for (const tz of ['America/New_York', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Ho_Chi_Minh', 'UTC']) {
      expect(run(tz)).toBe('CN 08/03')
    }
  })

  it('keeps the wall-clock range for timed events', () => {
    process.env.TZ = 'UTC'
    expect(dateLabel(startBlock('2026-08-11T22:00:00.000Z', '2026-08-11T23:00:00.000Z'))).toBe(
      'T3 11/08 · 22:00–23:00',
    )
  })

  it('returns Chưa có ngày without a start', () => {
    expect(dateLabel(block(null))).toBe('Chưa có ngày')
  })
})

describe('horizonOf UTC-midnight all-day instants', () => {
  it('buckets a UTC-midnight all-day instant on its stored calendar day', () => {
    process.env.TZ = 'America/New_York'
    const now = new Date(2026, 2, 7, 12, 0, 0) // local noon, 2026-03-07 in NY
    // 2026-03-07T00:00:00Z = 19:00 on Mar 6 in NY; must still bucket 'today',
    // not shift back to 'overdue' the way raw instant parsing would.
    expect(horizonOf(startBlock('2026-03-07T00:00:00.000Z'), now)).toBe('today')
    expect(horizonOf(startBlock('2026-03-06T00:00:00.000Z'), now)).toBe('overdue')
    // Same stored-day semantics in a positive-offset zone.
    process.env.TZ = 'Pacific/Auckland'
    const nzNow = new Date(2026, 2, 7, 12, 0, 0)
    expect(horizonOf(startBlock('2026-03-07T00:00:00.000Z'), nzNow)).toBe('today')
    expect(horizonOf(startBlock('2026-03-06T00:00:00.000Z'), nzNow)).toBe('overdue')
  })
})
