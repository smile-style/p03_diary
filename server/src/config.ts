import { join } from 'node:path'
import { z } from 'zod'

export type Config = {
  port: number
  databaseFile: string
  dataDir: string
  jwtSecret: string
  fileUrlSecret: string
  storageDir: string
  publicBaseUrl: string
  webRoot: string | null
}

const configSchema = z.object({
  DATA_DIR: z.string().min(1, 'DATA_DIR 不能为空'),
  PORT: z.coerce.number().int().positive().default(47821),
  DATABASE_FILE: z.string().min(1, 'DATABASE_FILE 不能为空').optional(),
  STORAGE_DIR: z.string().min(1, 'STORAGE_DIR 不能为空').optional(),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET 不能为空'),
  FILE_URL_SECRET: z.string().min(1, 'FILE_URL_SECRET 不能为空'),
  PUBLIC_BASE_URL: z.url('PUBLIC_BASE_URL 必须是合法 URL').optional(),
  WEB_ROOT: z.string().min(1, 'WEB_ROOT 不能为空').optional(),
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
    databaseFile: parsed.DATABASE_FILE ?? join(parsed.DATA_DIR, 'app.db'),
    dataDir: parsed.DATA_DIR,
    jwtSecret: parsed.JWT_SECRET,
    fileUrlSecret: parsed.FILE_URL_SECRET,
    storageDir: parsed.STORAGE_DIR ?? join(parsed.DATA_DIR, 'images'),
    publicBaseUrl: parsed.PUBLIC_BASE_URL ?? `http://127.0.0.1:${parsed.PORT}`,
    webRoot: parsed.WEB_ROOT ?? null,
  }
}
