import type { FastifyInstance } from 'fastify'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { sql } from 'kysely'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createTestApp } from './helpers.js'

const apps: FastifyInstance[] = []
const webDirs: string[] = []

afterEach(async () => {
  try {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  } finally {
    await Promise.all(
      webDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    )
  }
})

describe('server health', () => {
  it('GET /health 返回 ok 且数据库可用', async () => {
    const { app } = await createTestApp()
    apps.push(app)

    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('畸形 JSON 请求返回 400 VALIDATION', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    app.post('/test-body', async (request) => request.body)

    const res = await app.inject({
      method: 'POST',
      url: '/test-body',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken"',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION')
  })

  it('不支持的 Content-Type 返回 415 VALIDATION', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    app.post('/test-body', async (request) => request.body)

    const res = await app.inject({
      method: 'POST',
      url: '/test-body',
      headers: { 'content-type': 'application/x-unsupported' },
      payload: 'hello',
    })

    expect(res.statusCode).toBe(415)
    expect(res.json().error.code).toBe('VALIDATION')
  })

  it('未知异常返回 500 并记录错误日志', async () => {
    const { app, deps } = await createTestApp()
    const chunks: Buffer[] = []
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      },
    })
    const loggedApp = await buildApp(deps, {
      logger: { level: 'error', stream },
    })
    apps.push(app, loggedApp)
    loggedApp.get('/boom', async () => {
      throw new Error('boom')
    })

    const res = await loggedApp.inject({ method: 'GET', url: '/boom' })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL')
    expect(Buffer.concat(chunks).toString()).toContain('unhandled error')
  })

  it('迁移后所有表都存在', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)

    const tables = await sql<{ name: string }>`
      select name from sqlite_master where type = 'table' and name not like 'sqlite_%'
    `.execute(deps.db)

    expect(tables.rows.map((row) => row.name)).toEqual(
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
  it('配置了 webRoot 时根路径返回 index.html', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wx-daily-web-'))
    webDirs.push(dir)
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>ok</title>')

    const { app } = await createTestApp({ config: { webRoot: dir } })
    apps.push(app)

    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('ok')
  })

  it('未配置 webRoot 时根路径仍是 JSON 404', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('配置了 webRoot 也不影响接口路径', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wx-daily-web-'))
    webDirs.push(dir)
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>ok</title>')

    const { app } = await createTestApp({ config: { webRoot: dir } })
    apps.push(app)

    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})
