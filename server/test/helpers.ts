import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import type { WechatClient } from '../src/auth/wechat-client.js'
import { createDb } from '../src/db/db.js'
import { migrateToLatest } from '../src/db/migrate.js'
import type { Deps } from '../src/deps.js'
import { LocalFileStorage } from '../src/images/storage.js'
import { PassThroughChecker } from '../src/moderation/checker.js'
import { AppError } from '../src/errors.js'

const testConfig: Config = {
  port: 3000,
  databaseFile: 'test.db',
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

export async function createTestApp(
  overrides: Partial<Deps> = {},
): Promise<{ app: FastifyInstance; deps: Deps }> {
  const dir = await mkdtemp(join(tmpdir(), 'wx-daily-test-'))
  const databaseFile = join(dir, 'app.db')
  const storageDir = join(dir, 'storage')
  const ownedDb = overrides.db ? undefined : createDb(databaseFile)
  const db = overrides.db ?? ownedDb!

  try {
    await migrateToLatest(db)

    const config: Config = {
      ...testConfig,
      databaseFile,
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
      if (ownedDb) {
        await ownedDb.destroy()
      }
      await rm(dir, { recursive: true, force: true })
    })

    return { app, deps }
  } catch (error) {
    if (ownedDb) {
      await ownedDb.destroy()
    }
    await rm(dir, { recursive: true, force: true })
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
