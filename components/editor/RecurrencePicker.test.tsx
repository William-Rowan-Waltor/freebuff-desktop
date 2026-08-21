/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RRule } from 'rrule'

import { render } from '@/test/render'
import RecurrencePicker from '@/components/editor/RecurrencePicker'
import { useBlocksStore } from '@/store/useBlocksStore'
import type { Block } from '@/types'

/** Compute the local end-of-day ISO instant that inputToUntil produces for
 *  a date string like '2026-12-31'. Matches the M4 fix: end of LOCAL day. */
function localUntil(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 0, 0, 0, -1)
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:.]/g, (match, offset) => offset === 19 ? '' : match)
}
/** Format an ISO instant as rrule UNTIL: YYYYMMDDTHHmmssZ */
function rruleUntil(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 0, 0, 0, -1)
  const iso = d.toISOString()
  // 2026-12-31T23:59:59.999Z → 20261231T235959Z (strip separators + ms)
  return iso.slice(0, 10).replace(/-/g, '') + 'T' + iso.slice(11, 19).replace(/:/g, '') + 'Z'
}

// RecurrencePicker is controlled by the parent's block prop; these interaction
// tests re-render it with each patch so mode-dependent inputs appear/disappear
// exactly as in the real editor.
function PickerHarness({
  initial,
  onChange,
}: {
  initial: Block
  onChange: (b: Block, p: Partial<Block>) => void
}) {
  const [block, setBlock] = useState(initial)
  return (
    <RecurrencePicker
      block={block}
      onChange={(b, p) => {
        onChange(b, p)
        setBlock({ ...b, ...p })
      }}
    />
  )
}

function block(overrides: Partial<Block> & { id: string }): Block {
  return {
    type: 'event',
    title: 'Sự kiện',
    content: { type: 'doc', content: [] },
    start_time: '2026-08-17T02:00:00Z',
    end_time: '2026-08-17T03:00:00Z',
    recurrence: null,
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
    ...overrides,
  }
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('RecurrencePicker', () => {
  it('degrades to a notice when recurrence is unavailable on the server', () => {
    useBlocksStore.setState({ recurrenceUnavailable: true })
    try {
      const { container } = render(
        <RecurrencePicker block={block({ id: 'a' })} onChange={vi.fn()} />,
        { resetStores: false },
      )
      expect(container.textContent).toContain('Lặp lại chưa khả dụng trên máy chủ này')
      expect(container.querySelector('select[aria-label="Lặp lại"]')).toBeNull()
    } finally {
      useBlocksStore.setState({ recurrenceUnavailable: false })
    }
  })

  it('shows "Không lặp lại" (no extra controls) for a non-recurring event', () => {
    const { container } = render(<RecurrencePicker block={block({ id: 'a' })} onChange={vi.fn()} />)
    const select = container.querySelector('select[aria-label="Lặp lại"]') as HTMLSelectElement
    expect(select).not.toBeNull()
    expect(select.value).toBe('-1')
    expect(container.querySelector('input[aria-label="Khoảng lặp"]')).toBeNull()
    expect(container.querySelector('input[aria-label="Lặp lại đến ngày"]')).toBeNull()
  })

  it('writes a weekly rule when "Mỗi tuần" is chosen', () => {
    const onChange = vi.fn()
    const { container } = render(<RecurrencePicker block={block({ id: 'a' })} onChange={onChange} />)
    setSelectValue(container.querySelector('select[aria-label="Lặp lại"]') as HTMLSelectElement, String(RRule.WEEKLY))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      { recurrence: 'FREQ=WEEKLY' },
    )
  })

  it('clears recurrence when "Không lặp lại" is chosen', () => {
    const onChange = vi.fn()
    const { container } = render(
      <RecurrencePicker block={block({ id: 'a', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
    )
    setSelectValue(container.querySelector('select[aria-label="Lặp lại"]') as HTMLSelectElement, '-1')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), { recurrence: null })
  })

  it('updates the interval while preserving freq', () => {
    const onChange = vi.fn()
    const { container } = render(
      <RecurrencePicker block={block({ id: 'a', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
    )
    const interval = container.querySelector('input[aria-label="Khoảng lặp"]') as HTMLInputElement
    expect(interval.value).toBe('1')
    setInputValue(interval, '3')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: 'FREQ=WEEKLY;INTERVAL=3',
    })
  })

  it('adds an UNTIL (end of the chosen day) and keeps freq + interval', () => {
    const onChange = vi.fn()
    const { container } = render(
      <PickerHarness initial={block({ id: 'a', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
    )
    // Switch the end condition to "Đến ngày" first — the date input only shows
    // in that mode.
    setSelectValue(container.querySelector('select[aria-label="Kết thúc lặp lại"]') as HTMLSelectElement, 'until')
    const until = container.querySelector('input[aria-label="Lặp lại đến ngày"]') as HTMLInputElement
    setInputValue(until, '2026-12-31')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: `FREQ=WEEKLY;UNTIL=${rruleUntil('2026-12-31')}`,
    })
  })

  it('writes COUNT when "Số lần" is chosen and keeps freq + interval', () => {
    const onChange = vi.fn()
    const { container } = render(
      <PickerHarness initial={block({ id: 'a', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
    )
    setSelectValue(container.querySelector('select[aria-label="Kết thúc lặp lại"]') as HTMLSelectElement, 'count')
    const count = container.querySelector('input[aria-label="Số lần lặp lại"]') as HTMLInputElement
    setInputValue(count, '4')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: 'FREQ=WEEKLY;COUNT=4',
    })
  })

  it('prefills a COUNT rule in the "Số lần" mode', () => {
    const { container } = render(
      <RecurrencePicker block={block({ id: 'a', recurrence: 'FREQ=DAILY;COUNT=3' })} onChange={vi.fn()} />,
    )
    const end = container.querySelector('select[aria-label="Kết thúc lặp lại"]') as HTMLSelectElement
    expect(end.value).toBe('count')
    const count = container.querySelector('input[aria-label="Số lần lặp lại"]') as HTMLInputElement
    expect(count).not.toBeNull()
    expect(count.value).toBe('3')
    // UNTIL input is hidden in COUNT mode (mutually exclusive).
    expect(container.querySelector('input[aria-label="Lặp lại đến ngày"]')).toBeNull()
  })

  it('keeps UNTIL and COUNT mutually exclusive through mode switches', () => {
    const onChange = vi.fn()
    const { container } = render(
      <PickerHarness initial={block({ id: 'a', recurrence: 'FREQ=DAILY;UNTIL=20261231T235959Z' })} onChange={onChange} />,
    )
    // "Đến ngày" -> "Số lần": choosing a count must clear the UNTIL.
    setSelectValue(container.querySelector('select[aria-label="Kết thúc lặp lại"]') as HTMLSelectElement, 'count')
    const count = container.querySelector('input[aria-label="Số lần lặp lại"]') as HTMLInputElement
    setInputValue(count, '2')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: 'FREQ=DAILY;COUNT=2',
    })
    // "Số lần" -> "Đến ngày": switching mode must clear the COUNT (the new
    // UNTIL defaults to today's end-of-day).
    setSelectValue(container.querySelector('select[aria-label="Kết thúc lặp lại"]') as HTMLSelectElement, 'until')
    const todayUntil = rruleUntil(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`)
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ recurrence: `FREQ=DAILY;UNTIL=${todayUntil}` }),
    )
    // "Không kết thúc" clears whatever end condition was set.
    setSelectValue(container.querySelector('select[aria-label="Kết thúc lặp lại"]') as HTMLSelectElement, 'none')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: 'FREQ=DAILY',
    })
  })

  it('keeps COUNT when editing the interval (regression)', () => {
    const onChange = vi.fn()
    const { container } = render(
      <RecurrencePicker block={block({ id: 'a', recurrence: 'FREQ=WEEKLY;BYDAY=MO;COUNT=5' })} onChange={onChange} />,
    )
    const interval = container.querySelector('input[aria-label="Khoảng lặp"]') as HTMLInputElement
    setInputValue(interval, '2')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=5',
    })
  })

  it('prefills the controls from an existing rule', () => {
    const { container } = render(
      <RecurrencePicker
        block={block({ id: 'a', recurrence: 'FREQ=MONTHLY;INTERVAL=2;UNTIL=20261231T235959Z' })}
        onChange={vi.fn()}
      />,
    )
    const select = container.querySelector('select[aria-label="Lặp lại"]') as HTMLSelectElement
    const interval = container.querySelector('input[aria-label="Khoảng lặp"]') as HTMLInputElement
    const until = container.querySelector('input[aria-label="Lặp lại đến ngày"]') as HTMLInputElement
    expect(select.value).toBe(String(RRule.MONTHLY))
    expect(interval.value).toBe('2')
    expect(until.value).toBe('2026-12-31')
  })

  it('shows the monthly target select only for monthly rules', () => {
    const weekly = render(<RecurrencePicker block={block({ id: 'a', recurrence: 'FREQ=WEEKLY' })} onChange={vi.fn()} />)
    expect(weekly.container.querySelector('select[aria-label="Vào ngày nào trong tháng"]')).toBeNull()

    const monthly = render(
      <RecurrencePicker block={block({ id: 'b', recurrence: 'FREQ=MONTHLY' })} onChange={vi.fn()} />,
    )
    const target = monthly.container.querySelector('select[aria-label="Vào ngày nào trong tháng"]') as HTMLSelectElement
    expect(target).not.toBeNull()
    // Default: the dtstart day-of-month (no explicit BYMONTHDAY/BYDAY written).
    expect(target.value).toBe('dom:default')
  })

  it('prefills a BYMONTHDAY rule as the day-of-month target', () => {
    const { container } = render(
      <RecurrencePicker block={block({ id: 'a', recurrence: 'FREQ=MONTHLY;BYMONTHDAY=15' })} onChange={vi.fn()} />,
    )
    const target = container.querySelector('select[aria-label="Vào ngày nào trong tháng"]') as HTMLSelectElement
    expect(target.value).toBe('dom:15')
  })

  it('prefills a BYDAY+BYSETPOS rule as the weekday-ordinal target', () => {
    const { container } = render(
      <RecurrencePicker
        block={block({ id: 'a', recurrence: 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1' })}
        onChange={vi.fn()}
      />,
    )
    const target = container.querySelector('select[aria-label="Vào ngày nào trong tháng"]') as HTMLSelectElement
    expect(target.value).toBe('pos:-1')
  })

  it('writes BYMONTHDAY when an explicit day-of-month target is picked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <RecurrencePicker block={block({ id: 'a', recurrence: 'FREQ=MONTHLY' })} onChange={onChange} />,
    )
    setSelectValue(
      container.querySelector('select[aria-label="Vào ngày nào trong tháng"]') as HTMLSelectElement,
      'dom:15',
    )
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: 'FREQ=MONTHLY;BYMONTHDAY=15',
    })
  })

  it('writes BYDAY+BYSETPOS when a weekday-ordinal target is picked', () => {
    const onChange = vi.fn()
    const start = new Date('2026-08-17T02:00:00Z')
    const codes = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
    const code = codes[(start.getDay() + 6) % 7]
    const { container } = render(
      <RecurrencePicker block={block({ id: 'a', recurrence: 'FREQ=MONTHLY' })} onChange={onChange} />,
    )
    setSelectValue(
      container.querySelector('select[aria-label="Vào ngày nào trong tháng"]') as HTMLSelectElement,
      'pos:-1',
    )
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: `FREQ=MONTHLY;BYDAY=${code};BYSETPOS=-1`,
    })
  })

  it('keeps BYDAY when editing the interval (regression)', () => {
    const onChange = vi.fn()
    const { container } = render(
      <RecurrencePicker block={block({ id: 'a', recurrence: 'FREQ=WEEKLY;BYDAY=MO' })} onChange={onChange} />,
    )
    const interval = container.querySelector('input[aria-label="Khoảng lặp"]') as HTMLInputElement
    setInputValue(interval, '3')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: 'FREQ=WEEKLY;INTERVAL=3;BYDAY=MO',
    })
  })

  it('keeps BYDAY+BYSETPOS when editing UNTIL (regression)', () => {
    const onChange = vi.fn()
    const { container } = render(
      <PickerHarness initial={block({ id: 'a', recurrence: 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1' })} onChange={onChange} />,
    )
    setSelectValue(container.querySelector('select[aria-label="Kết thúc lặp lại"]') as HTMLSelectElement, 'until')
    const until = container.querySelector('input[aria-label="Lặp lại đến ngày"]') as HTMLInputElement
    setInputValue(until, '2026-12-31')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: `FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1;UNTIL=${rruleUntil('2026-12-31')}`,
    })
  })

  it('toggles weekly BYDAY chips starting from the anchored weekday', () => {
    const onChange = vi.fn()
    const { container } = render(
      <PickerHarness initial={block({ id: 'a', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
    )
    // start_time 2026-08-17 is a Monday → T2 (Thứ 2) rides the implicit, no-BYDAY default.
    const chip = (label: string) =>
      [...container.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === label)!
    expect(chip('T2').getAttribute('aria-pressed')).toBe('true')
    expect(chip('T5').getAttribute('aria-pressed')).toBe('false')

    // Add Thursday (T5) → an explicit BYDAY list replaces the anchored default.
    act(() => chip('T5').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: 'FREQ=WEEKLY;BYDAY=MO,TH',
    })

    // Drop Monday → keeps only Thursday.
    act(() => chip('T2').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: 'FREQ=WEEKLY;BYDAY=TH',
    })

    // Deselecting the last chip removes the recurrence entirely.
    act(() => chip('T5').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      recurrence: null,
    })
  })
})