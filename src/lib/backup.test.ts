import { describe, expect, it } from 'vitest'
import { decryptBackup, encryptBackup, type BackupPayload } from './backup'

const payload: BackupPayload = { format: 'daily-ledger-backup', version: 1, exportedAt: '2026-09-14T00:00:00.000Z', accounts: [], categories: [], transactions: [], importBatches: [], importCandidates: [], categoryRules: [], settings: [] }

describe('加密备份', () => {
  it('可以使用正确密码加密并恢复', async () => {
    const encrypted = await encryptBackup(payload, 'strong-password', 1_000)
    await expect(decryptBackup(encrypted, 'strong-password')).resolves.toEqual(payload)
  })

  it('拒绝错误密码', async () => {
    const encrypted = await encryptBackup(payload, 'strong-password', 1_000)
    await expect(decryptBackup(encrypted, 'wrong-password')).rejects.toThrow('密码错误')
  })
})
