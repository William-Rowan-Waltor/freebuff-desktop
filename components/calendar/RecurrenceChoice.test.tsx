/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import RecurrenceChoice from '@/components/calendar/RecurrenceChoice'

describe('RecurrenceChoice', () => {
  it('renders nothing when there is no pending choice', () => {
    const { container } = render(
      <RecurrenceChoice state={null} onThis={vi.fn()} onAll={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('shows the event title and both actions', () => {
    const { container } = render(
      <RecurrenceChoice
        state={{ title: 'Họp tuần' }}
        onThis={vi.fn()}
        onAll={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('Họp tuần')
    expect(dialog!.textContent).toContain('Chỉ sự kiện này')
    expect(dialog!.textContent).toContain('Tất cả các lần')
  })

  it('calls onThis / onAll when the buttons are clicked', () => {
    const onThis = vi.fn()
    const onAll = vi.fn()
    const { container } = render(
      <RecurrenceChoice state={{ title: 'Họp tuần' }} onThis={onThis} onAll={onAll} onCancel={vi.fn()} />,
    )

    const thisBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Chỉ sự kiện này',
    )!
    act(() => thisBtn.click())
    expect(onThis).toHaveBeenCalledTimes(1)

    const allBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Tất cả các lần',
    )!
    act(() => allBtn.click())
    expect(onAll).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel on Escape', () => {
    const onCancel = vi.fn()
    render(<RecurrenceChoice state={{ title: 'Họp tuần' }} onThis={vi.fn()} onAll={vi.fn()} onCancel={onCancel} />)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows the this-and-future action only when provided (edit variant)', () => {
    const withFn = render(
      <RecurrenceChoice
        state={{ title: 'Họp tuần' }}
        onThis={vi.fn()}
        onAll={vi.fn()}
        onThisAndFuture={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(withFn.container.textContent).toContain('Tất cả các lần sau lần này')

    const without = render(
      <RecurrenceChoice state={{ title: 'Họp tuần' }} onThis={vi.fn()} onAll={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(without.container.textContent).not.toContain('Tất cả các lần sau lần này')
  })

  it('calls onThisAndFuture when the split button is clicked', () => {
    const onThisAndFuture = vi.fn()
    const { container } = render(
      <RecurrenceChoice
        state={{ title: 'Họp tuần' }}
        onThis={vi.fn()}
        onAll={vi.fn()}
        onThisAndFuture={onThisAndFuture}
        onCancel={vi.fn()}
      />,
    )
    const btn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Tất cả các lần sau lần này'),
    )!
    act(() => btn.click())
    expect(onThisAndFuture).toHaveBeenCalledTimes(1)
  })

  it('never shows the this-and-future action in the delete variant', () => {
    const { container } = render(
      <RecurrenceChoice
        state={{ title: 'Họp tuần' }}
        variant="delete"
        onThis={vi.fn()}
        onAll={vi.fn()}
        onThisAndFuture={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.textContent).not.toContain('Tất cả các lần sau lần này')
  })

  it('variant "delete" switches the copy to deletion wording', () => {
    const { container } = render(
      <RecurrenceChoice
        state={{ title: 'Họp tuần' }}
        variant="delete"
        onThis={vi.fn()}
        onAll={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog!.textContent).toContain('Xóa lần lặp lại của')
    expect(dialog!.textContent).toContain('Xóa lần này')
    expect(dialog!.textContent).toContain('Xóa tất cả các lần')
    // The edit wording must not leak into the delete variant.
    expect(dialog!.textContent).not.toContain('Chỉ sự kiện này')
    expect(dialog!.textContent).not.toContain('Tất cả các lần')
  })

  it('focuses the primary action on open and restores focus on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { container, rerender } = render(
      <RecurrenceChoice state={{ title: 'Họp tuần' }} onThis={vi.fn()} onAll={vi.fn()} onCancel={vi.fn()} />,
    )
    const primary = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Chỉ sự kiện này',
    )!
    expect(document.activeElement).toBe(primary)

    // Closing the modal hands focus back to the previously focused element.
    rerender(<RecurrenceChoice state={null} onThis={vi.fn()} onAll={vi.fn()} onCancel={vi.fn()} />)
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('traps Tab focus within the dialog', () => {
    const { container } = render(
      <RecurrenceChoice
        state={{ title: 'Họp tuần' }}
        onThis={vi.fn()}
        onAll={vi.fn()}
        onThisAndFuture={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    const first = buttons[0]
    const last = buttons[buttons.length - 1]

    // Tab from the last element wraps to the first.
    act(() => last.focus())
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(first)

    // Shift+Tab from the first wraps back to the last.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    })
    expect(document.activeElement).toBe(last)
  })
})