'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import { Placeholder } from '@tiptap/extensions'
import { LinkSimple, X, Plus, MagnifyingGlass, ArrowUUpLeft, DownloadSimple, UploadSimple } from '@phosphor-icons/react'
import { useBlocksStore } from '@/store/useBlocksStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import EditorToolbar from '@/components/editor/EditorToolbar'
import SlashMenu, { SLASH_OPTIONS } from '@/components/editor/SlashMenu'
import RecurrencePicker from '@/components/editor/RecurrencePicker'
import RecurrenceChoice from '@/components/calendar/RecurrenceChoice'
import { mdToHtml, docToMarkdown, TaskInputRuleExtension } from '@/lib/markdown'
import { MARKDOWN_ITEMS } from '@/lib/markdown-shortcuts'
import { parseRecurrence, occurrenceDates } from '@/lib/recurrence'
import { createOverride, splitSeries } from '@/lib/override'
import { buildIcs, collectSeries, downloadIcs, icsFilename } from '@/lib/ics'
import { importIcs } from '@/lib/ics-import'
import { TextSelection } from '@tiptap/pm/state'
import type { Block } from '@/types'
import type { Editor } from '@tiptap/react'

interface EditorPaneProps {
  block: Block
  onChange: (block: Block, patch: Partial<Block>) => void
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso}T00:00`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// Keep in sync with lib/overlap.ts isAllDayIso: PostgREST normalizes date-only
// 'YYYY-MM-DD' to a UTC-midnight timestamptz, so both shapes mean "all-day".
const isAllDay = (iso: string | null) =>
  iso ? /^\d{4}-\d{2}-\d{2}$/.test(iso) || /T00:00:00(\.\d+)?(Z|[+-]00:00)$/.test(iso) : false

const pad2 = (n: number) => String(n).padStart(2, '0')

function dateOnly(iso: string): string {
  if (isAllDay(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function dateOnlyToISO(date: string): string {
  // Pure YYYY-MM-DD → local-time 09:00 ISO
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0).toISOString()
  // PostgREST-normalized UTC-midnight instant (e.g. "2026-08-21T00:00:00.000Z")
  const utc = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(date)
  if (utc) return new Date(Number(utc[1]), Number(utc[2]) - 1, Number(utc[3]), 9, 0, 0).toISOString()
  return date
}

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Display form for a stored recurrence_exceptions entry: date-only for all-day
// series, otherwise the local date + time.
function formatException(ex: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ex)) {
    const [y, m, d] = ex.split('-').map(Number)
    return `${pad2(d)}/${pad2(m)}/${y}`
  }
  const dt = new Date(ex)
  if (Number.isNaN(dt.getTime())) return ex
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()} · ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`
}

interface SlashState {
  query: string
  pos: { top: number; left: number }
}

/**
 * Re-reads the caret from the live DOM selection when ProseMirror's state
 * selection is stale. PM defers DOM-selection reads to requestAnimationFrame;
 * when rAF is throttled or frozen (background tabs, headless webviews) or
 * during fast native typing, the state caret can lag the real caret. That
 * makes the slash trigger miss (empty text-before-caret) and corrupts the
 * token-deletion math on insert. Syncing the state selection to the DOM caret
 * with an idempotent transaction keeps trigger + insert consistent.
 */
function syncSelectionFromDOM(editor: Editor): void {
  const view = editor.view
  if (!view.editable) return
  const dom = view.dom
  let domPos: number | null = null
  try {
    const domSel = window.getSelection()
    if (domSel && domSel.rangeCount > 0 && domSel.isCollapsed) {
      const range = domSel.getRangeAt(0)
      const end = range.endContainer
      if (dom.contains(end)) {
        domPos = view.posAtDOM(end, range.endOffset, 1)
      }
    }
  } catch {
    domPos = null
  }
  if (domPos === null) return
  const { state } = editor
  const clamped = Math.min(Math.max(domPos, 0), state.doc.content.size)
  const cur = state.selection
  if (cur.empty && cur.from === clamped) return
  try {
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, clamped)))
  } catch {
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(clamped))))
  }
}

function computeSlashState(editor: Editor): SlashState | null {
  const { state, view } = editor
  if (!state.selection.empty) return null
  const { $from } = state.selection
  const parent = $from.parent
  if (parent.type.name === 'codeBlock') return null
  const text = parent.textBetween(0, $from.parentOffset, '')
  const idx = text.lastIndexOf('/')
  if (idx < 0) return null
  if (idx > 0 && !/\s$/.test(text.slice(0, idx))) return null
  const query = text.slice(idx + 1)
  if (query.includes(' ') || query.length > 24) return null
  const coords = view.coordsAtPos($from.pos)
  const domRect = view.dom.getBoundingClientRect()
  return {
    query,
    pos: { top: coords.bottom - domRect.top, left: coords.left - domRect.left },
  }
}

export default function EditorPane({ block, onChange }: EditorPaneProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Source mode is tracked per block id: switching to another block
  // automatically returns to the rich editor without any effect setState.
  const [sourceFor, setSourceFor] = useState<string | null>(null)
  const sourceMode = sourceFor === block.id
  const [sourceText, setSourceText] = useState('')
  const [copied, setCopied] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkHighlight, setLinkHighlight] = useState(0)
  const linkRef = useRef<HTMLDivElement | null>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  // A pending datetime edit on a RECURRING event: held back until the user
  // picks "Chỉ lần này / Tất cả các lần" (never silently edits the whole
  // series). originalStart is the occurrence being edited (the master dtstart).
  const [pendingRecur, setPendingRecur] = useState<{
    patch: { start_time?: string | null; end_time?: string | null }
    originalStart: string | null
  } | null>(null)
  const icsImportRef = useRef<HTMLInputElement>(null)
  const [icsImportMsg, setIcsImportMsg] = useState<string | null>(null)
  // Keyboard shortcut cheatsheet overlay: Ctrl/Cmd + / toggles it, Escape
  // closes it. The listener lives on document (the pane mounts only while a
  // block is open), so the shortcut works from the title, the toolbar, and
  // the editor body alike.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const relations = useBlocksStore((state) => state.relations)
  const blocks = useBlocksStore((state) => state.blocks)
  const attach = useBlocksStore((state) => state.attach)
  const detach = useBlocksStore((state) => state.detach)
  const addBlock = useBlocksStore((state) => state.addBlock)
  const updateBlock = useBlocksStore((state) => state.updateBlock)
  const removeBlock = useBlocksStore((state) => state.removeBlock)
  const beginBatch = useBlocksStore((state) => state.beginBatch)
  const endBatch = useBlocksStore((state) => state.endBatch)

  const children = relations
    .filter((r) => r.parent_id === block.id)
    .map((r) => ({ relation: r, child: blocks.find((b) => b.id === r.child_id) }))
    .filter((x) => x.child)

  const backlinks = relations
    .filter((r) => r.child_id === block.id)
    .map((r) => ({ relation: r, source: blocks.find((b) => b.id === r.parent_id) }))
    .filter((x) => x.source)

  const setSelectedBlock = useWorkspaceStore((state) => state.setSelectedBlock)
  const setActiveRightPane = useWorkspaceStore((state) => state.setActiveRightPane)

  const openBlockInEditor = (id: string) => {
    setSelectedBlock(id)
    setActiveRightPane('editor')
  }

  const filteredSlash = useMemo(() => {
    if (!slash) return []
    const q = slash.query ? norm(slash.query) : ''
    return q === ''
      ? SLASH_OPTIONS
      : SLASH_OPTIONS.filter((opt) => norm(opt.label).includes(q))
  }, [slash])

  // Reset slash menu index when filter changes so it never exceeds bounds.
  useEffect(() => {
    if (slash && slashIndex >= filteredSlash.length) {
      setSlashIndex(Math.max(0, filteredSlash.length - 1))
    }
  }, [filteredSlash.length, slash, slashIndex])

  const candidates = useMemo(() => {
    const q = norm(linkQuery.trim())
    const attached = new Set(relations.filter((r) => r.parent_id === block.id).map((r) => r.child_id))
    return blocks
      .filter(
        (b) =>
          b.id !== block.id &&
          !attached.has(b.id) &&
          (q === '' || (!!b.title && norm(b.title).includes(q))),
      )
      .slice(0, 8)
  }, [blocks, relations, block.id, linkQuery])

  const addLink = async (targetId: string) => {
    if (targetId === block.id) return
    if (relations.some((r) => r.parent_id === block.id && r.child_id === targetId)) {
      setLinkOpen(false)
      return
    }
    try {
      await attach(block.id, targetId, 'attached')
    } finally {
      setLinkOpen(false)
      setLinkQuery('')
      setLinkHighlight(0)
    }
  }

  // Ctrl/Cmd + / toggles the shortcut cheatsheet; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShortcutsOpen(false)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.key.toLowerCase() !== '/') return
      e.preventDefault()
      setShortcutsOpen((o) => !o)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close the add-link popover on outside click / Escape.
  useEffect(() => {
    if (!linkOpen) return
    const onDoc = (e: MouseEvent) => {
      if (linkRef.current && !linkRef.current.contains(e.target as Node)) setLinkOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLinkOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [linkOpen])

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      FontFamily,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskInputRuleExtension,
      Placeholder.configure({
        placeholder: 'Bắt đầu viết ghi chú…',
      }),
    ],
    content: block.content ?? '',
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        onChange(block, { content: editor.getJSON() })
      }, 500)
      refreshSlash()
    },
    onSelectionUpdate: () => refreshSlash(),
  })

  // Sync editor content when the block changes externally (e.g. a quick-note
  // appended on the calendar, a planner task toggle) while the pane is open on
  // the SAME block. Re-keyed on block.content so those edits land; the JSON
  // diff + emitUpdate:false mean typing locally never echoes or resets.
  useEffect(() => {
    if (!editor) return
    const next = block.content ?? ''
    const current = editor.getJSON()
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      editor.commands.setContent(next, { emitUpdate: false })
    }
  }, [editor, block.content])

  const refreshSlash = useCallback(() => {
    if (!editor) return
    if (sourceFor === block.id) {
      setSlash(null)
      return
    }
    syncSelectionFromDOM(editor)
    setSlash(computeSlashState(editor))
  }, [editor, sourceFor, block.id])

  const runSlash = useCallback(
    (indexOverride?: number) => {
      if (!editor || !slash) return
      const opt = filteredSlash[Math.min(indexOverride ?? slashIndex, filteredSlash.length - 1)]
      if (!opt) {
        setSlash(null)
        setSlashIndex(0)
        return
      }
      syncSelectionFromDOM(editor)
      const { state } = editor
      const { $from } = state.selection
      const text = $from.parent.textBetween(0, $from.parentOffset, '')
      const idx = text.lastIndexOf('/')
      const tokenStart = $from.pos - (text.length - idx)
      const chain = opt.insert(
        editor.chain().focus().deleteRange({ from: tokenStart, to: $from.pos }).setParagraph(),
      )
      chain.run()
      setSlash(null)
      setSlashIndex(0)
    },
    [editor, slash, slashIndex, filteredSlash],
  )

  // Slash trigger: recompute on every editor change / caret move.
  useEffect(() => {
    refreshSlash()
  }, [refreshSlash])

  // Intercept ArrowDown/Up/Enter/Escape while the slash menu is open.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onKey = (e: KeyboardEvent) => {
      if (!slash) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % Math.max(filteredSlash.length, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + Math.max(filteredSlash.length, 1)) % Math.max(filteredSlash.length, 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        runSlash()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setSlash(null)
        setSlashIndex(0)
      }
    }
    const onBlur = () => {
      setSlash(null)
      setSlashIndex(0)
    }
    dom.addEventListener('keydown', onKey, true)
    dom.addEventListener('blur', onBlur)
    return () => {
      dom.removeEventListener('keydown', onKey, true)
      dom.removeEventListener('blur', onBlur)
    }
  }, [editor, slash, filteredSlash, slashIndex, runSlash])

  const toggleSource = () => {
    if (!editor) return
    if (!sourceMode) {
      setSourceText(docToMarkdown(editor.getJSON()))
      setSourceFor(block.id)
    } else {
      const html = mdToHtml(sourceText)
      editor.commands.setContent(html)
      onChange(block, { content: editor.getJSON() })
      setSourceFor(null)
    }
  }

  const copyMarkdown = async () => {
    if (!editor) return
    const md = sourceMode ? sourceText : docToMarkdown(editor.getJSON())
    try {
      await navigator.clipboard.writeText(md)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — ignore
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const childId = e.dataTransfer.getData('application/x-block-id')
    if (!childId || childId === block.id) return
    if (relations.some((r) => r.parent_id === block.id && r.child_id === childId)) return
    attach(block.id, childId, 'embedded')
  }

  const allDay = isAllDay(block.start_time)

  const toggleAllDay = (checked: boolean) => {
    const s = block.start_time
    const e = block.end_time
    const patch: Partial<Block> = {}
    if (checked) {
      patch.start_time = s ? dateOnly(s) : todayLocal()
      patch.end_time = e ? dateOnly(e) : null
    } else {
      patch.start_time = s ? dateOnlyToISO(s) : null
      patch.end_time = e ? dateOnlyToISO(e) : null
    }
    onChange(block, patch)
  }

  // "This vs all" for datetime edits: a recurring master must never be silently
  // rescheduled by the editor. Non-recurring edits go straight through.
  const isRecurringMaster = parseRecurrence(block.recurrence) !== null

  // Next five occurrences for the recurring-master section ("5 lần kế tiếp"),
  // from the current instant out to a year (a dense series can't materialize
  // unbounded dates here — it's a bounded expansion like lib/splitSeriesAt).
  const nextOccurrences = useMemo(() => {
    if (!isRecurringMaster || !block.start_time) return []
    const now = new Date()
    return occurrenceDates(block, now, new Date(now.getTime() + 366 * 24 * 3600_000)).slice(0, 5)
  }, [isRecurringMaster, block])

  const handleTimeEdit = (patch: { start_time?: string | null; end_time?: string | null }) => {
    if (!isRecurringMaster) {
      onChange(block, patch)
      return
    }
    setPendingRecur({ patch, originalStart: block.start_time })
  }

  const confirmThis = () => {
    if (!pendingRecur) return
    void createOverride({ addBlock, attach, updateBlock, removeBlock, beginBatch, endBatch }, block, pendingRecur.patch, pendingRecur.originalStart)
    setPendingRecur(null)
  }

  const confirmThisAndFuture = () => {
    if (!pendingRecur) return
    const overrides = blocks.filter((b) =>
      relations.some((r) => r.parent_id === block.id && r.child_id === b.id && r.relation_type === 'attached'),
    )
    void splitSeries({ addBlock, attach, updateBlock, removeBlock, beginBatch, endBatch }, block, pendingRecur.patch, { detach, overrides })
    setPendingRecur(null)
  }

  const confirmAll = () => {
    if (!pendingRecur) return
    onChange(block, pendingRecur.patch)
    setPendingRecur(null)
  }

  // Import a pasted/selected .ics into the workspace: masters, split
  // continuations, and this-occurrence overrides are created through the same
  // store deps the rest of the app uses (relinking via X-FREEBUFF-PARENT).
  const handleImportIcs = async (file: File) => {
    try {
      const text = await file.text()
      const { created } = await importIcs(text, { addBlock, attach })
      setIcsImportMsg(created > 0 ? `Đã nhập ${created} sự kiện` : 'Không thấy sự kiện nào trong tệp')
    } catch {
      setIcsImportMsg('Không đọc được tệp .ics')
    }
    setTimeout(() => setIcsImportMsg(null), 4000)
  }

  // Datetime inputs show the pending edit while the choice modal is open (the
  // block itself is not committed yet), so the typed value stays visible.
  const startIso = pendingRecur?.patch.start_time ?? block.start_time
  const endIso = pendingRecur?.patch.end_time ?? block.end_time

  if (!editor) return null

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {pendingRecur && (
        <RecurrenceChoice
          state={{ title: block.title }}
          onThis={confirmThis}
          onAll={confirmAll}
          onThisAndFuture={confirmThisAndFuture}
          onCancel={() => setPendingRecur(null)}
        />
      )}
      <EditorToolbar
        editor={editor}
        sourceMode={sourceMode}
        onToggleSource={toggleSource}
        onCopyMarkdown={copyMarkdown}
        copied={copied}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <input
          value={block.title ?? ''}
          onChange={(e) => onChange(block, { title: e.target.value })}
          onKeyDown={(e) => {
            // Delete or Backspace on an empty title → move to trash
            if ((e.key === 'Delete' || e.key === 'Backspace') && !block.title?.trim()) {
              e.preventDefault()
              void removeBlock(block.id)
              setActiveRightPane('none')
              setSelectedBlock(null)
            }
          }}
          placeholder="Tiêu đề"
          className="mb-3 w-full bg-transparent text-2xl font-semibold tracking-tight text-zinc-100 outline-none placeholder:text-zinc-600"
        />

        <div className="mb-3 flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Ưu tiên
            </span>
            <select
              value={block.priority ?? 'normal'}
              onChange={(e) => onChange(block, { priority: (e.target.value || null) as Block['priority'] })}
              className="rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[11px] text-zinc-300 outline-none focus:border-accent"
            >
              <option value="urgent">Khẩn cấp</option>
              <option value="high">Cao</option>
              <option value="normal">Bình thường</option>
              <option value="low">Thấp</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Trạng thái
            </span>
            <select
              value={block.status ?? 'draft'}
              onChange={(e) => onChange(block, { status: (e.target.value || null) as Block['status'] })}
              className="rounded-lg border border-border-subtle bg-background px-2 py-1 font-mono text-[11px] text-zinc-300 outline-none focus:border-accent"
            >
              <option value="draft">Nháp</option>
              <option value="pending">Chờ xử lý</option>
              <option value="approved">Đã duyệt</option>
              <option value="rejected">Từ chối</option>
              <option value="completed">Hoàn thành</option>
            </select>
          </label>
        </div>

        {block.type === 'event' && (
          <div className="mb-4 rounded-xl border border-border-subtle bg-surface p-3">
            <div className="flex items-center gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  Bắt đầu
                </span>
                {allDay ? (
                  <input
                    type="date"
                    value={startIso ? startIso.slice(0, 10) : ''}
                    onChange={(e) => handleTimeEdit({ start_time: e.target.value || null, end_time: endIso })}
                    className="rounded-lg border border-border-subtle bg-background px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
                  />
                ) : (
                  <input
                    type="datetime-local"
                    value={toLocalInput(startIso)}
                    onChange={(e) => handleTimeEdit({ start_time: fromLocalInput(e.target.value), end_time: endIso })}
                    className="rounded-lg border border-border-subtle bg-background px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
                  />
                )}
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  Kết thúc
                </span>
                {allDay ? (
                  <input
                    type="date"
                    value={endIso ? endIso.slice(0, 10) : ''}
                    onChange={(e) => handleTimeEdit({ start_time: startIso, end_time: e.target.value || null })}
                    className="rounded-lg border border-border-subtle bg-background px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
                  />
                ) : (
                  <input
                    type="datetime-local"
                    value={toLocalInput(endIso)}
                    onChange={(e) => handleTimeEdit({ start_time: startIso, end_time: fromLocalInput(e.target.value) })}
                    className="rounded-lg border border-border-subtle bg-background px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent"
                  />
                )}
              </label>
            </div>
            <label className="mt-2.5 flex w-fit items-center gap-1.5 text-[12px] text-zinc-400">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => toggleAllDay(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer rounded accent-emerald-500"
              />
              Cả ngày
            </label>
            <RecurrencePicker block={block} onChange={onChange} />
            {nextOccurrences.length > 0 && (
              <div className="mt-2.5 border-t border-border-subtle pt-2.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  5 lần kế tiếp
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {nextOccurrences.map((occ) => {
                    const key = isAllDay(block.start_time) ? occ.toISOString().slice(0, 10) : occ.toISOString()
                    return (
                      <li key={key} className="font-mono text-[11px] text-zinc-400">
                        {formatException(key)}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-2 border-t border-border-subtle pt-2.5">
              {block.start_time && (
                <button
                  type="button"
                  onClick={() => {
                    downloadIcs(icsFilename(block), buildIcs(collectSeries(block, blocks, relations)))
                  }}
                  title="Tải lịch .ics (bao gồm cả chuỗi lặp lại, các lần loại trừ và các chuỗi tách)"
                  className="flex h-7 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-accent/50 hover:text-accent"
                >
                  <DownloadSimple size={12} weight="bold" />
                  Xuất .ics
                </button>
              )}
              <button
                type="button"
                onClick={() => icsImportRef.current?.click()}
                title="Nhập sự kiện từ tệp .ics (chuỗi lặp lại, các lần loại trừ, các chuỗi tách)"
                className="flex h-7 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-accent/50 hover:text-accent"
              >
                <UploadSimple size={12} weight="bold" />
                Nhập .ics
              </button>
              <input
                ref={icsImportRef}
                type="file"
                accept=".ics,text/calendar"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleImportIcs(file)
                  e.target.value = ''
                }}
              />
              {icsImportMsg && (
                <span className="text-[11px] text-emerald-400/90" role="status">
                  {icsImportMsg}
                </span>
              )}
            </div>
            {isRecurringMaster && (block.recurrence_exceptions?.length ?? 0) > 0 && (
              <div className="mt-2.5 border-t border-border-subtle pt-2.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  Lần đã loại trừ
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Các lần này không xuất hiện trong chuỗi. Khôi phục để đưa lần đó trở lại.
                </p>
                <ul className="mt-1.5 space-y-1">
                  {block.recurrence_exceptions!.map((ex) => (
                    <li key={ex} className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-zinc-400">{formatException(ex)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onChange(block, {
                            recurrence_exceptions: block.recurrence_exceptions!.filter((x) => x !== ex),
                          })
                        }
                        aria-label={`Khôi phục lần ${formatException(ex)}`}
                        title="Khôi phục lần này"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-emerald-300"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {sourceMode ? (
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Viết Markdown tại đây…  (# Tiêu đề, **đậm**, - [ ] việc cần làm)"
            aria-label="Nội dung Markdown"
            spellCheck={false}
            className="h-64 w-full resize-y rounded-xl border border-border-subtle bg-background p-3 font-mono text-[13px] leading-relaxed text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-accent"
          />
        ) : (
          <div className="relative">
            <EditorContent
              editor={editor}
              className="tiptap-prose text-[15px] leading-relaxed text-zinc-300"
            />
            {slash && (
              <SlashMenu
                options={filteredSlash}
                index={Math.min(slashIndex, Math.max(filteredSlash.length - 1, 0))}
                top={slash.pos.top}
                left={slash.pos.left}
                onHover={setSlashIndex}
                onSelect={(i) => {
                  setSlashIndex(i)
                  runSlash(i)
                }}
              />
            )}
          </div>
        )}

        <div className="mt-6 space-y-4">
          <div>
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              <LinkSimple size={12} />
              Đã nối ({children.length})
            </p>
            {children.length === 0 ? (
              <p className="mt-1.5 text-[12px] text-zinc-600">
                Kéo một block từ sidebar vào đây để nối, hoặc bấm “Nối block” ở dưới.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {children.map(({ relation, child }) => (
                  <li
                    key={relation.child_id}
                    className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => openBlockInEditor(child!.id)}
                      title="Mở trong trình soạn thảo"
                      className="min-w-0 flex-1 truncate text-left text-[12px] text-zinc-300 transition-colors hover:text-accent"
                    >
                      {child!.title ?? 'Chưa có tiêu đề'}
                    </button>
                    <span className="font-mono text-[10px] uppercase text-zinc-600">
                      {relation.relation_type}
                    </span>
                    <button
                      type="button"
                      onClick={() => detach(block.id, relation.child_id)}
                      aria-label="Gỡ liên kết"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div ref={linkRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setLinkOpen((o) => !o)
                setLinkQuery('')
                setLinkHighlight(0)
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 text-[12px] text-zinc-300 transition-colors hover:border-accent/50 hover:text-zinc-100"
            >
              <Plus size={13} weight="bold" />
              Nối block
            </button>
            {linkOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-border-subtle bg-surface p-1.5 shadow-xl">
                <div className="flex items-center gap-1.5 rounded-lg bg-zinc-800/60 px-2 py-1.5">
                  <MagnifyingGlass size={13} className="text-zinc-500" />
                  <input
                    value={linkQuery}
                    onChange={(e) => {
                      setLinkQuery(e.target.value)
                      setLinkHighlight(0)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setLinkHighlight((h) => Math.min(h + 1, Math.max(candidates.length - 1, 0)))
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setLinkHighlight((h) => Math.max(h - 1, 0))
                      } else if (e.key === 'Enter' && candidates.length > 0) {
                        e.preventDefault()
                        addLink(candidates[Math.min(linkHighlight, candidates.length - 1)].id)
                      } else if (e.key === 'Escape') {
                        setLinkOpen(false)
                      }
                    }}
                    placeholder="Tìm block để nối…"
                    autoFocus
                    className="w-full bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
                  />
                </div>
                <ul className="mt-1 max-h-56 overflow-y-auto">
                  {candidates.length === 0 ? (
                    <li className="px-2 py-2 text-[12px] text-zinc-600">Không có kết quả</li>
                  ) : (
                    candidates.map((b, i) => (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => addLink(b.id)}
                          onMouseEnter={() => setLinkHighlight(i)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                            i === linkHighlight ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate text-[12px]">
                            {b.title ?? 'Chưa có tiêu đề'}
                          </span>
                          <span className="font-mono text-[10px] uppercase text-zinc-600">
                            {b.type}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>

          {backlinks.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                <ArrowUUpLeft size={12} />
                Liên kết ngược ({backlinks.length})
              </p>
              <ul className="mt-2 space-y-1">
                {backlinks.map(({ relation, source }) => (
                  <li
                    key={relation.parent_id}
                    className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5"
                  >
                    <ArrowUUpLeft size={13} className="shrink-0 text-zinc-600" />
                    <button
                      type="button"
                      onClick={() => openBlockInEditor(source!.id)}
                      title="Mở trong trình soạn thảo"
                      className="min-w-0 flex-1 truncate text-left text-[12px] text-zinc-300 transition-colors hover:text-accent"
                    >
                      {source!.title ?? 'Chưa có tiêu đề'}
                    </button>
                    <span className="font-mono text-[10px] uppercase text-zinc-600">
                      {relation.relation_type}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Keyboard shortcut cheatsheet (Ctrl/Cmd + /): the same reference the
          Settings popover shows, without the live previews. */}
      {shortcutsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Phím tắt Markdown"
            className="w-full max-w-md rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-zinc-100">Phím tắt Markdown</h2>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Đóng phím tắt"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X size={15} />
              </button>
            </div>
            <p className="mt-1 text-[12px] text-zinc-500">
              Tạo thành phần Markdown bằng cú pháp thường hoặc phím tắt (Ctrl/Cmd + / để đóng/mở).
            </p>
            <div className="mt-3 max-h-[55vh] space-y-1 overflow-y-auto pr-1">
              {MARKDOWN_ITEMS.map((item) => (
                <div key={item.label} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
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
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
