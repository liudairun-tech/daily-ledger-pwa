import type { Category, LedgerTransaction } from '../types'
import { localDateKey, yuan } from './format'

export function monthlyReport(items: LedgerTransaction[], categories: Category[], month: string, now = new Date()) {
  const currentMonth = localDateKey(now).slice(0, 7)
  const [year, number] = month.split('-').map(Number)
  const previous = localDateKey(new Date(year!, number! - 2, 1)).slice(0, 7)
  const inMonth = (key: string) => items.filter(t => localDateKey(t.occurredAt).slice(0, 7) === key && Date.parse(t.occurredAt) <= now.getTime())
  const rows = inMonth(month), before = inMonth(previous)
  const sum = (list: LedgerTransaction[], type: string) => list.filter(t => t.type === type).reduce((n, t) => n + t.amountCents, 0)
  const income = sum(rows, 'income'), gross = sum(rows, 'expense'), refunds = sum(rows, 'refund'), expense = gross - refunds
  const previousExpense = sum(before, 'expense') - sum(before, 'refund')
  const groups = new Map<string, number>()
  rows.filter(t => t.type === 'expense' || t.type === 'refund').forEach(t => {
    const name = categories.find(c => c.id === t.categoryId)?.name ?? '未分类'
    groups.set(name, (groups.get(name) ?? 0) + (t.type === 'refund' ? -t.amountCents : t.amountCents))
  })
  const ranking = [...groups].sort((a, b) => b[1] - a[1])
  const biggest = rows.filter(t => t.type === 'expense').sort((a, b) => b.amountCents - a.amountCents).slice(0, 5)
  const count = rows.filter(t => t.type === 'expense').length
  const days = month === currentMonth ? now.getDate() : new Date(year!, number!, 0).getDate()
  const lines = [
    `${month} 月度资金使用报告${month === currentMonth ? '（截至今日，尚未完结）' : ''}`,
    '基于本机已确认流水自动生成；漏记或错误分类会影响分析。',
    '', '一、收支概况',
    `收入 ${yuan(income)}；消费 ${yuan(gross)}；退款 ${yuan(refunds)}；净支出 ${yuan(expense)}；结余 ${yuan(income - expense)}。`,
    `支出 ${count} 笔，日均净支出 ${yuan(Math.round(expense / days))}。账户转账 ${rows.filter(t => t.type === 'transfer').length} 笔，不计入收支。`,
    ...(income > 0 ? [`收支结余率 ${((income - expense) / income * 100).toFixed(1)}%。此处结余是记录内的收支差额，不是银行余额。`] : ['没有收入记录，不计算结余率。']),
    '', '二、与上月比较',
    month === currentMonth ? `本月尚未结束，暂不计算整月环比；上月已记录净支出 ${yuan(previousExpense)}。` : !before.length ? '上月没有流水记录，无法判断变化。' : `净支出较上月${expense >= previousExpense ? '增加' : '减少'} ${yuan(Math.abs(expense - previousExpense))}${previousExpense > 0 ? `（${(Math.abs(expense - previousExpense) / previousExpense * 100).toFixed(1)}%）` : '；上月净支出不为正，不计算百分比'}。`,
    '', '三、钱花到哪里',
    ...ranking.map(([name, cents]) => `${name}：${yuan(cents)}${expense > 0 && cents >= 0 ? `，占净支出 ${(cents / expense * 100).toFixed(1)}%` : ''}`),
    ...(ranking.length ? [] : ['没有消费或退款记录。']),
    '', '四、金额最高的五笔支出（退款单独统计）',
    ...biggest.map(t => `${localDateKey(t.occurredAt)} ${t.merchant || '未填写商户'}：${yuan(t.amountCents)}`),
    ...(biggest.length ? [] : ['没有支出记录。']),
    '', '五、本月观察',
    !rows.length ? '本月尚无记录，请先记账或导入账单。' : income - expense < 0 ? '已记录支出超过收入。可先核对是否漏记收入，再检查主要消费项目。' : '已记录收支为正结余或持平。可结合实际储蓄目标继续观察。',
    ...(ranking[0] && ranking[0][1] > 0 ? [`最大的净支出分类是“${ranking[0][0]}”，可优先查看该分类的具体用途；金额大不代表不合理。`] : []),
    ...(refunds > gross ? ['本月退款超过消费，可能包含以前月份消费的退款；净支出因此为负。'] : [])
  ]
  return { text: lines.join('\n'), income, expense, balance: income - expense, count: rows.length }
}
