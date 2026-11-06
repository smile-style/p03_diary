import type { Kysely } from 'kysely'
import type { Config } from './config.js'
import type { DB } from './db/db.js'

export type Deps = {
  config: Config
  db: Kysely<DB>
  wechat: unknown
  checker: unknown
  storage: unknown
}
