import { HttpWechatClient } from './auth/wechat-client.js'
import { loadConfig } from './config.js'
import { buildApp } from './app.js'
import { createDb } from './db/db.js'
import { createChecker } from './deps.js'
import { migrateToLatest } from './db/migrate.js'

const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)

await migrateToLatest(db)

const wechat = new HttpWechatClient(config.wechatAppId, config.wechatSecret)

const app = await buildApp({
  config,
  db,
  wechat,
  checker: createChecker(config, wechat),
  storage: undefined,
})

const shutdown = async () => {
  await app.close()
  await db.destroy()
}

process.once('SIGINT', () => void shutdown().then(() => process.exit(0)))
process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)))

await app.listen({ port: config.port, host: '0.0.0.0' })
