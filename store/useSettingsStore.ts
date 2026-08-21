import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChimeId } from '@/lib/chime'
import { createServerStateStorage } from '@/lib/db/user-state'

// Default duration options (minutes) for newly created timed events.
export const DEFAULT_EVENT_DURATIONS = [30, 60, 90, 120] as const
export const DEFAULT_EVENT_DURATION = 60

interface SettingsState {
  defaultEventDuration: number
  notifyBeep: boolean
  notifyFlash: boolean
  chime: ChimeId
  customChimeFreq: number
  remindersEnabled: boolean
  reminderMinutes: number

  setDefaultEventDuration: (minutes: number) => void
  setNotifyBeep: (enabled: boolean) => void
  setNotifyFlash: (enabled: boolean) => void
  setChime: (chime: ChimeId) => void
  setCustomChimeFreq: (freq: number) => void
  setRemindersEnabled: (enabled: boolean) => void
  setReminderMinutes: (minutes: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      defaultEventDuration: DEFAULT_EVENT_DURATION,
      notifyBeep: true,
      notifyFlash: true,
      chime: 'arpeggio',
      customChimeFreq: 660,
      remindersEnabled: true,
      reminderMinutes: 10,

      setDefaultEventDuration: (minutes) => set({ defaultEventDuration: minutes }),
      setNotifyBeep: (enabled) => set({ notifyBeep: enabled }),
      setNotifyFlash: (enabled) => set({ notifyFlash: enabled }),
      setChime: (chime) => set({ chime }),
      setCustomChimeFreq: (freq) => set({ customChimeFreq: freq }),
      setRemindersEnabled: (enabled) => set({ remindersEnabled: enabled }),
      setReminderMinutes: (minutes) => set({ reminderMinutes: minutes }),
    }),
    {
      name: 'app-settings-store',
      // Server-backed (user_state row 'settings') with localStorage as the
      // offline cache — settings follow the user across browsers/devices.
      storage: createJSONStorage(() => createServerStateStorage('settings')),
      partialize: (state) => ({
        defaultEventDuration: state.defaultEventDuration,
        notifyBeep: state.notifyBeep,
        notifyFlash: state.notifyFlash,
        chime: state.chime,
        customChimeFreq: state.customChimeFreq,
        remindersEnabled: state.remindersEnabled,
        reminderMinutes: state.reminderMinutes,
      }),
    },
  ),
)
