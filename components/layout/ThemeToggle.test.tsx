/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it } from 'vitest'

import { render } from '@/test/render'
import ThemeToggle from '@/components/layout/ThemeToggle'
import { useThemeStore } from '@/store/useThemeStore'

function cycleButton(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('[aria-label^="Đổi giao diện"]')
  if (!el) throw new Error('no theme cycle button')
  return el
}

describe('ThemeToggle', () => {
  it('cycles dark → light → custom → dark and applies the theme', () => {
    const { container } = render(<ThemeToggle />)

    expect(cycleButton(container).getAttribute('aria-label')).toBe('Đổi giao diện (hiện tại: Dark)')

    act(() => cycleButton(container).click())
    expect(useThemeStore.getState().theme).toBe('light')
    expect(cycleButton(container).getAttribute('aria-label')).toBe('Đổi giao diện (hiện tại: Light)')
    // applyTheme writes the data-theme attribute on <html>.
    expect(document.documentElement.dataset.theme).toBe('light')

    act(() => cycleButton(container).click())
    expect(useThemeStore.getState().theme).toBe('custom')
    expect(container.querySelector('[aria-label^="Chọn màu chủ đạo"]')).not.toBeNull()

    // And back to dark, where the accent picker disappears again.
    act(() => cycleButton(container).click())
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(container.querySelector('[aria-label^="Chọn màu chủ đạo"]')).toBeNull()
  })

  it('shows the accent picker only in custom mode', () => {
    const { container } = render(<ThemeToggle />)
    expect(container.querySelector('[aria-label^="Chọn màu chủ đạo"]')).toBeNull()
  })
})
