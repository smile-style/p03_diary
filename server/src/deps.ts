import type { Kysely } from 'kysely'
import type { Config } from './config.js'
import type { DB } from './db/db.js'
import type { FileStorage } from './images/storage.js'

export type Deps = {
  config: Config
  db: Kysely<DB>
  storage: FileStorage
}
