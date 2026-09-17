import JSZip from 'jszip'
import Papa from 'papaparse'
import { makeFingerprint, normalizeText } from './fingerprint'
import { parseAmountToCents } from './format'
import type { Account, GenericColumnMap, ImportCandidate, TransactionSource, TransactionType } from '../types'
import { parseBankSms, parseSmsQueue } from './quickEntry'

export interface ParsedFile {
  source: Exclude<TransactionSource, 'manual' | 'ocr'> | 'unknown'
  headers: string[]
  rows: Record<string, string>[]
  text: string
}

const cleanHeader = (value: string) => value.replace(/^\uFEFF/, '').trim().replace(/\s+/g, '')
const pick = (row: Record<string, string>, aliases: string[]) => {
  const match = Object.keys(row).find(key => aliases.some(alias => cleanHeader(key).includes(alias)))
  return match ? String(row[match] ?? '').trim() : ''
}

export async function hashBuffer(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function decodeBuffer(buffer: ArrayBuffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  const replacementRatio = (utf8.match(/�/g)?.length ?? 0) / Math.max(utf8.length, 1)
  if (replacementRatio < 0.002) return utf8
  try { return new TextDecoder('gb18030').decode(buffer) } catch { return utf8 }
}

export async function extractTextFromFile(file: File) {
  const buffer = await file.arrayBuffer()
  if (file.name.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(buffer)
    const entry = Object.values(zip.files).find(item => !item.dir && /\.(csv|txt)$/i.test(item.name))
    if (!entry) throw new Error('压缩包中没有找到 CSV 或 TXT 账单')
    return decodeBuffer(await entry.async('arraybuffer'))
  }
  return decodeBuffer(buffer)
}

function findTableStart(lines: string[]) {
  const required = ['交易时间', '交易创建时间', '金额', '日期', '交易日期', '时间']
  const index = lines.findIndex(line => /[,\t]/.test(line) && required.some(word => line.includes(word)))
  return index >= 0 ? index : 0
}

export async function parseStatement(file: File): Promise<ParsedFile> {
  const text = await extractTextFromFile(file)
  const lines = text.split(/\r?\n/)
  const tableText = lines.slice(findTableStart(lines)).join('\n')
  const delimiter = tableText.split('\n')[0]?.includes('\t') ? '\t' : ''
  const parsed = Papa.parse<Record<string, string>>(tableText, {
    header: true,
    delimiter,
    skipEmptyLines: 'greedy',
    transformHeader: cleanHeader,
    transform: value => value.trim()
  })
  if (!parsed.meta.fields?.length || parsed.data.length === 0) throw new Error('没有识别到账单表格，请检查文件格式')
  const sample = `${parsed.meta.fields.join('|')}\n${tableText.slice(0, 1000)}`
  const source = /支付宝|交易创建时间|资金状态/.test(sample) ? 'alipay'
    : /微信支付|交易类型|支付方式/.test(sample) ? 'wechat'
      : /银行|借方|贷方|卡号|账户/.test(sample) ? 'bank' : 'unknown'
  return { source, headers: parsed.meta.fields, rows: parsed.data, text }
}

function compactBankName(value: string) {
  return value.replace(/中国|股份有限公司|有限责任公司|银行|[\s·-]/g, '')
}

function accountForBankSms(requested: string | undefined, raw: string, accounts: Account[]) {
  const lastFour = raw.match(/(?:尾号|账户|账号|卡号)\s*(\d{4})(?!\d)/)?.[1]
  const requestedName = requested && requested !== 'bank' ? compactBankName(requested) : ''
  const activeBanks = accounts.filter(account => account.type === 'bank' && !account.inactive)
  const exact = activeBanks.find(account => {
    const name = compactBankName(account.name)
    return requestedName && name.length >= 2 && (name.includes(requestedName) || requestedName.includes(name))
  })
  const byTail = lastFour ? activeBanks.find(account => account.name.includes(lastFour)) : undefined
  return (byTail ?? exact ?? activeBanks[0] ?? accounts.find(account => !account.inactive))?.id ?? ''
}

/** Turns a Shortcuts SMS queue file into reviewable import candidates. */
export function candidatesFromSmsQueue(text: string, accounts: Account[]): ImportCandidate[] {
  return parseSmsQueue(text).map(entry => {
    const parsed = parseBankSms(entry.raw, entry.receivedAt)
    const occurredAt = parsed.occurredAt ?? (entry.receivedAt ? new Date(entry.receivedAt.replace(' ', 'T')).toISOString() : '')
    const amountCents = parseAmountToCents(parsed.amount ?? '')
    const accountId = accountForBankSms(parsed.account, entry.raw, accounts)
    const type = parsed.type ?? 'expense'
    const merchant = parsed.merchant || parsed.account || '银行短信'
    const issue = !amountCents ? '未识别到金额，请手工输入' : !occurredAt ? '未识别到交易时间，请手工选择' : !accountId ? '没有可用的银行卡账户' : undefined
    return {
      id: crypto.randomUUID(), source: 'bank', type, amountCents, occurredAt, merchant,
      note: entry.raw, accountId, categoryId: guessCategory(merchant, entry.raw, type), raw: { sms: entry.raw },
      confidence: issue ? 0.35 : 0.9,
      fingerprint: makeFingerprint({ occurredAt: occurredAt || new Date(0).toISOString(), amountCents, type, merchant, accountId }),
      state: issue ? 'invalid' : 'ready', issue
    }
  })
}

const parseDate = (value: string) => {
  if (!value) return ''
  const normalized = value.replace(/[年/.]/g, '-').replace('月', '-').replace('日', '').trim()
  const parsed = new Date(normalized.replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function classifyType(direction: string, status: string, summary: string): TransactionType {
  const all = `${direction}|${status}|${summary}`
  if (/退款|退回|撤销/.test(all)) return 'refund'
  if (/转账|提现|充值|还款|资金转移/.test(all)) return 'transfer'
  if (/收入|贷方|入账|收款/.test(direction)) return 'income'
  return 'expense'
}

function defaultMap(source: ParsedFile['source']): GenericColumnMap {
  if (source === 'alipay') return { date: '交易创建时间', amount: '金额', direction: '收/支', merchant: '交易对方', note: '商品名称', externalId: '交易号' }
  if (source === 'wechat') return { date: '交易时间', amount: '金额', direction: '收/支', merchant: '交易对方', note: '商品', externalId: '交易单号' }
  return { date: '', amount: '' }
}

function valueFor(row: Record<string, string>, selected: string | undefined, aliases: string[]) {
  if (selected) {
    const key = Object.keys(row).find(item => cleanHeader(item).includes(cleanHeader(selected)))
    if (key) return row[key] ?? ''
  }
  return pick(row, aliases)
}

export function rowsToCandidates(parsed: ParsedFile, accountId: string, map?: GenericColumnMap): ImportCandidate[] {
  const selected = map ?? defaultMap(parsed.source)
  const source = parsed.source === 'unknown' ? 'bank' : parsed.source
  return parsed.rows.map(row => {
    const occurredAt = parseDate(valueFor(row, selected.date, ['交易创建时间', '交易时间', '交易日期', '记账日期', '日期', '时间']))
    const rawAmount = valueFor(row, selected.amount, ['金额（元）', '金额(元)', '交易金额', '金额', '支出', '收入'])
    const amountCents = parseAmountToCents(rawAmount)
    const direction = valueFor(row, selected.direction, ['收/支', '收支', '借贷标志', '方向', '交易类型'])
    const merchant = valueFor(row, selected.merchant, ['交易对方', '商户名称', '对方户名', '摘要', '商户'])
    const note = valueFor(row, selected.note, ['商品名称', '商品', '交易摘要', '备注', '说明'])
    const externalId = valueFor(row, selected.externalId, ['交易单号', '交易号', '流水号', '商户单号']) || undefined
    const status = pick(row, ['交易状态', '当前状态', '资金状态', '状态'])
    const type = classifyType(direction, status, `${merchant}${note}`)
    const invalidStatus = /失败|已关闭|未支付|已撤销/.test(status)
    const fingerprint = makeFingerprint({ occurredAt: occurredAt || new Date(0).toISOString(), amountCents, type, merchant, accountId })
    const issue = !occurredAt ? '日期无法识别' : !amountCents ? '金额无法识别' : invalidStatus ? `忽略状态：${status}` : undefined
    return {
      id: crypto.randomUUID(), source, externalId, type, amountCents, occurredAt, merchant: merchant || note || '未命名交易', note,
      accountId, raw: row, confidence: issue ? 0.35 : externalId ? 0.98 : 0.82, fingerprint,
      state: issue ? 'invalid' : 'ready', issue
    }
  })
}

const categoryKeywords: Array<[string, string]> = [
  ['餐饮|早餐|午餐|晚餐|饭店|餐厅|咖啡|奶茶|饿了么|美团外卖|麦当劳|肯德基', 'cat-food'],
  ['地铁|公交|滴滴|铁路|航空|加油|停车|ETC|通行费', 'cat-transport'],
  ['医院|药房|医疗|诊所', 'cat-health'],
  ['电影|游戏|娱乐|视频|音乐', 'cat-fun'],
  ['房租|物业|水费|电费|燃气', 'cat-home'],
  ['工资|薪资|奖金', 'cat-salary']
]

export function guessCategory(merchant: string, note: string, type: TransactionType) {
  if (type === 'income') return 'cat-income'
  const haystack = normalizeText(`${merchant}${note}`)
  return categoryKeywords.find(([pattern]) => new RegExp(pattern).test(haystack))?.[1] ?? 'cat-other'
}

function ocrField(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*[:：]?\\s*([^\\n\\r]{2,80})`))
    if (match?.[1]) return match[1].trim()
  }
  return ''
}

function ocrAmount(text: string) {
  const normalized = text.replace(/[−–—﹣]/g, '-').replace(/[，]/g, ',')
  const patterns: Array<[RegExp, number]> = [
    [/[¥￥]\s*([+-]?\s*[0-9,]+(?:\.\d{1,2})?)/g, 100],
    [/(?:金额|合计|实付|付款)\s*[:：]?\s*([+-]?\s*[0-9,]+(?:\.\d{1,2})?)/g, 95],
    [/(?:^|\n)\s*(-\s*[0-9,]+\.\d{2})\s*(?:元)?\s*(?=\n|$)/g, 90],
    [/(?:^|\n)\s*([0-9,]+\.\d{2})\s*(?:元)?\s*(?=\n|$)/g, 55]
  ]
  const candidates = patterns.flatMap(([pattern, score]) => [...normalized.matchAll(pattern)].map(match => ({ value: match[1] ?? '', score })))
  candidates.sort((left, right) => right.score - left.score)
  return parseAmountToCents(candidates[0]?.value ?? '')
}

function matchPaymentAccount(paymentMethod: string, fallbackId: string, accounts: Account[]) {
  if (/零钱|微信|财付通/.test(paymentMethod)) return accounts.find(account => account.type === 'wechat')?.id ?? fallbackId
  if (/支付宝|花呗/.test(paymentMethod)) return accounts.find(account => account.type === 'alipay')?.id ?? fallbackId
  const compact = (value: string) => value.replace(/中国|股份有限公司|有限责任公司|储蓄卡|信用卡|银行卡|银行|[\s·-]/g, '')
  const method = compact(paymentMethod)
  if (!method) return fallbackId
  return accounts.find(account => {
    const name = compact(account.name)
    return name.length >= 2 && (method.includes(name) || name.includes(method))
  })?.id ?? fallbackId
}

export function candidatesFromOcr(text: string, accountId: string, accounts: Account[] = []): ImportCandidate[] {
  const normalizedText = text.replace(/\r/g, '')
  const amountCents = ocrAmount(normalizedText)
  const dateMatch = text.match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/)
  const occurredAt = parseDate(dateMatch?.[0] ?? '') || new Date().toISOString()
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const merchant = ocrField(normalizedText, ['商户全称', '商户名称', '交易对方', '收款方'])
    || lines.find(line => line.length >= 2 && line.length <= 28 && !/[¥￥]|金额|付款成功|支付成功|交易时间|支付时间|账单|全部账单|当前状态|商品|商户/.test(line))
    || '截图识别'
  const product = ocrField(normalizedText, ['商品名称', '商品'])
  const paymentMethod = ocrField(normalizedText, ['支付方式', '付款方式'])
  const externalId = ocrField(normalizedText, ['交易单号', '交易号']).match(/[A-Za-z0-9]{10,}/)?.[0]
  const type: TransactionType = /退款/.test(text) ? 'refund' : /收款|收入/.test(text) ? 'income' : 'expense'
  const resolvedAccountId = matchPaymentAccount(paymentMethod, accountId, accounts)
  const fingerprint = makeFingerprint({ occurredAt, amountCents, type, merchant, accountId: resolvedAccountId })
  return [{
    id: crypto.randomUUID(), source: 'ocr', externalId, type, amountCents, occurredAt, merchant,
    note: [product, paymentMethod && `支付方式：${paymentMethod}`, '由截图 OCR 识别'].filter(Boolean).join('；'), accountId: resolvedAccountId,
    raw: { ocrText: text }, confidence: amountCents ? (dateMatch ? 0.82 : 0.68) : 0.25, fingerprint,
    state: amountCents ? 'ready' : 'invalid', issue: amountCents ? undefined : '未识别到金额'
  }]
}
