'use client'

import { Moon, Sun, PaintBrush } from '@phosphor-icons/react'
import { useThemeStore } from '@/store/useThemeStore'
import { THEME_ORDER, THEME_ALIASES, applyTheme } from '@/lib/theme'
import AccentPicker from '@/components/layout/AccentPicker'

export default function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme)
  const accent = useThemeStore((state) => state.accent)
  const setTheme = useThemeStore((state) => state.setTheme)
  const setAccent = useThemeStore((state) => state.setAccent)

  const cycle = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]
    setTheme(next)
    applyTheme(next)
  }

  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : PaintBrush

  return (
    <div className="flex items-center gap-1.5" aria-label="Chế độ giao diện">
      <button
        type="button"
        onClick={cycle}
        title={`Giao diện: ${THEME_ALIASES[theme]} (bấm để đổi)`}
        aria-label={`Đổi giao diện (hiện tại: ${THEME_ALIASES[theme]})`}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 active:scale-[0.98]"
      >
        <Icon size={16} />
      </button>
      {theme === 'custom' && <AccentPicker accent={accent} onChange={setAccent} />}
    </div>
  )
}