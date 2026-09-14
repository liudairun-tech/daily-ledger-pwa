import { describe, expect, it } from 'vitest'
import { parseBankSms, readQuickEntryPrefill } from './quickEntry'

describe('快捷录入链接', () => {
  it('读取操作按钮传入的金额和账户', () => {
    expect(readQuickEntryPrefill('#/add?amount=28.50&account=wechat&merchant=%E5%92%96%E5%95%A1')).toMatchObject({
      amount: '28.50', account: 'wechat', merchant: '咖啡'
    })
  })

  it('从常见银行消费短信提取字段', () => {
    expect(parseBankSms('您尾号1234账户9月14日 18:30消费人民币36.80元，商户：星空咖啡，可用余额1000元。')).toMatchObject({
      amount: '36.80', account: 'bank', type: 'expense', merchant: '星空咖啡', source: 'bank'
    })
  })

  it('不会把余额当成交易金额', () => {
    expect(parseBankSms('您尾号1234卡支付人民币12.00元，余额888.00元')).toMatchObject({ amount: '12.00' })
  })
})
