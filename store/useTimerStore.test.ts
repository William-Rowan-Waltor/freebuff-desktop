import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useTimerStore, timerValueMs, type TimerData } from './useTimerStore'

const T0 = Date.UTC(2026, 7, 13, 12, 0, 0) // 2026-08-13T12:00:00Z

// A stopped-state helper matching the store's reset values.
const stopped = (): TimerData => ({
  kind: null,
  running: false,
  baseMs: 0,
  startedAt: null,
  presetMs: null,
})

beforeEach(() => {
  useTimerStore.setState(stopped())
  vi.useFakeTimers({ now: T0 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('initial state', () => {
  it('starts idle', () => {
    expect(useTimerStore.getState()).toMatchObject({
      kind: null,
      running: false,
      baseMs: 0,
      startedAt: null,
    })
  })
})

describe('timerValueMs', () => {
  it('returns the accumulated base for a stopped stopwatch', () => {
    const s: TimerData = { kind: 'stopwatch', running: false, baseMs: 5_000, startedAt: null, presetMs: null }
    expect(timerValueMs(s, 10_000)).toBe(5_000)
  })

  it('adds the elapsed run segment for a running stopwatch', () => {
    const s: TimerData = { kind: 'stopwatch', running: true, baseMs: 5_000, startedAt: 2_000, presetMs: null }
    expect(timerValueMs(s, 5_000)).toBe(8_000)
  })

  it('returns the remaining base for a stopped countdown', () => {
    const s: TimerData = { kind: 'countdown', running: false, baseMs: 1_500_000, startedAt: null, presetMs: 1_500_000 }
    expect(timerValueMs(s, 9_000)).toBe(1_500_000)
  })

  it('subtracts the run segment for a running countdown', () => {
    const s: TimerData = { kind: 'countdown', running: true, baseMs: 1_500_000, startedAt: 2_000, presetMs: 1_500_000 }
    expect(timerValueMs(s, 5_000)).toBe(1_497_000)
  })

  it('clamps a countdown at zero instead of going negative', () => {
    const s: TimerData = { kind: 'countdown', running: true, baseMs: 1_000, startedAt: 0, presetMs: 1_000 }
    expect(timerValueMs(s, 5_000)).toBe(0)
  })

  it('is zero for the idle state', () => {
    expect(timerValueMs(stopped(), T0)).toBe(0)
  })
})

describe('stopwatch', () => {
  it('starts at zero and counts up with wall time', () => {
    const store = useTimerStore.getState()
    store.startStopwatch()
    expect(useTimerStore.getState()).toMatchObject({ kind: 'stopwatch', running: true, baseMs: 0 })

    vi.setSystemTime(T0 + 3_000)
    expect(timerValueMs(useTimerStore.getState(), Date.now())).toBe(3_000)

    vi.setSystemTime(T0 + 61_000)
    expect(timerValueMs(useTimerStore.getState(), Date.now())).toBe(61_000)
  })

  it('pause freezes the elapsed time', () => {
    useTimerStore.getState().startStopwatch()
    vi.setSystemTime(T0 + 5_000)
    useTimerStore.getState().pause()

    expect(useTimerStore.getState()).toMatchObject({ running: false, baseMs: 5_000, startedAt: null })

    // Time passing while paused must not change the value.
    vi.setSystemTime(T0 + 30_000)
    expect(timerValueMs(useTimerStore.getState(), Date.now())).toBe(5_000)
  })

  it('resume continues from where it paused', () => {
    useTimerStore.getState().startStopwatch()
    vi.setSystemTime(T0 + 5_000)
    useTimerStore.getState().pause()

    vi.setSystemTime(T0 + 10_000)
    useTimerStore.getState().resume()
    expect(useTimerStore.getState()).toMatchObject({ running: true, baseMs: 5_000 })

    vi.setSystemTime(T0 + 15_000)
    expect(timerValueMs(useTimerStore.getState(), Date.now())).toBe(10_000)
  })
})

describe('countdown', () => {
  it('starts with minutes * 60_000 and counts down', () => {
    useTimerStore.getState().startCountdown(25)
    expect(useTimerStore.getState()).toMatchObject({ kind: 'countdown', running: true, baseMs: 1_500_000 })

    vi.setSystemTime(T0 + 60_000)
    expect(timerValueMs(useTimerStore.getState(), Date.now())).toBe(1_440_000)
  })

  it('pause stores the remaining time, resume keeps counting down', () => {
    useTimerStore.getState().startCountdown(1) // 60s
    vi.setSystemTime(T0 + 10_000)
    useTimerStore.getState().pause()
    expect(useTimerStore.getState()).toMatchObject({ running: false, baseMs: 50_000 })

    vi.setSystemTime(T0 + 20_000)
    useTimerStore.getState().resume()
    vi.setSystemTime(T0 + 25_000) // 5s of resumed running
    expect(timerValueMs(useTimerStore.getState(), Date.now())).toBe(45_000)
  })

  it('clamps at zero once the time is exhausted', () => {
    useTimerStore.getState().startCountdown(1)
    vi.setSystemTime(T0 + 70_000)
    expect(timerValueMs(useTimerStore.getState(), Date.now())).toBe(0)
  })

  it('restarting replaces the previous timer', () => {
    useTimerStore.getState().startCountdown(1)
    vi.setSystemTime(T0 + 30_000)
    useTimerStore.getState().startCountdown(25)
    expect(useTimerStore.getState().baseMs).toBe(1_500_000)
    expect(timerValueMs(useTimerStore.getState(), Date.now())).toBe(1_500_000)
  })
})

describe('reset / cancel', () => {
  it('reset clears the timer back to idle', () => {
    useTimerStore.getState().startStopwatch()
    vi.setSystemTime(T0 + 10_000)
    useTimerStore.getState().reset()
    expect(useTimerStore.getState()).toMatchObject({
      kind: null,
      running: false,
      baseMs: 0,
      startedAt: null,
    })
    expect(timerValueMs(useTimerStore.getState(), Date.now())).toBe(0)
  })

  it('cancel clears a running countdown', () => {
    useTimerStore.getState().startCountdown(25)
    useTimerStore.getState().cancel()
    expect(useTimerStore.getState()).toMatchObject({ kind: null, running: false, baseMs: 0 })
  })
})
