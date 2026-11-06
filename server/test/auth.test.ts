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

describe('WeChat authentication', () => {
  it('first login creates one user, identity and ordered default categories; repeat login reuses it', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)

    const token1 = await login(app, 'A')
    const token2 = await login(app, 'A')
    const user1 = tokenPayload(app, token1).sub
    const user2 = tokenPayload(app, token2).sub

    expect(user2).toBe(user1)

    const users = await deps.db.selectFrom('users').select('id').execute()
    expect(users).toEqual([{ id: user1 }])

    const identities = await deps.db
      .selectFrom('user_identities')
      .select(['user_id', 'provider', 'subject'])
      .execute()
    expect(identities).toEqual([
      { user_id: user1, provider: 'wechat', subject: 'A' },
    ])

    const categories = await deps.db
      .selectFrom('categories')
      .select(['name', 'sort_order'])
      .where('user_id', '=', user1)
      .orderBy('sort_order')
      .execute()
    expect(categories.map((category) => category.name)).toEqual([
      '投资',
      '学习',
      '好文章',
      '生活',
    ])
    expect(categories.map((category) => category.sort_order)).toEqual([0, 1, 2, 3])
  })

  it('looks up WeChat identities by both provider and subject', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)

    const otherUser = (
      await sql<{ id: string }>`insert into users default values returning id`.execute(deps.db)
    ).rows[0]!
    await deps.db
      .insertInto('user_identities')
      .values({ user_id: otherUser.id, provider: 'other', subject: 'A' })
      .execute()

    const token = await login(app, 'A')
    const wechatUserId = tokenPayload(app, token).sub

    expect(wechatUserId).not.toBe(otherUser.id)
    const identities = await deps.db
      .selectFrom('user_identities')
      .select(['provider', 'subject', 'user_id'])
      .orderBy('provider')
      .execute()
    expect(identities).toEqual([
      { provider: 'other', subject: 'A', user_id: otherUser.id },
      { provider: 'wechat', subject: 'A', user_id: wechatUserId },
    ])
  })

  it('returns 401 UNAUTHORIZED for an invalid WeChat code without writing data', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/auth/wechat',
      payload: { code: 'bad' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
    expect(await deps.db.selectFrom('users').select('id').execute()).toEqual([])
    expect(
      await deps.db.selectFrom('user_identities').select('id').execute(),
    ).toEqual([])
  })

  it('issues a JWT whose sub is the user id and whose lifetime is 30 days', async () => {
    const { app } = await createTestApp()
    apps.push(app)

    const token = await login(app, 'expiry')
    const payload = tokenPayload(app, token)

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

    const token = await login(app, 'bearer')
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

    const validToken = await login(app, 'expired')
    const userId = tokenPayload(app, validToken).sub
    const expiredToken = app.jwt.sign({ sub: userId }, { expiresIn: -1 })

    const response = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: authHeader(expiredToken),
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
  })

  it('keeps health, auth, files and WeChat push routes outside user authentication', async () => {
    const { app } = await createTestApp()
    apps.push(app)

    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)

    const auth = await app.inject({
      method: 'POST',
      url: '/auth/wechat',
      payload: { code: 'code_public' },
    })
    expect(auth.statusCode).toBe(200)

    const file = await app.inject({ method: 'GET', url: '/files/missing.txt' })
    expect(file.statusCode).toBe(404)
    expect(file.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })

    const push = await app.inject({ method: 'POST', url: '/wechat/push', payload: {} })
    expect(push.statusCode).toBe(404)
    expect(push.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('rolls back the whole first login when default category creation fails', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)

    await sql`
      create function fail_default_category_insert()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'forced category failure';
      end;
      $$
    `.execute(deps.db)
    await sql`
      create trigger fail_default_category_insert
      before insert on categories
      for each row execute function fail_default_category_insert()
    `.execute(deps.db)

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/wechat',
        payload: { code: 'code_rollback' },
      })
      expect(response.statusCode).toBe(500)
      expect(response.json()).toMatchObject({ error: { code: 'INTERNAL' } })
    } finally {
      await sql`drop trigger if exists fail_default_category_insert on categories`.execute(
        deps.db,
      )
      await sql`drop function if exists fail_default_category_insert()`.execute(deps.db)
    }

    expect(await deps.db.selectFrom('users').select('id').execute()).toEqual([])
    expect(
      await deps.db.selectFrom('user_identities').select('id').execute(),
    ).toEqual([])
    expect(await deps.db.selectFrom('categories').select('id').execute()).toEqual([])
  })
})
