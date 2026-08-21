'use client'

import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { gsap } from 'gsap'
import {
  CalendarBlank,
  NotePencil,
  Files,
  Plus,
  UploadSimple,
  FileCode,
  FileText,
  FileImage,
  FilePdf,
  FilePy,
  File,
  X,
  Trash,
} from '@phosphor-icons/react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useBlocksStore } from '@/store/useBlocksStore'
import { useCreateBlock } from '@/lib/create'
import type { Block } from '@/types'

const DEFAULT_SIDEBAR_WIDTH = 272
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 480

function fileIcon(extension: string | null) {
  switch (extension?.toLowerCase()) {
    case 'py': return FilePy
    case 'cpp':
    case 'c':
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'rs':
    case 'go': return FileCode
    case 'md':
    case 'txt': return FileText
    case 'pdf': return FilePdf
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp': return FileImage
    default: return File
  }
}

function navIcon(type: Block['type']) {
  switch (type) {
    case 'event': return CalendarBlank
    case 'note': return NotePencil
    case 'code': return FileCode
    default: return File
  }
}

export default function Sidebar() {
  const asideRef = useRef<HTMLElement>(null)
  const resizeRef = useRef<HTMLDivElement>(null)
  // Resizable sidebar width (persisted to localStorage).
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('sidebar-width')
      if (saved) {
        const n = Number(saved)
        if (n >= MIN_SIDEBAR_WIDTH && n <= MAX_SIDEBAR_WIDTH) return n
      }
    } catch { /* ignore */ }
    return DEFAULT_SIDEBAR_WIDTH
  })
  const uploadRef = useRef<HTMLInputElement>(null)
  const isSidebarOpen = useWorkspaceStore((state) => state.isSidebarOpen)
  const setSidebarOpen = useWorkspaceStore((state) => state.setSidebarOpen)
  const setSelectedBlock = useWorkspaceStore((state) => state.setSelectedBlock)
  const setActiveRightPane = useWorkspaceStore((state) => state.setActiveRightPane)
  const blocks = useBlocksStore((state) => state.blocks)
  const removeBlock = useBlocksStore((state) => state.removeBlock)
  const deletedBlocks = useBlocksStore((state) => state.deletedBlocks)
  const { create, upload } = useCreateBlock()
  const [trashDragOver, setTrashDragOver] = useState(false)

  const grouped = useMemo(
    () =>
      blocks.reduce<Record<string, Block[]>>((acc, b) => {
        acc[b.type] = acc[b.type] ?? []
        acc[b.type].push(b)
        return acc
      }, {}),
    [blocks],
  )

  useEffect(() => {
    const aside = asideRef.current
    if (!aside) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ctx = gsap.context(() => {
      if (reduce) {
        gsap.set(aside, { x: isSidebarOpen ? 0 : -sidebarWidth, visibility: isSidebarOpen ? 'visible' : 'hidden' })
        return
      }
      gsap.to(aside, {
        x: isSidebarOpen ? 0 : -sidebarWidth,
        visibility: isSidebarOpen ? 'visible' : 'hidden',
        duration: 0.45,
        ease: 'power3.inOut',
      })
    }, aside)

    return () => ctx.revert()
  }, [isSidebarOpen, sidebarWidth])

  const openBlock = useCallback(
    (block: Block) => {
      setSelectedBlock(block.id)
      setActiveRightPane('editor')
    },
    [setSelectedBlock, setActiveRightPane],
  )

  const handleCreateNote = useCallback(async () => {
    await create('note')
  }, [create])

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      await upload(files)
    },
    [upload],
  )

  return (
    <aside
      ref={asideRef}
      className="fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border-subtle bg-surface"
      style={{ width: sidebarWidth, transform: `translateX(-${sidebarWidth}px)`, visibility: 'hidden' }}
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-border-subtle px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <CalendarBlank size={16} weight="fill" />
        </div>
        <h1 className="text-sm font-semibold tracking-tight text-zinc-100">Workspace</h1>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Đóng sidebar"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        <button
          type="button"
          onClick={handleCreateNote}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-foreground transition-transform active:scale-[0.98] hover:bg-accent-strong"
        >
          <Plus size={15} weight="bold" />
          Ghi chú
        </button>
        <button
          type="button"
          onClick={() => uploadRef.current?.click()}
          aria-label="Tải file lên"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 active:scale-[0.98]"
        >
          <UploadSimple size={16} />
        </button>
        <input
          ref={uploadRef}
          type="file"
          multiple
          hidden
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        {(['event', 'note', 'file', 'code'] as Block['type'][]).map((type) => {
          const items = grouped[type] ?? []
          if (items.length === 0) return null
          const Icon = navIcon(type)
          return (
            <section key={type}>
              <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                {type === 'event' ? 'Lịch' : type === 'note' ? 'Ghi chú' : type === 'code' ? 'Mã nguồn' : 'Tệp'}
              </p>
              <ul className="space-y-0.5">
                {items.map((block) => {
                  const IconFile = block.type === 'file' ? fileIcon(block.file_extension) : Icon
                  return (
                    <li key={block.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        draggable
                        onClick={() => openBlock(block)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBlock(block) } }}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-block-id', block.id)
                          // Create a custom drag preview card
                          const ghost = document.createElement('div')
                          ghost.className = 'fixed -left-[9999px] -top-[9999px] flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2 shadow-2xl backdrop-blur-sm'
                          ghost.innerHTML = `
                            <svg width="14" height="14" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M216,120H168V88a8,8,0,0,0-8-8H96V40a8,8,0,0,0-8-8H40A8,8,0,0,0,32,40V216a8,8,0,0,0,8,8H96V176h40v40h72a8,8,0,0,0,8-8V128A8,8,0,0,0,216,120Z" fill="currentColor" opacity="0.4"/>
                            </svg>
                            <span style="font-size:12px;font-weight:500;color:#e4e4e7;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${block.title ?? 'Chưa có tiêu đề'}</span>
                            <span style="font-size:10px;color:#71717a;margin-left:4px;">${block.type}</span>
                          `
                          document.body.appendChild(ghost)
                          e.dataTransfer.setDragImage(ghost, 0, 0)
                          // Clean up after a tick so the browser captures the image
                          setTimeout(() => ghost.remove(), 0)
                        }}
                        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        <IconFile size={15} className="shrink-0 text-zinc-500 group-hover:text-zinc-400" />
                        <span className="truncate">{block.title ?? 'Chưa có tiêu đề'}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void removeBlock(block.id)
                          }}
                          aria-label={`Xóa ${block.title ?? 'block'}`}
                          className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash size={12} />
                        </button>
                        {block.file_extension && (
                          <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                            .{block.file_extension}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}

        {blocks.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
            <Files size={28} className="text-zinc-700" />
            <p className="text-[13px] text-zinc-500">
              Không có dữ liệu. Bấm <span className="text-accent">Ghi chú</span> hoặc tải file lên để bắt đầu.
            </p>
          </div>
        )}
      </div>

      {/* Trash drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setTrashDragOver(true)
        }}
        onDragLeave={() => setTrashDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setTrashDragOver(false)
          const blockId = e.dataTransfer.getData('application/x-block-id')
          if (blockId) void removeBlock(blockId)
        }}
        className={`flex items-center justify-center gap-2 border-t border-border-subtle px-3 py-3 text-[12px] font-medium transition-all ${
          trashDragOver
            ? 'border-red-500/50 bg-red-500/10 text-red-400'
            : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-400'
        }`}
      >
        <Trash size={14} weight={trashDragOver ? 'fill' : 'regular'} />
        {trashDragOver ? 'Thả để xóa' : 'Thùng rác'}
        {!trashDragOver && deletedBlocks.length > 0 && (
          <span className="ml-auto rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-red-400">
            {deletedBlocks.length}
          </span>
        )}
      </div>
      {/* Resize handle — right edge of sidebar */}
      <div
        ref={resizeRef}
        role="separator"
        aria-label="Kéo để chỉnh kích thước sidebar"
        onMouseDown={(e) => {
          e.preventDefault()
          const startX = e.clientX
          const startW = sidebarWidth
          const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX
            const newW = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startW + dx))
            setSidebarWidth(newW)
          }
          const onUp = () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            try { localStorage.setItem('sidebar-width', String(sidebarWidth)) } catch { /* ignore */ }
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        }}
        className="absolute right-0 top-0 z-50 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent/50"
      />
    </aside>
  )
}
