import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { authHeader, createTestApp, loginAs } from './helpers.js'

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
  excerpts: Array<{
    id: string
    quote: string
    thought: string
    starred: boolean
  }>
  createdAt: string
}

type RecordPage = {
  items: RecordViewBody[]
  nextCursor: string | null
}

type TopicSummary = {
  id: string
  name: string
  categoryId: string | null
  recordCount: number
  starredCount: number
  lastRecordDate: string | null
}

type TopicOverview = {
  categories: Array<{
    id: string
    name: string
    sortOrder: number
    topics: TopicSummary[]
  }>
  uncategorized: TopicSummary[]
}

type StarredPage = {
  items: Array<{
    excerpt: {
      id: string
      quote: string
      thought: string
      starred: true
    }
    record: {
      id: string
      recordDate: string
      topic: { id: string; name: string } | null
    }
  }>
  nextCursor: string | null
}

async function setupUsers() {
  const { app, deps } = await createTestApp()
  apps.push(app)
  const tokenA = await loginAs(app, deps, 'query-owner-a')
  const tokenB = await loginAs(app, deps, 'query-owner-b')
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

async function createCategory(
  app: FastifyInstance,
  token: string,
  name: string,
) {
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

async function createRecord(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request(app, token, {
    method: 'POST',
    url: '/records',
    payload: {
      topicId: null,
      recordDate: '2026-11-06',
      body: 'record body',
      links: [],
      excerpts: [],
      imageIds: [],
      ...overrides,
    },
  })
  expect(response.statusCode).toBe(201)
  return response.json<RecordViewBody>()
}

async function setCreatedAt(
  deps: Awaited<ReturnType<typeof createTestApp>>['deps'],
  id: string,
  createdAt: string,
) {
  await deps.db
    .updateTable('records')
    .set({ created_at: new Date(createdAt) })
    .where('id', '=', id)
    .execute()
}

function itemIds(page: RecordPage): string[] {
  return page.items.map((item) => item.id)
}

function sorted(values: string[]): string[] {
  return [...values].sort()
}

describe('query routes', () => {
  it('pages the timeline by record date, creation time, and id without gaps or duplicates', async () => {
    const { app, deps, tokenA, tokenB } = await setupUsers()
    const topicA = await createTopic(app, tokenA, 'Timeline', null)

    const first = await createRecord(app, tokenA, {
      topicId: topicA.id,
      recordDate: '2026-11-06',
      body: 'first',
    })
    const tiedOne = await createRecord(app, tokenA, {
      topicId: topicA.id,
      recordDate: '2026-11-05',
      body: 'tied one',
    })
    const tiedTwo = await createRecord(app, tokenA, {
      topicId: topicA.id,
      recordDate: '2026-11-05',
      body: 'tied two',
    })
    const last = await createRecord(app, tokenA, {
      topicId: topicA.id,
      recordDate: '2026-11-04',
      body: 'last',
    })
    const userBRecord = await createRecord(app, tokenB, {
      recordDate: '2026-11-07',
      body: 'must stay private',
    })

    await setCreatedAt(deps, first.id, '2026-11-06T12:00:00.000Z')
    await setCreatedAt(deps, tiedOne.id, '2026-11-05T12:00:00.000Z')
    await setCreatedAt(deps, tiedTwo.id, '2026-11-05T12:00:00.000Z')
    await setCreatedAt(deps, last.id, '2026-11-04T12:00:00.000Z')
    await setCreatedAt(deps, userBRecord.id, '2026-11-07T12:00:00.000Z')

    const tiedInIdDescOrder = [tiedOne.id, tiedTwo.id].sort().reverse()
    const expected = [first.id, ...tiedInIdDescOrder, last.id]

    const firstPageResponse = await request(app, tokenA, {
      method: 'GET',
      url: '/records?limit=2',
    })
    expect(firstPageResponse.statusCode).toBe(200)
    const firstPage = firstPageResponse.json<RecordPage>()
    expect(itemIds(firstPage)).toEqual(expected.slice(0, 2))
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    expect(firstPage.items[0]).toMatchObject({
      id: first.id,
      topicId: topicA.id,
      topic: { id: topicA.id, name: 'Timeline' },
      body: 'first',
    })

    const secondPageResponse = await request(app, tokenA, {
      method: 'GET',
      url: `/records?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    })
    expect(secondPageResponse.statusCode, secondPageResponse.body).toBe(200)
    const secondPage = secondPageResponse.json<RecordPage>()
    expect(itemIds(secondPage)).toEqual(expected.slice(2))
    expect(secondPage.nextCursor).toBeNull()

    const allIds = [...itemIds(firstPage), ...itemIds(secondPage)]
    expect(allIds).toEqual(expected)
    expect(new Set(allIds).size).toBe(expected.length)
    expect(allIds).not.toContain(userBRecord.id)
  })

  it('applies a default page size of 20', async () => {
    const { app, deps, tokenA } = await setupUsers()
    const ids: string[] = []

    for (let index = 0; index < 21; index += 1) {
      const record = await createRecord(app, tokenA, {
        recordDate: '2026-11-06',
        body: `page item ${index}`,
      })
      ids.push(record.id)
      await setCreatedAt(
        deps,
        record.id,
        `2026-11-06T12:00:${String(index).padStart(2, '0')}.000Z`,
      )
    }

    const firstResponse = await request(app, tokenA, {
      method: 'GET',
      url: '/records',
    })
    expect(firstResponse.statusCode).toBe(200)
    const firstPage = firstResponse.json<RecordPage>()
    expect(firstPage.items).toHaveLength(20)
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondResponse = await request(app, tokenA, {
      method: 'GET',
      url: `/records?cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    })
    expect(secondResponse.statusCode, secondResponse.body).toBe(200)
    const secondPage = secondResponse.json<RecordPage>()
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.nextCursor).toBeNull()
    expect(new Set([...itemIds(firstPage), ...itemIds(secondPage)])).toEqual(
      new Set(ids),
    )
  })

  it('combines date, topic, tag, starred, and text filters with AND semantics', async () => {
    const { app, tokenA, tokenB } = await setupUsers()
    const topicOne = await createTopic(app, tokenA, 'Topic one', null)
    const topicTwo = await createTopic(app, tokenA, 'Topic two', null)
    const userBTopic = await createTopic(app, tokenB, 'Private topic', null)

    const target = await createRecord(app, tokenA, {
      topicId: topicOne.id,
      recordDate: '2026-11-06',
      body: 'Target note #alpha',
      excerpts: [{ quote: 'target quote', thought: '', starred: true }],
    })
    const notStarred = await createRecord(app, tokenA, {
      topicId: topicOne.id,
      recordDate: '2026-11-06',
      body: 'No star #alpha',
      excerpts: [{ quote: 'target quote', thought: '', starred: false }],
    })
    const wrongTopic = await createRecord(app, tokenA, {
      topicId: topicTwo.id,
      recordDate: '2026-11-06',
      body: 'Target note #alpha',
      excerpts: [{ quote: 'target quote', thought: '', starred: true }],
    })
    const wrongDate = await createRecord(app, tokenA, {
      topicId: topicOne.id,
      recordDate: '2026-11-05',
      body: 'Target note #alpha',
      excerpts: [{ quote: 'target quote', thought: '', starred: true }],
    })
    const wrongTag = await createRecord(app, tokenA, {
      topicId: topicOne.id,
      recordDate: '2026-11-06',
      body: 'Target note #alphabet',
      excerpts: [{ quote: 'target quote', thought: '', starred: true }],
    })
    const userBRecord = await createRecord(app, tokenB, {
      topicId: userBTopic.id,
      recordDate: '2026-11-06',
      body: 'Target note #alpha',
      excerpts: [{ quote: 'target quote', thought: '', starred: true }],
    })

    const allFilters = new URLSearchParams({
      date: '2026-11-06',
      topicId: topicOne.id,
      tag: 'alpha',
      starred: '1',
      q: 'TARGET',
    })
    const combinedResponse = await request(app, tokenA, {
      method: 'GET',
      url: `/records?${allFilters.toString()}`,
    })
    expect(combinedResponse.statusCode).toBe(200)
    expect(itemIds(combinedResponse.json<RecordPage>())).toEqual([target.id])

    const expectedByFilter: Array<[string, string[]]> = [
      ['date=2026-11-06', [target.id, notStarred.id, wrongTopic.id, wrongTag.id]],
      [
        `topicId=${topicOne.id}`,
        [target.id, notStarred.id, wrongDate.id, wrongTag.id],
      ],
      ['tag=alpha', [target.id, notStarred.id, wrongTopic.id, wrongDate.id]],
      ['starred=1', [target.id, wrongTopic.id, wrongDate.id, wrongTag.id]],
      ['q=target', [target.id, notStarred.id, wrongTopic.id, wrongDate.id, wrongTag.id]],
    ]

    for (const [query, expectedIds] of expectedByFilter) {
      const response = await request(app, tokenA, {
        method: 'GET',
        url: `/records?${query}`,
      })
      expect(response.statusCode, query).toBe(200)
      expect(sorted(itemIds(response.json<RecordPage>())), query).toEqual(
        sorted(expectedIds),
      )
    }

    const foreignTopicResponse = await request(app, tokenA, {
      method: 'GET',
      url: `/records?topicId=${userBTopic.id}`,
    })
    expect(foreignTopicResponse.statusCode).toBe(200)
    expect(itemIds(foreignTopicResponse.json<RecordPage>())).toEqual([])
    expect(itemIds(combinedResponse.json<RecordPage>())).not.toContain(
      userBRecord.id,
    )
  })

  it('searches body, quote, and thought with literal case-insensitive substrings', async () => {
    const { app, tokenA, tokenB } = await setupUsers()
    const bodyMatch = await createRecord(app, tokenA, {
      body: 'Alpha appears in the body',
    })
    const quoteMatch = await createRecord(app, tokenA, {
      body: 'quote container',
      excerpts: [{ quote: 'alpha appears in a quote', thought: '', starred: false }],
    })
    const thoughtMatch = await createRecord(app, tokenA, {
      body: 'thought container',
      excerpts: [{ quote: 'quoted text', thought: 'alpha appears in thought', starred: false }],
    })
    const percent = await createRecord(app, tokenA, {
      body: 'Only 50% progress',
    })
    const underscore = await createRecord(app, tokenA, {
      body: 'name_here stays literal',
    })
    const backslash = await createRecord(app, tokenA, {
      body: 'path\\child stays literal',
    })
    const userBRecord = await createRecord(app, tokenB, {
      body: 'alpha belongs to B',
    })

    const alphaResponse = await request(app, tokenA, {
      method: 'GET',
      url: '/records?q=AlPhA',
    })
    expect(alphaResponse.statusCode).toBe(200)
    expect(sorted(itemIds(alphaResponse.json<RecordPage>()))).toEqual(
      sorted([bodyMatch.id, quoteMatch.id, thoughtMatch.id]),
    )
    expect(itemIds(alphaResponse.json<RecordPage>())).not.toContain(userBRecord.id)

    const literalCases: Array<[string, string]> = [
      ['50%', percent.id],
      ['%', percent.id],
      ['_', underscore.id],
      ['\\', backslash.id],
    ]
    for (const [query, expectedId] of literalCases) {
      const response = await request(app, tokenA, {
        method: 'GET',
        url: `/records?q=${encodeURIComponent(query)}`,
      })
      expect(response.statusCode, query).toBe(200)
      expect(itemIds(response.json<RecordPage>()), query).toEqual([expectedId])
    }

    const blankResponse = await request(app, tokenA, {
      method: 'GET',
      url: '/records?q=%20%20%20',
    })
    expect(blankResponse.statusCode).toBe(200)
    expect(blankResponse.json<RecordPage>().items).toHaveLength(6)

    const trimmedResponse = await request(app, tokenA, {
      method: 'GET',
      url: '/records?q=%20alpha%20',
    })
    expect(trimmedResponse.statusCode).toBe(200)
    expect(sorted(itemIds(trimmedResponse.json<RecordPage>()))).toEqual(
      sorted([bodyMatch.id, quoteMatch.id, thoughtMatch.id]),
    )
  })

  it('returns calendar counts in ascending date order and excludes other users', async () => {
    const { app, tokenA, tokenB } = await setupUsers()
    await createRecord(app, tokenA, { recordDate: '2026-11-03', body: 'one' })
    await createRecord(app, tokenA, { recordDate: '2026-11-03', body: 'two' })
    await createRecord(app, tokenA, { recordDate: '2026-11-01', body: 'three' })
    await createRecord(app, tokenA, { recordDate: '2026-11-06', body: 'four' })
    await createRecord(app, tokenB, { recordDate: '2026-11-02', body: 'private' })

    const response = await request(app, tokenA, {
      method: 'GET',
      url: '/calendar?month=2026-11',
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      days: [
        { date: '2026-11-01', count: 1 },
        { date: '2026-11-03', count: 2 },
        { date: '2026-11-06', count: 1 },
      ],
    })

    const emptyResponse = await request(app, tokenA, {
      method: 'GET',
      url: '/calendar?month=2026-10',
    })
    expect(emptyResponse.statusCode).toBe(200)
    expect(emptyResponse.json()).toEqual({ days: [] })
  })

  it('lists current-user tag counts in count-descending and name order, excluding zero counts', async () => {
    const { app, tokenA, tokenB } = await setupUsers()
    const first = await createRecord(app, tokenA, { body: '#beta #alpha' })
    const second = await createRecord(app, tokenA, { body: '#beta' })
    await createRecord(app, tokenB, { body: '#beta' })

    const listed = await request(app, tokenA, { method: 'GET', url: '/tags' })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual({
      items: [
        { name: 'beta', count: 2 },
        { name: 'alpha', count: 1 },
      ],
    })

    const deleteFirst = await request(app, tokenA, {
      method: 'DELETE',
      url: `/records/${first.id}`,
    })
    expect(deleteFirst.statusCode).toBe(204)
    const afterFirstDelete = await request(app, tokenA, {
      method: 'GET',
      url: '/tags',
    })
    expect(afterFirstDelete.json()).toEqual({
      items: [{ name: 'beta', count: 1 }],
    })

    const deleteSecond = await request(app, tokenA, {
      method: 'DELETE',
      url: `/records/${second.id}`,
    })
    expect(deleteSecond.statusCode).toBe(204)
    const afterSecondDelete = await request(app, tokenA, {
      method: 'GET',
      url: '/tags',
    })
    expect(afterSecondDelete.json()).toEqual({ items: [] })
  })

  it('pages starred excerpts by the timeline tuple without skipping same-record excerpts', async () => {
    const { app, tokenA, tokenB } = await setupUsers()
    const topic = await createTopic(app, tokenA, 'Reading', null)
    const firstRecord = await createRecord(app, tokenA, {
      topicId: topic.id,
      recordDate: '2026-11-06',
      body: 'starred owner',
      excerpts: [
        { quote: 'first starred', thought: 'keep first', starred: true },
        { quote: 'not starred', thought: '', starred: false },
        { quote: 'second starred', thought: 'keep second', starred: true },
      ],
    })
    const deletedTopic = await createTopic(app, tokenA, 'Temporary topic', null)
    const orphanedTopicRecord = await createRecord(app, tokenA, {
      topicId: deletedTopic.id,
      recordDate: '2026-11-05',
      body: 'starred orphan',
      excerpts: [{ quote: 'orphan star', thought: '', starred: true }],
    })
    await createRecord(app, tokenB, {
      recordDate: '2026-11-07',
      body: 'private star',
      excerpts: [{ quote: 'must not leak', thought: '', starred: true }],
    })

    const deletedTopicResponse = await request(app, tokenA, {
      method: 'DELETE',
      url: `/topics/${deletedTopic.id}`,
    })
    expect(deletedTopicResponse.statusCode).toBe(204)

    const collected: StarredPage['items'] = []
    const cursors: string[] = []
    let cursor: string | null = null
    for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
      const suffix: string = cursor
        ? `&cursor=${encodeURIComponent(cursor)}`
        : ''
      const response = await request(app, tokenA, {
        method: 'GET',
        url: `/excerpts/starred?limit=1${suffix}`,
      })
      expect(response.statusCode, response.body).toBe(200)
      const page = response.json<StarredPage>()
      collected.push(...page.items)
      if (page.nextCursor === null) {
        cursor = null
        break
      }
      cursors.push(page.nextCursor)
      cursor = page.nextCursor
    }

    expect(cursor).toBeNull()
    expect(cursors).toHaveLength(2)
    expect(collected).toHaveLength(3)
    expect(new Set(collected.map((item) => item.excerpt.id)).size).toBe(3)

    const expectedFirstRecordExcerpts = firstRecord.excerpts
      .filter((excerpt) => excerpt.starred)
      .sort((left, right) => right.id.localeCompare(left.id))
      .map((excerpt) => ({
        id: excerpt.id,
        quote: excerpt.quote,
        thought: excerpt.thought,
        starred: true as const,
      }))
    expect(collected.map((item) => item.excerpt.id)).toEqual([
      ...expectedFirstRecordExcerpts.map((excerpt) => excerpt.id),
      orphanedTopicRecord.excerpts[0]!.id,
    ])
    expect(collected.slice(0, 2).every((item) => item.record.id === firstRecord.id)).toBe(true)
    expect(collected.slice(0, 2).map((item) => item.excerpt)).toEqual(
      expectedFirstRecordExcerpts,
    )
    expect(collected.slice(0, 2).map((item) => item.record.topic)).toEqual([
      { id: topic.id, name: 'Reading' },
      { id: topic.id, name: 'Reading' },
    ])
    expect(collected[2]).toMatchObject({
      excerpt: { quote: 'orphan star', starred: true },
      record: {
        id: orphanedTopicRecord.id,
        recordDate: '2026-11-05',
        topic: null,
      },
    })
    expect(collected.map((item) => item.excerpt.quote)).not.toContain('must not leak')
  })

  it('summarizes topics with counts, ordering, empty categories, and detail isolation', async () => {
    const { app, tokenA, tokenB } = await setupUsers()
    const work = await createCategory(app, tokenA, 'Work')
    const emptyCategory = await createCategory(app, tokenA, 'Empty category')
    const privateCategory = await createCategory(app, tokenB, 'Private category')
    const topicOne = await createTopic(app, tokenA, 'Topic one', work.id)
    const topicTwo = await createTopic(app, tokenA, 'Topic two', work.id)
    const emptyTopic = await createTopic(app, tokenA, 'Empty topic', emptyCategory.id)
    const uncategorized = await createTopic(app, tokenA, 'Uncategorized', null)
    const privateTopic = await createTopic(
      app,
      tokenB,
      'Private topic',
      privateCategory.id,
    )

    const first = await createRecord(app, tokenA, {
      topicId: topicOne.id,
      recordDate: '2026-11-06',
      body: 'Reassigned record #work',
      excerpts: [
        { quote: 'star one', thought: '', starred: true },
        { quote: 'star two', thought: '', starred: true },
      ],
    })
    await createRecord(app, tokenA, {
      topicId: topicOne.id,
      recordDate: '2026-11-04',
      body: 'Older record',
    })
    await createRecord(app, tokenA, {
      topicId: uncategorized.id,
      recordDate: '2026-11-05',
      body: 'Uncategorized record',
    })
    await createRecord(app, tokenB, {
      topicId: privateTopic.id,
      recordDate: '2026-11-08',
      body: 'Private record',
    })

    const categoriesResponse = await request(app, tokenA, {
      method: 'GET',
      url: '/categories',
    })
    expect(categoriesResponse.statusCode).toBe(200)
    const categoryOrder = categoriesResponse
      .json<{ items: Array<{ id: string }> }>()
      .items.map((category) => category.id)

    const overviewResponse = await request(app, tokenA, {
      method: 'GET',
      url: '/topics',
    })
    expect(overviewResponse.statusCode).toBe(200)
    const overview = overviewResponse.json<TopicOverview>()
    expect(overview.categories.map((category) => category.id)).toEqual(categoryOrder)
    expect(categoryOrder).toHaveLength(6)
    expect(categoryOrder.slice(-2)).toEqual([work.id, emptyCategory.id])
    const workOverview = overview.categories.find(
      (category) => category.id === work.id,
    )!
    const emptyOverview = overview.categories.find(
      (category) => category.id === emptyCategory.id,
    )!
    expect(workOverview.topics).toEqual([
      {
        id: topicOne.id,
        name: 'Topic one',
        categoryId: work.id,
        recordCount: 2,
        starredCount: 2,
        lastRecordDate: '2026-11-06',
      },
      {
        id: topicTwo.id,
        name: 'Topic two',
        categoryId: work.id,
        recordCount: 0,
        starredCount: 0,
        lastRecordDate: null,
      },
    ])
    expect(emptyOverview.topics).toEqual([
      {
        id: emptyTopic.id,
        name: 'Empty topic',
        categoryId: emptyCategory.id,
        recordCount: 0,
        starredCount: 0,
        lastRecordDate: null,
      },
    ])
    expect(overview.uncategorized).toEqual([
      {
        id: uncategorized.id,
        name: 'Uncategorized',
        categoryId: null,
        recordCount: 1,
        starredCount: 0,
        lastRecordDate: '2026-11-05',
      },
    ])
    expect(JSON.stringify(overview)).not.toContain(privateTopic.id)

    const detailResponse = await request(app, tokenA, {
      method: 'GET',
      url: `/topics/${topicOne.id}`,
    })
    expect(detailResponse.statusCode).toBe(200)
    expect(detailResponse.json()).toEqual(workOverview.topics[0])

    const crossUserDetail = await request(app, tokenA, {
      method: 'GET',
      url: `/topics/${privateTopic.id}`,
    })
    expect(crossUserDetail.statusCode).toBe(404)
    expect(crossUserDetail.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })

    const reassigned = await request(app, tokenA, {
      method: 'PUT',
      url: `/records/${first.id}`,
      payload: {
        topicId: topicTwo.id,
        recordDate: '2026-11-06',
        body: 'Reassigned record #work',
        links: [],
        excerpts: [
          { quote: 'star one', thought: '', starred: true },
          { quote: 'star two', thought: '', starred: true },
        ],
        imageIds: [],
      },
    })
    expect(reassigned.statusCode).toBe(200)

    const afterReassignment = (
      await request(app, tokenA, { method: 'GET', url: '/topics' })
    ).json<TopicOverview>()
    expect(
      afterReassignment.categories.find((category) => category.id === work.id)!
        .topics,
    ).toEqual([
      {
        id: topicTwo.id,
        name: 'Topic two',
        categoryId: work.id,
        recordCount: 1,
        starredCount: 2,
        lastRecordDate: '2026-11-06',
      },
      {
        id: topicOne.id,
        name: 'Topic one',
        categoryId: work.id,
        recordCount: 1,
        starredCount: 0,
        lastRecordDate: '2026-11-04',
      },
    ])

    const reorderedDetail = await request(app, tokenA, {
      method: 'GET',
      url: `/topics/${topicTwo.id}`,
    })
    expect(reorderedDetail.statusCode).toBe(200)
    expect(reorderedDetail.json()).toEqual(
      afterReassignment.categories.find((category) => category.id === work.id)!
        .topics[0],
    )

    const deleteTopic = await request(app, tokenA, {
      method: 'DELETE',
      url: `/topics/${topicTwo.id}`,
    })
    expect(deleteTopic.statusCode).toBe(204)

    const orphanedRecords = await request(app, tokenA, {
      method: 'GET',
      url: '/records?q=Reassigned',
    })
    expect(orphanedRecords.statusCode).toBe(200)
    expect(orphanedRecords.json<RecordPage>().items).toMatchObject([
      { id: first.id, topicId: null, topic: null },
    ])

    const deletedDetail = await request(app, tokenA, {
      method: 'GET',
      url: `/topics/${topicTwo.id}`,
    })
    expect(deletedDetail.statusCode).toBe(404)
  })

  it('returns validation errors for malformed cursors and query values', async () => {
    const { app, tokenA } = await setupUsers()
    const invalidCursor = Buffer.from('{"not":"a cursor"}').toString('base64url')
    const invalidUrls = [
      '/records?date=2026-02-30',
      '/records?topicId=not-a-uuid',
      '/records?starred=0',
      '/records?starred=true',
      '/records?limit=0',
      '/records?limit=51',
      '/records?limit=2.5',
      '/records?cursor=not-a-cursor!',
      `/records?cursor=${invalidCursor}`,
      '/calendar',
      '/calendar?month=2026-13',
      '/calendar?month=2026-1',
      '/calendar?month=invalid',
      '/excerpts/starred?cursor=not-a-cursor!',
      `/excerpts/starred?cursor=${invalidCursor}`,
      '/excerpts/starred?limit=0',
      '/excerpts/starred?limit=51',
    ]

    for (const url of invalidUrls) {
      const response = await request(app, tokenA, { method: 'GET', url })
      expect(response.statusCode, url).toBe(400)
      expect(response.json(), url).toMatchObject({
        error: { code: 'VALIDATION' },
      })
    }
  })

  it('requires authentication for every new query endpoint', async () => {
    const { app } = await setupUsers()
    const urls = [
      '/records',
      '/calendar?month=2026-11',
      '/tags',
      '/excerpts/starred',
      '/topics',
      '/topics/00000000-0000-4000-8000-000000000000',
    ]

    for (const url of urls) {
      const response = await request(app, undefined, { method: 'GET', url })
      expect(response.statusCode, url).toBe(401)
      expect(response.json(), url).toMatchObject({
        error: { code: 'UNAUTHORIZED' },
      })
    }
  })

  it('游标翻页不重复也不遗漏', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    const token = await loginAs(app, deps)
    const created: string[] = []

    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST', url: '/records',
        headers: authHeader(token),
        payload: {
          topicId: null,
          recordDate: `2026-03-0${i + 1}`,
          body: `第 ${i} 条`,
          links: [], excerpts: [], imageIds: [],
        },
      })
      created.push(res.json().id)
    }

    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 3; page += 1) {
      const res = await app.inject({
        method: 'GET',
        url: `/records?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: authHeader(token),
      })
      const body = res.json() as { items: { id: string }[]; nextCursor: string | null }
      seen.push(...body.items.map((item) => item.id))
      cursor = body.nextCursor
    }

    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
    expect(seen).toEqual([...created].reverse())
  })
  it('搜索匹配中文子串，且把 % 和 _ 当作字面量', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    const token = await loginAs(app, deps)

    for (const body of ['今天看了十五五规划', '折扣 100% 到手', 'a_b 命名']) {
      await app.inject({
        method: 'POST', url: '/records', headers: authHeader(token),
        payload: { topicId: null, recordDate: '2026-03-01', body, links: [], excerpts: [], imageIds: [] },
      })
    }

    const hit = await app.inject({
      method: 'GET', url: `/records?q=${encodeURIComponent('十五五')}`, headers: authHeader(token),
    })
    expect(hit.json().items).toHaveLength(1)

    const percent = await app.inject({
      method: 'GET', url: `/records?q=${encodeURIComponent('100%')}`, headers: authHeader(token),
    })
    expect(percent.json().items).toHaveLength(1)

    const underscore = await app.inject({
      method: 'GET', url: `/records?q=${encodeURIComponent('a_b')}`, headers: authHeader(token),
    })
    expect(underscore.json().items).toHaveLength(1)
  })
})
