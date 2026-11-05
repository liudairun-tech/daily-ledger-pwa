export type TransactionType = 'expense' | 'income' | 'refund' | 'transfer'
export type TransactionSource = 'manual' | 'alipay' | 'wechat' | 'bank' | 'ocr'
export type AccountType = 'alipay' | 'wechat' | 'bank' | 'cash' | 'other'

export interface Account {
  ownCard?: boolean
  ownerName?: string
  id: string
  name: string
  type: AccountType
  openingBalanceCents: number
  openingDate: string
  inactive: boolean
  createdAt: string
}

export interface Category {
  id: string
  name: string
  emoji: string
  kind: 'expense' | 'income'
  color: string
  archived: boolean
}

export interface LedgerTransaction {
  smsOriginals?: string[]
  id: string
  type: TransactionType
  amountCents: number
  currency: 'CNY'
  occurredAt: string
  merchant: string
  note: string
  categoryId?: string
  accountId: string
  targetAccountId?: string
  source: TransactionSource
  externalId?: string
  fingerprint: string
  importBatchId?: string
  status: 'confirmed'
  manuallyEdited: boolean
  createdAt: string
  updatedAt: string
}

export interface ImportBatch {
  id: string
  source: Exclude<TransactionSource, 'manual'>
  fileName: string
  fileHash: string
  importedAt: string
  totalCount: number
  importedCount: number
  duplicateCount: number
  errorCount: number
}

export interface ImportCandidate {
  inboxIds?: string[]
  mergeIds?: string[]
  waitingForPair?: boolean
  targetAccountId?: string
  smsOriginals?: string[]
  id: string
  batchId?: string
  source: Exclude<TransactionSource, 'manual'>
  externalId?: string
  type: TransactionType
  amountCents: number
  occurredAt: string
  merchant: string
  note: string
  accountId?: string
  categoryId?: string
  raw: Record<string, string>
  confidence: number
  fingerprint: string
  state: 'ready' | 'possible-duplicate' | 'exact-duplicate' | 'invalid' | 'imported' | 'skipped'
  issue?: string
  manuallyEdited?: boolean
}

export interface SmsInboxRecord {
  manualStatus?: 'pending' | 'category' | 'deferred' | 'ignored'
  manualStatusAt?: string
  id: string
  raw: string
  receivedAt?: string
  firstSeen: string
  lastSeen: string
  fileName: string
  candidate: ImportCandidate
  reviewedCategory?: boolean
  standalone?: boolean
}

export interface TransferMergeAudit {
  id: string
  before: LedgerTransaction[]
  after: LedgerTransaction
  createdAt: string
  undoneAt?: string
}

export interface CategoryRule {
  id: string
  source: TransactionSource | 'any'
  keyword: string
  categoryId: string
  createdAt: string
}

export interface AppSetting {
  key: string
  value: string
}

export interface GenericColumnMap {
  date: string
  amount: string
  direction?: string
  merchant?: string
  note?: string
  externalId?: string
}
