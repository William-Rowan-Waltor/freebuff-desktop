import { describe, expect, it } from 'vitest'
import { RRule } from 'rrule'
import {
  buildRRuleString,
  FREQ_OPTIONS,
  FREQ_UNITS,
  isRecurring,
  occurrenceDates,
  parseRecurrence,
  recurrenceProps,
} from './recurrence'
import type { Block } from '@/types'

function block(overrides: Partial<Block> & { id: string }): Block {
  return {
    type: 'event',
    title: null,
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

const FROM = new Date('2026-08-01T00:00:00Z')
const TO = new Date('2026-09-30T00:00:00Z')

describe('parseRecurrence', () => {
  it('parses a weekly rule with BYDAY + INTERVAL', () => {
    const spec = parseRecurrence('FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2')
    expect(spec).not.toBeNull()
    expect(spec!.freq).toBe(RRule.WEEKLY)
    expect(spec!.interval).toBe(2)
    // Monday=0 numbering in rrule.
    expect(spec!.byweekday).toEqual([0, 2])
    expect(spec!.until).toBeNull()
  })

  it('parses BYMONTHDAY and BYSETPOS monthly rules', () => {
    const dom = parseRecurrence('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(dom!.bymonthday).toEqual([15])
    expect(dom!.byweekday).toBeNull()
    expect(dom!.bysetpos).toBeNull()

    const pos = parseRecurrence('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1')
    expect(pos!.byweekday).toEqual([4])
    expect(pos!.bysetpos).toEqual([-1])
    expect(pos!.bymonthday).toBeNull()
  })

  // Regression: rrule's fromString fills in DERIVED defaults when the rule
  // omits BYDAY/BYMONTHDAY (anchored to the parse-time date). The app stores
  // its own dtstart (start_time), so freq-only rules must stay dtstart-anchored
  // and report no explicit parts — otherwise a 'Mỗi tuần' rule would repeat on
  // whatever weekday the rule happened to be parsed.
  it('does not report derived BYDAY/BYMONTHDAY defaults for freq-only rules', () => {
    const weekly = parseRecurrence('FREQ=WEEKLY')
    expect(weekly!.byweekday).toBeNull()
    expect(weekly!.bymonthday).toBeNull()
    expect(weekly!.bysetpos).toBeNull()

    const monthly = parseRecurrence('FREQ=MONTHLY')
    expect(monthly!.bymonthday).toBeNull()
    expect(monthly!.byweekday).toBeNull()
  })

  it('parses COUNT and prefers it over a coexisting UNTIL', () => {
    expect(parseRecurrence('FREQ=DAILY;COUNT=2')!.count).toBe(2)
    expect(parseRecurrence('FREQ=DAILY;COUNT=2')!.until).toBeNull()
    // rrule forbids both; parseRecurrence drops UNTIL so expansion never trips.
    const both = parseRecurrence('FREQ=DAILY;UNTIL=20261231T000000Z;COUNT=3')
    expect(both!.count).toBe(3)
    expect(both!.until).toBeNull()
  })

  it('returns null for absent or garbage strings', () => {
    expect(parseRecurrence(null)).toBeNull()
    expect(parseRecurrence('')).toBeNull()
    expect(parseRecurrence('not-a-rule')).toBeNull()
  })
})

describe('buildRRuleString', () => {
  it('builds FREQ/BYDAY and omits defaults', () => {
    expect(buildRRuleString({ freq: RRule.WEEKLY, byweekday: [0] })).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(buildRRuleString({ freq: RRule.DAILY })).toBe('FREQ=DAILY')
  })

  it('includes INTERVAL and UNTIL when given and round-trips', () => {
    const until = new Date('2026-12-31T00:00:00Z')
    const str = buildRRuleString({ freq: RRule.WEEKLY, interval: 2, byweekday: [0, 2], until })
    expect(str).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T000000Z')

    const spec = parseRecurrence(str)
    expect(spec!.interval).toBe(2)
    expect(spec!.byweekday).toEqual([0, 2])
    expect(spec!.until!.toISOString()).toBe('2026-12-31T00:00:00.000Z')
  })

  it('writes BYMONTHDAY and BYSETPOS and round-trips', () => {
    const dom = buildRRuleString({ freq: RRule.MONTHLY, bymonthday: [15] })
    expect(dom).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(parseRecurrence(dom)!.bymonthday).toEqual([15])

    const pos = buildRRuleString({ freq: RRule.MONTHLY, byweekday: [4], bysetpos: [-1] })
    expect(pos).toBe('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1')
    const posSpec = parseRecurrence(pos)
    expect(posSpec!.byweekday).toEqual([4])
    expect(posSpec!.bysetpos).toEqual([-1])
  })

  it('writes COUNT and round-trips', () => {
    const str = buildRRuleString({ freq: RRule.WEEKLY, interval: 2, byweekday: [0], count: 3 })
    expect(str).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3')
    const spec = parseRecurrence(str)
    expect(spec!.count).toBe(3)
    expect(spec!.interval).toBe(2)
    expect(spec!.byweekday).toEqual([0])
    expect(spec!.until).toBeNull()
  })

  it('refuses to build a rule with both UNTIL and COUNT', () => {
    expect(() =>
      buildRRuleString({ freq: RRule.DAILY, until: new Date('2026-12-31T00:00:00Z'), count: 2 }),
    ).toThrow(/mutually exclusive/)
  })
})

describe('isRecurring', () => {
  it('true only for parseable rules', () => {
    expect(isRecurring(block({ id: 'a', recurrence: 'FREQ=WEEKLY;BYDAY=MO' }))).toBe(true)
    expect(isRecurring(block({ id: 'b', recurrence: 'junk' }))).toBe(false)
    expect(isRecurring(block({ id: 'c' }))).toBe(false)
  })
})

describe('occurrenceDates', () => {
  it('expands a weekly series within the window', () => {
    const b = block({ id: 'weekly', start_time: '2026-08-17T02:00:00Z', recurrence: 'FREQ=WEEKLY;BYDAY=MO' })
    const dates = occurrenceDates(b, FROM, TO)
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ])
  })

  it('excludes exception instants', () => {
    const b = block({
      id: 'weekly',
      start_time: '2026-08-17T02:00:00Z',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      recurrence_exceptions: ['2026-08-24T02:00:00Z'],
    })
    const dates = occurrenceDates(b, FROM, TO)
    expect(dates.map((d) => d.toISOString().slice(0, 10))).not.toContain('2026-08-24')
    expect(dates).toHaveLength(6)
  })

  it('stops at UNTIL', () => {
    const b = block({
      id: 'until',
      start_time: '2026-08-17T02:00:00Z',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260901T000000Z',
    })
    const dates = occurrenceDates(b, FROM, TO)
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-08-17', '2026-08-24', '2026-08-31'])
  })

  it('bounds expansion by COUNT', () => {
    const daily = block({ id: 'c2', start_time: '2026-08-17T02:00:00Z', recurrence: 'FREQ=DAILY;COUNT=2' })
    expect(occurrenceDates(daily, FROM, TO).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-08-17',
      '2026-08-18',
    ])

    const weekly = block({
      id: 'c3',
      start_time: '2026-08-17T02:00:00Z',
      recurrence: 'FREQ=WEEKLY;INTERVAL=2;COUNT=3',
    })
    expect(occurrenceDates(weekly, FROM, TO).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-08-17',
      '2026-08-31',
      '2026-09-14',
    ])
  })

  // Regression guard: the editor's "Chỉ sự kiện này" path stores the master's
  // raw start_time as the exception, which for an all-day series is the
  // PostgREST UTC-midnight ISO shape ('2026-08-19T00:00:00Z') while the
  // calendar drag path stores date-only ('2026-08-19'). Both must exclude the
  // same occurrence — date-only and UTC-midnight instants are the same moment.
  it('excludes all-day occurrences with both date-only and ISO-midnight exceptions', () => {
    const dateStart = block({ id: 'ad1', start_time: '2026-08-17', recurrence: 'FREQ=DAILY' })
    const isoStart = block({ id: 'ad2', start_time: '2026-08-17T00:00:00Z', recurrence: 'FREQ=DAILY' })
    for (const b of [dateStart, isoStart]) {
      const excepted = block({
        ...b,
        recurrence_exceptions: ['2026-08-19', '2026-08-20T00:00:00Z'],
      })
      const days = occurrenceDates(excepted, FROM, TO).map((d) => d.toISOString().slice(0, 10))
      expect(days).not.toContain('2026-08-19')
      expect(days).not.toContain('2026-08-20')
      expect(days).toContain('2026-08-17')
      expect(days).toContain('2026-08-21')
    }
  })

  it('expands BYMONTHDAY monthly rules to the day-of-month', () => {
    const b = block({ id: 'dom', start_time: '2026-08-15T02:00:00Z', recurrence: 'FREQ=MONTHLY;BYMONTHDAY=15' })
    const dates = occurrenceDates(b, FROM, TO)
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-08-15', '2026-09-15'])
  })

  it('expands BYDAY+BYSETPOS to e.g. the last Friday of the month', () => {
    const b = block({
      id: 'pos',
      start_time: '2026-08-21T02:00:00Z',
      recurrence: 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1',
    })
    const dates = occurrenceDates(b, FROM, TO)
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-08-28', '2026-09-25'])
  })

  // Regression: a freq-only weekly rule must anchor to the block's own start
  // weekday (constructor default), never to a parse-derived weekday.
  it('anchors freq-only weekly rules to the block dtstart weekday', () => {
    const b = block({ id: 'anchor', start_time: '2026-08-17T02:00:00Z', recurrence: 'FREQ=WEEKLY' })
    const dates = occurrenceDates(b, FROM, TO)
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ])
  })

  it('returns [] for non-recurring blocks', () => {
    expect(occurrenceDates(block({ id: 'plain' }), FROM, TO)).toEqual([])
  })
})

describe('recurrenceProps', () => {
  it('returns rrule props for a timed recurring block with exceptions', () => {
    const b = block({
      id: 'weekly',
      start_time: '2026-08-17T02:00:00Z',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      recurrence_exceptions: ['2026-08-24T02:00:00Z'],
    })
    expect(recurrenceProps(b)).toEqual({
      rrule: { freq: RRule.WEEKLY, interval: 1, byweekday: [0], dtstart: '2026-08-17T02:00:00Z' },
      exdate: ['2026-08-24T02:00:00Z'],
    })
  })

  it('keeps all-day dtstart date-only', () => {
    const b = block({ id: 'allday', start_time: '2026-08-17', recurrence: 'FREQ=DAILY' })
    expect(recurrenceProps(b)!.rrule.dtstart).toBe('2026-08-17')
  })

  it('passes COUNT through to the rrule plugin', () => {
    const b = block({ id: 'counted', start_time: '2026-08-17T02:00:00Z', recurrence: 'FREQ=DAILY;COUNT=3' })
    expect(recurrenceProps(b)!.rrule.count).toBe(3)
    expect(recurrenceProps(b)!.rrule.until).toBeUndefined()
  })

  it('returns null when not recurring or without a start', () => {
    expect(recurrenceProps(block({ id: 'a' }))).toBeNull()
    expect(recurrenceProps(block({ id: 'b', recurrence: 'FREQ=DAILY' }))).toBeNull()
  })
})

describe('shared freq option lists', () => {
  it('covers exactly the four rrule freqs with distinct labels', () => {
    const values = FREQ_OPTIONS.map((o) => o.value)
    expect(values.sort()).toEqual([RRule.DAILY, RRule.WEEKLY, RRule.MONTHLY, RRule.YEARLY].sort())
    const labels = FREQ_OPTIONS.map((o) => o.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('gives every FREQ_OPTIONS value a short unit name', () => {
    for (const { value } of FREQ_OPTIONS) {
      expect(FREQ_UNITS[value]).toBeTruthy()
    }
    expect(FREQ_UNITS[RRule.WEEKLY]).toBe('tuần')
  })
})

describe('edge rules (COUNT/INTERVAL/MONTHLY/YEARLY)', () => {
  it('prefers COUNT over UNTIL when a stored rule has both (rrule forbids both)', () => {
    // parseRecurrence deliberately drops UNTIL if COUNT is present so downstream
    // expansion never trips rrule's constructor guard on a bad stored string.
    const spec = parseRecurrence('FREQ=DAILY;UNTIL=20260801T000000Z;COUNT=3')
    expect(spec).not.toBeNull()
    expect(spec!.count).toBe(3)
    expect(spec!.until).toBeNull()
  })

  it('renders nothing for a COUNT=1 series whose single occurrence is excluded', () => {
    const b = block({
      id: 'one-off',
      start_time: '2026-08-10T02:00:00Z',
      recurrence: 'FREQ=WEEKLY;COUNT=1',
      recurrence_exceptions: ['2026-08-10T02:00:00.000Z'],
    })
    expect(occurrenceDates(b, FROM, TO)).toEqual([])
  })

  it('expands every-2-weeks with exactly 14-day spacing', () => {
    const b = block({
      id: 'biweekly',
      start_time: '2026-08-10T02:00:00Z',
      recurrence: 'FREQ=WEEKLY;INTERVAL=2',
    })
    const dates = occurrenceDates(b, FROM, TO)
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-08-10',
      '2026-08-24',
      '2026-09-07',
      '2026-09-21',
    ])
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime() - dates[i - 1].getTime()).toBe(14 * 24 * 3600_000)
    }
  })

  it('round-trips INTERVAL through buildRRuleString + recurrenceProps', () => {
    const rrule = buildRRuleString({ freq: RRule.WEEKLY, interval: 3 })
    expect(rrule).toBe('FREQ=WEEKLY;INTERVAL=3')
    const props = recurrenceProps(block({ id: 'm', start_time: '2026-08-10T02:00:00Z', recurrence: rrule }))
    expect(props).not.toBeNull()
    expect(props!.rrule.interval).toBe(3)
  })

  it('skips months without the anchored day for a MONTHLY series on the 31st', () => {
    // rrule does NOT clamp day-31 to the month end — February/30-day months are
    // simply skipped. Pin that so the UI can decide whether to offer
    // BYMONTHDAY=-1 ('Ngày cuối tháng') instead.
    const b = block({
      id: 'monthly-31',
      start_time: '2026-08-31T02:00:00Z',
      recurrence: 'FREQ=MONTHLY',
    })
    const dates = occurrenceDates(b, new Date('2026-07-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'))
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-08-31',
      '2026-10-31',
      '2026-12-31',
    ])
  })

  it('hits Feb 29 only in leap years for a YEARLY series', () => {
    const b = block({
      id: 'leap',
      start_time: '2024-02-29T02:00:00Z',
      recurrence: 'FREQ=YEARLY',
    })
    const dates = occurrenceDates(b, new Date('2023-01-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z'))
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2024-02-29',
      '2028-02-29',
    ])
  })

  it('expands an all-day monthly series with BYMONTHDAY=-1 to the last day of each month', () => {
    const b = block({
      id: 'last-day',
      start_time: '2026-01-31',
      recurrence: 'FREQ=MONTHLY;BYMONTHDAY=-1',
    })
    const dates = occurrenceDates(b, new Date('2026-01-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z'))
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })
})
