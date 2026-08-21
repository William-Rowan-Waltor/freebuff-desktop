'use client'

import { useMemo, useState, useRef } from 'react'
import {
  CalendarBlank,
  NotePencil,
  FileCode,
  Files,
  Plus,
  DotsSixVertical,
} from '@phosphor-icons/react'
import { useBlocksStore } from '@/store/useBlocksStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type { Block, BlockStatus } from '@/types'

interface KanbanColumn {
  id: BlockStatus
  label: string
  color: string
}

const COLUMNS: KanbanColumn[] = [
  { id: 'draft', label: 'Nháp', color: 'text-zinc-400' },
  { id: 'pending', label: 'Đang làm', color: 'text-amber-400' },
  { id: 'approved', label: 'Duyệt', color: 'text-emerald-400' },
  { id: 'completed', label: 'Hoàn thành', color: 'text-blue-400' },
]

function blockTypeIcon(type: Block['type']) {
  switch (type) {
    case 'event': return CalendarBlank
    case 'note': return NotePencil
    case 'code': return FileCode
    default: return Files
  }
}

export default function KanbanBoard() {
  const blocks = useBlocksStore((state) => state.blocks)
  const updateBlock = useBlocksStore((state) => state.updateBlock)
  const setSelectedBlock = useWorkspaceStore((state) => state.setSelectedBlock)
  const setActiveRightPane = useWorkspaceStore((state) => state.setActiveRightPane)

  const [draggedBlock, setDraggedBlock] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<BlockStatus | null>(null)

  const blocksByStatus = useMemo(() => {
    const map: Record<BlockStatus, Block[]> = {
      draft: [],
      pending: [],
      approved: [],
      rejected: [],
      completed: [],
    }
    for (const b of blocks) {
      const status = (b.status ?? 'draft') as BlockStatus
      if (map[status]) map[status].push(b)
    }
    return map
  }, [blocks])

  const handleDragStart = (blockId: string) => {
    setDraggedBlock(blockId)
  }

  const handleDragOver = (e: React.DragEvent, columnId: BlockStatus) => {
    e.preventDefault()
    setDragOverColumn(columnId)
  }

  const handleDragLeave = () => {
    setDragOverColumn(null)
  }

  const handleDrop = (e: React.DragEvent, columnId: BlockStatus) => {
    e.preventDefault()
    if (draggedBlock) {
      updateBlock(draggedBlock, { status: columnId })
    }
    setDraggedBlock(null)
    setDragOverColumn(null)
  }

  const openBlock = (id: string) => {
    setSelectedBlock(id)
    setActiveRightPane('editor')
  }

  return (
    <div className="flex h-full gap-4 overflow-x-auto p-4">
      {COLUMNS.map((col) => {
        const colBlocks = blocksByStatus[col.id]
        const isOver = dragOverColumn === col.id
        return (
          <div
            key={col.id}
            className={`flex w-72 shrink-0 flex-col rounded-xl border transition-colors ${
              isOver
                ? 'border-accent bg-accent/5'
                : 'border-border-subtle bg-surface'
            }`}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            {/* Column header */}
            <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`text-[13px] font-semibold ${col.color}`}>
                  {col.label}
                </span>
                <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                  {colBlocks.length}
                </span>
              </div>
            </div>

            {/* Column content */}
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {colBlocks.length === 0 && (
                <p className="py-8 text-center text-[11px] text-zinc-600">
                  Kéo block vào đây
                </p>
              )}
              {colBlocks.map((block) => {
                const Icon = blockTypeIcon(block.type)
                const isDragging = draggedBlock === block.id
                return (
                  <div
                    key={block.id}
                    draggable
                    onDragStart={() => handleDragStart(block.id)}
                    onDragEnd={() => setDraggedBlock(null)}
                    onClick={() => openBlock(block.id)}
                    className={`group cursor-pointer rounded-lg border border-border-subtle bg-surface-raised p-2.5 transition-all hover:border-zinc-700 ${
                      isDragging ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <DotsSixVertical
                        size={12}
                        className="mt-0.5 shrink-0 text-zinc-600 opacity-0 group-hover:opacity-100"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Icon size={12} className="shrink-0 text-zinc-500" />
                          <span className="truncate text-[12px] font-medium text-zinc-200">
                            {block.title ?? 'Chưa có tiêu đề'}
                          </span>
                        </div>
                        {block.priority && block.priority !== 'normal' && (
                          <span className={`mt-1 inline-block text-[10px] font-medium ${
                            block.priority === 'urgent' ? 'text-red-400' :
                            block.priority === 'high' ? 'text-amber-400' :
                            'text-zinc-500'
                          }`}>
                            {block.priority === 'urgent' ? '🔴 Khẩn cấp' :
                             block.priority === 'high' ? '🟠 Cao' :
                             '⚪ Thấp'}
                          </span>
                        )}
                        {block.tags && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {block.tags.split(',').filter(Boolean).slice(0, 3).map((tag) => (
                              <span
                                key={tag.trim()}
                                className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent"
                              >
                                {tag.trim()}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
