import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Deps } from '../deps.js'
import { conflict, notFound } from '../errors.js'

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, '分类名称不能为空')
  .max(20, '分类名称不能超过 20 个字符')

const createCategoryBodySchema = z.object({
  name: categoryNameSchema,
})

const updateCategoryBodySchema = z
  .object({
    name: categoryNameSchema.optional(),
    sortOrder: z.number().int('排序必须是整数').optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.sortOrder !== undefined,
    '至少提供一个需要更新的字段',
  )

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const errcode = (error as { errcode?: unknown }).errcode
  return errcode === 2067 || errcode === 1555
}

export function registerCategoryRoutes(
  app: FastifyInstance,
  deps: Deps,
): void {
  app.get(
    '/categories',
    { preHandler: app.requireUser },
    async (request) => {
      const rows = await deps.db
        .selectFrom('categories')
        .select(['id', 'name', 'sort_order'])
        .where('user_id', '=', request.userId)
        .orderBy('sort_order')
        .orderBy('created_at')
        .execute()

      return {
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          sortOrder: row.sort_order,
        })),
      }
    },
  )

  app.post(
    '/categories',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const { name } = createCategoryBodySchema.parse(request.body)
      const latest = await deps.db
        .selectFrom('categories')
        .select('sort_order')
        .where('user_id', '=', request.userId)
        .orderBy('sort_order', 'desc')
        .limit(1)
        .executeTakeFirst()

      try {
        const category = await deps.db
          .insertInto('categories')
          .values({
            user_id: request.userId,
            name,
            sort_order: (latest?.sort_order ?? -1) + 1,
          })
          .returning(['id', 'name', 'sort_order'])
          .executeTakeFirstOrThrow()

        return reply.status(201).send({
          id: category.id,
          name: category.name,
          sortOrder: category.sort_order,
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('已存在同名分类')
        }
        throw error
      }
    },
  )

  app.patch(
    '/categories/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const { id } = request.params as { id: string }
      const { name, sortOrder } = updateCategoryBodySchema.parse(request.body)
      const changes: { name?: string; sort_order?: number } = {}

      if (name !== undefined) {
        changes.name = name
      }
      if (sortOrder !== undefined) {
        changes.sort_order = sortOrder
      }

      try {
        const category = await deps.db
          .updateTable('categories')
          .set(changes)
          .where('id', '=', id)
          .where('user_id', '=', request.userId)
          .returning(['id', 'name', 'sort_order'])
          .executeTakeFirst()

        if (!category) {
          throw notFound('分类不存在')
        }

        return {
          id: category.id,
          name: category.name,
          sortOrder: category.sort_order,
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('已存在同名分类')
        }
        throw error
      }
    },
  )

  app.delete(
    '/categories/:id',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = await deps.db
        .deleteFrom('categories')
        .where('id', '=', id)
        .where('user_id', '=', request.userId)
        .executeTakeFirst()

      if (result.numDeletedRows === 0n) {
        throw notFound('分类不存在')
      }

      return reply.status(204).send()
    },
  )
}