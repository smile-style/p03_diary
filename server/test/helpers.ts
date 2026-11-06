import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import type { DB } from '../src/db/db.js'
import { createDb } from '../src/db/db.js'
import { migrateToLatest } from '../src/db/migrate.js'
import type { Deps } from '../src/deps.js'

const testConfig: Config = {
  port: 3000,
  databaseUrl: 'postgres://postgres:test@localhost:5433/wxdaily_test',
  jwtSecret: 'test-jwt-secret',
  fileUrlSecret: 'test-file-url-secret',
  wechatAppId: 'test-app-id',
  wechatSecret: 'test-wechat-secret',
  wechatPushToken: 'test-push-token',
  contentCheck: 'off',
  storageDir: './uploads',
  publicBaseUrl: 'http://localhost:3000',
}

export async function resetDb(db: Kysely<DB>): Promise<void> {
  await sql`
    truncate table
      users,
      user_identities,
      categories,
      topics,
      records,
      excerpts,
      images,
      tags,
      record_tags
    restart identity cascade
  `.execute(db)
}

export async function createTestApp(
  overrides: Partial<Deps> = {},
): Promise<{ app: FastifyInstance; deps: Deps }> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? testConfig.databaseUrl
  const ownedDb = overrides.db ? undefined : createDb(databaseUrl)
  const db = overrides.db ?? ownedDb!

  await migrateToLatest(db)
  await resetDb(db)

  const deps: Deps = {
    config: { ...testConfig, databaseUrl },
    db,
    wechat: undefined,
    checker: undefined,
    storage: undefined,
    ...overrides,
  }

  const app = await buildApp(deps)
  if (ownedDb) {
    app.addHook('onClose', async () => {
      await ownedDb.destroy()
    })
  }

  return { app, deps }
}
