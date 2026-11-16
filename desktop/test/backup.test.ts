import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupDatabase } from '../src/backup.js'

async function makeDb() {
  const dir = await mkdtemp(join(tmpdir(), 'wx-daily-backup-'))
  const dbFile = join(dir, 'app.db')
  const db = new DatabaseSync(dbFile)
  db.exec('create table t (a text)')
  db.prepare('insert into t (a) values (?)').run('一行')
  db.close()
  return { dir, dbFile, backups: join(dir, 'backups') }
}

describe('backupDatabase', () => {
  it('备份出的库能被独立打开且内容一致', async () => {
    const { dbFile, backups } = await makeDb()
    const path = await backupDatabase(dbFile, backups, new Date('2026-11-08T10:20:30Z'))

    expect(path.endsWith('app-20261108-102030.db')).toBe(true)
    const copy = new DatabaseSync(path)
    expect(copy.prepare('select a from t').all()[0]).toMatchObject({ a: '一行' })
    copy.close()
  })

  it('超过保留份数时删掉最旧的', async () => {
    const { dbFile, backups } = await makeDb()
    for (let i = 0; i < 5; i += 1) {
      await backupDatabase(dbFile, backups, new Date(Date.UTC(2026, 10, 8, 10, 0, i)), 3)
    }
    const files = (await readdir(backups)).sort()
    expect(files).toHaveLength(3)
    expect(files[0]).toBe('app-20261108-100002.db')
  })
})