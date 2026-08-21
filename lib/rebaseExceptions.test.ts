import { describe, expect, it } from 'vitest'
import { shiftExceptions } from '@/lib/rebaseExceptions'

describe('shiftExceptions', () => {
  it('returns null when exceptions are empty', () => {
    expect(shiftExceptions([], '2026-08-01', '2026-08-03', true)).toBeNull()
  })

  it('returns null when delta is zero', () => {
    expect(
      shiftExceptions(['2026-08-15', '2026-08-22'], '2026-08-01', '2026-08-01', true),
    ).toBeNull()
  })

  it('shifts all-day exceptions by calendar days', () => {
    const result = shiftExceptions(
      ['2026-08-15', '2026-08-22'],
      '2026-08-01',
      '2026-08-03', // +2 days
      true,
    )
    expect(result).toEqual(['2026-08-17', '2026-08-24'])
  })

  it('shifts all-day exceptions backwards (negative delta)', () => {
    const result = shiftExceptions(
      ['2026-08-15', '2026-08-22'],
      '2026-08-05',
      '2026-08-01', // -4 days
      true,
    )
    expect(result).toEqual(['2026-08-11', '2026-08-18'])
  })

  it('shifts timed exceptions by ISO-instant delta', () => {
    const result = shiftExceptions(
      ['2026-08-15T02:00:00.000Z', '2026-08-22T02:00:00.000Z'],
      '2026-08-01T02:00:00Z',
      '2026-08-03T02:00:00Z', // +2 days
      false,
    )
    expect(result).toEqual([
      '2026-08-17T02:00:00.000Z',
      '2026-08-24T02:00:00.000Z',
    ])
  })

  it('preserves unparseable exception entries', () => {
    const result = shiftExceptions(
      ['not-a-date', '2026-08-15'],
      '2026-08-01',
      '2026-08-03',
      true,
    )
    expect(result).toEqual(['not-a-date', '2026-08-17'])
  })

  it('returns null when old/new start is unparseable', () => {
    expect(
      shiftExceptions(['2026-08-15'], 'bad-date', '2026-08-03', true),
    ).toBeNull()
  })
})
