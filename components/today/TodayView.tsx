'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BellRinging,
  CalendarBlank,
  CheckCircle,
  FileCode,
  Files,
  Hourglass,
  NotePencil,
  PaperPlaneTilt,
  SunHorizon,
} from '@phosphor-icons/react'
import { useBlocksStore } from '@/store/useBlocksStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { countTasks } from '@/lib/tasks'
import { appendNote } from '@/lib/notes'
import { dateLabel, horizonOf, isEnded, startOfDay, WEEKDAYS, pad } from '@/lib/horizon'
import { isAllDayIso } from '@/lib/overlap'
import { isRecurring } from '@/lib/recurrence'
import { expandBlockOccurrences, occurrenceBlock } from '@/lib/expansion'
import { useNowEvery } from '@/lib/useNowEvery'
import { expandOccurrences, minutesBetween, nextUpcomingEvent } from '@/lib/reminders'
import TodoChip from '@/components/planner/TodoChip'
import type { Block } from '@/types'

// Static map (module scope) so no component is created during render.
const BLOCK_ICONS: Record<Block['type'], React.ElementType> = {
  event: CalendarBlank,
  note: NotePencil,
  code: FileCode,
  file: Files,
}

// Countdown text for the next-upcoming-event banner. Minutes while under an
// hour, then the clock time (clearer than "sau 150 phút"), and "sắp bắt đầu"
// once the event is within a minute.
function countdownLabel(event: Block, now: Date): string {
  const start = new Date(event.start_time ?? '')
  const minutes = Math.max(0, Math.ceil((start.getTime() - now.getTime()) / 60_000))
  if (minutes === 0) return 'sắp bắt đầu'
  if (minutes < 60) return `bắt đầu sau ${minutes} phút`
  return `bắt đầu lúc ${pad(start.getHours())}:${pad(start.getMinutes())}`
}

import { textPreview } from '@/lib/textPreview'

export default function TodayView() {
  const blocks = useBlocksStore((state) => state.blocks)
  const addBlock = useBlocksStore((state) => state.addBlock)
  const setSelectedBlock = useWorkspaceStore((state) => state.setSelectedBlock)
  const setActiveRightPane = useWorkspaceStore((state) => state.setActiveRightPane)

  const [capture, setCapture] = useState('')
  const [captureMode, setCaptureMode] = useState<'note' | 'task'>('note')
  const [savedFlash, setSavedFlash] = useState(false)
  const flashTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [])

  // Re-bucket on each tick so events that just ended drop off and items that
  // come due (or fall overdue) appear, without waiting for a store change.
  const now = useNowEvery()

  // Digest buckets — same classification as the planner, so today's horizon is
  // identical between the two views. Today's events live in their own section;
  // everything else that is overdue or due today (notes, code, missed events)
  // counts as "Việc cần làm". File blocks are skipped everywhere. Recurring
  // series contribute their OCCURRENCES that land today (opening the master),
  // so a weekly meeting today shows up here instead of as a stale overdue
  // master whose first occurrence was last month.
  const { events, tasks, banner } = useMemo(() => {
    const events: { block: Block; masterId: string }[] = []
    const tasks: { block: Block; masterId: string; overdue: boolean }[] = []

    // Window for occurrence expansion: the digest only cares about today.
    const dayStart = startOfDay(now)
    const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1)

    for (const b of blocks) {
      if (b.type === 'file') continue
      if (isRecurring(b)) {
        // Past occurrences of an ongoing series are history, not tasks; only
        // today's occurrence(s) surface in the digest.
        for (const occ of expandBlockOccurrences(b, dayStart, dayEnd)) {
          const occurrence = occurrenceBlock(b, occ)
          if (isEnded(occurrence, now) && !isAllDayIso(occurrence.end_time)) continue
          if (b.type === 'event') events.push({ block: occurrence, masterId: b.id })
          else tasks.push({ block: occurrence, masterId: b.id, overdue: false })
        }
        continue
      }
      // Done — the digest shows only what still needs attention today. Ended
      // timed events drop off; ended all-day events stay as overdue items in
      // "Việc cần làm" (a past all-day plan still needs attention until dealt
      // with, unlike a meeting that already happened).
      if (isEnded(b, now) && !isAllDayIso(b.end_time)) continue
      const horizon = horizonOf(b, now)
      if (b.type === 'event' && horizon === 'today') {
        events.push({ block: b, masterId: b.id })
      } else if (horizon === 'overdue' || horizon === 'today') {
        tasks.push({ block: b, masterId: b.id, overdue: horizon === 'overdue' })
      }
    }
    const byTime = (a: { block: Block }, b: { block: Block }) => {
      const ta = a.block.start_time ? new Date(a.block.start_time).getTime() : Number.MAX_SAFE_INTEGER
      const tb = b.block.start_time ? new Date(b.block.start_time).getTime() : Number.MAX_SAFE_INTEGER
      return ta - tb
    }
    events.sort(byTime)
    tasks.sort((a, b) => (a.overdue === b.overdue ? byTime(a, b) : a.overdue ? -1 : 1))

    // Banner: today's earliest not-yet-started event (occurrences included),
    // with a live countdown. When nothing is coming up today, fall back to the
    // chronologically next planner item — the nearest future-dated one wins
    // (a recurring series counts as its next occurrence, never as an overdue
    // master), and only when no future-dated item exists does the most recently
    // missed overdue item take the slot (labelled "quá hạn" or its date).
    // All-day events store start_time as 'YYYY-MM-DD' or a UTC-midnight
    // instant; JS parses both as UTC midnight, which for any positive-offset
    // timezone is already < now once the UTC day starts (e.g. stale from 07:00
    // local in UTC+7). Treat an all-day event whose calendar day is today or
    // later as upcoming, using startOfDay comparison like horizonOf.
    const today0 = startOfDay(now)
    const todayNext =
      events.find((e) => {
        if (!e.block.start_time) return false
        if (isAllDayIso(e.block.start_time)) {
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(e.block.start_time)
          if (!m) return false
          const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
          return !Number.isNaN(day.getTime()) && day.getTime() >= today0.getTime()
        }
        const s = new Date(e.block.start_time).getTime()
        return !Number.isNaN(s) && s > now.getTime()
      }) ?? null

    let bannerBlock: Block | null = todayNext ? todayNext.block : null
    let bannerLabel = ''
    let bannerOverdue = false
    if (bannerBlock) {
      bannerLabel = countdownLabel(bannerBlock, now)
    } else {
      let best: Block | null = null
      let bestStart = 0
      let bestIsFuture = false
      const recWindowEnd = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000)
      for (const b of blocks) {
        if (b.type === 'file') continue
        if (isRecurring(b)) {
          const next = expandBlockOccurrences(b, now, recWindowEnd).find(
            (o) => o.start.getTime() >= now.getTime(),
          )
          if (!next) continue
          const s = next.start.getTime()
          if (!bestIsFuture || s < bestStart) {
            bestIsFuture = true
            bestStart = s
            best = occurrenceBlock(b, next)
          }
          continue
        }
        if (isEnded(b, now)) continue
        const h = horizonOf(b, now)
        if (h !== 'overdue' && h !== 'week' && h !== 'month' && h !== 'year' && h !== 'future') continue
        const s = b.start_time ? new Date(b.start_time).getTime() : Number.NaN
        if (Number.isNaN(s)) continue
        const isFuture = s >= now.getTime()
        if (isFuture) {
          // Chronologically next upcoming item wins outright.
          if (!bestIsFuture || s < bestStart) {
            bestIsFuture = true
            bestStart = s
            best = b
          }
        } else if (!bestIsFuture && (best === null || s > bestStart)) {
          // No upcoming item seen yet: most recently missed.
          bestStart = s
          best = b
        }
      }
      if (best) {
        bannerBlock = best
        bannerOverdue = horizonOf(best, now) === 'overdue'
        bannerLabel = bannerOverdue ? 'quá hạn' : dateLabel(best)
      }
    }

    return {
      events,
      tasks,
      banner: bannerBlock ? { block: bannerBlock, label: bannerLabel, overdue: bannerOverdue } : null,
    }
  }, [blocks, now])

  // Reminder bell: mirrors the Notification watcher's threshold (same window
  // semantics via nextUpcomingEvent over the same occurrence expansion), but
  // only as an in-app indicator — no second watcher instance, so notifications
  // never double-fire. Appears when a block (or a recurring occurrence) starts
  // within reminderMinutes; hidden when reminders are off.
  const remindersEnabled = useSettingsStore((s) => s.remindersEnabled)
  const reminderMinutes = useSettingsStore((s) => s.reminderMinutes)
  const reminderNext = useMemo(() => {
    if (!remindersEnabled || reminderMinutes <= 0) return null
    const withinMs = reminderMinutes * 60_000
    return nextUpcomingEvent(expandOccurrences(blocks, now, withinMs), now, withinMs)
  }, [blocks, now, remindersEnabled, reminderMinutes])
  const reminderMins =
    reminderNext && reminderNext.start_time ? minutesBetween(now, reminderNext.start_time) : null

  const todayLabel = `Hôm nay — ${WEEKDAYS[now.getDay()]} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`

  const handleCapture = async () => {
    const text = capture.trim()
    if (!text) return
    const firstLine = text.split('\n')[0].trim()
    if (captureMode === 'task') {
      // Create a note with a task checklist — each non-empty line becomes a task item.
      const lines = text.split('\n').filter((l) => l.trim())
      const taskContent = {
        type: 'doc' as const,
        content: [
          {
            type: 'taskList' as const,
            attrs: { tight: true, itemTypeName: 'taskItem' },
            content: lines.map((line) => ({
              type: 'taskItem' as const,
              attrs: { checked: false, text: line.trim() },
            })),
          },
        ],
      }
      await addBlock({
        type: 'note',
        title: firstLine.slice(0, 48) || 'Task mới',
        content: taskContent as Block['content'],
        start_time: null,
      })
    } else {
      await addBlock({
        type: 'note',
        title: firstLine.slice(0, 48) || 'Ghi chú nhanh',
        content: appendNote({ type: 'doc', content: [] }, text) as Block['content'],
        start_time: null,
      })
    }
    setCapture('')
    setSavedFlash(true)
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 2000)
  }

  const openBlock = (id: string) => {
    setSelectedBlock(id)
    setActiveRightPane('editor')
  }

  const empty = events.length === 0 && tasks.length === 0

  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-semibold text-zinc-100">Hôm nay</h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">{todayLabel}</p>
        </div>
        {reminderNext && reminderMins !== null && (
          <button
            type="button"
            onClick={() => openBlock(reminderNext.blockId ?? reminderNext.id)}
            aria-label={`Nhắc: ${reminderNext.title ?? 'Sự kiện'} — ${reminderMins <= 0 ? 'sắp bắt đầu' : `bắt đầu sau ${reminderMins} phút`}`}
            title="Sẽ thông báo khi sự kiện bắt đầu (bấm để mở)"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-2.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/20"
          >
            <BellRinging size={13} weight="fill" />
            <span className="max-w-[160px] truncate">{reminderNext.title ?? 'Sự kiện'}</span>
            <span className="font-mono text-[11px] text-accent/80">
              {reminderMins <= 0 ? 'sắp bắt đầu' : `${reminderMins} phút`}
            </span>
          </button>
        )}
      </header>

      {/* Next up: today's next event with a live countdown, or the closest
          overdue / future-dated planner item when nothing is coming up today. */}
      {banner && (
        <NextBanner block={banner.block} label={banner.label} overdue={banner.overdue} />
      )}

      {/* Quick capture */}
      <section className="mb-4 rounded-xl border border-border-subtle bg-surface p-3">
        <div className="mb-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCaptureMode('note')}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
              captureMode === 'note'
                ? 'bg-accent/15 text-accent'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <NotePencil size={11} className="mr-1 inline" />
            Ghi chú
          </button>
          <button
            type="button"
            onClick={() => setCaptureMode('task')}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
              captureMode === 'task'
                ? 'bg-accent/15 text-accent'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <CheckCircle size={11} className="mr-1 inline" />
            Task
          </button>
        </div>
        <div className="flex items-start gap-2">
          <textarea
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleCapture()
              }
            }}
            rows={2}
            placeholder={captureMode === 'task' ? 'Task mới (mỗi dòng 1 task, Enter để lưu)' : 'Ghi chú nhanh… (Enter để lưu)'}
            aria-label={captureMode === 'task' ? 'Tạo task mới' : 'Ghi chú nhanh'}
            className="min-h-[56px] flex-1 resize-none rounded-lg border border-border-subtle bg-background px-2.5 py-2 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleCapture()}
            disabled={!capture.trim()}
            aria-label={captureMode === 'task' ? 'Tạo task' : 'Lưu ghi chú nhanh'}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PaperPlaneTilt size={13} weight="bold" />
            {captureMode === 'task' ? 'Tạo task' : 'Ghi chú nhanh'}
          </button>
        </div>
        {savedFlash && (
          <p className="mt-2 flex items-center gap-1 text-[12px] text-emerald-400">
            <CheckCircle size={13} weight="fill" />
            {captureMode === 'task' ? 'Đã thêm task' : 'Đã thêm ghi chú'}
          </p>
        )}
      </section>

      {empty ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 pb-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface">
            <SunHorizon size={26} className="text-zinc-600" />
          </div>
          <p className="text-[15px] font-medium text-zinc-300">Một ngày trống trải</p>
          <p className="max-w-[40ch] text-[13px] leading-relaxed text-zinc-500">
            Chưa có sự kiện hay việc cần làm nào hôm nay. Dùng ô ghi chú nhanh phía trên để chớp lấy ý
            tưởng đầu tiên.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-xl border border-border-subtle bg-surface">
            <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
              <CalendarBlank size={15} className="text-accent" />
              <h2 className="text-[13px] font-semibold text-zinc-200">Sự kiện hôm nay</h2>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                {events.length}
              </span>
            </header>
            {events.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-zinc-600">Không có sự kiện nào hôm nay.</p>
            ) : (
              <ul className="p-2">
                {events.map(({ block, masterId }) => (
                  <li key={block.id}>
                    <DigestRow block={block} overdue={false} onOpen={() => openBlock(masterId)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border-subtle bg-surface">
            <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
              <Hourglass size={15} className="text-accent" />
              <h2 className="text-[13px] font-semibold text-zinc-200">Việc cần làm</h2>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                {tasks.length}
              </span>
            </header>
            {tasks.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-zinc-600">Không có việc nào quá hạn hay đến hạn hôm nay.</p>
            ) : (
              <ul className="p-2">
                {tasks.map(({ block, masterId, overdue }) => (
                  <li key={block.id}>
                    <DigestRow block={block} overdue={overdue} onOpen={() => openBlock(masterId)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function NextBanner({ block, label, overdue }: { block: Block; label: string; overdue: boolean }) {
  return (
    <div
      aria-label={overdue ? 'Việc quá hạn' : 'Sự kiện tiếp theo'}
      className={`mb-4 flex items-center gap-2.5 rounded-xl border px-4 py-2.5 ${
        overdue ? 'border-red-900/40 bg-red-500/10' : 'border-accent/25 bg-accent/10'
      }`}
    >
      {(() => {
        const Icon = BLOCK_ICONS[block.type]
        return (
          <Icon
            size={15}
            weight="fill"
            className={`shrink-0 ${overdue ? 'text-red-400' : 'text-accent'}`}
          />
        )
      })()}
      <p className="min-w-0 truncate text-[13px] text-zinc-300">
        <span className="font-medium text-zinc-100">{block.title ?? 'Sự kiện'}</span>
        <span className={overdue ? 'text-red-300' : 'text-zinc-400'}> · {label}</span>
      </p>
    </div>
  )
}

function DigestRow({ block, overdue, onOpen }: { block: Block; overdue: boolean; onOpen: () => void }) {
  const tasks = countTasks(block.content)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-zinc-800/60"
    >
      {(() => {
        const Icon = BLOCK_ICONS[block.type]
        return (
          <Icon
            size={15}
            weight="fill"
            className={`mt-0.5 shrink-0 ${overdue ? 'text-red-400/80' : 'text-accent/80'}`}
          />
        )
      })()}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[13px] font-medium text-zinc-100">{block.title ?? 'Chưa có tiêu đề'}</p>
          {tasks.total > 0 && <TodoChip done={tasks.done} total={tasks.total} />}
        </div>
        <p className="truncate text-[12px] text-zinc-500">{textPreview(block.content)}</p>
        <p className={`mt-0.5 font-mono text-[11px] ${overdue ? 'text-red-400/80' : 'text-zinc-500'}`}>
          {dateLabel(block)}
        </p>
      </div>
    </div>
  )
}
