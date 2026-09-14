import { db } from '../db'
import type { ImportCandidate } from '../types'
import { normalizeText } from './fingerprint'

export async function markDuplicates(candidates: ImportCandidate[]) {
  const existing = await db.transactions.toArray()
  const seenExternal = new Set<string>()
  const seenFingerprints = new Set<string>()
  return candidates.map(candidate => {
    if (candidate.state === 'invalid') return candidate
    const externalKey = candidate.externalId ? `${candidate.source}|${candidate.externalId}` : ''
    const exact = Boolean(candidate.externalId) && (existing.some(item => item.source === candidate.source && item.externalId === candidate.externalId) || seenExternal.has(externalKey))
    if (exact) return { ...candidate, state: 'exact-duplicate' as const, issue: '相同来源和流水号已存在' }
    const timestamp = new Date(candidate.occurredAt).getTime()
    const possible = existing.some(item =>
      item.amountCents === candidate.amountCents && item.type === candidate.type &&
      Math.abs(new Date(item.occurredAt).getTime() - timestamp) <= 10 * 60_000 &&
      (normalizeText(item.merchant) === normalizeText(candidate.merchant) || item.source !== candidate.source)
    )
    const repeatedInFile = seenFingerprints.has(candidate.fingerprint)
    if (externalKey) seenExternal.add(externalKey)
    seenFingerprints.add(candidate.fingerprint)
    return possible || repeatedInFile ? { ...candidate, state: 'possible-duplicate' as const, issue: repeatedInFile ? '文件内存在疑似重复记录' : '存在同额近时交易，请确认' } : candidate
  })
}
