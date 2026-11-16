import type { Kysely } from 'kysely'
import type { DB } from '../db/db.js'

export const DEFAULT_CATEGORIES = ['投资', '学习', '好文章', '生活'] as const

export async function ensureLocalUser(db: Kysely<DB>): Promise<string> {
  const existing = await db
    .selectFrom('users')
    .select('id')
    .orderBy('created_at')
    .limit(1)
    .executeTakeFirst()

  if (existing) {
    return existing.id
  }

  return db.transaction().execute(async (trx) => {
    const user = await trx
      .insertInto('users')
      .values({ created_at: new Date().toISOString() })
      .returning('id')
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('categories')
      .values(
        DEFAULT_CATEGORIES.map((name, sortOrder) => ({
          user_id: user.id,
          name,
          sort_order: sortOrder,
        })),
      )
      .execute()

    return user.id
  })
}
