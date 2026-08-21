/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

type WorkspacesDb = typeof import('@/lib/db/workspaces')
let workspaces: WorkspacesDb
let fromMock: ReturnType<typeof vi.fn>
let rpcMock: ReturnType<typeof vi.fn>

const WS = {
  id: 'ws-1',
  name: 'Không gian của tôi',
  share_code: 'ABCD1234',
  created_by: 'u1',
  created_at: '2026-01-01',
}

function chainFor(data: unknown, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.order = vi.fn(async () => ({ data, error }))
  return chain
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  const client = (await import('@/lib/supabase/client')) as unknown as {
    supabase: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }
  }
  fromMock = client.supabase.from
  rpcMock = client.supabase.rpc
  fromMock.mockReturnValue(chainFor([]))
  rpcMock.mockResolvedValue({ data: WS, error: null })
  workspaces = await import('@/lib/db/workspaces')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('active workspace id', () => {
  it('defaults to null and persists to localStorage', () => {
    expect(workspaces.getActiveWorkspaceId()).toBeNull()
    workspaces.setActiveWorkspaceId('ws-1')
    expect(workspaces.getActiveWorkspaceId()).toBe('ws-1')
    expect(localStorage.getItem('freebuff-active-workspace')).toBe('ws-1')
    workspaces.setActiveWorkspaceId(null)
    expect(localStorage.getItem('freebuff-active-workspace')).toBeNull()
  })
})

describe('fetchMyWorkspaces', () => {
  it('returns the user’s workspaces', async () => {
    fromMock.mockReturnValue(chainFor([WS]))
    expect(await workspaces.fetchMyWorkspaces()).toEqual([WS])
    expect(fromMock).toHaveBeenCalledWith('workspaces')
  })

  it('throws on server errors', async () => {
    fromMock.mockReturnValue(chainFor(null, { message: 'RLS' }))
    await expect(workspaces.fetchMyWorkspaces()).rejects.toThrow('RLS')
  })
})

describe('createWorkspace / joinWorkspaceByCode', () => {
  it('creates via the create_workspace RPC', async () => {
    rpcMock.mockResolvedValueOnce({ data: { ...WS, id: 'ws-2' }, error: null })
    const ws = await workspaces.createWorkspace('Công việc')
    expect(rpcMock).toHaveBeenCalledWith('create_workspace', { p_name: 'Công việc' })
    expect(ws.id).toBe('ws-2')
  })

  it('joins via the join_workspace RPC with an uppercased code', async () => {
    rpcMock.mockResolvedValueOnce({ data: { ...WS, id: 'ws-friend' }, error: null })
    const ws = await workspaces.joinWorkspaceByCode(' abcd1234 ')
    expect(rpcMock).toHaveBeenCalledWith('join_workspace', { p_code: 'ABCD1234' })
    expect(ws.id).toBe('ws-friend')
  })

  it('surfaces the server error for a bad code', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'Mã chia sẻ không hợp lệ' } })
    await expect(workspaces.joinWorkspaceByCode('NOPE')).rejects.toThrow('Mã chia sẻ không hợp lệ')
  })
})

describe('ensureWorkspace', () => {
  it('creates a personal workspace on first run and makes it active', async () => {
    fromMock.mockReturnValue(chainFor([]))
    rpcMock.mockResolvedValueOnce({ data: WS, error: null })
    const active = await workspaces.ensureWorkspace()
    expect(active?.id).toBe('ws-1')
    expect(workspaces.getActiveWorkspaceId()).toBe('ws-1')
    expect(rpcMock).toHaveBeenCalledWith('create_workspace', { p_name: null })
  })

  it('keeps the existing active workspace when it is still a member', async () => {
    workspaces.setActiveWorkspaceId('ws-2')
    fromMock.mockReturnValue(chainFor([{ ...WS, id: 'ws-1' }, { ...WS, id: 'ws-2' }]))
    const active = await workspaces.ensureWorkspace()
    expect(active?.id).toBe('ws-2')
  })

  it('falls back to the first workspace when the saved id is stale', async () => {
    workspaces.setActiveWorkspaceId('ws-gone')
    fromMock.mockReturnValue(chainFor([{ ...WS, id: 'ws-1' }]))
    const active = await workspaces.ensureWorkspace()
    expect(active?.id).toBe('ws-1')
    expect(workspaces.getActiveWorkspaceId()).toBe('ws-1')
  })

  it('returns null when the server is unreachable (offline)', async () => {
    fromMock.mockReturnValue(chainFor(null, { message: 'Failed to fetch' }))
    expect(await workspaces.ensureWorkspace()).toBeNull()
  })
})
