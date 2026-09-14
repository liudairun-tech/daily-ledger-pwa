import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { Category, LedgerTransaction } from '../types'
import { localDateKey } from '../lib/format'

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

export function SpendingPie({ transactions, categories }: { transactions: LedgerTransaction[]; categories: Category[] }) {
  const names = new Map(categories.map(c => [c.id, c.name]))
  const totals = new Map<string, number>()
  transactions.filter(t => t.type === 'expense' || t.type === 'refund').forEach(t => {
    const key = names.get(t.categoryId ?? '') ?? '未分类'
    totals.set(key, (totals.get(key) ?? 0) + (t.type === 'refund' ? -t.amountCents : t.amountCents))
  })
  const data = [...totals.entries()].filter(([, value]) => value > 0).map(([name, value]) => ({ name, value: value / 100 }))
  const option = { tooltip: { trigger: 'item', formatter: '{b}<br/>¥{c} · {d}%' }, series: [{ type: 'pie', radius: ['52%', '76%'], padAngle: 3, itemStyle: { borderRadius: 7 }, label: { show: false }, data }] }
  return data.length ? <Chart option={option} label="本月支出分类占比" /> : <div className="empty-chart">本月还没有支出</div>
}

export function MonthBars({ transactions }: { transactions: LedgerTransaction[] }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(); date.setDate(date.getDate() - 6 + i); return localDateKey(date)
  })
  const expenses = days.map(day => transactions.filter(t => localDateKey(t.occurredAt) === day && t.type === 'expense').reduce((sum, t) => sum + t.amountCents, 0) / 100)
  const incomes = days.map(day => transactions.filter(t => localDateKey(t.occurredAt) === day && (t.type === 'income' || t.type === 'refund')).reduce((sum, t) => sum + t.amountCents, 0) / 100)
  const option = {
    grid: { left: 8, right: 8, top: 15, bottom: 24, containLabel: true }, tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: days.map(day => day.slice(5)), axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#d9e1ea55' } } },
    series: [{ name: '支出', type: 'bar', data: expenses, itemStyle: { color: '#ff7a59', borderRadius: [5, 5, 0, 0] } }, { name: '收入', type: 'bar', data: incomes, itemStyle: { color: '#16c79a', borderRadius: [5, 5, 0, 0] } }]
  }
  return <Chart option={option} label="最近七日收支趋势" />
}
