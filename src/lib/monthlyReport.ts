import type { Category, LedgerTransaction } from '../types'
import { localDateKey, yuan } from './format'

export function monthlyAnalysis(items: LedgerTransaction[], categories: Category[], month: string, now = new Date()) {
  const [year, m] = month.split('-').map(Number)
  const partial = month === localDateKey(now).slice(0, 7)
  const lastDay = new Date(year!, m!, 0).getDate()
  const previousKey = localDateKey(new Date(year!, m! - 2, 1)).slice(0, 7)
  const comparisonDay = partial ? Math.min(now.getDate(), new Date(year!, m! - 1, 0).getDate()) : lastDay
  const eligible = items.filter(t => Number.isFinite(Date.parse(t.occurredAt)) && Date.parse(t.occurredAt) <= now.getTime())
  const monthRows = (key: string) => eligible.filter(t => localDateKey(t.occurredAt).slice(0, 7) === key)
  const rows = monthRows(month)
  const compare = (list: LedgerTransaction[]) => partial ? list.filter(t => new Date(t.occurredAt).getDate() <= comparisonDay) : list
  const selected = compare(rows), prior = compare(monthRows(previousKey))
  const summarize = (list: LedgerTransaction[]) => {
    const expenses = list.filter(t => t.type === 'expense')
    const gross = expenses.reduce((n, t) => n + t.amountCents, 0)
    const refund = list.filter(t => t.type === 'refund').reduce((n, t) => n + t.amountCents, 0)
    const income = list.filter(t => t.type === 'income').reduce((n, t) => n + t.amountCents, 0)
    return { income, expense: gross - refund, gross, refund, count: expenses.length, average: expenses.length ? Math.round(gross / expenses.length) : 0, balance: income - gross + refund }
  }
  const summary = summarize(rows), current = summarize(selected), previous = summarize(prior)
  const names = new Map(categories.map(c => [c.id, c.name]))
  const group = (list: LedgerTransaction[]) => {
    const result = new Map<string, number>()
    list.filter(t => t.type === 'expense' || t.type === 'refund').forEach(t => { const key = names.get(t.categoryId ?? '') ?? '未分类'; result.set(key, (result.get(key) ?? 0) + (t.type === 'refund' ? -t.amountCents : t.amountCents)) })
    return result
  }
  const groups = group(rows), a = group(selected), b = group(prior)
  const changes = [...new Set([...a.keys(), ...b.keys()])].map(name => ({ name, current: a.get(name) ?? 0, previous: b.get(name) ?? 0, delta: (a.get(name) ?? 0) - (b.get(name) ?? 0) })).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  const shares = [...groups].map(([name, value]) => ({ name, value })).sort((x, y) => y.value - x.value)
  const trend = Array.from({ length: 6 }, (_, index) => {
    const key = localDateKey(new Date(year!, m! - 6 + index, 1)).slice(0, 7)
    const list = monthRows(key)
    return { month: key, hasData: list.length > 0, ...summarize(list) }
  })
  const scope = partial ? `本月与上月均比较 1～${comparisonDay} 日（按自然日，不含未来流水）` : '本月与上月完整月份比较'
  const comparisonAvailable = selected.length > 0 && prior.length > 0
  const delta = current.expense - previous.expense
  const insights = [
    !rows.length ? '这个月还没有已确认流水，先记账或导入账单后即可分析。' : `本月记录内结余 ${yuan(summary.balance)}，净支出 ${yuan(summary.expense)}。${summary.income > 0 ? `结余率 ${(summary.balance / summary.income * 100).toFixed(1)}%。` : '未记录收入，暂不计算结余率。'}`,
    comparisonAvailable ? `按上述比较口径，净支出较上月${delta >= 0 ? '增加' : '减少'} ${yuan(Math.abs(delta))}${previous.expense > 0 ? `（${(Math.abs(delta) / previous.expense * 100).toFixed(1)}%）` : '；上月净支出不为正，省略百分比'}。` : '本期或上期没有流水，暂不判断支出增减。',
    ...(comparisonAvailable && changes[0] && changes[0].delta !== 0 ? [`变动最大的是“${changes[0].name}”，${changes[0].delta > 0 ? '增加' : '减少'} ${yuan(Math.abs(changes[0].delta))}。先核对这一分类，比笼统压缩全部消费更有针对性。`] : []),
    ...(comparisonAvailable && previous.count > 0 && current.count > 0 ? [`消费次数 ${previous.count} → ${current.count} 笔，平均每笔消费 ${yuan(previous.average)} → ${yuan(current.average)}；退款 ${yuan(previous.refund)} → ${yuan(current.refund)}。次数和单价按消费原额计算，退款单独观察。`] : [])
  ]
  const unclassified = rows.filter(t => (t.type === 'expense' || t.type === 'refund') && !names.has(t.categoryId ?? '')).length
  const largest = rows.filter(t => t.type === 'expense').sort((a, b) => b.amountCents - a.amountCents).slice(0, 5)
  const largestTotal = largest.reduce((n, t) => n + t.amountCents, 0)
  const observations = [
    ...(largest.length ? [`前 ${largest.length} 笔大额消费共 ${yuan(largestTotal)}，占消费原额 ${(largestTotal / summary.gross * 100).toFixed(1)}%。大额仅供复核，不代表不合理。`] : []),
    ...(summary.refund > summary.gross ? ['退款超过当月消费，可能涉及以前月份；净支出为负，不等于产生了额外收入。'] : []),
    ...(summary.balance < 0 ? ['记录内支出超过收入，请先核对收入是否完整，再结合实际消费安排。'] : []),
    '预算尚未设置，本报告不作“超预算”判断，也不生成主观财务健康评分。'
  ]
  const quality = [`已确认 ${rows.length} 笔；排除转账 ${rows.filter(t => t.type === 'transfer').length} 笔；未分类消费或退款 ${unclassified} 笔。`, '无记录月份不等于零消费。仅统计本机已确认流水，无法证明账单完整；结余不是银行余额或净资产。']
  const text = [`${month} 月度资金分析${partial ? '（月中进度）' : ''}`, scope, ...insights, '\n分类净支出', ...shares.map(s => `${s.name}：${yuan(s.value)}`), '\n分类变动', ...(comparisonAvailable ? changes.map(c => `${c.name}：${yuan(c.previous)} → ${yuan(c.current)}`) : ['数据不足']), '\n近六个月', ...trend.map(t => `${t.month}：${t.hasData ? `收入 ${yuan(t.income)}，净支出 ${yuan(t.expense)}，结余 ${yuan(t.balance)}` : '无记录'}`), '\n大额支出', ...largest.map(t => `${localDateKey(t.occurredAt)} ${t.merchant} ${yuan(t.amountCents)}`), ...observations, ...quality].join('\n')
  return { summary, previous, current, partial, scope, shares, changes, comparisonAvailable, trend, insights, observations, quality, largest, text }
}

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
