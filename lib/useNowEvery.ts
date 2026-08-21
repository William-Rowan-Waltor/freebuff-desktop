import { useEffect, useState } from 'react'

/**
 * Returns a Date that refreshes every `intervalMs` (default: 1 minute).
 *
 * Time-sensitive views use this so their notion of "now" advances without
 * waiting for a store change — events drop off a digest when they end, items
 * fall overdue, countdowns tick over. The returned Date is recreated on every
 * tick, so it also works as a useMemo/useEffect dependency.
 */
export function useNowEvery(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
