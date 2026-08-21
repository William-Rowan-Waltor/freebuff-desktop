import { docToMarkdown } from '@/lib/markdown'
import type { Block } from '@/types'

/**
 * Export a block as PDF using the browser's print dialog.
 * Opens a new window with formatted HTML content and triggers print.
 */
export function exportBlockAsPdf(block: Block): void {
  const md = docToMarkdown(block.content as any ?? { type: 'doc', content: [] })
  const title = block.title ?? 'Untitled'
  const now = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 24px; border-bottom: 1px solid #eee; padding-bottom: 12px; }
    .content { white-space: pre-wrap; font-size: 14px; }
    .tags { margin-top: 16px; }
    .tag { display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-right: 4px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    Xuất ngày: ${escapeHtml(now)}${block.priority ? ` · Ưu tiên: ${block.priority}` : ''}${block.status ? ` · Trạng thái: ${block.status}` : ''}
  </div>
  <div class="content">${escapeHtml(md)}</div>
  ${block.tags ? `<div class="tags">${block.tags.split(',').filter(Boolean).map((t) => `<span class="tag">${escapeHtml(t.trim())}</span>`).join('')}</div>` : ''}
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) {
    alert('Trình duyệt đã chặn popup. Hãy cho phép popup cho trang này.')
    return
  }
  win.document.write(html)
  win.document.close()
  // Small delay to ensure content renders before print
  setTimeout(() => win.print(), 200)
}

/**
 * Export all notes as a single PDF (multi-page).
 */
export function exportNotesAsPdf(blocks: Block[]): void {
  const notes = blocks.filter((b) => b.type === 'note' || b.type === 'code')
  if (notes.length === 0) {
    alert('Không có ghi chú nào để xuất.')
    return
  }

  const now = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const pages = notes.map((block) => {
    const md = docToMarkdown(block.content as any ?? { type: 'doc', content: [] })
    const title = block.title ?? 'Untitled'
    return `
      <div class="page">
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">
          ${block.priority ? `Ưu tiên: ${block.priority} · ` : ''}${block.status ? `Trạng thái: ${block.status}` : ''}
        </div>
        <div class="content">${escapeHtml(md)}</div>
        ${block.tags ? `<div class="tags">${block.tags.split(',').filter(Boolean).map((t) => `<span class="tag">${escapeHtml(t.trim())}</span>`).join('')}</div>` : ''}
      </div>
    `
  }).join('\n      <hr class="page-break" />\n')

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Dresplace - Ghi chú</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; line-height: 1.6; }
    .header { text-align: center; margin-bottom: 32px; }
    .header h1 { font-size: 28px; margin-bottom: 4px; }
    .header .date { color: #666; font-size: 12px; }
    .page { page-break-inside: avoid; margin-bottom: 24px; }
    .page h1 { font-size: 20px; margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
    .meta { color: #666; font-size: 11px; margin-bottom: 12px; }
    .content { white-space: pre-wrap; font-size: 13px; }
    .tags { margin-top: 8px; }
    .tag { display: inline-block; background: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 4px; font-size: 10px; margin-right: 4px; }
    .page-break { border: none; border-top: 1px dashed #ccc; margin: 24px 0; }
    @media print { body { padding: 0; } .page-break { page-break-after: always; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Dresplace — Ghi chú</h1>
    <div class="date">Xuất ngày: ${escapeHtml(now)} · ${notes.length} ghi chú</div>
  </div>
  <div class="pages">
    ${pages}
  </div>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) {
    alert('Trình duyệt đã chặn popup. Hãy cho phép popup cho trang này.')
    return
  }
  win.document.write(html)
  win.document.close()
  setTimeout(() => win.print(), 200)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
