/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import TodayView from '@/components/today/TodayView'
import { useBlocksStore } from '@/store/useBlocksStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { dateLabel } from '@/lib/horizon'
import type { Block, BlockInput } from '@/types'

// Quick capture calls useBlocksStore.addBlock, which inserts via Supabase
// (lib/db/blocks). Swap createBlock for an in-memory stub that assigns an id,
// keeping every other export real.
vi.mock('@/lib/db/blocks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/blocks')>()
  return {
    ...real,
    createBlock: async (input: BlockInput): Promise<Block> => {
      return { id: 'captured-1', ...input } as Block
    },
  }
})

function at(daysFromNow: number, hours: number, minutes = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hours, minutes, 0, 0)
  return d.toISOString()
}

function baseBlock(overrides: Partial<Block> & { id: string }): Block {
  return {
    type: 'note',
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

function docWithTasks(checked: boolean[]): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: checked.map((isChecked) => ({
          type: 'taskItem',
          attrs: { checked: isChecked },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Việc' }] }],
        })),
      },
    ],
  }
}

// Polls inside act() until the predicate holds (real timers here).
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition')
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

describe('TodayView digest', () => {
  it('shows today’s events, overdue + today tasks, and hides other horizons', () => {
    useBlocksStore.setState({
      blocks: [
        // Starts now, ends in 2h — guaranteed "today" and not yet ended on any
        // day the suite runs (an absolute time like 14:00 would be hidden once
        // the real clock passes it).
        baseBlock({
          id: 'evt-today',
          type: 'event',
          title: 'Sự kiện chiều nay',
          start_time: new Date().toISOString(),
          end_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }),
        baseBlock({
          id: 'evt-future',
          type: 'event',
          title: 'Sự kiện tuần sau',
          start_time: at(14, 9),
          end_time: at(14, 10),
        }),
        baseBlock({
          id: 'note-overdue',
          title: 'Việc quá hạn',
          content: docWithTasks([false]),
          start_time: at(-1, 9),
        }),
        baseBlock({
          id: 'note-today',
          title: 'Việc hôm nay',
          content: docWithTasks([true, false]),
          start_time: at(0, 9),
        }),
      ],
    })

    const { container } = render(<TodayView />, { resetStores: false })

    expect(container.textContent).toContain('Sự kiện hôm nay')
    expect(container.textContent).toContain('Sự kiện chiều nay')
    expect(container.textContent).toContain('Việc cần làm')
    expect(container.textContent).toContain('Việc quá hạn')
    expect(container.textContent).toContain('Việc hôm nay')

    // Task chips reflect the checkbox counts (0/1 overdue, 1/2 today).
    expect(container.textContent).toContain('0/1')
    expect(container.textContent).toContain('1/2')

    // Blocks outside the overdue/today horizons are not part of the digest
    // sections. (The next-up banner may show the future event as its fallback
    // — that's covered by the banner tests — but the lists stay scoped.)
    for (const section of container.querySelectorAll('section')) {
      expect(section.textContent).not.toContain('Sự kiện tuần sau')
    }
  })

  it('captures a quick note on Enter and persists it as a block', async () => {
    const { container } = render(<TodayView />)

    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Ghi chú nhanh"]')
    expect(textarea).not.toBeNull()

    // Native setter so React's controlled textarea sees the change.
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, 'Mua sữa tươi\nvà bánh mì')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })

    // addBlock resolves through the mocked createBlock; poll the store.
    await waitFor(() => useBlocksStore.getState().blocks.some((b) => b.title === 'Mua sữa tươi'))

    const note = useBlocksStore.getState().blocks.find((b) => b.title === 'Mua sữa tươi')!
    expect(note.type).toBe('note')
    // Title comes from the first line; content keeps the full text.
    const doc = note.content as { content: { content: { text: string }[] }[] }
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0].content[0].text).toBe('Mua sữa tươi\nvà bánh mì')

    // Box clears and a confirmation flash appears.
    expect((textarea as HTMLTextAreaElement).value).toBe('')
    expect(container.textContent).toContain('Đã thêm ghi chú')
  })

  it('hides events that already ended but keeps live and upcoming ones', () => {
    const shift = (offsetHours: number) => new Date(Date.now() + offsetHours * 60 * 60 * 1000)
    const blocks: Block[] = [
      baseBlock({
        id: 'ended',
        type: 'event',
        title: 'Đã kết thúc',
        start_time: shift(-3).toISOString(),
        end_time: shift(-1).toISOString(),
      }),
      baseBlock({
        id: 'live',
        type: 'event',
        title: 'Đang diễn ra',
        start_time: shift(-1).toISOString(),
        end_time: shift(1).toISOString(),
      }),
    ]
    // An "upcoming" event must stay within today, so skip it near midnight.
    const withinToday = new Date().getHours() < 23
    if (withinToday) {
      blocks.push(
        baseBlock({
          id: 'upcoming',
          type: 'event',
          title: 'Sắp diễn ra',
          start_time: shift(1).toISOString(),
          end_time: shift(2).toISOString(),
        }),
      )
    }
    useBlocksStore.setState({ blocks })

    const { container } = render(<TodayView />, { resetStores: false })

    // The ended event is gone from the digest entirely; the live one stays
    // (it lands in the events section, or the tasks section if it started
    // before midnight).
    expect(container.textContent).not.toContain('Đã kết thúc')
    expect(container.textContent).toContain('Đang diễn ra')
    if (withinToday) {
      expect(container.textContent).toContain('Sắp diễn ra')
    }
  })

  it('keeps an ended all-day event in Việc cần làm but drops ended timed events', () => {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`
    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'all-day-yesterday',
          type: 'event',
          title: 'Hội thảo hôm qua',
          start_time: yStr,
          end_time: yStr,
        }),
        baseBlock({
          id: 'timed-ended',
          type: 'event',
          title: 'Họp đã xong',
          start_time: new Date(Date.now() - 3 * 3600_000).toISOString(),
          end_time: new Date(Date.now() - 2 * 3600_000).toISOString(),
        }),
      ],
    })
    const { container } = render(<TodayView />, { resetStores: false })

    // The ended all-day event (date-only shape, yesterday) surfaces as an
    // overdue task; the ended timed meeting is gone from the digest entirely.
    expect(container.textContent).toContain('Hội thảo hôm qua')
    expect(container.textContent).not.toContain('Họp đã xong')
  })

  it('shows a live countdown to the next upcoming event', () => {
    const T0 = Date.UTC(2026, 7, 13, 12, 0, 0)
    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'later',
          type: 'event',
          title: 'Họp cuối ngày',
          start_time: new Date(T0 + 3 * 60 * 60_000).toISOString(),
          end_time: new Date(T0 + 4 * 60 * 60_000).toISOString(),
        }),
        baseBlock({
          id: 'soon',
          type: 'event',
          title: 'Họp thiết kế',
          start_time: new Date(T0 + 25 * 60_000).toISOString(),
          end_time: new Date(T0 + 26 * 60_000).toISOString(),
        }),
      ],
    })
    const { container } = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })

    // The banner picks the earliest upcoming event and counts down from it.
    const banner = container.querySelector('[aria-label="Sự kiện tiếp theo"]')
    expect(banner?.textContent).toContain('Họp thiết kế')
    expect(banner?.textContent).not.toContain('Họp cuối ngày')
    expect(container.textContent).toContain('bắt đầu sau 25 phút')

    // One minute later the countdown ticks over.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(container.textContent).toContain('bắt đầu sau 24 phút')

    // Once the soon event starts, the banner moves to the next one.
    act(() => {
      vi.advanceTimersByTime(24 * 60_000)
    })
    const banner2 = container.querySelector('[aria-label="Sự kiện tiếp theo"]')
    expect(banner2?.textContent).toContain('Họp cuối ngày')
  })

  it('shows a clock time when the next event is an hour or more away', () => {
    const T0 = Date.UTC(2026, 7, 13, 12, 0, 0)
    const start = new Date(T0 + 2 * 60 * 60_000)
    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'far',
          type: 'event',
          title: 'Sự kiện tối',
          start_time: start.toISOString(),
          end_time: new Date(start.getTime() + 60_000).toISOString(),
        }),
      ],
    })
    const { container } = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })

    const pad2 = (n: number) => String(n).padStart(2, '0')
    expect(container.textContent).toContain(`bắt đầu lúc ${pad2(start.getHours())}:${pad2(start.getMinutes())}`)
  })

  it('prefers the chronologically next future item over a missed overdue one in the banner', () => {
    const future = baseBlock({
      id: 'future',
      type: 'event',
      title: 'Họp tuần sau',
      start_time: at(3, 10),
      end_time: at(3, 11),
    })
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'overdue', title: 'Báo cáo tuần', start_time: at(-1, 9) }), future],
    })
    const { container } = render(<TodayView />, { resetStores: false })

    // The chronologically next future event wins the banner (labelled with its
    // date); the missed overdue item stays in the list below.
    const banner = container.querySelector('[aria-label="Sự kiện tiếp theo"]')
    expect(banner?.textContent).toContain('Họp tuần sau')
    expect(banner?.textContent).toContain(dateLabel(future))
    expect(container.querySelector('[aria-label="Việc quá hạn"]')).toBeNull()
    expect(container.textContent).toContain('Báo cáo tuần')
  })

  it('still falls back to the most recently missed overdue item when nothing is upcoming', () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({ id: 'overdue-old', title: 'Việc cũ', start_time: at(-3, 9) }),
        baseBlock({ id: 'overdue-new', title: 'Việc mới quá hạn', start_time: at(-1, 9) }),
      ],
    })
    const { container } = render(<TodayView />, { resetStores: false })

    // No future-dated items exist, so the most recently missed one takes the
    // banner and is identified as overdue.
    const banner = container.querySelector('[aria-label="Việc quá hạn"]')
    expect(banner?.textContent).toContain('Việc mới quá hạn')
    expect(banner?.textContent).toContain('quá hạn')
    expect(container.querySelector('[aria-label="Sự kiện tiếp theo"]')).toBeNull()
  })

  it('falls back to the nearest future-dated item when nothing is due today', () => {
    const future = baseBlock({
      id: 'future',
      type: 'event',
      title: 'Họp tuần sau',
      start_time: at(3, 10),
      end_time: at(3, 11),
    })
    useBlocksStore.setState({ blocks: [future] })
    const { container } = render(<TodayView />, { resetStores: false })

    const banner = container.querySelector('[aria-label="Sự kiện tiếp theo"]')
    expect(banner?.textContent).toContain('Họp tuần sau')
    // Label is the item's compact date, computed the same way as the view.
    expect(banner?.textContent).toContain(dateLabel(future))
  })

  it('shows an empty state with the capture box when there is nothing due', () => {
    const { container } = render(<TodayView />)

    expect(container.textContent).toContain('Một ngày trống trải')
    expect(container.querySelector('[aria-label="Ghi chú nhanh"]')).not.toBeNull()
  })

  it('surfaces today’s occurrence of a recurring series and opens the master', () => {
    const T0 = Date.UTC(2026, 7, 13, 12, 0, 0)
    // Daily series whose first occurrence was yesterday; today's occurrence is
    // an hour out (not yet started, so it lands in "Sự kiện hôm nay").
    const masterStart = new Date(T0 - 23 * 3600_000)
    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'rec-master',
          type: 'event',
          title: 'Điểm danh hằng ngày',
          start_time: masterStart.toISOString(),
          end_time: new Date(masterStart.getTime() + 3600_000).toISOString(),
          recurrence: 'FREQ=DAILY',
          recurrence_exceptions: null,
        }),
      ],
    })
    const { container } = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })

    // The occurrence shows in the digest (not as a stale overdue master).
    const eventsSection = [...container.querySelectorAll('section')].find(
      (s) => s.querySelector('h2')?.textContent === 'Sự kiện hôm nay',
    )
    expect(eventsSection?.textContent).toContain('Điểm danh hằng ngày')
    const overdueSection = [...container.querySelectorAll('section')].find(
      (s) => s.querySelector('h2')?.textContent === 'Việc cần làm',
    )
    expect(overdueSection?.textContent).not.toContain('Điểm danh hằng ngày')

    // Clicking the row opens the MASTER block, never the virtual occurrence id.
    const row = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find((r) =>
      r.textContent?.includes('Điểm danh hằng ngày'),
    )
    expect(row).toBeDefined()
    act(() => row!.click())
    expect(useWorkspaceStore.getState().selectedBlockId).toBe('rec-master')
    expect(useWorkspaceStore.getState().activeRightPane).toBe('editor')
  })

  it('keeps a recurring series whose next occurrence is beyond today out of the digest', () => {
    const T0 = Date.UTC(2026, 7, 13, 12, 0, 0)
    // Weekly series: first occurrence 13 days ago, next one lands tomorrow.
    const masterStart = new Date(T0 - 13 * 24 * 3600_000 + 2 * 3600_000)
    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'rec-master',
          type: 'event',
          title: 'Họp định kỳ xa',
          start_time: masterStart.toISOString(),
          end_time: new Date(masterStart.getTime() + 3600_000).toISOString(),
          recurrence: 'FREQ=WEEKLY',
          recurrence_exceptions: null,
        }),
      ],
    })
    const { container } = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })

    // Not in any digest section. (The next-up banner may legitimately show it
    // as the nearest future item — assertions stay section-scoped.)
    for (const section of container.querySelectorAll('section')) {
      expect(section.textContent).not.toContain('Họp định kỳ xa')
    }
  })
})

describe('TodayView reminder bell', () => {
  const T0 = Date.UTC(2026, 7, 13, 12, 0, 0)
  const inMinutes = (mins: number) => new Date(T0 + mins * 60_000).toISOString()

  // Seed blocks + settings explicitly so resetStores: false renders see a
  // deterministic state (the helper only resets stores when resetStores: true).
  function seed(blocks: Block[]) {
    useBlocksStore.setState({ blocks })
    useSettingsStore.setState({ remindersEnabled: true, reminderMinutes: 10 })
  }

  it('shows a bell when a block starts within the reminder window', () => {
    seed([
      baseBlock({
        id: 'soon',
        type: 'event',
        title: 'Họp thiết kế',
        start_time: inMinutes(5),
        end_time: inMinutes(35),
      }),
    ])
    const { container } = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })

    const bell = container.querySelector('[aria-label^="Nhắc:"]')
    expect(bell).not.toBeNull()
    expect(bell!.textContent).toContain('Họp thiết kế')
    expect(bell!.textContent).toContain('5 phút')
    expect(bell!.getAttribute('aria-label')).toContain('bắt đầu sau 5 phút')
  })

  it('hides the bell when nothing qualifies within the window', () => {
    seed([
      baseBlock({
        id: 'far',
        type: 'event',
        title: 'Họp xa',
        start_time: inMinutes(30),
        end_time: inMinutes(60),
      }),
    ])
    const { container } = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })

    expect(container.querySelector('[aria-label^="Nhắc:"]')).toBeNull()
  })

  it('shows a bell for an upcoming recurring occurrence (not just the master)', () => {
    // Daily series whose master dtstart is already past; the next occurrence
    // lands 5 minutes out — the bell must surface the occurrence.
    seed([
      baseBlock({
        id: 'rec-1',
        type: 'event',
        title: 'Điểm danh',
        start_time: inMinutes(-24 * 60 + 5),
        end_time: inMinutes(-23 * 60 + 35),
        recurrence: 'FREQ=DAILY',
        recurrence_exceptions: null,
      }),
    ])
    const { container } = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })

    const bell = container.querySelector('[aria-label^="Nhắc:"]')
    expect(bell).not.toBeNull()
    expect(bell!.textContent).toContain('Điểm danh')
    expect(bell!.getAttribute('aria-label')).toContain('bắt đầu sau 5 phút')
  })

  it('hides the bell when reminders are disabled or the threshold is zero', () => {
    useBlocksStore.setState({
      blocks: [baseBlock({ id: 'soon', type: 'event', title: 'Họp thiết kế', start_time: inMinutes(5) })],
    })
    useSettingsStore.setState({ remindersEnabled: false, reminderMinutes: 10 })
    const first = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })
    expect(first.container.querySelector('[aria-label^="Nhắc:"]')).toBeNull()

    // Store updates after a render must land inside act() so the re-render they
    // trigger is flushed synchronously (no React act() warnings).
    act(() => {
      useSettingsStore.setState({ remindersEnabled: true, reminderMinutes: 0 })
    })
    const second = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })
    expect(second.container.querySelector('[aria-label^="Nhắc:"]')).toBeNull()
  })

  it('opens the block in the editor when the bell is clicked', () => {
    seed([
      baseBlock({
        id: 'soon',
        type: 'event',
        title: 'Họp thiết kế',
        start_time: inMinutes(5),
        end_time: inMinutes(35),
      }),
    ])
    const { container } = render(<TodayView />, { resetStores: false, fakeTimers: { now: T0 } })

    const bell = container.querySelector<HTMLButtonElement>('[aria-label^="Nhắc:"]')
    expect(bell).not.toBeNull()
    act(() => bell!.click())

    expect(useWorkspaceStore.getState().selectedBlockId).toBe('soon')
    expect(useWorkspaceStore.getState().activeRightPane).toBe('editor')
  })
})
