import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql, type Kysely } from 'kysely'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteDb } from '../src/db/sqlite.js'
import type { DB } from '../src/db/db.js'

const dirs: string[] = []
const dbs: Kysely<DB>[] = []

async function tempDb(): Promise<Kysely<DB>> {
  const dir = await mkdtemp(join(tmpdir(), 'wx-daily-sqlite-'))
  dirs.push(dir)
  const db = createSqliteDb(join(dir, 'app.db'))
  dbs.push(db)
  return db
}

afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => db.destroy()))
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('sqlite 驱动适配器', () => {
  it('能建表、插入中文、读回', async () => {
    const db = await tempDb()
    await sql`create table t (a text, b integer)`.execute(db)
    await sql`insert into t (a, b) values (${'中文'}, ${1})`.execute(db)
    const rows = await sql<{ a: string; b: number }>`select a, b from t`.execute(db)
    expect(rows.rows).toEqual([{ a: '中文', b: 1 }])
  })

  it('Date 参数被存成 ISO 字符串而不是 NULL', async () => {
    const db = await tempDb()
    await sql`create table t (d text)`.execute(db)
    const now = new Date('2026-11-08T01:02:03.400Z')
    await sql`insert into t (d) values (${now})`.execute(db)
    const rows = await sql<{ d: string }>`select d from t`.execute(db)
    expect(rows.rows[0]?.d).toBe('2026-11-08T01:02:03.400Z')
  })

  it('boolean 参数存成 0/1', async () => {
    const db = await tempDb()
    await sql`create table t (b integer)`.execute(db)
    await sql`insert into t (b) values (${true})`.execute(db)
    const rows = await sql<{ b: number }>`select b from t`.execute(db)
    expect(rows.rows[0]?.b).toBe(1)
  })

  it('读取与写入语句都能正确执行', async () => {
    const db = await tempDb()
    await sql`create table t (a text)`.execute(db)
    await sql`insert into t (a) values (${'x'})`.execute(db)
    await sql`update t set a = ${'y'}`.execute(db)
    const rows = await sql<{ a: string }>`select a from t`.execute(db)
    expect(rows.rows).toEqual([{ a: 'y' }])
  })

  it('事务提交后可见，抛错后回滚不留痕', async () => {
    const db = await tempDb()
    await sql`create table t (a text)`.execute(db)
    await db.transaction().execute(async (trx) => {
      await sql`insert into t (a) values (${'kept'})`.execute(trx)
    })
    await expect(
      db.transaction().execute(async (trx) => {
        await sql`insert into t (a) values (${'dropped'})`.execute(trx)
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    const rows = await sql<{ a: string }>`select a from t`.execute(db)
    expect(rows.rows).toEqual([{ a: 'kept' }])
  })

  it('外键级联删除生效', async () => {
    const db = await tempDb()
    await sql`create table p (id text primary key)`.execute(db)
    await sql`create table c (id text primary key, pid text references p(id) on delete cascade)`.execute(db)
    await sql`insert into p (id) values (${'p1'})`.execute(db)
    await sql`insert into c (id, pid) values (${'c1'}, ${'p1'})`.execute(db)
    await sql`delete from p where id = ${'p1'}`.execute(db)
    const rows = await sql<{ n: number }>`select count(*) as n from c`.execute(db)
    expect(rows.rows[0]?.n).toBe(0)
  })
})
