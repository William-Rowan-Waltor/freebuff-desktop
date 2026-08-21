// Workspace sharing: blocks belong to a workspace (blocks.workspace_id), and
// anyone who joins a workspace via its share code sees and edits the same
// blocks (RLS: owner OR workspace member). The active workspace id is where
// newly created blocks land; it persists to localStorage and is overridden by
// whatever the server knows via the store bootstrap.
import { supabase } from '@/lib/supabase/client'

export interface Workspace {
  id: string
  name: string
  share_code: string
  created_by: string | null
  created_at: string
}

const ACTIVE_WS_KEY = 'freebuff-active-workspace'

let activeWorkspaceId: string | null | undefined

/** The workspace new blocks land in (null until the first bootstrap). */
export function getActiveWorkspaceId(): string | null {
  if (activeWorkspaceId === undefined) {
    try {
      activeWorkspaceId = localStorage.getItem(ACTIVE_WS_KEY)
    } catch {
      activeWorkspaceId = null
    }
  }
  return activeWorkspaceId
}

export function setActiveWorkspaceId(id: string | null): void {
  activeWorkspaceId = id
  try {
    if (id) localStorage.setItem(ACTIVE_WS_KEY, id)
    else localStorage.removeItem(ACTIVE_WS_KEY)
  } catch {
    // storage unavailable — the id just won't survive a reload
  }
}

/** All workspaces the signed-in user belongs to (or created). */
export async function fetchMyWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Workspace[]
}

/** Create a workspace (via the create_workspace RPC, which also makes the
 *  caller its owner member and assigns a unique share code). */
export async function createWorkspace(name?: string): Promise<Workspace> {
  const { data, error } = await supabase.rpc('create_workspace', {
    p_name: name?.trim() || null,
  })
  if (error) throw new Error(error.message)
  return data as Workspace
}

/** Join a workspace by its share code (via the join_workspace RPC). Throws
 *  with the server's message for unknown codes. */
export async function joinWorkspaceByCode(code: string): Promise<Workspace> {
  const { data, error } = await supabase.rpc('join_workspace', {
    p_code: code.trim().toUpperCase(),
  })
  if (error) throw new Error(error.message)
  return data as Workspace
}

/**
 * Bootstrap the user's workspaces: creates a personal workspace on first run,
 * and makes sure the active id points at a workspace the user belongs to
 * (falling back to the first one). Returns the active workspace, or null when
 * the server is unreachable (offline — the app keeps working, and new blocks
 * fall back to owner-only visibility via RLS).
 */
export async function ensureWorkspace(): Promise<Workspace | null> {
  let workspaces: Workspace[]
  try {
    workspaces = await fetchMyWorkspaces()
  } catch {
    return null
  }
  if (workspaces.length === 0) {
    const ws = await createWorkspace()
    setActiveWorkspaceId(ws.id)
    return ws
  }
  const active = getActiveWorkspaceId()
  const target = workspaces.find((w) => w.id === active) ?? workspaces[0]
  setActiveWorkspaceId(target.id)
  return target
}
