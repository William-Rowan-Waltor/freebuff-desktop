'use client'

import type { ChainedCommands } from '@tiptap/core'
import {
  ListChecks,
  TextHOne,
  TextHTwo,
  TextHThree,
  ListBullets,
  ListNumbers,
  Quotes,
  CodeBlock,
  Minus,
} from '@phosphor-icons/react'

export interface SlashOption {
  id: string
  label: string
  icon: React.ReactElement
  insert: (chain: ChainedCommands) => ChainedCommands
}

export const SLASH_OPTIONS: SlashOption[] = [
  {
    id: 'taskList',
    label: 'Danh sách việc cần làm',
    icon: <ListChecks size={14} />,
    insert: (c) => c.toggleTaskList(),
  },
  {
    id: 'heading1',
    label: 'Tiêu đề 1',
    icon: <TextHOne size={14} />,
    insert: (c) => c.toggleHeading({ level: 1 }),
  },
  {
    id: 'heading2',
    label: 'Tiêu đề 2',
    icon: <TextHTwo size={14} />,
    insert: (c) => c.toggleHeading({ level: 2 }),
  },
  {
    id: 'heading3',
    label: 'Tiêu đề 3',
    icon: <TextHThree size={14} />,
    insert: (c) => c.toggleHeading({ level: 3 }),
  },
  {
    id: 'bulletList',
    label: 'Danh sách gạch đầu dòng',
    icon: <ListBullets size={14} />,
    insert: (c) => c.toggleBulletList(),
  },
  {
    id: 'orderedList',
    label: 'Danh sách đánh số',
    icon: <ListNumbers size={14} />,
    insert: (c) => c.toggleOrderedList(),
  },
  {
    id: 'blockquote',
    label: 'Trích dẫn',
    icon: <Quotes size={14} />,
    insert: (c) => c.toggleBlockquote(),
  },
  {
    id: 'codeBlock',
    label: 'Khối mã',
    icon: <CodeBlock size={14} />,
    insert: (c) => c.setCodeBlock(),
  },
  {
    id: 'horizontalRule',
    label: 'Đường kẻ ngang',
    icon: <Minus size={14} />,
    insert: (c) => c.setHorizontalRule().setParagraph(),
  },
]

interface SlashMenuProps {
  options: SlashOption[]
  index: number
  top: number
  left: number
  onHover: (index: number) => void
  onSelect: (index: number) => void
}

export default function SlashMenu({ options, index, top, left, onHover, onSelect }: SlashMenuProps) {
  const menuLeft = Math.max(left - 200, 8)
  return (
    <div
      className="absolute z-30 w-72 rounded-xl border border-border-subtle bg-surface-raised p-1.5 shadow-xl"
      style={{ top: top + 4, left: menuLeft }}
      role="listbox"
      aria-label="Lệnh nhanh"
    >
      <ul className="max-h-72 overflow-y-auto">
        {options.length === 0 ? (
          <li className="px-2.5 py-2 text-[12px] text-zinc-600">Không có lệnh phù hợp</li>
        ) : (
          options.map((opt, i) => (
            <li key={opt.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(i)}
                onMouseEnter={() => onHover(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                  i === index ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                    i === index ? 'bg-accent/15 text-accent' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {opt.icon}
                </span>
                <span className="text-[12px]">{opt.label}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}