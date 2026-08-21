/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import MainWorkspace from '@/components/layout/MainWorkspace'
import { useBlocksStore } from '@/store/useBlocksStore'
import { buildRRuleString, occurrenceDates } from '@/lib/recurrence'
import { RRule } from 'rrule'
import type { Block, BlockInput, BlockRelation, RelationType } from '@/types'

// Unlike MainWorkspace.test.tsx, this file deliberately does NOT stub
// next/dynamic: CalendarView loads for real and FullCalendar mounts.
//
// The Hôm nay digest is the landing tab, so each test first clicks the Lịch
// tab to mount the calendar. dayGridMonth always shows the month that contains
// "today"; seeding the event on the 15th of the current month keeps it visible
// no matter which day the suite runs.

// The quick-note flow calls useBlocksStore.updateBlock, which hits Supabase via
// lib/db/blocks. Swap only that function for an in-memory merge so the note
// lands in the store without a network round-trip. vi.hoisted carries the
// seeded block into the (hoisted) mock factory without circular imports.
const h = vi.hoisted(() => {
  let current: unknown = null
  return {
    seed: (b: unknown) => {
      current = b
    },
    current: () => current,
  }
})

vi.mock('@/lib/db/blocks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/blocks')>()
  return {
    ...real,
    // In-memory create/update (no network): createBlock assigns a fixed id;
    // updateBlock merges into the current store row like the real PATCH +
    // select round-trip (falling back to the hoisted seed when absent).
    createBlock: async (input: BlockInput): Promise<Block> => ({ id: 'evt-new', ...input }) as Block,
    updateBlock: async (id: string, patch: Partial<Block>): Promise<Block> => {
      const { useBlocksStore: store } = await import('@/store/useBlocksStore')
      const current = store.getState().blocks.find((b) => b.id === id)
      const base = current ?? (h.current() as Block | null)
      return (base ? { ...base, ...patch } : { ...patch, id }) as Block
    },
    // The override flow links the new block to the master via attach →
    // createRelation; the store appends the returned relation itself, so an
    // in-memory stub is all that's needed.
    createRelation: async (
      parentId: string,
      childId: string,
      relationType: RelationType,
    ): Promise<BlockRelation> => ({ parent_id: parentId, child_id: childId, relation_type: relationType }),
    deleteBlock: vi.fn(async () => undefined),
    // Keep deletes on the proven hard-delete path in tests (no network probe).
    isSoftDeleteSupported: vi.fn(async () => false),
    // The trash restore/purge paths must not hit the network either.
    restoreBlock: vi.fn(async () => undefined),
    purgeBlock: vi.fn(async () => undefined),
  }
})

// The .ics import preview probes storage liveness for same-project URLs;
// tests keep the real upload/delete but stub the probe (foreign migration
// URLs -> null -> the file-block heuristic decides).
vi.mock('@/lib/db/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/storage')>()
  return {
    ...real,
    fileExists: vi.fn(async () => null),
  }
})

function eventOnDay15(): Block {
  const start = new Date()
  start.setDate(15)
  start.setHours(12, 0, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  return {
    id: 'evt-1',
    type: 'event',
    title: 'Sự kiện lịch A',
    content: { type: 'doc', content: [] },
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    recurrence: null,
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
  }
}

// The digest is the landing tab; switch to the calendar before waiting for it.
async function switchToTab(container: HTMLElement, label: string): Promise<void> {
  const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
  const tab = [...(nav?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label)
  expect(tab).toBeDefined()
  act(() => (tab as HTMLButtonElement).click())
}

// Polls inside act() until the predicate holds (real timers — flushes
// microtasks and the mocked db layer's async resolves).
async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
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

// Polls inside act() so the lazy next/dynamic import and FullCalendar's own
// post-mount rendering get flushed.
async function waitForText(container: HTMLElement, text: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(container.textContent ?? '').includes(text)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for "${text}"`)
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
}

// Click the ＋ button, wait for the date picker, and pick today's date.
// Returns after the event is created (repeat picker or editor may follow).
async function quickAddViaDatePicker(container: HTMLElement): Promise<void> {
  const addBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '＋')
  expect(addBtn).toBeDefined()
  act(() => addBtn!.click())
  // Wait for the mini date picker dialog to appear.
  await waitFor(() => container.querySelector('[aria-label="Chọn ngày tạo sự kiện"]') !== null)
  // Click today's date (highlighted with accent color).
  const todayBtn = container.querySelector('[aria-label="Chọn ngày tạo sự kiện"] button.bg-accent') as HTMLButtonElement | null
  if (todayBtn) {
    act(() => todayBtn.click())
  } else {
    // Fallback: click the first numeric button in the date picker.
    const dateBtns = [...(container.querySelector('[aria-label="Chọn ngày tạo sự kiện"]')?.querySelectorAll('button') ?? [])]
    const numericBtn = dateBtns.find((b) => /^\d{1,2}$/.test(b.textContent?.trim() ?? ''))
    expect(numericBtn).toBeDefined()
    act(() => numericBtn!.click())
  }
}

describe('MainWorkspace calendar tab (real FullCalendar)', () => {
  it('renders events from the blocks store in the month view', async () => {
    useBlocksStore.setState({ blocks: [eventOnDay15()] })

    // The helper's default store reset would wipe the seeded event, so opt out.
    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')

    // Wait until the lazy-loaded CalendarView resolves and FullCalendar paints
    // the seeded event, then assert both the shell and the event content.
    await waitForText(container, 'Sự kiện lịch A')

    const shell = container.querySelector('.fc-app-shell')
    expect(shell).not.toBeNull()
    expect(shell!.textContent).toContain('Sự kiện lịch A')

    // The calendar toolbar (vi locale) mounts alongside the grid.
    expect(shell!.textContent).toContain('Hôm nay')
  })

  it('opens the quick-note popover on event click, saves, and appends to the block', async () => {
    const block = eventOnDay15()
    useBlocksStore.setState({ blocks: [block] })
    h.seed(block)

    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitForText(container, 'Sự kiện lịch A')

    // FullCalendar's interaction layer listens for a bubbling click on the
    // event element. With the Monarch theme the event renders as a
    // role="button" element carrying the app's cursor-pointer class (from the
    // eventClass prop) — no .fc-event class in the DOM.
    const shell = container.querySelector('.fc-app-shell')
    const eventEl = shell!.querySelector('[role="button"].cursor-pointer')
    expect(eventEl).not.toBeNull()
    act(() => {
      eventEl!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    // The popover opens, anchored at the clicked event.
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute('aria-label')).toBe('Ghi chú cho Sự kiện lịch A')

    // Type the note. Use the native value setter so React's controlled
    // textarea tracking sees the change (same trick as the header test).
    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Ghi chú nhanh"]')
    expect(textarea).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(textarea, 'Ghi chú: họp lúc 14:00')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // Save via the button (saveNote -> onQuickNote -> mocked updateBlock).
    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Lưu ghi chú',
    )
    expect(save).toBeDefined()
    act(() => save!.click())

    // The note lands in the block's Tiptap content and the popover closes.
    await waitForStoreNote('evt-1', 'Ghi chú: họp lúc 14:00')
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    const updated = useBlocksStore.getState().blocks.find((b) => b.id === 'evt-1')!
    const doc = updated.content as { content: { content: { text: string }[] }[] }
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0].content[0].text).toBe('Ghi chú: họp lúc 14:00')
  })

  it('shows a conflict hint in the quick-note popover when the event overlaps others', async () => {
    const a = eventOnDay15()
    const b: Block = {
      ...eventOnDay15(),
      id: 'evt-2',
      title: 'Sự kiện lịch B',
      start_time: new Date(new Date(a.start_time!).getTime() + 30 * 60 * 1000).toISOString(),
      end_time: new Date(new Date(a.end_time!).getTime() + 60 * 60 * 1000).toISOString(),
    }
    useBlocksStore.setState({ blocks: [a, b] })

    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitForText(container, 'Sự kiện lịch A')

    const shell = container.querySelector('.fc-app-shell')
    const chips = [...(shell?.querySelectorAll('[role="button"].cursor-pointer') ?? [])]
    expect(chips.length).toBeGreaterThanOrEqual(2)
    const chipA = chips.find((el) => (el.textContent ?? '').includes('Sự kiện lịch A'))
    expect(chipA).toBeDefined()
    act(() => {
      chipA!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute('aria-label')).toBe('Ghi chú cho Sự kiện lịch A')
    expect(dialog!.textContent).toContain('Trùng lịch với 1 sự kiện')
  })

  it('renders a weekly recurring series and hides the overridden occurrence', async () => {
    // A weekly series anchored mid-month with UNTIL = end of the current month
    // (so it never spills into the visible overflow weeks of the grid), making
    // the expected occurrence count exact.
    const start = new Date()
    start.setDate(15)
    start.setHours(12, 0, 0, 0)
    const until = new Date(Date.UTC(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59))
    const recurrence = buildRRuleString({
      freq: RRule.WEEKLY,
      byweekday: [(start.getDay() + 6) % 7],
      until,
    })
    const master: Block = {
      id: 'rec-1',
      type: 'event',
      title: 'Chuỗi tuần',
      content: { type: 'doc', content: [] },
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      recurrence,
      recurrence_exceptions: null,
      file_url: null,
      file_extension: null,
      owner_id: null,
    }

    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1)
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59)
    const occurrences = occurrenceDates(master, monthStart, monthEnd)
    expect(occurrences.length).toBeGreaterThanOrEqual(2)

    // Exclude the second occurrence; a one-off override replaces it that day.
    const excepted = occurrences[1]
    master.recurrence_exceptions = [excepted.toISOString()]
    const override: Block = {
      id: 'rec-ovr',
      type: 'event',
      title: 'Chuỗi tuần (đổi)',
      content: { type: 'doc', content: [] },
      start_time: excepted.toISOString(),
      end_time: new Date(excepted.getTime() + 60 * 60 * 1000).toISOString(),
      recurrence: null,
      recurrence_exceptions: null,
      file_url: null,
      file_extension: null,
      owner_id: null,
    }

    useBlocksStore.setState({ blocks: [master, override] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitForText(container, 'Chuỗi tuần (đổi)')

    const shell = container.querySelector('.fc-app-shell')!

    // Every remaining occurrence renders as its own event button; the excepted
    // one is gone (override + exception hide exactly that occurrence).
    const seriesCount = [...shell.querySelectorAll('[role="button"]')].filter(
      (el) => el.textContent?.trim() === 'Chuỗi tuần',
    ).length
    expect(seriesCount).toBe(occurrences.length - 1)

    // The excepted day cell shows the override, not the series occurrence
    // (exact-text match — "Chuỗi tuần (đổi)" legitimately contains the prefix).
    const day = excepted.toISOString().slice(0, 10)
    const cell = shell.querySelector(`[data-date="${day}"]`)
    expect(cell).not.toBeNull()
    expect(cell!.textContent).toContain('Chuỗi tuần (đổi)')
    const seriesButtonsInCell = [...cell!.querySelectorAll('[role="button"]')].filter(
      (el) => el.textContent?.trim() === 'Chuỗi tuần',
    )
    expect(seriesButtonsInCell).toHaveLength(0)
  })

  it('quick-note on a recurring occurrence creates an override instead of editing the master', async () => {
    // Weekly series anchored mid-month with UNTIL = end of the current month.
    const start = new Date()
    start.setDate(15)
    start.setHours(12, 0, 0, 0)
    const until = new Date(Date.UTC(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59))
    const recurrence = buildRRuleString({
      freq: RRule.WEEKLY,
      byweekday: [(start.getDay() + 6) % 7],
      until,
    })
    const master: Block = {
      id: 'rec-qn',
      type: 'event',
      title: 'Họp nhóm',
      content: { type: 'doc', content: [] },
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      recurrence,
      recurrence_exceptions: null,
      file_url: null,
      file_extension: null,
      owner_id: null,
    }
    useBlocksStore.setState({ blocks: [master] })

    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1)
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59)
    const occurrences = occurrenceDates(master, monthStart, monthEnd)
    // The second occurrence — NOT the master's own slot.
    const target = occurrences[1]
    expect(target).toBeDefined()

    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitForText(container, 'Họp nhóm')

    // Click the occurrence in its day cell.
    const shell = container.querySelector('.fc-app-shell')!
    const cell = shell.querySelector(`[data-date="${target.toISOString().slice(0, 10)}"]`)
    expect(cell).not.toBeNull()
    const occurrenceBtn = [...cell!.querySelectorAll('[role="button"]')].find(
      (el) => el.textContent?.trim() === 'Họp nhóm',
    )
    expect(occurrenceBtn).toBeDefined()
    act(() => {
      occurrenceBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    // The popover flags this as a per-occurrence note.
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('Ghi chú riêng cho lần này')

    // Type the note and save.
    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Ghi chú nhanh"]')
    expect(textarea).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(textarea, 'Ghi chú cho lần họp này')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Lưu ghi chú')
    expect(save).toBeDefined()
    act(() => save!.click())

    // A new override block exists at the occurrence's times carrying the note.
    await waitFor(() =>
      useBlocksStore.getState().blocks.some(
        (b) =>
          b.id === 'evt-new' &&
          b.start_time === target.toISOString() &&
          JSON.stringify(b.content).includes('Ghi chú cho lần họp này'),
      ),
    )
    // The master got the exception for that occurrence…
    await waitFor(() =>
      (useBlocksStore.getState().blocks.find((b) => b.id === 'rec-qn')?.recurrence_exceptions ?? []).includes(
        target.toISOString(),
      ),
    )
    // …the relation links them…
    await waitFor(() =>
      useBlocksStore
        .getState()
        .relations.some((r) => r.parent_id === 'rec-qn' && r.child_id === 'evt-new' && r.relation_type === 'attached'),
    )
    // …and the master's shared content stays untouched.
    const masterAfter = useBlocksStore.getState().blocks.find((b) => b.id === 'rec-qn')!
    expect(JSON.stringify(masterAfter.content)).not.toContain('Ghi chú cho lần họp này')
  })

  it('quick-note on an ALL-DAY recurring occurrence creates a date-only override', async () => {
    // All-day weekly series anchored on the 15th of the current month (UTC
    // midnight = canonical all-day shape) with UNTIL = end of the month.
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15))
    const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59))
    const recurrence = buildRRuleString({
      freq: RRule.WEEKLY,
      byweekday: [(start.getUTCDay() + 6) % 7],
      until,
    })
    const master: Block = {
      id: 'rec-alday',
      type: 'event',
      title: 'Cả ngày chuỗi',
      content: { type: 'doc', content: [] },
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
      recurrence,
      recurrence_exceptions: null,
      file_url: null,
      file_extension: null,
      owner_id: null,
    }
    useBlocksStore.setState({ blocks: [master] })

    const occurrences = occurrenceDates(
      master,
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      until,
    )
    const target = occurrences[1]
    expect(target).toBeDefined()
    const targetDay = target.toISOString().slice(0, 10)

    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitForText(container, 'Cả ngày chuỗi')

    const shell = container.querySelector('.fc-app-shell')!
    const cell = shell.querySelector(`[data-date="${targetDay}"]`)
    expect(cell).not.toBeNull()
    const occurrenceBtn = [...cell!.querySelectorAll('[role="button"]')].find(
      (el) => el.textContent?.trim() === 'Cả ngày chuỗi',
    )
    expect(occurrenceBtn).toBeDefined()
    act(() => {
      occurrenceBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog!.textContent).toContain('Ghi chú riêng cho lần này')

    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Ghi chú nhanh"]')
    expect(textarea).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(textarea, 'Ghi chú cả ngày')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Lưu ghi chú')
    expect(save).toBeDefined()
    act(() => save!.click())

    // Date-only shapes end to end: the override's start AND the master's
    // exception are 'YYYY-MM-DD' (not a UTC-midnight instant) for an all-day
    // series, so the day hides exactly once.
    await waitFor(() =>
      useBlocksStore.getState().blocks.some(
        (b) =>
          b.id === 'evt-new' &&
          b.start_time === targetDay &&
          JSON.stringify(b.content).includes('Ghi chú cả ngày'),
      ),
    )
    await waitFor(() =>
      (useBlocksStore.getState().blocks.find((b) => b.id === 'rec-alday')?.recurrence_exceptions ?? []).includes(
        targetDay,
      ),
    )
    const exceptions = useBlocksStore.getState().blocks.find((b) => b.id === 'rec-alday')!
      .recurrence_exceptions!
    // No UTC-midnight instant got mixed into the all-day exception list.
    expect(exceptions.every((ex) => /^\d{4}-\d{2}-\d{2}$/.test(ex))).toBe(true)
  })

  it('deletes a plain event straight from the quick-note popover', async () => {
    const block = eventOnDay15()
    useBlocksStore.setState({ blocks: [block] })

    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitForText(container, 'Sự kiện lịch A')

    const shell = container.querySelector('.fc-app-shell')
    const eventEl = shell!.querySelector('[role="button"].cursor-pointer')
    expect(eventEl).not.toBeNull()
    act(() => {
      eventEl!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    // The popover's delete button removes the block with no this-vs-all modal.
    const del = container.querySelector<HTMLButtonElement>('[aria-label="Xóa sự kiện"]')
    expect(del).not.toBeNull()
    act(() => del!.click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await waitFor(() => !useBlocksStore.getState().blocks.some((b) => b.id === 'evt-1'))
  })

  it('delete on a recurring occurrence offers this-vs-all and excludes only that occurrence', async () => {
    const start = new Date()
    start.setDate(15)
    start.setHours(12, 0, 0, 0)
    const until = new Date(Date.UTC(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59))
    const recurrence = buildRRuleString({
      freq: RRule.WEEKLY,
      byweekday: [(start.getDay() + 6) % 7],
      until,
    })
    const master: Block = {
      id: 'rec-del',
      type: 'event',
      title: 'Họp chuỗi',
      content: { type: 'doc', content: [] },
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      recurrence,
      recurrence_exceptions: null,
      file_url: null,
      file_extension: null,
      owner_id: null,
    }
    useBlocksStore.setState({ blocks: [master] })

    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1)
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59)
    const occurrences = occurrenceDates(master, monthStart, monthEnd)
    const target = occurrences[1]
    expect(target).toBeDefined()

    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitForText(container, 'Họp chuỗi')

    // Click the second occurrence, then its delete button.
    const shell = container.querySelector('.fc-app-shell')!
    const cell = shell.querySelector(`[data-date="${target.toISOString().slice(0, 10)}"]`)
    expect(cell).not.toBeNull()
    const occurrenceBtn = [...cell!.querySelectorAll('[role="button"]')].find(
      (el) => el.textContent?.trim() === 'Họp chuỗi',
    )
    expect(occurrenceBtn).toBeDefined()
    act(() => {
      occurrenceBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Xóa sự kiện"]')!.click()
    })

    // The delete choice appears, not an immediate delete.
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog!.textContent).toContain('Xóa lần này')

    // "Xóa lần này" excludes exactly that occurrence; the master survives.
    const thisBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Xóa lần này',
    )
    expect(thisBtn).toBeDefined()
    act(() => thisBtn!.click())

    await waitFor(() =>
      (useBlocksStore.getState().blocks.find((b) => b.id === 'rec-del')?.recurrence_exceptions ?? []).includes(
        target.toISOString(),
      ),
    )
    expect(useBlocksStore.getState().blocks.some((b) => b.id === 'rec-del')).toBe(true)
  })

  it('delete "Tất cả các lần sau lần này" excludes every occurrence from the split onward', async () => {
    const start = new Date()
    start.setDate(15)
    start.setHours(12, 0, 0, 0)
    const until = new Date(Date.UTC(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59))
    const recurrence = buildRRuleString({
      freq: RRule.WEEKLY,
      byweekday: [(start.getDay() + 6) % 7],
      until,
    })
    const master: Block = {
      id: 'rec-taf',
      type: 'event',
      title: 'Chuỗi sau này',
      content: { type: 'doc', content: [] },
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      recurrence,
      recurrence_exceptions: null,
      file_url: null,
      file_extension: null,
      owner_id: null,
    }
    useBlocksStore.setState({ blocks: [master] })

    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1)
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59)
    const occurrences = occurrenceDates(master, monthStart, monthEnd)
    const target = occurrences[1]
    const before = occurrences[0]
    expect(target).toBeDefined()
    expect(before).toBeDefined()

    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitForText(container, 'Chuỗi sau này')

    // Click the second occurrence, then its delete button.
    const shell = container.querySelector('.fc-app-shell')!
    const cell = shell.querySelector(`[data-date="${target.toISOString().slice(0, 10)}"]`)
    expect(cell).not.toBeNull()
    const occurrenceBtn = [...cell!.querySelectorAll('[role="button"]')].find(
      (el) => el.textContent?.trim() === 'Chuỗi sau này',
    )
    expect(occurrenceBtn).toBeDefined()
    act(() => {
      occurrenceBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Xóa sự kiện"]')!.click()
    })

    // The delete choice gains the this-and-future variant which "Xóa lần này"
    // never shows.
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog!.textContent).toContain('Xóa tất cả các lần sau lần này')
    const tafBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Xóa tất cả các lần sau lần này',
    )
    expect(tafBtn).toBeDefined()
    act(() => tafBtn!.click())

    // The master survives with the split-from-then-on occurrences excluded…
    await waitFor(() =>
      (useBlocksStore.getState().blocks.find((b) => b.id === 'rec-taf')?.recurrence_exceptions ?? []).includes(
        target.toISOString(),
      ),
    )
    const exceptions =
      useBlocksStore.getState().blocks.find((b) => b.id === 'rec-taf')!.recurrence_exceptions!
    expect(exceptions).toContain(target.toISOString())
    // …while the occurrence before the split keeps rendering.
    expect(exceptions).not.toContain(before.toISOString())
  })

  it('shows an undo banner after deleting a plain event and restores it on "Hoàn tác"', async () => {
    const block = eventOnDay15()
    useBlocksStore.setState({ blocks: [block] })

    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitForText(container, 'Sự kiện lịch A')

    const shell = container.querySelector('.fc-app-shell')
    const eventEl = shell!.querySelector('[role="button"].cursor-pointer')
    expect(eventEl).not.toBeNull()
    act(() => {
      eventEl!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    // A previous test's delete may have left the banner's snapshot in the
    // store; clear it so the banner only appears after THIS delete.
    useBlocksStore.setState({ lastDelete: null })

    // Plain events delete straight from the quick-note popover.
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Xóa sự kiện"]')!.click()
    })

    // removeBlock resolves → the store drops the block and the banner shows.
    // (The banner text embeds the deleted title, so wait on the button.)
    await waitFor(() =>
      [...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Hoàn tác'),
    )
    expect(useBlocksStore.getState().blocks.some((b) => b.id === 'evt-1')).toBe(false)

    // "Hoàn tác" restores exactly the deleted block and hides the banner.
    const undo = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Hoàn tác')
    expect(undo).toBeDefined()
    act(() => undo!.click())
    await waitFor(() => useBlocksStore.getState().blocks.some((b) => b.id === 'evt-1'))
    expect(container.textContent).not.toContain('Đã xóa sự kiện')
  })

  it('quick-add offers a repeat picker and attaching a rule persists it', async () => {
    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')

    // Wait for the calendar toolbar (vi locale) so the '＋' button exists.
    await waitForText(container, 'Hôm nay')

    // '＋' opens the date picker; pick today to create the event.
    await quickAddViaDatePicker(container)

    // The inline repeat picker appears; pick 'Mỗi tuần'.
    await waitFor(() => container.textContent?.includes('Mỗi tuần') ?? false)
    const weekly = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Mỗi tuần')
    expect(weekly).toBeDefined()
    act(() => weekly!.click())

    // updateBlock resolves through the mocked db layer → the block carries the rule.
    await waitFor(() =>
      useBlocksStore.getState().blocks.some((b) => b.id === 'evt-new' && b.recurrence === 'FREQ=WEEKLY'),
    )

    // The calendar re-renders the block as recurring → the Repeat badge shows
    // and the picker closed.
    await waitFor(() => container.querySelector('[aria-label="Lặp lại"]') !== null)
    expect(container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')).toBeNull()
  })

  it('quick-add "Số lần" writes a COUNT rule through the count form', async () => {
    // Start from a clean store: the editor pane must not show a leftover
    // recurring block (its RecurrencePicker also contains the "Số lần" text,
    // which would make the popover waitFor match too early).
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    // Wait for the calendar toolbar's custom '＋' button itself (mounts with
    // the real FullCalendar toolbar, which can lag the header text).
    await waitFor(() => [...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === '＋'))

    // '＋' opens the date picker; pick today to create the event.
    await quickAddViaDatePicker(container)

    // Wait for the actual quick-add dialog to show its 'Số lần' grid button
    // (not the editor picker's "Số lần" option text).
    await waitFor(() => {
      const dialog = container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')
      return (
        dialog !== null &&
        [...dialog.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Số lần')
      )
    })

    // 'Số lần' swaps the preset grid for a freq + count form.
    const countBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Số lần')
    expect(countBtn).toBeDefined()
    act(() => countBtn!.click())
    const freq = container.querySelector('select[aria-label="Tần suất lặp lại"]') as HTMLSelectElement
    expect(freq).not.toBeNull()

    // Weekly × 4 shows a live preview (last occurrence date), then save.
    setSelectValue(freq, String(RRule.WEEKLY))
    setInputValue(container.querySelector('input[aria-label="Số lần lặp lại"]') as HTMLInputElement, '4')
    await waitFor(() => (container.textContent ?? '').includes('4 lần mỗi tuần · lần cuối'))
    const save = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Lưu')
    expect(save).toBeDefined()
    act(() => save!.click())

await waitFor(() =>
      useBlocksStore.getState().blocks.some((b) => b.id === 'evt-new' && b.recurrence === 'FREQ=WEEKLY;COUNT=4'),
    )
    expect(container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')).toBeNull()
  })

  it('quick-add writes an INTERVAL= rule through the count form interval field', async () => {
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitFor(() => [...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === '＋'))

    await quickAddViaDatePicker(container)

    await waitFor(() => {
      const dialog = container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')
      return (
        dialog !== null &&
        [...dialog.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Số lần')
      )
    })
    const countBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Số lần')
    act(() => countBtn!.click())

    // Interval defaults to 1 ("mỗi tuần"); bumping it to 2 yields "mỗi 2 tuần"
    // in the preview and an INTERVAL=2 rule on save.
    const freq = container.querySelector('select[aria-label="Tần suất lặp lại"]') as HTMLSelectElement
    setSelectValue(freq, String(RRule.WEEKLY))
    setInputValue(container.querySelector('input[aria-label="Khoảng lặp lại"]') as HTMLInputElement, '2')
    setInputValue(container.querySelector('input[aria-label="Số lần lặp lại"]') as HTMLInputElement, '4')
    await waitFor(() => (container.textContent ?? '').includes('4 lần mỗi 2 tuần · lần cuối'))
    const save = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Lưu')
    expect(save).toBeDefined()
    act(() => save!.click())

    await waitFor(() =>
      useBlocksStore
        .getState()
        .blocks.some((b) => b.id === 'evt-new' && b.recurrence === 'FREQ=WEEKLY;INTERVAL=2;COUNT=4'),
    )
  })

  it('quick-add "Mỗi ngày làm việc" persists a weekday-bounded daily rule', async () => {
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    await switchToTab(container, 'Lịch')
    await waitFor(() => [...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === '＋'))

    await quickAddViaDatePicker(container)

    // The preset grid shows the workdays preset next to the freq presets.
    await waitFor(() => {
      const dialog = container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')
      return (
        dialog !== null &&
        [...dialog.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Mỗi ngày làm việc')
      )
    })
    const workBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Mỗi ngày làm việc',
    )
    expect(workBtn).toBeDefined()
    act(() => workBtn!.click())

    // MO–FR (Monday=0 … Thursday=4) as a daily BYDAY rule.
    await waitFor(() =>
      useBlocksStore
        .getState()
        .blocks.some((b) => b.id === 'evt-new' && b.recurrence === 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'),
    )
    expect(container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')).toBeNull()
  })

  it('quick-add shows a one-time recurrence-unavailable notice instead of the repeat presets', async () => {
    useBlocksStore.setState({ blocks: [], relations: [], recurrenceUnavailable: true })
    try {
      localStorage.removeItem('recurrence-unavailable-dismissed')
      const { container } = render(<MainWorkspace />, { resetStores: false })
      await switchToTab(container, 'Lịch')
      await waitFor(() => [...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === '＋'))
      // First quick-add via date picker: opens the recurrence-unavailable notice.
      await quickAddViaDatePicker(container)
      await waitFor(() => {
        const dialog = container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')
        return dialog !== null && (container.textContent ?? '').includes('Lặp lại chưa khả dụng trên máy chủ này')
      })
      expect([...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Mỗi tuần')).toBe(false)

      // 'Đóng' dismisses it permanently — the next quick-add is silent.
      const closeBtn = [...(container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Đóng')
      expect(closeBtn).toBeDefined()
      act(() => closeBtn!.click())
      // The repeat popover is gone (the editor pane still shows the same
      // notice inside its RecurrencePicker — that is expected).
      expect(container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')).toBeNull()

      // Second quick-add: dismissal is remembered, no repeat popover.
      await quickAddViaDatePicker(container)
      // The created event opens in the editor pane, but no repeat popover
      // (the dismissal is remembered, so the next quick-add is silent).
      await waitFor(() => (container.textContent ?? '').includes('Sự kiện mới'))
      expect(container.querySelector('[aria-label="Chọn lặp lại sự kiện"]')).toBeNull()
    } finally {
      useBlocksStore.setState({ recurrenceUnavailable: false })
      try {
        localStorage.removeItem('recurrence-unavailable-dismissed')      } catch {
        // ignore storage failures
      }
    }
  })

  it('trash tab lists soft-deleted blocks and restores them back to the workspace', async () => {
    useBlocksStore.setState({
      blocks: [],
      relations: [],
      deletedBlocks: [
        { ...eventOnDay15(), title: 'Block đã xóa', deleted_at: '2026-08-10T00:00:00.000Z' },
      ],
    })

    const { container } = render(<MainWorkspace />, { resetStores: false })
    // The nav tab text includes the count badge ("Thùng rác1"), so match by prefix.
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const trashTab = [...(nav?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.trim().startsWith('Thùng rác'),
    )
    expect(trashTab).toBeDefined()
    act(() => (trashTab as HTMLButtonElement).click())
    await waitForText(container, 'Block đã xóa')

    // The trash view lists the tombstone with the 7-day auto-purge hint.
    expect(container.textContent).toContain('1 block trong thùng rác')

    // "Khôi phục" clears the tombstone and the block returns to the store.
    const restore = container.querySelector<HTMLButtonElement>(
      '[aria-label="Khôi phục Block đã xóa"]',
    )
    expect(restore).not.toBeNull()
    act(() => restore!.click())
    await waitFor(() => useBlocksStore.getState().blocks.some((b) => b.title === 'Block đã xóa'))
    expect(useBlocksStore.getState().deletedBlocks).toEqual([])
    await waitForText(container, 'Thùng rác trống')
  })

  it('trash tab permanently purges a tombstone after confirmation', async () => {
    useBlocksStore.setState({
      blocks: [],
      relations: [],
      deletedBlocks: [
        { ...eventOnDay15(), title: 'Block chờ xóa', deleted_at: '2026-08-10T00:00:00.000Z' },
      ],
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      const { container } = render(<MainWorkspace />, { resetStores: false })
      const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
      const trashTab = [...(nav?.querySelectorAll('button') ?? [])].find((b) =>
        b.textContent?.trim().startsWith('Thùng rác'),
      )
      expect(trashTab).toBeDefined()
      act(() => (trashTab as HTMLButtonElement).click())
      await waitForText(container, 'Block chờ xóa')

      const purge = container.querySelector<HTMLButtonElement>(
        '[aria-label="Xóa vĩnh viễn Block chờ xóa"]',
      )
      expect(purge).not.toBeNull()
      act(() => purge!.click())

      await waitFor(() => useBlocksStore.getState().deletedBlocks.length === 0)
      expect(useBlocksStore.getState().blocks).toEqual([])
      await waitForText(container, 'Thùng rác trống')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('batch-restores the whole trash selection and re-creates its relations', async () => {
    // A master + its this-occurrence override, both tombstoned, with the
    // dropped relation recorded in localStorage (as removeBlock would write).
    const master = { ...eventOnDay15(), id: 'del-master', title: 'Chuỗi đã xóa', deleted_at: '2026-08-10T00:00:00.000Z' }
    const override = { ...eventOnDay15(), id: 'del-ov', title: 'Lần đã xóa', deleted_at: '2026-08-10T00:00:00.000Z' }
    localStorage.setItem(
      'freebuff-trash-relations',
      JSON.stringify({
        'del-master': [{ parent_id: 'del-master', child_id: 'del-ov', relation_type: 'attached' }],
        'del-ov': [{ parent_id: 'del-master', child_id: 'del-ov', relation_type: 'attached' }],
      }),
    )
    useBlocksStore.setState({ blocks: [], relations: [], deletedBlocks: [master, override] })

    const { container } = render(<MainWorkspace />, { resetStores: false })
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const trashTab = [...(nav?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.trim().startsWith('Thùng rác'),
    )
    act(() => (trashTab as HTMLButtonElement).click())
    await waitForText(container, 'Chuỗi đã xóa')

    // Select all, then batch-restore.
    const selectAll = container.querySelector<HTMLInputElement>(
      '[aria-label="Chọn tất cả block đã xóa"]',
    )
    expect(selectAll).not.toBeNull()
    act(() => selectAll!.click())
    await waitForText(container, 'Đã chọn 2 block')
    const restoreAll = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Khôi phục đã chọn',
    )
    expect(restoreAll).toBeDefined()
    act(() => restoreAll!.click())

    // Both blocks return to the workspace and the dropped relation is rebuilt
    // (restoreTrashRelations fires once both endpoints are live).
    await waitFor(() => {
      const s = useBlocksStore.getState()
      return (
        s.deletedBlocks.length === 0 &&
        s.blocks.some((b) => b.id === 'del-master') &&
        s.blocks.some((b) => b.id === 'del-ov')
      )
    })
    await waitFor(() =>
      useBlocksStore
        .getState()
        .relations.some(
          (r) => r.parent_id === 'del-master' && r.child_id === 'del-ov' && r.relation_type === 'attached',
        ),
    )
    await waitForText(container, 'Thùng rác trống')
    localStorage.removeItem('freebuff-trash-relations')
  })

  it('batch-purges the whole trash selection after one confirmation', async () => {
    useBlocksStore.setState({
      blocks: [],
      relations: [],
      deletedBlocks: [
        { ...eventOnDay15(), id: 't1', title: 'Xóa nhanh 1', deleted_at: '2026-08-10T00:00:00.000Z' },
        { ...eventOnDay15(), id: 't2', title: 'Xóa nhanh 2', deleted_at: '2026-08-11T00:00:00.000Z' },
      ],
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      const { container } = render(<MainWorkspace />, { resetStores: false })
      const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
      const trashTab = [...(nav?.querySelectorAll('button') ?? [])].find((b) =>
        b.textContent?.trim().startsWith('Thùng rác'),
      )
      act(() => (trashTab as HTMLButtonElement).click())
      await waitForText(container, 'Xóa nhanh 1')

      const selectAll = container.querySelector<HTMLInputElement>(
        '[aria-label="Chọn tất cả block đã xóa"]',
      )
      act(() => selectAll!.click())
      await waitForText(container, 'Đã chọn 2 block')
      const purgeAll = [...container.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Xóa vĩnh viễn đã chọn',
      )
      expect(purgeAll).toBeDefined()
      act(() => purgeAll!.click())

      await waitFor(() => useBlocksStore.getState().deletedBlocks.length === 0)
      expect(useBlocksStore.getState().blocks).toEqual([])
      await waitForText(container, 'Thùng rác trống')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('trash search + type filter narrow the list and scope select-all to the matches', async () => {
    useBlocksStore.setState({
      blocks: [],
      relations: [],
      deletedBlocks: [
        { ...eventOnDay15(), id: 't-event', title: 'Họp cũ', deleted_at: '2026-08-10T00:00:00.000Z' },
        { ...eventOnDay15(), id: 't-note', title: 'Nháp cũ', type: 'note', deleted_at: '2026-08-11T00:00:00.000Z' },
      ],
    })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const trashTab = [...(nav?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.trim().startsWith('Thùng rác'),
    )
    act(() => (trashTab as HTMLButtonElement).click())
    await waitForText(container, 'Họp cũ')

    // Type search: only the matching tombstone stays visible.
    setInputValue(container.querySelector('[aria-label="Tìm block trong thùng rác"]') as HTMLInputElement, 'Họp')
    await waitFor(() => !(container.textContent ?? '').includes('Nháp cũ'))
    expect(container.textContent).toContain('Họp cũ')
    expect(container.textContent).not.toContain('Nháp cũ')

    // Select-all picks only the filtered row.
    act(() => container.querySelector<HTMLInputElement>('[aria-label="Chọn tất cả block đã xóa"]')!.click())
    await waitForText(container, 'Đã chọn 1 block')

    // Clear the query, then the type filter 'note' shows only the note row.
    setInputValue(container.querySelector('[aria-label="Tìm block trong thùng rác"]') as HTMLInputElement, '')
    setSelectValue(
      container.querySelector('[aria-label="Lọc theo loại block"]') as HTMLSelectElement,
      'note',
    )
    await waitFor(() => (container.textContent ?? '').includes('Nháp cũ'))
    expect(container.textContent).not.toContain('Họp cũ')

    // A query with no match shows the empty-filter state.
    setInputValue(container.querySelector('[aria-label="Tìm block trong thùng rác"]') as HTMLInputElement, 'khong-co')
    await waitForText(container, 'Không có kết quả phù hợp')
  })

  it('warns about restored blocks whose uploads were deleted and clears the dangling link', async () => {
    useBlocksStore.setState({
      blocks: [],
      relations: [],
      deletedBlocks: [
        {
          ...eventOnDay15(),
          id: 't-file',
          title: 'Có tệp',
          file_url: 'https://proj.supabase.co/storage/v1/object/public/files/user-1/t-file/a.png',
          file_extension: 'png',
          deleted_at: '2026-08-10T00:00:00.000Z',
        },
        { ...eventOnDay15(), id: 't-plain', title: 'Không tệp', deleted_at: '2026-08-11T00:00:00.000Z' },
      ],
    })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const trashTab = [...(nav?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.trim().startsWith('Thùng rác'),
    )
    act(() => (trashTab as HTMLButtonElement).click())
    await waitForText(container, 'Có tệp')

    // Restoring the block that owned an upload surfaces the dangling-file notice.
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Khôi phục Có tệp"]')!.click()
    })
    await waitFor(() => useBlocksStore.getState().blocks.some((b) => b.id === 't-file'))
    await waitForText(container, '1 block đã khôi phục vẫn trỏ tới tệp đã xóa')

    // The other restore keeps the notice silent (no upload).
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Khôi phục Không tệp"]')!.click()
    })
    await waitFor(() => useBlocksStore.getState().blocks.some((b) => b.id === 't-plain'))
    expect(container.textContent).toContain('1 block đã khôi phục vẫn trỏ tới tệp đã xóa')

    // "Gỡ liên kết tệp" clears the dangling reference through updateBlock.
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Gỡ liên kết tệp đã xóa"]')!.click()
    })
    await waitFor(() => !useBlocksStore.getState().blocks.find((b) => b.id === 't-file')?.file_url)
    expect(useBlocksStore.getState().blocks.find((b) => b.id === 't-file')?.file_extension).toBeNull()
    expect(container.textContent).not.toContain('block đã khôi phục vẫn trỏ tới tệp đã xóa')
  })

  it('imports an .ics through the confirm step, keeping a dangling file ref when the strip box is unchecked', async () => {
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })

    // An .ics exported by ANOTHER project: the event carries a file URL that
    // no file block in this workspace has (the migration scenario).
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:imp-1',
      'DTSTART:20260814T020000Z',
      'DTEND:20260814T030000Z',
      'SUMMARY:Sự kiện có tệp',
      'X-FREEBUFF-FILE:https://old.supabase.co/storage/v1/object/public/files/u1/imp-1/a.png',
      'X-FREEBUFF-FILE-EXT:png',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    const dispatchImport = () => {
      const input = container.querySelector<HTMLInputElement>(
        'input[type="file"][accept=".ics,text/calendar"]',
      )
      expect(input).not.toBeNull()
      act(() => {
        Object.defineProperty(input!, 'files', {
          value: [new File([ics], 'events.ics', { type: 'text/calendar' })],
          configurable: true,
        })
        input!.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }

    // Picking the file shows the confirm modal (nothing imported yet) with
    // the dangling reference listed and pre-checked to strip.
    dispatchImport()
    await waitForText(container, 'Tệp không có trong dự án này (1)')
    expect(container.querySelector('[role="dialog"][aria-label="Xác nhận nhập lịch"]')).not.toBeNull()
    expect(useBlocksStore.getState().blocks).toEqual([])

    // Uncheck the strip box to keep the reference on import.
    const stripBox = container.querySelector<HTMLInputElement>(
      '[aria-label="Gỡ liên kết tệp khi nhập: Sự kiện có tệp"]',
    )
    expect(stripBox).not.toBeNull()
    expect(stripBox!.checked).toBe(true)
    act(() => stripBox!.click())

    // Confirm — the event lands in the workspace WITH its file reference…
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Đồng ý nhập lịch"]')!.click()
    })
    await waitFor(() => useBlocksStore.getState().blocks.some((b) => b.id === 'evt-new'))
    expect(useBlocksStore.getState().blocks.find((b) => b.id === 'evt-new')?.file_url).toContain(
      'old.supabase.co',
    )
    expect(container.querySelector('[role="dialog"][aria-label="Xác nhận nhập lịch"]')).toBeNull()

    // …and the import surfaces the dangling-file notice with the same
    // Gỡ liên kết tệp action the restore path uses.
    await waitForText(container, '1 block nhập từ lịch trỏ tới tệp không có trong dự án này')
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Gỡ liên kết tệp đã xóa"]')!.click()
    })
    await waitFor(() => !useBlocksStore.getState().blocks.find((b) => b.id === 'evt-new')?.file_url)
    expect(useBlocksStore.getState().blocks.find((b) => b.id === 'evt-new')?.file_extension).toBeNull()
    expect(container.textContent).not.toContain('block nhập từ lịch trỏ tới tệp không có trong dự án này')
  })

  it('strips a dangling file reference by default on import (no notice afterwards)', async () => {
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:imp-2',
      'DTSTART:20260814T020000Z',
      'SUMMARY:Có tệp cũ',
      'X-FREEBUFF-FILE:https://old.supabase.co/storage/v1/object/public/files/u1/imp-2/a.png',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".ics,text/calendar"]',
    )
    act(() => {
      Object.defineProperty(input!, 'files', {
        value: [new File([ics], 'events.ics', { type: 'text/calendar' })],
        configurable: true,
      })
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitForText(container, 'Tệp không có trong dự án này (1)')

    // The strip box is checked by default — confirm without touching it.
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Đồng ý nhập lịch"]')!.click()
    })
    await waitFor(() => useBlocksStore.getState().blocks.some((b) => b.id === 'evt-new'))
    const block = useBlocksStore.getState().blocks.find((b) => b.id === 'evt-new')!
    expect(block.file_url).toBeNull()
    expect(block.file_extension).toBeNull()
    // No dangling notice — the reference was cleared upfront.
    expect(container.textContent).not.toContain('block nhập từ lịch trỏ tới tệp')
  })

  it('cancels the .ics import without creating anything', async () => {
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:imp-3',
      'DTSTART:20260814T020000Z',
      'SUMMARY:Sẽ hủy',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".ics,text/calendar"]',
    )
    act(() => {
      Object.defineProperty(input!, 'files', {
        value: [new File([ics], 'events.ics', { type: 'text/calendar' })],
        configurable: true,
      })
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitForText(container, 'Nhập 1 sự kiện từ tệp')

    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Hủy nhập lịch"]')!.click()
    })
    await waitFor(() => container.querySelector('[role="dialog"][aria-label="Xác nhận nhập lịch"]') === null)
    expect(useBlocksStore.getState().blocks).toEqual([])
  })

  it('checklist rows are individually selectable — unchecking one excludes it from the import', async () => {
    localStorage.removeItem('freebuff-ics-history')
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:keep-1',
      'DTSTART:20260814T020000Z',
      'SUMMARY:Giữ lại',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:skip-1',
      'DTSTART:20260815T020000Z',
      'SUMMARY:Bỏ qua',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".ics,text/calendar"]',
    )
    act(() => {
      Object.defineProperty(input!, 'files', {
        value: [new File([ics], 'two-events.ics', { type: 'text/calendar' })],
        configurable: true,
      })
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitForText(container, 'Nhập 2 sự kiện từ tệp two-events.ics')

    // Every row carries an include checkbox; unchecking "Bỏ qua" drops it
    // from the import and the confirm label updates to the selection.
    const skipBox = container.querySelector<HTMLInputElement>('[aria-label="Nhập sự kiện: Bỏ qua"]')
    expect(skipBox).not.toBeNull()
    expect(skipBox!.checked).toBe(true)
    act(() => skipBox!.click())
    await waitForText(container, 'Nhập 1 sự kiện')
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Đồng ý nhập lịch"]')!.disabled).toBe(false)

    // Confirm: only the kept event lands (the mocked createBlock ids collapse
    // to 'evt-new', so the store's block count is the real signal).
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Đồng ý nhập lịch"]')!.click()
    })
    await waitFor(() => useBlocksStore.getState().blocks.length === 1)
    expect(useBlocksStore.getState().blocks[0].title).toBe('Giữ lại')
  })

  it('role quick filters bulk-select every event of a series role, and Chọn tất cả restores them', async () => {
    localStorage.removeItem('freebuff-ics-history')
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    // Two standalone one-offs — the 'Sự kiện riêng' chip covers both.
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:r1',
      'DTSTART:20260814T020000Z',
      'SUMMARY:Việc 1',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:r2',
      'DTSTART:20260815T020000Z',
      'SUMMARY:Việc 2',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".ics,text/calendar"]',
    )
    act(() => {
      Object.defineProperty(input!, 'files', {
        value: [new File([ics], 'roles.ics', { type: 'text/calendar' })],
        configurable: true,
      })
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitForText(container, 'Nhập 2 sự kiện từ tệp roles.ics')

    // The role chip shows its count and is active (both rows selected)…
    const roleChip = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().startsWith('Sự kiện riêng'),
    )
    expect(roleChip).toBeDefined()
    expect(roleChip!.textContent).toContain('2')
    expect(roleChip!.getAttribute('aria-pressed')).toBe('true')
    // …clicking it deselects the whole role at once…
    act(() => roleChip!.click())
    await waitForText(container, 'Nhập 0 sự kiện từ tệp roles.ics')
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Đồng ý nhập lịch"]')!.disabled).toBe(true)
    // …and 'Chọn tất cả' brings every row back.
    act(() => {
      container.querySelector<HTMLInputElement>('[aria-label="Chọn tất cả sự kiện trong lần nhập"]')!.click()
    })
    await waitForText(container, 'Nhập 2 sự kiện từ tệp roles.ics')
    const chipAfter = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().startsWith('Sự kiện riêng'),
    )
    expect(chipAfter?.getAttribute('aria-pressed')).toBe('true')
  })

  it('a group name prefixes the imported events and labels the history record', async () => {
    localStorage.removeItem('freebuff-ics-history')
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:g1',
      'DTSTART:20260814T020000Z',
      'SUMMARY:Họp nhóm',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:g2',
      'DTSTART:20260815T020000Z',
      'SUMMARY:Trả lời email',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".ics,text/calendar"]',
    )
    act(() => {
      Object.defineProperty(input!, 'files', {
        value: [new File([ics], 'batch.ics', { type: 'text/calendar' })],
        configurable: true,
      })
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitForText(container, 'Nhập 2 sự kiện từ tệp batch.ics')

    // Name the batch: the imported events get the prefix, the record shows it.
    setInputValue(
      container.querySelector<HTMLInputElement>('[aria-label="Tên nhóm cho lần nhập"]')!,
      'Lịch công việc',
    )
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Đồng ý nhập lịch"]')!.click()
    })
    await waitFor(() => useBlocksStore.getState().blocks.length === 2)
    const titles = useBlocksStore.getState().blocks.map((b) => b.title)
    expect(titles).toEqual(['Lịch công việc · Họp nhóm', 'Lịch công việc · Trả lời email'])

    // The Đã nhập tab shows the group name with the source file underneath.
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const importedTab = [...(nav?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === 'Đã nhập',
    )
    act(() => (importedTab as HTMLButtonElement).click())
    await waitForText(container, 'Lịch công việc')
    expect(container.textContent).toContain('Tệp: batch.ics')
  })

  it('Đã nhập rows show which blocks survive (Còn đủ / Còn x/y / Đã xóa hết)', async () => {
    localStorage.setItem(
      'freebuff-ics-history',
      JSON.stringify([
        {
          id: 'rec-full',
          fileName: 'full.ics',
          createdAt: '2026-08-09T08:00:00.000Z',
          created: 1,
          overrides: 0,
          continuations: 0,
          blockIds: ['alive-1'],
        },
        {
          id: 'rec-part',
          fileName: 'partial.ics',
          createdAt: '2026-08-10T08:00:00.000Z',
          created: 2,
          overrides: 0,
          continuations: 0,
          blockIds: ['alive-2', 'gone-1'],
        },
        {
          id: 'rec-gone',
          fileName: 'gone.ics',
          createdAt: '2026-08-11T08:00:00.000Z',
          created: 1,
          overrides: 0,
          continuations: 0,
          blockIds: ['gone-2'],
        },
      ]),
    )
    useBlocksStore.setState({
      blocks: [
        { ...eventOnDay15(), id: 'alive-1', title: 'Còn sống 1' },
        { ...eventOnDay15(), id: 'alive-2', title: 'Còn sống 2' },
      ],
      relations: [],
    })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const importedTab = [...(nav?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === 'Đã nhập',
    )
    act(() => (importedTab as HTMLButtonElement).click())
    await waitForText(container, 'full.ics')

    expect(container.textContent).toContain('Còn đủ')
    expect(container.textContent).toContain('Còn 1/2')
    expect(container.textContent).toContain('Đã xóa hết')
    // The undo affordance is still offered only for the newest record (the
    // first in the list: full.ics), not the older ones.
    const undo = container.querySelector<HTMLButtonElement>('[aria-label="Hoàn tác lần nhập full.ics"]')
    expect(undo).not.toBeNull()
    expect(container.querySelector('[aria-label="Hoàn tác lần nhập gone.ics"]')).toBeNull()
  })

  it('Đã nhập tab lists the import (counts, file, timestamp) and undoes the last one wholesale', async () => {
    localStorage.removeItem('freebuff-ics-history')
    useBlocksStore.setState({ blocks: [], relations: [] })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:keep-2',
      'DTSTART:20260814T020000Z',
      'SUMMARY:Sự kiện nhập',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".ics,text/calendar"]',
    )
    act(() => {
      Object.defineProperty(input!, 'files', {
        value: [new File([ics], 'lich-hoc.ics', { type: 'text/calendar' })],
        configurable: true,
      })
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitForText(container, 'Nhập 1 sự kiện từ tệp lich-hoc.ics')
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Đồng ý nhập lịch"]')!.click()
    })
    await waitFor(() => useBlocksStore.getState().blocks.length === 1)

    // The Đã nhập tab lists the import: file name, counts, timestamp.
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const importedTab = [...(nav?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent?.trim() === 'Đã nhập',
    )
    expect(importedTab).toBeDefined()
    act(() => (importedTab as HTMLButtonElement).click())
    await waitForText(container, 'lich-hoc.ics')
    expect(container.textContent).toContain('1 sự kiện')
    expect(container.textContent).toContain('1 lần nhập .ics')
    // The record's only block is still in the workspace — badge says Còn đủ.
    expect(container.textContent).toContain('Còn đủ')

    // "Xuất .ics" re-generates the file from the surviving blocks: the click
    // reaches downloadIcs's anchor (jsdom lacks createObjectURL, so stub it).
    const originalUrl = globalThis.URL
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      ;(globalThis.URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock')
      ;(globalThis.URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn()
      act(() => {
        container.querySelector<HTMLButtonElement>('[aria-label="Xuất lại lich-hoc.ics"]')!.click()
      })
      expect(clickSpy).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.URL = originalUrl
      clickSpy.mockRestore()
    }

    // Undo the last import wholesale (with confirmation) — the block is gone
    // and the record leaves the history.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      act(() => {
        container.querySelector<HTMLButtonElement>('[aria-label="Hoàn tác lần nhập lich-hoc.ics"]')!.click()
      })
      await waitFor(() => useBlocksStore.getState().blocks.length === 0)
      await waitForText(container, 'Chưa có lần nhập nào')
      expect(JSON.parse(localStorage.getItem('freebuff-ics-history') ?? '[]')).toEqual([])
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('paginates the trash list and keeps select-all scoped to the filtered rows', async () => {
    const tombstones = Array.from({ length: 25 }, (_, i) => ({
      ...eventOnDay15(),
      id: `page-${i}`,
      title: `Tomb ${String(i).padStart(2, '0')}`,
      deleted_at: new Date(Date.now() - i * 86_400_000).toISOString(),
    }))
    useBlocksStore.setState({ blocks: [], relations: [], deletedBlocks: tombstones })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const trashTab = [...(nav?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.trim().startsWith('Thùng rác'),
    )
    act(() => (trashTab as HTMLButtonElement).click())
    await waitForText(container, 'Tomb 00')

    const rowTitles = () =>
      [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label^="Chọn Tomb "]')]
        .map((c) => c.getAttribute('aria-label')!.replace(/^Chọn /, ''))

    // Page 1: newest 20 of 25, with the pager visible.
    await waitFor(() => rowTitles().length === 20)
    expect(rowTitles()[0]).toBe('Tomb 00')
    expect(container.textContent).toContain('Trang 1 / 2')

    // Next page: the remaining 5.
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Trang sau"]')!.click()
    })
    await waitFor(() => rowTitles().length === 5)
    expect(container.textContent).toContain('Trang 2 / 2')
    expect(rowTitles()[0]).toBe('Tomb 20')

    // Back to page 1.
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Trang trước"]')!.click()
    })
    await waitFor(() => rowTitles().length === 20)
    expect(container.textContent).toContain('Trang 1 / 2')
  })

  it('trash rows show the deleted-at date and the time left until auto-purge', async () => {
    // Tombstoned 2.5 days ago → ~4.5 days left of the 7-day window. The
    // half-day margin keeps the floor() bucket stable even though a few
    // seconds elapse between seeding the store and the component rendering
    // (any exact-day anchor would drop a day on the floor).
    const deletedAt = new Date(Date.now() - 2.5 * 86_400_000).toISOString()
    useBlocksStore.setState({
      blocks: [],
      relations: [],
      deletedBlocks: [{ ...eventOnDay15(), id: 't-date', title: 'Có ngày xóa', deleted_at: deletedAt }],
    })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const trashTab = [...(nav?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.trim().startsWith('Thùng rác'),
    )
    act(() => (trashTab as HTMLButtonElement).click())
    await waitForText(container, 'Có ngày xóa')

    const d = new Date(deletedAt)
    const p = (n: number) => String(n).padStart(2, '0')
    expect(container.textContent).toContain(
      `Đã xóa ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
    )
    expect(container.textContent).toContain('còn 4 ngày nữa')
  })

  it('sorts the trash list by deleted date or type from the filter row', async () => {
    useBlocksStore.setState({
      blocks: [],
      relations: [],
      deletedBlocks: [
        { ...eventOnDay15(), id: 's-n1', title: 'Ghi chú mới', type: 'note', deleted_at: '2026-08-12T00:00:00.000Z' },
        { ...eventOnDay15(), id: 's-e1', title: 'Sự kiện cũ', deleted_at: '2026-08-10T00:00:00.000Z' },
        { ...eventOnDay15(), id: 's-n2', title: 'Ghi chú cũ', type: 'note', deleted_at: '2026-08-11T00:00:00.000Z' },
      ],
    })
    const { container } = render(<MainWorkspace />, { resetStores: false })
    const nav = container.querySelector('nav[aria-label="Khu vực chính"]')
    const trashTab = [...(nav?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.trim().startsWith('Thùng rác'),
    )
    act(() => (trashTab as HTMLButtonElement).click())
    await waitForText(container, 'Ghi chú mới')

    // Row titles in DOM order, derived from each row's checkbox aria-label.
    const rowTitles = () =>
      [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label^="Chọn "]')]
        .map((c) => c.getAttribute('aria-label')!.replace(/^Chọn /, ''))
        .filter((t) => t !== 'tất cả block đã xóa')

    // Default: newest deleted first.
    expect(rowTitles()).toEqual(['Ghi chú mới', 'Ghi chú cũ', 'Sự kiện cũ'])

    // Oldest first.
    setSelectValue(
      container.querySelector('[aria-label="Sắp xếp thùng rác"]') as HTMLSelectElement,
      'deleted-asc',
    )
    await waitFor(() => rowTitles()[0] === 'Sự kiện cũ')
    expect(rowTitles()).toEqual(['Sự kiện cũ', 'Ghi chú cũ', 'Ghi chú mới'])

    // By type: events first, then notes (newest-first within the group).
    setSelectValue(
      container.querySelector('[aria-label="Sắp xếp thùng rác"]') as HTMLSelectElement,
      'type',
    )
    await waitFor(() => rowTitles()[0] === 'Sự kiện cũ' && rowTitles()[1] === 'Ghi chú mới')
    expect(rowTitles()).toEqual(['Sự kiện cũ', 'Ghi chú mới', 'Ghi chú cũ'])
  })
})

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// Polls the blocks store until the note text shows up in the block's content
// (the mocked updateBlock resolves asynchronously, so flush microtasks+timers).
async function waitForStoreNote(id: string, text: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const block = useBlocksStore.getState().blocks.find((b) => b.id === id)
    if (JSON.stringify(block?.content ?? '').includes(text)) return
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for store note "${text}" on ${id}`)
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}
