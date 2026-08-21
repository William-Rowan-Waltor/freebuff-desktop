import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { storage: { from: vi.fn() } },
}))

type StorageDb = typeof import('@/lib/db/storage')
let storage: StorageDb

const PUBLIC_FILE = 'https://proj.supabase.co/storage/v1/object/public/files/user-1/x/a.png'
const ok = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  storage = await import('@/lib/db/storage')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fileExists', () => {
  it('returns true when the object answers (any project host — the link works)', async () => {
    const fetchMock = vi.fn(async () => ok(200))
    vi.stubGlobal('fetch', fetchMock)
    expect(await storage.fileExists(PUBLIC_FILE)).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(PUBLIC_FILE, expect.objectContaining({ method: 'HEAD' }))
  })

  it('returns false only when the object is definitively gone (404/410)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(404)))
    expect(await storage.fileExists(PUBLIC_FILE)).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => ok(410)))
    expect(await storage.fileExists(PUBLIC_FILE)).toBe(false)
  })

  it('returns null when the probe cannot determine liveness (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('Failed to fetch'))))
    expect(await storage.fileExists(PUBLIC_FILE)).toBeNull()
  })

  it('returns null for unexpected statuses (redirects, auth walls) so the heuristic decides', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(302)))
    expect(await storage.fileExists(PUBLIC_FILE)).toBeNull()
  })

  it('returns null for non-http URLs without probing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await storage.fileExists('blob:https://freebuff.local/uuid')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches probe results for the session — a repeated URL never re-HEADs', async () => {
    const fetchMock = vi.fn(async () => ok(404))
    vi.stubGlobal('fetch', fetchMock)
    // First probe hits the network; the cached false answers the second call.
    expect(await storage.fileExists(PUBLIC_FILE)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await storage.fileExists(PUBLIC_FILE)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // A network-error result is cached too (null, no re-probe).
    fetchMock.mockImplementation(async () => Promise.reject(new Error('offline')))
    expect(await storage.fileExists('https://proj.supabase.co/other.png')).toBeNull()
    fetchMock.mockClear()
    expect(await storage.fileExists('https://proj.supabase.co/other.png')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
