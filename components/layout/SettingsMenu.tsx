'use client'

import { useEffect, useRef, useState } from 'react'
import {
  GearSix,
  Clock,
  BellRinging,
  Play,
  Alarm,
  MarkdownLogo,
  CaretDown,
  SignOut,
  ListBullets,
} from '@phosphor-icons/react'
import { useSettingsStore, DEFAULT_EVENT_DURATIONS, DEFAULT_EVENT_DURATION } from '@/store/useSettingsStore'
import { CHIMES, playChime, CUSTOM_CHIME_MIN, CUSTOM_CHIME_MAX } from '@/lib/chime'
import { mdToHtml, sanitizeHtml } from '@/lib/markdown'
import { MARKDOWN_ITEMS } from '@/lib/markdown-shortcuts'
import { getAuditLog, type AuditEntry } from '@/lib/audit'
import { getRecentActivity, type HistoryEntry } from '@/lib/db/block-history'
import { supabase } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

// Threshold presets for event reminders, in minutes. Day/week presets make the
// pipeline useful for all-day deadlines ("nộp thuế ngày 20"); 10 is the default.
const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 5, label: '5 phút' },
  { minutes: 10, label: '10 phút' },
  { minutes: 15, label: '15 phút' },
  { minutes: 30, label: '30 phút' },
  { minutes: 60, label: '1 giờ' },
  { minutes: 1440, label: '1 ngày' },
  { minutes: 10080, label: '1 tuần' },
]

const AUDIT_ACTION_LABELS: Record<AuditEntry['action'], string> = {
  create: 'Tạo',
  update: 'Sửa',
  delete: 'Xóa',
  restore: 'Khôi phục',
  purge: 'Xóa vĩnh viễn',
}

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

const ACTION_LABELS: Record<string, string> = {
  create: 'Tạo mới',
  update: 'Cập nhật',
  delete: 'Xóa',
  restore: 'Khôi phục',
  purge: 'Xóa vĩnh viễn',
}

function ServerHistorySection() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    if (!open) {
      setLoading(true)
      const data = await getRecentActivity(50)
      setEntries(data)
      setLoading(false)
    }
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-[13px] font-medium text-zinc-200"
      >
        <ListBullets size={14} className="shrink-0 text-accent" />
        Lịch sử trên máy chủ
        <CaretDown
          size={12}
          weight="bold"
          className={`ml-auto shrink-0 text-zinc-500 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Lịch sử thay đổi được lưu trên Supabase ({entries.length} mục gần nhất). Đòi hỏi migration
            block_history.
          </p>
          {loading ? (
            <p className="mt-2 text-[11px] text-zinc-500">Đang tải...</p>
          ) : (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
              {entries.length === 0 ? (
                <p className="rounded-lg border border-border-subtle bg-background px-2 py-2 text-[11px] text-zinc-500">
                  Chưa có lịch sử. Chạy migration block_history để bắt đầu ghi.
                </p>
              ) : (
                entries.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-lg border border-border-subtle bg-background px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-zinc-300">
                        {ACTION_LABELS[e.action] ?? e.action}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        {new Date(e.created_at).toLocaleString('vi-VN')}
                      </span>
                    </div>
                    {e.new_data?.title && (
                      <p className="truncate text-[11px] text-zinc-400">{e.new_data.title}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}

export default function SettingsMenu() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [markdownOpen, setMarkdownOpen] = useState(true)
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
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

  const handleSignOut = async () => {
    setOpen(false)
    try {
      await supabase.auth.signOut()
    } finally {
      router.replace('/login')
    }
  }

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
              <p className="mt-0.5 text-[11px] text-zinc-500">
                Sự kiện cả ngày được nhắc lúc 09:00 sáng ngày diễn ra.
              </p>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Thời gian nhắc trước sự kiện">
                {REMINDER_PRESETS.map(({ minutes, label }) => {
                  const active = minutes === reminderMinutes
                  return (
                    <button
                      key={minutes}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setReminderMinutes(minutes)}
                      title={minutes === 10 ? `${label} (mặc định)` : label}
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
          {/* Activity log (client-side): the audit module records every block
              mutation on THIS device — better than nothing for "ai làm gì lúc
              nào", but it is not a server-side trail yet (Phase 2/3). */}
          <div className="my-3 border-t border-border-subtle" />
          <button
            type="button"
            onClick={() => {
              if (!auditOpen) setAuditEntries([...getAuditLog()].reverse())
              setAuditOpen((o) => !o)
            }}
            aria-expanded={auditOpen}
            aria-label="Bật/ tắt nhật ký hoạt động"
            className="flex w-full items-center gap-1.5 text-[13px] font-medium text-zinc-200"
          >
            <ListBullets size={14} className="shrink-0 text-accent" />
            Nhật ký hoạt động
            <CaretDown
              size={12}
              weight="bold"
              className={`ml-auto shrink-0 text-zinc-500 transition-transform ${auditOpen ? '' : '-rotate-90'}`}
            />
          </button>
          {auditOpen && (
            <>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                Lịch sử thay đổi block trên máy này ({auditEntries.length}/500 mục gần nhất). Chưa đồng
                bộ máy chủ — đây không phải audit trail đầy đủ.
              </p>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                {auditEntries.length === 0 ? (
                  <p className="rounded-lg border border-border-subtle bg-background px-2 py-2 text-[11px] text-zinc-500">
                    Chưa có hoạt động nào được ghi.
                  </p>
                ) : (
                  auditEntries.map((entry, i) => (
                    <div
                      key={`${entry.timestamp}-${entry.blockId}-${i}`}
                      className="rounded-lg border border-border-subtle bg-background px-2 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-zinc-300">
                          {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {new Date(entry.timestamp).toLocaleString('vi-VI')}
                        </span>
                      </div>
                      {entry.blockTitle && (
                        <p className="truncate text-[11px] text-zinc-400">{entry.blockTitle}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* Server-side history (block_history table) */}
          <div className="my-1 border-t border-border-subtle pt-1" />
          <ServerHistorySection />

          {/* Sign out */}
          <div className="my-3 border-t border-border-subtle" />
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1.5 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-red-400"
          >
            <SignOut size={14} className="shrink-0" />
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  )
}
