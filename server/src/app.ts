import Fastify, { type FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { ZodError } from 'zod'
import type { Deps } from './deps.js'
import { AppError } from './errors.js'

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message },
      })
    }

    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? '请求参数不合法'
      return reply.status(400).send({
        error: { code: 'VALIDATION', message },
      })
    }

    return reply.status(500).send({
      error: { code: 'INTERNAL', message: '服务器内部错误' },
    })
  })

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: '接口不存在' },
    })
  })

  app.get('/health', async () => {
    await sql`select 1`.execute(deps.db)
    return { ok: true }
  })

  return app
}
