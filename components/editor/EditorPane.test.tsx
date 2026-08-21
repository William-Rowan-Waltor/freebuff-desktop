/** @vitest-environment jsdom */
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import EditorPane from '@/components/editor/EditorPane'
import { useBlocksStore } from '@/store/useBlocksStore'
import type { Block, BlockInput, BlockRelation, RelationType } from '@/types'

// The split/override paths go through the blocks store, which hits the db
// layer; swap those for in-memory versions so the split test needs no network.
vi.mock('@/lib/db/blocks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/blocks')>()
  return {
    ...real,
    createBlock: async (input: BlockInput): Promise<Block> => ({ id: 'split-new', ...input }) as Block,
    updateBlock: async (id: string, patch: Partial<Block>): Promise<Block> => {
      const { useBlocksStore: store } = await import('@/store/useBlocksStore')
      const base = store.getState().blocks.find((b) => b.id === id)
      return (base ? { ...base, ...patch } : { ...patch, id }) as Block
    },
    createRelation: async (
      parentId: string,
      childId: string,
      relationType: RelationType,
    ): Promise<BlockRelation> => ({ parent_id: parentId, child_id: childId, relation_type: relationType }),
    deleteBlock: async (): Promise<void> => undefined,
    deleteRelation: async (): Promise<void> => undefined,
    // Keep deletes on the proven hard-delete path in tests (no network probe).
    isSoftDeleteSupported: async (): Promise<boolean> => false,
  }
})

function eventBlock(overrides: Partial<Block> & { id: string }): Block {
  return {
    type: 'event',
    title: 'Họp định kỳ',
    content: { type: 'doc', content: [] },
    start_time: '2026-08-14T02:00:00Z',
    end_time: '2026-08-14T03:00:00Z',
    recurrence: null,
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
    ...overrides,
  }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('EditorPane recurring datetime edits', () => {
  it('holds a datetime edit on a recurring event behind the "this vs all" modal', () => {
    const onChange = vi.fn()
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
      { resetStores: false },
    )

    const start = container.querySelector<HTMLInputElement>('input[type="datetime-local"]')
    expect(start).not.toBeNull()
    setInputValue(start!, '2026-08-21T04:00')

    // The edit is NOT committed silently to the whole series.
    expect(onChange).not.toHaveBeenCalled()
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('Chỉ sự kiện này')
    expect(dialog!.textContent).toContain('Tất cả các lần')
  })

  it('applies the edit to the whole series on "Tất cả các lần"', () => {
    const onChange = vi.fn()
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
      { resetStores: false },
    )

    setInputValue(
      container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!,
      '2026-08-21T04:00',
    )
    act(() => {
      const allBtn = [...container.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Tất cả các lần',
      )
      expect(allBtn).toBeDefined()
      allBtn!.click()
    })

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rec' }),
      expect.objectContaining({ start_time: new Date('2026-08-21T04:00').toISOString() }),
    )
  })

  it('commits datetime edits immediately for non-recurring events', () => {
    const onChange = vi.fn()
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'plain' })} onChange={onChange} />,
      { resetStores: false },
    )

    setInputValue(
      container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!,
      '2026-08-21T09:00',
    )

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'plain' }),
      expect.objectContaining({ start_time: new Date('2026-08-21T09:00').toISOString() }),
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('lists excluded occurrences of a recurring event and restores one on click', () => {
    const onChange = vi.fn()
    const { container } = render(
      <EditorPane
        block={eventBlock({
          id: 'rec',
          recurrence: 'FREQ=WEEKLY',
          recurrence_exceptions: ['2026-08-17T02:00:00Z'],
        })}
        onChange={onChange}
      />,
      { resetStores: false },
    )

    expect(container.textContent).toContain('Lần đã loại trừ')
    const restore = container.querySelector<HTMLButtonElement>('[aria-label^="Khôi phục lần"]')
    expect(restore).not.toBeNull()
    act(() => restore!.click())

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rec' }),
      expect.objectContaining({ recurrence_exceptions: [] }),
    )
  })

  it('offers an .ics export for events with a start time (recurring or not)', () => {
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })} onChange={vi.fn()} />,
      { resetStores: false },
    )
    expect(container.textContent).toContain('Xuất .ics')
  })

  it('hides the exception manager when there is nothing to restore', () => {
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })} onChange={vi.fn()} />,
      { resetStores: false },
    )
    expect(container.textContent).not.toContain('Lần đã loại trừ')
  })

  it('splits the series on "Tất cả các lần sau lần này" (new master + old exceptions)', async () => {
    const onChange = vi.fn()
    useBlocksStore.setState({
      blocks: [eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY', recurrence_exceptions: null })],
      relations: [],
    })
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
      { resetStores: false },
    )

    // Edit the start to Thursday 00:00 local (always before Friday 02:00Z, the
    // series' weekly occurrence, in any timezone), then pick the
    // this-and-future action.
    setInputValue(
      container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!,
      '2026-08-20T00:00',
    )
    const splitBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Tất cả các lần sau lần này'),
    )
    expect(splitBtn).toBeDefined()
    act(() => splitBtn!.click())

    // The new recurring master is created and the old one gained the exception.
    await waitFor(() => useBlocksStore.getState().blocks.some((b) => b.id === 'split-new'))
    const blocks = useBlocksStore.getState().blocks
    const next = blocks.find((b) => b.id === 'split-new')!
    expect(next.recurrence).toBe('FREQ=WEEKLY')
    expect(next.start_time).toBe(new Date('2026-08-20T00:00').toISOString())
    const master = blocks.find((b) => b.id === 'rec')!
    expect(master.recurrence_exceptions ?? []).toContain('2026-08-21T02:00:00.000Z')
  })

  it('replaces the old master when "Tất cả các lần sau lần này" lands at/before the original start', async () => {
    const onChange = vi.fn()
    useBlocksStore.setState({
      blocks: [eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })],
      relations: [],
    })
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
      { resetStores: false },
    )

    // 2026-08-13 00:00 local is at/before 2026-08-14T02:00:00Z (the first
    // occurrence) in every timezone, so the split covers the whole series.
    setInputValue(
      container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!,
      '2026-08-13T00:00',
    )
    const splitBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Tất cả các lần sau lần này'),
    )
    expect(splitBtn).toBeDefined()
    act(() => splitBtn!.click())

    // The dead old master is removed and the new recurring master takes over.
    await waitFor(() => !useBlocksStore.getState().blocks.some((b) => b.id === 'rec'))
    const blocks = useBlocksStore.getState().blocks
    const next = blocks.find((b) => b.id === 'split-new')!
    expect(next.recurrence).toBe('FREQ=WEEKLY')
    expect(next.start_time).toBe(new Date('2026-08-13T00:00').toISOString())
    // updateBlock must not run (the non-dead branch) and no attach happens.
    expect(blocks.find((b) => b.id === 'rec')).toBeUndefined()
    expect(useBlocksStore.getState().relations).toEqual([])
  })

  it('relinks this-and-future overrides to the new master and keeps pre-split ones on the old', async () => {
    const onChange = vi.fn()
    useBlocksStore.setState({
      blocks: [
        eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' }),
        eventBlock({ id: 'past', start_time: '2026-08-14T02:00:00.000Z', end_time: '2026-08-14T03:00:00.000Z' }),
        eventBlock({
          id: 'future',
          start_time: '2026-08-21T02:00:00.000Z',
          end_time: '2026-08-21T03:00:00.000Z',
        }),
      ],
      relations: [
        { parent_id: 'rec', child_id: 'past', relation_type: 'attached' },
        { parent_id: 'rec', child_id: 'future', relation_type: 'attached' },
      ],
    })
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })} onChange={onChange} />,
      { resetStores: false },
    )

    // 2026-08-20T00:00 local always lands between the first occurrence
    // (08-14T02:00Z) and the next (08-21T02:00Z) in every timezone, so the
    // 'future' override is in the this-and-future range and 'past' is not.
    setInputValue(
      container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!,
      '2026-08-20T00:00',
    )
    const splitBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Tất cả các lần sau lần này'),
    )
    expect(splitBtn).toBeDefined()
    act(() => splitBtn!.click())

    await waitFor(() => useBlocksStore.getState().blocks.some((b) => b.id === 'split-new'))
    const relations = useBlocksStore.getState().relations
    // Pre-split override stays on the old master.
    expect(relations).toContainEqual(expect.objectContaining({ parent_id: 'rec', child_id: 'past' }))
    // The this-and-future override moved off the old master onto the new one.
    expect(relations).not.toContainEqual(expect.objectContaining({ parent_id: 'rec', child_id: 'future' }))
    expect(relations).toContainEqual(expect.objectContaining({ parent_id: 'split-new', child_id: 'future' }))
  })

  it('previews the next five occurrences of a recurring event ("5 lần kế tiếp")', () => {
    const onChange = vi.fn()
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'rec', recurrence: 'FREQ=DAILY' })} onChange={onChange} />,
      { resetStores: false },
    )

    const heading = [...container.querySelectorAll('p')].find((p) => p.textContent === '5 lần kế tiếp')
    expect(heading).toBeDefined()
    const items = heading!.parentElement!.querySelectorAll('li')
    // A strict bounded preview: exactly five upcoming dates, none blank.
    expect(items).toHaveLength(5)
    items.forEach((li) => expect(li.textContent!.trim()).not.toBe(''))
  })

  it('imports a real .ics file through the "Nhập .ics" button into the store', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <EditorPane
        block={eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })}
        onChange={onChange}
      />,
      { resetStores: false },
    )
    useBlocksStore.setState({ blocks: [], relations: [] })

    // A minimal external VCALENDAR: one recurring master (title from SUMMARY).
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//FreeBuffed//Schedule iOS V1.0//EN',
      'BEGIN:VEVENT',
      'UID:imported-master-1',
      'DTSTART:20260901T090000Z',
      'DTEND:20260901T100000Z',
      'SUMMARY:Họp nhập ICS',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    // 'Nhập .ics' opens the hidden file input; fire a change with a real File.
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Nhập .ics')
    expect(btn).toBeDefined()
    act(() => btn!.click())
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    const file = new File([ics], 'import.ics', { type: 'text/calendar' })
    Object.defineProperty(input!, 'files', { value: [file], configurable: true })
    act(() => {
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // The master lands in the store via addBlock and the status message shows.
    await waitFor(() => container.textContent?.includes('Đã nhập 1 sự kiện') ?? false)
    expect(useBlocksStore.getState().blocks.some((b) => b.title === 'Họp nhập ICS')).toBe(true)
  })
})

describe('EditorPane markdown shortcut cheatsheet', () => {
  it('opens via the toolbar button, lists syntax + shortcuts, and closes on Escape', () => {
    const onChange = vi.fn()
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'note-1' })} onChange={onChange} />,
      { resetStores: false },
    )

    // The toolbar's keyboard button is the discoverable entry point.
    const kb = container.querySelector<HTMLButtonElement>('button[aria-label="Phím tắt Markdown"]')
    expect(kb).not.toBeNull()
    act(() => kb!.click())
    const dialog = container.querySelector('[role="dialog"][aria-label="Phím tắt Markdown"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('Ctrl/Cmd + B')
    expect(dialog!.textContent).toContain('**Văn bản**')
    expect(dialog!.textContent).toContain('- [ ] Việc')

    // Escape closes the overlay.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('[role="dialog"][aria-label="Phím tắt Markdown"]')).toBeNull()
  })

  it('toggles with Ctrl/Cmd + / from anywhere in the pane', () => {
    const onChange = vi.fn()
    const { container } = render(
      <EditorPane block={eventBlock({ id: 'note-2' })} onChange={onChange} />,
      { resetStores: false },
    )

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true }))
    })
    expect(container.querySelector('[role="dialog"][aria-label="Phím tắt Markdown"]')).not.toBeNull()

    // A second press closes it again.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true }))
    })
    expect(container.querySelector('[role="dialog"][aria-label="Phím tắt Markdown"]')).toBeNull()
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}
