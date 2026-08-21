// iCal (RFC 5545) import: parse a .ics file into the app's block/relation
// shapes and create the blocks through the same store deps the app uses.
//
// Round-trips the exporter in lib/ics.ts: the exporter marks this-occurrence
// overrides and split continuations with X-FREEBUFF-PARENT:<master-uid>, so
// import rebuilds the 'attached' relations exactly (continuations keep their
// own RRULE; overrides become one-off children while the master's EXDATE keeps
// excluding the original occurrence). For external files without that marker,
// a one-off event whose dtstart exactly matches one of a master's EXDATEs is
// still linked as an override; everything else becomes standalone blocks.
import type { Block, BlockInput, RelationType } from '@/types'

export interface ParsedEvent {
  uid: string
  summary: string | null
  /** ISO instant (timed) or 'YYYY-MM-DD' (all-day), matching app storage. */
  dtstart: string | null
  dtend: string | null
  /** Normalized RRULE string (no DTSTART), or null for one-offs. */
  rrule: string | null
  /** App-shaped exceptions (ISO instants / date-only). */
  exdates: string[]
  /** UID of the master this event belongs to (X-FREEBUFF-PARENT), if any. */
  parentUid: string | null
  /** Per-occurrence note text (X-FREEBUFF-NOTE), unescaped. */
  note: string | null
  /** File reference (X-FREEBUFF-FILE URL) + extension, unescaped. */
  fileUrl: string | null
  fileExt: string | null
}

/** RFC 5545 §3.3.11 text unescaping (inverse of escapeIcsText). */
function unescapeIcsText(value: string): string {
  return value
    .replace(/\\\\/g, '\u0000')
    .replace(/\\n/gi, '\n')
    .replace(/\\;/g, ';')
    .replace(/\\,/g, ',')
    .replace(/\u0000/g, '\\')
}

/** Unfold RFC 5545 lines: a continuation starts with a space or tab. */
function unfold(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/)
  const out: string[] = []
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length > 0) {
      out[out.length - 1] += line.replace(/^[ \t]/, '')
    } else if (line.trim()) {
      out.push(line.trimEnd())
    }
  }
  return out
}

/**
 * Parse a date-time value into the app's storage shapes: 'YYYY-MM-DD' for
 * all-day (bare date, VALUE=DATE, or UTC midnight), else an ISO instant.
 * Floating times (no zone) are treated as UTC, matching the exporter.
 */
export function parseIcsDateTime(value: string): { iso: string; allDay: boolean } {
  const v = value.trim().toUpperCase()
  const bare = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (bare) return { iso: `${bare[1]}-${bare[2]}-${bare[3]}`, allDay: true }
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})?$/.exec(v)
  if (!full) return { iso: value, allDay: false }
  const [, y, mo, day, h, mi, sec, tz] = full
  const time = `${y}-${mo}-${day}T${h}:${mi}:${sec ?? '00'}`
  // UTC midnight is all-day in the app's convention (isAllDayIso).
  if (h === '00' && mi === '00' && (sec ?? '00') === '00' && (!tz || tz === 'Z' || tz === '+0000' || tz === '-0000')) {
    return { iso: `${y}-${mo}-${day}`, allDay: true }
  }
  const withZone = tz === 'Z' || !tz ? `${time}Z` : `${time}${tz}`
  const d = new Date(withZone)
  return Number.isNaN(d.getTime()) ? { iso: value, allDay: false } : { iso: d.toISOString(), allDay: false }
}

/**
 * Normalize an RRULE for storage: trim/uppercase parts, and rewrite a
 * date-only UNTIL (YYYYMMDD) to the end of that UTC day (YYYYMMDDT235959Z) so
 * the app's rrule-based expansion treats "until the 31st" as inclusive of the
 * 31st, matching the editor's "Đến ngày" semantics.
 */
export function normalizeImportedRule(rule: string): string {
  return rule
    .split(';')
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq === -1) return part
      const key = part.slice(0, eq)
      const value = part.slice(eq + 1)
      if (key === 'UNTIL' && /^\d{8}$/.test(value)) return `UNTIL=${value}T235959Z`
      return part
    })
    .join(';')
}

/** Split a VCALENDAR into its VEVENT blocks and parse each one. */
export function parseIcs(text: string): ParsedEvent[] {
  const lines = unfold(text)
  const events: ParsedEvent[] = []
  let current: Record<string, string[]> | null = null

  const flush = () => {
    if (!current) return
    const props: Record<string, string[]> = current
    // DTSTART/EXDATE may carry parameters (VALUE=DATE) — strip everything
    // before the first ':' to get the raw value.
    const valueOf = (raw: string): string => raw.slice(raw.indexOf(':') + 1)
    const val = (name: string): string | null =>
      props[name]?.length ? valueOf(props[name][0]) : null
    const dtstartRaw = val('DTSTART')
    const dtstart = dtstartRaw ? parseIcsDateTime(dtstartRaw) : null
    const dtendRaw = val('DTEND')
    const dtend = dtendRaw ? parseIcsDateTime(dtendRaw) : null
    const exdates = (props['EXDATE'] ?? []).flatMap((raw) =>
      valueOf(raw)
        .split(',')
        .map((v) => parseIcsDateTime(v).iso),
    )
    const rawUid = val('UID')
    const rawParent = val('X-FREEBUFF-PARENT')
    const rawSummary = val('SUMMARY')
    const rawNote = val('X-FREEBUFF-NOTE')
    const rawFile = val('X-FREEBUFF-FILE')
    const rawExt = val('X-FREEBUFF-FILE-EXT')
    // Our own exporter writes UID/PARENT as <id>@freebuff — strip the suffix
    // so uids match the block ids they came from (preview/strip decisions key
    // on them). External uids pass through untouched.
    const normalizeUid = (u: string) => u.replace(/@freebuff$/i, '')
    events.push({
      uid: rawUid ? normalizeUid(rawUid) : `event-${events.length}`,
      summary: rawSummary ? unescapeIcsText(rawSummary) : null,
      dtstart: dtstart?.iso ?? null,
      dtend: dtend?.iso ?? null,
      rrule: val('RRULE') ? normalizeImportedRule(val('RRULE')!) : null,
      exdates,
      parentUid: rawParent ? normalizeUid(rawParent) : null,
      note: rawNote ? unescapeIcsText(rawNote) : null,
      fileUrl: rawFile ? unescapeIcsText(rawFile) : null,
      fileExt: rawExt ? unescapeIcsText(rawExt) : null,
    })
    current = null
  }

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      flush()
      current = {}
    } else if (line === 'END:VEVENT') {
      flush()
    } else if (current) {
      const colon = line.indexOf(':')
      if (colon === -1) continue
      const name = line.slice(0, colon).split(';')[0].toUpperCase()
      ;(current[name] ??= []).push(line)
    }
  }
  flush()
  return events
}

export interface IcsImportDeps {
  addBlock: (input: BlockInput) => Promise<Block>
  attach: (parentId: string, childId: string, relationType: RelationType) => Promise<void>
}

export interface IcsImportResult {
  created: number
  /** One-off events linked to a master as this-occurrence overrides. */
  overrides: number
  /** Split continuations (recurring children of a master). */
  continuations: number
  /**
   * Created blocks that carried a file reference (X-FREEBUFF-FILE) and were
   * not stripped (the caller may pass stripFileRefs to drop them upfront).
   * The .ics never carries file bytes, so the caller decides whether the URL
   * is still live in this workspace (a live file block with the same URL, or
   * a storage probe) and surfaces the dangling-file notice for the rest.
   */
  fileRefs: { id: string; uid: string; title: string | null; file_url: string }[]
  /** Block ids created, in creation order — the import-history undo removes
   *  exactly these blocks (and their relations) wholesale. */
  ids: string[]
}

/** Series role of an event in the preview checklist (how importIcs will
 *  treat it): a recurring root, a split continuation of a series, a
 *  this-occurrence override, or a standalone one-off. */
export type IcsEventRole = 'master' | 'continuation' | 'override' | 'standalone'

/** One row of the import checklist: title, date, and its series role. */
export interface IcsPreviewEvent {
  uid: string
  title: string | null
  /** ISO instant or 'YYYY-MM-DD' (all-day), matching app storage. */
  dtstart: string | null
  role: IcsEventRole
  fileUrl: string | null
}

/**
 * Non-destructive preview of an .ics file, shown before any blocks are
 * created: how many events will be imported, how many become this-occurrence
 * overrides / split continuations, which carry file references, and a
 * per-event checklist (title/date/role) for the UI's grouped selection. The
 * caller runs its own liveness check (live file blocks + storage probe) to
 * decide which refs are dangling, then passes stripFileRefs / includeUids to
 * importIcs for the rows the user chose to drop or clean.
 */
export interface IcsPreview {
  events: number
  overrides: number
  continuations: number
  fileRefs: { uid: string; title: string | null; file_url: string }[]
  /** One entry per parsed event, in file order, with its series role. */
  entries: IcsPreviewEvent[]
}

export interface IcsImportOptions {
  /** UIDs whose X-FREEBUFF-FILE reference should be dropped on import. */
  stripFileRefs?: ReadonlySet<string>
  /**
   * When provided, only these UIDs are imported (the preview checklist's
   * selection). A child whose parent was deselected falls back to standalone,
   * matching importIcs's normal last-resort behavior.
   */
  includeUids?: ReadonlySet<string>
  /**
   * Optional group name: every imported event's title is prefixed with
   * `<titlePrefix> · ` so a batch of picked events reads as one named series
   * in the calendar (the checklist's "Tên nhóm" field).
   */
  titlePrefix?: string
}

/** Build Tiptap doc content from an .ics note (one paragraph per line). */
function docFromText(text: string): BlockInput['content'] {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
}

function toBlockInput(ev: ParsedEvent, stripFileRef: boolean, titlePrefix?: string): BlockInput {
  const base = ev.summary ?? 'Sự kiện nhập từ lịch'
  return {
    type: 'event',
    title: titlePrefix ? `${titlePrefix} · ${base}` : base,
    content: ev.note ? docFromText(ev.note) : { type: 'doc', content: [] },
    start_time: ev.dtstart,
    end_time: ev.dtend,
    recurrence: ev.rrule,
    recurrence_exceptions: ev.exdates.length > 0 ? ev.exdates : null,
    file_url: stripFileRef ? null : ev.fileUrl,
    file_extension: stripFileRef ? null : ev.fileExt,
  }
}

/**
 * Classify one event's series role, shared by previewIcs and importIcs so
 * the checklist labels exactly match what gets created: a parented recurring
 * child is a split continuation, a parented one-off (or a one-off at an
 * excluded instant of a master, the external-file heuristic) is an override,
 * a recurring root is a master, everything else is standalone.
 */
export function classifyEventRole(ev: ParsedEvent, events: ParsedEvent[], byUid: Map<string, ParsedEvent>): IcsEventRole {
  const parented = !!ev.parentUid && byUid.has(ev.parentUid)
  if (parented && ev.rrule) return 'continuation'
  if (parented) return 'override'
  if (!ev.rrule && ev.dtstart != null && events.some((c) => c.rrule && c.exdates.includes(ev.dtstart!))) {
    return 'override'
  }
  return ev.rrule ? 'master' : 'standalone'
}

/**
 * Non-destructive preview: classify the parsed events exactly like importIcs
 * (parented children vs standalone, heuristic EXDATE overrides) and report
 * the counts + file references + per-event checklist without creating
 * anything.
 */
export function previewIcs(text: string): IcsPreview {
  const events = parseIcs(text)
  const byUid = new Map(events.map((e) => [e.uid, e]))
  let overrides = 0
  let continuations = 0
  for (const ev of events) {
    const role = classifyEventRole(ev, events, byUid)
    if (role === 'continuation') continuations++
    else if (role === 'override') overrides++
  }
  return {
    events: events.length,
    overrides,
    continuations,
    fileRefs: events
      .filter((e) => e.fileUrl)
      .map((e) => ({ uid: e.uid, title: e.summary, file_url: e.fileUrl! })),
    entries: events.map((e) => ({
      uid: e.uid,
      title: e.summary,
      dtstart: e.dtstart,
      role: classifyEventRole(e, events, byUid),
      fileUrl: e.fileUrl,
    })),
  }
}

/**
 * Import parsed events into the workspace: masters/standalone events are
 * created first (uid -> created id map), then X-FREEBUFF-PARENT children are
 * attached to their master (continuations keep their rule; overrides are
 * one-offs whose original occurrence the master's EXDATE already excludes).
 * External files without the marker fall back to matching a one-off's dtstart
 * against a master's EXDATEs. Pass options.stripFileRefs (from a preview's
 * dangling check) to drop file references the user chose to clear upfront.
 */
export async function importIcs(
  text: string,
  deps: IcsImportDeps,
  options?: IcsImportOptions,
): Promise<IcsImportResult> {
  let events = parseIcs(text)
  // The preview checklist's selection: only the chosen uids are imported. A
  // child whose parent was deselected falls back to standalone in pass 2
  // (a plain event beats dropping the event), same as an unresolvable parent.
  if (options?.includeUids) {
    events = events.filter((e) => options.includeUids!.has(e.uid))
  }
  if (events.length === 0) return { created: 0, overrides: 0, continuations: 0, fileRefs: [], ids: [] }

  const byUid = new Map<string, ParsedEvent>()
  for (const ev of events) byUid.set(ev.uid, ev)

  const createdId = new Map<string, string>()
  const result: IcsImportResult = { created: 0, overrides: 0, continuations: 0, fileRefs: [], ids: [] }

  const create = async (ev: ParsedEvent): Promise<string> => {
    const strip = !!options?.stripFileRefs?.has(ev.uid)
    const block = await deps.addBlock(toBlockInput(ev, strip, options?.titlePrefix))
    createdId.set(ev.uid, block.id)
    result.created++
    result.ids.push(block.id)
    // The created block carries the reference even if the caller's addBlock
    // mock/db layer echoed a normalized row without file_url — report the
    // URL we parsed so the dangling check always has the source of truth.
    // Stripped refs are dropped entirely (the user cleared them upfront).
    if (ev.fileUrl && !strip) result.fileRefs.push({ id: block.id, uid: ev.uid, title: ev.summary, file_url: ev.fileUrl })
    return block.id
  }

  const link = async (parentUid: string, child: ParsedEvent, isContinuation: boolean) => {
    const parentId = createdId.get(parentUid)
    if (!parentId) return false
    const childId = await create(child)
    await deps.attach(parentId, childId, 'attached')
    if (isContinuation) result.continuations++
    else result.overrides++
    return true
  }

  // Pass 1: children (X-FREEBUFF-PARENT that resolves) and one-off events at
  // an excluded instant (external-file heuristic) are deferred; everything else
  // becomes a standalone block (masters for recurring events, plain events
  // otherwise).
  const pending: ParsedEvent[] = []
  for (const ev of events) {
    const parented = !!ev.parentUid && byUid.has(ev.parentUid)
    const heuristicOverride =
      !parented &&
      !ev.rrule &&
      ev.dtstart != null &&
      events.some((candidate) => candidate.rrule && candidate.exdates.includes(ev.dtstart!))
    if (parented || heuristicOverride) {
      pending.push(ev)
      continue
    }
    await create(ev)
  }

  // Pass 2: attach deferred children to the masters created above — by uid
  // first, then by the EXDATE-match heuristic, standalone as the last resort
  // (a plain event beats dropping the event).
  for (const ev of pending) {
    const isContinuation = ev.rrule !== null
    if (ev.parentUid && byUid.has(ev.parentUid) && (await link(ev.parentUid, ev, isContinuation))) continue
    const parent = events.find((candidate) => candidate.rrule && candidate.exdates.includes(ev.dtstart ?? ''))
    if (parent && createdId.has(parent.uid)) {
      await link(parent.uid, ev, false)
    } else {
      await create(ev)
    }
  }

  return result
}
