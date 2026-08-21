/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { RRule } from 'rrule'

import { toFcEventInputs } from './CalendarView'
import type { Block } from '@/types'

function block(overrides: Partial<Block> & { id: string }): Block {
  return {
    type: 'event',
    title: 'Sự kiện',
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

describe('toFcEventInputs', () => {
  it('passes an explicit duration for timed recurring events so occurrences keep their length', () => {
    const items = toFcEventInputs([
      block({
        id: 'r',
        start_time: '2026-08-17T02:00:00Z',
        end_time: '2026-08-17T03:30:00Z',
        recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      }),
    ])
    expect(items[0]).toMatchObject({
      rrule: { freq: RRule.WEEKLY, interval: 1, byweekday: [0], dtstart: '2026-08-17T02:00:00Z' },
      duration: 90 * 60_000,
      extendedProps: { recurring: true },
    })
  })

  it('omits duration for all-day recurring events (FC defaults to one day)', () => {
    const items = toFcEventInputs([block({ id: 'r', start_time: '2026-08-17', recurrence: 'FREQ=DAILY' })])
    expect(items[0]).not.toHaveProperty('duration')
    expect(items[0]).toMatchObject({ rrule: { dtstart: '2026-08-17' }, extendedProps: { recurring: true } })
  })

  it('keeps plain events as start/end without rrule props', () => {
    const items = toFcEventInputs([
      block({ id: 'p', start_time: '2026-08-17T02:00:00Z', end_time: '2026-08-17T03:00:00Z' }),
    ])
    expect(items[0]).toMatchObject({ start: '2026-08-17T02:00:00Z', end: '2026-08-17T03:00:00Z' })
    expect(items[0]).not.toHaveProperty('rrule')
    expect(items[0]).not.toHaveProperty('duration')
  })
})
