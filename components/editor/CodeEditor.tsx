'use client'

import { useEffect, useRef } from 'react'
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
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  dart: 'dart',
  r: 'r',
  lua: 'lua',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  toml: 'ini',
  ini: 'ini',
  dockerfile: 'dockerfile',
}

const LANG_OPTIONS = [
  { value: '', label: 'Tự phát hiện' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'sql', label: 'SQL' },
  { value: 'shell', label: 'Shell/Bash' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'dart', label: 'Dart' },
  { value: 'r', label: 'R' },
  { value: 'lua', label: 'Lua' },
  { value: 'plaintext', label: 'Plain text' },
]

interface CodeEditorProps {
  block: Block
  onChange: (block: Block, patch: Partial<Block>) => void
}

export default function CodeEditor({ block, onChange }: CodeEditorProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup saveTimer on unmount to prevent memory leak (DEV4)
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center justify-between border-b border-border-subtle px-3">
        <select
          value={LANG_BY_EXT[block.file_extension ?? ''] ?? ''}
          onChange={(e) => {
            // Map language name back to file extension
            const ext = Object.entries(LANG_BY_EXT).find(([, lang]) => lang === e.target.value)?.[0] ?? ''
            onChange(block, { file_extension: ext || null })
          }}
          className="rounded border border-border-subtle bg-background px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 outline-none focus:border-accent"
        >
          {LANG_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
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
