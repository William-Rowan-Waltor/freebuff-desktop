import { describe, expect, it } from 'vitest'
import { textPreview } from '@/lib/textPreview'

describe('textPreview', () => {
  it('returns a raw string as-is (no truncation for search matching)', () => {
    expect(textPreview('hello')).toBe('hello')
    const long = 'x'.repeat(200)
    expect(textPreview(long)).toHaveLength(200)
  })

  it('returns fallback for null/undefined/empty', () => {
    expect(textPreview(null)).toBe('Chưa có nội dung')
    expect(textPreview(undefined)).toBe('Chưa có nội dung')
    expect(textPreview(42)).toBe('Chưa có nội dung')
    expect(textPreview({})).toBe('Chưa có nội dung')
  })

  it('extracts text from a flat Tiptap doc', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ],
    }
    expect(textPreview(doc)).toBe('Hello World')
  })

  it('handles nested paragraph nodes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First paragraph' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second paragraph' }],
        },
      ],
    }
    expect(textPreview(doc)).toBe('First paragraph Second paragraph')
  })

  it('collapses whitespace and trims', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'text', text: '  hello   world  ' },
      ],
    }
    expect(textPreview(doc)).toBe('hello world')
  })

  it('respects custom limit parameter', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'text', text: 'Hello World, this is a long text for testing' },
      ],
    }
    expect(textPreview(doc, 10)).toBe('Hello Worl')
    expect(textPreview(doc, 5)).toBe('Hello')
  })

  it('handles a flat array of nodes (no doc wrapper)', () => {
    const nodes = [
      { type: 'text', text: 'Alpha' },
      { type: 'text', text: 'Beta' },
    ]
    expect(textPreview(nodes)).toBe('Alpha Beta')
  })

  it('skips non-text nodes without text property', () => {
    const nodes = [
      { type: 'hardBreak' },
      { type: 'text', text: 'Visible' },
      { type: 'mention', id: '123' },
    ]
    expect(textPreview(nodes)).toBe('Visible')
  })

  it('returns fallback for empty doc content', () => {
    expect(textPreview({ type: 'doc', content: [] })).toBe('Chưa có nội dung')
  })
})
