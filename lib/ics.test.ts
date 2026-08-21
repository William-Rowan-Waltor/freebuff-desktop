import { describe, expect, it } from 'vitest'

import {
  buildIcs,
  buildWorkspaceIcs,
  collectSeries,
  escapeIcsText,
  foldIcsLine,
  icsFilename,
  normalizeIcsRule,
} from '@/lib/ics'
import type { Block, BlockRelation } from '@/types'

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

function icsLines(block: Block, blocks: Block[], relations: BlockRelation[]): string[] {
  return buildIcs(collectSeries(block, blocks, relations)).split('\r\n')
}

describe('buildIcs', () => {
  it('exports a timed recurring master with RRULE and UTC instants', () => {
    const block = eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })
    const lines = icsLines(block, [block], [])
    const text = lines.join('\n')
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).toContain('END:VCALENDAR')
    expect(text).toContain('UID:rec@freebuff')
    expect(text).toContain('DTSTART:20260814T020000Z')
    expect(text).toContain('DTEND:20260814T030000Z')
    expect(text).toContain('RRULE:FREQ=WEEKLY')
    expect(text).toContain('SUMMARY:Họp định kỳ')
  })

  it('emits EXDATE for each stored exception', () => {
    const block = eventBlock({
      id: 'rec',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-08-21T02:00:00.000Z', '2026-08-28T02:00:00.000Z'],
    })
    const text = icsLines(block, [block], []).join('\n')
    expect(text).toContain('EXDATE:20260821T020000Z,20260828T020000Z')
  })

  it('exports all-day masters with VALUE=DATE and date-only exceptions', () => {
    const block = eventBlock({
      id: 'all-day',
      start_time: '2026-08-14',
      end_time: '2026-08-15',
      recurrence: 'FREQ=DAILY',
      recurrence_exceptions: ['2026-08-21'],
    })
    const text = icsLines(block, [block], []).join('\n')
    expect(text).toContain('DTSTART;VALUE=DATE:20260814')
    expect(text).toContain('DTEND;VALUE=DATE:20260815')
    expect(text).toContain('EXDATE:20260821')
  })

  it('bumps an all-day end that is not strictly after the start (half-open convention)', () => {
    const block = eventBlock({
      id: 'all-day',
      start_time: '2026-08-14',
      end_time: '2026-08-14',
      recurrence: 'FREQ=DAILY',
    })
    const text = icsLines(block, [block], []).join('\n')
    expect(text).toContain('DTSTART;VALUE=DATE:20260814')
    expect(text).toContain('DTEND;VALUE=DATE:20260815')
  })

  it('exports a split continuation as its own VEVENT with its own rule', () => {
    const master = eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })
    const next = eventBlock({
      id: 'split-new',
      start_time: '2026-08-21T02:00:00.000Z',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-08-28T02:00:00.000Z'],
    })
    const text = icsLines(master, [master, next], [relation('rec', 'split-new')]).join('\n')
    expect(text).toContain('UID:rec@freebuff')
    expect(text).toContain('UID:split-new@freebuff')
    // Both series carry their own RRULE; the continuation keeps its exceptions.
    expect(text.match(/RRULE:FREQ=WEEKLY/g)).toHaveLength(2)
    expect(text).toContain('EXDATE:20260828T020000Z')
  })

  it('marks overrides and continuations with X-FREEBUFF-PARENT for import', () => {
    const master = eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })
    const next = eventBlock({ id: 'split-new', recurrence: 'FREQ=WEEKLY' })
    const ov = eventBlock({ id: 'ov-1', start_time: '2026-08-21T05:00:00.000Z' })
    const text = icsLines(master, [master, next, ov], [
      relation('rec', 'split-new'),
      relation('rec', 'ov-1'),
    ]).join('\n')
    expect(text).toContain('UID:split-new@freebuff\nX-FREEBUFF-PARENT:rec@freebuff')
    expect(text).toContain('UID:ov-1@freebuff\nX-FREEBUFF-PARENT:rec@freebuff')
  })

  it('exports a this-occurrence override as a one-off VEVENT (no RRULE)', () => {
    const master = eventBlock({
      id: 'rec',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-08-21T02:00:00.000Z'],
    })
    const override = eventBlock({
      id: 'override-1',
      start_time: '2026-08-21T05:00:00.000Z',
      end_time: '2026-08-21T06:00:00.000Z',
      title: 'Họp dời sang chiều',
    })
    const text = icsLines(master, [master, override], [relation('rec', 'override-1')]).join('\n')
    expect(text).toContain('UID:override-1@freebuff')
    expect(text).toContain('DTSTART:20260821T050000Z')
    expect(text).toContain('SUMMARY:Họp dời sang chiều')
    // The original occurrence is excluded from the series, and the override
    // itself is a plain one-off (no RRULE line of its own).
    expect(text).toContain('EXDATE:20260821T020000Z')
    const overrideSection = text.slice(text.indexOf('UID:override-1@freebuff'))
    expect(overrideSection).not.toContain('RRULE:')
  })

  it('collects nested split continuations and their overrides recursively', () => {
    const master = eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })
    const split1 = eventBlock({ id: 'split-1', recurrence: 'FREQ=WEEKLY' })
    const split2 = eventBlock({ id: 'split-2', recurrence: 'FREQ=WEEKLY' })
    const ov = eventBlock({ id: 'ov-1', start_time: '2026-09-04T09:00:00.000Z' })
    const series = collectSeries(master, [master, split1, split2, ov], [
      relation('rec', 'split-1'),
      relation('split-1', 'split-2'),
      relation('split-1', 'ov-1'),
    ])
    expect(series.continuations.map((c) => c.block.id)).toEqual(['split-1', 'split-2'])
    expect(series.overrides.map((o) => o.block.id)).toEqual(['ov-1'])
    // Each child records the block it hangs off, so import can relink exactly.
    expect(series.continuations[0].parentUid).toBe('rec@freebuff')
    expect(series.continuations[1].parentUid).toBe('split-1@freebuff')
    expect(series.overrides[0].parentUid).toBe('split-1@freebuff')
  })

  it('exports a per-occurrence note as X-FREEBUFF-NOTE with the extracted text', () => {
    const master = eventBlock({
      id: 'rec',
      recurrence: 'FREQ=WEEKLY',
      recurrence_exceptions: ['2026-08-21T02:00:00.000Z'],
    })
    const override = eventBlock({
      id: 'override-1',
      start_time: '2026-08-21T05:00:00.000Z',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Đổi sang phòng họp B, nhớ mang laptop.' }] },
        ],
      },
    })
    const text = icsLines(master, [master, override], [relation('rec', 'override-1')]).join('\n')
    const overrideSection = text.slice(text.indexOf('UID:override-1@freebuff'))
    expect(overrideSection).toContain(
      'X-FREEBUFF-NOTE:Đổi sang phòng họp B\\, nhớ mang laptop.',
    )
    // The master has no content — exactly one NOTE property in the file.
    expect(text.match(/X-FREEBUFF-NOTE:/g)).toHaveLength(1)
  })

  it('exports a file reference as X-FREEBUFF-FILE with its extension', () => {
    const block = eventBlock({
      id: 'rec',
      file_url: 'https://proj.supabase.co/storage/v1/object/public/files/u1/rec/slides.pdf',
      file_extension: 'pdf',
    })
    const text = icsLines(block, [block], []).join('\n')
    // The long URL folds at 75 octets — unfold before asserting the value
    // (the test joins physical lines with \n, so accept either fold form).
    const unfolded = text.replace(/\r?\n /g, '')
    expect(unfolded).toContain(
      'X-FREEBUFF-FILE:https://proj.supabase.co/storage/v1/object/public/files/u1/rec/slides.pdf',
    )
    expect(unfolded).toContain('X-FREEBUFF-FILE-EXT:pdf')
    // No file reference — no property at all.
    const plain = icsLines(eventBlock({ id: 'rec' }), [eventBlock({ id: 'rec' })], []).join('\n')
    expect(plain).not.toContain('X-FREEBUFF-FILE')
  })

  it('skips genuine attachments that are not events (no start_time)', () => {
    const master = eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })
    const note = eventBlock({ id: 'note-1', type: 'note', start_time: null, end_time: null })
    const series = collectSeries(master, [master, note], [relation('rec', 'note-1')])
    expect(series.overrides).toEqual([])
    expect(series.continuations).toEqual([])
  })
})

describe('buildWorkspaceIcs', () => {
  it('exports every root series exactly once, skipping notes and nested duplicates', () => {
    const master = eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })
    const cont = eventBlock({ id: 'split-new', recurrence: 'FREQ=WEEKLY' })
    const ov = eventBlock({ id: 'ov-1', start_time: '2026-08-21T05:00:00.000Z' })
    const plain = eventBlock({ id: 'plain', start_time: '2026-09-01T09:00:00.000Z', title: 'Họp một lần' })
    const note = eventBlock({ id: 'note-1', type: 'note', start_time: null })
    const text = buildWorkspaceIcs([master, cont, ov, plain, note], [
      relation('rec', 'split-new'),
      relation('rec', 'ov-1'),
    ])
    // Master + continuation + override + plain event: four VEVENTs.
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(4)
    expect(text).toContain('UID:rec@freebuff')
    expect(text).toContain('UID:split-new@freebuff')
    expect(text).toContain('UID:ov-1@freebuff')
    expect(text).toContain('UID:plain@freebuff')
    expect(text).not.toContain('UID:note-1@freebuff')
    // The override and continuation carry their parent marker; the plain
    // event is standalone.
    expect(text).toContain('X-FREEBUFF-PARENT:rec@freebuff')
    expect(text.match(/RRULE:FREQ=WEEKLY/g)).toHaveLength(2)
  })

  it('scopes the export to surviving block ids (Đã nhập re-export)', () => {
    const master = eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })
    const cont = eventBlock({ id: 'split-new', recurrence: 'FREQ=WEEKLY' })
    const ov = eventBlock({ id: 'ov-1', start_time: '2026-08-21T05:00:00.000Z' })
    const unrelated = eventBlock({ id: 'other', start_time: '2026-09-01T09:00:00.000Z', title: 'Không liên quan' })
    const text = buildWorkspaceIcs(
      [master, cont, ov, unrelated],
      [relation('rec', 'split-new'), relation('rec', 'ov-1')],
      new Set(['rec', 'split-new', 'ov-1']),
    )
    // The unrelated event is excluded; the master's surviving tree exports
    // fully with its relink markers.
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(3)
    expect(text).toContain('UID:rec@freebuff')
    expect(text).toContain('UID:split-new@freebuff')
    expect(text).toContain('UID:ov-1@freebuff')
    expect(text).not.toContain('UID:other@freebuff')
    expect(text).toContain('X-FREEBUFF-PARENT:rec@freebuff')
  })

  it('promotes a surviving continuation to its own root when the master is gone', () => {
    const master = eventBlock({ id: 'rec', recurrence: 'FREQ=WEEKLY' })
    const cont = eventBlock({ id: 'split-new', recurrence: 'FREQ=WEEKLY' })
    const text = buildWorkspaceIcs(
      [master, cont],
      [relation('rec', 'split-new')],
      new Set(['split-new']), // the master was deleted after import
    )
    // The continuation is no longer an attached child within the scope, so it
    // exports as its own recurring root without a parent marker.
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(text).toContain('UID:split-new@freebuff')
    expect(text).not.toContain('X-FREEBUFF-PARENT')
  })
})

describe('escaping and folding', () => {
  it('escapes backslash, semicolon, comma and newline in summaries', () => {
    const block = eventBlock({ id: 'rec', title: 'A,B;C\\D\nE' })
    const text = icsLines(block, [block], []).join('\n')
    expect(text).toContain('SUMMARY:A\\,B\\;C\\\\D\\nE')
    expect(escapeIcsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne')
  })

  it('normalizes lowercase rules and human-form UNTIL values', () => {
    expect(normalizeIcsRule('freq=weekly;until=2026-08-14T23:59:59Z')).toBe(
      'FREQ=WEEKLY;UNTIL=20260814T235959Z',
    )
    expect(normalizeIcsRule('FREQ=DAILY;COUNT=4')).toBe('FREQ=DAILY;COUNT=4')
  })

  it('folds long lines at 75 octets with CRLF + space continuation', () => {
    const folded = foldIcsLine('x'.repeat(160))
    const parts = folded.split('\r\n ')
    expect(parts[0]).toHaveLength(75)
    expect(parts[1]).toHaveLength(75)
    expect(parts[2]).toBe('x'.repeat(10))
  })

  it('derives a safe filename from the title', () => {
    expect(icsFilename(eventBlock({ id: 'rec', title: 'Họp định kỳ!' }))).toBe('h-p-nh-k.ics')
    expect(icsFilename(eventBlock({ id: 'rec', title: null }))).toBe('event.ics')
  })
})
