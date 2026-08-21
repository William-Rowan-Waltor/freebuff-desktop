/** @vitest-environment jsdom */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import { useSettingsStore } from '@/store/useSettingsStore'
import {
  expandOccurrences,
  minutesBetween,
  nextUpcomingEvent,
  useEventReminders,
  type ReminderEvent,
  type ReminderInput,
} from '@/lib/reminders'

const T0 = Date.UTC(2026, 7, 13, 12, 0, 0) // 2026-08-13T12:00:00Z

const iso = (minsOffset: number) => new Date(T0 + minsOffset * 60_000).toISOString()

class MockNotification {
  static instances: MockNotification[] = []
  static permission = 'granted'
  static requestPermission = vi.fn()
  title: string
  options: NotificationOptions
  onclick: (() => void) | null = null

  constructor(title: string, options: NotificationOptions) {
    this.title = title
    this.options = options
    MockNotification.instances.push(this)
  }

  close() {}
}

const ev = (id: string, start: string): ReminderEvent => ({ id, title: id, start_time: start })

describe('nextUpcomingEvent', () => {
  const now = new Date(T0)

  it('returns the earliest event starting within the window', () => {
    const events = [ev('b', iso(8)), ev('a', iso(5)), ev('c', iso(30))]
    expect(nextUpcomingEvent(events, now, 10 * 60_000)?.id).toBe('a')
  })

  it('ignores events that already started', () => {
    expect(nextUpcomingEvent([ev('past', iso(-5))], now, 10 * 60_000)).toBeNull()
  })

  it('includes the exact boundary but excludes events beyond it', () => {
    expect(nextUpcomingEvent([ev('at', iso(10))], now, 10 * 60_000)?.id).toBe('at')
    expect(nextUpcomingEvent([ev('beyond', iso(11))], now, 10 * 60_000)).toBeNull()
    expect(nextUpcomingEvent([ev('justIn', iso(9))], now, 10 * 60_000)?.id).toBe('justIn')
  })

  it('skips all-day events in both shapes', () => {
    const events = [ev('allDay', '2026-08-14'), ev('utcMidnight', '2026-08-14T00:00:00Z'), ev('timed', iso(5))]
    expect(nextUpcomingEvent(events, now, 10 * 60_000)?.id).toBe('timed')
  })

  it('returns null for no qualifying events', () => {
    expect(nextUpcomingEvent([], now, 10 * 60_000)).toBeNull()
    expect(nextUpcomingEvent([ev('bad', 'not-a-date')], now, 10 * 60_000)).toBeNull()
  })
})

describe('minutesBetween', () => {
  it('rounds to whole minutes', () => {
    expect(minutesBetween(new Date(T0), iso(5))).toBe(5)
    expect(minutesBetween(new Date(T0), iso(0))).toBe(0)
  })
})

describe('expandOccurrences', () => {
  const now = new Date(T0)

  it('passes plain events through with blockId', () => {
    const out = expandOccurrences([ev('e1', iso(5))], now, 10 * 60_000)
    expect(out).toEqual([{ id: 'e1', title: 'e1', start_time: iso(5), blockId: 'e1' }])
  })

  it('expands recurring series into windowed occurrences with unique ids', () => {
    // Daily series anchored 23h45m before now → the next occurrence lands at
    // now + 15m, inside the 30-minute window.
    const dtstart = iso(-23 * 60 - 45)
    const out = expandOccurrences(
      [{ id: 'daily', title: 'Mỗi ngày', start_time: dtstart, recurrence: 'FREQ=DAILY' }],
      now,
      30 * 60_000,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ id: `daily@${iso(15)}`, title: 'Mỗi ngày', start_time: iso(15), blockId: 'daily' })
  })

  it('excludes occurrences outside the window', () => {
    // Next occurrence at now + 45m — beyond the 30-minute window.
    const dtstart = iso(-23 * 60 - 15)
    const out = expandOccurrences(
      [{ id: 'd', title: 'Xa', start_time: dtstart, recurrence: 'FREQ=DAILY' }],
      now,
      30 * 60_000,
    )
    expect(out).toHaveLength(0)
  })

  it('expands all-day recurring series to UTC-midnight occurrences (skipped downstream)', () => {
    const out = expandOccurrences(
      [{ id: 'ad', title: 'Cả ngày', start_time: '2026-08-12', recurrence: 'FREQ=DAILY' }],
      now,
      14 * 60 * 60_000,
    )
    expect(out.length).toBeGreaterThan(0)
    expect(nextUpcomingEvent(out, now, 14 * 60 * 60_000)).toBeNull()
  })
})

describe('useEventReminders', () => {
  beforeEach(() => {
    MockNotification.instances = []
    MockNotification.requestPermission.mockReset()
    vi.stubGlobal('Notification', MockNotification)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function Probe({ events }: { events: ReminderInput[] }) {
    useEventReminders(events)
    return null
  }

  it('fires once for an event inside the window and not again on later ticks', () => {
    render(<Probe events={[{ id: 'e1', title: 'Đứng họp', start_time: iso(5) }]} />, {
      fakeTimers: { now: T0 },
    })

    expect(MockNotification.instances).toHaveLength(1)
    expect(MockNotification.instances[0].title).toBe('Đứng họp')
    expect(MockNotification.instances[0].options.body).toBe('Bắt đầu sau 5 phút')

    // Same event still upcoming → no duplicate.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(MockNotification.instances).toHaveLength(1)

    // Start passes → pruned, still no refire.
    act(() => {
      vi.advanceTimersByTime(6 * 60_000)
    })
    expect(MockNotification.instances).toHaveLength(1)
  })

  it('does not fire when the event is beyond the threshold', () => {
    render(<Probe events={[{ id: 'e1', title: 'Xa', start_time: iso(30) }]} />, {
      fakeTimers: { now: T0 },
    })
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('fires once the event comes inside the threshold on a later tick', () => {
    render(<Probe events={[{ id: 'e1', title: 'Sắp', start_time: iso(30) }]} />, {
      fakeTimers: { now: T0 },
    })
    expect(MockNotification.instances).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(21 * 60_000)
    })
    expect(MockNotification.instances).toHaveLength(1)
  })

  it('fires for an upcoming recurring occurrence, not just the master block', () => {
    // The master's dtstart is already past; the next occurrence (now + 5m, the
    // default 10-minute threshold) is what should trigger the reminder.
    const dtstart = iso(-24 * 60 + 5)
    const events: ReminderInput[] = [
      { id: 'rec-1', title: 'Điểm danh', start_time: dtstart, recurrence: 'FREQ=DAILY', recurrence_exceptions: null },
    ]
    render(<Probe events={events} />, { fakeTimers: { now: T0 } })

    expect(MockNotification.instances).toHaveLength(1)
    expect(MockNotification.instances[0].title).toBe('Điểm danh')
    expect(MockNotification.instances[0].options.body).toBe('Bắt đầu sau 5 phút')

    // The same occurrence stays in the window → no duplicate fire.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(MockNotification.instances).toHaveLength(1)
  })

  it('does not fire when the series has no occurrence inside the threshold', () => {
    // Daily series whose next occurrence is 22h away.
    const dtstart = iso(-2 * 60)
    render(
      <Probe events={[{ id: 'rec-1', title: 'Xa', start_time: dtstart, recurrence: 'FREQ=DAILY' }]} />,
      { fakeTimers: { now: T0 } },
    )
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('does not fire when reminders are disabled', () => {
    useSettingsStore.setState({ remindersEnabled: false })
    render(<Probe events={[{ id: 'e1', title: 'Tắt', start_time: iso(5) }]} />, {
      fakeTimers: { now: T0 },
      resetStores: false,
    })
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('requests permission on mount when a future timed event exists and permission is default', () => {
    vi.stubGlobal(
      'Notification',
      class extends MockNotification {
        static permission = 'default'
      },
    )
    MockNotification.requestPermission.mockReset()

    render(<Probe events={[{ id: 'e1', title: 'Sắp', start_time: iso(5) }]} />, {
      fakeTimers: { now: T0 },
    })
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('requests permission for a recurring series whose dtstart passed but has future occurrences', () => {
    vi.stubGlobal(
      'Notification',
      class extends MockNotification {
        static permission = 'default'
      },
    )
    MockNotification.requestPermission.mockReset()

    render(
      <Probe events={[{ id: 'rec-1', title: 'Chuỗi', start_time: iso(-120), recurrence: 'FREQ=DAILY' }]} />,
      { fakeTimers: { now: T0 } },
    )
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('does not request permission when no future timed event exists', () => {
    MockNotification.requestPermission.mockReset()
    render(<Probe events={[{ id: 'e1', title: 'Cả ngày', start_time: '2026-08-14' }]} />, {
      fakeTimers: { now: T0 },
    })
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(0)
  })
})