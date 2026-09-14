import Papa from 'papaparse'
import { db } from '../db'
import type { Account, AppSetting, Category, CategoryRule, ImportBatch, ImportCandidate, LedgerTransaction } from '../types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))

export interface BackupPayload {
  format: 'daily-ledger-backup'
  version: 1
  exportedAt: string
  accounts: Account[]
  categories: Category[]
  transactions: LedgerTransaction[]
  importBatches: ImportBatch[]
  importCandidates: ImportCandidate[]
  categoryRules: CategoryRule[]
  settings: AppSetting[]
}

export interface EncryptedBackup {
  format: 'daily-ledger-encrypted'
  version: 1
  algorithm: 'AES-GCM-256'
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

export async function readAllData(): Promise<BackupPayload> {
  const [accounts, categories, transactions, importBatches, importCandidates, categoryRules, settings] = await Promise.all([
    db.accounts.toArray(), db.categories.toArray(), db.transactions.toArray(), db.importBatches.toArray(),
    db.importCandidates.toArray(), db.categoryRules.toArray(), db.settings.toArray()
  ])
  return { format: 'daily-ledger-backup', version: 1, exportedAt: new Date().toISOString(), accounts, categories, transactions, importBatches, importCandidates, categoryRules, settings }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptBackup(payload: BackupPayload, password: string, iterations = 600_000): Promise<EncryptedBackup> {
  if (password.length < 8) throw new Error('备份密码至少需要 8 个字符')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, iterations)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)))
  return { format: 'daily-ledger-encrypted', version: 1, algorithm: 'AES-GCM-256', kdf: 'PBKDF2-SHA256', iterations, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
}

export async function decryptBackup(envelope: EncryptedBackup, password: string): Promise<BackupPayload> {
  if (envelope.format !== 'daily-ledger-encrypted' || envelope.version !== 1) throw new Error('不支持的备份文件')
  try {
    const salt = fromBase64(envelope.salt)
    const iv = fromBase64(envelope.iv)
    const key = await deriveKey(password, salt, envelope.iterations)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(envelope.ciphertext))
    const payload = JSON.parse(decoder.decode(plain)) as BackupPayload
    if (payload.format !== 'daily-ledger-backup') throw new Error('备份内容无效')
    return payload
  } catch {
    throw new Error('密码错误或备份文件已损坏')
  }
}

export async function restoreAllData(payload: BackupPayload) {
  await db.transaction('rw', [db.accounts, db.categories, db.transactions, db.importBatches, db.importCandidates, db.categoryRules, db.settings], async () => {
    await Promise.all([db.accounts.clear(), db.categories.clear(), db.transactions.clear(), db.importBatches.clear(), db.importCandidates.clear(), db.categoryRules.clear(), db.settings.clear()])
    await db.accounts.bulkPut(payload.accounts)
    await db.categories.bulkPut(payload.categories)
    await db.transactions.bulkPut(payload.transactions)
    await db.importBatches.bulkPut(payload.importBatches)
    await db.importCandidates.bulkPut(payload.importCandidates)
    await db.categoryRules.bulkPut(payload.categoryRules)
    await db.settings.bulkPut(payload.settings)
  })
}

export function transactionsCsv(transactions: LedgerTransaction[], accounts: Account[], categories: Category[]) {
  const accountMap = new Map(accounts.map(item => [item.id, item.name]))
  const categoryMap = new Map(categories.map(item => [item.id, item.name]))
  return Papa.unparse(transactions.map(item => ({
    日期: item.occurredAt, 类型: item.type, 金额元: (item.amountCents / 100).toFixed(2),
    账户: accountMap.get(item.accountId) ?? '', 转入账户: accountMap.get(item.targetAccountId ?? '') ?? '',
    分类: categoryMap.get(item.categoryId ?? '') ?? '', 商户: item.merchant, 备注: item.note,
    来源: item.source, 外部流水号: item.externalId ?? ''
  })), { quotes: true })
}
