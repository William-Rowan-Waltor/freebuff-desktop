/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import MainWorkspace from '@/components/layout/MainWorkspace'
import { useBlocksStore } from '@/store/useBlocksStore'

// The tab views are loaded via next/dynamic (CalendarView → FullCalendar,
// CodeEditor → Monaco). They aren't under test here and their module graphs
// add minutes to the run, so render a placeholder instead of loading them.
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const LazyPlaceholder = () => null
    return LazyPlaceholder
  },
}))

const T0 = Date.UTC(2026, 7, 13, 12, 0, 0) // 2026-08-13T12:00:00Z

function header(container: HTMLElement): HTMLElement {
  const el = container.querySelector('header')
  if (!el) throw new Error('no <header> rendered')
  return el as HTMLElement
}

describe('MainWorkspace header', () => {
  it('renders the sidebar button, navigation tabs, and toolbar', () => {
    const { container } = render(<MainWorkspace />, { fakeTimers: { now: T0 } })
    const bar = header(container)

    // Sidebar toggle
    expect(bar.querySelector('[aria-label="Mở sidebar"]')).not.toBeNull()

    // Navigation tabs (the Hôm nay digest is the landing tab)
    for (const label of ['Hôm nay', 'Lịch', 'Kế hoạch', 'Ghi chú', 'Tệp']) {
      expect(bar.textContent).toContain(label)
    }
    expect(bar.querySelector('nav[aria-label="Khu vực chính"]')).not.toBeNull()

    // Search
    expect(bar.querySelector('[aria-label="Tìm kiếm block"]')).not.toBeNull()

    // Right-side toolbar: clock, settings, theme, upload, create menu
    expect(bar.querySelector('[aria-label^="Đồng hồ"]')).not.toBeNull()
    expect(bar.querySelector('[aria-label="Mở cài đặt"]')).not.toBeNull()
    expect(bar.querySelector('[aria-label^="Đổi giao diện"]')).not.toBeNull()
    expect(bar.querySelector('[aria-label="Tải file lên"]')).not.toBeNull()
    expect(bar.textContent).toContain('Tạo mới')
  })

  it('opens and closes the search dropdown from the header', () => {
    const { container } = render(<MainWorkspace />, { fakeTimers: { now: T0 } })
    const bar = header(container)
    const input = bar.querySelector<HTMLInputElement>('[aria-label="Tìm kiếm block"]')
    expect(input).not.toBeNull()

    // Type a query → the dropdown opens with the (empty-store) message.
    // Use the native value setter (like testing-library's fireEvent) so
    // React's controlled-input tracking sees the change.
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!
      setter.call(input, 'xyz')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(bar.textContent).toContain('Không tìm thấy block nào')

    // Escape closes it again.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(bar.textContent).not.toContain('Không tìm thấy block nào')
  })

  it('shows the pinned fake-timer time in the clock chip', () => {
    const { container } = render(<MainWorkspace />, { fakeTimers: { now: T0 } })

    const label = container
      .querySelector('[aria-label^="Đồng hồ"]')
      ?.getAttribute('aria-label')

    // Derive the expected label from the same Date APIs the Clock uses, so the
    // assertion is timezone-independent.
    const d = new Date(T0)
    const pad = (n: number) => String(n).padStart(2, '0')
    expect(label).toBe(`Đồng hồ — ${pad(d.getHours())}:${pad(d.getMinutes())}`)
  })

  it('settings reminder toggle drives the digest reminder bell', () => {
    useBlocksStore.setState({
      blocks: [
        {
          id: 'evt-soon',
          type: 'event',
          title: 'Họp thiết kế',
          content: { type: 'doc', content: [] },
          start_time: new Date(T0 + 5 * 60_000).toISOString(),
          end_time: new Date(T0 + 35 * 60_000).toISOString(),
          recurrence: null,
          recurrence_exceptions: null,
          file_url: null,
          file_extension: null,
          owner_id: null,
        },
      ],
    })
    const { container } = render(<MainWorkspace />, { resetStores: false, fakeTimers: { now: T0 } })

    // Defaults (reminders on, 10-minute window): the digest bell is visible.
    expect(container.querySelector('[aria-label^="Nhắc:"]')).not.toBeNull()

    // Open settings and switch reminders off → the bell disappears immediately
    // (the digest reads the settings reactively).
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Mở cài đặt"]')!.click()
    })
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Bật/ tắt nhắc sự kiện"]',
    )
    expect(toggle).not.toBeNull()
    act(() => toggle!.click())
    expect(container.querySelector('[aria-label^="Nhắc:"]')).toBeNull()

    // Re-enable → the bell is back.
    act(() => toggle!.click())
    expect(container.querySelector('[aria-label^="Nhắc:"]')).not.toBeNull()
  })
})

describe('MainWorkspace .ics status flash (Bug 3 timer guard)', () => {
  const EMPTY_ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR'

  async function flash(container: HTMLElement, file: unknown): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input[accept=".ics,text/calendar"]')
    if (!input) throw new Error('no .ics file input rendered')
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('shows a flash message and auto-dismisses after 4 s', async () => {
    const { container } = render(<MainWorkspace />, { fakeTimers: { now: T0 } })
    await flash(container, { name: 'x.ics', text: vi.fn().mockRejectedValue(new Error('read')) })

    expect(container.textContent).toContain('Không đọc được tệp .ics')

    act(() => vi.advanceTimersByTime(4000))
    expect(container.textContent).not.toContain('Không đọc được tệp .ics')
  })

  it('a newer message resets the timer so the older one cannot erase it', async () => {
    const { container } = render(<MainWorkspace />, { fakeTimers: { now: T0 } })

    // A: unreadable file → "Không đọc được tệp .ics" (timer A at T+4000).
    await flash(container, { name: 'x.ics', text: vi.fn().mockRejectedValue(new Error('read')) })
    expect(container.textContent).toContain('Không đọc được tệp .ics')

    // B arrives shortly after with an empty calendar → newer message, timer B.
    act(() => vi.advanceTimersByTime(200))
    await flash(container, { name: 'y.ics', text: vi.fn().mockResolvedValue(EMPTY_ICS) })
    expect(container.textContent).toContain('Không thấy sự kiện nào trong tệp')
    expect(container.textContent).not.toContain('Không đọc được tệp .ics')

    // 3.9 s after B (t0+4100, already past A's t0+4000 deadline): B must still
    // be visible — A's timer was cleared on B, otherwise A's timeout would
    // have wiped the newer message.
    act(() => vi.advanceTimersByTime(3900))
    expect(container.textContent).toContain('Không thấy sự kiện nào trong tệp')

    // B's own timer still fires: another 200 ms dismisses it.
    act(() => vi.advanceTimersByTime(200))
    expect(container.textContent).not.toContain('Không thấy sự kiện nào trong tệp')
  })

  it('unmount clears the pending flash timer (advancing after unmount is a no-op)', async () => {
    const { container, unmount } = render(<MainWorkspace />, { fakeTimers: { now: T0 } })
    await flash(container, { name: 'x.ics', text: vi.fn().mockRejectedValue(new Error('read')) })
    expect(container.textContent).toContain('Không đọc được tệp .ics')

    act(() => unmount())
    // Would have called setIcsMsg(null) on an unmounted component if the
    // unmount cleanup had not cleared the timer.
    act(() => vi.advanceTimersByTime(5000))
  })
})
