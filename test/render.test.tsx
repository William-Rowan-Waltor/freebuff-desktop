/** @vitest-environment jsdom */
import { act, useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render } from './render'
import { useTimerStore } from '@/store/useTimerStore'
import { useThemeStore } from '@/store/useThemeStore'

const T0 = Date.UTC(2026, 7, 13, 12, 0, 0) // 2026-08-13T12:00:00Z

// Re-renders on a 1s interval, recording Date.now() so tests can see both the
// faked clock and the faked interval firing.
function TickProbe() {
  const [tick, setTick] = useState<number | null>(null)
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return <span data-testid="tick">{tick ?? 'idle'}</span>
}

function StoreProbe() {
  const kind = useTimerStore((s) => s.kind)
  const theme = useThemeStore((s) => s.theme)
  return (
    <span data-testid="store">
      {kind ?? 'none'}:{theme}
    </span>
  )
}

describe('render helper', () => {
  it('mounts the tree into a container on document.body', () => {
    const { container } = render(<span data-testid="ui">nội dung</span>)
    expect(container.querySelector('[data-testid="ui"]')?.textContent).toBe('nội dung')
    expect(document.body.contains(container)).toBe(true)
  })

  it('appends a wrapper around the rendered tree', () => {
    const { container } = render(<span data-testid="ui">nội dung</span>, {
      wrapper: ({ children }) => <section data-testid="wrap">{children}</section>,
    })
    const wrap = container.querySelector('[data-testid="wrap"]')
    expect(wrap).not.toBeNull()
    expect(wrap?.querySelector('[data-testid="ui"]')?.textContent).toBe('nội dung')
  })

  it('fakes timers at the given time and drives intervals with them', () => {
    const { container } = render(<TickProbe />, { fakeTimers: { now: T0 } })

    // Mounted before any tick: interval not fired yet, Date.now() pinned.
    expect(container.querySelector('[data-testid="tick"]')?.textContent).toBe('idle')
    expect(Date.now()).toBe(T0)

    // Fake timers advance Date.now() to the target *before* firing due
    // callbacks, so the interval tick records the advanced time.
    act(() => vi.advanceTimersByTime(1_000))
    expect(container.querySelector('[data-testid="tick"]')?.textContent).toBe(String(T0 + 1_000))

    act(() => vi.advanceTimersByTime(60_000))
    expect(container.querySelector('[data-testid="tick"]')?.textContent).toBe(String(T0 + 61_000))
  })

  it('resets known stores to their initial state before rendering', () => {
    useTimerStore.setState({ kind: 'stopwatch', running: true, baseMs: 123_456, startedAt: 99 })
    useThemeStore.setState({ theme: 'custom', accent: '#ff0000' })

    const { container } = render(<StoreProbe />)

    expect(container.querySelector('[data-testid="store"]')?.textContent).toBe('none:dark')
    expect(useTimerStore.getState()).toMatchObject({ kind: null, running: false, baseMs: 0 })
    expect(useThemeStore.getState()).toMatchObject({ theme: 'dark', accent: '#34d399' })
  })

  it('keeps stores untouched with resetStores: false', () => {
    useTimerStore.setState({ kind: 'countdown', running: false, baseMs: 900_000, startedAt: null })

    const { container } = render(<StoreProbe />, { resetStores: false })

    expect(container.querySelector('[data-testid="store"]')?.textContent).toBe('countdown:dark')
  })

  it('installs fake timers that the afterEach restores', () => {
    const farFuture = Date.UTC(2100, 0, 1)
    render(<div />, { fakeTimers: { now: farFuture } })
    expect(Date.now()).toBe(farFuture)
  })

  it('did not leak fake timers from the previous test', () => {
    expect(Date.now()).not.toBe(Date.UTC(2100, 0, 1))
  })
})
