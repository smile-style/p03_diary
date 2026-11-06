import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import type { WechatClient } from '../src/auth/wechat-client.js'
import type { DB } from '../src/db/db.js'
import { createDb } from '../src/db/db.js'
import { migrateToLatest } from '../src/db/migrate.js'
import type { Deps } from '../src/deps.js'
import { LocalFileStorage } from '../src/images/storage.js'
import { PassThroughChecker } from '../src/moderation/checker.js'
import { AppError } from '../src/errors.js'

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

export class FakeWechatClient implements WechatClient {
  async code2Session(code: string): Promise<{ openid: string }> {
    if (!code.startsWith('code_') || code.length === 'code_'.length) {
      throw new AppError(401, 'UNAUTHORIZED', '登录失败，请重试')
    }

    return { openid: code.slice('code_'.length) }
  }

  async getAccessToken(): Promise<string> {
    return 'fake-access-token'
  }
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
  const storageDir = await mkdtemp(join(tmpdir(), 'wx-daily-test-storage-'))
  const ownedDb = overrides.db ? undefined : createDb(databaseUrl)
  const db = overrides.db ?? ownedDb!

  try {
    await migrateToLatest(db)
    await resetDb(db)

    const config: Config = {
      ...testConfig,
      databaseUrl,
      ...overrides.config,
      storageDir,
    }
    const deps: Deps = {
      config,
      db,
      wechat: overrides.wechat ?? new FakeWechatClient(),
      checker: overrides.checker ?? new PassThroughChecker(),
      storage: overrides.storage ?? new LocalFileStorage(storageDir),
    }

    const app = await buildApp(deps)
    app.addHook('onClose', async () => {
      await rm(storageDir, { recursive: true, force: true })
      if (ownedDb) {
        await ownedDb.destroy()
      }
    })

    return { app, deps }
  } catch (error) {
    await rm(storageDir, { recursive: true, force: true })
    if (ownedDb) {
      await ownedDb.destroy()
    }
    throw error
  }
}

export function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` }
}

export async function login(app: FastifyInstance, openid = 'A'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/wechat',
    payload: { code: `code_${openid}` },
  })

  if (response.statusCode !== 200) {
    throw new Error(`login failed with status ${response.statusCode}`)
  }

  return response.json<{ token: string }>().token
}
