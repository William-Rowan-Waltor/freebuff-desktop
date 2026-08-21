import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useSettingsStore,
  DEFAULT_EVENT_DURATIONS,
  DEFAULT_EVENT_DURATION,
} from './useSettingsStore'

// The store's persistence is server-backed (user_state row) with localStorage
// as fallback — mock the supabase client so the hydration probe resolves
// instantly (no server row → falls back to localStorage) instead of hanging.
vi.mock('@/lib/supabase/client', () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    upsert: vi.fn(async () => ({ data: null, error: null })),
    delete: vi.fn(() => chain),
    order: vi.fn(() => chain),
  }
  return { supabase: { from: vi.fn(() => chain) } }
})

const PERSIST_KEY = 'app-settings-store'

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({
    defaultEventDuration: DEFAULT_EVENT_DURATION,
    notifyBeep: true,
    notifyFlash: true,
    chime: 'arpeggio',
    customChimeFreq: 660,
  })
})

describe('constants', () => {
  it('exposes the configurable duration options and default', () => {
    expect([...DEFAULT_EVENT_DURATIONS]).toEqual([30, 60, 90, 120])
    expect(DEFAULT_EVENT_DURATION).toBe(60)
    expect(DEFAULT_EVENT_DURATIONS).toContain(DEFAULT_EVENT_DURATION)
  })
})

describe('defaults', () => {
  it('starts with 60-minute events, both notifications on, arpeggio chime at 660 Hz', () => {
    expect(useSettingsStore.getState()).toMatchObject({
      defaultEventDuration: 60,
      notifyBeep: true,
      notifyFlash: true,
      chime: 'arpeggio',
      customChimeFreq: 660,
    })
  })
})

describe('setters', () => {
  it('updates the default event duration', () => {
    useSettingsStore.getState().setDefaultEventDuration(90)
    expect(useSettingsStore.getState().defaultEventDuration).toBe(90)
  })

  it('toggles each notification flag independently', () => {
    useSettingsStore.getState().setNotifyBeep(false)
    useSettingsStore.getState().setNotifyFlash(false)
    expect(useSettingsStore.getState()).toMatchObject({ notifyBeep: false, notifyFlash: false })

    useSettingsStore.getState().setNotifyFlash(true)
    expect(useSettingsStore.getState()).toMatchObject({ notifyBeep: false, notifyFlash: true })
  })

  it('changes the chime and custom frequency', () => {
    useSettingsStore.getState().setChime('ding')
    useSettingsStore.getState().setCustomChimeFreq(880)
    expect(useSettingsStore.getState()).toMatchObject({ chime: 'ding', customChimeFreq: 880 })
  })
})

describe('persistence', () => {
  it('persists the partialized settings to localStorage on change', () => {
    useSettingsStore.getState().setDefaultEventDuration(90)
    useSettingsStore.getState().setChime('custom')
    useSettingsStore.getState().setCustomChimeFreq(440)

    const raw = localStorage.getItem(PERSIST_KEY)
    expect(raw).not.toBeNull()
    const { state, version } = JSON.parse(raw!)
    expect(version).toBe(0)
    expect(state).toEqual({
      defaultEventDuration: 90,
      notifyBeep: true,
      notifyFlash: true,
      chime: 'custom',
      customChimeFreq: 440,
      remindersEnabled: true,
      reminderMinutes: 10,
    })
  })

  it('rehydrates from persisted storage on a fresh store instance', async () => {
    useSettingsStore.getState().setDefaultEventDuration(120)
    useSettingsStore.getState().setNotifyBeep(false)

    vi.resetModules()
    const { useSettingsStore: fresh } = await import('./useSettingsStore')
    // Storage is server-backed now, so rehydration is async (localStorage is
    // the fallback when the server probe fails, e.g. in tests) — wait for the
    // persisted values to land instead of asserting synchronously.
    await vi.waitFor(() => {
      expect(fresh.getState()).toMatchObject({
        defaultEventDuration: 120,
        notifyBeep: false,
        notifyFlash: true,
        chime: 'arpeggio',
        customChimeFreq: 660,
      })
    })
  })
})
