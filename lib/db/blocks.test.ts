import { beforeEach, describe, expect, it, vi } from 'vitest'

type Chain = {
  select: () => Chain
  order: () => Chain
  limit: () => Chain
  eq: () => Chain
  is: () => Chain
  not: () => Chain
  lt: () => Chain
  single: () => Promise<{ data: unknown; error: { message: string } | null }>
  insert: (payload: unknown) => Chain
  update: (payload: unknown) => Chain
  delete: () => Chain
  then?: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise<unknown>
}

interface ClientCfg {
  /** Result of terminal select chains (probe + reads). */
  selectResult?: { data: unknown; error: { message: string } | null }
  /** Result of insert/update `.single()` calls. */
  singleResult?: { data: unknown; error: { message: string } | null }
}

// The query-builder chains in lib/db/blocks terminate either by being awaited
// (select/delete chains) or via `.single()` (insert/update). A single thenable
// chain that routes to the configured result covers both; method calls are
// recorded so tests can assert the shape of the query (e.g. the soft-delete
// `is('deleted_at', null)` filter).
function fakeClient(cfg: ClientCfg): {
  from: () => Chain
  recorded: { insert?: unknown; update?: unknown; calls: string[] }
} {
  const recorded: { insert?: unknown; update?: unknown; calls: string[] } = {
    insert: undefined,
    update: undefined,
    calls: [],
  }
  const terminal = (): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve(cfg.selectResult ?? { data: null, error: null })
  const chain = (): Chain => {
    const q: Chain = {
      select: () => {
        recorded.calls.push('select')
        return q
      },
      order: () => {
        recorded.calls.push('order')
        return q
      },
      limit: () => {
        recorded.calls.push('limit')
        return q
      },
      eq: () => {
        recorded.calls.push('eq')
        return q
      },
      is: () => {
        recorded.calls.push('is')
        return q
      },
      not: () => {
        recorded.calls.push('not')
        return q
      },
      lt: () => {
        recorded.calls.push('lt')
        return q
      },
      single: () => {
        recorded.calls.push('single')
        return Promise.resolve(cfg.singleResult ?? { data: null, error: null })
      },
      insert: (payload: unknown) => {
        recorded.insert = payload
        recorded.calls.push('insert')
        return q
      },
      update: (payload: unknown) => {
        recorded.update = payload
        recorded.calls.push('update')
        return q
      },
      delete: () => {
        recorded.calls.push('delete')
        return q
      },
    }
    q.then = (resolve, reject) => terminal().then(resolve, reject)
    return q
  }
  return { from: () => chain(), recorded }
}

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn() } }))

type BlocksDb = typeof import('@/lib/db/blocks')
let blocks: BlocksDb
let supabaseFrom: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  blocks = await import('@/lib/db/blocks')
  const client = (await import('@/lib/supabase/client')) as unknown as {
    supabase: { from: ReturnType<typeof vi.fn> }
  }
  supabaseFrom = client.supabase.from
})

describe('isRecurrenceSupported', () => {
  it('reports unsupported when the select errors with a missing column', async () => {
    const { from } = fakeClient({
      selectResult: { data: null, error: { message: "column blocks.recurrence does not exist" } },
    })
    supabaseFrom.mockReturnValue(from())
    expect(await blocks.isRecurrenceSupported()).toBe(false)
    expect(await blocks.isRecurrenceSupported()).toBe(false)
    // The probe is cached — the API is hit exactly once.
    expect(supabaseFrom).toHaveBeenCalledTimes(1)
  })

  it('reports supported on a clean probe', async () => {
    const { from } = fakeClient({ selectResult: { data: [], error: null } })
    supabaseFrom.mockReturnValue(from())
    expect(await blocks.isRecurrenceSupported()).toBe(true)
  })

  it('assumes supported on unrelated errors so real failures still surface', async () => {
    const { from } = fakeClient({
      selectResult: { data: null, error: { message: 'network error' } },
    })
    supabaseFrom.mockReturnValue(from())
    expect(await blocks.isRecurrenceSupported()).toBe(true)
  })
})

describe('createBlock degradation', () => {
  it('strips the recurrence rule when unsupported and reports a one-off block', async () => {
    const { from, recorded } = fakeClient({
      selectResult: { data: null, error: { message: 'column blocks.recurrence does not exist' } },
      singleResult: {
        data: { id: 'x', type: 'event', recurrence: 'FREQ=WEEKLY' },
        error: null,
      },
    })
    supabaseFrom.mockReturnValue(from())
    const out = await blocks.createBlock({
      type: 'event',
      title: 't',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-08-21T02:00:00.000Z'],
    })
    // The insert payload no longer names the missing columns.
    expect(recorded.insert).not.toHaveProperty('recurrence')
    expect(recorded.insert).not.toHaveProperty('recurrence_exceptions')
    // The caller sees a well-formed one-off block, not a phantom rule.
    expect(out.recurrence).toBeNull()
    expect(out.recurrence_exceptions).toBeNull()
  })

  it('keeps the rule when recurrence is supported', async () => {
    const { from, recorded } = fakeClient({
      selectResult: { data: [], error: null },
      singleResult: {
        data: { id: 'x', type: 'event', recurrence: 'FREQ=WEEKLY' },
        error: null,
      },
    })
    supabaseFrom.mockReturnValue(from())
    const out = await blocks.createBlock({ type: 'event', recurrence: 'FREQ=WEEKLY' })
    expect(recorded.insert).toHaveProperty('recurrence', 'FREQ=WEEKLY')
    expect(out.recurrence).toBe('FREQ=WEEKLY')
  })

  it('does not probe when the input has no recurrence fields', async () => {
    const { from, recorded } = fakeClient({
      singleResult: { data: { id: 'x', type: 'note' }, error: null },
    })
    supabaseFrom.mockReturnValue(from())
    await blocks.createBlock({ type: 'note', title: 'hi' })
    expect(recorded.insert).not.toHaveProperty('recurrence')
    expect(supabaseFrom).toHaveBeenCalledTimes(1) // insert only, no probe
  })
})

describe('updateBlock degradation', () => {
  it('strips recurrence writes (even explicit null) when unsupported', async () => {
    const { from, recorded } = fakeClient({
      selectResult: { data: null, error: { message: 'column blocks.recurrence does not exist' } },
      singleResult: { data: { id: 'x', type: 'event' }, error: null },
    })
    supabaseFrom.mockReturnValue(from())
    await blocks.updateBlock('x', { recurrence: null, title: 'new' })
    expect(recorded.update).not.toHaveProperty('recurrence')
    expect(recorded.update).toHaveProperty('title', 'new')
  })

  it('keeps recurrence writes when supported', async () => {
    const { from, recorded } = fakeClient({
      selectResult: { data: [], error: null },
      singleResult: { data: { id: 'x', type: 'event', recurrence: 'FREQ=WEEKLY' }, error: null },
    })
    supabaseFrom.mockReturnValue(from())
    await blocks.updateBlock('x', { recurrence: 'FREQ=WEEKLY' })
    expect(recorded.update).toHaveProperty('recurrence', 'FREQ=WEEKLY')
  })
})

describe('fetchBlocks normalization', () => {
  it('normalizes missing recurrence fields to null', async () => {
    const { from } = fakeClient({
      selectResult: { data: [{ id: 'a', type: 'event' }], error: null },
    })
    supabaseFrom.mockReturnValue(from())
    const [row] = await blocks.fetchBlocks()
    expect(row.recurrence).toBeNull()
    expect(row.recurrence_exceptions).toBeNull()
  })
})

describe('soft delete', () => {
  it('probes deleted_at once and caches the result', async () => {
    const { from } = fakeClient({
      selectResult: { data: null, error: { message: 'column blocks.deleted_at does not exist' } },
    })
    supabaseFrom.mockReturnValue(from())
    expect(await blocks.isSoftDeleteSupported()).toBe(false)
    expect(await blocks.isSoftDeleteSupported()).toBe(false)
    expect(supabaseFrom).toHaveBeenCalledTimes(1)
  })

  it('filters soft-deleted rows when the tombstone exists', async () => {
    const { from, recorded } = fakeClient({ selectResult: { data: [], error: null } })
    supabaseFrom.mockReturnValue(from())
    await blocks.fetchBlocks()
    expect(recorded.calls).toContain('is')
  })

  it('omits the deleted_at filter when the tombstone is missing (fallback)', async () => {
    const probe = fakeClient({
      selectResult: { data: null, error: { message: 'column blocks.deleted_at does not exist' } },
    })
    const fetch = fakeClient({ selectResult: { data: [], error: null } })
    // fetchBlocks builds its query FIRST, then probes — so from() #1 is the
    // fetch, #2 is the probe.
    supabaseFrom.mockReturnValueOnce(fetch.from()).mockReturnValueOnce(probe.from())
    await blocks.fetchBlocks()
    expect(fetch.recorded.calls).not.toContain('is')
  })

  it('softDeleteBlock updates deleted_at; restoreBlock clears it', async () => {
    const { from, recorded } = fakeClient({
      selectResult: { data: [], error: null },
      singleResult: { data: { id: 'x' }, error: null },
    })
    supabaseFrom.mockReturnValue(from())
    await blocks.softDeleteBlock('x')
    expect(recorded.update).toMatchObject({ deleted_at: expect.any(String) })
    recorded.update = undefined
    await blocks.restoreBlock('x')
    expect(recorded.update).toEqual({ deleted_at: null })
  })

  it('purgeDeletedBlocks hard-deletes tombstones older than the cutoff', async () => {
    const { from, recorded } = fakeClient({ selectResult: { data: [], error: null } })
    supabaseFrom.mockReturnValue(from())
    await blocks.purgeDeletedBlocks(7)
    expect(recorded.calls).toEqual(expect.arrayContaining(['delete', 'lt']))
  })

  it('falls back to hard delete on any probe error (network/RLS), not just missing columns', async () => {
    const { from } = fakeClient({ selectResult: { data: null, error: { message: 'fetch failed' } } })
    supabaseFrom.mockReturnValue(from())
    expect(await blocks.isSoftDeleteSupported()).toBe(false)
  })

  it('purgeDeletedBlocks is a no-op when the tombstone is missing', async () => {
    const { from, recorded } = fakeClient({
      selectResult: { data: null, error: { message: 'column blocks.deleted_at does not exist' } },
    })
    supabaseFrom.mockReturnValue(from())
    await blocks.purgeDeletedBlocks(7)
    expect(recorded.calls).not.toContain('delete')
  })
})

describe('trash (fetchDeletedBlocks / purgeBlock)', () => {
  it('returns [] when the tombstone column is missing', async () => {
    const { from } = fakeClient({
      selectResult: { data: null, error: { message: 'column blocks.deleted_at does not exist' } },
    })
    supabaseFrom.mockReturnValue(from())
    expect(await blocks.fetchDeletedBlocks()).toEqual([])
  })

  it('lists soft-deleted rows newest-first, filtering on deleted_at is not null', async () => {
    const rows = [
      { id: 't1', type: 'event', title: 'old', deleted_at: '2026-08-10T00:00:00.000Z' },
      { id: 't2', type: 'note', title: 'newer', deleted_at: '2026-08-15T00:00:00.000Z' },
    ]
    const { from, recorded } = fakeClient({ selectResult: { data: rows, error: null } })
    supabaseFrom.mockReturnValue(from())
    const out = await blocks.fetchDeletedBlocks()
    expect(out.map((b) => b.id)).toEqual(['t1', 't2'])
    expect(recorded.calls).toEqual(expect.arrayContaining(['not', 'select', 'order']))
    expect(recorded.calls).not.toContain('is') // not(...) rather than is(...)
  })

  it('purgeBlock hard-deletes a single tombstone by id', async () => {
    const { from, recorded } = fakeClient({ selectResult: { data: null, error: null } })
    supabaseFrom.mockReturnValue(from())
    await blocks.purgeBlock('t1')
    expect(recorded.calls).toEqual(expect.arrayContaining(['delete', 'eq']))
  })
})

describe('priority/status support', () => {
  it('isPriorityStatusSupported returns true when columns exist', async () => {
    const { from } = fakeClient({ selectResult: { data: [{}], error: null } })
    supabaseFrom.mockReturnValue(from())
    expect(await blocks.isPriorityStatusSupported()).toBe(true)
  })

  it('isPriorityStatusSupported returns false when columns are missing', async () => {
    const { from } = fakeClient({
      selectResult: { data: null, error: { message: 'column blocks.priority does not exist' } },
    })
    supabaseFrom.mockReturnValue(from())
    expect(await blocks.isPriorityStatusSupported()).toBe(false)
  })

  it('createBlock strips priority/status when columns are missing', async () => {
    const { from, recorded } = fakeClient({
      selectResult: { data: null, error: { message: 'column blocks.priority does not exist' } },
      singleResult: {
        data: { id: 'b1', type: 'note', priority: null, status: null },
        error: null,
      },
    })
    supabaseFrom.mockReturnValue(from())
    const block = await blocks.createBlock({ type: 'note', priority: 'urgent', status: 'approved' })
    expect(recorded.insert).not.toHaveProperty('priority')
    expect(recorded.insert).not.toHaveProperty('status')
    expect(block.priority).toBeNull()
    expect(block.status).toBeNull()
  })

  it('createBlock keeps priority/status when columns exist', async () => {
    const { from, recorded } = fakeClient({
      selectResult: { data: [{}], error: null },
      singleResult: {
        data: { id: 'b2', type: 'event', priority: 'urgent', status: 'approved' },
        error: null,
      },
    })
    supabaseFrom.mockReturnValue(from())
    const block = await blocks.createBlock({ type: 'event', priority: 'urgent', status: 'approved' })
    expect(recorded.insert).toHaveProperty('priority', 'urgent')
    expect(recorded.insert).toHaveProperty('status', 'approved')
    expect(block.priority).toBe('urgent')
    expect(block.status).toBe('approved')
  })

  it('fetchBlocks normalizes null priority/status', async () => {
    const { from } = fakeClient({
      selectResult: {
        data: [
          { id: 'b1', type: 'note', priority: null, status: null },
          { id: 'b2', type: 'event', priority: 'high', status: 'completed' },
        ],
        error: null,
      },
    })
    supabaseFrom.mockReturnValue(from())
    const result = await blocks.fetchBlocks()
    expect(result[0].priority).toBeNull()
    expect(result[0].status).toBeNull()
    expect(result[1].priority).toBe('high')
    expect(result[1].status).toBe('completed')
  })
})
