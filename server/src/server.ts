import { loadConfig } from './config.js'
import { buildApp } from './app.js'
import { createDb } from './db/db.js'
import { migrateToLatest } from './db/migrate.js'
import { LocalFileStorage } from './images/storage.js'

const config = loadConfig(process.env)
const db = createDb(config.databaseFile)

await migrateToLatest(db)

const app = await buildApp({
  config,
  db,
  storage: new LocalFileStorage(config.storageDir),
})

const shutdown = async () => {
  await app.close()
  await db.destroy()
}

process.once('SIGINT', () => void shutdown().then(() => process.exit(0)))
process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)))

await app.listen({ port: config.port, host: '0.0.0.0' })
