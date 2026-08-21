'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Clock as ClockIcon,
  Play,
  Pause,
  ArrowCounterClockwise,
  X,
  Hourglass,
  Timer as TimerIcon,
} from '@phosphor-icons/react'
import { useTimerStore, timerValueMs, type TimerKind } from '@/store/useTimerStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { playChime } from '@/lib/chime'
import { formatHMS } from '@/lib/time'

const COUNTDOWN_PRESETS = [25, 30, 60, 90, 120]
const FLASH_DURATION_MS = 10_000
const FLASH_INTERVAL_MS = 800

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function clockHMS(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Clock() {
  const [open, setOpen] = useState(false)
  const [viewTab, setViewTab] = useState<TimerKind>('stopwatch')
  // Start at null and only set the time after mount: rendering live time (or
  // store-derived UI) during SSR would make server/client HTML differ and break
  // hydration (Date.now(), persisted timer state).
  const [now, setNow] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const timer = useTimerStore()

  const baseTitleRef = useRef('Workspace')
  const flashTimerRef = useRef<number | null>(null)
  const flashStopRef = useRef<number | null>(null)
  const lastNotifyRef = useRef(0)

  // Capture the app title on mount. Note: the cleanup does NOT clear the flash
  // interval — React StrictMode (dev) unmounts/remounts effects right after
  // mount, and clearing it there would kill a notification started by the first
  // mount's tick. The flash self-terminates via its own timeout (stopFlash).
  useEffect(() => {
    baseTitleRef.current = document.title || 'Workspace'
    return () => {
      document.title = baseTitleRef.current
    }
  }, [])

  // Live tick: drives the clock chip, the timer displays, and the tab title.
  useEffect(() => {
    const stopFlash = () => {
      if (flashTimerRef.current != null) {
        window.clearInterval(flashTimerRef.current)
        flashTimerRef.current = null
      }
      if (flashStopRef.current != null) {
        window.clearTimeout(flashStopRef.current)
        flashStopRef.current = null
      }
      document.title = baseTitleRef.current
    }

    // A countdown just hit zero: beep (if enabled) and flash the tab title (if
    // enabled) for a few seconds. Guarded so duplicate ticks (StrictMode/Fast
    // Refresh dev artifacts) don't notify twice within a couple of seconds.
    const notifyFinish = () => {
      const ts = Date.now()
      if (ts - lastNotifyRef.current < 2500) return
      lastNotifyRef.current = ts
      const settings = useSettingsStore.getState()
      if (settings.notifyBeep) playChime(settings.chime, settings.customChimeFreq)
      if (!settings.notifyFlash) return
      stopFlash()
      let flash = false
      flashTimerRef.current = window.setInterval(() => {
        flash = !flash
        document.title = flash ? '⏰ Hết giờ!' : baseTitleRef.current
      }, FLASH_INTERVAL_MS)
      flashStopRef.current = window.setTimeout(stopFlash, FLASH_DURATION_MS)
    }

    const tick = () => {
      const ts = Date.now()
      setNow(ts)
      const st = useTimerStore.getState()

      // Countdown hit 0 → snap to the 'Hết giờ' state and notify.
      if (st.kind === 'countdown' && st.running && timerValueMs(st, ts) <= 0) {
        st.pause()
        notifyFinish()
      }

      // Show the remaining time in the tab title while a countdown runs.
      const val = timerValueMs(st, ts)
      if (st.kind === 'countdown' && st.running && val > 0) {
        if (flashTimerRef.current != null) stopFlash()
        document.title = `⏱ ${formatHMS(val)} · ${baseTitleRef.current}`
      } else if (flashTimerRef.current == null && document.title.startsWith('⏱ ')) {
        document.title = baseTitleRef.current
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  // Close on outside click / Escape (same pattern as the settings popover).
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const valueMs = now !== null ? timerValueMs(timer, now) : 0
  const countdownDone = timer.kind === 'countdown' && timer.baseMs === 0 && !timer.running
  const stopwatchRunning = timer.kind === 'stopwatch' && timer.running
  // A dot on the chip while a timer has real content (running or paused mid-way).
  // Only after mount (now !== null) so SSR and the first client render match.
  const hasLiveTimer =
    now !== null &&
    timer.kind !== null &&
    !(timer.kind === 'countdown' && timer.baseMs === 0 && !timer.running)

  const date = now !== null ? new Date(now) : null

  const toggleRun = () => {
    if (timer.kind === null) return
    if (timer.running) timer.pause()
    else timer.resume()
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setNow(Date.now())
          // Open on the tab of whatever timer is active, if any.
          setViewTab(timer.kind ?? 'stopwatch')
          setOpen((o) => !o)
        }}
        title={date ? date.toLocaleString('vi-VN') : undefined}
        aria-label={`Đồng hồ — ${date ? clockHMS(date) : '--:--'}`}
        aria-expanded={open}
        className="relative flex h-9 items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 font-mono text-[13px] tabular-nums text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 active:scale-[0.98]"
      >
        <ClockIcon size={14} className="text-zinc-500" />
        {date ? clockHMS(date) : '--:--'}
        {hasLiveTimer && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent" aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Đồng hồ và hẹn giờ"
          className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-border-subtle bg-surface-raised p-3 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Thời gian
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Đóng"
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X size={13} />
            </button>
          </div>

          {/* Mode tabs — the viewed tab is local UI; a running timer keeps running
              regardless of which tab is shown. */}
          <div className="mt-2 flex gap-1.5" role="tablist" aria-label="Loại hẹn giờ">
            {(
              [
                { key: 'stopwatch', label: 'Bấm giờ', icon: TimerIcon },
                { key: 'countdown', label: 'Đếm ngược', icon: Hourglass },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={viewTab === key}
                onClick={() => setViewTab(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors ${
                  viewTab === key
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {viewTab === 'stopwatch' ? (
            <div className="mt-3">
              <p className="text-center font-mono text-3xl tabular-nums text-zinc-100">
                {timer.kind === 'stopwatch' ? formatHMS(valueMs) : '00:00'}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={timer.startStopwatch}
                  disabled={stopwatchRunning}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={13} weight="bold" />
                  Bắt đầu
                </button>
                {timer.kind === 'stopwatch' && (
                  <>
                    <button
                      type="button"
                      onClick={toggleRun}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                    >
                      {stopwatchRunning ? (
                        <>
                          <Pause size={13} weight="bold" />
                          Tạm dừng
                        </>
                      ) : (
                        <>
                          <Play size={13} weight="bold" />
                          Tiếp tục
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={timer.reset}
                      disabled={valueMs === 0}
                      title="Đặt lại"
                      aria-label="Đặt lại đồng hồ bấm giờ"
                      className="flex h-8 w-9 items-center justify-center rounded-lg border border-border-subtle text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowCounterClockwise size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3">
              {timer.kind === 'countdown' ? (
                countdownDone ? (
                  <>
                    <p className="text-center font-mono text-3xl tabular-nums text-accent">00:00</p>
                    <p className="mt-1 text-center text-[12px] font-medium text-accent">Hết giờ!</p>
                  </>
                ) : (
                  <p className="text-center font-mono text-3xl tabular-nums text-zinc-100">
                    {formatHMS(valueMs)}
                  </p>
                )
              ) : (
                <p className="text-center font-mono text-3xl tabular-nums text-zinc-100">00:00</p>
              )}

              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {COUNTDOWN_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => timer.startCountdown(minutes)}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors active:scale-[0.98] ${
                      timer.kind === 'countdown' && timer.presetMs === minutes * 60_000
                        ? 'bg-accent text-accent-foreground'
                        : 'border border-border-subtle text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {minutes} phút
                  </button>
                ))}
              </div>

              {timer.kind === 'countdown' && !countdownDone && (
                <div className="mt-2 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={toggleRun}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    {timer.running ? (
                      <>
                        <Pause size={13} weight="bold" />
                        Tạm dừng
                      </>
                    ) : (
                      <>
                        <Play size={13} weight="bold" />
                        Tiếp tục
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={timer.cancel}
                    className="flex flex-1 items-center justify-center rounded-lg border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-300"
                  >
                    Hủy
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="mt-3 border-t border-border-subtle pt-2 text-center text-[10px] text-zinc-600">
            Hẹn giờ vẫn chạy khi đóng cửa sổ này
          </p>
        </div>
      )}
    </div>
  )
}
