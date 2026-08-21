'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar } from '@fullcalendar/react'
import type { CalendarRef, EventClickInfo, EventDropInfo, EventResizeDoneInfo } from '@fullcalendar/react'
import { X, DotsSixVertical, Power, Note, Repeat, Check, Trash, Warning } from '@phosphor-icons/react'
import dayGridPlugin from '@fullcalendar/react/daygrid'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import interactionPlugin from '@fullcalendar/react/interaction'
import monarchThemePlugin from '@fullcalendar/react/themes/monarch'
import rrulePlugin from '@fullcalendar/rrule'
import viLocale from '@fullcalendar/react/locales/vi'

import '@fullcalendar/react/skeleton.css'
import '@fullcalendar/react/themes/monarch/theme.css'
import '@fullcalendar/react/themes/monarch/palettes/blue.css'

import { RRule } from 'rrule'
import { isAllDayIso, conflictingIds, conflictRingClass, conflictCountFor } from '@/lib/overlap'
import { withDefaultDuration } from '@/lib/create'
import { textPreview } from '@/lib/textPreview'
import { buildRRuleString, isRecurring, occurrenceDates, FREQ_OPTIONS, FREQ_UNITS, recurrenceProps } from '@/lib/recurrence'
import { useBlocksStore } from '@/store/useBlocksStore'
import RecurrenceChoice from '@/components/calendar/RecurrenceChoice'
import type { Block } from '@/types'

// Defaults the '＋' toolbar button can pass along with the anchor date so the
// created event matches the view being shown (timed slot in week/day views).
interface QuickAddDefaults {
  start_time?: string
  end_time?: string
}

interface CalendarViewProps {
  events: Block[]
  onSelectBlock: (id: string) => void
  /** Create an event on a date; resolves to the new block's id (null on failure). */
  onDateClick: (dateStr: string, defaults?: QuickAddDefaults) => Promise<string | null>
  onEventChange: (id: string, patch: Partial<Block>) => void
  onQuickNote: (id: string, text: string) => void
  /**
   * Quick-note on a recurring OCCURRENCE: create a per-occurrence override
   * (reuses the override + exception machinery) instead of writing to the
   * master's shared content.
   */
  onQuickNoteOverride: (masterId: string, text: string, startIso: string, endIso: string | null) => void
  /** Create an override for one occurrence of a recurring series ("Chỉ sự kiện này"). */
  onOverrideOccurrence: (blockId: string, patch: Partial<Block>, originalStart: string | null) => void
  /** Shift the whole series ("Tất cả các lần") by moving the master's dtstart. */
  onRescheduleSeries: (blockId: string, patch: Partial<Block>) => void
  /** Split the series ("Tất cả các lần sau lần này"): this + future get a new master. */
  onSplitSeries: (blockId: string, patch: { start_time?: string | null; end_time?: string | null }) => void
  /**
   * Click on an empty date cell: create a NOTE block (not an event) and
   * return the new block's id so the quick-note popover can open on it.
   */
  onDateNote: (dateStr: string) => Promise<string | null>
  /** Whether the calendar side panel is currently open. */
  calendarSideOpen: boolean
  /** Toggle the calendar side panel. */
  onToggleSide: () => void
  /** Delete a plain block ("Xóa"). */
  onDeleteBlock: (id: string) => void
  /** Exclude one occurrence of a recurring series ("Xóa lần này"). */
  onDeleteOccurrence: (masterId: string, occurrenceStart: string) => void
  /** Remove every occurrence from this one onward ("Xóa tất cả các lần sau lần này"). */
  onDeleteThisAndFuture: (masterId: string, occurrenceStart: string) => void
}

interface NoteAnchor {
  id: string
  x: number
  y: number
  /** Set when the clicked event is an expanded occurrence of a recurring series. */
  occurrence?: { startIso: string; endIso: string | null }
}

interface RecurrenceChoiceState {
  blockId: string
  title: string | null
  patch: Partial<Block>
  originalStart: string | null
}

// All-day events keep date-only strings (YYYY-MM-DD) like the rest of the app;
// timed events are stored as absolute ISO instants so timezones round-trip.
function toTimePatch(info: EventDropInfo | EventResizeDoneInfo): Partial<Block> {
  const patch: Partial<Block> = {}
  if (info.event.start) {
    patch.start_time = info.event.allDay ? info.event.startStr : info.event.start.toISOString()
  }
  if (info.event.end) {
    patch.end_time = info.event.allDay ? info.event.endStr : info.event.end.toISOString()
  }
  return patch
}

// Does the clicked event correspond to an expanded occurrence of a recurring
// block (as opposed to the master's own slot)? Occurrences share the master's
// id but carry their own start, so a start different from the master's dtstart
// means per-occurrence handling (quick-note override). Returns the occurrence
// times in the app's storage shapes (date-only for all-day, ISO for timed) so
// the override + exception machinery can consume them directly.
function occurrenceTimes(block: Block, info: EventClickInfo): { startIso: string; endIso: string | null } | null {
  if (!isRecurring(block) || !block.start_time) return null
  const seriesAllDay = isAllDayIso(block.start_time)
  const masterIso = seriesAllDay
    ? block.start_time.slice(0, 10)
    : new Date(block.start_time).toISOString()
  // An all-day series is always keyed by its calendar day (the UTC day of the
  // UTC-midnight instant — see toFcDate), even when the rrule plugin reports
  // the expanded event as timed-midnight (event.allDay false). Falling back to
  // the raw ISO instant would store a UTC-midnight exception that never matches
  // the date-only exdate the series hides with — the overridden occurrence
  // would keep rendering.
  const clickedIso = seriesAllDay
    ? info.event.allDay
      ? info.event.startStr
      : info.event.start
        ? info.event.start.toISOString().slice(0, 10)
        : null
    : info.event.allDay
      ? info.event.startStr
      : info.event.start
        ? info.event.start.toISOString()
        : null
  if (!clickedIso || clickedIso === masterIso) return null
  const endIso = seriesAllDay
    ? info.event.allDay
      ? info.event.endStr || null
      : info.event.end
        ? info.event.end.toISOString().slice(0, 10)
        : null
    : info.event.allDay
      ? info.event.endStr || null
      : info.event.end
        ? info.event.end.toISOString()
        : null
  return { startIso: clickedIso, endIso }
}

// PostgREST normalizes a date-only 'YYYY-MM-DD' into a timestamptz instant
// ('2026-08-20T00:00:00+00:00'), so an all-day event loses its all-day shape on
// the DB round-trip. Re-normalize at the load boundary: a pure date OR a UTC
// midnight instant is treated as all-day and fed to FullCalendar as a date-only
// string (which FC parses as all-day). All-day drags/resizes then persist
// date-only again via toTimePatch — lossless. A deliberately timed 00:00Z event
// would read as all-day (accepted, rare; +07 midnight serializes to 16:59/17:00Z
// so local-midnight timed events are unaffected). isAllDayIso lives in
// lib/overlap.ts (shared with conflict detection); EditorPane keeps a synced
// copy.
function toFcDate(iso: string): string {
  return isAllDayIso(iso) ? iso.slice(0, 10) : iso
}

// Build the FullCalendar event inputs from blocks. Plain events keep start/end;
// recurring ones carry the rrule props the plugin expands (exdate hides the
// overridden occurrences) plus an explicit duration for TIMED series — without
// it FC falls back to defaultTimedEventDuration (30 min), so a 1-hour weekly
// meeting would render as 30-minute occurrences. All-day series omit it and
// keep FC's 1-day default.
export function toFcEventInputs(blocks: Block[]) {
  return blocks
    .filter((b) => b.type === 'event' && b.start_time)
    .map((b) => {
      const rec = recurrenceProps(b)
      const timedDuration =
        rec && b.end_time && !isAllDayIso(b.start_time)
          ? new Date(b.end_time).getTime() - new Date(b.start_time!).getTime()
          : null
      return {
        id: b.id,
        title: b.title ?? 'Sự kiện',
        start: toFcDate(b.start_time!),
        ...(b.end_time ? { end: toFcDate(b.end_time) } : {}),
        // The FullCalendar rrule plugin expands the series from these props;
        // exdate hides the overridden occurrences.
        ...(rec
          ? {
              rrule: rec.rrule,
              exdate: rec.exdate,
              ...(timedDuration !== null ? { duration: timedDuration } : {}),
            }
          : {}),
        extendedProps: { recurring: rec !== null },
      }
    })
}

// FullCalendar's getDate() returns the date the view is currently showing
// (month start in month view, view start in week/day views) as a local Date.
// Format it back to the app's YYYY-MM-DD convention so the + button can create
// an event on the viewed date through the same onDateClick flow as a click.
function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// The '＋' toolbar button creates an event with sensible defaults for the
// current view:
// - Month view: all-day event on the viewed date (today while the current
//   month is open, otherwise the month's first day).
// - Week/day views: timed event at the next full hour — anchored to today when
//   today is inside the visible range, otherwise to the view's start date —
//   with the configured default duration.
function timedAnchor(viewStart: Date, viewEnd: Date): Date {
  const now = new Date()
  return now >= viewStart && now < viewEnd ? now : viewStart
}

// Next full hour after the anchor (e.g. 14:37 → 15:00), with the user's
// configured default duration so the timed event has a real [start, end) slot
// in the view.
function timedDefaults(anchor: Date): QuickAddDefaults {
  const start = new Date(anchor)
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  return { start_time: start.toISOString(), end_time: withDefaultDuration(start.toISOString()) }
}

const NOTE_POPOVER_WIDTH = 288
const NOTE_MARGIN = 8
const NOTE_MAX_Y_OFFSET = 220
const NOTE_FEATURE_KEY = 'quick-note-enabled'
const NOTE_POS_KEY = 'quick-note-pos'
// One-time dismissal for the "recurrence unavailable" notice in the repeat
// popover (the migration-not-applied case degrades to one-off events).
const REPEAT_UNAVAILABLE_KEY = 'recurrence-unavailable-dismissed'

// Repeat presets offered by the quick-add popover (after '＋' or a date click
// creates an event). Freq-only RRULEs: dtstart stays the event's start_time, so
// Mỗi tuần repeats on the same weekday as the created event. 'Số lần' opens a
// tiny count form (freq + N) that writes a COUNT= rule. The four presets and
// the count-form unit names come from lib/recurrence FREQ_OPTIONS / FREQ_UNITS
// so the editor picker and the calendar never drift apart.
const REPEAT_OPTIONS: { label: string; rrule: string | null; countForm?: boolean }[] = [
  { label: 'Không lặp', rrule: null },
  ...FREQ_OPTIONS.map(({ value, label }) => ({ label, rrule: buildRRuleString({ freq: value }) })),
  {
    label: 'Mỗi ngày làm việc',
    rrule: buildRRuleString({ freq: RRule.DAILY, byweekday: [0, 1, 2, 3, 4] }),
  },
  { label: 'Số lần', rrule: null, countForm: true },
]

function readNotePos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(NOTE_POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown }
    if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
    return null
  } catch {
    return null
  }
}

export default function CalendarView({
  events,
  onSelectBlock,
  onDateClick,
  onEventChange,
  onQuickNote,
  onQuickNoteOverride,
  onOverrideOccurrence,
  onRescheduleSeries,
  onSplitSeries,
  onDateNote,
  calendarSideOpen,
  onToggleSide,
  onDeleteBlock,
  onDeleteOccurrence,
  onDeleteThisAndFuture,
}: CalendarViewProps) {
  const calendarRef = useRef<CalendarRef>(null)

  // Recurrence is unavailable when the live schema predates the migration
  // (blocks.recurrence missing): quick-add then saves a plain one-off event and
  // skips the repeat prompt instead of offering a rule that would 42703.
  const recurrenceUnavailable = useBlocksStore((s) => s.recurrenceUnavailable)

  // Recurring instance drag/resize modal: FullCalendar has already reverted the
  // visual move (info.revert) so the grid shows the original series while the
  // user picks "this instance" (override + exception) or "all instances" (dtstart
  // shift). No revert on cancel = no stale local state.
  const [recurrenceChoice, setRecurrenceChoice] = useState<RecurrenceChoiceState | null>(null)

  // Deleting an occurrence of a recurring series ("Xóa lần này" vs the whole
  // series): held here until the user picks, so the calendar never kills a
  // series when the intent was one instance.
  const [deleteChoice, setDeleteChoice] = useState<{
    masterId: string
    title: string | null
    occurrenceStart: string
  } | null>(null)

  const beginRecurringMove = (info: EventDropInfo | EventResizeDoneInfo) => {
    const block = events.find((b) => b.id === info.event.id)
    if (!block || !isRecurring(block)) return false
    const patch = toTimePatch(info)
    const oldStart = info.oldEvent.start
    const originalStart = oldStart
      ? info.oldEvent.allDay
        ? info.oldEvent.startStr
        : oldStart.toISOString()
      : null
    info.revert()
    setRecurrenceChoice({ blockId: block.id, title: block.title, patch, originalStart })
    return true
  }

  const handleEventDrop = (info: EventDropInfo) => {
    if (beginRecurringMove(info)) return
    onEventChange(info.event.id, toTimePatch(info))
  }

  const handleEventResize = (info: EventResizeDoneInfo) => {
    if (beginRecurringMove(info)) return
    onEventChange(info.event.id, toTimePatch(info))
  }

  const choiceThis = () => {
    if (!recurrenceChoice) return
    onOverrideOccurrence(recurrenceChoice.blockId, recurrenceChoice.patch, recurrenceChoice.originalStart)
    setRecurrenceChoice(null)
  }

  const choiceAll = () => {
    if (!recurrenceChoice) return
    onRescheduleSeries(recurrenceChoice.blockId, recurrenceChoice.patch)
    setRecurrenceChoice(null)
  }

  const choiceThisAndFuture = () => {
    if (!recurrenceChoice) return
    onSplitSeries(recurrenceChoice.blockId, recurrenceChoice.patch)
    setRecurrenceChoice(null)
  }

  const confirmDeleteThis = () => {
    if (!deleteChoice) return
    onDeleteOccurrence(deleteChoice.masterId, deleteChoice.occurrenceStart)
    setDeleteChoice(null)
  }

  const confirmDeleteAll = () => {
    if (!deleteChoice) return
    onDeleteBlock(deleteChoice.masterId)
    setDeleteChoice(null)
  }

  const confirmDeleteThisAndFuture = () => {
    if (!deleteChoice) return
    onDeleteThisAndFuture(deleteChoice.masterId, deleteChoice.occurrenceStart)
    setDeleteChoice(null)
  }

  // Delete entry from the quick-note popover: a recurring series (occurrence
  // or the master's own slot) is held behind the this-vs-all choice; plain
  // events are removed directly.
  const requestDelete = () => {
    if (!noteFor) return
    const block = events.find((b) => b.id === noteFor.id)
    if (!block) {
      setNoteFor(null)
      return
    }
    if (isRecurring(block)) {
      const occurrenceStart = noteFor.occurrence?.startIso ?? block.start_time ?? ''
      setNoteFor(null)
      setDeleteChoice({ masterId: block.id, title: block.title, occurrenceStart })
      return
    }
    setNoteFor(null)
    onDeleteBlock(block.id)
  }

  // Mini date-picker for the '＋' toolbar button: lets the user pick a date
  // before creating the event. Shows a small month grid popup.
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [datePickerMonth, setDatePickerMonth] = useState(() => new Date())
  const datePickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!datePickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) setDatePickerOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDatePickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [datePickerOpen])

  // Repeat picker state: opened right after a quick-add creates an event.
  const [repeatPrompt, setRepeatPrompt] = useState<{ blockId: string } | null>(null)
  const repeatBusyRef = useRef(false)
  // The 'Số lần' count form (freq + interval + N) replaces the preset grid while open.
  const [repeatCountForm, setRepeatCountForm] = useState<{
    freq: number
    interval: number
    count: number
  } | null>(null)
  const repeatRef = useRef<HTMLDivElement>(null)
  // When recurrence is unavailable, the repeat popover shows the notice exactly
  // once (dismissal is remembered) — the event itself saves as a one-off.
  const [repeatNoticeDismissed, setRepeatNoticeDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(REPEAT_UNAVAILABLE_KEY) === '1'
    } catch {
      return false
    }
  })
  const dismissRepeatNotice = () => {
    setRepeatNoticeDismissed(true)
    try {
      localStorage.setItem(REPEAT_UNAVAILABLE_KEY, '1')
    } catch {
      // ignore storage failures
    }
    setRepeatPrompt(null)
  }

  useEffect(() => {
    if (!repeatPrompt) return
    const onDown = (e: MouseEvent) => {
      if (repeatRef.current && !repeatRef.current.contains(e.target as Node)) setRepeatPrompt(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRepeatPrompt(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [repeatPrompt])

  // After the '＋' button or a date click creates an event, offer a repeat rule
  // inline so the user can make it recurring without opening the editor. When
  // recurrence is unavailable the popover shows the one-time notice instead of
  // the preset grid; once dismissed, quick-adds skip the popover silently.
  const beginRepeatPrompt = async (created: Promise<string | null>) => {
    if (repeatBusyRef.current) return
    repeatBusyRef.current = true
    try {
      const blockId = await created
      if (!blockId) return
      if (recurrenceUnavailable && repeatNoticeDismissed) return
      // Fresh popover: reset the 'Số lần' count form from any previous open.
      setRepeatCountForm(null)
      setRepeatPrompt({ blockId })
    } finally {
      repeatBusyRef.current = false
    }
  }

  const applyRepeat = (rrule: string | null) => {
    if (repeatPrompt && rrule) {
      onEventChange(repeatPrompt.blockId, { recurrence: rrule })
    }
    setRepeatPrompt(null)
  }

  // 'Số lần': swap the grid for a freq + interval + count form; saving writes a
  // COUNT= rule (dtstart-anchored, so weekday/month-step follow the created event).
  const openRepeatCountForm = () => setRepeatCountForm({ freq: RRule.DAILY, interval: 1, count: 3 })

  const saveRepeatCount = () => {
    if (!repeatCountForm) return
    applyRepeat(
      buildRRuleString({
        freq: repeatCountForm.freq,
        interval: repeatCountForm.interval,
        count: repeatCountForm.count,
      }),
    )
  }

  // Live preview for the count form: "4 lần mỗi tuần · lần cuối 18/09", derived
  // by expanding the would-be COUNT= rule from the created event's own start.
  const countPreview = (freq: number, interval: number, count: number): string | null => {
    if (!repeatPrompt) return null
    const created = events.find((b) => b.id === repeatPrompt.blockId)
    if (!created?.start_time) return null
    const start = new Date(created.start_time)
    if (Number.isNaN(start.getTime())) return null
    const dates = occurrenceDates(
      {
        ...created,
        recurrence: buildRRuleString({ freq, interval, count }),
        recurrence_exceptions: null,
      },
      start,
      new Date(start.getTime() + 2 * 366 * 24 * 60 * 60 * 1000),
    )
    const last = dates.at(-1)
    if (!last) return null
    const fm = String(last.getMonth() + 1).padStart(2, '0')
    const fd = String(last.getDate()).padStart(2, '0')
    const date =
      last.getFullYear() !== start.getFullYear() ? `${fd}/${fm}/${last.getFullYear()}` : `${fd}/${fm}`
    const every = interval > 1 ? `${count} lần mỗi ${interval} ${FREQ_UNITS[freq] ?? 'ngày'}` : `${count} lần mỗi ${FREQ_UNITS[freq] ?? 'ngày'}`
    return `${every} · lần cuối ${date}`
  }

  const preview = repeatCountForm
    ? countPreview(repeatCountForm.freq, repeatCountForm.interval, repeatCountForm.count)
    : null

  const handleQuickAdd = () => {
    setDatePickerMonth(new Date())
    setDatePickerOpen(true)
  }

  const handleDatePickerPick = (dateStr: string) => {
    setDatePickerOpen(false)
    // Create an all-day event on the picked date.
    void beginRepeatPrompt(onDateClick(dateStr))
  }

  const items = useMemo(() => toFcEventInputs(events), [events])

  // Timed events whose [start, end) intervals intersect get a conflict marker.
  // Derived from the same normalized items, so it updates automatically after
  // drags/resizes (eventClass is applied per-render by FullCalendar).
  const conflicts = useMemo(
    () => conflictingIds(items.map((i) => ({ id: i.id, start: i.start, end: i.end ?? null }))),
    [items],
  )

  // Quick-note block: clicking an event chip anchors a small floating block at
  // the chip; saving appends a paragraph to the block's Tiptap content
  // (persisted via onQuickNote -> updateBlock). The block is draggable (grip in
  // the header), remembers where it was dropped (localStorage), and the whole
  // feature can be turned off (Power button) — when off, clicking an event chip
  // opens the full editor directly and a small pill in the calendar corner
  // re-enables it.
  const [noteFor, setNoteFor] = useState<NoteAnchor | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteEnabled, setNoteEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NOTE_FEATURE_KEY) !== '0'
    } catch {
      return true
    }
  })
  const noteRef = useRef<HTMLDivElement>(null)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const dragState = useRef({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  })
  const dragPos = useRef<{ x: number; y: number } | null>(null)

  // # of other events overlapping the quick-note target (popover conflict hint).
  const noteConflictCount = useMemo(() => {
    if (!noteFor || !conflicts.has(noteFor.id)) return 0
    return conflictCountFor(
      items.map((i) => ({ id: i.id, start: i.start, end: i.end ?? null })),
      noteFor.id,
    )
  }, [noteFor, conflicts, items])

  useEffect(() => {
    if (!noteFor) return
    const onDown = (e: MouseEvent) => {
      if (noteRef.current && !noteRef.current.contains(e.target as Node)) setNoteFor(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNoteFor(null)
    }
    // The calendar area scrolls (overflow-y-auto); a scrolled-away anchor
    // should dismiss the block rather than leave it floating.
    const onScroll = () => setNoteFor(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    noteInputRef.current?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [noteFor])

  const setFeatureEnabled = (enabled: boolean) => {
    try {
      localStorage.setItem(NOTE_FEATURE_KEY, enabled ? '1' : '0')
    } catch {
      // ignore storage failures
    }
    setNoteEnabled(enabled)
    setNoteFor(null)
    setNoteText('')
  }

  const openNote = (info: EventClickInfo) => {
    const rect = info.el.getBoundingClientRect()
    let x = Math.max(NOTE_MARGIN, Math.min(rect.left, window.innerWidth - NOTE_POPOVER_WIDTH - NOTE_MARGIN))
    let y =
      rect.bottom + NOTE_MARGIN > window.innerHeight - NOTE_MAX_Y_OFFSET
        ? Math.max(NOTE_MARGIN, rect.top - NOTE_MAX_Y_OFFSET)
        : rect.bottom + NOTE_MARGIN
    // Reuse the spot where the block was last dropped so it stays put.
    const saved = readNotePos()
    if (saved) {
      x = Math.max(NOTE_MARGIN, Math.min(saved.x, window.innerWidth - NOTE_POPOVER_WIDTH - NOTE_MARGIN))
      y = Math.max(NOTE_MARGIN, Math.min(saved.y, window.innerHeight - NOTE_MAX_Y_OFFSET))
    }
    setNoteText('')
    const block = events.find((b) => b.id === info.event.id)
    setNoteFor({
      id: info.event.id,
      x,
      y,
      occurrence: block ? (occurrenceTimes(block, info) ?? undefined) : undefined,
    })
  }

  const handleEventClick = (info: EventClickInfo) => {
    if (!noteEnabled) {
      // Feature turned off: event click opens the full editor instead.
      onSelectBlock(info.event.id)
      return
    }
    openNote(info)
  }

  const saveNote = () => {
    if (!noteFor) return
    const text = noteText.trim()
    if (text) {
      if (noteFor.occurrence) {
        onQuickNoteOverride(noteFor.id, text, noteFor.occurrence.startIso, noteFor.occurrence.endIso)
      } else {
        onQuickNote(noteFor.id, text)
      }
    }
    setNoteFor(null)
    setNoteText('')
  }

  const handleDragStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (!noteFor || !noteRef.current) return
    dragState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: noteFor.x,
      origY: noteFor.y,
    }
    dragPos.current = { x: noteFor.x, y: noteFor.y }
    try {
      noteRef.current.setPointerCapture(e.pointerId)
    } catch {
      // synthetic/edge-case pointers have no capture target; drag still works
    }
  }

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    const x = Math.max(
      NOTE_MARGIN,
      Math.min(dragState.current.origX + dx, window.innerWidth - NOTE_POPOVER_WIDTH - NOTE_MARGIN),
    )
    const y = Math.max(NOTE_MARGIN, Math.min(dragState.current.origY + dy, window.innerHeight - NOTE_MAX_Y_OFFSET))
    dragPos.current = { x, y }
    setNoteFor((prev) => (prev ? { ...prev, x, y } : prev))
  }

  const handleDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return
    dragState.current.active = false
    try {
      if (noteRef.current?.hasPointerCapture(e.pointerId)) {
        noteRef.current.releasePointerCapture(e.pointerId)
      }
    } catch {
      // ignore capture-release failures
    }
    // Remember where the block was dropped.
    if (dragPos.current) {
      try {
        localStorage.setItem(NOTE_POS_KEY, JSON.stringify(dragPos.current))
      } catch {
        // ignore storage failures
      }
    }
  }

  const noteBlock = noteFor ? events.find((b) => b.id === noteFor.id) : undefined
  const notePreview = noteBlock ? textPreview(noteBlock.content) : ''

  return (
    <div className="relative h-full overflow-y-auto p-4">
      <Calendar
        ref={calendarRef}
        className="fc-app-shell"
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin, monarchThemePlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today quickAdd',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        buttons={{
          quickAdd: {
            text: '＋',
            isPrimary: true,
            hint: 'Tạo sự kiện vào ngày đang xem',
            click: handleQuickAdd,
          },
        }}
        firstDay={1}
        weekends
        nowIndicator
        editable
        locale={viLocale}
        events={items}
        // Render events as solid rectangular blocks (full cell width) instead of
        // small pill chips — the classic "rectangle button" look for calendar
        // events, and a bigger click target for the quick-note block.
        eventDisplay="block"
        eventClass={(renderProps) =>
          // Events read as rectangular buttons: full cell width, a little
          // padding, pointer cursor. Conflict marker (ring) still applies.
          `cursor-pointer px-1 py-0.5 ${conflictRingClass(conflicts, renderProps.event.id)}`
        }
        // Custom content so a recurring event carries a small repeat badge.
        eventContent={(arg) => (
          <div className="flex w-full items-center gap-1 overflow-hidden">
            <span className="min-w-0 truncate">{arg.event.title}</span>
            {arg.event.extendedProps.recurring && (
              <Repeat size={11} weight="bold" className="shrink-0 text-accent" aria-label="Lặp lại" />
            )}
          </div>
        )}
        eventClick={handleEventClick}
        dateClick={(info) => {
          // Create a NOTE on the clicked date and open the quick-note
          // popover directly — no event, no repeat picker.
          void (async () => {
            const blockId = await onDateNote(info.dateStr)
            if (!blockId) return
            // Force the quick-note popover open on the new note block.
            // We position it at the center of the viewport since there's
            // no event chip to anchor to.
            const x = Math.max(NOTE_MARGIN, Math.min(window.innerWidth / 2 - NOTE_POPOVER_WIDTH / 2, window.innerWidth - NOTE_POPOVER_WIDTH - NOTE_MARGIN))
            const y = Math.max(NOTE_MARGIN, window.innerHeight / 2 - 100)
            setNoteText('')
            setNoteFor({ id: blockId, x, y })
          })()
        }}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
      />

      {/* Side panel toggle — visible when the side panel is closed */}
      {!calendarSideOpen && (
        <button
          type="button"
          onClick={onToggleSide}
          title="Mở bảng bên (sự kiện sắp tới + ghi chú nhanh)"
          aria-label="Mở bảng bên"
          className="absolute right-4 top-2 z-20 flex h-7 items-center gap-1 rounded border border-border-subtle bg-surface-raised px-2 text-[11px] font-medium text-zinc-400 shadow-sm transition-colors hover:border-accent/50 hover:text-accent"
        >
          <DotsSixVertical size={12} />
          Bảng bên
        </button>
      )}

      {/* Mini date-picker for the ＋ button */}
      {datePickerOpen && (
        <div
          ref={datePickerRef}
          role="dialog"
          aria-label="Chọn ngày tạo sự kiện"
          className="absolute left-1/2 top-14 z-30 w-64 -translate-x-1/2 rounded-xl border border-border-subtle bg-surface-raised p-3 shadow-2xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setDatePickerMonth(new Date(datePickerMonth.getFullYear(), datePickerMonth.getMonth() - 1))}
              aria-label="Tháng trước"
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              ‹
            </button>
            <p className="text-[12px] font-semibold text-zinc-100">
              {datePickerMonth.toLocaleDateString('vi-VI', { month: 'long', year: 'numeric' })}
            </p>
            <button
              type="button"
              onClick={() => setDatePickerMonth(new Date(datePickerMonth.getFullYear(), datePickerMonth.getMonth() + 1))}
              aria-label="Tháng sau"
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => (
              <div key={d} className="py-1 text-center text-[10px] font-medium text-zinc-500">
                {d}
              </div>
            ))}
            {(() => {
              const year = datePickerMonth.getFullYear()
              const month = datePickerMonth.getMonth()
              const firstDay = new Date(year, month, 1)
              const startDow = (firstDay.getDay() + 6) % 7 // Monday=0
              const daysInMonth = new Date(year, month + 1, 0).getDate()
              const today = new Date()
              const cells: React.ReactNode[] = []
              for (let i = 0; i < startDow; i++) {
                cells.push(<div key={`empty-${i}`} />)
              }
              for (let day = 1; day <= daysInMonth; day++) {
                const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
                cells.push(
                  <button
                    key={ds}
                    type="button"
                    onClick={() => handleDatePickerPick(ds)}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-medium transition-colors ${
                      isToday
                        ? 'bg-accent text-accent-foreground'
                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                    }`}
                  >
                    {day}
                  </button>,
                )
              }
              return cells
            })()}
          </div>
        </div>
      )}

      {repeatPrompt && (
        <div
          ref={repeatRef}
          role="dialog"
          aria-label="Chọn lặp lại sự kiện"
          className="absolute left-1/2 top-14 z-30 w-60 -translate-x-1/2 rounded-xl border border-border-subtle bg-surface-raised p-2 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2 px-1.5 pt-0.5">
            <p className="min-w-0 truncate text-[12px] font-semibold text-zinc-100">
              {events.find((b) => b.id === repeatPrompt.blockId)?.title ?? 'Sự kiện'}
            </p>
            <button
              type="button"
              onClick={recurrenceUnavailable ? dismissRepeatNotice : () => setRepeatPrompt(null)}
              aria-label="Đóng chọn lặp lại"
              title={recurrenceUnavailable ? 'Đóng và không hỏi lại' : 'Giữ sự kiện một lần'}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X size={13} />
            </button>
          </div>
          {recurrenceUnavailable ? (
            <div className="mt-1 space-y-2 px-1.5 pb-0.5">
              <p className="text-[11px] leading-relaxed text-amber-400/90">
                Lặp lại chưa khả dụng trên máy chủ này — sự kiện đã lưu dưới dạng một lần.
              </p>
              <button
                type="button"
                onClick={dismissRepeatNotice}
                className="w-full rounded-lg border border-border-subtle px-2 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
              >
                Đóng
              </button>
            </div>
          ) : repeatCountForm ? (
            <div className="mt-1 space-y-1.5 px-1.5 pb-0.5">
              <label className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                <span>Mỗi</span>
                <select
                  value={repeatCountForm.freq}
                  onChange={(e) =>
                    setRepeatCountForm({ ...repeatCountForm, freq: Number(e.target.value) })
                  }
                  aria-label="Tần suất lặp lại"
                  className="rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
                >
                  {FREQ_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {FREQ_UNITS[value] ?? label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                <input
                  type="number"
                  min={1}
                  value={repeatCountForm.interval}
                  onChange={(e) =>
                    setRepeatCountForm({
                      ...repeatCountForm,
                      interval: Math.max(1, Math.floor(Number(e.target.value)) || 1),
                    })
                  }
                  aria-label="Khoảng lặp lại"
                  className="w-12 rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
                />
                <span>mỗi</span>
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                <input
                  type="number"
                  min={2}
                  value={repeatCountForm.count}
                  onChange={(e) =>
                    setRepeatCountForm({ ...repeatCountForm, count: Math.max(2, Number(e.target.value) || 2) })
                  }
                  aria-label="Số lần lặp lại"
                  className="w-14 rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
                />
                <span>lần</span>
              </label>
              {preview && <p className="text-[11px] leading-relaxed text-zinc-500">{preview}</p>}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={saveRepeatCount}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-2 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
                >
                  <Check size={12} weight="bold" />
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => setRepeatCountForm(null)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border-subtle px-2 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                >
                  Hủy
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {REPEAT_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => (opt.countForm ? openRepeatCountForm() : applyRepeat(opt.rrule))}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-border-subtle px-2 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:border-accent/50 hover:bg-zinc-800 hover:text-accent"
                >
                  <Repeat size={12} weight="bold" className="shrink-0 text-accent" />
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <RecurrenceChoice
        state={recurrenceChoice ? { title: recurrenceChoice.title } : null}
        onThis={choiceThis}
        onAll={choiceAll}
        onThisAndFuture={choiceThisAndFuture}
        onCancel={() => setRecurrenceChoice(null)}
      />

      <RecurrenceChoice
        state={deleteChoice ? { title: deleteChoice.title } : null}
        variant="delete"
        onThis={confirmDeleteThis}
        onThisAndFuture={confirmDeleteThisAndFuture}
        onAll={confirmDeleteAll}
        onCancel={() => setDeleteChoice(null)}
      />

      {!noteEnabled && (
        <button
          type="button"
          onClick={() => setFeatureEnabled(true)}
          title="Bật lại ghi chú nhanh (bấm vào sự kiện để ghi chú trực tiếp)"
          aria-label="Bật ghi chú nhanh"
          className="absolute right-4 top-16 z-20 flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-raised px-2.5 text-[12px] font-medium text-zinc-300 shadow-lg transition-colors hover:border-accent/50 hover:text-accent"
        >
          <Note size={14} />
          Bật ghi chú nhanh
        </button>
      )}

      {noteFor && noteBlock && (
        <div
          ref={noteRef}
          role="dialog"
          aria-label={`Ghi chú cho ${noteBlock.title ?? 'sự kiện'}`}
          style={{ left: noteFor.x, top: noteFor.y, width: NOTE_POPOVER_WIDTH }}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          className="fixed z-50 rounded-xl border border-border-subtle bg-surface-raised p-3 shadow-2xl"
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onPointerDown={handleDragStart}
              aria-label="Kéo ghi chú nhanh"
              title="Kéo để di chuyển khối ghi chú"
              className="flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 active:cursor-grabbing"
            >
              <DotsSixVertical size={14} />
            </button>
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100">
              {noteBlock.title ?? 'Sự kiện'}
            </p>
            <button
              type="button"
              onClick={() => setFeatureEnabled(false)}
              aria-label="Tắt ghi chú nhanh"
              title="Tắt tính năng ghi chú nhanh — bấm vào sự kiện sẽ mở trình soạn thảo"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-300"
            >
              <Power size={13} />
            </button>
            <button
              type="button"
              onClick={requestDelete}
              aria-label="Xóa sự kiện"
              title="Xóa"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
            >
              <Trash size={13} />
            </button>
            <button
              type="button"
              onClick={() => setNoteFor(null)}
              aria-label="Đóng ghi chú nhanh"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X size={13} />
            </button>
          </div>
          {noteFor.occurrence && (
            <p className="mt-1 text-[11px] leading-snug text-accent/80">
              Ghi chú riêng cho lần này — không ảnh hưởng các lần khác.
            </p>
          )}
          {noteConflictCount > 0 && (
            <p className="mt-1 flex items-center gap-1 text-[11px] leading-snug text-amber-300/90">
              <Warning size={12} weight="bold" className="shrink-0" />
              Trùng lịch với {noteConflictCount} sự kiện
            </p>
          )}
          {notePreview && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{notePreview}</p>
          )}
          <textarea
            ref={noteInputRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                saveNote()
              }
            }}
            rows={3}
            placeholder="Ghi chú nhanh… (Enter để lưu)"
            aria-label="Ghi chú nhanh"
            className="mt-2 w-full resize-none rounded-lg border border-border-subtle bg-background px-2.5 py-2 text-[12px] text-zinc-200 placeholder:text-zinc-500 focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setNoteFor(null)
                onSelectBlock(noteBlock.id)
              }}
              className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-accent transition-colors hover:bg-zinc-800"
            >
              Mở trình soạn thảo
            </button>
            <button
              type="button"
              onClick={saveNote}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
            >
              Lưu ghi chú
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
