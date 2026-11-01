import { describe, expect, it } from 'vitest'
import { guessCategory } from './importers'
import { canRememberMerchant, suggestCategory } from './categorySuggestions'
import type { Category } from '../types'

describe('自动分类', () => {
  it('明确用途自动分类，支付通道和泛美团名称不猜餐饮', () => {
    expect(guessCategory('ETC通行费', '', 'expense')).toBe('cat-transport')
    expect(guessCategory('停车费', '', 'expense')).toBe('cat-transport')
    expect(guessCategory('京东商城', '', 'expense')).toBe('cat-shopping')
    expect(guessCategory('工资', '', 'income')).toBe('cat-salary')
    expect(guessCategory('网上支付-财付通', '', 'expense')).toBe('cat-other')
    expect(guessCategory('美团', '', 'expense')).toBe('cat-other')
    expect(canRememberMerchant('网上支付-财付通')).toBe(false)
  })
  it('用户商户规则优先且不会使用已隐藏或错误收支方向的分类', () => {
    const categories: Category[] = [
      { id: 'custom', name: '工作餐', emoji: '', kind: 'expense', color: '', archived: false },
      { id: 'cat-other', name: '其他', emoji: '', kind: 'expense', color: '', archived: false }
    ]
    const rules = [{ id: 'r', keyword: '测试餐厅', source: 'bank' as const, categoryId: 'custom', createdAt: '' }]
    expect(suggestCategory('测试餐厅', '', 'expense', 'bank', categories, rules)).toBe('custom')
    expect(suggestCategory('测试餐厅', '', 'expense', 'bank', categories.map(c => c.id === 'custom' ? { ...c, archived: true } : c), rules)).toBe('cat-other')
    expect(suggestCategory('测试餐厅', '', 'transfer', 'bank', categories, rules)).toBeUndefined()
  })
})
