// History of .ics imports (the Đã nhập tab): persisted to localStorage so the
// list survives reloads, and mirrored to the server (user_state row) so it
// follows the user across browsers/devices. Each record remembers the counts,
// the source file, and the created block ids so the last import can be undone
// wholesale (the store's removeImportBlocks removes exactly those blocks +
// relations).
import type { IcsImportResult } from '@/lib/ics-import'
import { fetchUserState, saveUserState } from '@/lib/db/user-state'

export interface IcsImportRecord {
  id: string
  fileName: string
  /** Optional group name the user gave the batch (shown instead of the
   *  file name in the Đã nhập list). */
  groupName?: string
  /** ISO timestamp of the import. */
  createdAt: string
  created: number
  overrides: number
  continuations: number
  /** Block ids created by this import, in creation order. */
  blockIds: string[]
}

const HISTORY_KEY = 'freebuff-ics-history'
/** user_state row key for the server mirror. */
const SERVER_KEY = 'ics-history'
/** Newest-first cap; older records are dropped silently. */
const HISTORY_LIMIT = 50

/** True once the user has saved during this session — the local list is then
 *  newer than any server row, so hydration skips the server fetch (avoids a
 *  stale-server overwrite race right after an import). */
let dirty = false

function isRecord(value: unknown): value is IcsImportRecord {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.fileName === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.created === 'number' &&
    typeof v.overrides === 'number' &&
    typeof v.continuations === 'number' &&
    Array.isArray(v.blockIds)
  )
}

export function loadIcsHistory(): IcsImportRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecord).slice(0, HISTORY_LIMIT)
  } catch {
    // storage unavailable (SSR, private mode) — the tab just starts empty
    return []
  }
}

export function saveIcsHistory(records: IcsImportRecord[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records))
  } catch {
    // storage full/unavailable — the history won't survive a reload
  }
}

/**
 * Load the import history for this session: the server row is authoritative
 * when it exists (fresh browser picks up records saved on another device),
 * otherwise the local cache. Skips the server entirely once this session has
 * saved — the local list is newer.
 */
export async function loadIcsHistoryServer(): Promise<IcsImportRecord[]> {
  if (!dirty) {
    const remote = await fetchUserState<IcsImportRecord[]>(SERVER_KEY)
    if (remote !== undefined && Array.isArray(remote)) {
      const records = remote.filter(isRecord).slice(0, HISTORY_LIMIT)
      if (records.length > 0) return records
    }
  }
  return loadIcsHistory()
}

/** Save to localStorage (offline cache) and mirror to the server row. */
export async function saveIcsHistoryServer(records: IcsImportRecord[]): Promise<void> {
  dirty = true
  saveIcsHistory(records)
  await saveUserState(SERVER_KEY, records)
}

/** Build a new record (id + timestamp assigned) from an import result. */
export function newIcsImportRecord(
  fileName: string,
  result: IcsImportResult,
  groupName?: string,
): IcsImportRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    groupName: groupName?.trim() || undefined,
    createdAt: new Date().toISOString(),
    created: result.created,
    overrides: result.overrides,
    continuations: result.continuations,
    blockIds: result.ids,
  }
}
