import type { Block, BlockPriority, BlockStatus } from '@/types'

const DAY_MAP: Record<string, number> = {
  'thứ hai': 1, 'thứ 2': 1, 't2': 1,
  'thứ ba': 2, 'thứ 3': 2, 't3': 2,
  'thứ tư': 3, 'thứ 4': 3, 't4': 3,
  'thứ năm': 4, 'thứ 5': 4, 't5': 4,
  'thứ sáu': 5, 'thứ 6': 5, 't6': 5,
  'thứ bảy': 6, 'thứ 7': 6, 't7': 6,
  'chủ nhật': 0, 'cn': 0, 'ch nhật': 0,
}

const TIME_PERIOD_MAP: Record<string, number> = {
  'buổi sáng': 9, 'sáng': 9,
  'buổi trưa': 12, 'trưa': 12,
  'buổi chiều': 15, 'chiều': 15,
  'buổi tối': 19, 'tối': 19,
}

const RECURRENCE_MAP: Record<string, string> = {
  'hàng ngày': 'FREQ=DAILY', 'mỗi ngày': 'FREQ=DAILY',
  'hàng tuần': 'FREQ=WEEKLY', 'mỗi tuần': 'FREQ=WEEKLY',
  'hàng tháng': 'FREQ=MONTHLY', 'mỗi tháng': 'FREQ=MONTHLY',
  'hàng quý': 'FREQ=MONTHLY;INTERVAL=3', 'mỗi quý': 'FREQ=MONTHLY;INTERVAL=3',
  'hàng năm': 'FREQ=YEARLY', 'mỗi năm': 'FREQ=YEARLY',
}

const PRIORITY_MAP: Record<string, BlockPriority> = {
  'khẩn cấp': 'urgent', 'urgent': 'urgent', 'cấp bách': 'urgent',
  'cao': 'high', 'high': 'high',
  'thấp': 'low', 'low': 'low',
}

const STATUS_MAP: Record<string, BlockStatus> = {
  'hoàn thành': 'completed', 'completed': 'completed', 'xong': 'completed', 'done': 'completed',
  'từ chối': 'rejected', 'rejected': 'rejected',
  'đã duyệt': 'approved', 'approved': 'approved',
  'chờ': 'pending', 'pending': 'pending',
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function nextWeekday(dayOfWeek: number): Date {
  const now = new Date()
  const diff = (dayOfWeek - now.getDay() + 7) % 7 || 7
  const d = new Date(now)
  d.setDate(d.getDate() + diff)
  return d
}

function parseTime(text: string): { hours: number; minutes: number; explicit: boolean } | null {
  const lower = normalize(text)
  for (const [key, hours] of Object.entries(TIME_PERIOD_MAP)) {
    if (lower.includes(normalize(key))) return { hours, minutes: 0, explicit: false }
  }
  const m = text.match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?\s*(?:CH|PM|ch|pm)?/i)
  if (m) {
    let hours = parseInt(m[1], 10)
    const minutes = m[2] ? parseInt(m[2], 10) : 0
    const isPM = /(?:CH|PM|ch|pm)/i.test(m[0])
    if (isPM && hours < 12) hours += 12
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) return { hours, minutes, explicit: true }
  }
  return null
}

function parseDateExpression(text: string): Date | null {
  const lower = normalize(text)
  if (/\bhom nay\b/.test(lower)) return new Date()
  if (/\bmai\b|\bngay mai\b/.test(lower)) {
    const d = new Date(); d.setDate(d.getDate() + 1); return d
  }
  if (/\btuan sau\b/.test(lower)) {
    const d = new Date(); d.setDate(d.getDate() + 7); return d
  }
  for (const [key, dayNum] of Object.entries(DAY_MAP)) {
    if (lower.includes(normalize(key))) return nextWeekday(dayNum)
  }
  const engDays: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  }
  for (const [eng, num] of Object.entries(engDays)) {
    if (lower.includes(eng)) return nextWeekday(num)
  }
  const dateMatch = lower.match(/ngày\s*(\d{1,2})(?:\/(\d{1,2}))?/)
  if (dateMatch) {
    const d = new Date()
    d.setDate(parseInt(dateMatch[1], 10))
    if (dateMatch[2]) d.setMonth(parseInt(dateMatch[2], 10) - 1)
    if (d < new Date()) d.setFullYear(d.getFullYear() + 1)
    return d
  }
  return null
}

function extractLocation(text: string): { location: string; cleaned: string } | null {
  const m = text.match(/(?:tại|ở)\s+(.+?)(?:\s+(?:vào|lúc|ngày|hàng|mỗi|với|cùng)|\s*$)/i)
  if (!m) return null
  const loc = m[1].trim().replace(/\s+$/, '')
  return { location: loc, cleaned: text.slice(0, m.index).trim() + ' ' + text.slice(m.index! + m[0].length).trim() }
}

function extractParticipant(text: string): { participant: string; cleaned: string } | null {
  const m = text.match(/(?:với|cùng)\s+(\S+)(?:\s|$)/i)
  if (!m) return null
  const part = m[1].trim()
  return { participant: part, cleaned: text.slice(0, m.index).trim() + ' ' + text.slice(m.index! + m[0].length).trim() }
}

function extractRecurrence(text: string): { rrule: string; cleaned: string } | null {
  const lower = normalize(text)
  for (const [key, rrule] of Object.entries(RECURRENCE_MAP)) {
    if (lower.includes(normalize(key))) {
      const idx = lower.indexOf(normalize(key))
      const original = text.slice(idx, idx + key.length)
      return { rrule, cleaned: text.replace(original, '').trim() }
    }
  }
  return null
}

function extractPriority(text: string): { priority: BlockPriority; cleaned: string } | null {
  for (const [key, priority] of Object.entries(PRIORITY_MAP)) {
    const re = new RegExp(`\\b${key}\\b`, 'i')
    if (re.test(text)) return { priority, cleaned: text.replace(re, '').trim() }
  }
  return null
}

function extractStatus(text: string): { status: BlockStatus; cleaned: string } | null {
  for (const [key, status] of Object.entries(STATUS_MAP)) {
    const re = new RegExp(`\\b${key}\\b`, 'i')
    if (re.test(text)) return { status, cleaned: text.replace(re, '').trim() }
  }
  return null
}

function inferType(text: string): 'event' | 'note' {
  const lower = normalize(text)
  const kw = ['họp', 'hop', 'cuộc họp', 'deadline', 'nộp', 'sự kiện', 'điểm danh']
  return kw.some((k) => lower.includes(k)) ? 'event' : 'note'
}

function cleanTitle(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim()
}

export interface NlpCaptureResult {
  type: 'event' | 'note'
  title: string
  start_time?: string
  end_time?: string
  recurrence?: string
  priority?: BlockPriority
  status?: BlockStatus
  location?: string
  participant?: string
}

export function parseNlpCapture(text: string): NlpCaptureResult {
  let remaining = text.trim()
  let type = inferType(remaining)

  const loc = extractLocation(remaining)
  if (loc) remaining = loc.cleaned

  const part = extractParticipant(remaining)
  if (part) remaining = part.cleaned

  const rec = extractRecurrence(remaining)
  if (rec) { remaining = rec.cleaned; type = 'event' }

  const pri = extractPriority(remaining)
  if (pri) remaining = pri.cleaned

  const stat = extractStatus(remaining)
  if (stat) remaining = stat.cleaned

  const date = parseDateExpression(remaining)
  const time = parseTime(remaining)

  let start_time: string | undefined
  let end_time: string | undefined

  if (date) {
    type = 'event'
    const base = new Date(date)
    if (time) {
      base.setHours(time.hours, time.minutes, 0, 0)
    } else {
      base.setHours(9, 0, 0, 0)
    }
    start_time = base.toISOString()
    end_time = new Date(base.getTime() + 60 * 60 * 1000).toISOString()
  } else if (time) {
    if (time.explicit || type === 'event') {
      type = 'event'
      const base = new Date()
      base.setHours(time.hours, time.minutes, 0, 0)
      if (base < new Date()) base.setDate(base.getDate() + 1)
      start_time = base.toISOString()
      end_time = new Date(base.getTime() + 60 * 60 * 1000).toISOString()
    }
  }

  const title = cleanTitle(remaining)

  const result: NlpCaptureResult = {
    type,
    title: title || text.trim(),
  }
  if (start_time) result.start_time = start_time
  if (end_time) result.end_time = end_time
  if (rec?.rrule) result.recurrence = rec.rrule
  if (pri?.priority) result.priority = pri.priority
  if (stat?.status) result.status = stat.status
  if (loc?.location) result.location = loc.location
  if (part?.participant) result.participant = part.participant
  return result
}