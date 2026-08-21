import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme } from '@/lib/theme'
import { applyTheme, saveAccent, setAccentVar } from '@/lib/theme'

interface ThemeState {
  theme: Theme
  accent: string
  setTheme: (theme: Theme) => void
  setAccent: (hex: string) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      accent: '#34d399',
      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },
      setAccent: (hex) => {
        set({ accent: hex })
        saveAccent(hex)
        if (get().theme === 'custom') setAccentVar(hex)
      },
    }),
    {
      name: 'app-theme-store',
      partialize: (state) => ({ theme: state.theme, accent: state.accent }),
    },
  ),
)