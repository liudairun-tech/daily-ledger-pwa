import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, PieChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { Category, LedgerTransaction } from '../types'
import { localDateKey } from '../lib/format'
import type { SummaryRange } from '../lib/dateRange'
import type { monthlyAnalysis } from '../lib/monthlyReport'
import { yuan } from '../lib/format'

echarts.use([BarChart, PieChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

function Chart({ option, label }: { option: echarts.EChartsCoreOption; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chart.setOption(option)
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [option])
  return <div ref={ref} className="chart" role="img" aria-label={label} />
}

export function ReportCharts({ report }: { report: ReturnType<typeof monthlyAnalysis> }) {
  const ink = '#8393a4'
  const base = { tooltip: { trigger: 'axis' }, grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true } }
  const trend = {
    ...base, legend: { textStyle: { color: ink } },
    xAxis: { type: 'category', data: report.trend.map((t, i) => `${t.month.slice(5)}月${i === 5 && report.partial ? '*' : ''}`), axisLabel: { color: ink } },
    yAxis: { type: 'value', axisLabel: { color: ink }, splitLine: { lineStyle: { color: '#93a4b52a' } } },
    series: [
      { name: '收入', type: 'bar', itemStyle: { color: '#ed7182' }, data: report.trend.map(t => t.hasData ? t.income / 100 : null) },
      { name: '净支出', type: 'bar', itemStyle: { color: '#18b98b' }, data: report.trend.map(t => t.hasData ? t.expense / 100 : null) },
      { name: '结余', type: 'line', connectNulls: false, itemStyle: { color: '#6a9bf5' }, data: report.trend.map(t => t.hasData ? t.balance / 100 : null) }
    ]
  }
  const positives = report.shares.filter(s => s.value > 0)
  const positiveTotal = positives.reduce((n, s) => n + s.value, 0)
  const pie = { tooltip: { trigger: 'item', formatter: '{b}：¥{c}（{d}%）' }, series: [{ type: 'pie', radius: ['40%', '70%'], label: { show: false }, data: positives.map(s => ({ name: s.name, value: s.value / 100 })) }] }
  const changes = report.changes.filter(c => c.delta !== 0).slice(0, 6).reverse()
  const drivers = { ...base, grid: { left: 8, right: 18, top: 8, bottom: 8, containLabel: true }, xAxis: { type: 'value', axisLabel: { color: ink } }, yAxis: { type: 'category', data: changes.map(c => c.name), axisLabel: { color: ink } }, series: [{ type: 'bar', data: changes.map(c => ({ value: c.delta / 100, itemStyle: { color: c.delta > 0 ? '#edaa54' : '#739ef6' } })) }] }
  return <>
    <section className="section-card"><h2>近六个月收支趋势</h2><p className="muted">单位：元。无记录留空，不当作零消费；* 为尚未结束的月份。</p><Chart option={trend} label="近六个月收入、净支出柱状图及结余折线图" /><details><summary>查看趋势数据</summary><div className="report-table-wrap"><table className="report-table"><thead><tr><th>月份</th><th>收入</th><th>净支出</th><th>结余</th></tr></thead><tbody>{report.trend.map(t => <tr key={t.month}><td>{t.month}</td><td>{t.hasData ? yuan(t.income) : '无记录'}</td><td>{t.hasData ? yuan(t.expense) : '—'}</td><td>{t.hasData ? yuan(t.balance) : '—'}</td></tr>)}</tbody></table></div></details></section>
    <section className="section-card"><h2>消费结构</h2>{positives.length ? <Chart option={pie} label="各分类正净支出占比环形图" /> : <div className="empty-chart">暂无正净支出可绘图</div>}<p className="muted">占比以各分类正净支出合计为分母；零或负数不进入环形图，明细仍完整列出。</p><div className="report-ranking">{report.shares.map(s => <div key={s.name}><span>{s.name}</span><strong>{yuan(s.value)} <small>{s.value > 0 ? `${(s.value / positiveTotal * 100).toFixed(1)}%` : '不计占比'}</small></strong></div>)}</div></section>
    <section className="section-card"><h2>支出变化来自哪里</h2><p className="muted">{report.scope}。橙色为增加，蓝色为减少；按变动绝对金额选前六类。</p>{report.comparisonAvailable && changes.length ? <Chart option={drivers} label="分类净支出增减金额横向柱状图" /> : <div className="empty-chart">{report.comparisonAvailable ? '各分类净支出没有变化' : '本期或上期记录不足，暂不作比较'}</div>}{report.comparisonAvailable && <details><summary>查看分类对比明细</summary><div className="report-table-wrap"><table className="report-table"><thead><tr><th>分类</th><th>上期</th><th>本期</th><th>变化</th></tr></thead><tbody>{report.changes.map(c => <tr key={c.name}><td>{c.name}</td><td>{yuan(c.previous)}</td><td>{yuan(c.current)}</td><td>{c.delta > 0 ? '+' : ''}{yuan(c.delta)}</td></tr>)}</tbody></table></div></details>}</section>
  </>
}

export function SpendingPie({ transactions, categories, rangeLabel }: { transactions: LedgerTransaction[]; categories: Category[]; rangeLabel: string }) {
  const names = new Map(categories.map(c => [c.id, c.name]))
  const totals = new Map<string, number>()
  transactions.filter(t => t.type === 'expense' || t.type === 'refund').forEach(t => {
    const key = names.get(t.categoryId ?? '') ?? '未分类'
    totals.set(key, (totals.get(key) ?? 0) + (t.type === 'refund' ? -t.amountCents : t.amountCents))
  })
  const data = [...totals.entries()].filter(([, value]) => value > 0).map(([name, value]) => ({ name, value: value / 100 }))
  const option = { tooltip: { trigger: 'item', formatter: '{b}<br/>¥{c} · {d}%' }, series: [{ type: 'pie', radius: ['52%', '76%'], padAngle: 3, itemStyle: { borderRadius: 7 }, label: { show: false }, data }] }
  return data.length ? <Chart option={option} label={`${rangeLabel}支出分类占比`} /> : <div className="empty-chart">{rangeLabel}还没有支出</div>
}

export function MonthBars({ transactions, range }: { transactions: LedgerTransaction[]; range: SummaryRange }) {
  const now = new Date()
  const buckets = range === 'day'
    ? [{ key: localDateKey(now), label: '今天' }]
    : range === 'year'
    ? Array.from({ length: 12 }, (_, month) => ({ key: `${now.getFullYear()}-${String(month + 1).padStart(2, '0')}`, label: `${month + 1}月` }))
    : range === 'month'
      ? Array.from({ length: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() }, (_, day) => {
          const date = new Date(now.getFullYear(), now.getMonth(), day + 1)
          return { key: localDateKey(date), label: String(day + 1) }
        })
      : Array.from({ length: 7 }, (_, day) => {
          const date = new Date(now); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (date.getDay() + 6) % 7 + day)
          return { key: localDateKey(date), label: ['一', '二', '三', '四', '五', '六', '日'][day] }
        })
  const keyOf = (transaction: LedgerTransaction) => range === 'year' ? localDateKey(transaction.occurredAt).slice(0, 7) : localDateKey(transaction.occurredAt)
  const expenses = buckets.map(bucket => transactions.filter(t => keyOf(t) === bucket.key && t.type === 'expense').reduce((sum, t) => sum + t.amountCents, 0) / 100)
  const incomes = buckets.map(bucket => transactions.filter(t => keyOf(t) === bucket.key && (t.type === 'income' || t.type === 'refund')).reduce((sum, t) => sum + t.amountCents, 0) / 100)
  const option = {
    grid: { left: 8, right: 8, top: 15, bottom: 24, containLabel: true }, tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: buckets.map(bucket => bucket.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { interval: range === 'month' ? 4 : 0 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#d9e1ea55' } } },
    series: [{ name: '支出', type: 'bar', data: expenses, itemStyle: { color: '#ff7a59', borderRadius: [5, 5, 0, 0] } }, { name: '收入', type: 'bar', data: incomes, itemStyle: { color: '#16c79a', borderRadius: [5, 5, 0, 0] } }]
  }
  return <Chart option={option} label="当前周期收支趋势" />
}
