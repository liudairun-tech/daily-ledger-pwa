import type { LedgerTransaction, TransactionType } from '../types'

export const yuan = (cents: number) => new Intl.NumberFormat('zh-CN', {
  style: 'currency', currency: 'CNY', minimumFractionDigits: 2
}).format(cents / 100)

export const parseAmountToCents = (value: string | number): number => {
  const cleaned = String(value).replace(/[¥￥元,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  const number = Number.parseFloat(cleaned)
  return Number.isFinite(number) ? Math.round(Math.abs(number) * 100) : 0
}

export const localDateKey = (date: string | Date) => {
  const d = typeof date === 'string' ? new Date(date) : date
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const monthKey = (date: string | Date) => localDateKey(date).slice(0, 7)

export const typeLabel: Record<TransactionType, string> = {
  expense: '支出', income: '收入', refund: '退款', transfer: '转账'
}

export const transactionImpact = (transaction: Pick<LedgerTransaction, 'type' | 'amountCents'>) => {
  if (transaction.type === 'income' || transaction.type === 'refund') return transaction.amountCents
  if (transaction.type === 'expense') return -transaction.amountCents
  return 0
}

export const dateTimeLocalValue = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date()
  const offset = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offset).toISOString().slice(0, 16)
}

export const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
