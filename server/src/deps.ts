import type { Kysely } from 'kysely'
import type { WechatClient } from './auth/wechat-client.js'
import type { Config } from './config.js'
import type { DB } from './db/db.js'
import {
  PassThroughChecker,
  WechatChecker,
  type ContentChecker,
} from './moderation/checker.js'

export type Deps = {
  config: Config
  db: Kysely<DB>
  wechat: WechatClient
  checker: ContentChecker
  storage: unknown
}

export function createChecker(
  config: Config,
  wechat: WechatClient,
): ContentChecker {
  return config.contentCheck === 'wechat'
    ? new WechatChecker(wechat)
    : new PassThroughChecker()
}