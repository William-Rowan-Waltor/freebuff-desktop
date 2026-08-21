// iCal (RFC 5545) export for events and recurring series.
//
// The app stores recurrence as a bare RRULE string on the master block, plus a
// `recurrence_exceptions` list and `attached` relations for this-occurrence
// overrides and this-and-future split continuations. buildIcs turns that graph
// into a standards-shaped VCALENDAR:
//
//   - the master becomes one VEVENT with RRULE + EXDATE;
//   - each split continuation (a recurring 'attached' child) becomes its own
//     VEVENT with its own RRULE + EXDATE — it is its own series;
//   - this-occurrence overrides (non-recurring 'attached' children with a
//     start time) become one-off VEVENTs; the master's EXDATE already excludes
//     the original occurrence they replace.
//
// Overrides and continuations carry X-FREEBUFF-PARENT:<master-uid> so
// importIcs (lib/ics-import.ts) relinks them exactly instead of guessing from
// dates.
//
// Timed values export as UTC instants (YYYYMMDDTHHMMSSZ); all-day shapes
// (date-only or the PostgREST UTC-midnight normalization, per isAllDayIso)
// export as VALUE=DATE calendar days.
import { isAllDayIso } from '@/lib/overlap'
import { isRecurring } from '@/lib/recurrence'
import type { Block, BlockRelation } from '@/types'

const PRODUCT_ID = '-//Freebuff//Recurring Events//EN'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** RFC 5545 §3.3.11 text escaping: backslash, semicolon, comma, newline. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Extract the full text of a block's Tiptap JSON content (paragraphs joined
 * with newlines, hard breaks preserved). Used for the X-FREEBUFF-NOTE
 * property so per-occurrence quick notes survive .ics export/import.
 */
export function docText(content: unknown): string {
  if (typeof content === 'string') return content
  const nodes: { type?: string; text?: string; content?: unknown }[] = Array.isArray(content)
    ? content
    : content && typeof content === 'object'
      ? ((content as { content?: unknown[] }).content ?? [])
      : []
  const parts = nodes.flatMap((node) => {
    if (node.type === 'text' && node.text) return [node.text]
    if (node.type === 'hardBreak') return ['\n']
    if (node.content) return docText(node.content).split('\n')
    return []
  })
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Format a stored date value for iCal; allDay marks the VALUE=DATE form. */
export function formatIcsDate(value: string): { text: string; allDay: boolean } {
  if (isAllDayIso(value)) {
    return { text: value.slice(0, 10).replace(/-/g, ''), allDay: true }
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return { text: value, allDay: false }
  return {
    text:
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
      `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`,
    allDay: false,
  }
}

/**
 * Normalize a stored RRULE string to iCal form: trim parts, uppercase, and
 * collapse any human-form UNTIL (with dashes/colons) into the compact
 * YYYYMMDDTHHMMSSZ shape iCal requires.
 */
export function normalizeIcsRule(rule: string): string {
  return rule
    .split(';')
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq === -1) return part
      const key = part.slice(0, eq)
      const value = part.slice(eq + 1)
      return key === 'UNTIL' ? `UNTIL=${value.replace(/[-:]/g, '')}` : part
    })
    .join(';')
}

/** Fold a line at 75 octets per RFC 5545 §3.1 (CRLF + single-space continue). */
export function foldIcsLine(line: string): string {
  const out: string[] = []
  for (let i = 0; i < line.length; i += 75) out.push(line.slice(i, i + 75))
  return out.join('\r\n ')
}

export interface IcsSeries {
  master: Block
  /** Split continuations (recurring 'attached' children) — each its own series. */
  continuations: { block: Block; parentUid: string }[]
  /** This-occurrence overrides (non-recurring 'attached' children with a start). */
  overrides: { block: Block; parentUid: string }[]
}

/**
 * Collect the export shape of a series from the store's flat lists. Walks
 * 'attached' relations recursively: recurring children are split
 * continuations (their own series, with their own overrides collected too),
 * non-recurring children with a start_time are one-off overrides. Each child
 * records the UID of the block it hangs off, so the .ics can relink it on
 * import. Genuine attachments (notes/files) have no start_time and are
 * skipped.
 */
export function collectSeries(block: Block, blocks: Block[], relations: BlockRelation[]): IcsSeries {
  const continuations: { block: Block; parentUid: string }[] = []
  const overrides: { block: Block; parentUid: string }[] = []
  const visit = (parent: Block) => {
    for (const r of relations) {
      if (r.parent_id !== parent.id || r.relation_type !== 'attached') continue
      const child = blocks.find((b) => b.id === r.child_id)
      if (!child) continue
      if (isRecurring(child)) {
        continuations.push({ block: child, parentUid: `${parent.id}@freebuff` })
        visit(child)
      } else if (child.start_time) {
        overrides.push({ block: child, parentUid: `${parent.id}@freebuff` })
      }
    }
  }
  visit(block)
  return { master: block, continuations, overrides }
}

/**
 * One VEVENT for a block. Series blocks carry RRULE + EXDATE; one-off
 * overrides carry just their own start/end. All-day DTEND is emitted with
 * VALUE=DATE using the stored end (FullCalendar's all-day end is already the
 * exclusive next day), bumped one day if it is absent or not strictly after
 * the start so the half-open [start, end) convention always holds.
 */
function veventLines(block: Block, rrule: string | null, parentUid: string | null): string[] {
  const lines: string[] = ['BEGIN:VEVENT']
  lines.push(`UID:${block.id}@freebuff`)
  if (parentUid) lines.push(`X-FREEBUFF-PARENT:${parentUid}`)
  const now = formatIcsDate(new Date().toISOString())
  lines.push(`DTSTAMP:${now.text}`)
  if (block.start_time) {
    const start = formatIcsDate(block.start_time)
    lines.push(start.allDay ? `DTSTART;VALUE=DATE:${start.text}` : `DTSTART:${start.text}`)
    if (block.end_time) {
      const end = formatIcsDate(block.end_time)
      if (start.allDay) {
        let endText = end.text
        if (!end.allDay || end.text <= start.text) {
          const d = new Date(`${block.start_time.slice(0, 10)}T00:00:00Z`)
          d.setUTCDate(d.getUTCDate() + 1)
          endText = formatIcsDate(d.toISOString()).text
        }
        lines.push(`DTEND;VALUE=DATE:${endText}`)
      } else if (end.text > start.text) {
        lines.push(`DTEND:${end.text}`)
      }
    }
  }
  if (block.title) lines.push(`SUMMARY:${escapeIcsText(block.title)}`)
  // Per-occurrence notes: the block's own content (a quick note lands in the
  // override's content) round-trips through X-FREEBUFF-NOTE so a workspace
  // migration keeps the notes. Empty content emits nothing.
  const note = docText(block.content)
  if (note) lines.push(`X-FREEBUFF-NOTE:${escapeIcsText(note)}`)
  // File references travel as URLs (the .ics never carries bytes), so on
  // import a reference is dangling unless a live file block in the target
  // workspace has the same URL — the importer reports them and the UI offers
  // to clear the link.
  if (block.file_url) lines.push(`X-FREEBUFF-FILE:${escapeIcsText(block.file_url)}`)
  if (block.file_extension) lines.push(`X-FREEBUFF-FILE-EXT:${escapeIcsText(block.file_extension)}`)
  if (rrule) lines.push(`RRULE:${rrule}`)
  const exdates = (block.recurrence_exceptions ?? []).map((ex) => formatIcsDate(ex).text)
  if (exdates.length > 0) lines.push(`EXDATE:${exdates.join(',')}`)
  lines.push('END:VEVENT')
  return lines
}

/**
 * Build the full VCALENDAR text for a series: the master VEVENT (with RRULE
 * when recurring), one VEVENT per split continuation (own rule), and one per
 * this-occurrence override.
 */
export function buildIcs(series: IcsSeries): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
  ]
  lines.push(
    ...veventLines(
      series.master,
      isRecurring(series.master) ? normalizeIcsRule(series.master.recurrence!) : null,
      null,
    ),
  )
  for (const { block: cont, parentUid } of series.continuations) {
    lines.push(...veventLines(cont, normalizeIcsRule(cont.recurrence!), parentUid))
  }
  for (const { block: ov, parentUid } of series.overrides) {
    lines.push(...veventLines(ov, null, parentUid))
  }
  lines.push('END:VCALENDAR')
  // Fold each physical line at 75 octets, then join with CRLF.
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

/**
 * Build a VCALENDAR for the whole workspace (event migration path). Roots are
 * event blocks that are not 'attached' children of another event; each root's
 * series tree (recurring masters + split continuations + this-occurrence
 * overrides) is exported exactly once. Notes/files have no iCal
 * representation and are skipped.
 *
 * Pass includeIds to scope the export to a subset (the Đã nhập history
 * re-export): only those blocks' series trees are emitted, and relations only
 * count when BOTH endpoints are in the set — a master deleted after import
 * leaves its surviving split continuation as its own root, and an orphaned
 * override exports standalone.
 */
export function buildWorkspaceIcs(
  blocks: Block[],
  relations: BlockRelation[],
  includeIds?: ReadonlySet<string>,
): string {
  const scopedBlocks = includeIds ? blocks.filter((b) => includeIds.has(b.id)) : blocks
  const scopedRelations = includeIds
    ? relations.filter(
        (r) =>
          scopedBlocks.some((b) => b.id === r.parent_id) && scopedBlocks.some((b) => b.id === r.child_id),
      )
    : relations
  const attachedChildren = new Set(
    scopedRelations.filter((r) => r.relation_type === 'attached').map((r) => r.child_id),
  )
  const roots = scopedBlocks.filter(
    (b) => b.type === 'event' && b.start_time && !attachedChildren.has(b.id),
  )
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
  ]
  for (const root of roots) {
    const series = collectSeries(root, scopedBlocks, scopedRelations)
    lines.push(...veventLines(root, isRecurring(root) ? normalizeIcsRule(root.recurrence!) : null, null))
    for (const { block: cont, parentUid } of series.continuations) {
      lines.push(...veventLines(cont, normalizeIcsRule(cont.recurrence!), parentUid))
    }
    for (const { block: ov, parentUid } of series.overrides) {
      lines.push(...veventLines(ov, null, parentUid))
    }
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

/** Slug the block title into a safe .ics filename. */
export function icsFilename(block: Block): string {
  const base =
    (block.title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'event'
  return `${base}.ics`
}

/** Trigger a browser download of the generated calendar file. */
export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
