import { describe, expect, it, vi } from 'vitest'
import { createOverride, splitSeries, type OverrideDeps } from '@/lib/override'
import type { Block } from '@/types'

function deps(overrides: Partial<OverrideDeps> = {}): OverrideDeps {
  return {
    addBlock: vi.fn(async () => ({ ...master({ id: 'ov', recurrence: null }) })) as OverrideDeps['addBlock'],
    attach: vi.fn(async () => undefined) as OverrideDeps['attach'],
    updateBlock: vi.fn(async () => undefined) as OverrideDeps['updateBlock'],
    removeBlock: vi.fn(async () => undefined) as OverrideDeps['removeBlock'],
    beginBatch: vi.fn() as OverrideDeps['beginBatch'],
    endBatch: vi.fn() as OverrideDeps['endBatch'],
    ...overrides,
  }
}

function master(overrides: Partial<Block> & { id: string }): Block {
  return {
    type: 'event',
    title: 'Họp',
    content: { type: 'doc', content: [] },
    start_time: '2026-08-14T02:00:00Z',
    end_time: '2026-08-14T03:00:00Z',
    recurrence: 'FREQ=WEEKLY',
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
    ...overrides,
  }
}

describe('createOverride', () => {
  it('creates a non-recurring block at the patched times, links it, and records the exception', async () => {
    const d = deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'ov-1', recurrence: null }) })) as OverrideDeps['addBlock'] })
    const m = master({ id: 'm' })
    await createOverride(
      d,
      m,
      { start_time: '2026-08-21T04:00:00Z', end_time: '2026-08-21T05:00:00Z' },
      '2026-08-14T02:00:00Z',
    )
    expect(d.addBlock).toHaveBeenCalledWith({
      type: 'event',
      title: 'Họp',
      content: m.content,
      start_time: '2026-08-21T04:00:00Z',
      end_time: '2026-08-21T05:00:00Z',
      recurrence: null,
      recurrence_exceptions: null,
    })
    expect(d.attach).toHaveBeenCalledWith('m', 'ov-1', 'attached')
    expect(d.updateBlock).toHaveBeenCalledWith('m', { recurrence_exceptions: ['2026-08-14T02:00:00Z'] })
    expect(d.beginBatch).toHaveBeenCalledOnce()
    expect(d.endBatch).toHaveBeenCalledOnce()
  })

  it('keeps the master times when the patch omits them', async () => {
    const d = deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'ov-1' }) })) as OverrideDeps['addBlock'] })
    await createOverride(
      d,
      master({ id: 'm' }),
      {},
      null,
    )
    expect(d.addBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        start_time: '2026-08-14T02:00:00Z',
        end_time: '2026-08-14T03:00:00Z',
      }),
    )
  })

  it('appends the exception to existing ones', async () => {
    const d = deps({
      addBlock: vi.fn(async () => ({ ...master({ id: 'ov-1' }) })) as OverrideDeps['addBlock'],
    })
    await createOverride(
      d,
      master({ id: 'm', recurrence_exceptions: ['2026-08-07T02:00:00Z'] }),
      { start_time: '2026-08-21T04:00:00Z' },
      '2026-08-14T02:00:00Z',
    )
    expect(d.updateBlock).toHaveBeenCalledWith('m', {
      recurrence_exceptions: ['2026-08-07T02:00:00Z', '2026-08-14T02:00:00Z'],
    })
  })

  it('skips the exception update when originalStart is null', async () => {
    const d = deps({
      addBlock: vi.fn(async () => ({ ...master({ id: 'ov-1' }) })) as OverrideDeps['addBlock'],
    })
    await createOverride(
      d,
      master({ id: 'm' }),
      { start_time: '2026-08-21T04:00:00Z' },
      null,
    )
    expect(d.updateBlock).not.toHaveBeenCalled()
  })

  it('does not duplicate an exception that is already listed (double edit of the same occurrence)', async () => {
    const d = deps({
      addBlock: vi.fn(async () => ({ ...master({ id: 'ov-1' }) })) as OverrideDeps['addBlock'],
    })
    await createOverride(
      d,
      master({ id: 'm', recurrence_exceptions: ['2026-08-14T02:00:00Z'] }),
      { start_time: '2026-08-21T04:00:00Z' },
      '2026-08-14T02:00:00Z',
    )
    // The occurrence is already excluded — nothing new is appended, so a second
    // override for the same slot leaves the exception list unchanged.
    expect(d.updateBlock).not.toHaveBeenCalled()
  })

  it('records a date-only exception for an all-day series (calendar drag path)', async () => {
    // FullCalendar reports an all-day occurrence's old start as startStr
    // (date-only, no time) — createOverride must store it in that same shape so
    // lib/recurrence's date-only exdate handling excludes exactly that day.
    const d = deps({
      addBlock: vi.fn(async () => ({ ...master({ id: 'ov-1', recurrence: null }) })) as OverrideDeps['addBlock'],
    })
    await createOverride(
      d,
      master({ id: 'm', start_time: '2026-08-17', end_time: '2026-08-17', recurrence: 'FREQ=WEEKLY' }),
      { start_time: '2026-08-24', end_time: '2026-08-24' },
      '2026-08-17',
    )
    expect(d.updateBlock).toHaveBeenCalledWith('m', { recurrence_exceptions: ['2026-08-17'] })
  })

  it('uses the patched content when provided', async () => {
    const d = deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'ov-1' }) })) as OverrideDeps['addBlock'] })
    const content = { type: 'doc', content: [{ type: 'paragraph' }] }
    await createOverride(
      d,
      master({ id: 'm' }),
      { content },
      null,
    )
    expect(d.addBlock).toHaveBeenCalledWith(expect.objectContaining({ content }))
  })
})

describe('splitSeries', () => {
  it('excludes the split-and-future occurrences from the old master and creates a new recurring master', async () => {
    const d = deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'next' }) })) as OverrideDeps['addBlock'] })
    await splitSeries(
      d,
      master({ id: 'm' }),
      { start_time: '2026-08-21T02:00:00Z', end_time: '2026-08-21T03:00:00Z' },
    )
    expect(d.updateBlock).toHaveBeenCalledWith('m', {
      recurrence_exceptions: expect.arrayContaining(['2026-08-21T02:00:00.000Z']),
    })
    expect(d.removeBlock).not.toHaveBeenCalled()
    expect(d.addBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'event',
        title: 'Họp',
        start_time: '2026-08-21T02:00:00Z',
        end_time: '2026-08-21T03:00:00Z',
        recurrence: 'FREQ=WEEKLY',
        recurrence_exceptions: null,
      }),
    )
    expect(d.attach).toHaveBeenCalledWith('m', 'next', 'attached')
    expect(d.beginBatch).toHaveBeenCalledOnce()
    expect(d.endBatch).toHaveBeenCalledOnce()
  })

  it('carries exceptions at/after the split into the new master and keeps earlier ones on the old', async () => {
    const d = deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'next' }) })) as OverrideDeps['addBlock'] })
    await splitSeries(
      d,
      master({
        id: 'm',
        recurrence_exceptions: ['2026-08-14T02:00:00.000Z', '2026-08-28T02:00:00.000Z'],
      }),
      { start_time: '2026-08-21T02:00:00Z' },
    )
    expect(d.addBlock).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence_exceptions: ['2026-08-28T02:00:00.000Z'] }),
    )
  })

  it('deletes the emptied old master when the split is at its original start', async () => {
    const d = deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'next' }) })) as OverrideDeps['addBlock'] })
    await splitSeries(
      d,
      master({ id: 'm', recurrence_exceptions: ['2026-08-07T02:00:00.000Z'] }),
      { start_time: '2026-08-14T02:00:00Z', end_time: '2026-08-14T03:30:00Z' },
    )
    // The old master would hold zero occurrences — replace it instead of hiding it.
    expect(d.updateBlock).not.toHaveBeenCalled()
    expect(d.attach).not.toHaveBeenCalled()
    expect(d.removeBlock).toHaveBeenCalledWith('m')
    expect(d.addBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'event',
        title: 'Họp',
        start_time: '2026-08-14T02:00:00Z',
        end_time: '2026-08-14T03:30:00Z',
        recurrence: 'FREQ=WEEKLY',
        // The exception predates the split, so it does not carry into the new series.
        recurrence_exceptions: null,
      }),
    )
  })

  it('relinks this-occurrence overrides at/after the split to the new master and keeps earlier ones', async () => {
    const d = deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'next' }) })) as OverrideDeps['addBlock'] })
    const detach = vi.fn(async () => undefined)
    const ovFuture = master({ id: 'ov-f', start_time: '2026-08-28T02:00:00Z', recurrence: null })
    const ovPast = master({ id: 'ov-p', start_time: '2026-08-14T02:00:00Z', recurrence: null })
    await splitSeries(
      d,
      master({ id: 'm' }),
      { start_time: '2026-08-21T02:00:00Z' },
      { detach, overrides: [ovFuture, ovPast] },
    )
    // The future override belongs to the new series and is relinked.
    expect(detach).toHaveBeenCalledWith('m', 'ov-f')
    expect(d.attach).toHaveBeenCalledWith('next', 'ov-f', 'attached')
    // The past override stays on the old master.
    expect(detach).not.toHaveBeenCalledWith('m', 'ov-p')
  })

  it('does not relink when no relink deps are given', async () => {
    const detach = vi.fn(async () => undefined)
    await splitSeries(
      deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'next' }) })) as OverrideDeps['addBlock'] }),
      master({ id: 'm' }),
      { start_time: '2026-08-21T02:00:00Z' },
    )
    expect(detach).not.toHaveBeenCalled()
  })

  it('relinks every override before deleting the old master in the dead-master case', async () => {
    const d = deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'next' }) })) as OverrideDeps['addBlock'] })
    const detach = vi.fn(async () => undefined)
    const ov = master({ id: 'ov-1', start_time: '2026-08-21T02:00:00Z', recurrence: null })
    await splitSeries(
      d,
      master({ id: 'm' }),
      { start_time: '2026-08-14T02:00:00Z' },
      { detach, overrides: [ov] },
    )
    expect(detach).toHaveBeenCalledWith('m', 'ov-1')
    expect(d.attach).toHaveBeenCalledWith('next', 'ov-1', 'attached')
    expect(d.removeBlock).toHaveBeenCalledWith('m')
  })

  it('deletes the emptied old master when the split is before its original start', async () => {
    const d = deps({ addBlock: vi.fn(async () => ({ ...master({ id: 'next' }) })) as OverrideDeps['addBlock'] })
    await splitSeries(
      d,
      master({ id: 'm' }),
      { start_time: '2026-08-07T02:00:00Z' },
    )
    expect(d.removeBlock).toHaveBeenCalledWith('m')
    expect(d.addBlock).toHaveBeenCalledWith(expect.objectContaining({ start_time: '2026-08-07T02:00:00Z' }))
  })

  it('no-ops without a start_time or on a non-recurring master', async () => {
    const d = { addBlock: vi.fn(), attach: vi.fn(), updateBlock: vi.fn(), removeBlock: vi.fn(), beginBatch: vi.fn(), endBatch: vi.fn() }
    await splitSeries(d, master({ id: 'm' }), {})
    expect(d.addBlock).not.toHaveBeenCalled()
    expect(d.updateBlock).not.toHaveBeenCalled()
    await splitSeries(d, master({ id: 'm', recurrence: null }), { start_time: '2026-08-21T02:00:00Z' })
    expect(d.addBlock).not.toHaveBeenCalled()
  })
})
