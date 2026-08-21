function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format milliseconds as MM:SS, or H:MM:SS once an hour elapses. */
export function formatHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = pad(m)
  const ss = pad(s)
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
