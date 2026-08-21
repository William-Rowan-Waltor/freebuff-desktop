'use client'

import { useEffect, useState } from 'react'
import { X, Keyboard } from '@phosphor-icons/react'

interface ShortcutGroup {
  title: string
  shortcuts: { keys: string; description: string }[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Điều hướng',
    shortcuts: [
      { keys: 'Ctrl + N', description: 'Tạo block mới' },
      { keys: 'Ctrl + /', description: 'Mở/đóng phím tắt' },
      { keys: 'Escape', description: 'Đóng popup / pane' },
      { keys: 'Ctrl + Z', description: 'Hoàn tác' },
      { keys: 'Ctrl + Shift + Z', description: 'Làm lại' },
    ],
  },
  {
    title: 'Chỉnh sửa',
    shortcuts: [
      { keys: 'Ctrl + B', description: 'In đậm' },
      { keys: 'Ctrl + I', description: 'In nghiêng' },
      { keys: 'Ctrl + U', description: 'Gạch chân' },
      { keys: 'Ctrl + H', description: 'Highlight' },
      { keys: 'Ctrl + Shift + X', description: 'Gạch ngang' },
    ],
  },
  {
    title: 'Heading',
    shortcuts: [
      { keys: 'Ctrl + Alt + 1', description: 'Heading 1' },
      { keys: 'Ctrl + Alt + 2', description: 'Heading 2' },
      { keys: 'Ctrl + Alt + 3', description: 'Heading 3' },
    ],
  },
  {
    title: 'Danh sách',
    shortcuts: [
      { keys: 'Ctrl + Shift + 8', description: 'Danh sách gạch đầu dòng' },
      { keys: 'Ctrl + Shift + 9', description: 'Danh sách đánh số' },
      { keys: 'Ctrl + Shift + 7', description: 'Task list (checkbox)' },
    ],
  },
  {
    title: 'Block',
    shortcuts: [
      { keys: 'Ctrl + Alt + C', description: 'Code block' },
      { keys: 'Ctrl + Alt + Q', description: 'Blockquote' },
      { keys: '/', description: 'Slash menu (trong editor)' },
    ],
  },
  {
    title: 'Thẻ',
    shortcuts: [
      { keys: '#tag', description: 'Gõ # để tạo tag (trong editor)' },
    ],
  },
]

export default function ShortcutGuide() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.key.toLowerCase() !== '/') return
      // Only trigger if not inside an editor (editor has its own handler)
      const target = e.target as HTMLElement
      if (target.closest('.tiptap') || target.closest('[role="dialog"]')) return
      e.preventDefault()
      setOpen((o) => !o)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Phím tắt"
        className="w-full max-w-lg rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-2xl"
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-zinc-100">Phím tắt</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Đóng"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={15} />
          </button>
        </div>
        <p className="mt-1 text-[12px] text-zinc-500">
          Nhấn <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px]">Ctrl + /</kbd> để mở/đóng bảng này.
        </p>
        <div className="mt-3 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between">
                    <span className="text-[12px] text-zinc-300">{s.description}</span>
                    <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
