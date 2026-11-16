import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOrCreateSecrets } from '../src/secrets.js'

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'wx-daily-secrets-'))
}

describe('loadOrCreateSecrets', () => {
  it('首次生成两个不同的 64 位十六进制密钥并落盘', async () => {
    const dir = await tempDir()
    const first = await loadOrCreateSecrets(dir)
    expect(first.jwtSecret).toMatch(/^[0-9a-f]{64}$/)
    expect(first.fileUrlSecret).toMatch(/^[0-9a-f]{64}$/)
    expect(first.jwtSecret).not.toBe(first.fileUrlSecret)

    const raw = JSON.parse(await readFile(join(dir, 'secret.key'), 'utf8'))
    expect(raw.jwt).toBe(first.jwtSecret)
    expect(raw.fileUrl).toBe(first.fileUrlSecret)
  })

  it('第二次调用复用已有密钥', async () => {
    const dir = await tempDir()
    const first = await loadOrCreateSecrets(dir)
    expect(await loadOrCreateSecrets(dir)).toEqual(first)
  })

  it('密钥文件损坏时重新生成而不是崩溃', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'secret.key'), '{not json')
    const result = await loadOrCreateSecrets(dir)
    expect(result.jwtSecret).toMatch(/^[0-9a-f]{64}$/)
  })
})