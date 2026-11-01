import { db, noteDataChange } from '../db'
import type { Account, ImportCandidate, LedgerTransaction, SmsInboxRecord } from '../types'
import { hashBuffer } from './importers'
import { parseBankSms, parseSmsQueue } from './quickEntry'
import { pairOwnTransfers } from './transfers'
import { localDateKey, parseAmountToCents } from './format'
import { normalizeText, makeFingerprint } from './fingerprint'
import { suggestImportCategories, needsCategoryReview } from './categorySuggestions'

export type InboxFilter = 'pending' | 'category' | 'waiting' | 'duplicate' | 'recorded' | 'invalid' | 'all'
export function inboxStatus(c: ImportCandidate, records: SmsInboxRecord[], categories: Parameters<typeof needsCategoryReview>[2]): InboxFilter {
  if (c.state === 'exact-duplicate') return 'recorded'
  if (c.waitingForPair) return 'waiting'
  if (c.state === 'invalid') return 'invalid'
  if (c.state === 'possible-duplicate' || c.mergeIds?.length) return 'duplicate'
  if (needsCategoryReview(c.type, c.categoryId, categories) && !(c.inboxIds ?? []).every(id => records.find(r => r.id === id)?.reviewedCategory)) return 'category'
  return 'pending'
}

function parseEntry(raw: string, receivedAt: string | undefined, accounts: Account[]): ImportCandidate {
  const parsed = parseBankSms(raw, receivedAt)
  const tail = raw.match(/(?:尾号|您账户|您账号|您卡号)\s*(\d{4})(?!\d)/)?.[1]
  const bank = raw.match(/【([^】]+银行)】/)?.[1]
  const matches = accounts.filter(a => !a.inactive && a.type === 'bank' && (tail ? a.name.includes(tail) : bank ? a.name.includes(bank) : false))
  const accountId = matches.length === 1 ? matches[0]!.id : undefined
  const fallbackTime = receivedAt ? new Date(receivedAt.replace(/\//g, '-').replace(' ', 'T')) : undefined
  const c: ImportCandidate = { id: '', source: 'bank', type: parsed.type ?? 'expense', amountCents: parseAmountToCents(parsed.amount ?? ''), occurredAt: parsed.occurredAt ?? (fallbackTime && Number.isFinite(fallbackTime.getTime()) ? fallbackTime.toISOString() : ''), merchant: parsed.merchant || parsed.account || '未识别短信', note: raw, raw: { sms: raw }, confidence: .8, fingerprint: '', state: 'ready' }
  if (!receivedAt && !/\d{1,2}月\d{1,2}日|20\d{2}[-/]\d{1,2}[-/]\d{1,2}/.test(raw)) c.occurredAt = ''
  c.accountId = accountId
  c.raw.receivedAt = receivedAt ?? ''
  if (!accountId || !c.amountCents || !Number.isFinite(Date.parse(c.occurredAt))) { c.state = 'invalid'; c.issue = !accountId ? '未能唯一匹配银行卡，请选择账户' : !c.amountCents ? '金额无法识别，请核对原文' : '交易时间无法识别，请手工选择' }
  return c
}

export async function ingestSmsText(text: string, file: { name: string; modified: number }, accounts: Account[]) {
  const entries = parseSmsQueue(text, true)
  const now = new Date().toISOString()
  const records = await Promise.all(entries.map(async entry => {
    const key = `${normalizeText(entry.raw)}|${entry.receivedAt?.slice(0, 10).replace(/\//g, '-') ?? ''}`
    const id = await hashBuffer(new TextEncoder().encode(key).buffer)
    const candidate = parseEntry(entry.raw, entry.receivedAt, accounts)
    return { id, raw: entry.raw, receivedAt: entry.receivedAt, firstSeen: now, lastSeen: now, fileName: file.name, candidate } satisfies SmsInboxRecord
  }))
  let added = 0
  await db.transaction('rw', db.smsInbox, db.settings, async () => {
    for (const record of records) {
      const old = await db.smsInbox.get(record.id)
      if (old) await db.smsInbox.update(old.id, { lastSeen: now, fileName: file.name })
      else { await db.smsInbox.add(record); added++ }
    }
    await db.settings.put({ key: 'smsInboxLastFile', value: JSON.stringify({ ...file, readAt: now, readCount: records.length, added, latestReceived: entries.map(e => e.receivedAt ?? '').sort().at(-1) ?? '', latestTransaction: records.map(r => r.candidate.occurredAt).filter(Boolean).sort().at(-1) ?? '' }) })
    await noteDataChange()
  })
  return { read: records.length, added }
}

const originalsOf = (t: { smsOriginals?: string[]; note: string }) => (t.smsOriginals?.length ? t.smsOriginals : [t.note]).map(normalizeText)

export async function prepareInbox() {
  const [records, accounts, existing] = await Promise.all([db.smsInbox.toArray(), db.accounts.toArray(), db.transactions.toArray()])
  let base: ImportCandidate[] = records.map(r => ({ ...(r.candidate.manuallyEdited ? r.candidate : parseEntry(r.raw, r.receivedAt, accounts)), id: r.id, inboxIds: [r.id], raw: { ...r.candidate.raw, sms: r.raw, receivedAt: r.receivedAt ?? '' } }))
  base = await suggestImportCategories(base).then(list => list.map(c => {
    const old = records.find(r => r.id === c.id)
    return old?.reviewedCategory ? { ...c, categoryId: old.candidate.categoryId } : c
  })) as typeof base
  const ownAccounts = accounts.filter(a => a.ownCard && !a.inactive)
  // Bring bank SMS already booked in older versions back into pairing, without
  // silently changing the ledger. They can only be replaced after a merge preview.
  const keys = new Set(base.map(c => `${normalizeText(c.raw.sms ?? '')}|${localDateKey(c.occurredAt)}`))
  const history: ImportCandidate[] = []
  for (const tx of existing.filter(t => t.source === 'bank')) {
    for (const raw of tx.smsOriginals ?? [tx.note]) {
      const key = `${normalizeText(raw)}|${localDateKey(tx.occurredAt)}`
      if (keys.has(key) || !/互联汇出|电子汇入|他行实时转入/.test(raw)) continue
      keys.add(key)
      const c = parseEntry(raw, tx.occurredAt, accounts)
      history.push({ ...c, id: `history-${tx.id}-${history.length}`, inboxIds: [] })
    }
  }
  const all = [...base, ...history]
  const consumed = new Set<string>(), forced: ImportCandidate[] = []
  for (const out of base.filter(c => c.raw.pairWith)) {
    const target = all.find(c => c.id === out.raw.pairWith)
    if (!target || consumed.has(out.id) || consumed.has(target.id)) continue
    const [pair] = pairOwnTransfers([out, target], ownAccounts)
    if (pair?.type === 'transfer' && pair.smsOriginals?.length === 2) { forced.push(pair); consumed.add(out.id); consumed.add(target.id) }
  }
  const paired = [...forced, ...pairOwnTransfers(all.filter(c => !consumed.has(c.id)), ownAccounts)].filter(c => c.inboxIds?.length)
  const result = paired.map(c => {
    const rawKeys = (c.smsOriginals ?? [c.raw.sms ?? '']).map(normalizeText)
    const linked = existing.filter(t => localDateKey(t.occurredAt) === localDateKey(c.occurredAt) && originalsOf(t).some(key => rawKeys.includes(key)))
    const completeTransfer = c.type === 'transfer' && (c.smsOriginals?.length ?? 0) === 2
    const match = linked.find(t => c.type === 'transfer' ? t.type === 'transfer' && t.accountId === c.accountId && t.targetAccountId === c.targetAccountId && t.amountCents === c.amountCents && rawKeys.every(key => originalsOf(t).includes(key)) : true)
    if (match) return { ...c, state: 'exact-duplicate' as const, issue: '已记账，原短信已关联到现有流水' }
    if (completeTransfer && linked.length) {
      // Never overwrite a manually changed amount or an unrelated transaction.
      const compatible = linked.every(t => t.amountCents === c.amountCents && ((t.type === 'expense' && t.accountId === c.accountId) || (t.type === 'income' && t.accountId === c.targetAccountId) || (t.type === 'transfer' && t.accountId === c.accountId && t.targetAccountId === c.targetAccountId)))
      return { ...c, state: compatible ? 'possible-duplicate' as const : 'invalid' as const, mergeIds: compatible ? linked.map(t => t.id) : undefined, issue: compatible ? `配对涉及 ${linked.length} 笔已保存流水；请预览合并后确认` : '已保存流水的金额或方向与短信不一致，请先核对历史流水' }
    }
    const isRemittance = /电子汇入|他行实时转入|互联汇出/.test(c.raw.sms ?? '')
    const standalone = (c.inboxIds ?? []).every(id => records.find(r => r.id === id)?.standalone)
    if (isRemittance && !completeTransfer && !standalone) return { ...c, waitingForPair: true, issue: '等待另一侧短信，或核对本人银行卡登记；不会按收入、支出直接入账' }
    if (c.state === 'invalid') return c
    const fingerprint = makeFingerprint({ ...c, accountId: c.accountId ?? '' })
    if (existing.some(t => t.fingerprint === fingerprint)) return { ...c, state: 'exact-duplicate' as const, issue: '交易指纹与已保存流水相同' }
    const near = existing.some(t => t.amountCents === c.amountCents && t.type === c.type && Math.abs(Date.parse(t.occurredAt) - Date.parse(c.occurredAt)) <= 600000 && (t.source !== c.source || normalizeText(t.merchant) === normalizeText(c.merchant)))
    return { ...c, fingerprint, state: near ? 'possible-duplicate' as const : 'ready' as const, issue: near ? '存在同额近时流水，请核对原文及现有记录' : c.issue }
  })
  return result.sort((a, b) => (Date.parse(b.occurredAt) || 0) - (Date.parse(a.occurredAt) || 0))
}

export async function saveInboxDraft(id: string, patch: Partial<ImportCandidate>, categoryReviewed = false, standalone = false) {
  const old = await db.smsInbox.get(id)
  if (!old) return
  const candidate = { ...old.candidate, ...patch, manuallyEdited: true }
  candidate.state = candidate.amountCents > 0 && candidate.accountId && Number.isFinite(Date.parse(candidate.occurredAt)) ? 'ready' : 'invalid'
  const reviewedCategory = categoryReviewed || (patch.type && patch.type !== old.candidate.type ? false : old.reviewedCategory)
  await db.smsInbox.update(id, { candidate, reviewedCategory, standalone: standalone || old.standalone })
  await noteDataChange()
}

export async function commitInbox(ids: string[], expected: ImportCandidate[], mergeApproved: boolean) {
  return db.transaction('rw', [db.smsInbox, db.transactions, db.accounts, db.categories, db.categoryRules, db.transferMergeAudits, db.importBatches, db.importCandidates, db.settings], async () => {
    const fresh = await prepareInbox()
    const records = await db.smsInbox.toArray(), categories = await db.categories.toArray(), accounts = await db.accounts.toArray()
    const chosen = fresh.filter(c => ids.includes(c.id))
    if (chosen.length !== ids.length || !chosen.length) throw new Error('候选记录已变化，请刷新后重新选择')
    const now = new Date().toISOString(), batchId = crypto.randomUUID()
    const used = new Set<string>()
    for (const c of chosen) {
      if (c.waitingForPair || c.state === 'invalid' || c.state === 'exact-duplicate') throw new Error('所选记录包含待配对、异常或已记账项目，请重新核对')
      if (needsCategoryReview(c.type, c.categoryId, categories) && !(c.inboxIds ?? []).every(id => records.find(r => r.id === id)?.reviewedCategory)) throw new Error('请先手工确认待分类记录')
      if (!c.accountId || (c.type === 'transfer' && (!c.targetAccountId || c.accountId === c.targetAccountId))) throw new Error('请先选择有效转出、转入账户')
      if (!Number.isSafeInteger(c.amountCents) || c.amountCents <= 0 || !Number.isFinite(Date.parse(c.occurredAt))) throw new Error('金额或交易时间无效，请重新核对')
      if (!accounts.some(a => a.id === c.accountId && !a.inactive) || (c.type === 'transfer' && !accounts.some(a => a.id === c.targetAccountId && !a.inactive))) throw new Error('账户已停用或不存在，请重新选择')
      if (c.type !== 'transfer' && !categories.some(k => k.id === c.categoryId && !k.archived && k.kind === (c.type === 'income' ? 'income' : 'expense'))) throw new Error('请先选择有效分类')
      const preview = expected.find(e => e.id === c.id)
      const previewFields = (item: ImportCandidate) => [item.amountCents, item.accountId, item.targetAccountId, item.type, item.occurredAt, item.categoryId, item.merchant, item.note, item.mergeIds, item.smsOriginals]
      if (!preview || JSON.stringify(previewFields(c)) !== JSON.stringify(previewFields(preview))) throw new Error('配对结果已变化，请重新预览')
      if (c.mergeIds?.length && !mergeApproved) throw new Error('需要先确认历史流水合并预览')
      if (c.mergeIds?.some(id => used.has(id))) throw new Error('多组配对关联了同一笔旧流水，请单独核对')
      c.mergeIds?.forEach(id => used.add(id))
      const item: LedgerTransaction = { id: crypto.randomUUID(), type: c.type, amountCents: c.amountCents, currency: 'CNY', occurredAt: c.occurredAt, merchant: c.merchant, note: c.note, accountId: c.accountId, targetAccountId: c.type === 'transfer' ? c.targetAccountId : undefined, categoryId: c.type === 'transfer' ? undefined : c.categoryId, smsOriginals: c.smsOriginals ?? [c.raw.sms!], source: 'bank', fingerprint: makeFingerprint({ ...c, accountId: c.accountId }), importBatchId: batchId, status: 'confirmed', manuallyEdited: Boolean(c.manuallyEdited), createdAt: now, updatedAt: now }
      if (c.mergeIds?.length) {
        const before = (await db.transactions.bulkGet(c.mergeIds)).filter((t): t is LedgerTransaction => Boolean(t))
        await db.transferMergeAudits.add({ id: crypto.randomUUID(), before, after: item, createdAt: now })
        await db.transactions.bulkDelete(c.mergeIds)
      }
      await db.transactions.add(item)
      await db.importCandidates.put({ ...c, batchId, state: 'imported' })
    }
    await db.importBatches.add({ id: batchId, source: 'bank', fileName: '短信处理中心', fileHash: batchId, importedAt: now, totalCount: chosen.length, importedCount: chosen.length, duplicateCount: 0, errorCount: 0 })
    await noteDataChange()
    return chosen.length
  })
}

export async function undoTransferMerge(id: string) {
  await db.transaction('rw', [db.transactions, db.transferMergeAudits, db.settings], async () => {
    const audit = await db.transferMergeAudits.get(id)
    if (!audit || audit.undoneAt) throw new Error('这次合并已撤销或不存在')
    const current = await db.transactions.get(audit.after.id)
    if (JSON.stringify(current) !== JSON.stringify(audit.after)) throw new Error('合并后流水已被修改，不能直接撤销，请先核对')
    if ((await db.transactions.bulkGet(audit.before.map(t => t.id))).some(Boolean)) throw new Error('原记录已存在，请先核对')
    await db.transactions.delete(audit.after.id)
    await db.transactions.bulkPut(audit.before)
    await db.transferMergeAudits.update(id, { undoneAt: new Date().toISOString() })
    await noteDataChange()
  })
}
