import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Deps } from '../deps.js'

const loginBodySchema = z.object({
  code: z.string().trim().min(1, '登录码不能为空'),
})

const defaultCategories = [
  '投资',
  '学习',
  '好文章',
  '生活',
]

export function registerAuthRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/auth/wechat', async (request) => {
    const { code } = loginBodySchema.parse(request.body)
    const { openid } = await deps.wechat.code2Session(code)

    const userId = await deps.db.transaction().execute(async (trx) => {
      const identity = await trx
        .selectFrom('user_identities')
        .select('user_id')
        .where('provider', '=', 'wechat')
        .where('subject', '=', openid)
        .executeTakeFirst()

      if (identity) {
        return identity.user_id
      }

      const user = await trx
        .insertInto('users')
        .defaultValues()
        .returning('id')
        .executeTakeFirstOrThrow()

      await trx
        .insertInto('user_identities')
        .values({
          user_id: user.id,
          provider: 'wechat',
          subject: openid,
        })
        .execute()

      await trx
        .insertInto('categories')
        .values(
          defaultCategories.map((name, sortOrder) => ({
            user_id: user.id,
            name,
            sort_order: sortOrder,
          })),
        )
        .execute()

      return user.id
    })

    return {
      token: app.jwt.sign({ sub: userId }, { expiresIn: '30d' }),
    }
  })
}
