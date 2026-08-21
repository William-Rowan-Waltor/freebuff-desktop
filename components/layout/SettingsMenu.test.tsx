/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it } from 'vitest'

import { render } from '@/test/render'
import SettingsMenu from '@/components/layout/SettingsMenu'
import { useSettingsStore } from '@/store/useSettingsStore'

const PERSIST_KEY = 'app-settings-store'

function openMenu(container: HTMLElement) {
  const gear = container.querySelector('button[aria-label="Mở cài đặt"]') as HTMLButtonElement
  act(() => {
    gear.click()
  })
}

function reminderSwitch(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector('button[role="switch"][aria-label="Bật/ tắt nhắc sự kiện"]')
}

function presetGroup(container: HTMLElement): HTMLDivElement | null {
  return container.querySelector('div[role="radiogroup"][aria-label="Thời gian nhắc trước sự kiện"]')
}

describe('SettingsMenu — event reminders', () => {
  it('renders reminders on by default with the 10-minute preset active', () => {
    const { container } = render(<SettingsMenu />)
    openMenu(container)

    expect(reminderSwitch(container)?.getAttribute('aria-checked')).toBe('true')
    const group = presetGroup(container)
    expect(group).not.toBeNull()
    const active = group!.querySelector('button[aria-checked="true"]')
    expect(active?.textContent).toContain('10')
  })

  it('changing the preset updates the store and persists it', () => {
    const { container } = render(<SettingsMenu />)
    openMenu(container)

    const preset15 = presetGroup(container)!.querySelector('button:nth-child(3)') as HTMLButtonElement
    act(() => {
      preset15.click()
    })

    expect(useSettingsStore.getState().reminderMinutes).toBe(15)
    const { state } = JSON.parse(localStorage.getItem(PERSIST_KEY)!)
    expect(state.reminderMinutes).toBe(15)
  })

  it('toggling reminders off hides the presets and persists', () => {
    const { container } = render(<SettingsMenu />)
    openMenu(container)

    act(() => {
      reminderSwitch(container)!.click()
    })

    expect(useSettingsStore.getState().remindersEnabled).toBe(false)
    expect(presetGroup(container)).toBeNull()
    const { state } = JSON.parse(localStorage.getItem(PERSIST_KEY)!)
    expect(state.remindersEnabled).toBe(false)
  })
})

describe('SettingsMenu — Markdown quick reference', () => {
  it('teaches creating markdown components via ordinary syntax or keyboard shortcuts', () => {
    const { container } = render(<SettingsMenu />)
    openMenu(container)

    expect(container.textContent).toContain('Markdown & phím tắt')
    // Ordinary syntax for block components…
    expect(container.textContent).toContain('# Văn bản')
    expect(container.textContent).toContain('- [ ] Việc')
    expect(container.textContent).toContain('> Văn bản')
    // …inline marks…
    expect(container.textContent).toContain('**Văn bản**')
    expect(container.textContent).toContain('`mã`')
    // …and the matching keyboard shortcuts.
    expect(container.textContent).toContain('Ctrl/Cmd + B')
    expect(container.textContent).toContain('Ctrl/Cmd + Alt + 1')
    expect(container.textContent).toContain('Ctrl/Cmd + Shift + 8')
    // The task-list row documents only the syntax (no default shortcut).
    const code = [...container.querySelectorAll('code')]
    expect(code.some((c) => c.textContent === '- [ ] Việc')).toBe(true)
  })

  it('renders a live preview of each markdown component', () => {
    const { container } = render(<SettingsMenu />)
    openMenu(container)

    // The **Văn bản** syntax renders as an actual <strong> element…
    const strong = container.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong!.textContent).toBe('Văn bản')
    // …a heading preview renders as <h1>…
    const h1 = container.querySelector('h1')
    expect(h1).not.toBeNull()
    expect(h1!.textContent).toBe('Văn bản')
    // …and the code-block preview renders a <pre>.
    expect(container.querySelector('pre')).not.toBeNull()
    // The shortcut-only row (Hoàn tác / Làm lại) has no preview box.
    expect(container.textContent).toContain('Ctrl/Cmd + Z / Ctrl/Cmd + Shift + Z')
  })

  it('collapses and re-expands the markdown reference from the header toggle', () => {
    const { container } = render(<SettingsMenu />)
    openMenu(container)
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Bật/ tắt hướng dẫn Markdown"]',
    )
    expect(toggle).not.toBeNull()
    expect(toggle!.getAttribute('aria-expanded')).toBe('true')

    act(() => toggle!.click())
    expect(toggle!.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('**Văn bản**')
    expect(container.textContent).not.toContain('Ctrl/Cmd + B')

    act(() => toggle!.click())
    expect(container.textContent).toContain('**Văn bản**')
  })
})