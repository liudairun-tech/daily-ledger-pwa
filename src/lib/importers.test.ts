import { describe, expect, it } from 'vitest'
import { candidatesFromOcr, guessCategory, rowsToCandidates, type ParsedFile } from './importers'
import { parseAmountToCents } from './format'

describe('金额和账单标准化', () => {
  it('将人民币金额转换为整数分', () => {
    expect(parseAmountToCents('￥1,234.56')).toBe(123456)
    expect(parseAmountToCents('(18.20)')).toBe(1820)
  })

  it('解析微信账单并识别退款和转账', () => {
    const parsed: ParsedFile = {
      source: 'wechat', headers: ['交易时间', '交易对方', '商品', '收/支', '金额(元)', '当前状态', '交易单号'], text: '',
      rows: [
        { 交易时间: '2026-09-01 12:30:00', 交易对方: '午后咖啡', 商品: '拿铁', '收/支': '支出', '金额(元)': '28.00', 当前状态: '支付成功', 交易单号: 'wx-1' },
        { 交易时间: '2026-09-02 09:00:00', 交易对方: '商店', 商品: '退款', '收/支': '收入', '金额(元)': '10', 当前状态: '已退款', 交易单号: 'wx-2' }
      ]
    }
    const result = rowsToCandidates(parsed, 'account-wechat')
    expect(result[0]).toMatchObject({ amountCents: 2800, type: 'expense', externalId: 'wx-1', state: 'ready' })
    expect(result[1]?.type).toBe('refund')
  })

  it('把还款和充值识别为转账', () => {
    const parsed: ParsedFile = { source: 'alipay', headers: [], text: '', rows: [{ 交易创建时间: '2026-09-01 10:00:00', 金额: '100', '收/支': '支出', 交易对方: '信用卡还款', 交易号: 'a-1' }] }
    expect(rowsToCandidates(parsed, 'account-alipay')[0]?.type).toBe('transfer')
  })
})

describe('分类和 OCR', () => {
  it('按商户关键字建议分类', () => expect(guessCategory('地铁乘车码', '', 'expense')).toBe('cat-transport'))
  it('从支付文字提取金额和日期', () => {
    const [candidate] = candidatesFromOcr('付款成功\n星空咖啡\n￥36.80\n2026-09-12 08:30', 'account-alipay')
    expect(candidate).toMatchObject({ amountCents: 3680, merchant: '星空咖啡', state: 'ready' })
  })

  it('识别微信深色账单中的独立负金额和结构化字段', () => {
    const text = `账单
幸福和顺
-18.00
当前状态 支付成功
支付时间 2026年9月15日 21:28:06
商品 和信融锦云湾-川AG16907-停车费
商户全称 幸福和顺物业服务有限公司
收单机构 财付通支付科技有限公司
支付方式 零钱
交易单号 4500000470202609155389521296`
    const [candidate] = candidatesFromOcr(text, 'account-wechat')
    expect(candidate).toMatchObject({
      amountCents: 1800,
      merchant: '幸福和顺物业服务有限公司',
      externalId: '4500000470202609155389521296',
      accountId: 'account-wechat',
      state: 'ready'
    })
    expect(candidate?.note).toContain('停车费')
    expect(candidate?.note).toContain('支付方式：零钱')
  })

  it('根据微信账单支付方式归入实际银行卡账户', () => {
    const accounts = [
      { id: 'account-wechat', name: '微信', type: 'wechat' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' },
      { id: 'account-ccb', name: '建设银行', type: 'bank' as const, openingBalanceCents: 0, openingDate: '', inactive: false, createdAt: '' }
    ]
    const [candidate] = candidatesFromOcr('支付成功\n-28.00\n支付方式 建设银行储蓄卡\n支付时间 2026年9月15日 21:28:06', 'account-wechat', accounts)
    expect(candidate?.accountId).toBe('account-ccb')
  })
})
