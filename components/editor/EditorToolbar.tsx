'use client'

import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  TextB,
  TextItalic,
  TextUnderline,
  TextStrikethrough,
  Code,
  ListBullets,
  ListNumbers,
  ListChecks,
  Quotes,
  Minus,
  LinkSimple,
  Eraser,
  ClipboardText,
  MarkdownLogo,
  Keyboard,
  X,
} from '@phosphor-icons/react'
import { FONT_OPTIONS, TEXT_COLORS, HIGHLIGHT_COLORS } from '@/lib/markdown'

interface EditorToolbarProps {
  editor: Editor | null
  sourceMode: boolean
  onToggleSource: () => void
  onCopyMarkdown: () => void
  copied: boolean
  onOpenShortcuts: () => void
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
  title,
}: {
  active?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
        active
          ? 'bg-accent/20 text-accent'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-4 w-px shrink-0 bg-border-subtle" />
}

export default function EditorToolbar({
  editor,
  sourceMode,
  onToggleSource,
  onCopyMarkdown,
  copied,
  onOpenShortcuts,
}: EditorToolbarProps) {
  if (!editor) return null

  const [linkModal, setLinkModal] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    setLinkUrl(previous ?? 'https://')
    setLinkModal(true)
  }

  const confirmLink = () => {
    if (linkUrl === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
    }
    setLinkModal(false)
    setLinkUrl('')
  }

  const fontFamily = (editor.getAttributes('textStyle').fontFamily as string | undefined) ?? ''

  return (
    <>
    <div className="border-b border-border-subtle px-2 py-1.5">
      {/* Row 1 — mode (always) */}
      <div className="flex flex-wrap items-center gap-0.5">
        <ToolbarButton
          active={sourceMode}
          onClick={onToggleSource}
          label={sourceMode ? 'Thoát chế độ Markdown' : 'Chế độ Markdown'}
          title="Chế độ Markdown (soạn thảo mã nguồn)"
        >
          <MarkdownLogo size={16} weight={sourceMode ? 'fill' : 'regular'} />
        </ToolbarButton>
        <ToolbarButton active={copied} onClick={onCopyMarkdown} label="Chép dạng Markdown" title="Chép nội dung dạng Markdown">
          <ClipboardText size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={onOpenShortcuts}
          label="Phím tắt Markdown"
          title="Phím tắt Markdown (Ctrl/Cmd + /)"
        >
          <Keyboard size={16} />
        </ToolbarButton>
      </div>

      {!sourceMode && (
        <>
          {/* Row 2 — block tools */}
          <div className="mt-1 flex flex-wrap items-center gap-0.5">
            <Divider />
            <ToolbarButton
              active={editor.isActive('heading', { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              label="Tiêu đề 1"
            >
              <span className="text-[13px] font-bold">H1</span>
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              label="Tiêu đề 2"
            >
              <span className="text-[13px] font-bold">H2</span>
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('heading', { level: 3 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              label="Tiêu đề 3"
            >
              <span className="text-[13px] font-bold">H3</span>
            </ToolbarButton>
            <Divider />
            <ToolbarButton
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              label="Danh sách gạch đầu dòng"
            >
              <ListBullets size={16} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              label="Danh sách đánh số"
            >
              <ListNumbers size={16} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('taskList')}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              label="Danh sách việc cần làm"
            >
              <ListChecks size={16} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              label="Trích dẫn"
            >
              <Quotes size={16} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              label="Khối mã nguồn"
            >
              <Code size={16} />
            </ToolbarButton>
            <ToolbarButton label="Đường kẻ ngang" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
              <Minus size={16} />
            </ToolbarButton>
          </div>

          {/* Row 3 — inline marks + style */}
          <div className="mt-1 flex flex-wrap items-center gap-0.5">
            <ToolbarButton
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              label="Đậm"
            >
              <TextB size={16} weight="bold" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              label="Nghiêng"
            >
              <TextItalic size={16} weight="bold" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              label="Gạch chân"
            >
              <TextUnderline size={16} weight="bold" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              label="Gạch ngang"
            >
              <TextStrikethrough size={16} weight="bold" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
              label="Mã nguồn trong dòng"
            >
              <Code size={16} />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('link')} onClick={setLink} label="Liên kết">
              <LinkSimple size={16} />
            </ToolbarButton>
            <Divider />

            <select
              value={fontFamily}
              onChange={(e) => {
                const v = e.target.value
                if (v) editor.chain().focus().setFontFamily(v).run()
                else editor.chain().focus().unsetFontFamily().run()
              }}
              aria-label="Phông chữ"
              title="Phông chữ"
              className="h-8 rounded-lg border border-border-subtle bg-background px-2 text-[12px] text-zinc-300 outline-none focus:border-accent"
            >
              {FONT_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value} style={opt.value ? { fontFamily: opt.value } : undefined}>
                  {opt.label}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 px-1" role="group" aria-label="Màu chữ">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  title={`Màu chữ: ${c.label}`}
                  aria-label={`Màu chữ: ${c.label}`}
                  onClick={() => {
                    if (c.value) editor.chain().focus().setColor(c.value).run()
                    else editor.chain().focus().unsetColor().run()
                  }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full border transition-transform hover:scale-110 ${
                    editor.isActive('textStyle', { color: c.value })
                      ? 'border-accent ring-1 ring-accent'
                      : 'border-zinc-700'
                  }`}
                  style={c.value ? { backgroundColor: c.value } : undefined}
                >
                  {!c.value && <span className="text-[10px] font-bold text-zinc-500">A</span>}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 px-1" role="group" aria-label="Tô nền">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  title={`Tô nền: ${c.label}`}
                  aria-label={`Tô nền: ${c.label}`}
                  onClick={() => {
                    if (c.value) editor.chain().focus().setHighlight({ color: c.value }).run()
                    else editor.chain().focus().unsetHighlight().run()
                  }}
                  className={`flex h-6 w-6 items-center justify-center rounded-md border transition-transform hover:scale-110 ${
                    editor.isActive('highlight', { color: c.value })
                      ? 'border-accent ring-1 ring-accent'
                      : 'border-zinc-700'
                  }`}
                  style={c.value ? { backgroundColor: c.value } : undefined}
                >
                  {!c.value && <Eraser size={12} className="text-zinc-500" />}
                </button>
              ))}
            </div>

            <Divider />
            <ToolbarButton
              label="Xóa định dạng"
              onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
            >
              <Eraser size={16} />
            </ToolbarButton>
          </div>
        </>
      )}
    </div>

      {/* Link modal */}
      {linkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Chèn liên kết"
            className="w-full max-w-sm rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-zinc-100">Chèn liên kết</h3>
              <button
                type="button"
                onClick={() => setLinkModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X size={14} />
              </button>
            </div>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmLink() }}
              placeholder="https://example.com"
              autoFocus
              className="mt-3 w-full rounded-lg border border-border-subtle bg-background px-3 py-2 text-[13px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-accent"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLinkModal(false)}
                className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-400 hover:bg-zinc-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={confirmLink}
                className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground hover:bg-accent-strong"
              >
                {linkUrl ? 'Áp dụng' : 'Xóa liên kết'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
