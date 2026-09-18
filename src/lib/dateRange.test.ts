import { describe, expect, it } from 'vitest'
import { isInCustomDateRange, isInSummaryRange, startOfSummaryRange } from './dateRange'

describe('date range helpers', () => {
  const now = new Date(2026, 8, 18, 15, 30)

  it('starts day, week, month and year in the device timezone', () => {
    expect(startOfSummaryRange('day', now)).toEqual(new Date(2026, 8, 18))
    expect(startOfSummaryRange('week', now)).toEqual(new Date(2026, 8, 14))
    expect(startOfSummaryRange('month', now)).toEqual(new Date(2026, 8, 1))
    expect(startOfSummaryRange('year', now)).toEqual(new Date(2026, 0, 1))
  })

  it('keeps future entries out of the current summary period', () => {
    expect(isInSummaryRange(new Date(2026, 8, 18, 10).toISOString(), 'day', now)).toBe(true)
    expect(isInSummaryRange(new Date(2026, 8, 18, 16).toISOString(), 'day', now)).toBe(false)
  })

  it('filters an inclusive custom date range', () => {
    const value = new Date(2026, 8, 18, 23, 59).toISOString()
    expect(isInCustomDateRange(value, '2026-09-18', '2026-09-18')).toBe(true)
    expect(isInCustomDateRange(value, '2026-09-01', '2026-09-17')).toBe(false)
  })
})
