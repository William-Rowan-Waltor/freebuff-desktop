/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

type UserStateDb = typeof import('@/lib/db/user-state')
let userState: UserStateDb
let fromMock: Mock<(table: string) => unknown>
/** Query chains created per from(table) call, keyed by table. */
let chains: Record<string, Record<string, ReturnType<typeof vi.fn>>>

function buildChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  chain.upsert = vi.fn(async () => ({ data: null, error: null }))
  chain.delete = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  return chain
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  chains = {}
  fromMock = (await import('@/lib/supabase/client')).supabase.from as unknown as Mock<
    (table: string) => unknown
  >
  // Build the chain eagerly per table so tests can configure it before the
  // module under test makes its call (from returns the pre-built chain).
  fromMock.mockImplementation((table: string) => {
    if (!chains[table]) chains[table] = buildChain()
    return chains[table]
  })
  // Pre-create the user_state chain (and clear the probe call it records) so
  // tests can configure the chain before the module under test runs.
  fromMock('user_state')
  fromMock.mockClear()
  userState = await import('@/lib/db/user-state')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchUserState', () => {
  it('returns the parsed value when the row exists', async () => {
    chains.user_state.maybeSingle.mockResolvedValueOnce({
      data: { value: { kind: 'stopwatch', running: true } },
      error: null,
    })
    expect(await userState.fetchUserState('timer')).toEqual({ kind: 'stopwatch', running: true })
  })

  it('returns undefined when the row is missing', async () => {
    expect(await userState.fetchUserState('settings')).toBeUndefined()
  })

  it('returns undefined when the server errors (offline) instead of throwing', async () => {
    chains.user_state.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'network' },
    })
    expect(await userState.fetchUserState('settings')).toBeUndefined()
  })
})

describe('saveUserState / clearUserState', () => {
  it('upserts the row with onConflict user_id,key and never throws offline', async () => {
    await userState.saveUserState('settings', { chime: 'arpeggio' })
    expect(chains.user_state.upsert).toHaveBeenCalledWith(
      { key: 'settings', value: { chime: 'arpeggio' } },
      { onConflict: 'user_id,key' },
    )
    // Offline: a rejected write is swallowed (local cache already holds it).
    chains.user_state.upsert.mockResolvedValueOnce({ data: null, error: { message: 'network' } })
    await expect(userState.saveUserState('settings', { chime: 'x' })).resolves.toBeUndefined()
  })

  it('deletes the row on clearUserState', async () => {
    await userState.clearUserState('ics-history')
    expect(chains.user_state.delete).toHaveBeenCalled()
    expect(chains.user_state.eq).toHaveBeenCalledWith('key', 'ics-history')
  })
})

describe('createServerStateStorage', () => {
  it('prefers the server row over the local cache on hydration', async () => {
    localStorage.setItem('app-settings-store', '{"state":{"chime":"local"},"version":0}')
    // The server row holds the same StorageValue zustand persists locally.
    chains.user_state.maybeSingle.mockResolvedValueOnce({
      data: { value: { state: { chime: 'server' }, version: 0 } },
      error: null,
    })
    const storage = userState.createServerStateStorage('settings')
    const value = await storage.getItem('app-settings-store')
    expect(JSON.parse(value as string).state.chime).toBe('server')
  })

  it('falls back to the local cache when offline or no server row yet', async () => {
    localStorage.setItem('app-settings-store', '{"state":{"chime":"local"},"version":0}')
    const storage = userState.createServerStateStorage('settings')
    expect(await storage.getItem('app-settings-store')).toBe(
      '{"state":{"chime":"local"},"version":0}',
    )
  })

  it('writes local first, then mirrors to the server', async () => {
    const storage = userState.createServerStateStorage('timer')
    await storage.setItem('app-timer-store', '{"state":{"kind":"countdown"},"version":0}')
    expect(localStorage.getItem('app-timer-store')).toBe(
      '{"state":{"kind":"countdown"},"version":0}',
    )
    expect(chains.user_state.upsert).toHaveBeenCalledWith(
      { key: 'timer', value: { state: { kind: 'countdown' }, version: 0 } },
      { onConflict: 'user_id,key' },
    )
    // A failed server write still leaves the local cache updated.
    chains.user_state.upsert.mockResolvedValueOnce({ data: null, error: { message: 'network' } })
    await storage.setItem('app-timer-store', '{"state":{"kind":"stopwatch"},"version":0}')
    expect(localStorage.getItem('app-timer-store')).toBe('{"state":{"kind":"stopwatch"},"version":0}')
  })

  it('removes both the local cache and the server row', async () => {
    localStorage.setItem('app-settings-store', '{"state":{},"version":0}')
    const storage = userState.createServerStateStorage('settings')
    await storage.removeItem('app-settings-store')
    expect(localStorage.getItem('app-settings-store')).toBeNull()
    expect(chains.user_state.delete).toHaveBeenCalled()
  })
})
