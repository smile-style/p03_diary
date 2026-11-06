import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import type { ContentChecker } from '../src/moderation/checker.js'
import { AppError } from '../src/errors.js'
import { loadRecordViews } from '../src/records/service.js'
import { authHeader, createTestApp, login } from './helpers.js'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

type RecordViewBody = {
  id: string
  topicId: string | null
  topic: { id: string; name: string } | null
  recordDate: string
  body: string
  links: string[]
  excerpts: Array<{
    id: string
    quote: string
    thought: string
    starred: boolean
  }>
  images: Array<{ id: string; url: string | null; status: string }>
  tags: string[]
  createdAt: string
  updatedAt: string
}

class CapturingChecker implements ContentChecker {
  readonly calls: Array<{ text: string; openid: string | null }> = []

  constructor(private readonly result: 'pass' | 'reject' | Error = 'pass') {}

  async checkText(
    text: string,
    openid: string | null,
  ): Promise<'pass' | 'reject'> {
    this.calls.push({ text, openid })
    if (this.result instanceof Error) {
      throw this.result
    }
    return this.result
  }

  async submitImage(): Promise<{ status: 'ok' }> {
    return { status: 'ok' }
  }
}

function recordPayload(overrides: Record<string, unknown> = {}) {
  return {
    topicId: null,
    recordDate: '2026-11-06',
    body: '默认记录内容',
    links: [],
    excerpts: [],
    imageIds: [],
    ...overrides,
  }
}

async function setupUsers(checker: ContentChecker = new CapturingChecker()) {
  const { app, deps } = await createTestApp({ checker })
  apps.push(app)
  const tokenA = await login(app, 'record-owner-a')
  const tokenB = await login(app, 'record-owner-b')
  const userIdA = app.jwt.decode<{ sub: string }>(tokenA)!.sub
  const userIdB = app.jwt.decode<{ sub: string }>(tokenB)!.sub
  return { app, deps, tokenA, tokenB, userIdA, userIdB }
}

async function request(
  app: FastifyInstance,
  token: string | undefined,
  options: InjectOptions,
) {
  return app.inject({
    ...options,
    headers: {
      ...(token ? authHeader(token) : {}),
      ...options.headers,
    },
  })
}

async function createTopic(
  app: FastifyInstance,
  token: string,
  name = '十五五规划',
) {
  const response = await request(app, token, {
    method: 'POST',
    url: '/topics',
    payload: { name, categoryId: null },
  })
  expect(response.statusCode).toBe(201)
  return response.json<{ id: string; name: string }>()
}

async function createImage(
  deps: Awaited<ReturnType<typeof createTestApp>>['deps'],
  userId: string,
  name: string,
) {
  const storageKey = `${userId}/${name}.jpg`
  const data = Buffer.from(`image:${name}`)
  await deps.storage.put(storageKey, data)
  const row = await deps.db
    .insertInto('images')
    .values({
      user_id: userId,
      record_id: null,
      storage_key: storageKey,
      mime: 'image/jpeg',
      status: 'ok',
      position: 0,
    })
    .returning(['id', 'storage_key'])
    .executeTakeFirstOrThrow()
  return { ...row, data }
}

async function createRecord(
  app: FastifyInstance,
  token: string,
  payload: Record<string, unknown>,
) {
  const response = await request(app, token, {
    method: 'POST',
    url: '/records',
    payload,
  })
  expect(response.statusCode).toBe(201)
  return response.json<RecordViewBody>()
}

describe('records', () => {
  it('saves and reads excerpts, starred order, images, tags, topic, and signed image URLs', async () => {
    const checker = new CapturingChecker()
    const { app, deps, tokenA, userIdA } = await setupUsers(checker)
    const topic = await createTopic(app, tokenA)
    const image = await createImage(deps, userIdA, 'record-image')
    const link = 'https://example.com/article?q=1'
    const payload = recordPayload({
      topicId: topic.id,
      body: '今天规划发布 #投资',
      links: [link],
      excerpts: [
        {
          quote: '加快建设现代化产业体系 #引文标签不应保存',
          thought: '新能源 #新能源',
          starred: true,
        },
        {
          quote: '人工智能+',
          thought: '',
          starred: false,
        },
      ],
      imageIds: [image.id],
    })

    const response = await request(app, tokenA, {
      method: 'POST',
      url: '/records',
      payload,
    })

    expect(response.statusCode).toBe(201)
    const saved = response.json<RecordViewBody>()
    expect(saved).toMatchObject({
      id: expect.any(String),
      topicId: topic.id,
      topic: { id: topic.id, name: '十五五规划' },
      recordDate: '2026-11-06',
      body: payload.body,
      links: [link],
      excerpts: [
        {
          id: expect.any(String),
          quote: payload.excerpts[0].quote,
          thought: payload.excerpts[0].thought,
          starred: true,
        },
        {
          id: expect.any(String),
          quote: payload.excerpts[1].quote,
          thought: '',
          starred: false,
        },
      ],
      images: [{ id: image.id, url: expect.any(String), status: 'ok' }],
      tags: ['投资', '新能源'],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    expect(new URL(saved.images[0].url!).hostname).toBe('localhost')
    expect(checker.calls).toEqual([
      {
        text: [
          payload.body,
          ...payload.excerpts.flatMap((excerpt) => [
            excerpt.quote,
            excerpt.thought,
          ]),
          link,
        ].join('\n'),
        openid: 'record-owner-a',
      },
    ])

    const loaded = await request(app, tokenA, {
      method: 'GET',
      url: `/records/${saved.id}`,
    })
    expect(loaded.statusCode).toBe(200)
    expect(loaded.json<RecordViewBody>()).toEqual(saved)

    const signedUrl = new URL(saved.images[0].url!)
    const downloaded = await app.inject({
      method: 'GET',
      url: `${signedUrl.pathname}${signedUrl.search}`,
    })
    expect(downloaded.statusCode).toBe(200)
    expect(downloaded.rawPayload).toEqual(image.data)

    const second = await createRecord(
      app,
      tokenA,
      recordPayload({ body: '第二条 #顺序测试' }),
    )
    const views = await loadRecordViews(deps.db, deps.config, userIdA, [
      second.id,
      saved.id,
    ])
    expect(views.map((view) => view.id)).toEqual([second.id, saved.id])
  })

  it('returns the existing 422 error and writes nothing when content is rejected', async () => {
    const checker = new CapturingChecker('reject')
    const { app, deps, tokenA, userIdA } = await setupUsers(checker)
    const image = await createImage(deps, userIdA, 'rejected-content')

    const response = await request(app, tokenA, {
      method: 'POST',
      url: '/records',
      payload: recordPayload({
        body: '正文 #检查',
        links: ['https://example.com/check'],
        excerpts: [{ quote: '引用', thought: '想法', starred: true }],
        imageIds: [image.id],
      }),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      error: {
        code: 'CONTENT_REJECTED',
        message: '内容未通过安全检查，请修改后再保存',
      },
    })
    expect(checker.calls).toEqual([
      {
        text: ['正文 #检查', '引用', '想法', 'https://example.com/check'].join('\n'),
        openid: 'record-owner-a',
      },
    ])
    expect(await deps.db.selectFrom('records').selectAll().execute()).toEqual([])
    expect(await deps.db.selectFrom('excerpts').selectAll().execute()).toEqual([])
    expect(await deps.db.selectFrom('record_tags').selectAll().execute()).toEqual([])
    expect(
      await deps.db
        .selectFrom('images')
        .select(['id', 'record_id'])
        .where('id', '=', image.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ id: image.id, record_id: null })
  })

  it('passes a thrown 503 through and writes nothing when the checker is unavailable', async () => {
    const checker = new CapturingChecker(
      new AppError(503, 'CHECK_UNAVAILABLE', '内容检查暂时不可用，内容已保留，请稍后再试'),
    )
    const { app, deps, tokenA, userIdA } = await setupUsers(checker)
    const image = await createImage(deps, userIdA, 'unavailable-content')

    const response = await request(app, tokenA, {
      method: 'POST',
      url: '/records',
      payload: recordPayload({
        body: '稍后重试',
        excerpts: [{ quote: '引用', thought: '', starred: false }],
        imageIds: [image.id],
      }),
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      error: {
        code: 'CHECK_UNAVAILABLE',
        message: '内容检查暂时不可用，内容已保留，请稍后再试',
      },
    })
    expect(await deps.db.selectFrom('records').selectAll().execute()).toEqual([])
    expect(await deps.db.selectFrom('excerpts').selectAll().execute()).toEqual([])
    expect(await deps.db.selectFrom('record_tags').selectAll().execute()).toEqual([])
    expect(
      await deps.db
        .selectFrom('images')
        .select(['id', 'record_id'])
        .where('id', '=', image.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ id: image.id, record_id: null })
  })

  it('fully replaces excerpts and tags, and PUT removing an image deletes its row and file', async () => {
    const { app, deps, tokenA, userIdA } = await setupUsers()
    const firstImage = await createImage(deps, userIdA, 'keep-image')
    const removedImage = await createImage(deps, userIdA, 'remove-image')
    const created = await createRecord(
      app,
      tokenA,
      recordPayload({
        body: '旧正文 #旧标签',
        excerpts: [
          { quote: '旧引用一', thought: '旧想法 #旧标签', starred: false },
          { quote: '旧引用二', thought: '', starred: true },
        ],
        imageIds: [firstImage.id, removedImage.id],
      }),
    )

    const updatePayload = recordPayload({
      body: '新正文 #新标签',
      excerpts: [
        { quote: '新引用', thought: '新想法', starred: true },
      ],
      imageIds: [firstImage.id],
    })
    const response = await request(app, tokenA, {
      method: 'PUT',
      url: `/records/${created.id}`,
      payload: updatePayload,
    })

    expect(response.statusCode).toBe(200)
    const updated = response.json<RecordViewBody>()
    expect(updated.body).toBe('新正文 #新标签')
    expect(updated.excerpts).toEqual([
      {
        id: expect.any(String),
        quote: '新引用',
        thought: '新想法',
        starred: true,
      },
    ])
    expect(updated.tags).toEqual(['新标签'])
    expect(updated.images.map((image) => image.id)).toEqual([firstImage.id])
    expect(updated.excerpts[0].id).not.toBe(created.excerpts[0].id)

    expect(
      await deps.db
        .selectFrom('images')
        .select('id')
        .where('id', '=', removedImage.id)
        .executeTakeFirst(),
    ).toBeUndefined()
    expect(await deps.storage.get(removedImage.storage_key)).toBeNull()
    expect(await deps.storage.get(firstImage.storage_key)).not.toBeNull()
    expect(
      await deps.db
        .selectFrom('images')
        .select(['record_id', 'position'])
        .where('id', '=', firstImage.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ record_id: created.id, position: 0 })
  })

  it('validates real calendar dates, emptiness, bounds, and malformed array shapes with 400', async () => {
    const { app, deps, tokenA } = await setupUsers()

    const invalidDate = await request(app, tokenA, {
      method: 'POST',
      url: '/records',
      payload: recordPayload({ recordDate: '2026-02-30', body: '日期错误' }),
    })
    expect(invalidDate.statusCode).toBe(400)
    expect(invalidDate.json()).toMatchObject({ error: { code: 'VALIDATION' } })

    const empty = await request(app, tokenA, {
      method: 'POST',
      url: '/records',
      payload: recordPayload({ body: '', excerpts: [], imageIds: [] }),
    })
    expect(empty.statusCode).toBe(400)
    expect(empty.json()).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(empty.json<{ error: { message: string } }>().error.message).toContain('记录不能为空')

    const malformedPayloads: unknown[] = [
      recordPayload({ body: 42 }),
      recordPayload({ links: 'https://example.com' }),
      recordPayload({ links: [42] }),
      recordPayload({ links: ['ftp://example.com/file'] }),
      recordPayload({ excerpts: 'not-an-array' }),
      recordPayload({ excerpts: [{ quote: 123, thought: '', starred: false }] }),
      recordPayload({ excerpts: [{ quote: '', thought: '', starred: false }] }),
      recordPayload({ excerpts: [{ quote: 'ok', thought: '', starred: 'yes' }] }),
      recordPayload({ imageIds: 'not-an-array' }),
      recordPayload({ imageIds: [42] }),
      recordPayload({ imageIds: ['not-a-uuid'] }),
    ]

    for (const payload of malformedPayloads) {
      const response = await request(app, tokenA, {
        method: 'POST',
        url: '/records',
        payload,
      })
      expect(response.statusCode, JSON.stringify(payload)).toBe(400)
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION' } })
    }

    expect(await deps.db.selectFrom('records').selectAll().execute()).toEqual([])
    expect(await deps.db.selectFrom('excerpts').selectAll().execute()).toEqual([])
  })

  it('isolates records, topics, and images across users and requires authentication', async () => {
    const { app, deps, tokenA, tokenB, userIdA } = await setupUsers()
    const topicA = await createTopic(app, tokenA)
    const imageA = await createImage(deps, userIdA, 'private-image')
    const recordA = await createRecord(
      app,
      tokenA,
      recordPayload({
        topicId: topicA.id,
        body: 'A 的正文',
        excerpts: [{ quote: 'A 的引用', thought: '', starred: false }],
        imageIds: [imageA.id],
      }),
    )

    const crossUserAttempts: InjectOptions[] = [
      { method: 'GET', url: `/records/${recordA.id}` },
      {
        method: 'PUT',
        url: `/records/${recordA.id}`,
        payload: recordPayload({ body: 'B 覆盖' }),
      },
      { method: 'DELETE', url: `/records/${recordA.id}` },
      {
        method: 'POST',
        url: '/records',
        payload: recordPayload({ topicId: topicA.id, body: '挂 A 的主题' }),
      },
      {
        method: 'POST',
        url: '/records',
        payload: recordPayload({ body: '挂 A 的图片', imageIds: [imageA.id] }),
      },
    ]

    for (const attempt of crossUserAttempts) {
      const response = await request(app, tokenB, attempt)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    }

    const unauthenticated: InjectOptions[] = [
      { method: 'GET', url: `/records/${recordA.id}` },
      { method: 'POST', url: '/records', payload: recordPayload() },
      { method: 'PUT', url: `/records/${recordA.id}`, payload: recordPayload() },
      { method: 'DELETE', url: `/records/${recordA.id}` },
    ]
    for (const attempt of unauthenticated) {
      const response = await request(app, undefined, attempt)
      expect(response.statusCode).toBe(401)
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
    }

    expect(
      await deps.db
        .selectFrom('records')
        .select(['id', 'user_id', 'topic_id', 'body'])
        .execute(),
    ).toEqual([
      {
        id: recordA.id,
        user_id: userIdA,
        topic_id: topicA.id,
        body: 'A 的正文',
      },
    ])
    expect(
      await deps.db
        .selectFrom('images')
        .select(['id', 'user_id', 'record_id'])
        .where('id', '=', imageA.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ id: imageA.id, user_id: userIdA, record_id: recordA.id })
  })

  it('keeps a record readable with a null topic after its topic is deleted', async () => {
    const { app, deps, tokenA } = await setupUsers()
    const topic = await createTopic(app, tokenA)
    const record = await createRecord(
      app,
      tokenA,
      recordPayload({ topicId: topic.id, body: '主题删除后保留' }),
    )

    const deleted = await request(app, tokenA, {
      method: 'DELETE',
      url: `/topics/${topic.id}`,
    })
    expect(deleted.statusCode).toBe(204)

    const loaded = await request(app, tokenA, {
      method: 'GET',
      url: `/records/${record.id}`,
    })
    expect(loaded.statusCode).toBe(200)
    expect(loaded.json<RecordViewBody>()).toMatchObject({
      id: record.id,
      topicId: null,
      topic: null,
    })
    expect(
      await deps.db
        .selectFrom('records')
        .select('topic_id')
        .where('id', '=', record.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ topic_id: null })
  })

  it('deletes an owned record, its excerpts, tag links, image rows, and stored files', async () => {
    const { app, deps, tokenA, userIdA } = await setupUsers()
    const image = await createImage(deps, userIdA, 'delete-record-image')
    const record = await createRecord(
      app,
      tokenA,
      recordPayload({
        body: '删除我 #待删除',
        excerpts: [{ quote: '引用', thought: '', starred: false }],
        imageIds: [image.id],
      }),
    )

    const response = await request(app, tokenA, {
      method: 'DELETE',
      url: `/records/${record.id}`,
    })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')

    expect(await deps.db.selectFrom('records').selectAll().execute()).toEqual([])
    expect(await deps.db.selectFrom('excerpts').selectAll().execute()).toEqual([])
    expect(await deps.db.selectFrom('record_tags').selectAll().execute()).toEqual([])
    expect(await deps.db.selectFrom('images').selectAll().execute()).toEqual([])
    expect(await deps.storage.get(image.storage_key)).toBeNull()
  })
})
