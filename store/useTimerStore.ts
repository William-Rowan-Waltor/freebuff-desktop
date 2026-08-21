import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createServerStateStorage } from '@/lib/db/user-state'

export type TimerKind = 'stopwatch' | 'countdown'

/** The pure data fields of the timer (what timerValueMs reads). */
export interface TimerData {
  kind: TimerKind | null
  running: boolean
  /** Stopwatch: elapsed ms accumulated before the current run segment.
      Countdown: ms remaining when the current run segment started. */
  baseMs: number
  /** Date.now() when the current run segment started (null when paused). */
  startedAt: number | null
  /** The original countdown duration (minutes * 60_000) so the preset
   *  highlight survives pause/resume when baseMs drifts. */
  presetMs: number | null
}

export interface TimerState extends TimerData {
  startStopwatch: () => void
  startCountdown: (minutes: number) => void
  pause: () => void
  resume: () => void
  reset: () => void
  cancel: () => void
}

/** Current value of the timer at `now`: elapsed (stopwatch) or remaining (countdown). */
export function timerValueMs(state: TimerData, now: number): number {
  const runMs = state.running && state.startedAt != null ? now - state.startedAt : 0
  return state.kind === 'countdown' ? Math.max(0, state.baseMs - runMs) : state.baseMs + runMs
}

export const useTimerStore = create<TimerState>()(
  persist(
    (set, get) => ({
      kind: null,
      running: false,
      baseMs: 0,
      startedAt: null,
      presetMs: null,

      startStopwatch: () =>
        set({ kind: 'stopwatch', running: true, baseMs: 0, startedAt: Date.now() }),

      startCountdown: (minutes) =>
        set({ kind: 'countdown', running: true, baseMs: minutes * 60_000, startedAt: Date.now(), presetMs: minutes * 60_000 }),

      pause: () => {
        const state = get()
        set({ running: false, startedAt: null, baseMs: timerValueMs(state, Date.now()) })
      },

      resume: () => set({ running: true, startedAt: Date.now() }),

      reset: () => set({ kind: null, running: false, baseMs: 0, startedAt: null, presetMs: null }),

      cancel: () => set({ kind: null, running: false, baseMs: 0, startedAt: null, presetMs: null }),
    }),
    {
      name: 'app-timer-store',
      // Server-backed (user_state row 'timer') with localStorage fallback.
      storage: createJSONStorage(() => createServerStateStorage('timer')),
      partialize: (state) => ({
        kind: state.kind,
        running: state.running,
        baseMs: state.baseMs,
        startedAt: state.startedAt,
        presetMs: state.presetMs,
      }),
    },
  ),
)
