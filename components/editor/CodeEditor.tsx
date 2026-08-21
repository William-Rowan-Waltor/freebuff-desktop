'use client'

import { useRef } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from '@/lib/workers/editor.worker?worker'
import type { Block } from '@/types'

loader.config({ monaco })

self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
}

const LANG_BY_EXT: Record<string, string> = {
  py: 'python',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  rs: 'rust',
  go: 'go',
  java: 'java',
  json: 'json',
  md: 'markdown',
  txt: 'plaintext',
  html: 'html',
  css: 'css',
}

interface CodeEditorProps {
  block: Block
  onChange: (block: Block, patch: Partial<Block>) => void
}

export default function CodeEditor({ block, onChange }: CodeEditorProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">
          {block.file_extension ? `.${block.file_extension}` : 'code'}
        </span>
        <span className="font-mono text-[11px] text-zinc-600">Ctrl+S để lưu</span>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language={LANG_BY_EXT[block.file_extension ?? ''] ?? 'plaintext'}
          value={typeof block.content === 'string' ? block.content : ''}
          theme="vs-dark"
          onChange={(value) => {
            if (saveTimer.current) clearTimeout(saveTimer.current)
            saveTimer.current = setTimeout(() => {
              onChange(block, { content: value ?? '' })
            }, 500)
          }}
          onMount={(editor) => {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              onChange(block, { content: editor.getValue() })
            })
          }}
          options={{
            fontSize: 13,
            fontFamily: 'var(--font-geist-mono)',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 16, bottom: 16 },
            smoothScrolling: true,
            renderLineHighlight: 'none',
            scrollbar: { verticalScrollbarSize: 10 },
            fontLigatures: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  )
}
