/**
 * Revision system for persisting undo/redo history to Supabase.
 *
 * Architecture:
 * - Each "revision" is a point-in-time snapshot of all blocks + relations.
 * - Stored in a `block_revisions` table with auto-cleanup (keep last N per user).
 * - Client reads revisions on login to hydrate undo/redo stacks.
 * - Server-side RLS ensures users only see their own revisions.
 *
 * Graceful degradation: when the table doesn't exist (migration not applied),
 * all functions return empty/silent — the app still works with RAM-only undo.
 */

import { supabase } from '@/lib/supabase/client'
import type { Block, BlockRelation } from '@/types'

const REVISIONS_TABLE = 'block_revisions'
const MAX_REVISIONS = 50 // per user

// One-time probe: does the table exist?
let tableSupported: boolean | null = null

async function isSupported(): Promise<boolean> {
  if (tableSupported !== null) return tableSupported
  const { error } = await supabase.from(REVISIONS_TABLE).select('id').limit(1)
  tableSupported = !error || !/does not exist|could not find|relation .* does not exist/i.test(error.message)
  return tableSupported
}

export interface RevisionSnapshot {
  blocks: Block[]
  relations: BlockRelation[]
}

export interface RevisionRow {
  id: string
  user_id: string
  snapshot: RevisionSnapshot
  label: string | null // e.g. "undo:edit", "undo:delete", "manual"
  created_at: string
}

/**
 * Save a revision snapshot to the DB.
 * Silently no-ops when the table doesn't exist.
 */
export async function saveRevision(
  snapshot: RevisionSnapshot,
  label?: string,
): Promise<void> {
  if (!(await isSupported())) return

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { error } = await supabase.from(REVISIONS_TABLE).insert({
    user_id: user.id,
    snapshot,
    label: label ?? 'auto',
  })

  if (error) {
    console.warn('[dresplace] Failed to save revision:', error.message)
    return
  }

  // Cleanup: keep only the latest MAX_REVISIONS per user
  await cleanupOldRevisions(user.id)
}

/**
 * Load the most recent revisions for the current user (newest first).
 * Used to hydrate the undo stack on app start.
 */
export async function loadRevisions(limit: number = MAX_REVISIONS): Promise<RevisionRow[]> {
  if (!(await isSupported())) return []

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from(REVISIONS_TABLE)
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[dresplace] Failed to load revisions:', error.message)
    return []
  }

  return data ?? []
}

/**
 * Delete a specific revision.
 */
export async function deleteRevision(id: string): Promise<void> {
  if (!(await isSupported())) return
  await supabase.from(REVISIONS_TABLE).delete().eq('id', id)
}

/**
 * Clear all revisions for the current user.
 */
export async function clearAllRevisions(): Promise<void> {
  if (!(await isSupported())) return

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from(REVISIONS_TABLE).delete().eq('user_id', user.id)
}

/**
 * Keep only the latest N revisions for a user.
 */
async function cleanupOldRevisions(userId: string): Promise<void> {
  // Get IDs to keep (newest N)
  const { data: keepers } = await supabase
    .from(REVISIONS_TABLE)
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_REVISIONS)

  if (!keepers || keepers.length < MAX_REVISIONS) return

  // Get IDs to delete (older than keepers)
  const keepIds = new Set(keepers.map((k) => k.id))
  const { data: all } = await supabase
    .from(REVISIONS_TABLE)
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (!all) return

  const toDelete = all.filter((r) => !keepIds.has(r.id)).map((r) => r.id)
  if (toDelete.length > 0) {
    await supabase.from(REVISIONS_TABLE).delete().in('id', toDelete)
  }
}

/**
 * DB migration SQL (run in Supabase SQL Editor):
 *
 * CREATE TABLE IF NOT EXISTS public.block_revisions (
 *   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   snapshot JSONB NOT NULL,
 *   label TEXT,
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 *
 * CREATE INDEX IF NOT EXISTS idx_block_revisions_user_created
 *   ON public.block_revisions(user_id, created_at DESC);
 *
 * ALTER TABLE public.block_revisions ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "Users can manage their own revisions"
 *   ON public.block_revisions FOR ALL
 *   USING (auth.uid() = user_id);
 */
