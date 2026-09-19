import { describe, expect, it } from 'vitest'
import { matchQuickEntryAccount, parseBankSms, parseSmsQueue, readQuickEntryPrefill } from './quickEntry'

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

  it('解析浦发银行取出格式，不把时间或余额当金额', () => {
    expect(parseBankSms('您尾号9986卡人民币活期19:18取出16.00[网上支付-财付通]，可用余额：1,443.78元。【浦发银行】')).toMatchObject({
      amount: '16.00', account: '浦发银行', merchant: '网上支付-财付通', type: 'expense'
    })
  })

  it('解析建设银行 ETC 支出格式', () => {
    expect(parseBankSms('【建设银行】您账户5239于8月24日12:12:43ETC通行费支出8.27元,可用余额2947.79元。')).toMatchObject({
      amount: '8.27', account: '建设银行', merchant: 'ETC通行费', type: 'expense'
    })
  })

  it('把招商银行向微信零钱充值识别为转账', () => {
    expect(parseBankSms('【招商银行】您账户8221于09月14日23:30在财付通-微信支付-微信零钱充值账户快捷支付10.00元，余额3476.62')).toMatchObject({
      amount: '10.00', account: '招商银行', merchant: '财付通-微信支付-微信零钱充值账户', type: 'transfer'
    })
  })

  it('读取快捷指令追加的多条锁屏短信', () => {
    const queue = `2026-09-17 19:18:00 | 您尾号9986卡人民币活期19:18取出16.00[网上支付-财付通]，可用余额：1,443.78元。【浦发银行】\n【建设银行】您账户5239于8月24日12:12:43ETC通行费支出8.27元,可用余额2947.79元。`
    expect(parseSmsQueue(queue)).toHaveLength(2)
    expect(parseSmsQueue(queue)[0]).toMatchObject({ receivedAt: '2026-09-17 19:18:00' })
  })

  it('识别银行收入短信', () => {
    expect(parseBankSms('【建设银行】您账户5239于9月17日12:12收入人民币888.00元，可用余额3000元')).toMatchObject({
      amount: '888.00', account: '建设银行', type: 'income'
    })
  })

  it('快速入口优先按卡号尾号匹配账户，而不是选择第一张银行卡', () => {
    const accounts = [
      { id: 'spd', name: '浦发银行 9986', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' },
      { id: 'ccb', name: '建设银行 5239', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' }
    ]
    const prefill = parseBankSms('【建设银行】您账户5239于9月18日23:26支出2.00元，可用余额100元。')
    expect(matchQuickEntryAccount(accounts, prefill)?.id).toBe('ccb')
  })

  it('没有卡号尾号时按银行名称匹配带尾号的账户名', () => {
    const accounts = [
      { id: 'spd', name: '浦发银行 9986', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' },
      { id: 'cmb', name: '招商银行 8221', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' }
    ]
    expect(matchQuickEntryAccount(accounts, { account: '招商银行', source: 'bank' })?.id).toBe('cmb')
  })

  it('手工记账默认选择微信账户', () => {
    const accounts = [
      { id: 'cash', name: '现金', type: 'cash' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' },
      { id: 'wechat', name: '微信', type: 'wechat' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' }
    ]
    expect(matchQuickEntryAccount(accounts, {})?.id).toBe('wechat')
  })
})
