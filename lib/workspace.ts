/**
 * Multi-user workspace management.
 * Handles invitations, roles, and shared access.
 */

import { supabase } from '@/lib/supabase/client'
import type { Block } from '@/types'

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer'

export interface WorkspaceMember {
  id: string
  user_id: string
  email: string
  role: WorkspaceRole
  joined_at: string
}

export interface WorkspaceInvite {
  id: string
  workspace_id: string
  email: string
  role: WorkspaceRole
  created_at: string
  expires_at: string
}

const WORKSPACE_ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
}

/**
 * Check if a user's role has sufficient permissions for an action.
 */
export function hasPermission(userRole: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
  return WORKSPACE_ROLE_HIERARCHY[userRole] >= WORKSPACE_ROLE_HIERARCHY[requiredRole]
}

/**
 * Generate a random invite code.
 */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

/**
 * Create a workspace invitation.
 */
export async function createInvite(
  workspaceId: string,
  email: string,
  role: WorkspaceRole = 'editor',
): Promise<{ code: string; error?: string }> {
  const code = generateInviteCode()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

  const { error } = await supabase.from('workspace_invites').insert({
    workspace_id: workspaceId,
    email,
    role,
    invite_code: code,
    expires_at: expiresAt,
  })

  if (error) return { code: '', error: error.message }
  return { code }
}

/**
 * Accept a workspace invitation.
 */
export async function acceptInvite(
  inviteCode: string,
): Promise<{ workspaceId?: string; error?: string }> {
  const { data: invite, error: fetchError } = await supabase
    .from('workspace_invites')
    .select('*')
    .eq('invite_code', inviteCode)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (fetchError || !invite) {
    return { error: 'Mã邀请无效 hoặc đã hết hạn' }
  }

  // Add user to workspace members
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Vui lòng đăng nhập' }

  const { error: memberError } = await supabase.from('workspace_members').insert({
    workspace_id: invite.workspace_id,
    user_id: user.id,
    email: user.email!,
    role: invite.role,
  })

  if (memberError) return { error: memberError.message }

  // Delete the invite
  await supabase.from('workspace_invites').delete().eq('id', invite.id)

  return { workspaceId: invite.workspace_id }
}

/**
 * Get workspace members.
 */
export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('joined_at', { ascending: true })

  if (error) return []
  return (data ?? []) as WorkspaceMember[]
}

/**
 * Update a member's role.
 */
export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  newRole: WorkspaceRole,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('workspace_members')
    .update({ role: newRole })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)

  if (error) return { error: error.message }
  return {}
}

/**
 * Remove a member from workspace.
 */
export async function removeMember(
  workspaceId: string,
  userId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)

  if (error) return { error: error.message }
  return {}
}

/**
 * Check if current user can perform action on block.
 */
export async function canEditBlock(
  block: Block,
  userRole: WorkspaceRole = 'editor',
): Promise<boolean> {
  // Owner and admin can edit anything
  if (hasPermission(userRole, 'admin')) return true
  // Editor can edit
  if (hasPermission(userRole, 'editor')) return true
  // Viewer cannot edit
  return false
}

/**
 * Database migration SQL for multi-user support.
 */
export const MULTI_USER_MIGRATION = `
-- Workspace members table
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

-- Workspace invites table
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  invite_code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS workspace_members_workspace_idx ON public.workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS workspace_invites_code_idx ON public.workspace_invites(invite_code);

-- RLS policies
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- Members can view other members in same workspace
CREATE POLICY "members_view_own_workspace" ON public.workspace_members
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- Owners/admins can manage members
CREATE POLICY "admins_manage_members" ON public.workspace_members
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Anyone can view invites for their email
CREATE POLICY "view_own_invites" ON public.workspace_invites
  FOR SELECT USING (email = auth.email());

-- Owners/admins can create invites
CREATE POLICY "admins_create_invites" ON public.workspace_invites
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
`
