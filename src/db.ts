import Dexie, { type EntityTable } from 'dexie'
import type { Account, AppSetting, Category, CategoryRule, ImportBatch, ImportCandidate, LedgerTransaction } from './types'

export class LedgerDatabase extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  categories!: EntityTable<Category, 'id'>
  transactions!: EntityTable<LedgerTransaction, 'id'>
  importBatches!: EntityTable<ImportBatch, 'id'>
  importCandidates!: EntityTable<ImportCandidate, 'id'>
  categoryRules!: EntityTable<CategoryRule, 'id'>
  settings!: EntityTable<AppSetting, 'key'>

  constructor(name = 'daily-ledger') {
    super(name)
    this.version(1).stores({
      accounts: 'id, type, inactive, createdAt',
      categories: 'id, kind, archived, name',
      transactions: 'id, occurredAt, type, accountId, targetAccountId, categoryId, source, externalId, fingerprint, importBatchId, [source+externalId]',
      importBatches: 'id, fileHash, importedAt, source',
      importCandidates: 'id, batchId, source, state, fingerprint, externalId',
      categoryRules: 'id, [source+keyword], categoryId',
      settings: 'key'
    })
  }
}

export const db = new LedgerDatabase()

const defaultAccounts: Omit<Account, 'createdAt' | 'openingDate'>[] = [
  { id: 'account-alipay', name: '支付宝', type: 'alipay', openingBalanceCents: 0, inactive: false },
  { id: 'account-wechat', name: '微信', type: 'wechat', openingBalanceCents: 0, inactive: false },
  { id: 'account-bank', name: '银行卡', type: 'bank', openingBalanceCents: 0, inactive: false },
  { id: 'account-cash', name: '现金', type: 'cash', openingBalanceCents: 0, inactive: false }
]

const defaultCategories: Omit<Category, 'archived'>[] = [
  { id: 'cat-food', name: '餐饮', emoji: '🍜', kind: 'expense', color: '#f97316' },
  { id: 'cat-transport', name: '交通', emoji: '🚇', kind: 'expense', color: '#3b82f6' },
  { id: 'cat-shopping', name: '购物', emoji: '🛍️', kind: 'expense', color: '#ec4899' },
  { id: 'cat-home', name: '住房', emoji: '🏠', kind: 'expense', color: '#8b5cf6' },
  { id: 'cat-health', name: '医疗', emoji: '💊', kind: 'expense', color: '#ef4444' },
  { id: 'cat-fun', name: '娱乐', emoji: '🎬', kind: 'expense', color: '#14b8a6' },
  { id: 'cat-other', name: '其他', emoji: '📦', kind: 'expense', color: '#64748b' },
  { id: 'cat-salary', name: '工资', emoji: '💼', kind: 'income', color: '#16a34a' },
  { id: 'cat-income', name: '其他收入', emoji: '🧧', kind: 'income', color: '#22c55e' }
]

export async function ensureSeedData() {
  const now = new Date().toISOString()
  if (await db.accounts.count() === 0) {
    await db.accounts.bulkPut(defaultAccounts.map(a => ({ ...a, createdAt: now, openingDate: now })))
  }
  if (await db.categories.count() === 0) {
    await db.categories.bulkPut(defaultCategories.map(c => ({ ...c, archived: false })))
  }
}

export async function noteDataChange() {
  const setting = await db.settings.get('changesSinceBackup')
  await db.settings.put({ key: 'changesSinceBackup', value: String(Number(setting?.value ?? 0) + 1) })
}
