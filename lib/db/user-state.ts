// User-level state persisted to Supabase (user_state table) so settings, the
// timer, and the .ics import history follow the user across browsers and
// devices. localStorage remains the offline cache/fallback: every read/write
// touches local storage first and reconciles with the server when reachable,
// so the app keeps working fully offline and never blocks on the network.
import { supabase } from '@/lib/supabase/client'
import type { StateStorage } from 'zustand/middleware'

const TABLE = 'user_state'

/** How long a failed probe marks the server "unreachable" (avoids re-hanging
 *  on every read when offline). */
const UNREACHABLE_WINDOW_MS = 30_000
/** Cap on how long a single probe may take before we treat the server as
 *  offline (the local cache is authoritative in that case anyway). */
const PROBE_TIMEOUT_MS = 2_000

let unreachableUntil = 0

/** Resolve with the promise's value, or reject after `ms` — a hanging request
 *  must never block hydration or a settings save. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function localGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function localSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage full/unavailable — the server write (if any) still proceeds
  }
}

function localRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/**
 * Fetch the JSON value for this user + row key. Returns the parsed value, or
 * undefined when the row is missing or the server is unreachable (callers
 * fall back to their local cache in that case). Never throws.
 */
export async function fetchUserState<T>(key: string): Promise<T | undefined> {
  // The last probe failed (timeout/network) — don't re-hang for a while.
  if (unreachableUntil > Date.now()) return undefined
  try {
    const { data, error } = await withTimeout(
      supabase
        .from(TABLE)
        .select('value')
        .eq('key', key)
        .maybeSingle() as unknown as Promise<{ data: { value: T } | null; error: { message: string } | null }>,
      PROBE_TIMEOUT_MS,
    )
    if (error) {
      unreachableUntil = Date.now() + UNREACHABLE_WINDOW_MS
      return undefined
    }
    if (!data) return undefined
    return (data as { value: T }).value
  } catch {
    unreachableUntil = Date.now() + UNREACHABLE_WINDOW_MS
    return undefined
  }
}

/**
 * Upsert a JSON value for this user + row key. user_id is omitted so the
 * table default (auth.uid()) fills it — RLS guarantees the row lands under
 * the current user. Never throws: callers treat a failed write as "offline".
 */
export async function saveUserState(key: string, value: unknown): Promise<void> {
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key, value }, { onConflict: 'user_id,key' })
    if (error) throw error
  } catch {
    // offline — the caller's local cache already holds the value
  }
}

/** Remove this user's row for the key (best-effort; never throws). */
export async function clearUserState(key: string): Promise<void> {
  try {
    const { error } = await supabase.from(TABLE).delete().eq('key', key)
    if (error) throw error
  } catch {
    // offline
  }
}

/**
 * A zustand persist storage backed by the server with localStorage as the
 * offline cache. getItem prefers the server row (so a fresh browser picks up
 * the user's real state) and falls back to the local cache when offline or
 * the row doesn't exist yet; setItem writes local first (durable even if the
 * server write fails), then mirrors to the server.
 */
export function createServerStateStorage(rowKey: string): StateStorage {
  return {
    getItem: async (name) => {
      const local = localGet(name)
      const remote = await fetchUserState<unknown>(rowKey)
      if (remote !== undefined) return JSON.stringify(remote)
      return local
    },
    setItem: async (name, value) => {
      localSet(name, value)
      await saveUserState(rowKey, JSON.parse(value))
    },
    removeItem: async (name) => {
      localRemove(name)
      await clearUserState(rowKey)
    },
  }
}
