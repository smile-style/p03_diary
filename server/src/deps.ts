import type { Kysely } from 'kysely'
import type { WechatClient } from './auth/wechat-client.js'
import type { Config } from './config.js'
import type { DB } from './db/db.js'

export type Deps = {
  config: Config
  db: Kysely<DB>
  wechat: WechatClient
  checker: unknown
  storage: unknown
}
