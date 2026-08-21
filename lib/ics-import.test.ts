import { describe, expect, it, vi } from 'vitest'

import { buildIcs, collectSeries } from '@/lib/ics'
import { importIcs, previewIcs, parseIcsDateTime, parseIcs } from '@/lib/ics-import'
import type { Block, BlockInput, BlockRelation, RelationType } from '@/types'

function eventBlock(overrides: Partial<Block> & { id: string }): Block {
  return {
    type: 'event',
    title: 'Họp định kỳ',
    content: null,
    start_time: '2026-08-14T02:00:00.000Z',
    end_time: '2026-08-14T03:00:00.000Z',
    recurrence: null,
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
    ...overrides,
  }
}

const relation = (parent_id: string, child_id: string): BlockRelation => ({
  parent_id,
  child_id,
  relation_type: 'attached',
})

function makeDeps() {
  const inputs: BlockInput[] = []
  const links: { parentId: string; childId: string; type: RelationType }[] = []
  const idByInput = new Map<BlockInput, string>()
  let n = 0
  const addBlock = vi.fn(async (input: BlockInput): Promise<Block> => {
    const id = `new-${n++}`
    idByInput.set(input, id)
    inputs.push(input)
    return { id, type: input.type, title: input.title ?? null, content: input.content ?? null, start_time: input.start_time ?? null, end_time: input.end_time ?? null, recurrence: input.recurrence ?? null, recurrence_exceptions: input.recurrence_exceptions ?? null, file_url: input.file_url ?? null, file_extension: input.file_extension ?? null, owner_id: null } as Block
  })
  const attach = vi.fn(async (parentId: string, childId: string, type: RelationType) => {
    links.push({ parentId, childId, type })
  })
  return { addBlock, attach, inputs, links, idByInput }
}

describe('parseIcsDateTime', () => {
  it('parses UTC, offset, and floating times; bare dates are all-day', () => {
    expect(parseIcsDateTime('20260814T020000Z')).toEqual({ iso: '2026-08-14T02:00:00.000Z', allDay: false })
    expect(parseIcsDateTime('20260814T090000+0700')).toEqual({ iso: '2026-08-14T02:00:00.000Z', allDay: false })
    expect(parseIcsDateTime('20260814T020000')).toEqual({ iso: '2026-08-14T02:00:00.000Z', allDay: false })
    expect(parseIcsDateTime('20260814')).toEqual({ iso: '2026-08-14', allDay: true })
    expect(parseIcsDateTime('20260814T000000Z')).toEqual({ iso: '2026-08-14', allDay: true })
  })
})

describe('parseIcs', () => {
  it('parses a minimal external file with RRULE + EXDATE + folded summary', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:abc-1',
      'DTSTART:20260814T020000Z',
      'DTEND:20260814T030000Z',
      'SUMMARY:Tiêu đề rất dài cần gấp dòng vì vượt quá 75 ký tự nên phải folded bở',
      ' iCal theo chuẩn RFC 5545',
      'RRULE:FREQ=WEEKLY;UNTIL=20260930',
      'EXDATE:20260821T020000Z',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    const [ev] = parseIcs(text)
    expect(ev.uid).toBe('abc-1')
    expect(ev.dtstart).toBe('2026-08-14T02:00:00.000Z')
    expect(ev.rrule).toBe('FREQ=WEEKLY;UNTIL=20260930T235959Z')
    expect(ev.exdates).toEqual(['2026-08-21T02:00:00.000Z'])
    expect(ev.summary).toContain('chuẩn RFC 5545')
  })

  it('parses VALUE=DATE all-day events', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:ad-1',
      'DTSTART;VALUE=DATE:20260814',
      'DTEND;VALUE=DATE:20260815',
      'RRULE:FREQ=DAILY',
      'EXDATE;VALUE=DATE:20260821',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')
    const [ev] = parseIcs(text)
    expect(ev.dtstart).toBe('2026-08-14')
    expect(ev.dtend).toBe('2026-08-15')
    expect(ev.exdates).toEqual(['2026-08-21'])
  })
})

describe('importIcs', () => {
  it('round-trips an exported series: master, split continuation, and override relink exactly', async () => {
    const master = eventBlock({
      id: 'rec',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-08-21T02:00:00.000Z'],
    })
    const next = eventBlock({ id: 'split-new', start_time: '2026-08-21T02:00:00.000Z', recurrence: 'FREQ=WEEKLY' })
    const ov = eventBlock({ id: 'ov-1', start_time: '2026-08-21T05:00:00.000Z', title: 'Họp dời sang chiều' })
    const ics = buildIcs(
      collectSeries(master, [master, next, ov], [
        relation('rec', 'split-new'),
        relation('rec', 'ov-1'),
      ]),
    )

    const deps = makeDeps()
    const result = await importIcs(ics, deps)

    expect(result).toEqual({
      created: 3,
      overrides: 1,
      continuations: 1,
      fileRefs: [],
      ids: ['new-0', 'new-1', 'new-2'],
    })
    // Three blocks: the master (recurring, with its exception), the
    // continuation (recurring), and the override (one-off).
    const recs = deps.inputs.filter((i) => i.recurrence)
    expect(recs).toHaveLength(2)
    expect(recs[0].recurrence).toBe('FREQ=WEEKLY')
    expect(recs[0].recurrence_exceptions).toEqual(['2026-08-21T02:00:00.000Z'])
    const oneOffs = deps.inputs.filter((i) => !i.recurrence)
    expect(oneOffs).toHaveLength(1)
    expect(oneOffs[0].title).toBe('Họp dời sang chiều')
    expect(oneOffs[0].start_time).toBe('2026-08-21T05:00:00.000Z')
    // Both children attach to the master that created them.
    expect(deps.links).toHaveLength(2)
    expect(deps.links.every((l) => l.type === 'attached')).toBe(true)
    // Both children attach to the created master (the recurring block).
    const masterId = deps.idByInput.get(recs[0])!
    expect(deps.links.map((l) => l.parentId)).toEqual([masterId, masterId])
  })

  it('attaches a one-off to a master when its dtstart matches an EXDATE (external file)', async () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:m1',
      'DTSTART:20260814T020000Z',
      'RRULE:FREQ=WEEKLY',
      'EXDATE:20260821T020000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:o1',
      'DTSTART:20260821T020000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const deps = makeDeps()
    const result = await importIcs(text, deps)
    expect(result).toEqual({ created: 2, overrides: 1, continuations: 0, fileRefs: [], ids: ['new-0', 'new-1'] })
    expect(deps.links).toHaveLength(1)
    expect(deps.links[0].parentId).toBe(deps.idByInput.get(deps.inputs.find((i) => i.recurrence)!)!)
  })

  it('round-trips per-occurrence notes via X-FREEBUFF-NOTE', async () => {
    const master = eventBlock({
      id: 'rec',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-08-21T02:00:00.000Z'],
    })
    const ov = eventBlock({
      id: 'ov-1',
      start_time: '2026-08-21T05:00:00.000Z',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Đổi phòng sang B, chuẩn bị demo.' }],
          },
        ],
      },
    })
    const ics = buildIcs(collectSeries(master, [master, ov], [relation('rec', 'ov-1')]))

    const deps = makeDeps()
    const result = await importIcs(ics, deps)

    expect(result.overrides).toBe(1)
    const overrideInput = deps.inputs.find((i) => !i.recurrence)!
    // The note text is rebuilt into Tiptap doc shape (paragraph per line).
    const content = overrideInput.content as { content?: { content?: { text?: string }[] }[] }
    expect(content.content?.[0]?.content?.[0]?.text).toBe('Đổi phòng sang B, chuẩn bị demo.')
    // The master, which had no content, imports with an empty doc.
    const masterInput = deps.inputs.find((i) => i.recurrence)!
    expect(masterInput.content).toEqual({ type: 'doc', content: [] })
  })

  it('round-trips file references via X-FREEBUFF-FILE and reports them in fileRefs', async () => {
    const master = eventBlock({
      id: 'rec-file',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-08-21T02:00:00.000Z'],
      file_url: 'https://old.supabase.co/storage/v1/object/public/files/u1/rec-file/slides.pdf',
      file_extension: 'pdf',
    })
    const ics = buildIcs(collectSeries(master, [master], []))

    const deps = makeDeps()
    const result = await importIcs(ics, deps)

    // The exporter writes the reference (folded at 75 octets); the importer
    // rebuilds it on the block. Unfold before asserting the value.
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('X-FREEBUFF-FILE:https://old.supabase.co/storage/v1/object/public/files/u1/rec-file/slides.pdf')
    expect(unfolded).toContain('X-FREEBUFF-FILE-EXT:pdf')
    const input = deps.inputs[0]
    expect(input.file_url).toBe('https://old.supabase.co/storage/v1/object/public/files/u1/rec-file/slides.pdf')
    expect(input.file_extension).toBe('pdf')
    // The result carries the created id + uid + parsed URL so the caller can
    // decide whether the reference is still live and surface the dangling
    // notice (uid links preview decisions to the created blocks).
    expect(result.fileRefs).toEqual([
      { id: 'new-0', uid: 'rec-file', title: 'Họp định kỳ', file_url: 'https://old.supabase.co/storage/v1/object/public/files/u1/rec-file/slides.pdf' },
    ])
  })

  it('previews an .ics without creating anything (counts + file refs)', async () => {
    const master = eventBlock({
      id: 'rec',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-08-21T02:00:00.000Z'],
      file_url: 'https://old.supabase.co/storage/v1/object/public/files/u1/rec/slides.pdf',
    })
    const ov = eventBlock({ id: 'ov-1', start_time: '2026-08-21T05:00:00.000Z' })
    const ics = buildIcs(collectSeries(master, [master, ov], [relation('rec', 'ov-1')]))

    const preview = previewIcs(ics)
    expect(preview.events).toBe(2)
    expect(preview.overrides).toBe(1)
    expect(preview.continuations).toBe(0)
    expect(preview.fileRefs).toEqual([
      { uid: 'rec', title: 'Họp định kỳ', file_url: 'https://old.supabase.co/storage/v1/object/public/files/u1/rec/slides.pdf' },
    ])
    // The checklist rows carry title/date/role for the grouped UI.
    expect(preview.entries).toEqual([
      {
        uid: 'rec',
        title: 'Họp định kỳ',
        dtstart: '2026-08-14T02:00:00.000Z',
        role: 'master',
        fileUrl: 'https://old.supabase.co/storage/v1/object/public/files/u1/rec/slides.pdf',
      },
      {
        uid: 'ov-1',
        title: 'Họp định kỳ',
        dtstart: '2026-08-21T05:00:00.000Z',
        role: 'override',
        fileUrl: null,
      },
    ])

    // Pure parse — the deps are never invoked.
    const deps = makeDeps()
    expect(deps.addBlock).not.toHaveBeenCalled()
    expect(deps.attach).not.toHaveBeenCalled()
  })

  it('previews split continuations as their own series count', () => {
    const master = eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })
    const next = eventBlock({ id: 'split-new', recurrence: 'FREQ=WEEKLY' })
    const ics = buildIcs(collectSeries(master, [master, next], [relation('rec', 'split-new')]))
    const preview = previewIcs(ics)
    expect(preview.events).toBe(2)
    expect(preview.continuations).toBe(1)
    expect(preview.overrides).toBe(0)
    expect(preview.entries.map((e) => e.role)).toEqual(['master', 'continuation'])
  })

  it('previews an external one-off as standalone', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:o1',
      'DTSTART:20260814T020000Z',
      'SUMMARY:Sự kiện riêng',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const preview = previewIcs(text)
    expect(preview.entries).toEqual([
      { uid: 'o1', title: 'Sự kiện riêng', dtstart: '2026-08-14T02:00:00.000Z', role: 'standalone', fileUrl: null },
    ])
  })

  it('imports only the uids in includeUids; a deselected master override falls back standalone', async () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:m1',
      'DTSTART:20260814T020000Z',
      'RRULE:FREQ=WEEKLY',
      'EXDATE:20260821T020000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:o1',
      'DTSTART:20260821T020000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const deps = makeDeps()
    // Only the override is ticked: the master is skipped, so the one-off has
    // no parent to attach to and lands standalone (nothing is dropped).
    const result = await importIcs(text, deps, { includeUids: new Set(['o1']) })
    expect(result).toEqual({ created: 1, overrides: 0, continuations: 0, fileRefs: [], ids: ['new-0'] })
    // The raw event has no SUMMARY, so the block falls back to the default
    // title ('Sự kiện nhập từ lịch'); the one-off's own dtstart is preserved.
    expect(deps.inputs[0].title).toBe('Sự kiện nhập từ lịch')
    expect(deps.inputs[0].start_time).toBe('2026-08-21T02:00:00.000Z')
    expect(deps.links).toHaveLength(0)
  })

  it('strips a file reference upfront when the uid is in stripFileRefs', async () => {
    const master = eventBlock({
      id: 'rec-file',
      file_url: 'https://old.supabase.co/storage/v1/object/public/files/u1/rec-file/slides.pdf',
      file_extension: 'pdf',
    })
    const ics = buildIcs(collectSeries(master, [master], []))

    const deps = makeDeps()
    const result = await importIcs(ics, deps, { stripFileRefs: new Set(['rec-file']) })

    // The block is created WITHOUT the reference and it never reaches fileRefs
    // (so no dangling notice fires afterwards).
    expect(deps.inputs[0].file_url).toBeNull()
    expect(deps.inputs[0].file_extension).toBeNull()
    expect(result.fileRefs).toEqual([])
  })

  it('leaves one-offs without a matching master standalone', async () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:m1',
      'DTSTART:20260814T020000Z',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:o1',
      'DTSTART:20260901T090000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const deps = makeDeps()
    const result = await importIcs(text, deps)
    expect(result).toEqual({ created: 2, overrides: 0, continuations: 0, fileRefs: [], ids: ['new-0', 'new-1'] })
    expect(deps.links).toHaveLength(0)
  })
})
