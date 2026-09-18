import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { Category, LedgerTransaction } from '../types'
import { localDateKey } from '../lib/format'
import type { SummaryRange } from '../lib/dateRange'

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, CanvasRenderer])

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
