import { describe, it, expect } from 'vitest'
import {
  suggestTags,
  suggestPriority,
  summarizeContent,
  detectPatterns,
  suggestNextSteps,
} from './ai-features'
import type { Block } from '@/types'

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'test-1',
    type: 'note',
    title: null,
    content: null,
    start_time: null,
    end_time: null,
    recurrence: null,
    recurrence_exceptions: null,
    file_url: null,
    file_extension: null,
    owner_id: null,
    ...overrides,
  }
}

describe('suggestTags', () => {
  it('suggests meeting tag when title contains meeting keyword', () => {
    const block = makeBlock({ title: 'Team meeting hôm nay' })
    const tags = suggestTags(block)
    expect(tags).toContain('meeting')
  })

  it('suggests code tag for code-type blocks', () => {
    const block = makeBlock({ type: 'code', title: 'Bug fix API' })
    const tags = suggestTags(block)
    expect(tags).toContain('lập trình')
  })

  it('suggests work tag for work-related content', () => {
    const block = makeBlock({ title: 'Hoàn thành task deadline' })
    const tags = suggestTags(block)
    expect(tags).toContain('công việc')
  })

  it('returns empty array for unrelated content', () => {
    const block = makeBlock({ title: 'ab' })
    const tags = suggestTags(block)
    expect(tags).toHaveLength(0)
  })

  it('suggests multiple tags for rich content', () => {
    const block = makeBlock({
      title: 'Họp team về dự án',
      content: 'Bàn về meeting sprint mới, deadline tuần sau',
    })
    const tags = suggestTags(block)
    expect(tags.length).toBeGreaterThanOrEqual(2)
  })

  it('checks content field as well as title', () => {
    const block = makeBlock({
      title: 'Note',
      content: 'Học react tutorial hôm nay',
    })
    const tags = suggestTags(block)
    expect(tags).toContain('học tập')
  })
})

describe('suggestPriority', () => {
  it('suggests urgent for urgent keywords', () => {
    const block = makeBlock({ title: 'Khẩn cấp: cần fix ngay' })
    expect(suggestPriority(block)).toBe('urgent')
  })

  it('suggests high for important keywords', () => {
    const block = makeBlock({ title: 'Quan trọng: review code' })
    expect(suggestPriority(block)).toBe('high')
  })

  it('returns null for normal content', () => {
    const block = makeBlock({ title: 'Mua cafeteria' })
    expect(suggestPriority(block)).toBeNull()
  })

  it('checks content not just title', () => {
    const block = makeBlock({ title: 'Task', content: 'This is asap' })
    expect(suggestPriority(block)).toBe('urgent')
  })
})

describe('summarizeContent', () => {
  it('returns short content as-is', () => {
    const short = 'Hello world'
    expect(summarizeContent(short)).toBe(short)
  })

  it('handles null/empty content', () => {
    expect(summarizeContent(null)).toBe('')
    expect(summarizeContent('')).toBe('')
  })

  it('truncates long content to key sentences', () => {
    const long = Array(20)
      .fill(0)
      .map((_, i) => `Sentence ${i} about important topic keywords and ideas.`)
      .join(' ')
    const summary = summarizeContent(long)
    expect(summary.length).toBeLessThan(long.length)
    expect(summary.length).toBeGreaterThan(0)
  })
})

describe('detectPatterns', () => {
  it('detects overdue items', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const blocks = [
      makeBlock({
        id: 'o1',
        end_time: yesterday.toISOString(),
        status: 'pending',
      }),
    ]
    const patterns = detectPatterns(blocks)
    const overdue = patterns.find((p) => p.type === 'overdue_risk')
    expect(overdue).toBeDefined()
  })

  it('detects recurring day pattern', () => {
    const monday = new Date('2026-08-17T10:00:00') // Monday
    const blocks = Array(5)
      .fill(0)
      .map((_, i) => {
        const d = new Date(monday)
        d.setDate(d.getDate() + i * 7) // same day each week
        return makeBlock({ id: `b${i}`, start_time: d.toISOString() })
      })
    const patterns = detectPatterns(blocks)
    const recurring = patterns.find((p) => p.type === 'recurring_day')
    expect(recurring).toBeDefined()
  })

  it('returns empty for no blocks', () => {
    expect(detectPatterns([])).toHaveLength(0)
  })
})

describe('suggestNextSteps', () => {
  it('suggests adding description for short content', () => {
    const block = makeBlock({ content: 'Hi' })
    const tips = suggestNextSteps(block)
    expect(tips.some((t) => t.includes('mô tả'))).toBe(true)
  })

  it('suggests tags when missing', () => {
    const block = makeBlock({ title: 'Team meeting deadline' })
    const tips = suggestNextSteps(block)
    expect(tips.some((t) => t.includes('tag'))).toBe(true)
  })

  it('suggests deadline for notes without start_time', () => {
    const block = makeBlock({ type: 'note', content: 'A longer content that passes the threshold for suggestions' })
    const tips = suggestNextSteps(block)
    expect(tips.some((t) => t.includes('deadline'))).toBe(true)
  })

  it('suggests end time for events without end_time', () => {
    const block = makeBlock({
      type: 'event',
      start_time: new Date().toISOString(),
      content: 'A longer content that passes the threshold',
    })
    const tips = suggestNextSteps(block)
    expect(tips.some((t) => t.includes('kết thúc'))).toBe(true)
  })
})
