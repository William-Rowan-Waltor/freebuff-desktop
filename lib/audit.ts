/**
 * Simple audit trail — logs block changes to localStorage.
 * Each entry records: blockId, action, timestamp, changes.
 */

export interface AuditEntry {
  blockId: string
  blockTitle: string | null
  action: 'create' | 'update' | 'delete' | 'restore' | 'purge'
  timestamp: string
  changes?: Record<string, { from: unknown; to: unknown }>
}

const AUDIT_KEY = 'dresplace-audit-log'
const MAX_ENTRIES = 500

function loadAuditLog(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY)
    if (!raw) return []
    return JSON.parse(raw) as AuditEntry[]
  } catch {
    return []
  }
}

function saveAuditLog(entries: AuditEntry[]): void {
  try {
    // Keep only the most recent entries
    const trimmed = entries.slice(-MAX_ENTRIES)
    localStorage.setItem(AUDIT_KEY, JSON.stringify(trimmed))
  } catch {
    // Storage full or unavailable
  }
}

export function logAudit(entry: Omit<AuditEntry, 'timestamp'>): void {
  const log = loadAuditLog()
  log.push({ ...entry, timestamp: new Date().toISOString() })
  saveAuditLog(log)
}

export function getAuditLog(blockId?: string): AuditEntry[] {
  const log = loadAuditLog()
  if (blockId) return log.filter((e) => e.blockId === blockId)
  return log
}

export function clearAuditLog(): void {
  try {
    localStorage.removeItem(AUDIT_KEY)
  } catch {
    // ignore
  }
}
