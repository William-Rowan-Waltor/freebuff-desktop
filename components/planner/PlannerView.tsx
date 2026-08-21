'use client'

import { useMemo, useState } from 'react'
import {
  CalendarDots,
  SunHorizon,
  Hourglass,
  Infinity,
  CalendarStar,
  CalendarBlank,
  NotePencil,
  FileCode,
  Plus,
  Trash,
} from '@phosphor-icons/react'
import { useBlocksStore } from '@/store/useBlocksStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { countTasks, type TaskCounts } from '@/lib/tasks'
import { withDefaultDuration } from '@/lib/create'
import { isRecurring } from '@/lib/recurrence'
import { expandBlockOccurrences, occurrenceBlock, excludeOccurrence } from '@/lib/expansion'
import { anchorFor, dateLabel, horizonOf, startOfDay, type Horizon } from '@/lib/horizon'
import RecurrenceChoice from '@/components/calendar/RecurrenceChoice'
import TodoChip from '@/components/planner/TodoChip'
import type { Block } from '@/types'

interface SectionMeta {
  key: Horizon
  label: string
  icon: React.ElementType
  canCreate: boolean
  tone: 'default' | 'overdue' | 'future'
}

const SECTIONS: SectionMeta[] = [
  { key: 'overdue', label: 'Quá hạn', icon: Hourglass, canCreate: false, tone: 'overdue' },
  { key: 'today', label: 'Hôm nay', icon: SunHorizon, canCreate: true, tone: 'default' },
  { key: 'week', label: 'Tuần này', icon: CalendarDots, canCreate: true, tone: 'default' },
  { key: 'month', label: 'Tháng này', icon: CalendarBlank, canCreate: true, tone: 'default' },
  { key: 'year', label: 'Năm nay', icon: CalendarStar, canCreate: true, tone: 'default' },
  { key: 'future', label: 'Tương lai', icon: Infinity, canCreate: true, tone: 'future' },
]

function blockIcon(type: Block['type']): React.ElementType {
  switch (type) {
    case 'event':
      return CalendarBlank
    case 'code':
      return FileCode
    default:
      return NotePencil
  }
}

import { textPreview } from '@/lib/textPreview'

export default function PlannerView() {
  const blocks = useBlocksStore((state) => state.blocks)
  const addBlock = useBlocksStore((state) => state.addBlock)
  const removeBlock = useBlocksStore((state) => state.removeBlock)
  const updateBlock = useBlocksStore((state) => state.updateBlock)
  const setSelectedBlock = useWorkspaceStore((state) => state.setSelectedBlock)
  const setActiveRightPane = useWorkspaceStore((state) => state.setActiveRightPane)

  // Deleting an occurrence of a recurring series must not silently kill the
  // whole series: hold the delete until "Xóa lần này / Xóa tất cả các lần".
  const [pendingDelete, setPendingDelete] = useState<{
    masterId: string
    title: string | null
    patch: Partial<Block>
  } | null>(null)

  const planItems = useMemo(() => {
    const now = new Date()
    const buckets: Record<Horizon, { block: Block; masterId: string; tasks: TaskCounts }[]> = {
      overdue: [],
      today: [],
      week: [],
      month: [],
      year: [],
      future: [],
    }
    // Recurring series are bucketed by each OCCURRENCE's own date (a weekly
    // meeting with a past dtstart belongs in the horizon of its next instance,
    // not in Quá hạn). Past occurrences are deliberately excluded — an ongoing
    // series's history is not overdue work. The window is bounded so rrule
    // never materializes unbounded future occurrences.
    const from = startOfDay(now)
    const to = new Date(now.getTime() + 2 * 366 * 24 * 60 * 60 * 1000)
    for (const b of blocks) {
      if (b.type === 'file') continue
      if (isRecurring(b)) {
        for (const occ of expandBlockOccurrences(b, from, to)) {
          const occurrence = occurrenceBlock(b, occ)
          buckets[horizonOf(occurrence, now)].push({
            block: occurrence,
            masterId: b.id,
            tasks: countTasks(b.content),
          })
        }
        continue
      }
      buckets[horizonOf(b, now)].push({ block: b, masterId: b.id, tasks: countTasks(b.content) })
    }
    for (const key of Object.keys(buckets) as Horizon[]) {
      buckets[key].sort((a, b) => {
        const ta = a.block.start_time ? new Date(a.block.start_time).getTime() : Number.MAX_SAFE_INTEGER
        const tb = b.block.start_time ? new Date(b.block.start_time).getTime() : Number.MAX_SAFE_INTEGER
        return ta - tb
      })
    }
    return buckets
  }, [blocks])

  const total = planItems.overdue.length + planItems.today.length

  const handleCreate = async (horizon: Horizon) => {
    const { type, start_time } = anchorFor(horizon, new Date())
    const block = await addBlock({
      type,
      title: type === 'note' ? 'Kế hoạch mới' : 'Sự kiện mới',
      content: { type: 'doc', content: [] },
      start_time,
      // Timed events get the user's configured default duration as end time.
      ...(type === 'event' && start_time ? { end_time: withDefaultDuration(start_time) } : {}),
    })
    setSelectedBlock(block.id)
    setActiveRightPane('editor')
  }

  // Delete entry point. A recurring OCCURRENCE row (block.id !== masterId) is
  // held behind the this-vs-all choice (exception vs whole-series delete); plain
  // blocks are removed directly as before.
  const handleDelete = (
    e: React.MouseEvent,
    item: { block: Block; masterId: string; tasks: TaskCounts },
  ) => {
    e.stopPropagation()
    if (item.block.id !== item.masterId) {
      const master = blocks.find((b) => b.id === item.masterId)
      if (!master) return
      const occurrenceStart = item.block.start_time
      if (!occurrenceStart) return
      const patch = excludeOccurrence(master, occurrenceStart)
      if (Object.keys(patch).length === 0) return
      setPendingDelete({ masterId: item.masterId, title: item.block.title, patch })
      return
    }
    void removeBlock(item.masterId)
  }

  const confirmDeleteThis = () => {
    if (!pendingDelete) return
    void updateBlock(pendingDelete.masterId, pendingDelete.patch)
    setPendingDelete(null)
  }

  const confirmDeleteAll = () => {
    if (!pendingDelete) return
    void removeBlock(pendingDelete.masterId)
    setPendingDelete(null)
  }

  if (blocks.filter((b) => b.type !== 'file').length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface">
          <CalendarDots size={26} className="text-zinc-600" />
        </div>
        <p className="text-[15px] font-medium text-zinc-300">Chưa có mục nào để lên kế hoạch</p>
        <p className="max-w-[40ch] text-[13px] leading-relaxed text-zinc-500">
          Bấm “Tạo mới” ở góc trên bên phải, hoặc dấu “+” trong từng mục thời gian để lên kế hoạch cho
          ngày, tuần, tháng, năm và tương lai của bạn.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <RecurrenceChoice
        state={pendingDelete ? { title: pendingDelete.title } : null}
        variant="delete"
        onThis={confirmDeleteThis}
        onAll={confirmDeleteAll}
        onCancel={() => setPendingDelete(null)}
      />
      {total > 0 && (
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">
          {total} mục cần xử lý hôm nay
        </p>
      )}

      <div className="space-y-4">
        {SECTIONS.map(({ key, label, icon: Icon, canCreate, tone }) => {
          const items = planItems[key]
          return (
            <section
              key={key}
              className={`rounded-xl border bg-surface ${
                tone === 'overdue'
                  ? 'border-red-900/50'
                  : tone === 'future'
                    ? 'border-border-subtle'
                    : 'border-border-subtle'
              }`}
            >
              <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
                <Icon
                  size={15}
                  className={tone === 'overdue' ? 'text-red-400' : tone === 'future' ? 'text-zinc-500' : 'text-accent'}
                />
                <h2 className="text-[13px] font-semibold text-zinc-200">{label}</h2>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                  {items.length}
                </span>
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => handleCreate(key)}
                    aria-label={`Thêm mục vào ${label.toLowerCase()}`}
                    title={`Thêm mục vào ${label.toLowerCase()}`}
                    className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <Plus size={14} weight="bold" />
                  </button>
                )}
              </header>
              {items.length === 0 ? (
                <p className="px-4 py-3 text-[12px] text-zinc-600">
                  Chưa có mục — bấm “+” để thêm.
                </p>
              ) : (
                <ul className="p-2">
                  {items.map(({ block, masterId, tasks }) => (
                    <li key={block.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedBlock(masterId)
                          setActiveRightPane('editor')
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedBlock(masterId)
                            setActiveRightPane('editor')
                          }
                        }}
                        className="group flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-zinc-800/60"
                      >
                        {(() => {
                          const Icon = blockIcon(block.type)
                          return (
                            <Icon
                              size={15}
                              weight="fill"
                              className={`mt-0.5 shrink-0 ${
                                tone === 'overdue' ? 'text-red-400/80' : 'text-accent/80'
                              }`}
                            />
                          )
                        })()}
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate text-[13px] font-medium text-zinc-100">
                              {block.title ?? 'Chưa có tiêu đề'}
                            </p>
                            {tasks.total > 0 && <TodoChip done={tasks.done} total={tasks.total} />}
                          </div>
                          <p className="truncate text-[12px] text-zinc-500">{textPreview(block.content)}</p>
                          <p
                            className={`mt-0.5 font-mono text-[11px] ${
                              tone === 'overdue' ? 'text-red-400/80' : 'text-zinc-500'
                            }`}
                          >
                            {dateLabel(block)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(e, { block, masterId, tasks })}
                          aria-label={`Xóa ${block.title ?? 'mục'}`}
                          title="Xóa"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 opacity-30 transition-all hover:bg-zinc-800 hover:text-red-400 group-hover:opacity-100 touch-manipulation"
                        >
                          <Trash size={13} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
