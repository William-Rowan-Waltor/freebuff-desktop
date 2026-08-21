'use client'

import { useEffect, useRef, useState } from 'react'
import { GearSix, Clock, BellRinging, Play, Alarm, MarkdownLogo, CaretDown } from '@phosphor-icons/react'
import { useSettingsStore, DEFAULT_EVENT_DURATIONS, DEFAULT_EVENT_DURATION } from '@/store/useSettingsStore'
import { CHIMES, playChime, CUSTOM_CHIME_MIN, CUSTOM_CHIME_MAX } from '@/lib/chime'
import { mdToHtml, sanitizeHtml } from '@/lib/markdown'
import { MARKDOWN_ITEMS } from '@/lib/markdown-shortcuts'

// Threshold presets (minutes) for event reminders; 10 is the app default.
const REMINDER_PRESETS = [5, 10, 15, 30] as const

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-[18px] w-8 shrink-0 items-center rounded-full px-0.5 transition-colors ${
        checked ? 'justify-end bg-accent' : 'justify-start bg-zinc-700'
      }`}
    >
      <span className="h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform" />
    </button>
  )
}

export default function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const [markdownOpen, setMarkdownOpen] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const duration = useSettingsStore((state) => state.defaultEventDuration)
  const setDuration = useSettingsStore((state) => state.setDefaultEventDuration)
  const notifyBeep = useSettingsStore((state) => state.notifyBeep)
  const setNotifyBeep = useSettingsStore((state) => state.setNotifyBeep)
  const notifyFlash = useSettingsStore((state) => state.notifyFlash)
  const setNotifyFlash = useSettingsStore((state) => state.setNotifyFlash)
  const chime = useSettingsStore((state) => state.chime)
  const setChime = useSettingsStore((state) => state.setChime)
  const customChimeFreq = useSettingsStore((state) => state.customChimeFreq)
  const setCustomChimeFreq = useSettingsStore((state) => state.setCustomChimeFreq)
  const remindersEnabled = useSettingsStore((state) => state.remindersEnabled)
  const setRemindersEnabled = useSettingsStore((state) => state.setRemindersEnabled)
  const reminderMinutes = useSettingsStore((state) => state.reminderMinutes)
  const setReminderMinutes = useSettingsStore((state) => state.setReminderMinutes)

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Cài đặt"
        aria-label="Mở cài đặt"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 active:scale-[0.98]"
      >
        <GearSix size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-border-subtle bg-surface-raised p-3 shadow-2xl">
          <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Cài đặt</p>

          {/* Default event duration */}
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-200">
            <Clock size={14} className="shrink-0 text-accent" />
            Thời lượng sự kiện mặc định
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Áp dụng cho sự kiện mới tạo nhanh trên lịch và kế hoạch (nếu chưa đặt giờ kết thúc).
          </p>
          <div className="mt-2.5 flex gap-1.5" role="radiogroup" aria-label="Thời lượng sự kiện mặc định">
            {DEFAULT_EVENT_DURATIONS.map((minutes) => {
              const active = minutes === duration
              return (
                <button
                  key={minutes}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setDuration(minutes)}
                  title={minutes === DEFAULT_EVENT_DURATION ? `${minutes} phút (mặc định)` : `${minutes} phút`}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors ${
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'border border-border-subtle text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {minutes} phút
                </button>
              )
            })}
          </div>

          {/* Timer notifications */}
          <div className="my-3 border-t border-border-subtle" />
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-200">
            <BellRinging size={14} className="shrink-0 text-accent" />
            Thông báo hẹn giờ
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Khi bộ đếm ngược kết thúc.
          </p>

          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-zinc-300">Tiếng bíp</span>
              <Switch checked={notifyBeep} onChange={setNotifyBeep} label="Bật/ tắt tiếng bíp khi hết giờ" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-zinc-300">Nhấp nháy tiêu đề tab</span>
              <Switch
                checked={notifyFlash}
                onChange={setNotifyFlash}
                label="Bật/ tắt nhấp nháy tiêu đề tab khi hết giờ"
              />
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-zinc-300">Âm báo</span>
              <button
                type="button"
                onClick={() => playChime(chime, customChimeFreq)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-zinc-800"
              >
                <Play size={11} weight="bold" />
                Nghe thử
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Chọn âm báo">
              {CHIMES.map(({ id, label }) => {
                const active = chime === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setChime(id)}
                    className={`rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors ${
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'border border-border-subtle text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {chime === 'custom' && (
              <div className="mt-2">
                <label className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Tần số tùy chỉnh</span>
                  <span className="font-mono text-zinc-300">{customChimeFreq} Hz</span>
                </label>
                <input
                  type="range"
                  min={CUSTOM_CHIME_MIN}
                  max={CUSTOM_CHIME_MAX}
                  step={10}
                  value={customChimeFreq}
                  onChange={(e) => setCustomChimeFreq(Number(e.target.value))}
                  aria-label="Tần số âm báo tùy chỉnh (Hz)"
                  className="mt-1 w-full accent-emerald-500"
                />
              </div>
            )}
          </div>

          {/* Event reminders */}
          <div className="my-3 border-t border-border-subtle" />
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-200">
            <Alarm size={14} className="shrink-0 text-accent" />
            Nhắc sự kiện
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Nhắc trước khi sự kiện sắp diễn ra.
          </p>

          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-zinc-300">Bật nhắc</span>
              <Switch
                checked={remindersEnabled}
                onChange={setRemindersEnabled}
                label="Bật/ tắt nhắc sự kiện"
              />
            </div>
          </div>

          {remindersEnabled && (
            <div className="mt-2.5">
              <p className="text-[11px] text-zinc-400">Nhắc trước</p>
              <div className="mt-1.5 flex gap-1.5" role="radiogroup" aria-label="Thời gian nhắc trước sự kiện">
                {REMINDER_PRESETS.map((minutes) => {
                  const active = minutes === reminderMinutes
                  return (
                    <button
                      key={minutes}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setReminderMinutes(minutes)}
                      title={minutes === 10 ? `${minutes} phút (mặc định)` : `${minutes} phút`}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors ${
                        active
                          ? 'bg-accent text-accent-foreground'
                          : 'border border-border-subtle text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      {minutes} phút
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Markdown quick reference: how to create each markdown component
              with ordinary syntax or a keyboard shortcut — collapsible, with a
              live preview of every component. */}
          <div className="my-3 border-t border-border-subtle" />
          <button
            type="button"
            onClick={() => setMarkdownOpen((o) => !o)}
            aria-expanded={markdownOpen}
            aria-label="Bật/ tắt hướng dẫn Markdown"
            className="flex w-full items-center gap-1.5 text-[13px] font-medium text-zinc-200"
          >
            <MarkdownLogo size={14} className="shrink-0 text-accent" />
            Markdown & phím tắt
            <CaretDown
              size={12}
              weight="bold"
              className={`ml-auto shrink-0 text-zinc-500 transition-transform ${markdownOpen ? '' : '-rotate-90'}`}
            />
          </button>
          {markdownOpen && (
            <>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                Tạo thành phần Markdown trong trình soạn thảo bằng cú pháp thường hoặc phím tắt trên
                bàn phím:
              </p>
              <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {MARKDOWN_ITEMS.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-border-subtle bg-background p-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-[12px] text-zinc-300">{item.label}</span>
                      <span className="flex flex-wrap items-center justify-end gap-1">
                        {item.syntax && (
                          <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-accent">
                            {item.syntax}
                          </code>
                        )}
                        {item.shortcut && (
                          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
                            {item.shortcut}
                          </kbd>
                        )}
                      </span>
                    </div>
                    {item.syntax && (
                      <div
                        className="mt-1.5 rounded-md border border-border-subtle px-2 py-1.5 text-[12px] leading-relaxed text-zinc-300 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-zinc-400 [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-accent [&_em]:text-zinc-200 [&_h1]:text-[13px] [&_h1]:font-bold [&_h1]:text-zinc-100 [&_hr]:my-1 [&_hr]:border-zinc-700 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:m-0 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-zinc-800 [&_pre]:p-1.5 [&_pre]:font-mono [&_pre]:text-[11px] [&_pre]:text-zinc-300 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_s]:text-zinc-500 [&_strong]:font-semibold [&_strong]:text-zinc-100 [&_ul]:list-disc [&_ul]:pl-4"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(mdToHtml(item.preview ?? item.syntax)) }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
