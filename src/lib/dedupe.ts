import { db } from '../db'
import type { ImportCandidate } from '../types'
import { normalizeText } from './fingerprint'

export async function markDuplicates(candidates: ImportCandidate[]) {
  const existing = await db.transactions.toArray()
  const seenExternal = new Set<string>()
  const seenFingerprints = new Set<string>()
  const seenSms = new Set<string>()
  return candidates.map(candidate => {
    const originals = (candidate.smsOriginals ?? [candidate.raw.sms]).filter(Boolean).map(s => normalizeText(s!))
    const linked = existing.filter(item => {
      const saved = (item.smsOriginals ?? [item.note]).map(normalizeText)
      return originals.some(sms => saved.includes(sms))
    })
    if (candidate.type === 'transfer' && linked.some(item => item.type !== 'transfer')) return { ...candidate, state: 'invalid' as const, issue: '这笔互转的一侧已按收入或支出入账，请先在流水中核对并修正，避免重复统计' }
    if (linked.length) return { ...candidate, state: 'exact-duplicate' as const, issue: '这条短信对应的交易或本人账户转账已经记账' }
    const sms = candidate.raw.sms ? normalizeText(candidate.raw.sms) : ''
    if (sms) {
      const recorded = existing.some(item => normalizeText(item.note) === sms)
      if (recorded || seenSms.has(sms)) return { ...candidate, state: 'exact-duplicate' as const, issue: '这条银行短信已经记账或在文件中重复出现' }
      seenSms.add(sms)
    }
    if (candidate.state === 'invalid') return candidate
    const externalKey = candidate.externalId ? `${candidate.source}|${candidate.externalId}` : ''
    const exact = Boolean(candidate.externalId) && (existing.some(item => item.source === candidate.source && item.externalId === candidate.externalId) || seenExternal.has(externalKey))
    if (exact) return { ...candidate, state: 'exact-duplicate' as const, issue: '相同来源和流水号已存在' }
    const exactFingerprint = existing.some(item => item.fingerprint === candidate.fingerprint) || seenFingerprints.has(candidate.fingerprint)
    if (exactFingerprint) return { ...candidate, state: 'exact-duplicate' as const, issue: '这条短信或交易已经导入过' }
    const timestamp = new Date(candidate.occurredAt).getTime()
    const possible = existing.some(item =>
      item.amountCents === candidate.amountCents && item.type === candidate.type &&
      Math.abs(new Date(item.occurredAt).getTime() - timestamp) <= 10 * 60_000 &&
      (normalizeText(item.merchant) === normalizeText(candidate.merchant) || item.source !== candidate.source)
    )
    if (externalKey) seenExternal.add(externalKey)
    seenFingerprints.add(candidate.fingerprint)
    return possible ? { ...candidate, state: 'possible-duplicate' as const, issue: '存在同额近时交易，请确认' } : candidate
  })
}
