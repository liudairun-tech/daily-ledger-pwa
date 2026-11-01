import { db } from '../db'
import type { Category, CategoryRule, ImportCandidate, TransactionSource, TransactionType } from '../types'
import { normalizeText } from './fingerprint'
import { guessCategory } from './importers'

export function needsCategoryReview(type: TransactionType, categoryId: string | undefined, categories: Category[]) {
  if (type === 'transfer') return false
  const category = categories.find(c => c.id === categoryId && !c.archived && c.kind === (type === 'income' ? 'income' : 'expense'))
  return !category || ['cat-other', 'cat-income'].includes(category.id) || /^(其他|其它|其他收入|其它收入)$/.test(category.name.trim())
}

export function suggestCategory(merchant: string, note: string, type: TransactionType, source: TransactionSource, categories: Category[], rules: CategoryRule[]) {
  if (type === 'transfer') return undefined
  const available = categories.filter(c => !c.archived && c.kind === (type === 'income' ? 'income' : 'expense'))
  const text = normalizeText(`${merchant} ${note}`)
  const rule = rules.filter(r => (r.source === 'any' || r.source === source) && available.some(c => c.id === r.categoryId) && normalizeText(r.keyword).length >= 2 && text.includes(normalizeText(r.keyword))).sort((a, b) => normalizeText(b.keyword).length - normalizeText(a.keyword).length || b.createdAt.localeCompare(a.createdAt))[0]
  const guess = rule?.categoryId ?? guessCategory(merchant, note, type)
  return available.find(c => c.id === guess)?.id ?? available.find(c => c.name === (type === 'income' ? '其他收入' : '其他'))?.id
}

export async function suggestImportCategories(candidates: ImportCandidate[]) {
  const [categories, rules] = await Promise.all([db.categories.toArray(), db.categoryRules.toArray()])
  return candidates.map(c => ({ ...c, categoryId: suggestCategory(c.merchant, c.note, c.type, c.source, categories, rules) }))
}

export function canRememberMerchant(merchant: string) {
  const value = normalizeText(merchant)
  return value.length >= 2 && !/财付通|微信支付|支付宝|银行|^其他$|^收入$|^支出$|^美团$/.test(value)
}
