import { supabase } from '@/lib/supabase/client'

const HISTORY = 'block_history'

export type HistoryAction = 'create' | 'update' | 'delete'

export interface BlockHistoryEntry {
  id: number
  block_id: string
  workspace_id: string | null
  block_owner: string | null
  block_title: string | null
  actor: string | null
  action: HistoryAction
  changed_fields: string[] | null
  old_row: Record<string, unknown> | null
  new_row: Record<string, unknown> | null
  created_at: string
}

/**
 * Server-side audit trail for one block (block_history table — migration
 * 20260822_audit_edition.sql). RLS already scopes rows to the actor, the
 * block owner, or workspace members; failures surface to the caller so the
 * UI can show the "chưa chạy migration" notice.
 */
export async function fetchBlockHistory(blockId: string, limit = 50): Promise<BlockHistoryEntry[]> {
  const { data, error } = await supabase
    .from(HISTORY)
    .select('id,block_id,workspace_id,block_owner,block_title,actor,action,changed_fields,old_row,new_row,created_at')
    .eq('block_id', blockId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as BlockHistoryEntry[]
}

/** Workspace-wide trail (newest first) for CSV export / review. */
export async function fetchWorkspaceHistory(workspaceId: string, limit = 500): Promise<BlockHistoryEntry[]> {
  const { data, error } = await supabase
    .from(HISTORY)
    .select('id,block_id,workspace_id,block_owner,block_title,actor,action,changed_fields,old_row,new_row,created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as BlockHistoryEntry[]
}

/** Recent activity across every block the user can see (audit dashboard). */
export async function getRecentActivity(limit = 50): Promise<BlockHistoryEntry[]> {
  const { data, error } = await supabase
    .from(HISTORY)
    .select('id,block_id,workspace_id,block_owner,block_title,actor,action,changed_fields,old_row,new_row,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as BlockHistoryEntry[]
}

/** Alias for the consolidated block-history module. */
export type HistoryEntry = BlockHistoryEntry

const ACTION_VI: Record<HistoryAction, string> = {
  create: 'Tạo',
  update: 'Sửa',
  delete: 'Xóa',
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

/**
 * Pure serializer: history rows → CSV (UTF-8, RFC 4180 quoting) so an
 * auditor/accountant can file it alongside their records. BOM is prepended
 * by the download helper, not here, so tests stay byte-predictable.
 */
export function historyToCsv(entries: BlockHistoryEntry[]): string {
  const header = ['thoi_gian', 'hanh_dong', 'block_id', 'tieu_de', 'actor', 'cac_truong_thay_doi']
  const lines = [header.join(',')]
  for (const e of entries) {
    lines.push(
      [
        csvCell(e.created_at),
        csvCell(ACTION_VI[e.action] ?? e.action),
        csvCell(e.block_id),
        csvCell(e.block_title),
        csvCell(e.actor),
        csvCell((e.changed_fields ?? []).join(', ')),
      ].join(','),
    )
  }
  return lines.join('\r\n')
}
