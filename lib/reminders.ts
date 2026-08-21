import { useEffect, useRef } from 'react'
import { useNowEvery } from '@/lib/useNowEvery'
import { isAllDayIso } from '@/lib/overlap'
import { occurrenceDates, parseRecurrence } from '@/lib/recurrence'
import { useSettingsStore } from '@/store/useSettingsStore'

/** A block as consumed by the reminder pipeline (recurrence fields optional). */
export type ReminderInput = ReminderEvent & {
  recurrence?: string | null
  recurrence_exceptions?: string[] | null
}

export interface ReminderEvent {
  /**
   * Unique per reminder source: the block id for plain events, or
   * '<blockId>@<occurrenceIso>' for an expanded recurring occurrence (so each
   * occurrence notifies exactly once).
   */
  id: string
  title: string | null
  start_time: string | null
  /** The openable block id — the master for occurrences. Defaults to `id`. */
  blockId?: string
}

/**
 * The next event whose start falls in the window (now, now + withinMs].
 * All-day events (date-only or the PostgREST UTC-midnight shape) are skipped —
 * "N minutes before" does not apply to a whole-day item — as are events that
 * already started and unparseable dates. Returns null when nothing qualifies.
 */
export function nextUpcomingEvent(
  events: ReminderEvent[],
  now: Date,
  withinMs: number,
): ReminderEvent | null {
  const t = now.getTime()
  let best: ReminderEvent | null = null
  for (const ev of events) {
    if (!ev.start_time || isAllDayIso(ev.start_time)) continue
    const start = new Date(ev.start_time).getTime()
    if (Number.isNaN(start) || start <= t || start > t + withinMs) continue
    if (!best || start < new Date(best.start_time!).getTime()) best = ev
  }
  return best
}

/** Whole minutes between now and an event start (0 or negative = starting now/soon). */
export function minutesBetween(now: Date, startIso: string): number {
  return Math.round((new Date(startIso).getTime() - now.getTime()) / 60_000)
}

/**
 * Expand recurring series into per-occurrence reminder candidates for the
 * window (now, now + withinMs], so reminders fire for upcoming occurrences and
 * not just the master block. Occurrences get unique ids ('<blockId>@<iso>')
 * with `blockId` pointing back at the master (the openable block); plain
 * events pass through unchanged. The window bound keeps the expansion cheap —
 * rrule only materializes dates that can still matter.
 */
export function expandOccurrences(events: ReminderInput[], now: Date, withinMs: number): ReminderEvent[] {
  const out: ReminderEvent[] = []
  const end = new Date(now.getTime() + withinMs)
  for (const ev of events) {
    if (ev.recurrence && parseRecurrence(ev.recurrence) && ev.start_time) {
      for (const d of occurrenceDates(
        {
          recurrence: ev.recurrence,
          start_time: ev.start_time,
          recurrence_exceptions: ev.recurrence_exceptions ?? null,
        },
        now,
        end,
      )) {
        const iso = d.toISOString()
        out.push({ id: `${ev.id}@${iso}`, title: ev.title, start_time: iso, blockId: ev.id })
      }
    } else {
      out.push({ ...ev, blockId: ev.blockId ?? ev.id })
    }
  }
  return out
}

/**
 * Browser-notification watcher for upcoming events — including recurring
 * series, whose occurrences are expanded via occurrenceDates so a reminder
 * fires when an occurrence (not just the master block) comes inside the
 * threshold. Reuses the Clock patterns: an interval tick for "now"
 * (useNowEvery), a 2.5s guard so StrictMode/dev double-ticks never fire twice,
 * and settings-driven toggles. Each event/occurrence notifies once — fired ids
 * are remembered and pruned when the source vanishes or its start passes (an
 * edited event can re-notify).
 */
export function useEventReminders(events: ReminderInput[]) {
  const now = useNowEvery(30_000)
  const notifiedRef = useRef<Set<string>>(new Set())
  const lastFireRef = useRef(0)

  // Ask for permission once, and only when there is something to remind about
  // (a recurring series with future occurrences counts too).
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'default') return
    const hasTimedFuture = expandOccurrences(events, new Date(), 30 * 24 * 60 * 60_000).some(
      (e) => !!e.start_time && !isAllDayIso(e.start_time) && new Date(e.start_time).getTime() > Date.now(),
    )
    if (hasTimedFuture) void Notification.requestPermission()
  }, [events])

  useEffect(() => {
    const settings = useSettingsStore.getState()
    if (!settings.remindersEnabled || settings.reminderMinutes <= 0) return
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    const t = now.getTime()
    const withinMs = settings.reminderMinutes * 60_000
    // Recurring occurrences materialize only inside the current window, so a
    // fired occurrence naturally drops out once its start passes — the prune
    // below then forgets it.
    const candidates = expandOccurrences(events, now, withinMs)

    // Prune fired ids whose source vanished or whose start has now passed.
    for (const id of notifiedRef.current) {
      const ev = candidates.find((e) => e.id === id)
      if (!ev || !ev.start_time) {
        notifiedRef.current.delete(id)
        continue
      }
      const start = new Date(ev.start_time).getTime()
      if (Number.isNaN(start) || start <= t) notifiedRef.current.delete(id)
    }

    const target = nextUpcomingEvent(candidates, now, withinMs)
    if (!target || notifiedRef.current.has(target.id)) return

    const ts = Date.now()
    if (ts - lastFireRef.current < 2500) return
    lastFireRef.current = ts
    notifiedRef.current.add(target.id)

    const mins = target.start_time ? minutesBetween(now, target.start_time) : 0
    const body = mins <= 0 ? 'Sắp bắt đầu' : `Bắt đầu sau ${mins} phút`
    const notification = new Notification(target.title ?? 'Sự kiện sắp bắt đầu', { body })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }, [events, now])
}