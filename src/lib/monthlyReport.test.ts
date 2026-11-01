import { describe, expect, it } from 'vitest'
import { monthlyReport } from './monthlyReport'
import type { LedgerTransaction } from '../types'

const row = (type: LedgerTransaction['type'], amountCents: number, month = 9): LedgerTransaction => ({ id: crypto.randomUUID(), type, amountCents, occurredAt: new Date(2026, month, 2, 10).toISOString(), currency: 'CNY', accountId: 'a', merchant: '测试', note: '', source: 'manual', fingerprint: '', status: 'confirmed', manuallyEdited: false, createdAt: '', updatedAt: '' })
describe('月报统计口径', () => {
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
