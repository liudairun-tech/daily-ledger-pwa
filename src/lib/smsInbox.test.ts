import { beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { db, LedgerDatabase } from '../db'
import { ingestSmsText, prepareInbox, commitInbox, saveInboxDraft, undoTransferMerge, inboxStatus, isActiveInboxStatus, setInboxManualStatus } from './smsInbox'
import { readAllData, restoreAllData } from './backup'
import type { Account, LedgerTransaction } from '../types'

const accounts: Account[] = [
  { id: 'out', name: '浦发银行 1111', type: 'bank', ownCard: true, inactive: false, openingBalanceCents: 0, openingDate: '', createdAt: '' },
  { id: 'in', name: '建设银行 2222', type: 'bank', ownCard: true, inactive: false, openingBalanceCents: 0, openingDate: '', createdAt: '' }
]
const outgoing = '2025-03-02 19:45:10 | 您尾号1111卡人民币活期19:45手机银行取出100元[互联汇出]测试用户2222，余额100元。【浦发银行】'
const incoming = '2025-03-02 19:46:10 | 【建设银行】测试用户于3月2日19:45向您账户2222存入100元，附言：电子汇入。'
const file = { name: '测试队列.txt', modified: new Date(2025, 2, 2).getTime() }
const raw = (text: string) => text.split(' | ')[1]!
const ingest = (text: string) => ingestSmsText(text, file, accounts)

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.accounts.clear(), db.categories.clear(), db.categoryRules.clear(), db.settings.clear(), db.smsInbox.clear(), db.transferMergeAudits.clear(), db.importCandidates.clear(), db.importBatches.clear()])
  await db.accounts.bulkPut(accounts)
  await db.categories.add({ id: 'cat-other', name: '其他', kind: 'expense', emoji: '', color: '', archived: false })
})

describe('短信处理中心', () => {
  it('人工忽略在重读和备份恢复后保留，可恢复处理，状态操作不改变账目', async () => {
    const expense = '2025-03-02 20:00:00 | 您尾号1111卡20:00消费8元，余额100元。【浦发银行】'
    await ingest(expense)
    const id = (await prepareInbox())[0]!.id
    await setInboxManualStatus(id, 'ignored')
    await ingest(expense)
    await restoreAllData(await readAllData())
    let list = await prepareInbox()
    let records = await db.smsInbox.toArray(), categories = await db.categories.toArray()
    expect(inboxStatus(list[0]!, records, categories)).toBe('ignored')
    expect(isActiveInboxStatus(inboxStatus(list[0]!, records, categories))).toBe(false)
    await expect(commitInbox([id], list, true)).rejects.toThrow('恢复处理')
    expect(await db.transactions.count()).toBe(0)
    await setInboxManualStatus(id, 'pending')
    list = await prepareInbox(); records = await db.smsInbox.toArray()
    expect(inboxStatus(list[0]!, records, categories)).toBe('pending')
    await expect(commitInbox([id], list, true)).rejects.toThrow('分类')
    await setInboxManualStatus(id, 'category')
    await saveInboxDraft(id, { categoryId: 'cat-other' }, true)
    expect((await db.smsInbox.get(id))?.manualStatus).toBeUndefined()
    list = await prepareInbox()
    await commitInbox([id], list, true)
    await expect(setInboxManualStatus(id, 'pending')).rejects.toThrow('已记账')
    expect(await db.transactions.count()).toBe(1)
  })

  it('人工暂缓的一侧不参与配对，恢复后可配对；配对卡片同时标记两条原文', async () => {
    await ingest(outgoing)
    const id = (await prepareInbox())[0]!.id
    await setInboxManualStatus(id, 'deferred')
    await ingest(incoming)
    let list = await prepareInbox()
    expect(list).toHaveLength(2)
    expect(list.every(c => (c.smsOriginals?.length ?? 0) < 2)).toBe(true)
    await setInboxManualStatus(id, undefined)
    list = await prepareInbox()
    expect(list).toHaveLength(1)
    expect(list[0]!.smsOriginals).toHaveLength(2)
    await setInboxManualStatus(id, 'ignored')
    expect((await db.smsInbox.toArray()).every(r => r.manualStatus === 'ignored')).toBe(true)
    expect(await db.transactions.count()).toBe(0)
  })

  it('先收入后汇出，分文件导入后仍只生成一张转账，重读不重复入账', async () => {
    expect((await ingest(incoming)).added).toBe(1)
    expect((await prepareInbox())[0]!.waitingForPair).toBe(true)
    await ingest(outgoing)
    const paired = await prepareInbox()
    expect(paired).toHaveLength(1)
    expect(paired[0]).toMatchObject({ type: 'transfer', accountId: 'out', targetAccountId: 'in' })
    expect(paired[0]!.inboxIds).toHaveLength(2)
    await commitInbox([paired[0]!.id], paired, true)
    expect(await db.transactions.count()).toBe(1)
    expect((await ingest(`${incoming}\n${outgoing}`)).added).toBe(0)
    expect((await prepareInbox())[0]!.state).toBe('exact-duplicate')
    await expect(commitInbox([paired[0]!.id], paired, true)).rejects.toThrow('已记账')
  })

  it('仅有一侧不能提前入账，未登记本人卡不能配对', async () => {
    await ingest(outgoing)
    let list = await prepareInbox()
    expect(list[0]!.waitingForPair).toBe(true)
    await expect(commitInbox([list[0]!.id], list, false)).rejects.toThrow('待配对')
    await ingest(incoming)
    await db.accounts.update('in', { ownCard: false })
    list = await prepareInbox()
    expect(list).toHaveLength(2)
    expect(list.every(c => c.waitingForPair)).toBe(true)
  })

  it('历史误记必须经过预览批准，合并保留快照并可撤销', async () => {
    const tx = (id: string, type: 'income' | 'expense', accountId: string, note: string): LedgerTransaction => ({ id, type, accountId, note, amountCents: 10000, currency: 'CNY', occurredAt: new Date(2025, 2, 2, 19, 45).toISOString(), merchant: '旧记录', source: 'bank', fingerprint: id, status: 'confirmed', manuallyEdited: false, createdAt: '', updatedAt: '' })
    const old = [tx('a', 'expense', 'out', raw(outgoing)), tx('b', 'income', 'in', raw(incoming))]
    await db.transactions.bulkPut(old)
    await ingest(incoming)
    const paired = await prepareInbox()
    expect(paired).toHaveLength(1)
    expect(paired[0]!.mergeIds?.sort()).toEqual(['a', 'b'])
    await expect(commitInbox([paired[0]!.id], paired, false)).rejects.toThrow('预览')
    expect(await db.transactions.count()).toBe(2)
    await commitInbox([paired[0]!.id], paired, true)
    expect(await db.transactions.count()).toBe(1)
    const audit = (await db.transferMergeAudits.toArray())[0]!
    expect(audit.before).toHaveLength(2)
    await undoTransferMerge(audit.id)
    expect((await db.transactions.toArray()).sort((a, b) => a.id.localeCompare(b.id))).toEqual(old)
  })

  it('重复读取保留手工分类、异常记录和原文，并可完整备份恢复', async () => {
    const expense = '2025-03-02 20:00:00 | 您尾号1111卡20:00消费8元，余额100元。【浦发银行】'
    await ingest(`${expense}\n2025-03-02 20:01:00 | 无法识别的测试记录`)
    expect(await db.smsInbox.count()).toBe(2)
    const entry = (await db.smsInbox.toArray()).find(r => r.raw.includes('消费8'))!
    await saveInboxDraft(entry.id, { categoryId: 'cat-other' }, true)
    await ingest(expense)
    expect((await db.smsInbox.get(entry.id))!.reviewedCategory).toBe(true)
    const list = await prepareInbox()
    expect(list.some(c => c.state === 'invalid')).toBe(true)
    const payload = await readAllData()
    await restoreAllData(payload)
    expect(await db.smsInbox.count()).toBe(2)
    expect((await db.smsInbox.get(entry.id))!.raw).toBe(raw(expense))
  })

  it('迁移到新版数据库不会清空已有账户', async () => {
    const name = `inbox-migration-test-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(1).stores({ accounts: 'id, type, inactive, createdAt', categories: 'id, kind, archived, name', transactions: 'id, occurredAt, type, accountId, targetAccountId, categoryId, source, externalId, fingerprint, importBatchId, [source+externalId]', importBatches: 'id, fileHash, importedAt, source', importCandidates: 'id, batchId, source, state, fingerprint, externalId', categoryRules: 'id, [source+keyword], categoryId', settings: 'key' })
    await old.table('accounts').add(accounts[0]!)
    old.close()
    const next = new LedgerDatabase(name)
    try { expect(await next.accounts.get('out')).toEqual(accounts[0]); expect(await next.smsInbox.count()).toBe(0) } finally { next.close(); await Dexie.delete(name) }
  })

  it('多笔等额汇出不会擅自配对，手工指定后只配对选中的一笔', async () => {
    const second = outgoing.replaceAll('19:45', '19:46').replace('余额100元', '余额200元')
    await ingest(`${outgoing}\n${second}\n${incoming}`)
    let list = await prepareInbox()
    expect(list).toHaveLength(3)
    expect(list.every(c => c.waitingForPair)).toBe(true)
    const credit = list.find(c => c.type === 'income')!
    const debit = list.find(c => c.raw.sms === raw(outgoing))!
    await saveInboxDraft(debit.id, { raw: { ...debit.raw, pairWith: credit.id } })
    list = await prepareInbox()
    expect(list).toHaveLength(2)
    expect(list.find(c => c.id === debit.id)?.smsOriginals).toHaveLength(2)
    expect(list.filter(c => c.waitingForPair)).toHaveLength(1)
  })

  it('预览后的时间修改必须重新预览，类型修改需要重新确认分类', async () => {
    await ingest('2025-03-02 20:00:00 | 您尾号1111卡20:00消费8元，余额100元。【浦发银行】')
    const id = (await prepareInbox())[0]!.id
    await saveInboxDraft(id, { categoryId: 'cat-other' }, true)
    const preview = await prepareInbox()
    await saveInboxDraft(id, { occurredAt: new Date(2025, 2, 2, 20, 10).toISOString() })
    await expect(commitInbox([id], preview, true)).rejects.toThrow('重新预览')
    expect(await db.transactions.count()).toBe(0)
    await saveInboxDraft(id, { type: 'income', categoryId: undefined })
    expect((await db.smsInbox.get(id))?.reviewedCategory).toBe(false)
    const changed = await prepareInbox()
    await expect(commitInbox([id], changed, true)).rejects.toThrow('分类')
  })
})
