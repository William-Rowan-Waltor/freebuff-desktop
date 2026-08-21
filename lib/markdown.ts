import { marked, type Tokens } from 'marked'
import { Extension, InputRule, type JSONContent } from '@tiptap/core'

/**
 * Markdown <-> Tiptap JSON bridge for the Obsidian-style editor.
 *
 * Storage stays JSON; markdown is a transient editing surface.
 * - mdToHtml: markdown text -> HTML, with GFM task lines mapped to
 *   Tiptap-compatible taskList/taskItem markup.
 * - docToMarkdown: Tiptap JSON -> markdown (unsupported marks like color,
 *   font-family and highlight are emitted as inline HTML that `marked`
 *   passes through untouched, so the round-trip is lossless).
 * - taskInputRule: typing `- [ ] ` / `[ ] ` at line start creates a task.
 */

marked.use({
  renderer: {
    list(this: unknown, token: Tokens.List): string {
      const ordered = token.ordered
      const startAtt = ordered && token.start !== 1 ? ` start="${token.start}"` : ''
      const typeAtt = token.items.some((i) => i.task) ? ' data-type="taskList"' : ''
      const tag = ordered ? 'ol' : 'ul'
      const renderer = this as { listitem: (t: Tokens.ListItem) => string }
      const body = token.items.map((item) => renderer.listitem(item)).join('')
      return `<${tag}${startAtt}${typeAtt}>\n${body}</${tag}>\n`
    },
    listitem(this: unknown, token: Tokens.ListItem): string | false {
      if (!token.task) return false // fall back to marked's default rendering
      const checked = token.checked ? 'true' : 'false'
      const parser = this as { parser: { parse: (tokens: Tokens.Generic[], loose?: boolean) => string } }
      const content = parser.parser.parse(token.tokens, !!token.loose).trim()
      const inner = content.startsWith('<') ? content : `<p>${content}</p>`
      return `<li data-type="taskItem" data-checked="${checked}">${inner}</li>\n`
    },
  },
})

export function mdToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string
}

/** Strip dangerous tags and event-handler attributes from HTML to prevent
 *  XSS when rendering via dangerouslySetInnerHTML. Safe for static
 *  content; not a full sanitizer — use DOMPurify if user input ever flows in. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*\/?(?:script|iframe|object|embed|form|input|textarea|select|button)[^>]*>/gi, '')
    .replace(/\bon\w+\s*=["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
}

const FONT_MARKS = new Set(['textStyle', 'highlight'])
const LINK_MARK = 'link'

function renderInline(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === 'hardBreak') return '\n'
      if (node.type === 'horizontalRule') return '---'
      if (node.type === 'text') {
        let t = node.text ?? ''
        const marks = node.marks ?? []
        const style = marks.find((m) => m.type === 'textStyle')
        const highlight = marks.find((m) => m.type === 'highlight')
        const link = marks.find((m) => m.type === LINK_MARK)
        if (marks.some((m) => m.type === 'code')) t = `\`${t}\``
        if (marks.some((m) => m.type === 'bold')) t = `**${t}**`
        if (marks.some((m) => m.type === 'italic')) t = `*${t}*`
        if (marks.some((m) => m.type === 'strike')) t = `~~${t}~~`
        if (highlight) {
          const color = (highlight.attrs as { color?: string } | undefined)?.color
          t = color ? `<mark style="background-color:${color}">${t}</mark>` : `<mark>${t}</mark>`
        }
        if (style) {
          const attrs = (style.attrs ?? {}) as { color?: string; fontFamily?: string }
          const bits: string[] = []
          if (attrs.fontFamily) bits.push(`font-family:${attrs.fontFamily}`)
          if (attrs.color) bits.push(`color:${attrs.color}`)
          if (bits.length > 0) t = `<span style="${bits.join(';')}">${t}</span>`
        }
        if (link) {
          const href = (link.attrs as { href?: string } | undefined)?.href ?? ''
          t = `[${t}](${href})`
        }
        return t
      }
      return ''
    })
    .join('')
}

function renderBlock(node: JSONContent): string {
  const content = node.content ?? []
  switch (node.type) {
    case 'paragraph':
      return renderInline(content)
    case 'heading': {
      const level = (node.attrs?.level as number | undefined) ?? 1
      return `${'#'.repeat(level)} ${renderInline(content)}`
    }
    case 'bulletList':
      return (content as JSONContent[])
        .map((li) => `- ${listItemInline(li)}`)
        .join('\n')
    case 'orderedList':
      return (content as JSONContent[])
        .map((li, i) => `${i + 1}. ${listItemInline(li)}`)
        .join('\n')
    case 'taskList':
      return (content as JSONContent[])
        .map((li) => {
          const checked = li.attrs?.checked === true
          return `- [${checked ? 'x' : ' '}] ${listItemInline(li)}`
        })
        .join('\n')
    case 'blockquote':
      return (content as JSONContent[])
        .map((b) => renderBlock(b).split('\n').map((line) => `> ${line}`).join('\n'))
        .join('\n')
    case 'codeBlock': {
      const lang = (node.attrs?.language as string | undefined) ?? ''
      const text = (content as JSONContent[])
        .map((t) => t.text ?? '')
        .join('')
      return `\`\`\`${lang}\n${text}\n\`\`\``
    }
    case 'horizontalRule':
      return '---'
    default:
      return renderInline(content)
  }
}

function listItemInline(li: JSONContent): string {
  const blocks = li.content ?? []
  if (blocks.length === 0) return ''
  const first = renderBlock(blocks[0])
  const rest = blocks
    .slice(1)
    .map((b) => `  ${renderBlock(b)}`)
    .join('\n')
  return rest ? `${first}\n${rest}` : first
}

export function docToMarkdown(doc: JSONContent): string {
  return (doc.content ?? [])
    .map((node) => renderBlock(node))
    .filter((s) => s !== '')
    .join('\n\n')
}

/**
 * Typing `[ ] ` / `[x] ` (optionally `- [ ] ` / `* [x] `) at the start of a
 * line converts it into an interactive task item. Mirrors the official Tiptap
 * task-list recipe, extended to consume a leading `- `/`* ` marker so the
 * Obsidian muscle-memory syntax works.
 */
function taskInputRule(): InputRule {
  return new InputRule({
    find: /^\s*(?:[-*] )?\[( |x)\]\s$/,
    handler: ({ state, range, match }) => {
      const { schema } = state
      const taskList = schema.nodes.taskList
      const taskItem = schema.nodes.taskItem
      if (!taskList || !taskItem) return null
      const checked = match[2] === 'x'
      // Replace the `[ ] ` / `- [ ] ` text with a complete taskList node. The
      // transaction is dispatched automatically by Tiptap's input-rules plugin.
      const delFrom = Math.max(0, range.from - 1)
      const node = taskList.create(null, taskItem.create({ checked }, schema.nodes.paragraph.create()))
      state.tr.replaceWith(delFrom, range.to, node)
    },
  })
}

/**
 * Tiptap v3 wants extensions (not raw InputRules) in `extensions[]`; this
 * wraps the task input rule so it can be registered alongside the others.
 */
export const TaskInputRuleExtension = Extension.create({
  name: 'taskInputRule',
  addInputRules() {
    return [taskInputRule()]
  },
})

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Mặc định', value: '' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Sans-serif', value: '"Segoe UI", Arial, sans-serif' },
  { label: 'Mono', value: '"Courier New", Consolas, monospace' },
]

export const TEXT_COLORS: { label: string; value: string }[] = [
  { label: 'Mặc định', value: '' },
  { label: 'Đỏ', value: '#ef4444' },
  { label: 'Cam', value: '#f97316' },
  { label: 'Vàng', value: '#eab308' },
  { label: 'Xanh lá', value: '#22c55e' },
  { label: 'Xanh dương', value: '#3b82f6' },
  { label: 'Tím', value: '#8b5cf6' },
  { label: 'Hồng', value: '#ec4899' },
]

export const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: 'Không', value: '' },
  { label: 'Vàng', value: '#fef08a' },
  { label: 'Xanh lá', value: '#bbf7d0' },
  { label: 'Đỏ', value: '#fecaca' },
  { label: 'Xanh dương', value: '#bae6fd' },
  { label: 'Tím', value: '#ddd6fe' },
]

export { FONT_MARKS }
