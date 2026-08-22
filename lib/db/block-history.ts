/**
 * Server-side block history / audit trail.
 *
 * Stores every mutation on blocks so auditor personas can see
 * "who changed what, when, from what to what".
 *
 * Architecture:
 * - Client writes to `block_history` table after each mutation.
 * - RLS ensures users only see history for blocks they own/share.
 * - Graceful degradation: no-ops when table doesn't exist.
 *
 * DB Migration (run in Supabase SQL Editor):
 *
 * CREATE TABLE IF NOT EXISTS public.block_history (
 *   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *   block_id UUID NOT NULL,
 *   user_id UUID NOT NULL REFERENCES auth.users(id),
 *   action TEXT NOT NULL CHECK (action IN ('create','update','delete','restore','purge')),
 *   old_data JSONB,
 *   new_data JSONB,
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 *
 * CREATE INDEX IF NOT EXISTS idx_block_history_block
 *   ON public.block_history(block_id, created_at DESC);
 *
 * CREATE INDEX IF NOT EXISTS idx_block_history_user
 *   ON public.block_history(user_id, created_at DESC);
 *
 * ALTER TABLE public.block_history ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "Users can view history for accessible blocks"
 *   ON public.block_history FOR SELECT
 *   USING (auth.uid() = user_id);
 *
 * CREATE POLICY "Users can insert their own history"
 *   ON public.block_history FOR INSERT
 *   WITH CHECK (auth.uid() = user_id);
 */

import { supabase } from '@/lib/supabase/client'
import type { Block } from '@/types'

const TABLE = 'block_history'
const MAX_HISTORY = 500 // per block

let tableSupported: boolean | null = null

async function isSupported(): Promise<boolean> {
  if (tableSupported !== null) return tableSupported
  const { error } = await supabase.from(TABLE).select('id').limit(1)
  tableSupported = !error || !/does not exist|could not find|relation .* does not exist/i.test(error.message)
  return tableSupported
}

export interface HistoryEntry {
  id: string
  block_id: string
  user_id: string
  action: 'create' | 'update' | 'delete' | 'restore' | 'purge'
  old_data: Block | null
  new_data: Block | null
  created_at: string
}

/**
 * Record a mutation in the block history.
 * Call this AFTER the mutation succeeds (fire-and-forget).
 */
export async function recordHistory(
  action: HistoryEntry['action'],
  blockId: string,
  oldData?: Block | null,
  newData?: Block | null,
): Promise<void> {
  if (!(await isSupported())) return

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { error } = await supabase.from(TABLE).insert({
    block_id: blockId,
    user_id: user.id,
    action,
    old_data: oldData ?? null,
    new_data: newData ?? null,
  })

  if (error) {
    console.warn('[dresplace] Failed to record history:', error.message)
    return
  }

  // Cleanup: keep only latest MAX_HISTORY per block
  void cleanupBlockHistory(blockId)
}

/**
 * Get history for a specific block (newest first).
 */
export async function getBlockHistory(blockId: string, limit: number = 50): Promise<HistoryEntry[]> {
  if (!(await isSupported())) return []

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('block_id', blockId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[dresplace] Failed to fetch block history:', error.message)
    return []
  }

  return (data ?? []) as HistoryEntry[]
}

/**
 * Get recent activity across all accessible blocks (for audit dashboard).
 */
export async function getRecentActivity(limit: number = 50): Promise<HistoryEntry[]> {
  if (!(await isSupported())) return []

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[dresplace] Failed to fetch activity:', error.message)
    return []
  }

  return (data ?? []) as HistoryEntry[]
}

/**
 * Keep only the latest N history entries for a block.
 */
async function cleanupBlockHistory(blockId: string): Promise<void> {
  const { data: keepers } = await supabase
    .from(TABLE)
    .select('id')
    .eq('block_id', blockId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY)

  if (!keepers || keepers.length < MAX_HISTORY) return

  const keepIds = new Set(keepers.map((k) => k.id))
  const { data: all } = await supabase
    .from(TABLE)
    .select('id')
    .eq('block_id', blockId)
    .order('created_at', { ascending: true })

  if (!all) return

  const toDelete = all.filter((r) => !keepIds.has(r.id)).map((r) => r.id)
  if (toDelete.length > 0) {
    await supabase.from(TABLE).delete().in('id', toDelete)
  }
}
