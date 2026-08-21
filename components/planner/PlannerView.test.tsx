/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import PlannerView from '@/components/planner/PlannerView'
import { useBlocksStore } from '@/store/useBlocksStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type { Block, BlockInput } from '@/types'

// In-memory stubs so create/update/delete work without Supabase (like TodayView.test).
vi.mock('@/lib/db/blocks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/blocks')>()
  return {
    ...real,
    createBlock: async (input: BlockInput): Promise<Block> => {
      return { id: 'created-1', ...input } as Block
    },
    // In-memory PATCH + select round-trip: merge into the current store row.
    updateBlock: async (id: string, patch: Partial<Block>): Promise<Block> => {
      const { useBlocksStore: store } = await import('@/store/useBlocksStore')
      const current = store.getState().blocks.find((b) => b.id === id)
      return (current ? { ...current, ...patch } : { ...patch, id }) as Block
    },
    deleteBlock: vi.fn(async () => undefined),
    // Keep deletes on the proven hard-delete path in tests (no network probe).
    isSoftDeleteSupported: vi.fn(async () => false),
  }
})

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

function sectionByTitle(container: HTMLElement, title: string): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>('section')].find(
      (s) => s.querySelector('h2')?.textContent === title,
    ) ?? null
  )
}

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

describe('PlannerView', () => {
  it('buckets a recurring series by its today occurrence and opens the master', () => {
    const T0 = Date.UTC(2026, 7, 13, 12, 0, 0)
    // Daily series with a past dtstart: today's occurrence belongs in Hôm nay,
    // not Quá hạn.
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
    const { container } = render(<PlannerView />, { resetStores: false, fakeTimers: { now: T0 } })

    expect(sectionByTitle(container, 'Hôm nay')?.textContent).toContain('Điểm danh hằng ngày')
    expect(sectionByTitle(container, 'Quá hạn')?.textContent).not.toContain('Điểm danh hằng ngày')

    // Clicking the occurrence row opens the MASTER block, not a virtual id.
    const row = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find((r) =>
      r.textContent?.includes('Điểm danh hằng ngày'),
    )
    expect(row).toBeDefined()
    act(() => row!.click())
    expect(useWorkspaceStore.getState().selectedBlockId).toBe('rec-master')
    expect(useWorkspaceStore.getState().activeRightPane).toBe('editor')
  })

  it('shows an occurrence landing this week in Tuần này, not the past-dtstart master', () => {
    const T0 = Date.UTC(2026, 7, 13, 12, 0, 0)
    // This week's Friday at 09:00 local (always after Thursday noon UTC, so
    // TZ-independent), and the same weekday one week earlier as the master
    // dtstart — a series whose NEXT occurrence is this week.
    const now = new Date(T0)
    const fri = new Date(now)
    fri.setHours(0, 0, 0, 0)
    const dow = (fri.getDay() + 6) % 7 // Mon = 0
    fri.setDate(fri.getDate() - dow + 4)
    fri.setHours(9, 0, 0, 0)
    const masterStart = new Date(fri)
    masterStart.setDate(masterStart.getDate() - 7)

    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'rec-weekly',
          type: 'event',
          title: 'Họp cuối tuần',
          start_time: masterStart.toISOString(),
          end_time: new Date(masterStart.getTime() + 3600_000).toISOString(),
          recurrence: 'FREQ=WEEKLY',
          recurrence_exceptions: null,
        }),
      ],
    })
    const { container } = render(<PlannerView />, { resetStores: false, fakeTimers: { now: T0 } })

    // The occurrence inside this week shows up in Tuần này even though the
    // master's own dtstart is last week.
    expect(sectionByTitle(container, 'Tuần này')?.textContent).toContain('Họp cuối tuần')
    // And the past dtstart alone never drags the series into Quá hạn.
    expect(sectionByTitle(container, 'Quá hạn')?.textContent).not.toContain('Họp cuối tuần')
  })

  it('never places a recurring series into Quá hạn from its past dtstart', () => {
    const T0 = Date.UTC(2026, 7, 13, 12, 0, 0)
    // Weekly series starting 8 days ago; only future occurrences are expanded,
    // so nothing of it belongs in Quá hạn.
    const masterStart = new Date(T0 - 8 * 24 * 3600_000 + 2 * 3600_000)
    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'rec-master',
          type: 'event',
          title: 'Họp định kỳ',
          start_time: masterStart.toISOString(),
          end_time: new Date(masterStart.getTime() + 3600_000).toISOString(),
          recurrence: 'FREQ=WEEKLY',
          recurrence_exceptions: null,
        }),
      ],
    })
    const { container } = render(<PlannerView />, { resetStores: false, fakeTimers: { now: T0 } })

    expect(sectionByTitle(container, 'Quá hạn')?.textContent).not.toContain('Họp định kỳ')
  })

  it('deletes the master block when the occurrence row delete is confirmed as "all"', async () => {
    const masterStart = new Date(Date.now() - 23 * 3600_000)
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
    const { container } = render(<PlannerView />, { resetStores: false })

    // Deleting an occurrence row never removes the master silently — the
    // this-vs-all choice must appear first.
    const del = container.querySelector<HTMLButtonElement>('[aria-label^="Xóa"]')
    expect(del).not.toBeNull()
    act(() => del!.click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    // "Xóa tất cả các lần" removes the master.
    const allBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Xóa tất cả các lần',
    )
    expect(allBtn).toBeDefined()
    act(() => allBtn!.click())

    await waitFor(() => !useBlocksStore.getState().blocks.some((b) => b.id === 'rec-master'))
  })

  it('excludes only the deleted occurrence on "Xóa lần này" and keeps the master', async () => {
    // Daily series whose today occurrence is today at 23:00 local (real timers
    // — the async store update is polled with waitFor, which needs setTimeout).
    // dtstart = yesterday 23:00 local, so the series' today occurrence is at
    // +24h (today 23:00 local) in ANY timezone and at ANY wall-clock time — a
    // Date.now()-relative seed would break after 23:00 (the dtstart would land
    // on the same day and become the first "today" row).
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0))
    const masterStart = new Date(startOfToday.getTime() - 3600_000)
    const expectedException = new Date(masterStart.getTime() + 24 * 3600_000).toISOString()
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
    const { container } = render(<PlannerView />, { resetStores: false })

    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Xóa"]')!.click())
    const thisBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Xóa lần này',
    )
    expect(thisBtn).toBeDefined()
    act(() => thisBtn!.click())

    // The master stays and the occurrence is excluded (ISO instant for timed).
    await waitFor(() =>
      (useBlocksStore.getState().blocks.find((b) => b.id === 'rec-master')?.recurrence_exceptions ?? []).includes(
        expectedException,
      ),
    )
    expect(useBlocksStore.getState().blocks.some((b) => b.id === 'rec-master')).toBe(true)
  })

  it('deletes a plain (non-recurring) row directly with no choice modal', async () => {
    useBlocksStore.setState({
      blocks: [
        baseBlock({
          id: 'plain',
          type: 'event',
          title: 'Họp một lần',
          start_time: new Date(Date.now() + 3600_000).toISOString(),
          end_time: new Date(Date.now() + 2 * 3600_000).toISOString(),
        }),
      ],
    })
    const { container } = render(<PlannerView />, { resetStores: false })

    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Xóa"]')!.click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await waitFor(() => !useBlocksStore.getState().blocks.some((b) => b.id === 'plain'))
  })
})
