import type { JSONContent } from '@tiptap/core'

/**
 * Append a quick note as a new paragraph to a block's Tiptap JSON content.
 *
 * Pure: never mutates the input. If `content` is not already a doc-shaped
 * object (e.g. `null`, or a legacy plain string), a fresh doc is created so
 * the note is never lost — calendar blocks are created with `{type:'doc',
 * content:[]}` and edited as Tiptap JSON, so this only matters for unusual
 * rows. A blank note returns the input unchanged.
 */
export function appendNote(content: unknown, text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return content
  const doc = isDoc(content) ? (content as JSONContent) : { type: 'doc', content: [] }
  return {
    ...doc,
    content: [...(doc.content ?? []), { type: 'paragraph', content: [{ type: 'text', text: trimmed }] }],
  }
}

function isDoc(content: unknown): content is JSONContent {
  return (
    !!content &&
    typeof content === 'object' &&
    Array.isArray((content as { content?: unknown }).content) &&
    typeof (content as { type?: unknown }).type === 'string'
  )
}
