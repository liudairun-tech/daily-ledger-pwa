import type { TransactionType } from '../types'

export const normalizeText = (value: string) => value
  .normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

export const makeFingerprint = (input: {
  occurredAt: string
  amountCents: number
  type: TransactionType
  merchant: string
  accountId?: string
}) => {
  const date = new Date(input.occurredAt)
  const minute = Math.floor(date.getTime() / 60_000)
  return [minute, input.amountCents, input.type, normalizeText(input.merchant), input.accountId ?? ''].join('|')
}
