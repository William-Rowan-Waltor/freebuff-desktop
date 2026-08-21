/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import AccentPicker, { ACCENT_PRESETS } from '@/components/layout/AccentPicker'

describe('AccentPicker', () => {
  it('renders a trigger showing the current accent and opens the palette', () => {
    const { container } = render(<AccentPicker accent="#34d399" onChange={() => {}} />)

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label^="Chọn màu chủ đạo"]')
    expect(trigger).not.toBeNull()
    expect(trigger!.getAttribute('aria-expanded')).toBe('false')

    act(() => trigger!.click())
    expect(trigger!.getAttribute('aria-expanded')).toBe('true')

    // All presets are present as swatch buttons; the current accent is marked.
    const swatches = container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')
    expect(swatches.length).toBe(ACCENT_PRESETS.length)
    const active = [...swatches].find((b) => b.getAttribute('aria-pressed') === 'true')
    expect(active).toBeDefined()
    expect(active!.getAttribute('aria-label')).toBe('Xanh lục (mặc định)')
  })

  it('calls onChange with the preset hex when a swatch is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<AccentPicker accent="#34d399" onChange={onChange} />)

    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Chọn màu chủ đạo"]')!.click())
    const violet = container.querySelector<HTMLButtonElement>('button[aria-label="Tím"]')
    expect(violet).not.toBeNull()
    act(() => violet!.click())

    expect(onChange).toHaveBeenCalledWith('#8b5cf6')
  })

  it('closes on Escape and offers the free color input', () => {
    const { container } = render(<AccentPicker accent="#34d399" onChange={() => {}} />)

    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Chọn màu chủ đạo"]')!.click())
    expect(container.querySelector('input[type="color"]')).not.toBeNull()
    expect(container.textContent).toContain('#34D399')

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('input[type="color"]')).toBeNull()
  })
})
