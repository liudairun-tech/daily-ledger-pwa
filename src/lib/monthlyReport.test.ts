import { describe, expect, it } from 'vitest'
import { monthlyReport, monthlyAnalysis } from './monthlyReport'
import type { LedgerTransaction } from '../types'

const row = (type: LedgerTransaction['type'], amountCents: number, month = 9): LedgerTransaction => ({ id: crypto.randomUUID(), type, amountCents, occurredAt: new Date(2026, month, 2, 10).toISOString(), currency: 'CNY', accountId: 'a', merchant: '测试', note: '', source: 'manual', fingerprint: '', status: 'confirmed', manuallyEdited: false, createdAt: '', updatedAt: '' })
describe('月报统计口径', () => {
  it('月中只比较两个月相同日期范围，退款与转账正确处理', () => {
    const priorEarly = row('expense', 10000, 8)
    const priorLate = { ...row('expense', 50000, 8), occurredAt: new Date(2026, 8, 20).toISOString() }
    const analysis = monthlyAnalysis([priorEarly, priorLate, row('expense', 15000), row('refund', 2000), row('transfer', 90000)], [], '2026-10', new Date(2026, 9, 10, 23))
    expect(analysis.previous.expense).toBe(10000)
    expect(analysis.current.expense).toBe(13000)
    expect(analysis.changes[0]!.delta).toBe(3000)
    expect(analysis.scope).toContain('1～10 日')
    expect(analysis.trend[0]!.hasData).toBe(false)
  })
  it('跨年六个月趋势正确，完整月份按整月比较', () => {
    const analysis = monthlyAnalysis([], [], '2026-01', new Date(2026, 10, 1))
    expect(analysis.trend.map(t => t.month)).toEqual(['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01'])
    expect(analysis.comparisonAvailable).toBe(false)
  })
  it('转账不计收支，退款冲减支出，并排除其他月份', () => {
    const result = monthlyReport([row('income', 50000), row('expense', 12000), row('refund', 2000), row('transfer', 90000), row('expense', 99900, 8)], [], '2026-10', new Date(2026, 10, 1))
    expect(result).toMatchObject({ income: 50000, expense: 10000, balance: 40000, count: 4 })
    expect(result.text).toContain('账户转账 1 笔，不计入收支')
  })
  it('本月不计算整月环比，空月份不虚构消费建议', () => {
    const result = monthlyReport([], [], '2026-11', new Date(2026, 10, 1))
    expect(result.text).toContain('暂不计算整月环比')
    expect(result.text).toContain('本月尚无记录')
  })
})
