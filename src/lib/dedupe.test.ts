import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { candidatesFromSmsQueue } from './importers'
import { markDuplicates } from './dedupe'
import { pairOwnTransfers } from './transfers'

afterEach(async () => { await db.transactions.clear() })

describe('累计短信文件去重', () => {
  it('配对转账入账后，单独重读到账短信也不能再次记为收入', async () => {
    const banks = [
      { id: 'out', name: '浦发银行 1111', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' },
      { id: 'in', name: '建设银行 2222', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' }
    ]
    const debit = '2025-03-02 19:45:10 | 您尾号1111卡人民币活期19:45手机银行取出100元[互联汇出]测试用户2222，余额100元。【浦发银行】'
    const credit = '2025-03-02 19:46:00 | 【建设银行】测试用户于3月2日19:45向您账户2222存入100元，附言：电子汇入。'
    const [transfer] = pairOwnTransfers(candidatesFromSmsQueue(`${debit}\n${credit}`, banks), banks)
    await db.transactions.put({ ...transfer!, id: 'transfer', currency: 'CNY', accountId: 'out', status: 'confirmed', manuallyEdited: false, createdAt: '', updatedAt: '' })
    const result = await markDuplicates(candidatesFromSmsQueue(credit, banks))
    expect(result[0]!.state).toBe('exact-duplicate')
    const again = await markDuplicates(pairOwnTransfers(candidatesFromSmsQueue(`${debit}\n${credit}`, banks), banks))
    expect(again[0]!.state).toBe('exact-duplicate')
  })
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
