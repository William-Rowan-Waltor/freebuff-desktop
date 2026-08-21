'use client'

import { useEffect, useRef, useState } from 'react'
import { Palette, Check } from '@phosphor-icons/react'

export const ACCENT_PRESETS = [
  { hex: '#34d399', name: 'Xanh lục (mặc định)' },
  { hex: '#3b82f6', name: 'Xanh dương' },
  { hex: '#8b5cf6', name: 'Tím' },
  { hex: '#f43f5e', name: 'Hồng' },
  { hex: '#f59e0b', name: 'Hổ phách' },
  { hex: '#06b6d4', name: 'Cyan' },
]

interface AccentPickerProps {
  accent: string
  onChange: (hex: string) => void
}

export default function AccentPicker({ accent, onChange }: AccentPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

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
        title="Chọn màu chủ đạo"
        aria-label={`Chọn màu chủ đạo (hiện tại ${accent})`}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
      >
        <span
          className="h-4 w-4 rounded-full border border-black/20"
          style={{ backgroundColor: accent }}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-52 rounded-xl border border-border-subtle bg-surface-raised p-2 shadow-xl">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            Màu chủ đạo
          </p>
          <div className="flex items-center gap-1.5">
            {ACCENT_PRESETS.map((preset) => {
              const active = preset.hex.toLowerCase() === accent.toLowerCase()
              return (
                <button
                  key={preset.hex}
                  type="button"
                  onClick={() => onChange(preset.hex)}
                  title={preset.name}
                  aria-label={preset.name}
                  aria-pressed={active}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95 ${
                    active ? 'ring-2 ring-zinc-200 ring-offset-2 ring-offset-surface-raised' : ''
                  }`}
                  style={{ backgroundColor: preset.hex }}
                >
                  {active && <Check size={12} weight="bold" className="text-zinc-900" />}
                </button>
              )
            })}
          </div>
          <label className="mt-2 flex items-center gap-2 rounded-lg border border-border-subtle bg-background px-2 py-1.5">
            <Palette size={13} className="shrink-0 text-zinc-500" />
            <input
              type="color"
              value={accent}
              onChange={(e) => onChange(e.target.value)}
              aria-label="Chọn màu tùy chỉnh"
              className="h-5 w-9 cursor-pointer rounded border border-border-subtle bg-transparent"
            />
            <span className="font-mono text-[11px] text-zinc-400">{accent.toUpperCase()}</span>
          </label>
        </div>
      )}
    </div>
  )
}