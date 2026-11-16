import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { createDb } from '../src/db/db.js'
import { migrateToLatest } from '../src/db/migrate.js'
import type { Deps } from '../src/deps.js'
import { LocalFileStorage } from '../src/images/storage.js'

const testConfig: Config = {
  port: 3000,
  databaseFile: 'test.db',
  dataDir: 'test-data',
  jwtSecret: 'test-jwt-secret',
  fileUrlSecret: 'test-file-url-secret',
  storageDir: './uploads',
  publicBaseUrl: 'http://localhost:3000',
  webRoot: null,
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
      dataDir: dir,
      ...overrides.config,
      storageDir,
    }
    const deps: Deps = {
      config,
      db,
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

export async function loginAs(
  app: FastifyInstance,
  deps: Deps,
  label = 'A',
): Promise<string> {
  void label
  const user = await deps.db
    .insertInto('users')
    .values({ created_at: new Date().toISOString() })
    .returning('id')
    .executeTakeFirstOrThrow()
  return app.jwt.sign({ sub: user.id }, { expiresIn: '30d' })
}
