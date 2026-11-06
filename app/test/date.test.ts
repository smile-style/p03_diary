import { describe, expect, it } from 'vitest'
import {
  calendarCells,
  calendarCountMap,
  formatDateLabel,
  monthTitle,
  monthOf,
  shiftMonth,
  todayLocal,
} from '../src/utils/date'

describe('date utilities', () => {
  it('uses local calendar fields for today', () => {
    expect(todayLocal(new Date(2026, 2, 16, 0, 30))).toBe('2026-03-16')
    expect(todayLocal(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
    expect(todayLocal(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('derives a month string from a date string', () => {
    expect(monthOf('2026-11-06')).toBe('2026-11')
  })

  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-02', 0)).toBe('2026-02')
  })

  it('builds 42 calendar cells starting on Sunday', () => {
    const november = calendarCells('2026-11')
    expect(november).toHaveLength(42)
    expect(november[0]).toEqual({ date: '2026-11-01', inMonth: true })

    const october = calendarCells('2026-10')
    expect(october).toHaveLength(42)
    expect(october[0]).toEqual({ date: '2026-09-27', inMonth: false })
  })

  it('maps calendar days to their record counts', () => {
    expect(
      calendarCountMap([
        { date: '2026-11-06', count: 2 },
        { date: '2026-11-20', count: 1 },
      ]),
    ).toEqual({ '2026-11-06': 2, '2026-11-20': 1 })
  })

  it('formats a readable month title', () => {
    expect(monthTitle('2026-11')).toBe('2026年11月')
    expect(monthTitle('2025-01')).toBe('2025年1月')
  })
  it('formats dates with the year only when it differs from today', () => {
    expect(formatDateLabel('2026-11-06', '2026-11-06')).toBe('11月6日')
    expect(formatDateLabel('2025-12-31', '2026-11-06')).toBe('2025年12月31日')
    expect(formatDateLabel('2026-11-06')).toBe('11月6日')
  })
})
