// Shared Markdown quick-reference for the editor: how to create each markdown
// component with ordinary syntax and/or a keyboard shortcut. Shortcuts follow
// Tiptap's StarterKit defaults (Mod = Ctrl on Windows/Linux, Cmd on macOS).
// `preview` is the markdown fed to mdToHtml for live previews (defaults to
// syntax); items without markdown (shortcut-only) get no preview.
export const MARKDOWN_ITEMS: {
  label: string
  syntax: string | null
  shortcut: string | null
  preview?: string
}[] = [
  { label: 'Tiêu đề', syntax: '# Văn bản', shortcut: 'Ctrl/Cmd + Alt + 1' },
  { label: 'Đậm', syntax: '**Văn bản**', shortcut: 'Ctrl/Cmd + B' },
  { label: 'Nghiêng', syntax: '*Văn bản*', shortcut: 'Ctrl/Cmd + I' },
  { label: 'Gạch ngang', syntax: '~~Văn bản~~', shortcut: 'Ctrl/Cmd + Shift + X' },
  { label: 'Mã trong dòng', syntax: '`mã`', shortcut: 'Ctrl/Cmd + E' },
  { label: 'Danh sách gạch đầu dòng', syntax: '- Mục', shortcut: 'Ctrl/Cmd + Shift + 8' },
  { label: 'Danh sách đánh số', syntax: '1. Mục', shortcut: 'Ctrl/Cmd + Shift + 7' },
  { label: 'Việc cần làm', syntax: '- [ ] Việc', shortcut: null },
  { label: 'Trích dẫn', syntax: '> Văn bản', shortcut: 'Ctrl/Cmd + Shift + B' },
  { label: 'Khối mã', syntax: '```', shortcut: 'Ctrl/Cmd + Alt + C', preview: '```\nMã nguồn\n```' },
  { label: 'Đường kẻ ngang', syntax: '---', shortcut: 'Ctrl/Cmd + Alt + -' },
  { label: 'Hoàn tác / Làm lại', syntax: null, shortcut: 'Ctrl/Cmd + Z / Ctrl/Cmd + Shift + Z' },
]
