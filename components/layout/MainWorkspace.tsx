'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { gsap } from 'gsap'
import Image from 'next/image'
import {
  CalendarBlank,
  CalendarDots,
  NotePencil,
  Files,
  FileCode,
  X,
  Plus,
  SidebarSimple,
  SunHorizon,
  UploadSimple,
  MagnifyingGlass,
  CaretDown,
  Code,
  Export,
  CloudArrowDown,
  Trash,
  ArrowClockwise,
  CircleNotch,
  TrayArrowDown,
  DownloadSimple,
  UsersThree,
  Copy,
  Check,
} from '@phosphor-icons/react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useBlocksStore } from '@/store/useBlocksStore'
import ThemeToggle from '@/components/layout/ThemeToggle'
import SettingsMenu from '@/components/layout/SettingsMenu'
import Clock from '@/components/layout/Clock'
import TimerStatusBar from '@/components/layout/TimerStatusBar'
import EditorPane from '@/components/editor/EditorPane'
import PlannerView from '@/components/planner/PlannerView'
import TodayView from '@/components/today/TodayView'
import TodoChip from '@/components/planner/TodoChip'
import { countTasks } from '@/lib/tasks'
import { appendNote } from '@/lib/notes'
import { useCreateBlock, type CreateKind } from '@/lib/create'
import { textPreview } from '@/lib/textPreview'
import { useEventReminders } from '@/lib/reminders'
import { useOverride, splitSeries } from '@/lib/override'
import { excludeOccurrence, splitSeriesAt } from '@/lib/expansion'
import { shiftExceptions } from '@/lib/rebaseExceptions'
import { buildWorkspaceIcs, downloadIcs } from '@/lib/ics'
import { importIcs, previewIcs, type IcsPreview, type IcsEventRole } from '@/lib/ics-import'
import { fileExists } from '@/lib/db/storage'
import {
  loadIcsHistory,
  saveIcsHistoryServer,
  loadIcsHistoryServer,
  newIcsImportRecord,
  type IcsImportRecord,
} from '@/lib/ics-history'
import type { DeletedBlock } from '@/lib/db/blocks'
import type { Block, BlockType } from '@/types'
import type { PurgeHistoryEntry } from '@/store/useBlocksStore'

type Tab = 'today' | 'calendar' | 'planner' | 'notes' | 'files' | 'imported' | 'trash'

const CodeEditor = dynamic(() => import('@/components/editor/CodeEditor'), { ssr: false })
const CalendarView = dynamic(() => import('@/components/calendar/CalendarView'), { ssr: false })

const TAB_META: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'today', label: 'Hôm nay', icon: SunHorizon },
  { key: 'calendar', label: 'Lịch', icon: CalendarBlank },
  { key: 'planner', label: 'Kế hoạch', icon: CalendarDots },
  { key: 'notes', label: 'Ghi chú', icon: NotePencil },
  { key: 'files', label: 'Tệp', icon: Files },
  { key: 'imported', label: 'Đã nhập', icon: TrayArrowDown },
  { key: 'trash', label: 'Thùng rác', icon: Trash },
]

const CREATE_META: { key: CreateKind; label: string; icon: React.ElementType }[] = [
  { key: 'note', label: 'Ghi chú', icon: NotePencil },
  { key: 'event', label: 'Sự kiện', icon: CalendarBlank },
  { key: 'code', label: 'Mã nguồn', icon: Code },
  { key: 'file', label: 'Tệp', icon: Files },
]

const DEFAULT_PANE_WIDTH = 520
const MIN_PANE_WIDTH = 320
const MAX_PANE_WIDTH = 900

function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

// Trash sort-by-type grouping order (events first, then notes/code/files).
const TYPE_RANK: Record<BlockType, number> = { event: 0, note: 1, code: 2, file: 3 }

// Soft-deleted tombstones are auto-purged after this window (db layer uses the
// same constant for purgeDeletedBlocks).
const TRASH_WINDOW_DAYS = 7

// Trash view pagination: tombstones per page.
const TRASH_PAGE_SIZE = 20

function formatTrashDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** "còn N ngày" / "còn N giờ" until the 7-day auto-purge removes the tombstone. */
function trashCountdown(iso: string | null): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() + TRASH_WINDOW_DAYS * 86_400_000 - Date.now()
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'sẽ bị xóa vĩnh viễn ngay'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `còn ${days} ngày nữa`
  return `còn ${Math.max(1, Math.ceil(ms / 3_600_000))} giờ nữa`
}

function blockTypeIcon(type: Block['type']): React.ElementType {
  switch (type) {
    case 'event':
      return CalendarBlank
    case 'note':
      return NotePencil
    case 'code':
      return FileCode
    default:
      return Files
  }
}

// ─── Calendar side-panel: live clock ──────────────────────────────────
function CalendarSideClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <div className="rounded border border-border-subtle bg-surface-raised px-3 py-2">
      <p className="font-mono text-2xl tabular-nums text-zinc-100">
        {pad(d.getHours())}:{pad(d.getMinutes())}:{pad(d.getSeconds())}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        {d.toLocaleDateString('vi-VI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
    </div>
  )
}

// ─── Calendar side-panel: today's tasks with checkboxes ───────────────
interface SideTask {
  blockId: string
  blockTitle: string | null
  taskIdx: number
  text: string
  checked: boolean
}

function extractTasks(blocks: Block[]): SideTask[] {
  const today = new Date().toISOString().slice(0, 10)
  const results: SideTask[] = []
  for (const b of blocks) {
    if (b.type !== 'note' && b.type !== 'code') continue
    // Include blocks whose start_time is today or is null (untimed notes).
    const day = b.start_time?.slice(0, 10)
    if (day && day !== today) continue
    const content = b.content as { content?: Array<{ type?: string; content?: Array<{ type?: string; attrs?: { text?: string; checked?: boolean } }> }> } | null
    if (!content?.content) continue
    for (const node of content.content) {
      if (node.type === 'taskList' && node.content) {
        let idx = 0
        for (const item of node.content) {
          if (item.type === 'taskItem') {
            results.push({
              blockId: b.id,
              blockTitle: b.title,
              taskIdx: idx,
              text: item.attrs?.text ?? '',
              checked: item.attrs?.checked ?? false,
            })
            idx++
          }
        }
      }
    }
  }
  return results
}

function CalendarSideTasks({
  blocks,
  onOpenBlock,
  onUpdateBlock,
}: {
  blocks: Block[]
  onOpenBlock: (id: string) => void
  onUpdateBlock: (id: string, patch: Partial<Block>) => void
}) {
  const tasks = useMemo(() => extractTasks(blocks), [blocks])
  const toggleTask = (task: SideTask) => {
    const block = blocks.find((b) => b.id === task.blockId)
    if (!block?.content) return
    const content = JSON.parse(JSON.stringify(block.content)) as {
      content: Array<{ type?: string; content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }>
    }
    let idx = 0
    for (const node of content.content) {
      if (node.type === 'taskList' && node.content) {
        for (const item of node.content) {
          if (item.type === 'taskItem') {
            if (idx === task.taskIdx) {
              item.attrs = { ...item.attrs, checked: !task.checked }
              onUpdateBlock(task.blockId, { content })
              return
            }
            idx++
          }
        }
      }
    }
  }
  if (tasks.length === 0) {
    return (
      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          Việc cần làm hôm nay
        </p>
        <p className="text-[11px] text-zinc-600">Không có task nào</p>
      </div>
    )
  }
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
        Việc cần làm ({tasks.filter((t) => !t.checked).length} còn lại)
      </p>
      <div className="space-y-0.5">
        {tasks.map((task, i) => (
          <label
            key={`${task.blockId}-${task.taskIdx}`}
            className={`flex items-start gap-2 rounded px-2 py-1 text-[12px] transition-colors hover:bg-zinc-800/50 ${
              task.checked ? 'text-zinc-600 line-through' : 'text-zinc-300'
            }`}
          >
            <input
              type="checkbox"
              checked={task.checked}
              onChange={() => toggleTask(task)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded accent-emerald-500"
            />
            <span className="min-w-0 flex-1 truncate">
              {task.text || (task.blockTitle ?? 'Task')}
            </span>
            <button
              type="button"
              onClick={() => onOpenBlock(task.blockId)}
              className="shrink-0 text-[10px] text-zinc-600 hover:text-accent"
              title={task.blockTitle ?? 'Mở block'}
            >
              →
            </button>
          </label>
        ))}
      </div>
    </div>
  )
}

export default function MainWorkspace() {
  // The Hôm nay digest is the landing tab: today's events + overdue/today
  // tasks + quick capture, one glance at start of day.
  const [tab, setTab] = useState<Tab>('today')
  const paneRef = useRef<HTMLDivElement>(null)
  const editorResizeRef = useRef<HTMLDivElement>(null)
  // Resizable editor pane width (persisted to localStorage).
  const [editorWidth, setEditorWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('editor-pane-width')
      if (saved) {
        const n = Number(saved)
        if (n >= MIN_PANE_WIDTH && n <= MAX_PANE_WIDTH) return n
      }
    } catch { /* ignore */ }
    return DEFAULT_PANE_WIDTH
  })
  const uploadRef = useRef<HTMLInputElement>(null)

  // Search state
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const searchRef = useRef<HTMLDivElement>(null)

  // Create menu state
  const [createOpen, setCreateOpen] = useState(false)
  const createRef = useRef<HTMLDivElement>(null)

  // Calendar side panel toggle + draggable width.
  const [calendarSideOpen, setCalendarSideOpen] = useState(false)
  const [calendarSidePct, setCalendarSidePct] = useState(65)

  const setSidebarOpen = useWorkspaceStore((state) => state.setSidebarOpen)
  const activeRightPane = useWorkspaceStore((state) => state.activeRightPane)
  const setActiveRightPane = useWorkspaceStore((state) => state.setActiveRightPane)
  const selectedBlockId = useWorkspaceStore((state) => state.selectedBlockId)
  const setSelectedBlock = useWorkspaceStore((state) => state.setSelectedBlock)

  const blocks = useBlocksStore((state) => state.blocks)
  const relations = useBlocksStore((state) => state.relations)
  const updateBlock = useBlocksStore((state) => state.updateBlock)
  const addBlock = useBlocksStore((state) => state.addBlock)
  const removeBlock = useBlocksStore((state) => state.removeBlock)
  const attach = useBlocksStore((state) => state.attach)
  const detach = useBlocksStore((state) => state.detach)
  const beginBatch = useBlocksStore((state) => state.beginBatch)
  const endBatch = useBlocksStore((state) => state.endBatch)
  const lastDelete = useBlocksStore((state) => state.lastDelete)
  const undoDelete = useBlocksStore((state) => state.undoDelete)
  const dismissUndo = useBlocksStore((state) => state.dismissUndo)
  const undo = useBlocksStore((state) => state.undo)
  const redo = useBlocksStore((state) => state.redo)
  const workspaces = useBlocksStore((state) => state.workspaces)
  const activeWorkspaceId = useBlocksStore((state) => state.activeWorkspaceId)
  const createWorkspace = useBlocksStore((state) => state.createWorkspace)
  const joinWorkspace = useBlocksStore((state) => state.joinWorkspace)
  const switchWorkspace = useBlocksStore((state) => state.switchWorkspace)
  const deletedBlocks = useBlocksStore((state) => state.deletedBlocks)
  const restoreFromTrash = useBlocksStore((state) => state.restoreFromTrash)
  const purgeFromTrash = useBlocksStore((state) => state.purgeFromTrash)
  const { create, upload } = useCreateBlock()

  // Trash sub-tab: active trash items vs. purge history.
  const [trashSubTab, setTrashSubTab] = useState<'trash' | 'history'>('trash')
  const purgeHistory = useBlocksStore((state) => state.purgeHistory)
  const undoPurgeBatch = useBlocksStore((state) => state.undoPurgeBatch)
  const clearPurgeHistory = useBlocksStore((state) => state.clearPurgeHistory)

  // History selection for bulk actions.
  const [historySelected, setHistorySelected] = useState<ReadonlySet<string>>(new Set())
  const historyAllSelected = purgeHistory.length > 0 && historySelected.size === purgeHistory.length
  const toggleHistoryAll = () => {
    setHistorySelected(historyAllSelected ? new Set() : new Set(purgeHistory.map((e) => e.id)))
  }
  const toggleHistoryItem = (id: string) => {
    setHistorySelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Trash batch selection (ids of tombstoned blocks chosen for restore/purge).
  const [trashSelected, setTrashSelected] = useState<ReadonlySet<string>>(new Set())
  // Only ids still in the trash count (restored/purged ones drop out live).
  const trashSelectedLive = useMemo(
    () => new Set([...trashSelected].filter((id) => deletedBlocks.some((b) => b.id === id))),
    [trashSelected, deletedBlocks],
  )

  // Trash search + type filter + sort (find a specific tombstone among many).
  const [trashQuery, setTrashQuery] = useState('')
  const [trashType, setTrashType] = useState<'all' | BlockType>('all')
  const [trashSort, setTrashSort] = useState<'deleted-desc' | 'deleted-asc' | 'type'>('deleted-desc')
  // Pagination: a page of tombstones at a time. Any filter change lands back
  // on page 1 (content changes clamp via trashPageSafe instead).
  const [trashPage, setTrashPage] = useState(0)
  const changeTrashQuery = (v: string) => {
    setTrashQuery(v)
    setTrashPage(0)
    setTrashFocusIdx(0)
  }
  const changeTrashType = (v: 'all' | BlockType) => {
    setTrashType(v)
    setTrashPage(0)
    setTrashFocusIdx(0)
  }
  const changeTrashSort = (v: 'deleted-desc' | 'deleted-asc' | 'type') => {
    setTrashSort(v)
    setTrashPage(0)
    setTrashFocusIdx(0)
  }
  // Keyboard navigation index for trash items (arrow keys).
  const [trashFocusIdx, setTrashFocusIdx] = useState(0)
  const trashFocusRef = useRef<(HTMLDivElement | null)[]>([])

  const trashQueryNorm = normalizeText(trashQuery.trim())
  const filteredTrash = useMemo(() => {
    const matches = deletedBlocks.filter((b) => {
      if (trashType !== 'all' && b.type !== trashType) return false
      if (trashQueryNorm && !normalizeText(b.title ?? '').includes(trashQueryNorm)) return false
      return true
    })
    const t = (iso: string | null) => (iso ? new Date(iso).getTime() || 0 : 0)
    const byDeleted = (a: DeletedBlock, b: DeletedBlock, desc: boolean) => {
      const diff = t(a.deleted_at) - t(b.deleted_at)
      if (diff !== 0) return desc ? -diff : diff
      return (a.title ?? '').localeCompare(b.title ?? '')
    }
    if (trashSort === 'deleted-asc') return [...matches].sort((a, b) => byDeleted(a, b, false))
    if (trashSort === 'type') {
      return [...matches].sort((a, b) => {
        const rank = TYPE_RANK[a.type] - TYPE_RANK[b.type]
        return rank !== 0 ? rank : byDeleted(a, b, true)
      })
    }
    return [...matches].sort((a, b) => byDeleted(a, b, true))
  }, [deletedBlocks, trashType, trashQueryNorm, trashSort])

  // Blocks whose file_url still points at a file that no longer exists — the
  // bytes cannot be recovered. Surfaced after a trash restore (the upload was
  // deleted with the block) and after a .ics import (the file never migrated:
  // the calendar carries URLs, not bytes) — both offer the same Gỡ liên kết
  // tệp action. source distinguishes the notice text.
  const [danglingFiles, setDanglingFiles] = useState<
    { id: string; title: string | null; source: 'restore' | 'import' }[]
  >([])
  const rememberDangling = (b: DeletedBlock) => {
    if (!b.file_url) return
    setDanglingFiles((prev) =>
      prev.some((p) => p.id === b.id) ? prev : [...prev, { id: b.id, title: b.title, source: 'restore' }],
    )
  }
  const clearDanglingLinks = () => {
    for (const p of danglingFiles) void updateBlock(p.id, { file_url: null, file_extension: null })
    setDanglingFiles([])
  }
  const restoreOne = (block: DeletedBlock) => {
    rememberDangling(block)
    void restoreFromTrash(block.id)
  }
  const danglingNoticeText = (() => {
    const imported = danglingFiles.filter((d) => d.source === 'import').length
    const restored = danglingFiles.length - imported
    if (imported > 0 && restored > 0)
      return `${imported} block nhập từ lịch và ${restored} block đã khôi phục trỏ tới tệp không có trong dự án này — tệp không thể khôi phục.`
    if (imported > 0)
      return `${imported} block nhập từ lịch trỏ tới tệp không có trong dự án này — tệp không thể di chuyển qua .ics.`
    return `${restored} block đã khôi phục vẫn trỏ tới tệp đã xóa — tệp không thể khôi phục.`
  })()

  const trashTotalPages = Math.max(1, Math.ceil(filteredTrash.length / TRASH_PAGE_SIZE))
  const trashPageSafe = Math.min(trashPage, trashTotalPages - 1)
  const pageTrash = filteredTrash.slice(
    trashPageSafe * TRASH_PAGE_SIZE,
    (trashPageSafe + 1) * TRASH_PAGE_SIZE,
  )
  const trashAllSelected = filteredTrash.length > 0 && trashSelectedLive.size === filteredTrash.length
  const toggleTrash = (id: string) => {
    setTrashSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleTrashAll = () => {
    setTrashSelected(trashAllSelected ? new Set() : new Set(filteredTrash.map((b) => b.id)))
  }
  // Keyboard navigation for trash items: arrow keys move focus, Enter restores,
  // Delete/Backspace permanently deletes, Space toggles selection.
  const handleTrashKeyDown = (e: React.KeyboardEvent) => {
    const count = pageTrash.length
    if (count === 0) return
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      const next = Math.min(trashFocusIdx + 1, count - 1)
      setTrashFocusIdx(next)
      trashFocusRef.current[next]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      const prev = Math.max(trashFocusIdx - 1, 0)
      setTrashFocusIdx(prev)
      trashFocusRef.current[prev]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && pageTrash[trashFocusIdx]) {
      e.preventDefault()
      restoreOne(pageTrash[trashFocusIdx])
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && pageTrash[trashFocusIdx]) {
      e.preventDefault()
      const block = pageTrash[trashFocusIdx]
      if (window.confirm(`Xóa vĩnh viễn “${block.title ?? 'block này'}”? Không thể hoàn tác.`)) {
        void purgeFromTrash(block.id)
        if (trashFocusIdx >= count - 1) setTrashFocusIdx(Math.max(0, count - 2))
      }
    } else if (e.key === ' ' && pageTrash[trashFocusIdx]) {
      e.preventDefault()
      toggleTrash(pageTrash[trashFocusIdx].id)
    }
  }
  const restoreTrashSelected = () => {
    for (const id of trashSelectedLive) {
      const block = deletedBlocks.find((b) => b.id === id)
      if (block) rememberDangling(block)
      void restoreFromTrash(id)
    }
    setTrashSelected(new Set())
  }
  // Sweep animation state for empty-trash-all effect.
  const [sweeping, setSweeping] = useState(false)
  // Chart granularity for the purge history statistics.
  const [chartGranularity, setChartGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily')

  // Confirmation dialog state for Ctrl+Z undo-purge.
  const [confirmUndoPurge, setConfirmUndoPurge] = useState<{ entry: PurgeHistoryEntry } | null>(null)

  const purgeTrashSelected = () => {
    if (
      !window.confirm(
        `Xóa vĩnh viễn ${trashSelectedLive.size} block khỏi thùng rác? Không thể hoàn tác.`,
      )
    )
      return
    for (const id of trashSelectedLive) void purgeFromTrash(id)
    setTrashSelected(new Set())
  }

  // Empty-trash-all: trigger the sweep animation, then purge after a short delay.
  const purgeAllTrash = () => {
    if (
      !window.confirm(
        `Xóa vĩnh viễn toàn bộ ${deletedBlocks.length} block trong thùng rác? Không thể hoàn tác.`,
      )
    )
      return
    setSweeping(true)
    setTimeout(() => {
      for (const b of deletedBlocks) void purgeFromTrash(b.id)
      setSweeping(false)
    }, 550) // just after the sweep animation completes
  }

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null

  // Live block ids for the Đã nhập rows' survival badges (which blocks of a
  // record still exist vs. were deleted since the import).
  const liveBlockIds = useMemo(() => new Set(blocks.map((b) => b.id)), [blocks])

  useEffect(() => {
    const pane = paneRef.current
    const handle = editorResizeRef.current
    if (!pane) return

    const show = activeRightPane !== 'none'
    if (handle) handle.style.display = show ? 'block' : 'none'
    gsap.killTweensOf(pane)
    // Apply visibility immediately (not inside the tween) so the pane can never
    // end up invisible while open if an animation is interrupted.
    gsap.set(pane, { visibility: show ? 'visible' : 'hidden' })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.set(pane, { width: show ? editorWidth : 0 })
      return
    }
    gsap.to(pane, { width: show ? editorWidth : 0, duration: 0.4, ease: 'power3.inOut' })
  }, [activeRightPane, selectedBlockId])

  // Close floating menus on outside click / Escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false)
      if (createRef.current && !createRef.current.contains(target)) setCreateOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setCreateOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const openBlock = (id: string) => {
    setSelectedBlock(id)
    setActiveRightPane('editor')
    setSearchOpen(false)
    setQuery('')
  }

  const searchResults = useMemo(() => {
    const q = normalizeText(query.trim())
    if (!q) return []
    return blocks
      .map((block) => ({
        block,
        haystack: normalizeText(
          `${block.title ?? ''} ${textPreview(block.content)} ${block.file_extension ?? ''}`,
        ),
      }))
      .filter(({ haystack }) => haystack.includes(q))
      .slice(0, 8)
  }, [blocks, query])

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setSearchOpen(false)
      e.currentTarget.blur()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (searchResults.length > 0) setHighlight((h) => Math.min(h + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && searchResults.length > 0) {
      e.preventDefault()
      openBlock(searchResults[Math.min(highlight, searchResults.length - 1)].block.id)
    }
  }

  const handleCreate = async (kind: CreateKind) => {
    setCreateOpen(false)
    if (kind === 'file') {
      uploadRef.current?.click()
      return
    }
    await create(kind)
  }

  const handleUpload = async (files: FileList | null) => {
    await upload(files)
  }

  // Shared by calendar date-clicks (plain date string → all-day event) and the
  // '＋' toolbar button, which may pass timed start/end defaults for week/day
  // views. Resolves to the new block's id so CalendarView can offer the
  // quick-add repeat picker.
  const handleDateClick = async (dateStr: string, defaults?: { start_time?: string; end_time?: string }) => {
    const block = await addBlock({
      type: 'event',
      title: 'Sự kiện mới',
      content: { type: 'doc', content: [] },
      start_time: defaults?.start_time ?? dateStr,
      end_time: defaults?.end_time ?? null,
    })
    setSelectedBlock(block.id)
    setActiveRightPane('editor')
    return block.id
  }

  // Calendar date click → create a NOTE (not an event) and open the quick-note
  // popover so the user can type directly on the calendar.
  const handleDateNote = async (dateStr: string) => {
    const block = await addBlock({
      type: 'note',
      title: 'Ghi chú mới',
      content: { type: 'doc', content: [] },
      start_time: dateStr,
      end_time: null,
    })
    return block.id
  }

  // Shared by "Chỉ sự kiện này" (drag/resize) and quick-note overrides: a new
  // non-recurring block at the occurrence's times, linked to the master via an
  // 'attached' relation, and the original occurrence excluded from the series
  // (date-only for all-day, ISO instant for timed). Lives in lib/override so
  // the editor's "this vs all" path uses the exact same machinery.
  const createOverride = useOverride()

  // "Chỉ sự kiện này": a new non-recurring block at the moved times.
  const handleOverrideOccurrence = async (
    blockId: string,
    patch: Partial<Block>,
    originalStart: string | null,
  ) => {
    const master = blocks.find((b) => b.id === blockId)
    if (!master) return
    await createOverride(master, patch, originalStart)
  }

  // Quick-note on a recurring occurrence: same machinery, but the override
  // carries the note in its own content (per-occurrence, not shared) and stays
  // at the occurrence's times so the slot keeps rendering.
  const handleQuickNoteOverride = async (
    masterId: string,
    text: string,
    startIso: string,
    endIso: string | null,
  ) => {
    const master = blocks.find((b) => b.id === masterId)
    if (!master) return
    await createOverride(
      master,
      {
        start_time: startIso,
        end_time: endIso,
        content: appendNote(master.content, text) as Block['content'],
      },
      startIso,
    )
  }

  // "Tất cả các lần": shift the whole series by moving the master's dtstart.
  // Recurrence_exceptions (absolute exclusion dates) must shift by the same
  // delta so previously-excluded occurrences stay excluded at their new dates
  // and un-excluded occurrences don't reappear at old dates.
  const handleRescheduleSeries = (blockId: string, patch: Partial<Block>) => {
    const master = blocks.find((b) => b.id === blockId)
    if (!master) { void updateBlock(blockId, patch); return }
    const exceptions = master.recurrence_exceptions
    if (!patch.start_time || !exceptions || exceptions.length === 0) {
      void updateBlock(blockId, patch)
      return
    }
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(master.start_time ?? '')
    const shifted = shiftExceptions(exceptions, master.start_time!, patch.start_time, allDay)
    void updateBlock(blockId, {
      ...patch,
      recurrence_exceptions: shifted ?? exceptions,
    })
  }

  // "Tất cả các lần sau lần này": split the series — the old master keeps its
  // past occurrences, a new recurring master takes over from the patched time.
  const handleSplitSeries = (blockId: string, patch: { start_time?: string | null; end_time?: string | null }) => {
    const master = blocks.find((b) => b.id === blockId)
    if (!master) return
    // This-occurrence overrides of the master: relinked onto the new series
    // when their occurrence falls in the this-and-future range.
    const overrides = blocks.filter((b) =>
      relations.some((r) => r.parent_id === blockId && r.child_id === b.id && r.relation_type === 'attached'),
    )
    void splitSeries({ addBlock, attach, updateBlock, removeBlock, beginBatch, endBatch }, master, patch, { detach, overrides })
  }

  // "Xóa lần này": exclude one occurrence of a recurring series (exception
  // append) without touching the master. "Xóa tất cả": remove the master.
  const handleDeleteOccurrence = (masterId: string, occurrenceStart: string) => {
    const master = blocks.find((b) => b.id === masterId)
    if (!master) return
    void updateBlock(masterId, excludeOccurrence(master, occurrenceStart))
  }

  // "Xóa tất cả các lần sau lần này": keep the occurrences before the split,
  // drop everything from it onward by appending those occurrences to the
  // master's exceptions. When the split covers the whole series (its first
  // occurrence) the master is emptied — remove it outright instead.
  const handleDeleteThisAndFuture = (masterId: string, occurrenceStart: string) => {
    const master = blocks.find((b) => b.id === masterId)
    if (!master) return
    const split = splitSeriesAt(master, occurrenceStart)
    if (!split || !split.addExceptions.length) return
    if (split.coversWholeSeries) {
      void removeBlock(masterId)
      return
    }
    const merged = [...new Set([...(master.recurrence_exceptions ?? []), ...split.addExceptions])]
    void updateBlock(masterId, { recurrence_exceptions: merged.length > 0 ? merged : null })
  }

  const handleDeleteBlock = (id: string) => {
    void removeBlock(id)
  }

  const notes = blocks.filter((b) => b.type === 'note' || b.type === 'code')
  const fileBlocks = blocks.filter((b) => b.type === 'file')

  // Browser-Notification watcher for upcoming events (threshold in settings).
  useEventReminders(blocks)

  // Ctrl/Cmd+Z undo (a pending delete banner undoes first), Ctrl/Cmd+Shift+Z
  // or Ctrl+Y redo — across block edits (calendar drags, splits, links, …).
  // Editable controls (title/datetime/code/editor) keep their native undo: the
  // handler bails when the focus is inside an input/textarea/contenteditable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else {
          // Check if undo would fall through to the last purge: if so, show
          // a confirmation dialog with a preview of the block being restored.
          const st = useBlocksStore.getState()
          const wouldUndoPurge = !st.lastDelete && st.undoStack.length === 0 && st.purgeHistory.length > 0
          if (wouldUndoPurge) {
            const entry = st.purgeHistory.at(-1)!
            setConfirmUndoPurge({ entry })
          } else {
            undo()
          }
        }
      } else if (key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Workspace-wide .ics export/import (event migration path). Import creates
  // masters, split continuations, and this-occurrence overrides through the
  // same store deps; notes/files have no iCal representation and are skipped.
  const icsImportRef = useRef<HTMLInputElement>(null)
  const [icsMsg, setIcsMsg] = useState<string | null>(null)
  const icsMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Show a transient .ics status message that auto-dismisses after 4 s.
   *  Clears any pending timer first so a quick succession of messages
   *  doesn't cause an earlier timeout to erase a newer message. */
  const flashIcsMsg = (msg: string | null) => {
    if (icsMsgTimerRef.current) clearTimeout(icsMsgTimerRef.current)
    setIcsMsg(msg)
    if (msg) icsMsgTimerRef.current = setTimeout(() => setIcsMsg(null), 4000)
  }
  // Clean up the icsMsg flash timer on unmount.
  useEffect(() => () => { if (icsMsgTimerRef.current) clearTimeout(icsMsgTimerRef.current) }, [])
  // Workspace sharing modal: my workspaces, the active one's share code,
  // join-by-code, and create a new workspace.
  const [wsOpen, setWsOpen] = useState(false)
  const [wsJoinCode, setWsJoinCode] = useState('')
  const [wsNewName, setWsNewName] = useState('')
  const [wsMsg, setWsMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [wsCopied, setWsCopied] = useState(false)
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0] ?? null
  const copyShareCode = () => {
    if (!activeWorkspace) return
    void navigator.clipboard?.writeText(activeWorkspace.share_code).then(
      () => {
        setWsCopied(true)
        setTimeout(() => setWsCopied(false), 1500)
      },
      () => undefined,
    )
  }
  const handleJoinWorkspace = async () => {
    setWsMsg(null)
    if (!wsJoinCode.trim()) return
    try {
      const ws = await joinWorkspace(wsJoinCode.trim())
      setWsJoinCode('')
      setWsMsg({ kind: 'ok', text: `Đã tham gia "${ws.name}" — sự kiện chung hiện ngay trong lịch.` })
    } catch (err) {
      setWsMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Không tham gia được không gian' })
    }
  }
  const handleCreateWorkspace = async () => {
    setWsMsg(null)
    try {
      const ws = await createWorkspace(wsNewName.trim() || undefined)
      setWsNewName('')
      setWsMsg({ kind: 'ok', text: `Đã tạo "${ws.name}". Mã chia sẻ: ${ws.share_code}` })
    } catch (err) {
      setWsMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Không tạo được không gian' })
    }
  }
  const exportWorkspaceIcs = () => {
    downloadIcs('freebuff-events.ics', buildWorkspaceIcs(blocks, relations))
  }
  // .ics import now goes through a confirm step: parse + preview first (no
  // blocks are created), flag which file references are dangling, let the
  // user pick which events to import and strip broken refs upfront (or
  // cancel), then import. Kept dangling refs surface the same notice/action
  // as trash restore afterwards. Every successful import lands in the Đã
  // nhập history (with its created block ids) so the last one can be undone
  // wholesale.
  const [icsPreview, setIcsPreview] = useState<{
    text: string
    fileName: string
    summary: IcsPreview
    danglingUids: Set<string>
    stripRefs: Set<string>
    /** Uids the user ticked to import (all by default). */
    selected: Set<string>
    /** Optional group name: prefixes the imported events' titles and labels
     *  the history record as one named batch. */
    groupName: string
  } | null>(null)
  const [icsHistory, setIcsHistory] = useState<IcsImportRecord[]>(() => loadIcsHistory())
  // Reconcile with the server mirror (settings saved on another browser/device
  // win; falls back to the local cache when offline or nothing saved yet).
  useEffect(() => {
    let mounted = true
    void loadIcsHistoryServer().then((records) => {
      if (mounted) setIcsHistory(records)
    })
    return () => {
      mounted = false
    }
  }, [])
  const removeImportBlocks = useBlocksStore((state) => state.removeImportBlocks)
  // True while the dangling-file liveness probes run after picking a file;
  // the import button shows a spinner and is disabled meanwhile.
  const [icsProbing, setIcsProbing] = useState(false)
  const toggleStripRef = (uid: string) => {
    setIcsPreview((prev) => {
      if (!prev) return prev
      const next = new Set(prev.stripRefs)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return { ...prev, stripRefs: next }
    })
  }
  const toggleInclude = (uid: string) => {
    setIcsPreview((prev) => {
      if (!prev) return prev
      const next = new Set(prev.selected)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return { ...prev, selected: next }
    })
  }
  // Checklist bulk tools: select/deselect every row, or every row of one
  // series role (the quick role filters above the list).
  const toggleAllRows = () => {
    setIcsPreview((prev) => {
      if (!prev) return prev
      const allSelected = prev.summary.entries.every((e) => prev.selected.has(e.uid))
      return {
        ...prev,
        selected: allSelected ? new Set() : new Set(prev.summary.entries.map((e) => e.uid)),
      }
    })
  }
  const toggleRole = (role: IcsEventRole) => {
    setIcsPreview((prev) => {
      if (!prev) return prev
      const roleUids = prev.summary.entries.filter((e) => e.role === role).map((e) => e.uid)
      if (roleUids.length === 0) return prev
      const next = new Set(prev.selected)
      // All of this role selected → clicking deselects them; otherwise it
      // selects them all.
      const deselect = roleUids.every((u) => next.has(u))
      for (const u of roleUids) {
        if (deselect) next.delete(u)
        else next.add(u)
      }
      return { ...prev, selected: next }
    })
  }
  const handleImportWorkspaceIcs = async (file: File) => {
    let text: string
    try {
      text = await file.text()
    } catch {
      flashIcsMsg('Không đọc được tệp .ics')
      return
    }
    const summary = previewIcs(text)
    if (summary.events === 0) {
      flashIcsMsg('Không thấy sự kiện nào trong tệp')
      return
    }
    // Dangling = no live file block has the URL AND the object is not
    // actually in this project's storage. The probe returns null for foreign
    // URLs (the migration case), so the file-block rule decides there.
    // Probe results are cached for the session (lib/db/storage), so repeated
    // imports of the same file references never re-HEAD the URLs.
    const liveUrls = new Set(
      blocks
        .filter((b) => b.type === 'file')
        .map((b) => b.file_url)
        .filter((u): u is string => !!u),
    )
    setIcsProbing(true)
    try {
      const probed = await Promise.all(
        summary.fileRefs.map(async (r) => ({
          r,
          exists: liveUrls.has(r.file_url) ? true : await fileExists(r.file_url),
        })),
      )
      const danglingUids = new Set(probed.filter((p) => p.exists !== true).map((p) => p.r.uid))
      setIcsPreview({
        text,
        fileName: file.name,
        summary,
        danglingUids,
        // Clear the broken references upfront by default.
        stripRefs: new Set(danglingUids),
        selected: new Set(summary.entries.map((e) => e.uid)),
        groupName: '',
      })
    } finally {
      setIcsProbing(false)
    }
  }
  const confirmImportWorkspaceIcs = async () => {
    const preview = icsPreview
    if (!preview) return
    setIcsPreview(null)
    try {
      const result = await importIcs(
        preview.text,
        { addBlock, attach },
        {
          stripFileRefs: preview.stripRefs,
          includeUids: preview.selected,
          titlePrefix: preview.groupName.trim() || undefined,
        },
      )
      const { created, fileRefs } = result
      flashIcsMsg(created > 0 ? `Đã nhập ${created} sự kiện` : 'Không thấy sự kiện nào trong tệp')
      if (created > 0) {
        const next = [newIcsImportRecord(preview.fileName, result, preview.groupName), ...icsHistory].slice(0, 50)
        void saveIcsHistoryServer(next)
        setIcsHistory(next)
      }
      // Refs the user chose to KEEP that are still dangling surface the
      // notice (stripped ones never reach fileRefs; live ones aren't
      // dangling). Same notice/action as restore.
      const keptDangling = fileRefs.filter((r) => preview.danglingUids.has(r.uid))
      if (keptDangling.length > 0) {
        setDanglingFiles((prev) => {
          const next = [...prev]
          for (const d of keptDangling) {
            if (!next.some((p) => p.id === d.id)) next.push({ id: d.id, title: d.title, source: 'import' })
          }
          return next
        })
      }
    } catch {
      flashIcsMsg('Không đọc được tệp .ics')
    }
  }
  // Re-export the surviving blocks of one history record as a fresh .ics
  // (scoped to exactly those blocks; relations only count when both endpoints
  // survived). A record whose blocks are all gone just gets a status message.
  const exportImportRecord = (record: IcsImportRecord) => {
    const live = new Set(blocks.map((b) => b.id))
    const surviving = record.blockIds.filter((id) => live.has(id))
    if (surviving.length === 0) {
      flashIcsMsg('Không còn sự kiện nào của lần nhập này để xuất')
      return
    }
    downloadIcs(record.fileName.replace(/\.ics$/i, '') + '.ics', buildWorkspaceIcs(blocks, relations, new Set(surviving)))
  }
  // Undo the LAST import wholesale: remove exactly the blocks it created
  // (hard delete, cascading overrides off their masters) and drop the record.
  const undoLastImport = () => {
    const record = icsHistory[0]
    if (!record) return
    if (
      !window.confirm(
        `Hoàn tác lần nhập "${record.fileName}"? ${record.created} sự kiện sẽ bị xóa vĩnh viễn khỏi dự án.`,
      )
    )
      return
    void removeImportBlocks(record.blockIds).then(() => {
      const next = icsHistory.filter((r) => r.id !== record.id)
      void saveIcsHistoryServer(next)
      setIcsHistory(next)
      flashIcsMsg(`Đã hoàn tác lần nhập "${record.fileName}"`)
    })
  }

  return (
    <main className="relative flex h-[100dvh] flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle bg-background px-4">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Mở sidebar"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          <SidebarSimple size={18} />
        </button>

        <nav className="flex items-center gap-1" aria-label="Khu vực chính">
          {TAB_META.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                tab === key
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
              }`}
            >
              <Icon size={15} weight={tab === key ? 'fill' : 'regular'} />
              {label}
              {key === 'trash' && deletedBlocks.length > 0 && (
                <span className="ml-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
                  {deletedBlocks.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Search */}
        <div ref={searchRef} className="relative ml-4 w-52 lg:w-64">
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlight(0)
              setSearchOpen(e.target.value.trim().length > 0)
            }}
            onFocus={() => {
              if (query.trim()) setSearchOpen(true)
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Tìm kiếm…"
            aria-label="Tìm kiếm block"
            className="h-9 w-full rounded-lg border border-border-subtle bg-surface pl-9 pr-3 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          {searchOpen && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border-subtle bg-surface-raised shadow-2xl">
              {searchResults.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-zinc-500">Không tìm thấy block nào</p>
              ) : (
                <ul role="listbox" aria-label="Kết quả tìm kiếm" className="max-h-80 overflow-y-auto py-1">
                  {searchResults.map(({ block }, index) => {
                    const Icon = blockTypeIcon(block.type)
                    return (
                      <li key={block.id} role="option" aria-selected={index === highlight}>
                        <button
                          type="button"
                          onMouseEnter={() => setHighlight(index)}
                          onClick={() => openBlock(block.id)}
                          className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                            index === highlight ? 'bg-zinc-800' : ''
                          }`}
                        >
                          <Icon size={15} className="shrink-0 text-accent" />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium text-zinc-100">
                              {block.title ?? 'Chưa có tiêu đề'}
                            </span>
                            <span className="block truncate text-[12px] text-zinc-500">
                              {textPreview(block.content)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Clock />
          <button
            type="button"
            onClick={() => setWsOpen(true)}
            title="Chia sẻ không gian làm việc"
            aria-label="Chia sẻ không gian làm việc"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 active:scale-[0.98]"
          >
            <UsersThree size={16} />
          </button>
          <SettingsMenu />
          <ThemeToggle />
          <button
            type="button"
            onClick={exportWorkspaceIcs}
            title="Xuất toàn bộ sự kiện ra tệp .ics (chuỗi lặp lại, các lần loại trừ, các chuỗi tách)"
            aria-label="Xuất lịch .ics"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 active:scale-[0.98]"
          >
            <Export size={16} />
          </button>
          <button
            type="button"
            onClick={() => icsImportRef.current?.click()}
            disabled={icsProbing}
            title={
              icsProbing
                ? 'Đang kiểm tra tệp tham chiếu…'
                : 'Nhập sự kiện từ tệp .ics (di chuyển lịch giữa các dự án)'
            }
            aria-label="Nhập lịch .ics"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-transparent"
          >
            {icsProbing ? <CircleNotch size={16} className="animate-spin" /> : <CloudArrowDown size={16} />}
          </button>
          <input
            ref={icsImportRef}
            type="file"
            accept=".ics,text/calendar"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImportWorkspaceIcs(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 active:scale-[0.98]"
            aria-label="Tải file lên"
          >
            <UploadSimple size={16} />
          </button>

          {/* Create dropdown */}
          <div ref={createRef} className="relative">
            <button
              type="button"
              onClick={() => setCreateOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={createOpen}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong active:scale-[0.98]"
            >
              <Plus size={15} weight="bold" />
              Tạo mới
              <CaretDown size={12} weight="bold" />
            </button>
            {createOpen && (
              <div
                role="menu"
                aria-label="Tạo block mới"
                className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-border-subtle bg-surface-raised py-1 shadow-2xl"
              >
                {CREATE_META.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    onClick={() => handleCreate(key)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                  >
                    <Icon size={15} className="text-zinc-400" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input ref={uploadRef} type="file" multiple hidden onChange={(e) => handleUpload(e.target.files)} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {tab === 'today' && <TodayView />}

          {tab === 'calendar' && (
            <div className="flex h-full min-h-0">
              {/* Calendar — width controlled by the draggable divider */}
              <div style={{ width: calendarSideOpen ? calendarSidePct + '%' : '100%' }} className="min-h-0 transition-none">
                <CalendarView
                  events={blocks}
                  onSelectBlock={openBlock}
                  onDateClick={handleDateClick}
                  onDateNote={handleDateNote}
                  calendarSideOpen={calendarSideOpen}
                  onToggleSide={() => setCalendarSideOpen(!calendarSideOpen)}
                  onEventChange={(id, patch) => updateBlock(id, patch)}
                  onOverrideOccurrence={handleOverrideOccurrence}
                  onRescheduleSeries={handleRescheduleSeries}
                  onSplitSeries={handleSplitSeries}
                  onQuickNoteOverride={handleQuickNoteOverride}
                  onDeleteBlock={handleDeleteBlock}
                  onDeleteOccurrence={handleDeleteOccurrence}
                  onDeleteThisAndFuture={handleDeleteThisAndFuture}
                  onQuickNote={(id, text) => {
                    const block = blocks.find((b) => b.id === id)
                    if (!block) return
                    void updateBlock(id, { content: appendNote(block.content, text) as Block['content'] })
                  }}
                />
              </div>
              {/* Draggable divider */}
              {calendarSideOpen && (
                <div
                  role="separator"
                  aria-label="Kéo để chỉnh kích thước"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    const startX = e.clientX
                    const startPct = calendarSidePct
                    const container = (e.currentTarget.parentElement as HTMLElement)
                    const totalW = container?.getBoundingClientRect().width ?? 1
                    const onMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - startX
                      const newPct = Math.max(40, Math.min(85, startPct + (dx / totalW) * 100))
                      setCalendarSidePct(newPct)
                    }
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove)
                      document.removeEventListener('mouseup', onUp)
                    }
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                  }}
                  className="w-1 cursor-col-resize shrink-0 bg-border-subtle transition-colors hover:bg-accent/50"
                />
              )}
              {/* Side panel — live clock, today's tasks, upcoming events */}
              {calendarSideOpen && (
                <div className="flex min-w-[260px] flex-col border-l border-border-subtle bg-surface">
                  <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                      Bên cạnh
                    </span>
                    <button
                      type="button"
                      onClick={() => setCalendarSideOpen(false)}
                      aria-label="Đóng bảng bên"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    {/* Live clock */}
                    <CalendarSideClock />
                    {/* Today's tasks */}
                    <CalendarSideTasks
                      blocks={blocks}
                      onOpenBlock={openBlock}
                      onUpdateBlock={updateBlock}
                    />
                    {/* Upcoming events */}
                    <div>
                      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                        Sự kiện sắp tới
                      </p>
                      <div className="space-y-1">
                        {blocks
                          .filter((b) => b.type === 'event' && b.start_time)
                          .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
                          .slice(0, 8)
                          .map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => openBlock(b.id)}
                              className="w-full rounded border border-border-subtle px-2 py-1.5 text-left text-[12px] transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
                            >
                              <span className="block truncate font-medium text-zinc-200">{b.title ?? 'Sự kiện'}</span>
                              <span className="block text-[10px] text-zinc-500">
                                {b.start_time ? new Date(b.start_time).toLocaleDateString('vi-VI', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}
                              </span>
                            </button>
                          ))}
                        {blocks.filter((b) => b.type === 'event' && b.start_time).length === 0 && (
                          <p className="text-[11px] text-zinc-600">Chưa có sự kiện</p>
                        )}
                      </div>
                    </div>
                    {/* Quick note capture */}
                    <div>
                      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                        Ghi chú nhanh
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          const block = await addBlock({
                            type: 'note',
                            title: 'Ghi chú mới',
                            content: { type: 'doc', content: [] },
                            start_time: new Date().toISOString().slice(0, 10),
                            end_time: null,
                          })
                          openBlock(block.id)
                        }}
                        className="flex w-full items-center gap-2 rounded border border-border-subtle px-2 py-1.5 text-[12px] text-zinc-400 transition-colors hover:border-accent/40 hover:text-accent"
                      >
                        <NotePencil size={13} />
                        Tạo ghi chú mới
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'planner' && <PlannerView />}

          {tab === 'notes' && (
            <div className="h-full overflow-y-auto p-6">
              {notes.length === 0 ? (
                <EmptyState
                  icon={NotePencil}
                  title="Chưa có ghi chú nào"
                  hint="Bấm “Tạo mới” ở góc trên bên phải để tạo ghi chú đầu tiên."
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {notes.map((block) => {
                    const tasks = countTasks(block.content)
                    return (
                      <div
                        key={block.id}
                        className="group relative rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-zinc-700"
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (window.confirm(`Xóa \u201c${block.title ?? 'ghi chú này'}\u201d vào thùng rác?`)) {
                              void removeBlock(block.id)
                            }
                          }}
                          aria-label={`Xóa ${block.title ?? 'ghi chú'}`}
                          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-zinc-600 opacity-0 transition-all hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openBlock(block.id)}
                          className="w-full text-left"
                        >
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-zinc-100">
                              {block.title ?? 'Chưa có tiêu đề'}
                            </p>
                            {tasks.total > 0 && <TodoChip done={tasks.done} total={tasks.total} />}
                          </div>
                          <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-zinc-500">
                            {textPreview(block.content)}
                          </p>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'files' && (
            <div className="h-full overflow-y-auto p-6">
              {fileBlocks.length === 0 ? (
                <EmptyState
                  icon={Files}
                  title="Chưa có tệp nào"
                  hint="Tải lên hình ảnh, .md, .txt, .docx, .pdf, .py, .cpp… — mọi thứ nằm gọn trong một block."
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {fileBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="rounded-xl border border-border-subtle bg-surface p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 font-mono text-[11px] uppercase text-accent">
                          {block.file_extension ?? '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-zinc-100">{block.title}</p>
                          {block.file_url && (
                            <a
                              href={block.file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[12px] text-accent hover:underline"
                            >
                              Mở tệp
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'imported' && (
            <div className="h-full overflow-y-auto p-6">
              {icsHistory.length === 0 ? (
                <EmptyState
                  icon={TrayArrowDown}
                  title="Chưa có lần nhập nào"
                  hint="Nhập tệp .ics từ nút ở góc trên bên phải — các lần nhập (số lượng, tệp, thời điểm) sẽ được liệt kê ở đây."
                />
              ) : (
                <div className="mx-auto max-w-2xl space-y-2">
                  <p className="text-[12px] text-zinc-500">
                    {icsHistory.length} lần nhập .ics · lần gần nhất có thể hoàn tác toàn bộ
                  </p>
                  {icsHistory.map((record, index) => {
                    const surviving = record.blockIds.filter((id) => liveBlockIds.has(id)).length
                    const allGone = surviving === 0
                    const partial = surviving < record.blockIds.length
                    return (
                      <div
                        key={record.id}
                        className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-zinc-100">
                            {record.groupName ?? record.fileName}
                          </p>
                          {record.groupName && (
                            <p className="truncate text-[12px] text-zinc-500">Tệp: {record.fileName}</p>
                          )}
                          <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-zinc-500">
                            {record.created} sự kiện
                            {record.continuations > 0 && ` · ${record.continuations} chuỗi tách`}
                            {record.overrides > 0 && ` · ${record.overrides} lần chỉnh sửa`}
                            <span
                              title={
                                allGone
                                  ? 'Toàn bộ sự kiện của lần nhập này đã bị xóa'
                                  : partial
                                    ? `Còn ${surviving}/${record.blockIds.length} sự kiện trong dự án`
                                    : 'Toàn bộ sự kiện của lần nhập này vẫn còn'
                              }
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                allGone
                                  ? 'bg-red-500/15 text-red-300'
                                  : partial
                                    ? 'bg-amber-500/15 text-amber-300'
                                    : 'bg-emerald-500/15 text-emerald-300'
                              }`}
                            >
                              {allGone ? 'Đã xóa hết' : partial ? `Còn ${surviving}/${record.blockIds.length}` : 'Còn đủ'}
                            </span>
                          </p>
                          <p className="text-[12px] text-zinc-500">{formatHistoryDate(record.createdAt)}</p>
                        </div>
                      <button
                        type="button"
                        onClick={() => exportImportRecord(record)}
                        aria-label={`Xuất lại ${record.fileName}`}
                        title="Xuất lại các sự kiện còn lại của lần nhập này ra tệp .ics"
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
                      >
                        <DownloadSimple size={13} />
                        Xuất .ics
                      </button>
                      {index === 0 && (
                        <button
                          type="button"
                          onClick={undoLastImport}
                          aria-label={`Hoàn tác lần nhập ${record.fileName}`}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
                        >
                          <ArrowClockwise size={13} />
                          Hoàn tác
                        </button>
                      )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'trash' && (
            <div className="h-full overflow-y-auto p-6">
              {/* Sub-tab toggle: active trash vs purge history */}
              <div className="mx-auto mb-4 flex max-w-2xl items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTrashSubTab('trash')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    trashSubTab === 'trash'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <Trash size={14} weight={trashSubTab === 'trash' ? 'fill' : 'regular'} />
                  Thùng rác
                  {deletedBlocks.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
                      {deletedBlocks.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setTrashSubTab('history')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    trashSubTab === 'history'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <ArrowClockwise size={14} weight={trashSubTab === 'history' ? 'fill' : 'regular'} />
                  Lịch sử xóa
                  {purgeHistory.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-zinc-300">
                      {purgeHistory.length}
                    </span>
                  )}
                </button>
              </div>

              {trashSubTab === 'trash' && (
              deletedBlocks.length === 0 ? (
                <EmptyState
                  icon={Trash}
                  title="Thùng rác trống"
                  hint="Các block đã xóa nằm ở đây trong 7 ngày trước khi bị dọn dẹp tự động."
                />
              ) : (
                <div className="mx-auto max-w-2xl space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] text-zinc-500">
                      {deletedBlocks.length} block trong thùng rác · tự động xóa vĩnh viễn sau 7 ngày
                    </p>
                    <div className="flex items-center gap-3">
                      <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-zinc-400">
                        <input
                          type="checkbox"
                          checked={trashAllSelected}
                          onChange={toggleTrashAll}
                          aria-label="Chọn tất cả block đã xóa"
                          className="h-3.5 w-3.5 accent-accent"
                        />
                        Chọn tất cả
                      </label>
                      <button
                        type="button"
                        onClick={purgeAllTrash}
                        className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[12px] font-medium text-red-400/90 transition-colors hover:bg-red-500/10"
                      >
                        <Trash size={13} />
                        Xóa hết
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <MagnifyingGlass
                        size={14}
                        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
                      />
                      <input
                        type="search"
                        value={trashQuery}
                        onChange={(e) => changeTrashQuery(e.target.value)}
                        placeholder="Tìm trong thùng rác…"
                        aria-label="Tìm block trong thùng rác"
                        className="h-8 w-full rounded-lg border border-border-subtle bg-surface pl-8 pr-3 text-[12px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
                      />
                    </div>
                    <select
                      value={trashType}
                      onChange={(e) => changeTrashType(e.target.value as 'all' | BlockType)}
                      aria-label="Lọc theo loại block"
                      className="h-8 rounded-lg border border-border-subtle bg-surface px-2 text-[12px] text-zinc-300 focus:border-zinc-600 focus:outline-none"
                    >
                      <option value="all">Tất cả loại</option>
                      <option value="event">Sự kiện</option>
                      <option value="note">Ghi chú</option>
                      <option value="code">Mã nguồn</option>
                      <option value="file">Tệp</option>
                    </select>
                    <select
                      value={trashSort}
                      onChange={(e) => changeTrashSort(e.target.value as 'deleted-desc' | 'deleted-asc' | 'type')}
                      aria-label="Sắp xếp thùng rác"
                      className="h-8 rounded-lg border border-border-subtle bg-surface px-2 text-[12px] text-zinc-300 focus:border-zinc-600 focus:outline-none"
                    >
                      <option value="deleted-desc">Mới xóa trước</option>
                      <option value="deleted-asc">Cũ nhất trước</option>
                      <option value="type">Theo loại</option>
                    </select>
                  </div>
                  <div tabIndex={0} role="listbox" aria-label="Danh sách thùng rác — dùng mũi tên để di chuyển, Enter để khôi phục, Delete để xóa vĩnh viễn" onKeyDown={handleTrashKeyDown} className="outline-none">
                  {trashSelectedLive.size > 0 && (
                    <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2">
                      <span className="text-[12px] text-zinc-400">
                        Đã chọn {trashSelectedLive.size} block
                      </span>
                      <button
                        type="button"
                        onClick={restoreTrashSelected}
                        className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
                      >
                        <ArrowClockwise size={13} />
                        Khôi phục đã chọn
                      </button>
                      <button
                        type="button"
                        onClick={purgeTrashSelected}
                        className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[12px] font-medium text-red-400/90 transition-colors hover:bg-red-500/10"
                      >
                        <Trash size={13} />
                        Xóa vĩnh viễn đã chọn
                      </button>
                    </div>
                  )}
                  {filteredTrash.length === 0 ? (
                    <p className="rounded-xl border border-border-subtle bg-surface px-3 py-4 text-center text-[12px] text-zinc-500">
                      Không có kết quả phù hợp
                    </p>
                  ) : (
                    pageTrash.map((block, idx) => (
                      <div
                        key={block.id}
                        ref={(el) => { trashFocusRef.current[idx] = el }}
                        role="option"
                        aria-selected={trashFocusIdx === idx}
                        tabIndex={trashFocusIdx === idx ? 0 : -1}
                        className={`flex items-center gap-3 rounded-xl border bg-surface p-3 transition-colors ${sweeping ? 'animate-sweep-out' : ''} ${trashFocusIdx === idx ? 'border-accent/60 ring-1 ring-accent/30' : 'border-border-subtle'}`}
                        style={sweeping ? { animationDelay: `${Math.random() * 0.3}s` } : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={trashSelectedLive.has(block.id)}
                          onChange={() => toggleTrash(block.id)}
                          aria-label={`Chọn ${block.title ?? 'block'}`}
                          className="h-3.5 w-3.5 shrink-0 accent-accent"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-zinc-100">
                            {block.title ?? 'Chưa có tiêu đề'}
                          </p>
                          <p className="text-[12px] text-zinc-500">
                            {block.type === 'event' && block.start_time
                              ? `Sự kiện · ${block.start_time.slice(0, 10)}`
                              : block.type === 'event'
                                ? 'Sự kiện'
                                : block.type}
                            {block.file_url && ' · tệp đính kèm đã bị xóa'}
                          </p>
                          <p className="text-[12px] text-zinc-500">
                            Đã xóa {formatTrashDate(block.deleted_at)}
                            {block.deleted_at && ` · ${trashCountdown(block.deleted_at)}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => restoreOne(block)}
                          aria-label={`Khôi phục ${block.title ?? 'block'}`}
                          className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
                        >
                          <ArrowClockwise size={13} />
                          Khôi phục
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Xóa vĩnh viễn “${block.title ?? 'block này'}”? Không thể hoàn tác.`)) {
                              void purgeFromTrash(block.id)
                            }
                          }}
                          aria-label={`Xóa vĩnh viễn ${block.title ?? 'block'}`}
                          className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-[12px] font-medium text-red-400/90 transition-colors hover:border-red-500/40 hover:bg-red-500/10"
                        >
                          <Trash size={13} />
                          Xóa vĩnh viễn
                        </button>
                      </div>
                    ))
                  )}
                  {filteredTrash.length > TRASH_PAGE_SIZE && (
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-[12px] text-zinc-500">
                        Trang {trashPageSafe + 1} / {trashTotalPages}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setTrashPage(trashPageSafe - 1)}
                          disabled={trashPageSafe === 0}
                          aria-label="Trang trước"
                          className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ‹ Trước
                        </button>
                        <button
                          type="button"
                          onClick={() => setTrashPage(trashPageSafe + 1)}
                          disabled={trashPageSafe >= trashTotalPages - 1}
                          aria-label="Trang sau"
                          className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Sau ›
                        </button>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              ))} {/* end trashSubTab === 'trash' */}

              {trashSubTab === 'history' && (
                <div className="mx-auto max-w-2xl space-y-2">
                  <p className="text-[12px] text-zinc-500">
                    {purgeHistory.length} block đã xóa vĩnh viễn trong 30 ngày qua
                  </p>
                  {purgeHistory.length > 0 && (() => {
                    // Build chart buckets based on the selected granularity.
                    const now = new Date()
                    const dayMs = 86_400_000
                    const buckets: { label: string; count: number }[] = []
                    if (chartGranularity === 'daily') {
                      for (let i = 29; i >= 0; i--) {
                        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
                        const dayEnd = new Date(dayStart.getTime() + dayMs)
                        const count = purgeHistory.filter((e) => {
                          const t = new Date(e.purgedAt).getTime()
                          return t >= dayStart.getTime() && t < dayEnd.getTime()
                        }).length
                        buckets.push({
                          label: `${dayStart.getDate()}/${dayStart.getMonth() + 1}`,
                          count,
                        })
                      }
                    } else if (chartGranularity === 'weekly') {
                      for (let i = 11; i >= 0; i--) {
                        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (i * 7 + now.getDay()))
                        const weekEnd = new Date(weekStart.getTime() + 7 * dayMs)
                        const count = purgeHistory.filter((e) => {
                          const t = new Date(e.purgedAt).getTime()
                          return t >= weekStart.getTime() && t < weekEnd.getTime()
                        }).length
                        buckets.push({
                          label: `${weekStart.getDate()}/${weekStart.getMonth() + 1}`,
                          count,
                        })
                      }
                    } else {
                      for (let i = 11; i >= 0; i--) {
                        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
                        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
                        const count = purgeHistory.filter((e) => {
                          const t = new Date(e.purgedAt).getTime()
                          return t >= monthStart.getTime() && t < monthEnd.getTime()
                        }).length
                        buckets.push({
                          label: `${monthStart.getMonth() + 1}/${monthStart.getFullYear()}`,
                          count,
                        })
                      }
                    }
                    const maxCount = Math.max(1, ...buckets.map((b) => b.count))
                    const granularityLabels = { daily: 'Hàng ngày', weekly: 'Hàng tuần', monthly: 'Hàng tháng' }
                    return (
                      <div className="rounded-xl border border-border-subtle bg-surface p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-[11px] font-medium text-zinc-400">Số block xóa vĩnh viễn {granularityLabels[chartGranularity].toLowerCase()}</p>
                          <div className="flex items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-raised p-0.5">
                            {(['daily', 'weekly', 'monthly'] as const).map((g) => (
                              <button
                                key={g}
                                type="button"
                                onClick={() => setChartGranularity(g)}
                                className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                                  chartGranularity === g
                                    ? 'bg-zinc-700 text-zinc-100'
                                    : 'text-zinc-400 hover:text-zinc-200'
                                }`}
                              >
                                {granularityLabels[g]}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-end gap-[2px]" style={{ height: 64 }}>
                          {buckets.map((b, i) => (
                            <div key={i} className="group relative flex flex-1 items-end" style={{ height: '100%' }}>
                              <div
                                className="w-full rounded-t-sm bg-red-500/40 transition-colors group-hover:bg-red-500/60"
                                style={{ height: b.count > 0 ? `${(b.count / maxCount) * 100}%` : 0, minHeight: b.count > 0 ? 2 : 0 }}
                              />
                              {b.count > 0 && (
                                <div className="pointer-events-none absolute -top-5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">
                                  {b.count}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="mt-1 flex justify-between">
                          <span className="text-[9px] text-zinc-600">{buckets[0].label}</span>
                          <span className="text-[9px] text-zinc-600">{buckets[buckets.length - 1].label}</span>
                        </div>
                      </div>
                    )
                  })()}
                  {purgeHistory.length === 0 ? (
                    <EmptyState
                      icon={ArrowClockwise}
                      title="Chưa có lịch sử xóa"
                      hint="Các block bị xóa vĩnh viễn sẽ xuất hiện ở đây trong 30 ngày."
                    />
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-zinc-400">
                          <input
                            type="checkbox"
                            checked={historyAllSelected}
                            onChange={toggleHistoryAll}
                            aria-label="Chọn tất cả lịch sử"
                            className="h-3.5 w-3.5 accent-accent"
                          />
                          Chọn tất cả
                        </label>
                        <div className="flex items-center gap-2">
                          {historySelected.size > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!window.confirm(`Hoàn tác ${historySelected.size} block? Chúng sẽ quay lại thùng rác.`)) return
                                void undoPurgeBatch([...historySelected])
                                setHistorySelected(new Set())
                              }}
                              className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
                            >
                              <ArrowClockwise size={13} />
                              Hoàn tác đã chọn ({historySelected.size})
                            </button>
                          )}
                          {historySelected.size > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!window.confirm(`Xóa vĩnh viễn ${historySelected.size} bản ghi khỏi lịch sử? Hành động này không thể hoàn tác.`)) return
                                clearPurgeHistory([...historySelected])
                                setHistorySelected(new Set())
                              }}
                              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[12px] font-medium text-red-400/90 transition-colors hover:bg-red-500/10"
                            >
                              <Trash size={13} />
                              Xóa lịch sử ({historySelected.size})
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const selected = historySelected.size > 0
                                ? purgeHistory.filter((e) => historySelected.has(e.id))
                                : purgeHistory
                              const rows = [['Tiêu đề', 'Loại', 'Có tệp', 'Thời gian xóa']]
                              for (const e of selected) {
                                rows.push([
                                  e.title ?? 'Chưa có tiêu đề',
                                  e.type === 'event' ? 'Sự kiện' : e.type === 'note' ? 'Ghi chú' : e.type === 'code' ? 'Mã nguồn' : 'Tệp',
                                  e.hadFile ? 'Có' : 'Không',
                                  formatTrashDate(e.purgedAt),
                                ])
                              }
                              const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
                              const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `lich-su-xoa-${new Date().toISOString().slice(0, 10)}.csv`
                              a.click()
                              URL.revokeObjectURL(url)
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
                          >
                            <DownloadSimple size={13} />
                            Xuất CSV
                          </button>
                        </div>
                      </div>
                      {[...purgeHistory].reverse().map((entry) => (
                        <div
                          key={entry.id}
                          className={`flex items-center gap-3 rounded-xl border bg-surface p-3 transition-colors ${
                            historySelected.has(entry.id)
                              ? 'border-accent/50 bg-accent/5'
                              : 'border-border-subtle opacity-70'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={historySelected.has(entry.id)}
                            onChange={() => toggleHistoryItem(entry.id)}
                            aria-label={`Chọn ${entry.title ?? 'block'}`}
                            className="h-3.5 w-3.5 shrink-0 accent-accent"
                          />
                          <div className="shrink-0 text-zinc-600">
                            {(() => {
                              const Icon = blockTypeIcon(entry.type)
                              return <Icon size={16} />
                            })()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-zinc-400">
                              {entry.title ?? 'Chưa có tiêu đề'}
                            </p>
                            <p className="text-[12px] text-zinc-600">
                              {entry.type === 'event' ? 'Sự kiện' : entry.type === 'note' ? 'Ghi chú' : entry.type === 'code' ? 'Mã nguồn' : 'Tệp'}
                              {entry.hadFile && ' · có tệp đính kèm'}
                            </p>
                          </div>
                          <p className="shrink-0 text-[12px] text-zinc-600">
                            Xóa {formatTrashDate(entry.purgedAt)}
                          </p>
                          <button
                            type="button"
                            onClick={() => setConfirmUndoPurge({ entry })}
                            aria-label={`Hoàn tác xóa ${entry.title ?? 'block'}`}
                            title="Hoàn tác: khôi phục block này về thùng rác"
                            className="flex shrink-0 items-center gap-1 rounded-lg border border-border-subtle px-2 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
                          >
                            <ArrowClockwise size={12} />
                            Hoàn tác
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Draggable resize handle for editor pane */}
        <div
          ref={editorResizeRef}
          role="separator"
          aria-label="Kéo để chỉnh kích thước trình soạn thảo"
          onMouseDown={(e) => {
            e.preventDefault()
            const startX = e.clientX
            const startW = editorWidth
            const onMove = (ev: MouseEvent) => {
              const dx = ev.clientX - startX
              const newW = Math.max(MIN_PANE_WIDTH, Math.min(MAX_PANE_WIDTH, startW - dx))
              setEditorWidth(newW)
            }
            const onUp = () => {
              document.removeEventListener('mousemove', onMove)
              document.removeEventListener('mouseup', onUp)
              try { localStorage.setItem('editor-pane-width', String(editorWidth)) } catch { /* ignore */ }
            }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
          style={{ display: 'none' }}
          className="w-1 shrink-0 cursor-col-resize bg-border-subtle transition-colors hover:bg-accent/50"
        />
        {/* Persistent split editor pane */}
        <div
          ref={paneRef}
          className="shrink-0 overflow-hidden border-l border-border-subtle bg-surface-raised"
          style={{ width: 0, visibility: 'hidden' }}
        >
          <div className="h-full" style={{ width: editorWidth }}>
            {selectedBlock ? (
              <>
                <div className="flex h-11 items-center justify-between border-b border-border-subtle px-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                    {selectedBlock.type === 'event'
                      ? 'Sự kiện'
                      : selectedBlock.type === 'code'
                        ? 'Mã nguồn'
                        : selectedBlock.type === 'file'
                          ? 'Tệp'
                          : 'Ghi chú'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Xóa \u201c${selectedBlock.title ?? 'block này'}\u201d vào thùng rác?`)) {
                          void removeBlock(selectedBlock.id)
                          setActiveRightPane('none')
                          setSelectedBlock(null)
                        }
                      }}
                      aria-label={`Xóa ${selectedBlock.title ?? 'block'}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveRightPane('none')}
                      aria-label="Đóng pane"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
                {selectedBlock.type === 'file' ? (
                  activeRightPane === 'preview' ? (
                    <PreviewPane block={selectedBlock} />
                  ) : (
                    <FileDetail block={selectedBlock} />
                  )
                ) : activeRightPane === 'preview' ? (
                  <PreviewPane block={selectedBlock} />
                ) : selectedBlock.type === 'code' ? (
                  <CodeEditor block={selectedBlock} onChange={(block, patch) => updateBlock(block.id, patch)} />
                ) : (
                  <EditorPane block={selectedBlock} onChange={(block, patch) => updateBlock(block.id, patch)} />
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <NotePencil size={26} className="text-zinc-700" />
                <p className="text-[13px] text-zinc-500">Chọn một block để mở trình soạn thảo</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom status bar: shows the active countdown/stopwatch on every tab. */}
      <TimerStatusBar />

      {/* Dangling-file notice (restore + .ics import): the referenced bytes
          are gone, offer the same Gỡ liên kết tệp cleanup. Lives outside any
          tab so it survives emptying the trash and shows on every view. */}
      {danglingFiles.length > 0 && (
        <div
          className="fixed bottom-24 left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 shadow-2xl"
          role="status"
        >
          <p className="min-w-0 flex-1 text-[12px] text-amber-200/90">{danglingNoticeText}</p>
          <button
            type="button"
            onClick={clearDanglingLinks}
            aria-label="Gỡ liên kết tệp đã xóa"
            className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
          >
            Gỡ liên kết tệp
          </button>
          <button
            type="button"
            onClick={() => setDanglingFiles([])}
            aria-label="Đóng thông báo tệp đã xóa"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* .ics import confirm step: a full per-event checklist (title, date,
          series role) grouped by status — dangling-file events pinned on top
          with an upfront strip option — and every row individually selectable.
          Nothing is created until Nhập. */}
      {icsPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIcsPreview(null) }}
          onKeyDown={(e) => { if (e.key === 'Escape') setIcsPreview(null) }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Xác nhận nhập lịch"
            className="w-full max-w-lg rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-2xl"
          >
            {(() => {
              const entries = icsPreview.summary.entries
              const selectedEntries = entries.filter((e) => icsPreview.selected.has(e.uid))
              const selectedCount = selectedEntries.length
              const selContinuations = selectedEntries.filter((e) => e.role === 'continuation').length
              const selOverrides = selectedEntries.filter((e) => e.role === 'override').length
              const dangling = entries
                .filter((e) => icsPreview.danglingUids.has(e.uid))
                .sort((a, b) => (a.dtstart ?? '').localeCompare(b.dtstart ?? ''))
              const normal = entries
                .filter((e) => !icsPreview.danglingUids.has(e.uid))
                .sort(
                  (a, b) =>
                    ICS_ROLE_RANK[a.role] - ICS_ROLE_RANK[b.role] ||
                    (a.dtstart ?? '').localeCompare(b.dtstart ?? '') ||
                    (a.title ?? '').localeCompare(b.title ?? ''),
                )
              const roleCounts: Record<IcsEventRole, number> = {
                master: 0,
                continuation: 0,
                override: 0,
                standalone: 0,
              }
              for (const e of entries) roleCounts[e.role]++
              const allSelected = entries.length > 0 && entries.every((e) => icsPreview.selected.has(e.uid))
              const roleSelected = (role: IcsEventRole) =>
                entries.filter((e) => e.role === role).every((e) => icsPreview.selected.has(e.uid))
              return (
                <>
                  <h2 className="text-[15px] font-semibold text-zinc-100">
                    Nhập {selectedCount} sự kiện từ tệp {icsPreview.fileName}?
                  </h2>
                  <p className="mt-1 text-[12px] text-zinc-500">
                    Gồm {selContinuations} chuỗi tách và {selOverrides} lần chỉnh sửa cho một lần. Bỏ
                    chọn một sự kiện để loại nó khỏi lần nhập.
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAllRows}
                        aria-label="Chọn tất cả sự kiện trong lần nhập"
                        className="h-3.5 w-3.5 accent-accent"
                      />
                      Chọn tất cả
                    </label>
                    <div
                      className="ml-auto flex flex-wrap items-center justify-end gap-1"
                      role="group"
                      aria-label="Chọn nhanh theo vai trò"
                    >
                      {(Object.keys(roleCounts) as IcsEventRole[])
                        .filter((role) => roleCounts[role] > 0)
                        .map((role) => {
                          const active = roleSelected(role)
                          return (
                            <button
                              key={role}
                              type="button"
                              onClick={() => toggleRole(role)}
                              aria-pressed={active}
                              title={`Chọn/bỏ chọn tất cả: ${ICS_ROLE_LABELS[role]}`}
                              className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                                active
                                  ? 'bg-accent text-accent-foreground'
                                  : 'border border-border-subtle text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                              }`}
                            >
                              {ICS_ROLE_LABELS[role]} · {roleCounts[role]}
                            </button>
                          )
                        })}
                    </div>
                  </div>

                  <input
                    value={icsPreview.groupName}
                    onChange={(e) =>
                      setIcsPreview((prev) => (prev ? { ...prev, groupName: e.target.value } : prev))
                    }
                    placeholder="Tên nhóm (tùy chọn) — ví dụ: Lịch công việc tháng 8"
                    aria-label="Tên nhóm cho lần nhập"
                    className="mt-3 h-8 w-full rounded-lg border border-border-subtle bg-surface px-2.5 text-[12px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
                  />

                  <div className="mt-3 max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                    {dangling.length > 0 && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                        <p className="text-[12px] font-medium text-amber-200/90">
                          Tệp không có trong dự án này ({dangling.length})
                        </p>
                        <ul className="mt-2 space-y-2">
                          {dangling.map((ev) => (
                            <li key={ev.uid} className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={icsPreview.selected.has(ev.uid)}
                                onChange={() => toggleInclude(ev.uid)}
                                aria-label={`Nhập sự kiện: ${ev.title ?? 'Sự kiện'}`}
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate text-[12px] font-medium text-zinc-200">
                                    {ev.title ?? 'Sự kiện'}
                                  </span>
                                  <IcsRoleBadge role={ev.role} />
                                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                                    tệp thiếu
                                  </span>
                                </div>
                                <p className="text-[11px] text-zinc-500">{formatIcsDate(ev.dtstart)}</p>
                                <p className="truncate text-[11px] text-zinc-500">{ev.fileUrl}</p>
                                <label className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 text-[11px] text-amber-200/80">
                                  <input
                                    type="checkbox"
                                    checked={icsPreview.stripRefs.has(ev.uid)}
                                    disabled={!icsPreview.selected.has(ev.uid)}
                                    onChange={() => toggleStripRef(ev.uid)}
                                    aria-label={`Gỡ liên kết tệp khi nhập: ${ev.title ?? 'sự kiện'}`}
                                    className="h-3 w-3 accent-accent"
                                  />
                                  Gỡ liên kết tệp khi nhập
                                </label>
                              </div>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-[11px] text-amber-200/60">
                          Bỏ chọn “Gỡ liên kết” để giữ liên kết và nhận thông báo gỡ liên kết sau khi nhập.
                        </p>
                      </div>
                    )}

                    {normal.length > 0 && (
                      <div className="rounded-xl border border-border-subtle bg-surface p-3">
                        <p className="text-[12px] font-medium text-zinc-300">
                          Sẵn sàng nhập ({normal.length})
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {normal.map((ev) => (
                            <li key={ev.uid} className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={icsPreview.selected.has(ev.uid)}
                                onChange={() => toggleInclude(ev.uid)}
                                aria-label={`Nhập sự kiện: ${ev.title ?? 'Sự kiện'}`}
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate text-[12px] font-medium text-zinc-200">
                                    {ev.title ?? 'Sự kiện'}
                                  </span>
                                  <IcsRoleBadge role={ev.role} />
                                </div>
                                <p className="text-[11px] text-zinc-500">{formatIcsDate(ev.dtstart)}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIcsPreview(null)}
                      aria-label="Hủy nhập lịch"
                      className="rounded-lg border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={confirmImportWorkspaceIcs}
                      disabled={selectedCount === 0}
                      aria-label="Đồng ý nhập lịch"
                      className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Nhập {selectedCount} sự kiện
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Workspace sharing: my workspaces, the active one's share code (copy
          it and send it to someone — they join via the input below and then
          see and edit the same blocks), create a new workspace, or switch
          which workspace new blocks land in. */}
      {wsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setWsOpen(false); setWsMsg(null) } }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setWsOpen(false); setWsMsg(null) } }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Chia sẻ không gian làm việc"
            className="w-full max-w-md rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-2xl"
          >
            <div className="flex items-center gap-2">
              <UsersThree size={17} className="text-accent" />
              <h2 className="flex-1 text-sm font-semibold text-zinc-100">Không gian làm việc</h2>
              <button
                type="button"
                onClick={() => {
                  setWsOpen(false)
                  setWsMsg(null)
                }}
                aria-label="Đóng"
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X size={14} />
              </button>
            </div>

            {/* Share code of the active workspace */}
            <div className="mt-4 rounded-xl border border-border-subtle bg-surface p-3">
              <p className="text-[12px] text-zinc-500">
                Không gian đang dùng: <span className="font-medium text-zinc-200">{activeWorkspace?.name ?? '—'}</span>
              </p>
              {activeWorkspace ? (
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 font-mono text-[14px] font-semibold tracking-widest text-accent">
                    {activeWorkspace.share_code}
                  </code>
                  <button
                    type="button"
                    onClick={copyShareCode}
                    aria-label="Sao chép mã chia sẻ"
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 text-[12px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
                  >
                    {wsCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    {wsCopied ? 'Đã chép' : 'Sao chép'}
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-[12px] text-zinc-500">Đang tải không gian…</p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                Ai có mã này sẽ thấy và chỉnh sửa được toàn bộ sự kiện trong không gian — gửi mã để cùng làm việc.
              </p>
            </div>

            {/* My workspaces */}
            {workspaces.length > 0 && (
              <div className="mt-3">
                <p className="text-[12px] font-medium text-zinc-400">Không gian của tôi</p>
                <ul className="mt-1.5 space-y-1">
                  {workspaces.map((ws) => (
                    <li key={ws.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (ws.id !== activeWorkspaceId) {
                            switchWorkspace(ws.id)
                            setWsMsg(null)
                          }
                        }}
                        aria-pressed={ws.id === activeWorkspaceId}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                          ws.id === activeWorkspaceId
                            ? 'bg-zinc-800 text-zinc-100'
                            : 'text-zinc-300 hover:bg-zinc-800/60'
                        }`}
                      >
                        <UsersThree size={14} className="text-zinc-500" />
                        <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                        {ws.id === activeWorkspaceId && (
                          <span className="text-[10px] font-medium text-accent">đang dùng</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Join by code */}
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={wsJoinCode}
                onChange={(e) => setWsJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleJoinWorkspace()
                }}
                placeholder="Nhập mã chia sẻ…"
                aria-label="Mã chia sẻ để tham gia"
                className="h-8 min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 font-mono text-[12px] tracking-widest text-zinc-200 placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleJoinWorkspace}
                disabled={!wsJoinCode.trim()}
                className="h-8 rounded-lg bg-accent px-3 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                Tham gia
              </button>
            </div>

            {/* Create a new workspace */}
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={wsNewName}
                onChange={(e) => setWsNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateWorkspace()
                }}
                placeholder="Tên không gian mới…"
                aria-label="Tên không gian mới"
                className="h-8 min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 text-[12px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCreateWorkspace}
                disabled={!wsNewName.trim()}
                className="h-8 rounded-lg border border-border-subtle px-3 text-[12px] font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Tạo
              </button>
            </div>

            {wsMsg && (
              <p
                role="status"
                className={`mt-3 text-[12px] ${wsMsg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {wsMsg.text}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Confirmation dialog for Ctrl+Z undo-purge: shows a preview of the
          block that would be restored to the trash. */}
      {confirmUndoPurge && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmUndoPurge(null) }}
          onKeyDown={(e) => { if (e.key === 'Escape') setConfirmUndoPurge(null) }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Xác nhận hoàn tác xóa"
            className="w-full max-w-sm rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-2xl"
          >
            <h2 className="text-[15px] font-semibold text-zinc-100">Hoàn tác xóa vĩnh viễn?</h2>
            <p className="mt-2 text-[13px] text-zinc-400">
              Block này sẽ được khôi phục về thùng rác và có thể xóa lại hoặc khôi phục từ đó.
            </p>
            {/* Preview card */}
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3">
              <div className="shrink-0 text-zinc-500">
                {(() => {
                  const Icon = blockTypeIcon(confirmUndoPurge.entry.type)
                  return <Icon size={18} />
                })()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-zinc-200">
                  {confirmUndoPurge.entry.title ?? 'Chưa có tiêu đề'}
                </p>
                <p className="text-[12px] text-zinc-500">
                  {confirmUndoPurge.entry.type === 'event' ? 'Sự kiện' : confirmUndoPurge.entry.type === 'note' ? 'Ghi chú' : confirmUndoPurge.entry.type === 'code' ? 'Mã nguồn' : 'Tệp'}
                  {confirmUndoPurge.entry.hadFile && ' · có tệp đính kèm'}
                  {' · '}Xóa {formatTrashDate(confirmUndoPurge.entry.purgedAt)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmUndoPurge(null)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  const entry = confirmUndoPurge.entry
                  setConfirmUndoPurge(null)
                  await undoPurgeBatch([entry.id])
                }}
                className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
              >
                Hoàn tác
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transient feedback for the workspace .ics import. */}
      {icsMsg && (
        <div className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2 text-[12px] text-emerald-400/90 shadow-2xl" role="status">
          {icsMsg}
        </div>
      )}

      {/* Toast notification for the last delete — appears at top-right,
          auto-dismisses after 5 s, and offers Hoàn tác to restore. */}
      {lastDelete && (
        <Toast key="delete-toast" onDismiss={dismissUndo}>
          <div className="flex items-center gap-3">
            <Trash size={15} className="shrink-0 text-red-400" />
            <p className="max-w-xs truncate text-[13px] text-zinc-200">
              Đã xóa{' '}
              <span className="font-medium text-zinc-100">
                {lastDelete.title ?? (lastDelete.blocks.length === 1 ? 'sự kiện' : `${lastDelete.blocks.length} block`)}
              </span>
              {lastDelete.storagePaths.length > 0 && (
                <span className="text-zinc-500"> · {lastDelete.storagePaths.length} tệp không thể khôi phục</span>
              )}
            </p>
            <button
              type="button"
              onClick={undoDelete}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
            >
              Hoàn tác
            </button>
            <button
              type="button"
              onClick={dismissUndo}
              aria-label="Đóng"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X size={13} />
            </button>
          </div>
        </Toast>
      )}
    </main>
  )
}

function EmptyState({ icon: Icon, title, hint }: { icon: React.ElementType; title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface">
        <Icon size={26} className="text-zinc-600" />
      </div>
      <p className="text-[15px] font-medium text-zinc-300">{title}</p>
      <p className="max-w-[36ch] text-[13px] leading-relaxed text-zinc-500">{hint}</p>
    </div>
  )
}

// .ics preview checklist helpers: series-role ordering/labels for the
// per-event rows, plus date formatting for the checklist and history tab.
const ICS_ROLE_RANK: Record<IcsEventRole, number> = {
  master: 0,
  continuation: 1,
  override: 2,
  standalone: 3,
}

const ICS_ROLE_LABELS: Record<IcsEventRole, string> = {
  master: 'Chuỗi gốc',
  continuation: 'Chuỗi tách',
  override: 'Chỉnh sửa một lần',
  standalone: 'Sự kiện riêng',
}

function IcsRoleBadge({ role }: { role: IcsEventRole }) {
  return (
    <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
      {ICS_ROLE_LABELS[role]}
    </span>
  )
}

function formatIcsDate(iso: string | null): string {
  if (!iso) return 'Chưa có ngày'
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split('-').reverse().join('/')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatHistoryDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `Đã nhập ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} lúc ${p(d.getHours())}:${p(d.getMinutes())}`
}

function FileDetail({ block }: { block: Block }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800 font-mono text-sm uppercase text-accent">
        {block.file_extension ?? '?'}
      </div>
      <p className="text-sm font-medium text-zinc-100">{block.title}</p>
      {block.file_extension && (
        <p className="font-mono text-[12px] text-zinc-500">.{block.file_extension}</p>
      )}
      {block.file_url && (
        <a
          href={block.file_url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
        >
          Mở tệp
        </a>
      )}
    </div>
  )
}

function PreviewPane({ block }: { block: Block }) {
  const setActiveRightPane = useWorkspaceStore((state) => state.setActiveRightPane)
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center justify-between border-b border-border-subtle px-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">Xem trước</span>
        <button
          type="button"
          onClick={() => setActiveRightPane('none')}
          aria-label="Đóng pane"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">{block.title ?? 'Chưa có tiêu đề'}</h2>
        {block.type === 'file' && block.file_url ? (
          <Image
            src={block.file_url}
            alt={block.title ?? 'Tệp đính kèm'}
            width={640}
            height={360}
            unoptimized
            className="mt-4 h-auto max-w-full rounded-xl"
          />
        ) : (
          <p className="mt-3 text-[14px] leading-relaxed text-zinc-400">{textPreview(block.content)}</p>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Toast — auto-dismissing notification with optional action button.           */
/* -------------------------------------------------------------------------- */

function Toast({
  children,
  onDismiss,
  durationMs = 5000,
}: {
  children: React.ReactNode
  onDismiss: () => void
  durationMs?: number
}) {
  const [visible, setVisible] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => setVisible(false), durationMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [durationMs])

  // Allow re-dismissing from outside (e.g. the parent re-renders with a new
  // lastDelete after a second delete) by resetting the timer.
  useEffect(() => {
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVisible(false), durationMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [durationMs])

  if (!visible) return null

  return (
    <div
      className="fixed right-4 top-4 z-50 animate-toast-in rounded-xl border border-border-subtle bg-surface-raised px-4 py-3 shadow-2xl backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  )
}
