import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { candidatesFromSmsQueue } from './importers'
import { markDuplicates } from './dedupe'

afterEach(async () => { await db.transactions.clear() })

describe('累计短信文件去重', () => {
  const sms = '2026-10-21 12:12:00 | 【建设银行】您账户5239于10月21日12:12支出8.27元，可用余额100元。'
  const accounts = [{ id: 'bank', name: '建设银行 5239', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' }]

  it('商户、账户被改过后仍能识别同一条短信，新增短信仍可选择', async () => {
    const [original] = candidatesFromSmsQueue(sms, accounts)
    await db.transactions.put({ ...original!, id: 'saved', currency: 'CNY', accountId: 'changed', merchant: '手工修改的商户', fingerprint: 'changed', status: 'confirmed', manuallyEdited: true, createdAt: '', updatedAt: '' })
    const result = await markDuplicates(candidatesFromSmsQueue(`${sms}\n${sms.replace('8.27', '9.50')}`, accounts))
    expect(result.map(item => item.state)).toEqual(['exact-duplicate', 'ready'])
  })

  it('同一文件内重复出现的短信只允许记账一次', async () => {
    const result = await markDuplicates(candidatesFromSmsQueue(`${sms}\n${sms}`, accounts))
    expect(result.map(item => item.state)).toEqual(['ready', 'exact-duplicate'])
  })
})
