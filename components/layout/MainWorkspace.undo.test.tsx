/** @vitest-environment jsdom */
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render } from '@/test/render'
import MainWorkspace from '@/components/layout/MainWorkspace'
import { useBlocksStore } from '@/store/useBlocksStore'
import type { Block, BlockInput } from '@/types'

// The tab views are lazy via next/dynamic and aren't under test here; render
// placeholders so the module graph stays light (same as MainWorkspace.test.tsx).
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const LazyPlaceholder = () => null
    return LazyPlaceholder
  },
}))

// updateBlock must land in the store without a network round-trip: merge the
// patch into the current row like the real PATCH + select round-trip.
vi.mock('@/lib/db/blocks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/blocks')>()
  return {
    ...real,
    createBlock: async (input: BlockInput): Promise<Block> => ({ id: 'evt-1', ...input }) as Block,
    updateBlock: async (id: string, patch: Partial<Block>): Promise<Block> => {
      const { useBlocksStore: store } = await import('@/store/useBlocksStore')
      const base = store.getState().blocks.find((b) => b.id === id)
      return (base ? { ...base, ...patch } : { ...patch, id }) as Block
    },
  }
})

function noteBlock(): Block {
  return {
    id: 'evt-1',
    type: 'note',
    title: 'Ghi chú A',
    content: { type: 'doc', content: [] },
    start_time: null,
    end_time: null,
    recurrence: null,
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
  }
}

async function seedAndEdit(titleAfter: string): Promise<void> {
  act(() => {
    useBlocksStore.setState({ blocks: [noteBlock()], relations: [], undoStack: [], redoStack: [] })
  })
  await act(async () => {
    await useBlocksStore.getState().updateBlock('evt-1', { title: titleAfter })
  })
}

describe('MainWorkspace undo/redo keyboard shortcuts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('undoes the last edit on Ctrl+Z and redoes it on Ctrl+Y', async () => {
    render(<MainWorkspace />)
    await seedAndEdit('Tiêu đề mới')

    expect(useBlocksStore.getState().blocks[0].title).toBe('Tiêu đề mới')

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      )
    })
    expect(useBlocksStore.getState().blocks[0].title).toBe('Ghi chú A')

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
      )
    })
    expect(useBlocksStore.getState().blocks[0].title).toBe('Tiêu đề mới')
  })

  it('redoes with Shift+Ctrl+Z (the native browser shortcut)', async () => {
    render(<MainWorkspace />)
    await seedAndEdit('Tiêu đề mới')

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      )
    })
    expect(useBlocksStore.getState().blocks[0].title).toBe('Ghi chú A')

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }),
      )
    })
    expect(useBlocksStore.getState().blocks[0].title).toBe('Tiêu đề mới')
  })

  it('treats Cmd (metaKey) the same as Ctrl', async () => {
    render(<MainWorkspace />)
    await seedAndEdit('Tiêu đề mới')

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }),
      )
    })
    expect(useBlocksStore.getState().blocks[0].title).toBe('Ghi chú A')
  })

  it('leaves native undo to editable controls (input/textarea/contenteditable)', async () => {
    const { container } = render(<MainWorkspace />)
    await seedAndEdit('Tiêu đề mới')

    const input = container.querySelector<HTMLInputElement>('[aria-label="Tìm kiếm block"]')
    expect(input).not.toBeNull()
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      )
    })
    // The handler bails for the focused input, so the edit is untouched.
    expect(useBlocksStore.getState().blocks[0].title).toBe('Tiêu đề mới')
  })

  it('ignores plain keys and unrelated shortcuts (no mod)', async () => {
    render(<MainWorkspace />)
    await seedAndEdit('Tiêu đề mới')

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }))
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }))
    })
    expect(useBlocksStore.getState().blocks[0].title).toBe('Tiêu đề mới')
  })
})
