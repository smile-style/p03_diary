import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { afterEach, describe, expect, it } from 'vitest'
import { authHeader, createTestApp, login } from './helpers.js'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

function tokenPayload(app: FastifyInstance, token: string) {
  return app.jwt.decode<{ sub: string; iat: number; exp: number }>(token)!
}

describe('local authentication', () => {
  it('GET /auth/local 返回可用 token', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const res = await app.inject({ method: 'GET', url: '/auth/local' })
    expect(res.statusCode).toBe(200)
    expect(typeof res.json().token).toBe('string')

    const me = await app.inject({
      method: 'GET', url: '/categories', headers: authHeader(res.json().token),
    })
    expect(me.statusCode).toBe(200)
  })

  it('重复调用 /auth/local 不会重复建用户', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    await app.inject({ method: 'GET', url: '/auth/local' })
    await app.inject({ method: 'GET', url: '/auth/local' })

    const users = await sql<{ n: number }>`select count(*) as n from users`.execute(deps.db)
    expect(users.rows[0]?.n).toBe(1)
  })

  it('首次登录写入四个默认分类', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = (await app.inject({ method: 'GET', url: '/auth/local' })).json().token
    const res = await app.inject({ method: 'GET', url: '/categories', headers: authHeader(token) })
    expect(res.json().items.map((item: { name: string }) => item.name)).toEqual([
      '投资', '学习', '好文章', '生活',
    ])
  })

  it('issues a JWT whose sub is the user id and whose lifetime is 30 days', async () => {
    const { app } = await createTestApp()
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/auth/local' })
    expect(response.statusCode).toBe(200)
    const payload = tokenPayload(app, response.json().token)

    expect(payload.sub).toEqual(expect.any(String))
    expect(payload.exp - payload.iat).toBe(30 * 24 * 60 * 60)
  })

  it('protects /categories and populates req.userId through the Bearer preHandler', async () => {
    const { app } = await createTestApp()
    apps.push(app)

    app.get('/session-user', { preHandler: app.requireUser }, async (request) => ({
      userId: request.userId,
    }))
    const unauthorized = await app.inject({ method: 'GET', url: '/categories' })
    expect(unauthorized.statusCode).toBe(401)
    expect(unauthorized.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })

    const token = (await app.inject({ method: 'GET', url: '/auth/local' })).json().token
    const authenticated = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: authHeader(token),
    })
    expect(authenticated.statusCode).toBe(200)
    expect(authenticated.json()).toEqual({ items: expect.any(Array) })

    const session = await app.inject({
      method: 'GET',
      url: '/session-user',
      headers: authHeader(token),
    })
    expect(session.statusCode).toBe(200)
    expect(session.json()).toEqual({ userId: tokenPayload(app, token).sub })
  })

  it.each([
    ['missing', undefined],
    ['wrong scheme', 'Basic abc'],
    ['missing token', 'Bearer'],
    ['malformed token', 'Bearer not-a-jwt'],
  ])('rejects a %s Authorization header with 401 UNAUTHORIZED', async (_name, authorization) => {
    const { app } = await createTestApp()
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: authorization ? { authorization } : undefined,
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
  })

  it('rejects an expired JWT with 401 UNAUTHORIZED', async () => {
    const { app } = await createTestApp()
    apps.push(app)

    const validResponse = await app.inject({ method: 'GET', url: '/auth/local' })
    expect(validResponse.statusCode).toBe(200)
    const userId = tokenPayload(app, validResponse.json().token).sub
    const expiredToken = app.jwt.sign({ sub: userId }, { expiresIn: -1 })

    const response = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: authHeader(expiredToken),
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
  })

  it('keeps health, local auth and files outside user authentication', async () => {
    const { app } = await createTestApp()
    apps.push(app)

    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)

    const auth = await app.inject({ method: 'GET', url: '/auth/local' })
    expect(auth.statusCode).toBe(200)

    const file = await app.inject({ method: 'GET', url: '/files/missing.txt' })
    expect(file.statusCode).toBe(403)
    expect(file.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })
})