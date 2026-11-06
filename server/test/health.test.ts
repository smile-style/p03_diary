import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers.js'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('server health', () => {
  it('GET /health 返回 ok 且数据库可用', async () => {
    const { app } = await createTestApp()
    apps.push(app)

    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('迁移后所有表都存在', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)

    const tables = await sql<{ t: string }>`
      select tablename as t from pg_tables where schemaname = 'public'
    `.execute(deps.db)

    expect(tables.rows.map((row) => row.t)).toEqual(
      expect.arrayContaining([
        'users',
        'user_identities',
        'categories',
        'topics',
        'records',
        'excerpts',
        'images',
        'tags',
        'record_tags',
      ]),
    )
  })
})
