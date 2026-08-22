/**
 * AI-powered features for Dresplace.
 * All computations run CLIENT-SIDE using rule-based heuristics and keyword extraction.
 * No external AI API calls — zero cost, zero latency, zero privacy concerns.
 *
 * Future: swap heuristics for ONNX Runtime Web models for deeper NLP.
 */

import type { Block } from '@/types'

/* ------------------------------------------------------------------ */
/*  1. Auto-Tag Suggestion                                            */
/* ------------------------------------------------------------------ */

/** Known domain keywords → suggested tags */
const TAG_KEYWORDS: Record<string, string[]> = {
  'công việc': ['công việc', 'deadline', 'hoàn thành', 'giao việc', 'đ task'],
  'meeting': ['meeting', 'họp', 'cuộc họp', 'zoom', 'teams', 'google meet'],
  'học tập': ['học', 'bài học', 'khóa học', 'tài liệu', 'đọc sách', 'ghi chú'],
  'lập trình': ['code', 'javascript', 'typescript', 'react', 'next.js', 'api', 'bug', 'fix', 'deploy'],
  'tài chính': ['budget', 'chi phí', 'doanh thu', 'lợi nhuận', 'invoice', 'hóa đơn', 'kế toán'],
  'sức khỏe': ['bệnh viện', 'thuốc', 'khám', 'tập gym', 'chạy bộ', 'yoga', 'giấc ngủ'],
  'marketing': ['campaign', 'quảng cáo', 'social media', 'content', 'seo', 'ads'],
  'dự án': ['dự án', 'milestone', 'sprint', 'backlog', 'scope', 'requirement'],
  'family': ['gia đình', 'birthday', 'sinh nhật', 'kỷ niệm', 'đám tiệc'],
  'mua sắm': ['mua', 'shopping', 'shopee', 'lazada', 'thanh toán', 'giỏ hàng'],
  'công thức': ['công thức', 'nấu ăn', 'món ăn', 'nguyên liệu'],
  'ý tưởng': ['ý tưởng', 'brainstorm', 'sáng tạo', 'concept', 'inspiration'],
  'báo cáo': ['báo cáo', 'report', 'analytics', 'data', 'metric', 'kpi'],
}

/** Priority keywords */
const PRIORITY_KEYWORDS: Record<string, Block['priority']> = {
  'khẩn cấp': 'urgent',
  'urgent': 'urgent',
  'cấp bách': 'urgent',
  'asap': 'urgent',
  'quan trọng': 'high',
  'important': 'high',
  'ưu tiên': 'high',
  'priority': 'high',
}

/**
 * Analyze block content and suggest tags based on keyword matching.
 * Returns deduplicated array of suggested tags.
 */
export function suggestTags(block: Pick<Block, 'title' | 'content' | 'type'>): string[] {
  const contentStr = typeof block.content === 'string' ? block.content : ''
  const text = `${block.title ?? ''} ${contentStr}`.toLowerCase()
  const suggested = new Set<string>()

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        suggested.add(tag)
        break
      }
    }
  }

  // Type-based suggestions
  if (block.type === 'code') suggested.add('lập trình')
  if (block.type === 'event') suggested.add('sự kiện')

  return Array.from(suggested)
}

/**
 * Analyze block content and suggest a priority based on urgency keywords.
 */
export function suggestPriority(block: Pick<Block, 'title' | 'content'>): Block['priority'] | null {
  const contentStr = typeof block.content === 'string' ? block.content : ''
  const text = `${block.title ?? ''} ${contentStr}`.toLowerCase()
  for (const [kw, priority] of Object.entries(PRIORITY_KEYWORDS)) {
    if (text.includes(kw)) return priority
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  2. Content Summarization                                          */
/* ------------------------------------------------------------------ */

/** Split text into sentences (handles Vietnamese and English) */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
}

/** Extract key phrases using TF-like scoring */
function extractKeyPhrases(text: string, maxPhrases: number = 5): string[] {
  // Common stop words (Vietnamese + English)
  const stopWords = new Set([
    'và', 'của', 'là', 'có', 'được', 'cho', 'với', 'từ', 'để', 'trong',
    'này', 'đó', 'các', 'một', 'đã', 'sẽ', 'đang', 'the', 'a', 'an',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by', 'for',
    'with', 'about', 'against', 'between', 'through', 'before', 'after',
    'not', 'no', 'nor', 'also', 'very', 'just', 'than', 'that', 'this',
  ])

  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w))

  // Count word frequency
  const freq = new Map<string, number>()
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1)
  }

  // Sort by frequency and return top N
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxPhrases)
    .map(([word]) => word)
}

/**
 * Generate a concise summary of block content.
 * Uses extractive summarization (pick most important sentences).
 */
function extractText(content: string | Record<string, unknown> | null): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  // TipTap JSON — walk nodes to extract plain text
  try {
    const walk = (node: Record<string, unknown>): string => {
      if (node.type === 'text') return String(node.text ?? '')
      const children = node.content as Record<string, unknown>[] | undefined
      if (Array.isArray(children)) return children.map(walk).join(' ')
      return ''
    }
    return walk(content)
  } catch {
    return ''
  }
}

export function summarizeContent(content: string | Record<string, unknown> | null, maxSentences: number = 3): string {
  const text = extractText(content)
  if (!text || text.length < 100) return text

  const sentences = splitSentences(text)
  if (sentences.length <= maxSentences) return text

  // Score sentences by keyword density
  const keyPhrases = extractKeyPhrases(text, 10)
  const keySet = new Set(keyPhrases)

  const scored = sentences.map((s) => {
    const words = s.toLowerCase().split(/\s+/)
    const score = words.filter((w) => keySet.has(w)).length / Math.max(words.length, 1)
    return { sentence: s, score }
  })

  // Pick top N sentences in original order
  const topIndices = scored
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((s) => s.i)

  return topIndices.map((i) => sentences[i]).join(' ')
}

/* ------------------------------------------------------------------ */
/*  3. Smart Reminders / Pattern Detection                            */
/* ------------------------------------------------------------------ */

export interface PatternInsight {
  type: 'recurring_day' | 'time_preference' | 'category_cluster' | 'overdue_risk'
  message: string
  confidence: number // 0-1
}

/**
 * Analyze a user's block history and detect patterns.
 */
export function detectPatterns(blocks: Block[]): PatternInsight[] {
  const insights: PatternInsight[] = []
  const now = new Date()

  // Group by day of week
  const byDay = new Map<number, Block[]>()
  for (const b of blocks) {
    if (!b.start_time) continue
    const d = new Date(b.start_time).getDay()
    byDay.get(d)?.push(b) ?? byDay.set(d, [b])
  }

  // Find the most active day
  let maxDay = -1
  let maxCount = 0
  for (const [day, list] of byDay) {
    if (list.length > maxCount) {
      maxCount = list.length
      maxDay = day
    }
  }
  if (maxDay >= 0 && maxCount >= 3) {
    const dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
    insights.push({
      type: 'recurring_day',
      message: `Bạn thường tạo task vào ${dayNames[maxDay]} (${maxCount} task)`,
      confidence: Math.min(maxCount / 10, 1),
    })
  }

  // Find most common hour
  const byHour = new Map<number, number>()
  for (const b of blocks) {
    if (!b.start_time) continue
    const h = new Date(b.start_time).getHours()
    byHour.set(h, (byHour.get(h) ?? 0) + 1)
  }
  let peakHour = -1
  let peakCount = 0
  for (const [h, c] of byHour) {
    if (c > peakCount) {
      peakCount = c
      peakHour = h
    }
  }
  if (peakHour >= 0 && peakCount >= 3) {
    insights.push({
      type: 'time_preference',
      message: `Bạn hay làm việc lúc ${String(peakHour).padStart(2, '0')}:00`,
      confidence: Math.min(peakCount / 10, 1),
    })
  }

  // Overdue risk — events in the past without 'completed' status
  const overdue = blocks.filter((b) => {
    if (!b.end_time) return false
    if (b.status === 'completed') return false
    return new Date(b.end_time) < now
  })
  if (overdue.length > 0) {
    insights.push({
      type: 'overdue_risk',
      message: `${overdue.length} mục đã quá hạn — cần cập nhật trạng thái`,
      confidence: 0.9,
    })
  }

  // Category cluster — most used tags
  const tagCounts = new Map<string, number>()
  for (const b of blocks) {
    if (!b.tags) continue
    for (const t of b.tags.split(',').map((s) => s.trim()).filter(Boolean)) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    }
  }
  const topTag = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1])[0]
  if (topTag && topTag[1] >= 3) {
    insights.push({
      type: 'category_cluster',
      message: `Chủ đề "${topTag[0]}" chiếm phần lớn (${topTag[1]} mục)`,
      confidence: Math.min(topTag[1] / blocks.length, 1),
    })
  }

  return insights.sort((a, b) => b.confidence - a.confidence)
}

/* ------------------------------------------------------------------ */
/*  4. Content Completion Suggestions                                 */
/* ------------------------------------------------------------------ */

/**
 * Given a partial block, suggest what to add next.
 */
export function suggestNextSteps(block: Block): string[] {
  const suggestions: string[] = []

  const contentText = extractText(block.content)
  if (!contentText || contentText.length < 20) {
    suggestions.push('Thêm mô tả chi tiết cho nội dung này')
  }
  if (!block.tags) {
    const tags = suggestTags(block)
    if (tags.length > 0) {
      suggestions.push(`Gán tag: ${tags.join(', ')}`)
    }
  }
  if (!block.priority || block.priority === 'normal') {
    const pri = suggestPriority(block)
    if (pri) {
      const labels = { urgent: 'Khẩn cấp', high: 'Cao', normal: 'Bình thường', low: 'Thấp' }
      suggestions.push(`Nên đặt ưu tiên: ${labels[pri]}`)
    }
  }
  if (block.type === 'note' && !block.start_time) {
    suggestions.push('Đặt deadline để theo dõi')
  }
  if (block.type === 'event' && !block.end_time) {
    suggestions.push('Thêm thời gian kết thúc')
  }

  return suggestions
}
