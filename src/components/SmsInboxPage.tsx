import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, noteDataChange } from '../db'
import { dateTimeLocalValue, typeLabel, yuan } from '../lib/format'
import { extractTextFromFile } from '../lib/importers'
import { ownTransferTarget } from '../lib/transfers'
import { needsCategoryReview } from '../lib/categorySuggestions'
import { automaticInboxStatus, commitInbox, inboxStatus, ingestSmsText, isActiveInboxStatus, prepareInbox, saveInboxDraft, setInboxManualStatus, undoTransferMerge, type InboxFilter } from '../lib/smsInbox'
import type { ImportCandidate, SmsInboxRecord, TransactionType } from '../types'

const labels: Record<InboxFilter, string> = { pending: '待处理', category: '待分类', waiting: '待配对', duplicate: '疑似重复 / 待合并', recorded: '已记账', invalid: '异常', deferred: '暂缓处理', ignored: '已忽略', all: '全部' }
const displayTime = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '未识别'

export default function SmsInboxPage() {
  const data = useLiveQuery(async () => ({ candidates: await prepareInbox(), records: await db.smsInbox.toArray(), accounts: await db.accounts.toArray(), categories: await db.categories.toArray(), transactions: await db.transactions.toArray(), audits: await db.transferMergeAudits.orderBy('createdAt').reverse().toArray(), meta: await db.settings.get('smsInboxLastFile') }), [])
  const input = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<InboxFilter>('pending')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [preview, setPreview] = useState<ImportCandidate[]>()
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setMessage(''); try { await action() } catch (e) { setMessage(e instanceof Error ? e.message : '操作失败，请重试') } finally { setBusy(false) } }
  const accounts = data?.accounts ?? [], categories = data?.categories ?? [], records = data?.records ?? [], candidates = data?.candidates ?? []
  let meta: { name: string; modified: number; readAt: string; readCount: number; added: number; latestReceived: string; latestTransaction: string } | undefined
  try { meta = data?.meta ? JSON.parse(data.meta.value) : undefined } catch { /* Old metadata can be ignored without touching the queue. */ }
  const status = (c: ImportCandidate) => inboxStatus(c, records, categories)
  const visible = candidates.filter(c => filter === 'all' || (filter === 'pending' ? isActiveInboxStatus(status(c)) : status(c) === filter))
  const chosen = candidates.filter(c => selected.has(c.id) && isActiveInboxStatus(status(c)))
  async function ingest(file?: File) {
    if (!file) return
    await run(async () => {
      const result = await ingestSmsText(await extractTextFromFile(file), { name: file.name, modified: file.lastModified }, accounts)
      setSelected(new Set()); setFilter('pending'); setMessage(`本次读取 ${result.read} 条，新增 ${result.added} 条；历史待处理已保留。`)
    })
  }
  function beginSave() {
    if (!chosen.length) return setMessage('请先勾选要处理的记录')
    if (chosen.some(c => status(c) === 'category' || (needsCategoryReview(c.type, c.categoryId, categories) && !(c.inboxIds ?? []).every(id => records.find(r => r.id === id)?.reviewedCategory)) || c.waitingForPair || c.state === 'invalid')) return setMessage('请先为所选记录确认分类、处理配对或修正异常')
    setPreview(chosen)
  }
  async function finishSave() {
    if (!preview) return
    await run(async () => { const count = await commitInbox(preview.map(c => c.id), preview, true); setPreview(undefined); setSelected(new Set()); setMessage(`已确认 ${count} 笔。短信保留在“已记账”中，可展开查看。`) })
  }
  return <div className="page">
    <header className="page-header"><div><span>持久保存 · 按交易时间倒序</span><h1>短信处理中心</h1></div><button className="secondary" onClick={() => { location.hash = '/import' }}>返回</button></header>
    <button className="primary" disabled={busy || !data} onClick={() => input.current?.click()}>重新读取待处理短信文件</button>
    <input ref={input} type="file" hidden accept=".txt,text/plain" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void ingest(file) }} />
    {busy && <p role="status">正在处理，请稍候…</p>}{message && <div className="status-message" role="status">{message}</div>}
    <details className="section-card"><summary>登记我的银行卡（转账配对前请确认）</summary><p className="muted">仅勾选属于你自己的卡，名称需带尾号。户名不作为单独合并依据；相同尾号存在多张卡时需手工核对。</p>{accounts.filter(a => a.type === 'bank' && !a.inactive).map(a => <label className="inbox-own-card" key={a.id}><input type="checkbox" disabled={busy} checked={Boolean(a.ownCard)} onChange={e => { const value = e.target.checked; void run(async () => { await db.accounts.update(a.id, { ownCard: value }); await noteDataChange() }) }} />{a.name}</label>)}{!accounts.some(a => a.type === 'bank') && <p>请先在设置中添加银行卡。</p>}</details>
    {meta && <section className="section-card"><h2>最近一次读取</h2><p className="muted">文件：{meta.name}<br />文件修改：{displayTime(new Date(meta.modified).toISOString())}<br />读取时间：{displayTime(meta.readAt)}<br />文件最新接收：{displayTime(meta.latestReceived)}<br />文件最新交易：{displayTime(meta.latestTransaction)}</p><p className="muted">本次读取 {meta.readCount} 条，新增 {meta.added} 条。修改时间与交易时间分别展示；未出现的最新短信，请核对文件原文及 iCloud 同步。</p></section>}
    <section className="section-card"><h2>处理总览</h2><p className="muted">累计保存 {records.length} 条原短信，配对后共 {candidates.length} 张处理卡片；配对卡片含两条原文。</p><p className="muted">待处理包含待分类、待配对等需要处理的记录。手工设为暂缓或忽略后，会移出待处理；原文保留，可随时恢复。修改处理状态不会新增或删除账目。</p><div className="inbox-filters">{(Object.keys(labels) as InboxFilter[]).map(key => <button key={key} aria-pressed={filter === key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{labels[key]} {key === 'all' ? candidates.length : key === 'pending' ? candidates.filter(c => isActiveInboxStatus(status(c))).length : candidates.filter(c => status(c) === key).length}</button>)}</div></section>
    {!data && <p>正在读取本机待处理记录…</p>}
    {data && !visible.length && <p className="muted">这个分组没有记录。已记账默认折叠，可切换“已记账”或“全部”查看。</p>}
    <div className="candidate-list">{visible.map(c => {
      const entry = records.find(r => r.id === c.id)
      const recorded = status(c) === 'recorded'
      const active = isActiveInboxStatus(status(c))
      const manualStatus = (c.inboxIds ?? [c.id]).map(id => records.find(r => r.id === id)?.manualStatus).find(Boolean)
      const ownTarget = ownTransferTarget(c.raw.sms ?? '', c.accountId, accounts.filter(a => a.ownCard))
      const possibleTargets = ownTarget ? candidates.filter(i => i.type === 'income' && i.accountId === ownTarget.id && i.amountCents === c.amountCents && i.id !== c.id && !i.mergeIds?.length && status(i) !== 'recorded') : []
      return <article className={`candidate candidate-${c.type} ${c.state}`} key={c.id}>
        <input aria-label={`选择${c.merchant}`} type="checkbox" checked={selected.has(c.id) && active} disabled={busy || !active || c.waitingForPair || c.state === 'invalid'} onChange={e => setSelected(old => { const next = new Set(old); e.target.checked ? next.add(c.id) : next.delete(c.id); return next })} />
        <div className="candidate-main"><div><b>{c.merchant}</b><strong className="candidate-direction">{c.type === 'expense' ? '−' : c.type === 'income' || c.type === 'refund' ? '+' : ''}{yuan(c.amountCents)}</strong></div><p className="muted">{displayTime(c.occurredAt)} · {labels[status(c)]}</p>
          <p className="muted">{accounts.find(a => a.id === c.accountId)?.name ?? '未匹配账户'}{c.targetAccountId ? ` → ${accounts.find(a => a.id === c.targetAccountId)?.name ?? '未匹配转入账户'}` : ''}</p>
          {c.issue && <em>{c.issue}</em>}
          {!recorded && <div className="inbox-fields"><label>人工处理状态<select aria-label={`人工处理状态：${c.merchant}`} disabled={busy} value={manualStatus ?? ''} onChange={e => { const value = (e.target.value || undefined) as SmsInboxRecord['manualStatus']; void run(async () => { await setInboxManualStatus(c.id, value); setSelected(new Set()); setMessage(value ? `已设为${labels[value]}。可在对应分组或“全部”中查看和恢复。` : '已恢复自动判断。') }) }}><option value="">自动判断</option><option value="pending">需要处理（待处理）</option>{c.type !== 'transfer' && <option value="category">需要重新分类（待分类）</option>}<option value="deferred">暂缓处理</option><option value="ignored">忽略，不入账</option></select></label><p className="muted">系统判断：{labels[automaticInboxStatus(c, records, categories)]}{manualStatus ? ' · 已人工标记' : ''}。设为待处理仍需核对分类、配对和异常；确认保存后才会成为已记账。</p></div>}
          <details><summary>展开短信原文 / 识别依据</summary>{(c.smsOriginals ?? [c.raw.sms ?? c.note]).map((raw, index) => <pre className="inbox-original" key={index}>{raw}</pre>)}<p className="muted">接收时间：{displayTime(entry?.receivedAt)}。分类依据为本机关键词或已保存商户规则；时间优先取短信交易时间，其次取接收时间。</p></details>
          {!recorded && <details><summary>核对分类 / 修改识别结果</summary><div className="inbox-fields">
            <label>分类<select aria-label="确认分类" value={needsCategoryReview(c.type, c.categoryId, categories) && !entry?.reviewedCategory ? '' : c.categoryId ?? ''} disabled={busy || c.type === 'transfer'} onChange={e => { const value = e.target.value; void run(() => saveInboxDraft(c.id, { categoryId: value }, true)) }}><option value="">请手工确认分类</option>{categories.filter(k => !k.archived && k.kind === (c.type === 'income' ? 'income' : 'expense')).map(k => <option key={k.id} value={k.id}>{k.emoji} {k.name}</option>)}</select></label>
            <label>转出 / 收支账户<select value={c.accountId ?? ''} disabled={busy} onChange={e => { const value = e.target.value; void run(() => saveInboxDraft(c.id, { accountId: value })) }}><option value="">请选择</option>{accounts.filter(a => !a.inactive).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label>类型<select value={c.type} disabled={busy || Boolean(c.smsOriginals?.length === 2)} onChange={e => { const value = e.target.value as TransactionType; void run(() => saveInboxDraft(c.id, { type: value, categoryId: undefined })) }}>{(['expense', 'income', 'refund', 'transfer'] as const).map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}</select></label>
            <label>金额（元）<input inputMode="decimal" key={`${c.id}-${c.amountCents}`} defaultValue={(c.amountCents / 100).toFixed(2)} onBlur={e => { const cents = Math.round(Number(e.target.value) * 100); if (Number.isFinite(cents) && cents >= 0 && cents !== c.amountCents) void run(() => saveInboxDraft(c.id, { amountCents: cents })) }} /></label>
            <label>交易时间<input type="datetime-local" value={c.occurredAt ? dateTimeLocalValue(c.occurredAt) : ''} onChange={e => { const value = e.target.value; if (value) void run(() => saveInboxDraft(c.id, { occurredAt: new Date(value).toISOString() })) }} /></label>
            {c.type === 'transfer' && <label>转入账户<select value={c.targetAccountId ?? ''} onChange={e => { const value = e.target.value; void run(() => saveInboxDraft(c.id, { targetAccountId: value })) }}><option value="">请选择</option>{accounts.filter(a => !a.inactive && a.id !== c.accountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
          </div></details>}
          {c.waitingForPair && !recorded && <>
            {possibleTargets.length > 0 && <label className="standalone-label">多笔等额到账：手工指定对应记录<select defaultValue="" disabled={busy} onChange={e => { const id = e.target.value; if (id) void run(() => saveInboxDraft(c.id, { raw: { ...c.raw, pairWith: id } })) }}><option value="">核对原文后选择</option>{possibleTargets.map(i => <option key={i.id} value={i.id}>{displayTime(i.occurredAt)} · {yuan(i.amountCents)} · {i.merchant}</option>)}</select></label>}
            <button className="link-button" disabled={busy} onClick={() => { if (confirm('只有确认不是本人互转，或明确要单侧登记转账，才独立处理。确认后仍需勾选并预览，不会立即入账。')) void run(() => saveInboxDraft(c.id, c.type === 'transfer' ? { type: 'transfer', targetAccountId: c.targetAccountId } : {}, false, true)) }}>这条独立处理，不再等待配对</button>
          </>}
        </div>
      </article>
    })}</div>
    <div className="sticky-confirm"><button className="primary" disabled={busy || !chosen.length} onClick={beginSave}>预览并确认 {chosen.length} 笔</button></div>
    {preview && <div className="modal" role="dialog" aria-modal="true" aria-labelledby="inbox-preview-title"><div className="modal-card category-review"><h2 id="inbox-preview-title">确认入账与转账合并</h2><p className="muted">请核对前后变化。只有点击下方确认才会保存；历史修正保留快照，可在调整记录中撤销。</p>{preview.map(c => <section className="section-card" key={c.id}><h2>{typeLabel[c.type]} {yuan(c.amountCents)}</h2><p>{accounts.find(a => a.id === c.accountId)?.name} {c.targetAccountId ? `→ ${accounts.find(a => a.id === c.targetAccountId)?.name}` : ''}</p>{c.mergeIds?.length ? <><b>将替换以下已记账流水：</b>{c.mergeIds.map(id => { const t = data?.transactions.find(t => t.id === id); return <p key={id}>{t ? `${typeLabel[t.type]} ${yuan(t.amountCents)} · ${t.merchant} · ${displayTime(t.occurredAt)}` : '记录已变化，请刷新'}</p> })}<p>调整后：仅保留一笔转账，关联双方短信；不计收入或支出。</p></> : <p>新增一笔{typeLabel[c.type]}{c.type === 'transfer' ? '；不计收入或支出' : ''}。</p>}{c.state === 'possible-duplicate' && !c.mergeIds?.length && <p className="error-text">疑似重复：请确认这确实是一笔尚未记录的独立交易。</p>}</section>)}<div className="form-actions"><button className="secondary" disabled={busy} onClick={() => setPreview(undefined)}>取消</button><button className="primary" disabled={busy} onClick={() => void finishSave()}>确认保存上述结果</button></div></div></div>}
    {Boolean(data?.audits.length) && <details className="section-card"><summary>历史转账调整记录</summary>{data?.audits.map(a => <div key={a.id}><p>{displayTime(a.createdAt)} · {a.after.merchant} · {yuan(a.after.amountCents)} {a.undoneAt ? '（已撤销）' : ''}</p>{!a.undoneAt && <button className="secondary" disabled={busy} onClick={() => { if (confirm('撤销会移除合并转账，恢复合并前的原流水。确认撤销？')) void run(() => undoTransferMerge(a.id)) }}>撤销此次合并</button>}</div>)}</details>}
  </div>
}
