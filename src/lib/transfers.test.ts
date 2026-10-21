import { describe, expect, it } from 'vitest'
import { candidatesFromSmsQueue } from './importers'
import { pairOwnTransfers } from './transfers'

const accounts = [
  { id: 'a', name: '浦发银行 1111', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' },
  { id: 'b', name: '建设银行 2222', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' },
  { id: 'c', name: '招商银行 3333', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' }
]
const out = '2025-03-02 19:45:10 | 您尾号1111卡人民币活期19:45手机银行取出100.00元[互联汇出]测试用户2222，可用余额100元。【浦发银行】'
const incoming = '2025-03-02 19:46:00 | 【建设银行】测试用户于3月2日19:45向您账户2222存入100元,可用余额100元。附言：电子汇入。'

describe('本人银行卡互转配对', () => {
  it('汇出和到账合为一笔并记录两条短信身份', () => {
    const result = pairOwnTransfers(candidatesFromSmsQueue(`${out}\n${incoming}\n${out}`, accounts), accounts)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ type: 'transfer', accountId: 'a', targetAccountId: 'b', amountCents: 10000 })
    expect(result[0]!.smsOriginals).toHaveLength(2)
    expect(new Date(result[0]!.occurredAt).getHours()).toBe(19)
  })
  it('招商短信没有时分时，只对同一天唯一匹配进行配对', () => {
    const source = out.replaceAll('2222', '3333')
    const target = '2025-03-02 19:46:00 | 【招商银行】您账户3333于03月02日他行实时转入人民币100.00，余额100元，付方测试用户'
    const result = pairOwnTransfers(candidatesFromSmsQueue(`${source}\n${target}`, accounts), accounts)
    expect(result).toHaveLength(1)
    expect(result[0]!.targetAccountId).toBe('c')
  })
  it('只有金额时间相同而没有收款卡尾号，不合并', () => {
    const result = pairOwnTransfers(candidatesFromSmsQueue(`${out.replace('测试用户2222', '测试用户9999')}\n${incoming}`, accounts), accounts)
    expect(result).toHaveLength(2)
    expect(result.map(c => c.type)).toEqual(['expense', 'income'])
  })
  it('同一张卡有多笔等额汇出时不把到账短信随意配给其中一笔', () => {
    const result = pairOwnTransfers(candidatesFromSmsQueue(`${out}\n${out.replaceAll('19:45', '19:44')}\n${incoming}`, accounts), accounts)
    expect(result).toHaveLength(3)
    expect(result.every(c => (c.smsOriginals?.length ?? 0) < 2)).toBe(true)
  })
})
