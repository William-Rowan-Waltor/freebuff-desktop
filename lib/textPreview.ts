/**
 * Extract a plain-text preview from a Tiptap-like content tree (or a raw
 * string). Used in search results, calendar chips, planner, and today view.
 *
 * The result is collapsed whitespace, trimmed, and capped at `limit`
 * characters (default 160). Returns 'Chưa có nội dung' when empty.
 */
export function textPreview(content: unknown, limit = 160): string {
  if (typeof content === 'string') return content
  const nodes: { type?: string; text?: string; content?: unknown }[] = Array.isArray(content)
    ? content
    : content && typeof content === 'object'
      ? ((content as { content?: unknown[] }).content ?? [])
      : []
  const parts = nodes.flatMap((node) => {
    if (node.type === 'text' && node.text) return [node.text]
    if (node.content) return textPreview(node.content, limit).split('\n')
    return []
  })
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, limit) || 'Chưa có nội dung'
}
