import type { Account, AccountType, TransactionSource, TransactionType } from '../types'

export interface QuickEntryPrefill {
  amount?: string
  account?: AccountType | string
  type?: TransactionType
  merchant?: string
  note?: string
  occurredAt?: string
  source?: TransactionSource
}

export interface QueuedSmsEntry {
  raw: string
  receivedAt?: string
}

const validTypes = new Set<TransactionType>(['expense', 'income', 'refund', 'transfer'])
const validSources = new Set<TransactionSource>(['manual', 'alipay', 'wechat', 'bank', 'ocr'])

function cleanAmount(value?: string | null) {
  if (!value) return undefined
  const match = value.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/)
  return match?.[0]
}

function smsDate(text: string, referenceDate?: string) {
  const full = text.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?\s*(\d{1,2})[:：](\d{2})/)
  const short = text.match(/(\d{1,2})月(\d{1,2})日?\s*(\d{1,2})[:：](\d{2})/)
  const timeOnly = text.match(/(?:活期|账户|卡|于)?\s*(\d{1,2})[:：](\d{2})(?::\d{2})?\s*(?:取出|支出|消费|支付|交易|收入|存入|转入|入账)/)
  const now = referenceDate ? new Date(referenceDate.replace(' ', 'T')) : new Date()
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
export function parseBankSms(text: string, referenceDate?: string): QuickEntryPrefill {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const amountPatterns = [
    /快捷支付\s*([\d,]+(?:\.\d{1,2})?)/,
    /(?:取出|支出|收入|存入|转入|入账)\s*(?:人民币|RMB|CNY|￥|¥)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:消费|支付|支出|交易|扣款|收入|存入|转入|入账)[^\d]{0,12}(?:人民币|RMB|CNY|￥|¥)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:人民币|RMB|CNY|￥|¥)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /金额[^\d]{0,6}([\d,]+(?:\.\d{1,2})?)/
  ]
  const amount = amountPatterns.map(pattern => normalized.match(pattern)?.[1]).find(Boolean)
  const merchantPatterns = [
    /\[([^\]]{2,32})\]/,
    /在\s*([^，,。；;]{2,48}?)(?:快捷支付|支付)\s*[\d,]+(?:\.\d{1,2})?/,
    /(?:商户|商家|交易对方|收款方|支付给)[：:\s]*([^，,。；;]{2,32})/,
    /\d{1,2}[:：]\d{2}(?::\d{2})?\s*([^，,。；;]{2,32}?)(?:支出|消费|支付|交易)/,
    /(?:在|于)[：:\s]*([^，,。；;]{2,32}?)(?:支出|消费|支付|交易)/
  ]
  const merchant = merchantPatterns.map(pattern => normalized.match(pattern)?.[1]?.trim()).find(Boolean)
  const isRefund = /退款|退货/.test(normalized)
  const isIncome = !isRefund && /收入|入账|转入|存入/.test(normalized) && !/支出|消费|扣款/.test(normalized)
  const isTransfer = /充值|提现|还款|账户互转/.test(normalized)
  const bankName = normalized.match(/【([^】]+银行)】/)?.[1]
  return {
    amount: cleanAmount(amount), account: bankName ?? 'bank', type: isRefund ? 'refund' : isTransfer ? 'transfer' : isIncome ? 'income' : 'expense',
    merchant: merchant?.replace(/(?:余额|可用余额).*$/, '').trim(), note: normalized,
    occurredAt: smsDate(normalized, referenceDate), source: 'bank'
  }
}

/**
 * Reads the plain-text queue written by iOS Shortcuts while the phone is locked.
 * The recommended format is one SMS per line. We also accept timestamp-prefixed
 * lines and a visible separator so an older shortcut can be upgraded safely.
 */
export function parseSmsQueue(text: string): QueuedSmsEntry[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r/g, '\n')
  const chunks = normalized.includes('---每日账本---')
    ? normalized.split(/\n?---每日账本---\n?/)
    : normalized.split(/\n+/)

  return chunks.map(value => value.trim()).filter(Boolean).map(line => {
    const prefixed = line.match(/^\s*\[?(20\d{2}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[|｜]\s*([\s\S]+)$/)
    return { raw: (prefixed?.[2] ?? line).trim(), receivedAt: prefixed?.[1] }
  }).filter(entry => /银行|尾号\d{4}|账户\d{4}|卡人民币/.test(entry.raw))
}

function compactAccountName(value: string) {
  return value.replace(/中国|股份有限公司|有限责任公司|储蓄卡|信用卡|银行卡|银行|[\s·-]/g, '')
}

/** Matches an SMS/link prefill to the user's account, preferring the card tail over the bank name. */
export function matchQuickEntryAccount(accounts: Account[], prefill?: QuickEntryPrefill) {
  if (!accounts.length) return undefined
  const requested = prefill?.account
  const direct = accounts.find(account => account.id === requested || account.name === requested)
  if (direct) return direct

  const lastFour = prefill?.note?.match(/(?:尾号|账户|账号|卡号)\s*(\d{4})(?!\d)/)?.[1]
  if (lastFour) {
    const byTail = accounts.find(account => account.type === 'bank' && account.name.includes(lastFour))
    if (byTail) return byTail
  }

  if (requested && requested !== 'bank') {
    const requestedName = compactAccountName(requested)
    const byBankName = accounts.find(account => {
      const accountName = compactAccountName(account.name)
      return account.type === 'bank' && requestedName.length >= 2 && (accountName.includes(requestedName) || requestedName.includes(accountName))
    })
    if (byBankName) return byBankName
  }

  return accounts.find(account => account.type === requested)
    ?? accounts.find(account => account.type === prefill?.source)
    ?? accounts[0]
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
