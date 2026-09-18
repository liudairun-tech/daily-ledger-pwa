import { localDateKey } from './format'

export type SummaryRange = 'day' | 'week' | 'month' | 'year'

export const summaryRangeLabels: Record<SummaryRange, { short: string; full: string }> = {
  day: { short: '日', full: '本日' },
  week: { short: '周', full: '本周' },
  month: { short: '月', full: '本月' },
  year: { short: '年', full: '本年' }
}

export function startOfSummaryRange(range: SummaryRange, now = new Date()) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (range === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  if (range === 'month') start.setDate(1)
  if (range === 'year') start.setMonth(0, 1)
  return start
}

export function isInSummaryRange(occurredAt: string, range: SummaryRange, now = new Date()) {
  const value = new Date(occurredAt).getTime()
  return value >= startOfSummaryRange(range, now).getTime() && value <= now.getTime()
}

export function isInCustomDateRange(occurredAt: string, startDate: string, endDate: string) {
  const day = localDateKey(occurredAt)
  return (!startDate || day >= startDate) && (!endDate || day <= endDate)
}
