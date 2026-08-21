'use client'

import { useMemo, useRef, useState } from 'react'
import {
  CalendarBlank,
  NotePencil,
  FileCode,
  Files,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react'
import { useBlocksStore } from '@/store/useBlocksStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type { Block } from '@/types'

type TimeScale = 'day' | 'week' | 'month'

interface TimelineBlock {
  block: Block
  start: Date
  end: Date
  color: string
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-amber-500',
  normal: 'bg-accent',
  low: 'bg-zinc-600',
}

function blockTypeIcon(type: Block['type']) {
  switch (type) {
    case 'event': return CalendarBlank
    case 'note': return NotePencil
    case 'code': return FileCode
    default: return Files
  }
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function formatDate(d: Date): string {
  const day = d.getDate()
  const month = d.getMonth() + 1
  return `${day}/${month}`
}

export default function GanttChart() {
  const blocks = useBlocksStore((state) => state.blocks)
  const setSelectedBlock = useWorkspaceStore((state) => state.setSelectedBlock)
  const setActiveRightPane = useWorkspaceStore((state) => state.setActiveRightPane)

  const [timeScale, setTimeScale] = useState<TimeScale>('week')
  const [startDate, setStartDate] = useState(() => {
    const now = new Date()
    // Start from beginning of current week (Monday)
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    return new Date(now.getFullYear(), now.getMonth(), diff)
  })

  const scrollRef = useRef<HTMLDivElement>(null)

  // Generate timeline blocks from blocks with start_time
  const timelineBlocks = useMemo((): TimelineBlock[] => {
    return blocks
      .filter((b) => b.start_time)
      .map((b) => {
        const start = new Date(b.start_time!)
        const end = b.end_time ? new Date(b.end_time) : new Date(start.getTime() + 24 * 60 * 60 * 1000)
        const priority = (b.priority ?? 'normal') as string
        return {
          block: b,
          start,
          end,
          color: PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.normal,
        }
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [blocks])

  // Generate timeline columns
  const timelineColumns = useMemo(() => {
    const columns: { date: Date; label: string; isToday: boolean }[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (timeScale === 'day') {
      // Show 14 days
      for (let i = 0; i < 14; i++) {
        const d = new Date(startDate)
        d.setDate(d.getDate() + i)
        const isToday = d.getTime() === today.getTime()
        columns.push({
          date: d,
          label: `${d.getDate()}/${d.getMonth() + 1}`,
          isToday,
        })
      }
    } else if (timeScale === 'week') {
      // Show 4 weeks
      for (let i = 0; i < 4; i++) {
        const d = new Date(startDate)
        d.setDate(d.getDate() + i * 7)
        const weekEnd = new Date(d)
        weekEnd.setDate(weekEnd.getDate() + 6)
        const isToday = today >= d && today <= weekEnd
        columns.push({
          date: d,
          label: `Tuần ${formatDate(d)} - ${formatDate(weekEnd)}`,
          isToday,
        })
      }
    } else {
      // Show 3 months
      for (let i = 0; i < 3; i++) {
        const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
        const isToday = today.getMonth() === d.getMonth() && today.getFullYear() === d.getFullYear()
        columns.push({
          date: d,
          label: `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`,
          isToday,
        })
      }
    }
    return columns
  }, [startDate, timeScale])

  // Calculate position and width for each block
  const blockPositions = useMemo(() => {
    const totalDays = timeScale === 'day' ? 14 : timeScale === 'week' ? 28 : 90
    const startMs = startDate.getTime()
    const dayMs = 24 * 60 * 60 * 1000

    return timelineBlocks.map((tb) => {
      const startOffset = Math.max(0, (tb.start.getTime() - startMs) / dayMs)
      const endOffset = Math.min(totalDays, (tb.end.getTime() - startMs) / dayMs)
      const width = Math.max(1, endOffset - startOffset)
      const left = (startOffset / totalDays) * 100
      const widthPct = (width / totalDays) * 100
      return { ...tb, left, widthPct }
    })
  }, [timelineBlocks, startDate, timeScale])

  const navigate = (direction: -1 | 1) => {
    const d = new Date(startDate)
    if (timeScale === 'day') d.setDate(d.getDate() + direction * 7)
    else if (timeScale === 'week') d.setDate(d.getDate() + direction * 28)
    else d.setMonth(d.getMonth() + direction * 3)
    setStartDate(d)
  }

  const openBlock = (id: string) => {
    setSelectedBlock(id)
    setActiveRightPane('editor')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <CaretLeft size={16} />
          </button>
          <span className="text-[13px] font-medium text-zinc-200">
            {startDate.toLocaleDateString('vi-VI', { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            onClick={() => navigate(1)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <CaretRight size={16} />
          </button>
        </div>
        <div className="flex gap-1">
          {(['day', 'week', 'month'] as TimeScale[]).map((scale) => (
            <button
              key={scale}
              type="button"
              onClick={() => setTimeScale(scale)}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                timeScale === scale
                  ? 'bg-accent text-accent-foreground'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {scale === 'day' ? 'Ngày' : scale === 'week' ? 'Tuần' : 'Tháng'}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto" ref={scrollRef}>
        <div className="min-w-[800px]">
          {/* Header */}
          <div className="flex border-b border-border-subtle">
            <div className="w-48 shrink-0 border-r border-border-subtle px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                Block
              </span>
            </div>
            <div className="flex flex-1">
              {timelineColumns.map((col) => (
                <div
                  key={col.date.toISOString()}
                  className={`flex-1 border-r border-border-subtle px-2 py-2 text-center ${
                    col.isToday ? 'bg-accent/10' : ''
                  }`}
                >
                  <span className={`text-[11px] ${col.isToday ? 'font-semibold text-accent' : 'text-zinc-400'}`}>
                    {col.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          {blockPositions.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-[12px] text-zinc-500">Không có block nào có thời gian</p>
            </div>
          ) : (
            blockPositions.map((bp) => {
              const Icon = blockTypeIcon(bp.block.type)
              return (
                <div
                  key={bp.block.id}
                  className="flex border-b border-border-subtle hover:bg-zinc-800/30"
                >
                  {/* Block info */}
                  <div
                    className="flex w-48 shrink-0 cursor-pointer items-center gap-2 border-r border-border-subtle px-3 py-2"
                    onClick={() => openBlock(bp.block.id)}
                  >
                    <Icon size={12} className="shrink-0 text-zinc-500" />
                    <span className="truncate text-[12px] text-zinc-200">
                      {bp.block.title ?? 'Chưa có tiêu đề'}
                    </span>
                  </div>
                  {/* Bar */}
                  <div className="relative flex-1 py-2">
                    <div
                      className={`absolute top-2 h-5 rounded-sm ${bp.color} cursor-pointer opacity-80 hover:opacity-100`}
                      style={{ left: `${bp.left}%`, width: `${bp.widthPct}%`, minWidth: '4px' }}
                      onClick={() => openBlock(bp.block.id)}
                      title={`${bp.block.title}\n${bp.start.toLocaleDateString('vi-VI')} → ${bp.end.toLocaleDateString('vi-VI')}`}
                    >
                      <span className="absolute left-1 top-0.5 truncate text-[9px] font-medium text-white/90">
                        {bp.block.title}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
