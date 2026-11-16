import { z } from 'zod'

export type Config = {
  port: number
  databaseFile: string
  jwtSecret: string
  fileUrlSecret: string
  wechatAppId: string
  wechatSecret: string
  wechatPushToken: string
  contentCheck: 'off' | 'wechat'
  storageDir: string
  publicBaseUrl: string
}

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_FILE: z.string().min(1, 'DATABASE_FILE 不能为空'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET 不能为空'),
  FILE_URL_SECRET: z.string().min(1, 'FILE_URL_SECRET 不能为空'),
  WECHAT_APP_ID: z.string().min(1, 'WECHAT_APP_ID 不能为空'),
  WECHAT_SECRET: z.string().min(1, 'WECHAT_SECRET 不能为空'),
  WECHAT_PUSH_TOKEN: z.string().min(1, 'WECHAT_PUSH_TOKEN 不能为空'),
  CONTENT_CHECK: z.enum(['off', 'wechat']).default('off'),
  STORAGE_DIR: z.string().min(1).default('./uploads'),
  PUBLIC_BASE_URL: z.url('PUBLIC_BASE_URL 必须是合法 URL'),
})

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = configSchema.safeParse(env)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`配置不合法：${details}`)
  }

  const parsed = result.data
  return {
    port: parsed.PORT,
    databaseFile: parsed.DATABASE_FILE,
    jwtSecret: parsed.JWT_SECRET,
    fileUrlSecret: parsed.FILE_URL_SECRET,
    wechatAppId: parsed.WECHAT_APP_ID,
    wechatSecret: parsed.WECHAT_SECRET,
    wechatPushToken: parsed.WECHAT_PUSH_TOKEN,
    contentCheck: parsed.CONTENT_CHECK,
    storageDir: parsed.STORAGE_DIR,
    publicBaseUrl: parsed.PUBLIC_BASE_URL,
  }
}
