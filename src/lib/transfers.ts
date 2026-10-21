import type { Account, ImportCandidate } from '../types'
import { localDateKey } from './format'
import { makeFingerprint, normalizeText } from './fingerprint'

/** Only explicit outbound remittance to a known own card is eligible. */
export function ownTransferTarget(sms: string, sourceId: string | undefined, accounts: Account[]) {
  const tail = sms.match(/\[互联汇出\][^，,。\n]*?(\d{4})\s*(?=[，,。]|$)/)?.[1]
  if (!tail) return undefined
  const targets = accounts.filter(a => a.type === 'bank' && !a.inactive && a.id !== sourceId && new RegExp(`(?:^|\\D)${tail}(?:\\D|$)`).test(a.name))
  return targets.length === 1 ? targets[0] : undefined
}

export function pairOwnTransfers(candidates: ImportCandidate[], accounts: Account[]) {
  // Repeated lines in a cumulative file must not create ambiguous pairs.
  const seen = new Set<string>()
  const unique = candidates.filter(c => {
    const key = normalizeText(c.raw.sms ?? c.id)
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  const outgoing = unique.flatMap(c => {
    const target = c.type === 'expense' ? ownTransferTarget(c.raw.sms ?? '', c.accountId, accounts) : undefined
    return target ? [{ candidate: c, target }] : []
  })
  const matches = (out: ImportCandidate, target: Account, incoming: ImportCandidate) => {
    if (incoming.type !== 'income' || incoming.state === 'invalid' || incoming.accountId !== target.id || incoming.amountCents !== out.amountCents) return false
    if (!/电子汇入|他行实时转入/.test(incoming.raw.sms ?? '')) return false
    if (localDateKey(incoming.occurredAt) !== localDateKey(out.occurredAt)) return false
    const precise = /\d{1,2}[:：]\d{2}/.test(incoming.raw.sms ?? '')
    return !precise || Math.abs(Date.parse(out.occurredAt) - Date.parse(incoming.occurredAt)) <= 10 * 60_000
  }
  const used = new Set<string>()
  const replacements = new Map<string, ImportCandidate>()
  for (const { candidate: out, target } of outgoing) {
    if (out.state === 'invalid') continue
    const incoming = unique.filter(c => matches(out, target, c))
    const single = incoming.length === 1 && outgoing.filter(other => matches(other.candidate, other.target, incoming[0]!)).length === 1
    const other = single ? incoming[0] : undefined
    if (other) used.add(other.id)
    const source = accounts.find(a => a.id === out.accountId)
    const merchant = `${source?.name ?? '银行卡'} → ${target.name}`
    replacements.set(out.id, {
      ...out, type: 'transfer', targetAccountId: target.id, categoryId: undefined, merchant,
      smsOriginals: other ? [out.raw.sms!, other.raw.sms!] : [out.raw.sms!],
      note: other ? `${out.raw.sms}\n${other.raw.sms}` : out.note,
      fingerprint: makeFingerprint({ ...out, type: 'transfer', merchant }),
      issue: other ? '已配对汇出与到账短信，请确认本人账户转账' : '已识别本人卡尾号，尚未唯一匹配到账短信，请核对转入账户'
    })
  }
  return unique.filter(c => !used.has(c.id)).map(c => {
    if (replacements.has(c.id)) return replacements.get(c.id)!
    if (c.type === 'income' && c.state !== 'invalid' && /电子汇入|他行实时转入/.test(c.raw.sms ?? '')) {
      const ambiguous = outgoing.some(other => matches(other.candidate, other.target, c))
      return { ...c, state: ambiguous ? 'invalid' as const : 'possible-duplicate' as const, issue: ambiguous ? '存在多笔等额本人汇出，到账短信暂不单独入账，请核对转账记录' : '跨行到账尚未配对；如为本人转账，请等待汇出短信后重新读取；仅来自他人的款项才按收入导入' }
    }
    return c
  })
}
