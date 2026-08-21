'use client'

import { useEffect, useRef } from 'react'
import { X } from '@phosphor-icons/react'

export interface RecurrenceChoiceState {
  title: string | null
}

interface RecurrenceChoiceProps {
  state: RecurrenceChoiceState | null
  /** 'edit' (default) = "this vs all" for datetime changes; 'delete' = "this vs all" for removal. */
  variant?: 'edit' | 'delete'
  onThis: () => void
  onAll: () => void
  /** "Tất cả các lần sau lần này": split (edit) or remove-from-here (delete). */
  onThisAndFuture?: () => void
  onCancel: () => void
}

/**
 * "Chỉ sự kiện này / Tất cả các lần sau lần này / Tất cả các lần" modal shown
 * when a recurring event is dragged, resized, or datetime-edited (variant
 * 'edit'), or when deleting an occurrence of a series (variant 'delete'). The
 * this-and-future action renders when onThisAndFuture is provided (edit copy
 * "Tất cả các lần sau lần này", delete copy "Xóa tất cả các lần sau lần này").
 * Dismissed via outside click, Escape, or the close button.
 */
export default function RecurrenceChoice({
  state,
  variant = 'edit',
  onThis,
  onAll,
  onThisAndFuture,
  onCancel,
}: RecurrenceChoiceProps) {
  const ref = useRef<HTMLDivElement>(null)
  // The primary action ("Chỉ sự kiện này" / "Xóa lần này") — focused on open
  // so keyboard users land on the most likely choice.
  const primaryRef = useRef<HTMLButtonElement>(null)

  const open = state !== null

  // Focus the primary action when the modal opens and hand focus back to the
  // previously focused element when it closes. Keyed on the boolean so a parent
  // re-render while open (which may build a new state object) never yanks focus.
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    primaryRef.current?.focus()
    return () => {
      prev?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
        return
      }
      if (e.key === 'Tab') {
        // Keep Tab inside the dialog (no focus escape into the page behind it).
        const focusables = ref.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (!focusables || focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        const inside = active ? ref.current!.contains(active) : false
        if (e.shiftKey && (!inside || active === first)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (!inside || active === last)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onCancel])

  if (!state) return null

  const isDelete = variant === 'delete'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Lựa chọn lặp lại"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div
        ref={ref}
        className="w-80 rounded-xl border border-border-subtle bg-surface-raised p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13px] font-medium leading-snug text-zinc-100">
            {isDelete ? 'Xóa lần lặp lại của' : 'Thay đổi lịch lặp lại của'} “{state.title ?? 'sự kiện'}”
          </p>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Đóng"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={14} />
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          {isDelete
            ? 'Lần này là một lần lặp lại. Xóa lần này hay tất cả các lần?'
            : 'Sự kiện này lặp lại. Áp dụng thay đổi cho lần này hay tất cả các lần?'}
        </p>
        <div className="mt-3 space-y-1.5">
          <button
            ref={primaryRef}
            type="button"
            onClick={onThis}
            className="w-full rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong active:scale-[0.98]"
          >
            {isDelete ? 'Xóa lần này' : 'Chỉ sự kiện này'}
          </button>
          {!isDelete && onThisAndFuture && (
            <button
              type="button"
              onClick={onThisAndFuture}
              className="w-full rounded-lg border border-border-subtle px-3 py-2 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              Tất cả các lần sau lần này
            </button>
          )}
          {isDelete && onThisAndFuture && (
            <button
              type="button"
              onClick={onThisAndFuture}
              className="w-full rounded-lg border border-border-subtle px-3 py-2 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-rose-300"
            >
              Xóa tất cả các lần sau lần này
            </button>
          )}
          <button
            type="button"
            onClick={onAll}
            className="w-full rounded-lg border border-border-subtle px-3 py-2 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            {isDelete ? 'Xóa tất cả các lần' : 'Tất cả các lần'}
          </button>
        </div>
      </div>
    </div>
  )
}
