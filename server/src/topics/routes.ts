import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Deps } from '../deps.js'
import { conflict, notFound } from '../errors.js'

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
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
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