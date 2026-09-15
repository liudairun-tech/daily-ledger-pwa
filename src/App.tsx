import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureSeedData, noteDataChange } from './db'
import type { Account, AccountType, Category, GenericColumnMap, ImportCandidate, LedgerTransaction, TransactionType } from './types'
import { dateTimeLocalValue, downloadBlob, localDateKey, transactionImpact, typeLabel, yuan } from './lib/format'
import { makeFingerprint } from './lib/fingerprint'
import { candidatesFromOcr, guessCategory, hashBuffer, parseStatement, rowsToCandidates, type ParsedFile } from './lib/importers'
import { markDuplicates } from './lib/dedupe'
import { decryptBackup, encryptBackup, readAllData, restoreAllData, transactionsCsv, type EncryptedBackup } from './lib/backup'
import { readQuickEntryPrefill, type QuickEntryPrefill } from './lib/quickEntry'
import { prepareImageForOcr } from './lib/ocr'

const MonthBars = lazy(() => import('./components/Charts').then(module => ({ default: module.MonthBars })))
const SpendingPie = lazy(() => import('./components/Charts').then(module => ({ default: module.SpendingPie })))

type Route = 'home' | 'transactions' | 'add' | 'import' | 'settings'
export type SummaryRange = 'week' | 'month' | 'year'
const navItems: Array<{ route: Route; icon: string; label: string }> = [
  { route: 'home', icon: '⌂', label: '首页' }, { route: 'transactions', icon: '≡', label: '流水' },
  { route: 'add', icon: '+', label: '记账' }, { route: 'import', icon: '⇩', label: '导入' }, { route: 'settings', icon: '⚙', label: '设置' }
]

function currentRoute(): Route {
  const value = location.hash.replace(/^#\/?/, '').split('?')[0]
  return navItems.some(item => item.route === value) ? value as Route : 'home'
}

function go(route: Route) { location.hash = `/${route}` }

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute())
  const [routeKey, setRouteKey] = useState(location.hash)
  const [ready, setReady] = useState(false)
  useEffect(() => { void ensureSeedData().then(() => setReady(true)) }, [])
  useEffect(() => {
    const change = () => { setRoute(currentRoute()); setRouteKey(location.hash) }
    addEventListener('hashchange', change)
    if (!location.hash) go('home')
    return () => removeEventListener('hashchange', change)
  }, [])
  if (!ready) return <div className="splash"><img src="./icon.svg" alt="" /><strong>每日账本</strong><span>正在打开你的本地账本…</span></div>
  return <div className="app-shell">
    <main>
      {route === 'home' && <HomePage />}
      {route === 'transactions' && <TransactionsPage />}
      {route === 'add' && <TransactionForm key={routeKey} prefill={readQuickEntryPrefill()} onDone={() => go('transactions')} />}
      {route === 'import' && <ImportPage />}
      {route === 'settings' && <SettingsPage />}
    </main>
    <nav className="bottom-nav" aria-label="主导航">
      {navItems.map(item => <button key={item.route} className={route === item.route ? 'active' : ''} onClick={() => go(item.route)}>
        <span className={item.route === 'add' ? 'add-icon' : ''}>{item.icon}</span><small>{item.label}</small>
      </button>)}
    </nav>
  </div>
}

function PageHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1></div>{action}</header>
}

function HomePage() {
  const transactions = useLiveQuery(() => db.transactions.orderBy('occurredAt').reverse().toArray(), []) ?? []
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? []
  const [range, setRange] = useState<SummaryRange>('month')
  const today = localDateKey(new Date())
  const todayItems = transactions.filter(t => localDateKey(t.occurredAt) === today)
  const start = new Date(); start.setHours(0, 0, 0, 0)
  if (range === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  if (range === 'month') start.setDate(1)
  if (range === 'year') { start.setMonth(0, 1) }
  const rangeItems = transactions.filter(t => new Date(t.occurredAt).getTime() >= start.getTime() && new Date(t.occurredAt).getTime() <= Date.now())
  const rangeLabel = { week: '本周', month: '本月', year: '本年' }[range]
  const sum = (items: LedgerTransaction[], types: TransactionType[]) => items.filter(t => types.includes(t.type)).reduce((n, t) => n + t.amountCents, 0)
  const expense = sum(rangeItems, ['expense']) - sum(rangeItems, ['refund'])
  const income = sum(rangeItems, ['income'])
  const changed = useLiveQuery(() => db.settings.get('changesSinceBackup'), [])
  const lastBackup = useLiveQuery(() => db.settings.get('lastBackupAt'), [])
  const needsBackup = Number(changed?.value ?? 0) >= 50 || !lastBackup?.value || Date.now() - new Date(lastBackup.value).getTime() > 7 * 86_400_000
  return <div className="page home-page">
    <PageHeader eyebrow={new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())} title="今天，记清每一笔" action={<button className="avatar" onClick={() => go('settings')}>账</button>} />
    {needsBackup && transactions.length > 0 && <button className="notice" onClick={() => go('settings')}>你的账本该备份了 <b>去备份 →</b></button>}
    <div className="period-tabs" aria-label="统计周期">{(['week', 'month', 'year'] as SummaryRange[]).map(value => <button key={value} className={range === value ? 'selected' : ''} onClick={() => setRange(value)}>{{ week: '周', month: '月', year: '年' }[value]}</button>)}</div>
    <section className="balance-card">
      <span>{rangeLabel}结余</span><strong>{yuan(income - expense)}</strong>
      <div><p><i className="dot income" />收入 <b>{yuan(income)}</b></p><p><i className="dot expense" />支出 <b>{yuan(expense)}</b></p></div>
    </section>
    <div className="quick-grid">
      <button onClick={() => go('add')}><span>＋</span><b>快速记账</b><small>手工记录一笔</small></button>
      <button onClick={() => go('import')}><span>⌁</span><b>识别账单</b><small>截图或文件导入</small></button>
    </div>
    <section className="section-card"><div className="section-title"><h2>{rangeLabel}收支趋势</h2><span>收入与支出</span></div><Suspense fallback={<div className="empty-chart">正在准备图表…</div>}><MonthBars transactions={rangeItems} range={range} /></Suspense></section>
    <section className="section-card"><div className="section-title"><h2>{rangeLabel}花到哪里</h2><span>{rangeItems.length} 笔</span></div><Suspense fallback={<div className="empty-chart">正在准备图表…</div>}><SpendingPie transactions={rangeItems} categories={categories} rangeLabel={rangeLabel} /></Suspense></section>
    <section className="section-card"><div className="section-title"><h2>今日流水</h2><button onClick={() => go('transactions')}>查看全部</button></div>
      <TransactionList transactions={todayItems.slice(0, 5)} categories={categories} compact />
    </section>
  </div>
}

function TransactionList({ transactions, categories, compact = false, onEdit }: { transactions: LedgerTransaction[]; categories: Category[]; compact?: boolean; onEdit?: (item: LedgerTransaction) => void }) {
  const categoryMap = new Map(categories.map(c => [c.id, c]))
  if (!transactions.length) return <div className="empty-state"><span>☁</span><b>还没有记录</b><small>记下第一笔，趋势会从这里开始</small></div>
  return <div className="transaction-list">{transactions.map(item => {
    const category = categoryMap.get(item.categoryId ?? '')
    const positive = transactionImpact(item) >= 0
    return <button className="transaction-row" key={item.id} onClick={() => onEdit?.(item)}>
      <span className="category-icon" style={{ background: `${category?.color ?? '#64748b'}1d` }}>{item.type === 'transfer' ? '⇄' : category?.emoji ?? '•'}</span>
      <span className="transaction-copy"><b>{item.merchant || typeLabel[item.type]}</b><small>{category?.name ?? typeLabel[item.type]} · {new Date(item.occurredAt).toLocaleString('zh-CN', compact ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></span>
      <strong className={positive ? 'money-positive' : ''}>{positive ? '+' : '−'}{yuan(item.amountCents).replace('¥', '')}</strong>
    </button>
  })}</div>
}

function TransactionsPage() {
  const all = useLiveQuery(() => db.transactions.orderBy('occurredAt').reverse().toArray(), []) ?? []
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? []
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? []
  const [query, setQuery] = useState(''), [account, setAccount] = useState(''), [source, setSource] = useState('')
  const [editing, setEditing] = useState<LedgerTransaction>()
  const filtered = all.filter(item => (!query || `${item.merchant}${item.note}`.toLowerCase().includes(query.toLowerCase())) && (!account || item.accountId === account) && (!source || item.source === source))
  const grouped = filtered.reduce((result, item) => {
    const key = localDateKey(item.occurredAt)
    result.set(key, [...(result.get(key) ?? []), item])
    return result
  }, new Map<string, LedgerTransaction[]>())
  return <div className="page">
    <PageHeader eyebrow={`${all.length} 笔已确认流水`} title="全部流水" action={<button className="circle-button" onClick={() => go('add')}>＋</button>} />
    <div className="search-row"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索商户或备注" /></div>
    <div className="filter-row">
      <select value={account} onChange={e => setAccount(e.target.value)}><option value="">全部账户</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <select value={source} onChange={e => setSource(e.target.value)}><option value="">全部来源</option><option value="manual">手工</option><option value="alipay">支付宝</option><option value="wechat">微信</option><option value="bank">银行</option><option value="ocr">截图</option></select>
    </div>
    {[...grouped.entries()].map(([day, items]) => <section className="day-group" key={day}><h2>{day} <span>{items.length} 笔</span></h2><TransactionList transactions={items} categories={categories} onEdit={setEditing} /></section>)}
    {!filtered.length && <TransactionList transactions={[]} categories={categories} />}
    {editing && <div className="modal"><div className="modal-card"><TransactionForm initial={editing} onDone={() => setEditing(undefined)} /></div></div>}
  </div>
}

interface FormState { type: TransactionType; amount: string; accountId: string; targetAccountId: string; categoryId: string; merchant: string; note: string; occurredAt: string }
function TransactionForm({ initial, prefill, onDone }: { initial?: LedgerTransaction; prefill?: QuickEntryPrefill; onDone: () => void }) {
  const accounts = useLiveQuery(() => db.accounts.filter(a => !a.inactive).toArray(), []) ?? []
  const categories = useLiveQuery(() => db.categories.filter(c => !c.archived).toArray(), []) ?? []
  const [form, setForm] = useState<FormState>({
    type: initial?.type ?? prefill?.type ?? 'expense', amount: initial ? (initial.amountCents / 100).toFixed(2) : prefill?.amount ?? '', accountId: initial?.accountId ?? '',
    targetAccountId: initial?.targetAccountId ?? '', categoryId: initial?.categoryId ?? '', merchant: initial?.merchant ?? prefill?.merchant ?? '', note: initial?.note ?? prefill?.note ?? '', occurredAt: dateTimeLocalValue(initial?.occurredAt ?? prefill?.occurredAt)
  })
  const [error, setError] = useState('')
  useEffect(() => {
    if (form.accountId || !accounts[0]) return
    const requested = prefill?.account
    const matched = accounts.find(account => account.id === requested || account.type === requested || account.name === requested)
    const sourceFallback = accounts.find(account => account.type === prefill?.source)
    setForm(value => ({ ...value, accountId: (matched ?? sourceFallback ?? accounts[0])!.id }))
  }, [accounts, form.accountId, prefill?.account])
  const availableCategories = categories.filter(c => c.kind === (form.type === 'income' ? 'income' : 'expense'))
  const patch = (value: Partial<FormState>) => setForm(previous => ({ ...previous, ...value }))
  async function save(event: FormEvent) {
    event.preventDefault()
    const amountCents = Math.round(Number(form.amount) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) return setError('请输入有效金额')
    if (!form.accountId) return setError('请选择账户')
    if (form.type === 'transfer' && (!form.targetAccountId || form.targetAccountId === form.accountId)) return setError('请选择不同的转入账户')
    const now = new Date().toISOString(), occurredAt = new Date(form.occurredAt).toISOString()
    const item: LedgerTransaction = {
      id: initial?.id ?? crypto.randomUUID(), type: form.type, amountCents, currency: 'CNY', occurredAt,
      merchant: form.merchant.trim() || typeLabel[form.type], note: form.note.trim(), accountId: form.accountId,
      targetAccountId: form.type === 'transfer' ? form.targetAccountId : undefined, categoryId: form.type === 'transfer' ? undefined : form.categoryId || guessCategory(form.merchant, form.note, form.type),
      source: initial?.source ?? prefill?.source ?? 'manual', externalId: initial?.externalId, importBatchId: initial?.importBatchId,
      fingerprint: makeFingerprint({ occurredAt, amountCents, type: form.type, merchant: form.merchant, accountId: form.accountId }),
      status: 'confirmed', manuallyEdited: Boolean(initial), createdAt: initial?.createdAt ?? now, updatedAt: now
    }
    if (!initial) {
      const exact = await db.transactions.where('fingerprint').equals(item.fingerprint).first()
      if (exact) return setError('这笔交易已经记录过，请勿重复保存')
      const possible = await db.transactions.filter(existing => existing.amountCents === item.amountCents && existing.type === item.type && existing.source !== item.source && Math.abs(new Date(existing.occurredAt).getTime() - new Date(item.occurredAt).getTime()) <= 10 * 60_000).first()
      if (possible && !confirm(`发现可能重复的记录：${possible.merchant} ${yuan(possible.amountCents)}。\n\n如果是同一笔付款，请点“取消”；只有确实是两笔交易时才点“确定”。`)) return
    }
    await db.transactions.put(item); await noteDataChange(); onDone()
  }
  async function remove() {
    if (!initial || !confirm('确定删除这笔流水吗？')) return
    await db.transactions.delete(initial.id); await noteDataChange(); onDone()
  }
  return <div className="page form-page">
    <PageHeader eyebrow={initial ? '修改已确认流水' : prefill?.amount || prefill?.note ? '已自动填写，请核对后保存' : '金额优先，快速完成'} title={initial ? '编辑流水' : '记一笔'} action={initial ? <button className="text-danger" onClick={remove}>删除</button> : undefined} />
    <form onSubmit={save}>
      <div className="segmented">{(['expense', 'income', 'refund', 'transfer'] as TransactionType[]).map(type => <button type="button" key={type} className={form.type === type ? 'selected' : ''} onClick={() => patch({ type, categoryId: '' })}>{typeLabel[type]}</button>)}</div>
      <label className="amount-field"><span>¥</span><input inputMode="decimal" autoFocus={!initial} value={form.amount} onChange={e => patch({ amount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0.00" /></label>
      <div className="form-card">
        <label><span>账户</span><select value={form.accountId} onChange={e => patch({ accountId: e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        {form.type === 'transfer' && <label><span>转入</span><select value={form.targetAccountId} onChange={e => patch({ targetAccountId: e.target.value })}><option value="">请选择</option>{accounts.filter(a => a.id !== form.accountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        {form.type !== 'transfer' && <label><span>分类</span><select value={form.categoryId} onChange={e => patch({ categoryId: e.target.value })}><option value="">自动判断</option>{availableCategories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select></label>}
        <label><span>商户</span><input value={form.merchant} onChange={e => patch({ merchant: e.target.value })} placeholder="例如：早餐店" /></label>
        <label><span>时间</span><input type="datetime-local" value={form.occurredAt} onChange={e => patch({ occurredAt: e.target.value })} /></label>
        <label><span>备注</span><input value={form.note} onChange={e => patch({ note: e.target.value })} placeholder="可选" /></label>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="form-actions">{initial && <button type="button" className="secondary" onClick={onDone}>取消</button>}<button className="primary" type="submit">{initial ? '保存修改' : '确认记账'}</button></div>
    </form>
  </div>
}

function ImportPage() {
  const accounts = useLiveQuery(() => db.accounts.filter(a => !a.inactive).toArray(), []) ?? []
  const categories = useLiveQuery(() => db.categories.filter(c => !c.archived).toArray(), []) ?? []
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [parsed, setParsed] = useState<ParsedFile>()
  const [fileMeta, setFileMeta] = useState<{ name: string; hash: string; source: 'alipay' | 'wechat' | 'bank' | 'ocr' }>()
  const [accountId, setAccountId] = useState('account-alipay')
  const [map, setMap] = useState<GenericColumnMap>({ date: '', amount: '' })
  const [candidates, setCandidates] = useState<ImportCandidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  async function chooseFile(file?: File) {
    if (!file) return
    setMessage(''); setCandidates([]); setParsed(undefined)
    const hash = await hashBuffer(await file.arrayBuffer())
    if (await db.importBatches.where('fileHash').equals(hash).first()) { setMessage('这份文件已经导入过，无需重复处理。'); return }
    if (file.type.startsWith('image/')) {
      setBusy('正在本机识别图片，首次使用需下载中文识别模型…')
      try {
        const { createWorker } = await import('tesseract.js')
        const worker = await createWorker('chi_sim+eng', undefined, { logger: status => { if (status.status === 'recognizing text') setBusy(`正在识别文字 ${Math.round(status.progress * 100)}%`) } })
        setBusy('正在增强深色截图…')
        const preparedImage = await prepareImageForOcr(file)
        setBusy('正在本机识别文字…')
        const result = await worker.recognize(preparedImage)
        await worker.terminate()
        const sourceAccount = accounts.find(a => a.id === accountId)?.id ?? accounts[0]?.id ?? ''
        const marked = await markDuplicates(candidatesFromOcr(result.data.text, sourceAccount, accounts).map(c => ({ ...c, categoryId: guessCategory(c.merchant, c.note, c.type) })))
        setFileMeta({ name: file.name, hash, source: 'ocr' }); setCandidates(marked); setSelected(new Set(marked.filter(c => c.state === 'ready').map(c => c.id)))
      } catch (error) { setMessage(error instanceof Error ? error.message : '图片识别失败') } finally { setBusy('') }
      return
    }
    setBusy('正在读取账单…')
    try {
      const result = await parseStatement(file)
      const source = result.source === 'unknown' ? 'bank' : result.source
      const matchingAccount = accounts.find(a => a.type === source)?.id ?? accounts[0]?.id ?? ''
      setAccountId(matchingAccount); setParsed(result); setFileMeta({ name: file.name, hash, source })
      if (result.source !== 'unknown') await prepareCandidates(result, matchingAccount)
      else {
        setMap({ date: result.headers.find(h => /日期|时间/.test(h)) ?? '', amount: result.headers.find(h => /金额|支出|收入/.test(h)) ?? '' })
        setMessage('这是通用账单，请先映射日期和金额列。')
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '账单读取失败') } finally { setBusy('') }
  }

  async function prepareCandidates(sourceParsed = parsed, sourceAccount = accountId, customMap?: GenericColumnMap) {
    if (!sourceParsed) return
    const list = rowsToCandidates(sourceParsed, sourceAccount, customMap).map(c => ({ ...c, categoryId: guessCategory(c.merchant, c.note, c.type) }))
    const marked = await markDuplicates(list)
    setCandidates(marked); setSelected(new Set(marked.filter(c => c.state === 'ready').map(c => c.id))); setMessage('')
  }

  function updateCandidate(id: string, patch: Partial<ImportCandidate>) {
    setCandidates(items => items.map(item => item.id === id ? { ...item, ...patch, manuallyEdited: true } : item))
  }

  async function repairCandidate(id: string, patch: Partial<ImportCandidate>) {
    const current = candidates.find(candidate => candidate.id === id)
    if (!current) return
    const updated = { ...current, ...patch, manuallyEdited: true }
    updated.fingerprint = makeFingerprint({ occurredAt: updated.occurredAt, amountCents: updated.amountCents, type: updated.type, merchant: updated.merchant, accountId: updated.accountId ?? accountId })
    if (updated.amountCents > 0 && updated.occurredAt) {
      updated.issue = undefined
      updated.state = 'ready'
      updated.confidence = Math.max(updated.confidence, 0.6)
      const [checked] = await markDuplicates([updated])
      if (checked) Object.assign(updated, checked)
    } else {
      updated.state = 'invalid'
      updated.issue = updated.amountCents > 0 ? '日期无法识别' : '未识别到金额，请手工输入'
    }
    setCandidates(items => items.map(item => item.id === id ? updated : item))
    setSelected(value => {
      const next = new Set(value)
      updated.state === 'ready' ? next.add(id) : next.delete(id)
      return next
    })
  }

  async function confirmImport() {
    if (!fileMeta) return
    const chosen = candidates.filter(c => selected.has(c.id) && c.state !== 'exact-duplicate' && c.state !== 'invalid')
    if (!chosen.length) return setMessage('没有选择可导入的记录')
    const batchId = crypto.randomUUID(), now = new Date().toISOString()
    const transactions: LedgerTransaction[] = chosen.map(item => ({
      id: crypto.randomUUID(), type: item.type, amountCents: item.amountCents, currency: 'CNY', occurredAt: item.occurredAt,
      merchant: item.merchant, note: item.note, categoryId: item.type === 'transfer' ? undefined : item.categoryId,
      accountId: item.accountId ?? accountId, source: item.source, externalId: item.externalId,
      fingerprint: makeFingerprint({ occurredAt: item.occurredAt, amountCents: item.amountCents, type: item.type, merchant: item.merchant, accountId: item.accountId ?? accountId }),
      importBatchId: batchId, status: 'confirmed', manuallyEdited: Boolean(item.manuallyEdited), createdAt: now, updatedAt: now
    }))
    await db.transaction('rw', db.importBatches, db.importCandidates, db.transactions, async () => {
      await db.importBatches.add({ id: batchId, source: fileMeta.source, fileName: fileMeta.name, fileHash: fileMeta.hash, importedAt: now, totalCount: candidates.length, importedCount: chosen.length, duplicateCount: candidates.filter(c => c.state.includes('duplicate')).length, errorCount: candidates.filter(c => c.state === 'invalid').length })
      await db.importCandidates.bulkPut(candidates.map(c => ({ ...c, batchId, state: selected.has(c.id) ? 'imported' : c.state === 'ready' ? 'skipped' : c.state })))
      await db.transactions.bulkAdd(transactions)
    })
    await noteDataChange(); setCandidates([]); setParsed(undefined); setFileMeta(undefined); setMessage(`已安全导入 ${chosen.length} 笔，重复和异常项未入账。`)
  }

  const headers = parsed?.headers ?? []
  return <div className="page">
    <PageHeader eyebrow="本机处理，不上传账单" title="智能导入" />
    <section className="import-hero">
      <div className="scan-orbit">⌁</div><h2>账单或支付截图</h2><p>支持支付宝、微信 CSV/TXT/ZIP，银行卡通用 CSV，以及照片和截图 OCR。</p>
      <button className="primary" onClick={() => inputRef.current?.click()}>选择文件或照片</button>
      <input ref={inputRef} hidden type="file" accept=".csv,.txt,.zip,text/csv,image/*" onChange={e => void chooseFile(e.target.files?.[0])} />
    </section>
    <div className="privacy-note"><b>隐私说明</b><span>图片和账单只在此设备处理。OCR 首次使用会下载语言模型，但不会上传图片。</span></div>
    {busy && <div className="progress-card"><span className="spinner" />{busy}</div>}
    {message && <div className="status-message">{message}</div>}
    {parsed?.source === 'unknown' && candidates.length === 0 && <section className="section-card mapping-card"><div className="section-title"><h2>映射银行卡列</h2><span>{parsed.rows.length} 行</span></div>
      {(['date', 'amount', 'direction', 'merchant', 'note', 'externalId'] as const).map(key => <label key={key}><span>{{ date: '日期 *', amount: '金额 *', direction: '收支方向', merchant: '商户/摘要', note: '备注', externalId: '流水号' }[key]}</span><select value={map[key] ?? ''} onChange={e => setMap(value => ({ ...value, [key]: e.target.value }))}><option value="">未选择</option>{headers.map(h => <option key={h} value={h}>{h}</option>)}</select></label>)}
      <button className="primary" disabled={!map.date || !map.amount} onClick={() => void prepareCandidates(parsed, accountId, map)}>生成预览</button>
    </section>}
    {candidates.length > 0 && <section className="review-section">
      <div className="review-head"><div><h2>确认导入</h2><p>{candidates.length} 条候选 · 已选 {selected.size} 条</p></div><select value={accountId} onChange={e => { setAccountId(e.target.value); setCandidates(items => items.map(c => ({ ...c, accountId: e.target.value }))) }}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div className="candidate-list">{candidates.map(candidate => <article className={`candidate ${candidate.state}`} key={candidate.id}>
        <input type="checkbox" checked={selected.has(candidate.id)} disabled={candidate.state === 'invalid' || candidate.state === 'exact-duplicate'} onChange={e => setSelected(value => { const next = new Set(value); e.target.checked ? next.add(candidate.id) : next.delete(candidate.id); return next })} />
        <div className="candidate-main"><div><input aria-label="商户" value={candidate.merchant} onChange={e => updateCandidate(candidate.id, { merchant: e.target.value })} /><label className="candidate-amount"><span>¥</span><input aria-label="金额" inputMode="decimal" defaultValue={candidate.amountCents ? (candidate.amountCents / 100).toFixed(2) : ''} placeholder="输入金额" onBlur={e => void repairCandidate(candidate.id, { amountCents: Math.round(Math.abs(Number(e.target.value)) * 100) || 0 })} /></label></div><small>{candidate.occurredAt ? new Date(candidate.occurredAt).toLocaleString('zh-CN') : '无日期'} · {typeLabel[candidate.type]} · 置信度 {Math.round(candidate.confidence * 100)}%</small>
          <div className="candidate-fields"><select aria-label="交易类型" value={candidate.type} onChange={e => updateCandidate(candidate.id, { type: e.target.value as TransactionType })}>{(['expense', 'income', 'refund', 'transfer'] as TransactionType[]).map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}</select><select aria-label="实际扣款账户" value={candidate.accountId ?? accountId} onChange={e => updateCandidate(candidate.id, { accountId: e.target.value })}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select><select aria-label="分类" value={candidate.categoryId ?? ''} onChange={e => updateCandidate(candidate.id, { categoryId: e.target.value })}>{categories.filter(c => c.kind === (candidate.type === 'income' ? 'income' : 'expense')).map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select></div>
          <label className="candidate-date"><span>交易时间</span><input aria-label="交易时间" type="datetime-local" value={dateTimeLocalValue(candidate.occurredAt)} onChange={e => void repairCandidate(candidate.id, { occurredAt: e.target.value ? new Date(e.target.value).toISOString() : '' })} /></label>
          {candidate.issue && <em>{candidate.issue}</em>}
        </div>
      </article>)}</div>
      <div className="sticky-confirm"><button className="primary" onClick={() => void confirmImport()}>确认导入 {selected.size} 笔</button></div>
    </section>}
    {!candidates.length && !busy && <section className="section-card tips"><h2>导入原则</h2><ol><li>相同文件不会重复导入</li><li>相同流水号自动拦截</li><li>同额近时交易需要你确认</li><li>还款、充值和转账不计收支</li></ol></section>}
  </div>
}

function SettingsPage() {
  const accounts = useLiveQuery(() => db.accounts.orderBy('createdAt').toArray(), []) ?? []
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? []
  const transactions = useLiveQuery(() => db.transactions.toArray(), []) ?? []
  const lastBackup = useLiveQuery(() => db.settings.get('lastBackupAt'), [])
  const restoreRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState(''), [message, setMessage] = useState('')
  const [newAccount, setNewAccount] = useState(''), [accountType, setAccountType] = useState<AccountType>('bank')
  const [newCategory, setNewCategory] = useState('')

  async function exportEncrypted() {
    try {
      const encrypted = await encryptBackup(await readAllData(), password)
      downloadBlob(new Blob([JSON.stringify(encrypted)], { type: 'application/json' }), `每日账本-完整备份-${localDateKey(new Date())}.ledger`)
      await db.settings.bulkPut([{ key: 'lastBackupAt', value: new Date().toISOString() }, { key: 'changesSinceBackup', value: '0' }]); setMessage('完整加密备份已生成，请保存到 iCloud Drive。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '备份失败') }
  }
  async function exportCsv() {
    downloadBlob(new Blob(['\uFEFF', transactionsCsv(transactions, accounts, categories)], { type: 'text/csv;charset=utf-8' }), `每日账本-流水-${localDateKey(new Date())}.csv`)
  }
  async function restore(file?: File) {
    if (!file || !password) return setMessage('请先输入备份密码')
    if (!confirm('恢复会替换当前手机里的全部账本数据，是否继续？')) return
    try {
      const envelope = JSON.parse(await file.text()) as EncryptedBackup
      await restoreAllData(await decryptBackup(envelope, password)); setMessage('恢复完成，账本数据已替换。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '恢复失败') }
  }
  async function addAccount() {
    if (!newAccount.trim()) return
    const now = new Date().toISOString(); await db.accounts.add({ id: crypto.randomUUID(), name: newAccount.trim(), type: accountType, openingBalanceCents: 0, openingDate: now, inactive: false, createdAt: now }); await noteDataChange(); setNewAccount(''); setMessage('账户已添加。')
  }
  async function renameAccount(account: Account) {
    const name = prompt('请输入新的账户名称', account.name)
    if (name === null || !name.trim() || name.trim() === account.name) return
    await db.accounts.update(account.id, { name: name.trim() }); await noteDataChange(); setMessage(`账户已改名为“${name.trim()}”。`)
  }
  async function toggleAccount(account: Account) {
    await db.accounts.update(account.id, { inactive: !account.inactive }); await noteDataChange(); setMessage(account.inactive ? '账户已重新启用。' : '账户已停用，历史流水仍会保留。')
  }
  async function deleteAccount(account: Account) {
    const [sourceCount, targetCount] = await Promise.all([
      db.transactions.where('accountId').equals(account.id).count(),
      db.transactions.where('targetAccountId').equals(account.id).count()
    ])
    if (sourceCount + targetCount > 0) return setMessage(`“${account.name}”已有 ${sourceCount + targetCount} 笔相关流水，不能删除；请使用“停用”以保留历史数据。`)
    if (!confirm(`确定删除没有流水的账户“${account.name}”吗？`)) return
    await db.accounts.delete(account.id); await noteDataChange(); setMessage('账户已删除。')
  }
  async function addCategory() {
    if (!newCategory.trim()) return
    await db.categories.add({ id: crypto.randomUUID(), name: newCategory.trim(), emoji: '🏷️', color: '#64748b', kind: 'expense', archived: false }); await noteDataChange(); setNewCategory(''); setMessage('支出分类已添加。')
  }
  async function editCategory(category: Category) {
    const name = prompt('请输入分类名称', category.name)
    if (name === null || !name.trim()) return
    const emoji = prompt('请输入一个分类图标（可以直接输入 Emoji）', category.emoji)
    if (emoji === null) return
    await db.categories.update(category.id, { name: name.trim(), emoji: emoji.trim() || '🏷️' }); await noteDataChange(); setMessage('支出分类已修改。')
  }
  async function toggleCategory(category: Category) {
    await db.categories.update(category.id, { archived: !category.archived }); await noteDataChange(); setMessage(category.archived ? '分类已重新显示。' : '分类已隐藏，历史流水仍会保留。')
  }
  async function deleteCategory(category: Category) {
    const [transactionCount, ruleCount] = await Promise.all([
      db.transactions.where('categoryId').equals(category.id).count(),
      db.categoryRules.where('categoryId').equals(category.id).count()
    ])
    if (transactionCount + ruleCount > 0) return setMessage(`“${category.name}”已被流水或分类规则使用，不能删除；可以改名或隐藏。`)
    if (!confirm(`确定删除未使用的分类“${category.name}”吗？`)) return
    await db.categories.delete(category.id); await noteDataChange(); setMessage('支出分类已删除。')
  }
  return <div className="page settings-page">
    <PageHeader eyebrow="数据只属于你" title="设置与备份" />
    {message && <p className="status-message">{message}</p>}
    <section className="section-card"><div className="section-title"><h2>完整加密备份</h2><span>{lastBackup?.value ? `上次 ${new Date(lastBackup.value).toLocaleDateString('zh-CN')}` : '尚未备份'}</span></div>
      <p className="muted">密码不会保存；忘记密码将无法恢复。建议把 .ledger 文件保存到“文件”中的 iCloud Drive。</p>
      <label className="standalone-label">备份密码（至少 8 个字符）<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label>
      <div className="button-pair"><button className="primary" onClick={() => void exportEncrypted()}>导出加密备份</button><button className="secondary" onClick={() => restoreRef.current?.click()}>恢复备份</button></div>
      <input hidden ref={restoreRef} type="file" accept=".ledger,application/json" onChange={e => void restore(e.target.files?.[0])} />
      <button className="link-button" onClick={exportCsv}>另存一份可阅读 CSV</button>
    </section>
    <section className="section-card"><div className="section-title"><h2>账户</h2><span>{accounts.filter(a => !a.inactive).length} 个</span></div>
      <p className="muted">有流水的账户不能直接删除，可以停用；这样不会破坏历史统计。</p>
      <div className="manage-list">{accounts.map(a => <div key={a.id} className={`manage-item ${a.inactive ? 'is-muted' : ''}`}><div><b>{a.name}</b><small>{a.inactive ? '已停用' : '使用中'}</small></div><div className="manage-actions"><button onClick={() => void renameAccount(a)}>改名</button><button onClick={() => void toggleAccount(a)}>{a.inactive ? '启用' : '停用'}</button><button className="danger-mini" onClick={() => void deleteAccount(a)}>删除</button></div></div>)}</div>
      <div className="inline-form"><input value={newAccount} onChange={e => setNewAccount(e.target.value)} placeholder="新账户名称" /><select value={accountType} onChange={e => setAccountType(e.target.value as AccountType)}><option value="bank">银行卡</option><option value="cash">现金</option><option value="other">其他</option></select><button onClick={() => void addAccount()}>添加</button></div>
    </section>
    <section className="section-card"><div className="section-title"><h2>支出分类</h2><span>{categories.filter(c => c.kind === 'expense' && !c.archived).length} 个</span></div>
      <p className="muted">名称和图标都可以修改；有历史流水的分类可隐藏，但不会被误删。</p>
      <div className="manage-list">{categories.filter(c => c.kind === 'expense').map(c => <div key={c.id} className={`manage-item ${c.archived ? 'is-muted' : ''}`}><div><b>{c.emoji} {c.name}</b><small>{c.archived ? '已隐藏' : '显示中'}</small></div><div className="manage-actions"><button onClick={() => void editCategory(c)}>修改</button><button onClick={() => void toggleCategory(c)}>{c.archived ? '显示' : '隐藏'}</button><button className="danger-mini" onClick={() => void deleteCategory(c)}>删除</button></div></div>)}</div>
      <div className="inline-form"><input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="新分类名称" /><button onClick={() => void addCategory()}>添加</button></div>
    </section>
    <section className="section-card about-card"><h2>快捷指令入口</h2><p>操作按钮可打开带金额和账户的链接：<code>/#/add?amount=28.5&amp;account=wechat</code>。账户可填写 <code>alipay</code>、<code>wechat</code> 或 <code>bank</code>。</p><p>多家银行可以共用一条短信自动化：条件设为短信正文包含“银行】”，再把短信正文作为 <code>sms</code> 参数传入。应用会在本机提取金额、商户和时间，并在保存前让你核对。</p></section>
    <section className="section-card about-card"><h2>关于每日账本</h2><p>离线优先的个人收支 PWA。它不能直接读取支付宝、微信或其他 App 通知；快捷指令仅把你主动输入的内容或符合条件的银行短信交给应用。</p></section>
  </div>
}
