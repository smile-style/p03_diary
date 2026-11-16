import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { authHeader, createTestApp, loginAs } from './helpers.js'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

async function setupUsers() {
  const { app, deps } = await createTestApp()
  apps.push(app)
  const tokenA = await loginAs(app, deps, 'A')
  const tokenB = await loginAs(app, deps, 'B')
  const userIdA = app.jwt.decode<{ sub: string }>(tokenA)!.sub
  const userIdB = app.jwt.decode<{ sub: string }>(tokenB)!.sub
  for (const name of ['投资', '学习', '好文章', '生活']) {
    await createCategory(app, tokenA, name)
    await createCategory(app, tokenB, name)
  }
  return { app, deps, tokenA, tokenB, userIdA, userIdB }
}

async function request(
  app: FastifyInstance,
  token: string,
  options: InjectOptions,
) {
  return app.inject({
    ...options,
    headers: {
      ...authHeader(token),
      ...options.headers,
    },
  })
}

async function createCategory(app: FastifyInstance, token: string, name: string) {
  const response = await request(app, token, {
    method: 'POST',
    url: '/categories',
    payload: { name },
  })
  expect(response.statusCode).toBe(201)
  return response.json<{ id: string; name: string; sortOrder: number }>()
}

async function createTopic(
  app: FastifyInstance,
  token: string,
  name: string,
  categoryId: string | null,
) {
  const response = await request(app, token, {
    method: 'POST',
    url: '/topics',
    payload: { name, categoryId },
  })
  expect(response.statusCode).toBe(201)
  return response.json<{ id: string; name: string; categoryId: string | null }>()
}

describe('categories', () => {
  it('lists categories by sort order then creation time and appends new categories', async () => {
    const { app, deps, tokenA, userIdA } = await setupUsers()

    await deps.db
      .insertInto('categories')
      .values([
        {
          user_id: userIdA,
          name: '同序旧',
          sort_order: 10,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          user_id: userIdA,
          name: '同序新',
          sort_order: 10,
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
      ])
      .execute()

    const created = await request(app, tokenA, {
      method: 'POST',
      url: '/categories',
      payload: { name: ' 后续 ' },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toEqual({
      id: expect.any(String),
      name: '后续',
      sortOrder: 11,
    })

    const listed = await request(app, tokenA, {
      method: 'GET',
      url: '/categories',
    })
    expect(listed.statusCode).toBe(200)
    const body = listed.json<{
      items: { id: string; name: string; sortOrder: number }[]
    }>()
    expect(body.items.slice(-3)).toEqual([
      { id: expect.any(String), name: '同序旧', sortOrder: 10 },
      { id: expect.any(String), name: '同序新', sortOrder: 10 },
      { id: created.json<{ id: string }>().id, name: '后续', sortOrder: 11 },
    ])
    expect(body.items.every((item) => Object.keys(item).sort().join(',') === 'id,name,sortOrder')).toBe(true)
  })

  it('updates and deletes a category with trimmed names and partial sort updates', async () => {
    const { app, deps, tokenA, userIdA } = await setupUsers()
    const category = await createCategory(app, tokenA, ' 工作 ')

    expect(category.name).toBe('工作')

    const updated = await request(app, tokenA, {
      method: 'PATCH',
      url: `/categories/${category.id}`,
      payload: { name: ' 事业 ', sortOrder: 9 },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toEqual({
      id: category.id,
      name: '事业',
      sortOrder: 9,
    })

    const partial = await request(app, tokenA, {
      method: 'PATCH',
      url: `/categories/${category.id}`,
      payload: { sortOrder: 7 },
    })
    expect(partial.statusCode).toBe(200)
    expect(partial.json()).toEqual({
      id: category.id,
      name: '事业',
      sortOrder: 7,
    })

    const row = await deps.db
      .selectFrom('categories')
      .selectAll()
      .where('id', '=', category.id)
      .where('user_id', '=', userIdA)
      .executeTakeFirstOrThrow()
    expect(row).toMatchObject({ name: '事业', sort_order: 7 })

    const deleted = await request(app, tokenA, {
      method: 'DELETE',
      url: `/categories/${category.id}`,
    })
    expect(deleted.statusCode).toBe(204)
    expect(deleted.body).toBe('')

    expect(
      await deps.db
        .selectFrom('categories')
        .select('id')
        .where('id', '=', category.id)
        .executeTakeFirst(),
    ).toBeUndefined()

    const updateMissing = await request(app, tokenA, {
      method: 'PATCH',
      url: `/categories/${category.id}`,
      payload: { name: '不存在' },
    })
    expect(updateMissing.statusCode).toBe(404)
    expect(updateMissing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('validates category names and maps duplicate names to exact conflicts', async () => {
    const { app, deps, tokenA, userIdA } = await setupUsers()
    const category = await createCategory(app, tokenA, '工作')

    const duplicate = await request(app, tokenA, {
      method: 'POST',
      url: '/categories',
      payload: { name: ' 工作 ' },
    })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json()).toEqual({
      error: { code: 'CONFLICT', message: '已存在同名分类' },
    })

    for (const name of ['   ', 'a'.repeat(21)]) {
      const invalid = await request(app, tokenA, {
        method: 'POST',
        url: '/categories',
        payload: { name },
      })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json()).toMatchObject({ error: { code: 'VALIDATION' } })
    }

    const maxLength = await createCategory(app, tokenA, ` ${'b'.repeat(20)} `)
    expect(maxLength.name).toHaveLength(20)

    const updateDuplicate = await request(app, tokenA, {
      method: 'PATCH',
      url: `/categories/${maxLength.id}`,
      payload: { name: '工作' },
    })
    expect(updateDuplicate.statusCode).toBe(409)
    expect(updateDuplicate.json()).toEqual({
      error: { code: 'CONFLICT', message: '已存在同名分类' },
    })

    const rows = await deps.db
      .selectFrom('categories')
      .select(['id', 'name'])
      .where('user_id', '=', userIdA)
      .where('id', 'in', [category.id, maxLength.id])
      .orderBy('name')
      .execute()
    expect(rows).toEqual([
      { id: maxLength.id, name: 'b'.repeat(20) },
      { id: category.id, name: '工作' },
    ])
  })
})

describe('topics', () => {
  it('creates trimmed topics with a category or null, validates names, and rejects duplicates', async () => {
    const { app, deps, tokenA, userIdA } = await setupUsers()
    const category = await createCategory(app, tokenA, '读物')

    const topic = await createTopic(app, tokenA, ' 阅读 ', category.id)
    expect(topic).toEqual({
      id: expect.any(String),
      name: '阅读',
      categoryId: category.id,
    })

    const uncategorized = await createTopic(app, tokenA, '随手记', null)
    expect(uncategorized.categoryId).toBeNull()

    const duplicate = await request(app, tokenA, {
      method: 'POST',
      url: '/topics',
      payload: { name: ' 阅读 ', categoryId: null },
    })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json()).toEqual({
      error: { code: 'CONFLICT', message: '已存在同名主题' },
    })

    for (const name of ['   ', 't'.repeat(51)]) {
      const invalid = await request(app, tokenA, {
        method: 'POST',
        url: '/topics',
        payload: { name, categoryId: null },
      })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json()).toMatchObject({ error: { code: 'VALIDATION' } })
    }

    const maxLength = await createTopic(app, tokenA, ` ${'x'.repeat(50)} `, null)
    expect(maxLength.name).toHaveLength(50)

    const rows = await deps.db
      .selectFrom('topics')
      .select(['id', 'name', 'category_id', 'user_id'])
      .where('id', 'in', [topic.id, uncategorized.id, maxLength.id])
      .execute()
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          id: topic.id,
          name: '阅读',
          category_id: category.id,
          user_id: userIdA,
        },
        {
          id: uncategorized.id,
          name: '随手记',
          category_id: null,
          user_id: userIdA,
        },
        {
          id: maxLength.id,
          name: 'x'.repeat(50),
          category_id: null,
          user_id: userIdA,
        },
      ]),
    )
  })

  it('partially updates names and categories, then deletes without deleting its records', async () => {
    const { app, deps, tokenA, userIdA } = await setupUsers()
    const firstCategory = await createCategory(app, tokenA, '分类一')
    const secondCategory = await createCategory(app, tokenA, '分类二')
    const topic = await createTopic(app, tokenA, '主题', firstCategory.id)

    const renamed = await request(app, tokenA, {
      method: 'PATCH',
      url: `/topics/${topic.id}`,
      payload: { name: ' 新主题 ' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json()).toEqual({
      id: topic.id,
      name: '新主题',
      categoryId: firstCategory.id,
    })

    const moved = await request(app, tokenA, {
      method: 'PATCH',
      url: `/topics/${topic.id}`,
      payload: { categoryId: secondCategory.id },
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json()).toEqual({
      id: topic.id,
      name: '新主题',
      categoryId: secondCategory.id,
    })

    const uncategorized = await request(app, tokenA, {
      method: 'PATCH',
      url: `/topics/${topic.id}`,
      payload: { categoryId: null },
    })
    expect(uncategorized.statusCode).toBe(200)
    expect(uncategorized.json()).toEqual({
      id: topic.id,
      name: '新主题',
      categoryId: null,
    })

    const record = await deps.db
      .insertInto('records')
      .values({ user_id: userIdA, topic_id: topic.id, record_date: '2026-11-06' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const deleted = await request(app, tokenA, {
      method: 'DELETE',
      url: `/topics/${topic.id}`,
    })
    expect(deleted.statusCode).toBe(204)
    expect(deleted.body).toBe('')

    expect(
      await deps.db
        .selectFrom('topics')
        .select('id')
        .where('id', '=', topic.id)
        .executeTakeFirst(),
    ).toBeUndefined()
    const retainedRecord = await deps.db
      .selectFrom('records')
      .select(['id', 'topic_id'])
      .where('id', '=', record.id)
      .executeTakeFirstOrThrow()
    expect(retainedRecord).toEqual({ id: record.id, topic_id: null })

    for (const method of ['PATCH', 'DELETE'] as const) {
      const missing = await request(app, tokenA, {
        method,
        url: `/topics/${topic.id}`,
        ...(method === 'PATCH' ? { payload: { name: '不存在' } } : {}),
      })
      expect(missing.statusCode).toBe(404)
      expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    }
  })

  it('rejects duplicate topic names and category ids owned by another user without writing', async () => {
    const { app, deps, tokenA, tokenB, userIdB } = await setupUsers()
    const categoryA = await createCategory(app, tokenA, 'A 的分类')
    const topicA = await createTopic(app, tokenA, 'A 的主题', categoryA.id)

    const duplicate = await request(app, tokenA, {
      method: 'PATCH',
      url: `/topics/${topicA.id}`,
      payload: { name: 'A 的主题' },
    })
    expect(duplicate.statusCode).toBe(200)

    await createTopic(app, tokenA, '另一个主题', null)
    const patchDuplicate = await request(app, tokenA, {
      method: 'PATCH',
      url: `/topics/${topicA.id}`,
      payload: { name: ' 另一个主题 ' },
    })
    expect(patchDuplicate.statusCode).toBe(409)
    expect(patchDuplicate.json()).toEqual({
      error: { code: 'CONFLICT', message: '已存在同名主题' },
    })

    const foreignCategory = await request(app, tokenB, {
      method: 'POST',
      url: '/topics',
      payload: { name: '越权主题', categoryId: categoryA.id },
    })
    expect(foreignCategory.statusCode).toBe(404)
    expect(foreignCategory.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })

    expect(
      await deps.db
        .selectFrom('topics')
        .select('id')
        .where('user_id', '=', userIdB)
        .where('name', '=', '越权主题')
        .executeTakeFirst(),
    ).toBeUndefined()
  })
})

describe('delete safety', () => {
  it('keeps topics and nulls their category id when a category is deleted', async () => {
    const { app, deps, tokenA } = await setupUsers()
    const category = await createCategory(app, tokenA, '宏观')
    const topic = await createTopic(app, tokenA, '十五五规划', category.id)

    const deleted = await request(app, tokenA, {
      method: 'DELETE',
      url: `/categories/${category.id}`,
    })
    expect(deleted.statusCode).toBe(204)

    const row = await deps.db
      .selectFrom('topics')
      .selectAll()
      .where('id', '=', topic.id)
      .executeTakeFirstOrThrow()
    expect(row.category_id).toBeNull()
    expect(row.name).toBe('十五五规划')
  })
})

describe('per-user isolation and authentication', () => {
  it('hides other users categories and rejects every cross-user mutation with 404', async () => {
    const { app, deps, tokenA, tokenB, userIdA, userIdB } = await setupUsers()
    const categoryA = await createCategory(app, tokenA, 'A 私有分类')
    const topicA = await createTopic(app, tokenA, 'A 私有主题', categoryA.id)

    const listedByB = await request(app, tokenB, {
      method: 'GET',
      url: '/categories',
    })
    expect(listedByB.statusCode).toBe(200)
    const bCategories = await deps.db
      .selectFrom('categories')
      .select('id')
      .where('user_id', '=', userIdB)
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute()
    expect(listedByB.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual(
      bCategories.map((category) => category.id),
    )
    expect(listedByB.json<{ items: { id: string }[] }>().items.map((item) => item.id)).not.toContain(
      categoryA.id,
    )

    const attempts = [
      {
        method: 'PATCH' as const,
        url: `/categories/${categoryA.id}`,
        payload: { name: '被 B 改名', sortOrder: 99 },
      },
      {
        method: 'DELETE' as const,
        url: `/categories/${categoryA.id}`,
      },
      {
        method: 'PATCH' as const,
        url: `/topics/${topicA.id}`,
        payload: { name: '被 B 改名', categoryId: null },
      },
      {
        method: 'DELETE' as const,
        url: `/topics/${topicA.id}`,
      },
    ]

    for (const attempt of attempts) {
      const response = await request(app, tokenB, attempt)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    }

    const categoryRow = await deps.db
      .selectFrom('categories')
      .select(['name', 'sort_order', 'user_id'])
      .where('id', '=', categoryA.id)
      .executeTakeFirstOrThrow()
    const topicRow = await deps.db
      .selectFrom('topics')
      .select(['name', 'category_id', 'user_id'])
      .where('id', '=', topicA.id)
      .executeTakeFirstOrThrow()
    expect(categoryRow).toEqual({
      name: 'A 私有分类',
      sort_order: 4,
      user_id: userIdA,
    })
    expect(topicRow).toEqual({
      name: 'A 私有主题',
      category_id: categoryA.id,
      user_id: userIdA,
    })
  })

  it('requires Bearer authentication on all Task 3 routes and writes nothing', async () => {
    const { app, deps, tokenA, userIdA } = await setupUsers()
    const category = await createCategory(app, tokenA, '受保护分类')
    const topic = await createTopic(app, tokenA, '受保护主题', category.id)
    const categoryCountBefore = await deps.db
      .selectFrom('categories')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('user_id', '=', userIdA)
      .executeTakeFirstOrThrow()
    const topicCountBefore = await deps.db
      .selectFrom('topics')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('user_id', '=', userIdA)
      .executeTakeFirstOrThrow()

    const requests: InjectOptions[] = [
      { method: 'GET', url: '/categories' },
      { method: 'POST', url: '/categories', payload: { name: '未登录分类' } },
      {
        method: 'PATCH',
        url: `/categories/${category.id}`,
        payload: { name: '未登录修改' },
      },
      { method: 'DELETE', url: `/categories/${category.id}` },
      {
        method: 'POST',
        url: '/topics',
        payload: { name: '未登录主题', categoryId: category.id },
      },
      {
        method: 'PATCH',
        url: `/topics/${topic.id}`,
        payload: { name: '未登录修改' },
      },
      { method: 'DELETE', url: `/topics/${topic.id}` },
    ]

    for (const options of requests) {
      const response = await app.inject(options)
      expect(response.statusCode).toBe(401)
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
    }

    const categoryCountAfter = await deps.db
      .selectFrom('categories')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('user_id', '=', userIdA)
      .executeTakeFirstOrThrow()
    const topicCountAfter = await deps.db
      .selectFrom('topics')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('user_id', '=', userIdA)
      .executeTakeFirstOrThrow()
    expect(categoryCountAfter).toEqual(categoryCountBefore)
    expect(topicCountAfter).toEqual(topicCountBefore)
    expect(
      await deps.db
        .selectFrom('topics')
        .select(['id', 'name', 'category_id'])
        .where('id', '=', topic.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ id: topic.id, name: '受保护主题', category_id: category.id })
  })
})