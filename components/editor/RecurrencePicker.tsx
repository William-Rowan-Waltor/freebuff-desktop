'use client'

import { RRule } from 'rrule'
import { buildRRuleString, FREQ_OPTIONS, parseRecurrence } from '@/lib/recurrence'
import { useBlocksStore } from '@/store/useBlocksStore'
import type { Block } from '@/types'

// Vietnamese weekday names indexed by Date.getDay() (0 = Sunday).
const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

// Short chips + full names indexed by rrule's weekday index (0 = Monday).
const WEEKDAY_IDX_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const WEEKDAY_IDX_NAMES = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']

const POS_LABELS: { value: number; label: string }[] = [
  { value: 1, label: 'đầu tiên' },
  { value: 2, label: 'thứ 2' },
  { value: 3, label: 'thứ 3' },
  { value: 4, label: 'thứ 4' },
  { value: -1, label: 'cuối cùng' },
]

function untilToInput(until: Date | null): string {
  if (!until) return ''
  return until.toISOString().slice(0, 10)
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "Đến ngày" means through that calendar date in the user's LOCAL timezone.
// Store the last instant of the local day so an occurrence at 23:00 local on
// the until date is still included (Date.UTC would exclude it in negative-
// offset zones: 23:00-05 == 04:00Z next day > until).
function inputToUntil(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  // end of local day: next day midnight minus 1 ms
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 0, 0, 0, -1)
  return Number.isNaN(d.getTime()) ? null : d
}

interface RecurrencePickerProps {
  block: Block
  onChange: (block: Block, patch: Partial<Block>) => void
}

/**
 * The editor's "Lặp lại" control for events. Reads/writes block.recurrence as a
 * bare RRULE string (no DTSTART — that is start_time) via lib/recurrence.
 * Rule changes (freq/interval/until/monthly target) always apply to the whole
 * series. Datetime edits on the editor surface the "Chỉ lần này / Tất cả các
 * lần" choice (see EditorPane) via the shared createOverride machinery.
 */
export default function RecurrencePicker({ block, onChange }: RecurrencePickerProps) {
  // When the live DB predates the recurrence migration, PostgREST serves a
  // schema without blocks.recurrence: saving a rule would 42703. The store
  // flags it and this picker degrades to a notice — the event stays one-off
  // (createBlock/updateBlock strip the rule instead of crashing).
  const recurrenceUnavailable = useBlocksStore((s) => s.recurrenceUnavailable)

  const spec = parseRecurrence(block.recurrence)

  const setRule = (recurrence: string | null) => onChange(block, { recurrence })

  const selectFreq = (value: number) => {
    if (value === -1) {
      setRule(null)
      return
    }
    setRule(
      buildRRuleString({
        freq: value,
        interval: spec?.interval ?? 1,
        until: spec?.until ?? null,
        count: spec?.count ?? null,
      }),
    )
  }

  // Rebuild the rule from the current spec, keeping the day-target parts
  // (BYDAY/BYMONTHDAY/BYSETPOS) — interval/until/count edits must not drop
  // them. UNTIL and COUNT are mutually exclusive (rrule forbids both): setting
  // one clears the other, so the UI keeps them in exactly one mode at a time.
  const buildFromSpec = (patch: { interval?: number; until?: Date | null; count?: number | null }) => {
    if (!spec) return ''
    const until = patch.until !== undefined ? patch.until : spec.until
    const count = patch.count !== undefined ? patch.count : spec.count
    return buildRRuleString({
      freq: spec.freq,
      interval: patch.interval ?? spec.interval,
      until: count != null ? null : until,
      count: until != null ? null : count,
      byweekday: spec.byweekday,
      bymonthday: spec.bymonthday,
      bysetpos: spec.bysetpos,
    })
  }

  const setInterval = (value: number) => {
    if (!spec) return
    const interval = Math.max(1, Math.floor(value) || 1)
    setRule(buildFromSpec({ interval }))
  }

  const setUntil = (value: string) => {
    if (!spec) return
    // Choosing an end date clears any COUNT so the two stay exclusive.
    setRule(buildFromSpec({ until: inputToUntil(value), count: null }))
  }

  const setCount = (value: number) => {
    if (!spec) return
    // Choosing a repeat count clears any UNTIL so the two stay exclusive.
    const count = Math.max(1, Math.floor(value) || 1)
    setRule(buildFromSpec({ count, until: null }))
  }

  // End condition mode: UNTIL and COUNT are alternatives; null = no end. The
  // mode is derived from the rule, so switching modes writes a default value
  // (COUNT=1 / today at end-of-day) — otherwise the new mode would have no
  // matching part in the rule and snap straight back.
  const endMode: 'none' | 'until' | 'count' = spec?.until ? 'until' : spec?.count ? 'count' : 'none'

  const setEndMode = (mode: 'none' | 'until' | 'count') => {
    if (!spec) return
    if (mode === 'none') setRule(buildFromSpec({ until: null, count: null }))
    else if (mode === 'until') setRule(buildFromSpec({ count: null, until: inputToUntil(todayLocal()) }))
    else setRule(buildFromSpec({ until: null, count: 1 }))
  }

  // Monthly day-target picker: the dtstart-anchored default (no BYMONTHDAY /
  // BYDAY — rrule repeats on the same day-of-month as the event), an explicit
  // day-of-month (BYMONTHDAY, including -1 = last day), or a weekday ordinal
  // (BYDAY + BYSETPOS, e.g. 'Thứ 6 cuối cùng').
  const start = block.start_time ? new Date(block.start_time) : null
  const dtstartDay = start && !Number.isNaN(start.getTime()) ? start.getDate() : 1
  const weekdayName = start && !Number.isNaN(start.getTime()) ? WEEKDAY_NAMES[start.getDay()] : 'Thứ 2'
  // rrule's Monday=0 numbering from Date.getDay() (0 = Sunday).
  const weekdayIdx = start && !Number.isNaN(start.getTime()) ? (start.getDay() + 6) % 7 : 0

  let monthTarget = 'dom:default'
  if (spec?.bymonthday?.length) monthTarget = `dom:${spec.bymonthday[0]}`
  else if (spec?.bysetpos?.length) monthTarget = `pos:${spec.bysetpos[0]}`

  // Weekly weekday chips: the anchored weekday is implicitly selected when the
  // rule has no BYDAY; toggling writes an explicit BYDAY list. Deselecting
  // every chip removes the recurrence (clears the rule) — deselect-all on a
  // weekly series means the user no longer wants it to repeat.
  const weekdaySelection = spec?.byweekday ?? [weekdayIdx]

  const toggleWeekday = (idx: number) => {
    if (!spec) return
    const current = weekdaySelection.includes(idx)
      ? weekdaySelection.filter((d) => d !== idx)
      : [...weekdaySelection, idx].sort((a, b) => a - b)
    if (current.length === 0) {
      // Deselecting the last chip → remove recurrence entirely.
      setRule(null)
      return
    }
    setRule(
      buildRRuleString({
        freq: spec.freq,
        interval: spec.interval,
        until: spec.until ?? null,
        count: spec.count ?? null,
        byweekday: current,
      }),
    )
  }

  const setMonthTarget = (value: string) => {
    if (!spec) return
    const base = { freq: spec.freq, interval: spec.interval, until: spec.until ?? null, count: spec.count ?? null }
    if (value === 'dom:default') {
      setRule(buildRRuleString(base))
    } else if (value.startsWith('dom:')) {
      setRule(buildRRuleString({ ...base, bymonthday: [Number(value.slice(4))] }))
    } else if (value.startsWith('pos:')) {
      setRule(buildRRuleString({ ...base, byweekday: [weekdayIdx], bysetpos: [Number(value.slice(4))] }))
    }
  }

  if (recurrenceUnavailable) {
    return (
      <p className="mt-2.5 text-[11px] leading-relaxed text-amber-400/90">
        Lặp lại chưa khả dụng trên máy chủ này — sự kiện sẽ lưu dưới dạng một lần.
      </p>
    )
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-zinc-400">
      <span>Lặp lại</span>
      <select
        value={spec ? spec.freq : -1}
        onChange={(e) => selectFreq(Number(e.target.value))}
        aria-label="Lặp lại"
        className="rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
      >
        <option value={-1}>Không lặp lại</option>
        {FREQ_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {spec && (
        <>
          <label className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={spec.interval}
              onChange={(e) => setInterval(Number(e.target.value))}
              aria-label="Khoảng lặp"
              className="w-14 rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
            />
            <span>lần</span>
          </label>
          {spec.freq === RRule.WEEKLY && (
            <label className="flex items-center gap-1">
              <span>vào</span>
              <span className="flex gap-0.5">
                {WEEKDAY_IDX_SHORT.map((short, idx) => {
                  const active = weekdaySelection.includes(idx)
                  return (
                    <button
                      key={short}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${WEEKDAY_IDX_NAMES[idx]} — ${active ? 'bỏ chọn' : 'chọn'}`}
                      title={WEEKDAY_IDX_NAMES[idx]}
                      onClick={() => toggleWeekday(idx)}
                      className={`h-6 w-7 rounded-md border text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-border-subtle text-zinc-400 hover:border-accent/50 hover:text-zinc-200'
                      }`}
                    >
                      {short}
                    </button>
                  )
                })}
              </span>
            </label>
          )}
          <label className="flex items-center gap-1">
            <select
              value={endMode}
              onChange={(e) => setEndMode(e.target.value as 'none' | 'until' | 'count')}
              aria-label="Kết thúc lặp lại"
              className="rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
            >
              <option value="none">Không kết thúc</option>
              <option value="until">Đến ngày</option>
              <option value="count">Số lần</option>
            </select>
          </label>
          {endMode === 'until' && (
            <label className="flex items-center gap-1">
              <input
                type="date"
                value={untilToInput(spec.until)}
                onChange={(e) => setUntil(e.target.value)}
                aria-label="Lặp lại đến ngày"
                className="rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
              />
              <span>đến</span>
            </label>
          )}
          {endMode === 'count' && (
            <label className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                value={spec.count ?? 1}
                onChange={(e) => setCount(Number(e.target.value))}
                aria-label="Số lần lặp lại"
                className="w-14 rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
              />
              <span>lần</span>
            </label>
          )}
          {spec.freq === RRule.MONTHLY && (
            <label className="flex items-center gap-1">
              <select
                value={monthTarget}
                onChange={(e) => setMonthTarget(e.target.value)}
                aria-label="Vào ngày nào trong tháng"
                className="rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
              >
                <option value="dom:default">Ngày {dtstartDay} hằng tháng</option>
                {[-1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31].map(
                  (d) => (
                    <option key={d} value={`dom:${d}`}>
                      {d === -1 ? 'Ngày cuối tháng' : `Ngày ${d}`}
                    </option>
                  ),
                )}
                {POS_LABELS.map((p) => (
                  <option key={p.value} value={`pos:${p.value}`}>
                    {weekdayName} {p.label} của tháng
                  </option>
                ))}
              </select>
              <span>vào</span>
            </label>
          )}
        </>
      )}
    </div>
  )
}
