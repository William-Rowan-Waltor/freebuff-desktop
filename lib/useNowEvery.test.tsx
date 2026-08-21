/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import { useNowEvery } from '@/lib/useNowEvery'

const T0 = Date.UTC(2026, 7, 13, 12, 0, 0) // 2026-08-13T12:00:00Z

function NowProbe({ interval }: { interval?: number }) {
  const now = useNowEvery(interval)
  return <div data-testid="now">{now.getTime()}</div>
}

function shown(container: HTMLElement): number {
  return Number(container.querySelector('[data-testid="now"]')!.textContent)
}

describe('useNowEvery', () => {
  it('starts at the pinned time and refreshes on the default 1-minute interval', () => {
    const { container } = render(<NowProbe />, { fakeTimers: { now: T0 } })

    expect(shown(container)).toBe(T0)

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(shown(container)).toBe(T0 + 60_000)

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(shown(container)).toBe(T0 + 120_000)
  })

  it('honors a custom interval and only fires on it', () => {
    const { container } = render(<NowProbe interval={5_000} />, { fakeTimers: { now: T0 } })

    // Before the first 5s tick nothing changes.
    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    expect(shown(container)).toBe(T0)

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(shown(container)).toBe(T0 + 5_000)
  })
})
