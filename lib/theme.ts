export type Theme = 'dark' | 'light' | 'custom'

export const THEME_ALIASES: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  custom: 'Custom',
}

export const THEME_KEY = 'app-theme'
export const ACCENT_KEY = 'app-theme-accent'

export const THEME_ORDER: Theme[] = ['dark', 'light', 'custom']

export function initialTheme(): Theme {
  try {
    const raw = window.localStorage.getItem(THEME_KEY)
    if (raw === 'dark' || raw === 'light' || raw === 'custom') return raw
  } catch {
    /* localStorage unavailable */
  }
  return 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  if (theme === 'custom') {
    const hex = readAccent()
    setAccentVar(hex)
  }
}

export function readAccent(): string {
  try {
    const raw = window.localStorage.getItem(ACCENT_KEY)
    if (raw && /^#[0-9a-f]{6}$/i.test(raw)) return raw
  } catch {
    /* localStorage unavailable */
  }
  return '#34d399'
}

export function saveAccent(hex: string) {
  try {
    window.localStorage.setItem(ACCENT_KEY, hex)
  } catch {
    /* localStorage unavailable */
  }
}

export function setAccentVar(hex: string) {
  document.documentElement.style.setProperty('--accent', hex)
}