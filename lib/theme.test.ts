import { beforeEach, describe, expect, it } from 'vitest'
import {
  THEME_KEY,
  ACCENT_KEY,
  THEME_ALIASES,
  initialTheme,
  applyTheme,
  readAccent,
  saveAccent,
  setAccentVar,
} from './theme'

describe('theme persistence guards', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
    document.documentElement.style.removeProperty('--accent')
  })

  it('defaults to dark when nothing is stored', () => {
    expect(initialTheme()).toBe('dark')
  })

  it('reads back a stored theme and ignores unknown values', () => {
    window.localStorage.setItem(THEME_KEY, 'light')
    expect(initialTheme()).toBe('light')
    window.localStorage.setItem(THEME_KEY, 'solarized')
    expect(initialTheme()).toBe('dark')
  })

  it('maps the theme aliases to display labels', () => {
    expect(THEME_ALIASES.dark).toBe('Dark')
    expect(THEME_ALIASES.light).toBe('Light')
    expect(THEME_ALIASES.custom).toBe('Custom')
  })

  it('applyTheme sets the data-theme attribute', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('accent falls back to the default when unset or malformed', () => {
    expect(readAccent()).toBe('#34d399')
    window.localStorage.setItem(ACCENT_KEY, 'oops')
    expect(readAccent()).toBe('#34d399')
  })

  it('saveAccent / readAccent round-trip through localStorage', () => {
    saveAccent('#f97316')
    expect(readAccent()).toBe('#f97316')
    expect(window.localStorage.getItem(ACCENT_KEY)).toBe('#f97316')
  })

  it('applyTheme(custom) writes the accent CSS variable', () => {
    saveAccent('#f97316')
    applyTheme('custom')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#f97316')
  })

  it('setAccentVar sets the --accent custom property directly', () => {
    setAccentVar('#22c55e')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#22c55e')
  })
})