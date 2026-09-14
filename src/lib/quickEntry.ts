import type { AccountType, TransactionSource, TransactionType } from '../types'

export interface QuickEntryPrefill {
  amount?: string
  account?: AccountType | string
  type?: TransactionType
  merchant?: string
  note?: string
  occurredAt?: string
  source?: TransactionSource
}

const validTypes = new Set<TransactionType>(['expense', 'income', 'refund', 'transfer'])
const validSources = new Set<TransactionSource>(['manual', 'alipay', 'wechat', 'bank', 'ocr'])

function cleanAmount(value?: string | null) {
  if (!value) return undefined
  const match = value.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/)
  return match?.[0]
}

function smsDate(text: string) {
  const full = text.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?\s*(\d{1,2})[:：](\d{2})/)
  const short = text.match(/(\d{1,2})月(\d{1,2})日?\s*(\d{1,2})[:：](\d{2})/)
  const timeOnly = text.match(/(?:活期|账户|卡|于)?\s*(\d{1,2})[:：](\d{2})(?::\d{2})?\s*(?:取出|支出|消费|支付|交易)/)
  const now = new Date()
  const parts = full
    ? [Number(full[1]), Number(full[2]), Number(full[3]), Number(full[4]), Number(full[5])]
    : short
      ? [now.getFullYear(), Number(short[1]), Number(short[2]), Number(short[3]), Number(short[4])]
      : timeOnly
        ? [now.getFullYear(), now.getMonth() + 1, now.getDate(), Number(timeOnly[1]), Number(timeOnly[2])]
        : undefined
  if (!parts) return undefined
  const value = new Date(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!)
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
}

/** Extracts common Chinese bank-card debit SMS fields locally. */
export function parseBankSms(text: string): QuickEntryPrefill {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const amountPatterns = [
    /(?:取出|支出)\s*([\d,]+(?:\.\d{1,2})?)/,
    /(?:消费|支付|支出|交易|扣款)[^\d]{0,12}(?:人民币|RMB|CNY|￥|¥)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:人民币|RMB|CNY|￥|¥)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /金额[^\d]{0,6}([\d,]+(?:\.\d{1,2})?)/
  ]
  const amount = amountPatterns.map(pattern => normalized.match(pattern)?.[1]).find(Boolean)
  const merchantPatterns = [
    /\[([^\]]{2,32})\]/,
    /(?:商户|商家|交易对方|收款方|支付给)[：:\s]*([^，,。；;]{2,32})/,
    /\d{1,2}[:：]\d{2}(?::\d{2})?\s*([^，,。；;]{2,32}?)(?:支出|消费|支付|交易)/,
    /(?:在|于)[：:\s]*([^，,。；;]{2,32}?)(?:支出|消费|支付|交易)/
  ]
  const merchant = merchantPatterns.map(pattern => normalized.match(pattern)?.[1]?.trim()).find(Boolean)
  const isRefund = /退款|退货/.test(normalized)
  const isIncome = !isRefund && /收入|入账|转入/.test(normalized) && !/支出|消费|扣款/.test(normalized)
  const bankName = normalized.match(/【([^】]+银行)】/)?.[1]
  return {
    amount: cleanAmount(amount), account: bankName ?? 'bank', type: isRefund ? 'refund' : isIncome ? 'income' : 'expense',
    merchant: merchant?.replace(/(?:余额|可用余额).*$/, '').trim(), note: normalized,
    occurredAt: smsDate(normalized), source: 'bank'
  }
}

export function readQuickEntryPrefill(hash = location.hash): QuickEntryPrefill {
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  const sms = params.get('sms')
  const fromSms = sms ? parseBankSms(sms) : {}
  const requestedType = params.get('type') as TransactionType | null
  const requestedSource = params.get('source') as TransactionSource | null
  return {
    ...fromSms,
    amount: cleanAmount(params.get('amount')) ?? fromSms.amount,
    account: params.get('account') ?? fromSms.account,
    type: requestedType && validTypes.has(requestedType) ? requestedType : fromSms.type,
    merchant: params.get('merchant')?.slice(0, 80) || fromSms.merchant,
    note: params.get('note')?.slice(0, 300) || fromSms.note,
    occurredAt: params.get('date') || fromSms.occurredAt,
    source: requestedSource && validSources.has(requestedSource) ? requestedSource : fromSms.source
  }
}
