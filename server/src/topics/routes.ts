import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { z } from 'zod'
import type { Deps } from '../deps.js'
import { conflict, notFound } from '../errors.js'

type TopicSummary = {
  id: string
  name: string
  categoryId: string | null
  recordCount: number
  starredCount: number
  lastRecordDate: string | null
}

type TopicSummaryRow = {
  id: string
  name: string
  category_id: string | null
  record_count: number
  starred_count: number
  last_record_date: string | null
}

async function loadTopicSummaries(
  deps: Deps,
  userId: string,
): Promise<TopicSummary[]> {
  const result = await sql<TopicSummaryRow>`
    select
      topic.id,
      topic.name,
      topic.category_id,
      cast(count(distinct record.id) as integer) as record_count,
      cast(count(excerpt.id) as integer) as starred_count,
      cast(max(record.record_date) as text) as last_record_date
    from topics as topic
    left join records as record
      on record.topic_id = topic.id
      and record.user_id = ${userId}
    left join excerpts as excerpt
      on excerpt.record_id = record.id
      and excerpt.user_id = ${userId}
      and excerpt.starred = 1
    where topic.user_id = ${userId}
    group by topic.id, topic.name, topic.category_id
    order by max(record.record_date) desc nulls last, topic.name asc
  `.execute(deps.db)

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    recordCount: Number(row.record_count),
    starredCount: Number(row.starred_count),
    lastRecordDate: row.last_record_date,
  }))
}

const topicNameSchema = z
  .string()
  .trim()
  .min(1, '主题名称不能为空')
  .max(50, '主题名称不能超过 50 个字符')

const categoryIdSchema = z.string().uuid('分类 ID 不合法').nullable()

const createTopicBodySchema = z.object({
  name: topicNameSchema,
  categoryId: categoryIdSchema,
})

const updateTopicBodySchema = z
  .object({
    name: topicNameSchema.optional(),
    categoryId: categoryIdSchema.optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.categoryId !== undefined,
    '至少提供一个需要更新的字段',
  )

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const errcode = (error as { errcode?: unknown }).errcode
  return errcode === 2067 || errcode === 1555
}

async function assertCategoryOwned(
  deps: Deps,
  userId: string,
  categoryId: string | null,
): Promise<void> {
  if (categoryId === null) {
    return
  }

  const category = await deps.db
    .selectFrom('categories')
    .select('id')
    .where('id', '=', categoryId)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  if (!category) {
    throw notFound('分类不存在')
  }
}

export function registerTopicRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/topics', { preHandler: app.requireUser }, async (request) => {
    const [categories, topics] = await Promise.all([
      deps.db
        .selectFrom('categories')
        .select(['id', 'name', 'sort_order'])
        .where('user_id', '=', request.userId)
        .orderBy('sort_order')
        .orderBy('created_at')
        .execute(),
      loadTopicSummaries(deps, request.userId),
    ])

    const topicsByCategory = new Map<string, TopicSummary[]>()
    for (const topic of topics) {
      if (topic.categoryId === null) {
        continue
      }
      const group = topicsByCategory.get(topic.categoryId) ?? []
      group.push(topic)
      topicsByCategory.set(topic.categoryId, group)
    }

    return {
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sort_order,
        topics: topicsByCategory.get(category.id) ?? [],
      })),
      uncategorized: topics.filter((topic) => topic.categoryId === null),
    }
  })

  app.get(
    '/topics/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const { id } = z
        .object({ id: z.string().uuid('Topic ID must be a UUID') })
        .parse(request.params)
      const topics = await loadTopicSummaries(deps, request.userId)
      const topic = topics.find((item) => item.id === id)

      if (!topic) {
        throw notFound('Topic not found')
      }
      return topic
    },
  )

  app.post(
    '/topics',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const { name, categoryId } = createTopicBodySchema.parse(request.body)
      await assertCategoryOwned(deps, request.userId, categoryId)

      try {
        const topic = await deps.db
          .insertInto('topics')
          .values({
            user_id: request.userId,
            category_id: categoryId,
            name,
          })
          .returning(['id', 'name', 'category_id'])
          .executeTakeFirstOrThrow()

        return reply.status(201).send({
          id: topic.id,
          name: topic.name,
          categoryId: topic.category_id,
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('已存在同名主题')
        }
        throw error
      }
    },
  )

  app.patch(
    '/topics/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const { id } = request.params as { id: string }
      const { name, categoryId } = updateTopicBodySchema.parse(request.body)

      if (categoryId !== undefined) {
        await assertCategoryOwned(deps, request.userId, categoryId)
      }

      const changes: { name?: string; category_id?: string | null } = {}
      if (name !== undefined) {
        changes.name = name
      }
      if (categoryId !== undefined) {
        changes.category_id = categoryId
      }

      try {
        const topic = await deps.db
          .updateTable('topics')
          .set(changes)
          .where('id', '=', id)
          .where('user_id', '=', request.userId)
          .returning(['id', 'name', 'category_id'])
          .executeTakeFirst()

        if (!topic) {
          throw notFound('主题不存在')
        }

        return {
          id: topic.id,
          name: topic.name,
          categoryId: topic.category_id,
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('已存在同名主题')
        }
        throw error
      }
    },
  )

  app.delete(
    '/topics/:id',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = await deps.db
        .deleteFrom('topics')
        .where('id', '=', id)
        .where('user_id', '=', request.userId)
        .executeTakeFirst()

      if (result.numDeletedRows === 0n) {
        throw notFound('主题不存在')
      }

      return reply.status(204).send()
    },
  )
}