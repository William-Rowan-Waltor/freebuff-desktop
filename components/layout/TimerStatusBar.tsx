'use client'

import { useEffect, useState } from 'react'
import { Hourglass, Timer, Pause, Play, X } from '@phosphor-icons/react'
import { useTimerStore, timerValueMs } from '@/store/useTimerStore'
import { formatHMS } from '@/lib/time'

export default function TimerStatusBar() {
  const timer = useTimerStore()
  const [now, setNow] = useState<number | null>(null)

  // Live tick so the remaining/elapsed time keeps updating in the bar.
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  // Only appear while a timer has real content (running or paused mid-way) —
  // same condition as the clock chip's indicator dot.
  const active =
    now !== null &&
    timer.kind !== null &&
    !(timer.kind === 'countdown' && timer.baseMs === 0 && !timer.running)

  if (!active) return null

  const isCountdown = timer.kind === 'countdown'
  const Icon = isCountdown ? Hourglass : Timer
  const valueMs = now !== null ? timerValueMs(timer, now) : 0

  const toggleRun = () => {
    if (timer.kind === null) return
    if (timer.running) timer.pause()
    else timer.resume()
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface px-3">
      <Icon size={13} className="shrink-0 text-accent" />
      <span className="text-[11px] font-medium text-zinc-400">
        {isCountdown ? 'Đếm ngược' : 'Bấm giờ'}
      </span>
      <span className="font-mono text-[12px] tabular-nums text-zinc-100">{formatHMS(valueMs)}</span>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={toggleRun}
          aria-label={timer.running ? 'Tạm dừng' : 'Tiếp tục'}
          title={timer.running ? 'Tạm dừng' : 'Tiếp tục'}
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          {timer.running ? <Pause size={13} weight="bold" /> : <Play size={13} weight="bold" />}
        </button>
        <button
          type="button"
          onClick={timer.reset}
          aria-label="Dừng và xóa hẹn giờ"
          title="Dừng và xóa hẹn giờ"
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-300"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
