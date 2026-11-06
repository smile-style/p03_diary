import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'
import { sql } from 'kysely'
import { ZodError } from 'zod'
import { registerAuth } from './auth/plugin.js'
import { registerAuthRoutes } from './auth/routes.js'
import { registerCategoryRoutes } from './categories/routes.js'
import { registerTopicRoutes } from './topics/routes.js'
import type { Deps } from './deps.js'
import { AppError } from './errors.js'

type BuildAppOptions = {
  logger?: FastifyServerOptions['logger']
}

function errorStatusCode(error: unknown) {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number') {
      return statusCode
    }
  }
  return 500
}

function clientErrorCode(statusCode: number) {
  switch (statusCode) {
    case 401:
      return 'UNAUTHORIZED'
    case 404:
      return 'NOT_FOUND'
    case 409:
      return 'CONFLICT'
    default:
      return 'VALIDATION'
  }
}

function clientErrorMessage(statusCode: number) {
  switch (statusCode) {
    case 401:
      return '请先登录'
    case 404:
      return '接口不存在'
    case 409:
      return '资源冲突'
    case 413:
      return '请求内容过大'
    case 415:
      return '请求内容类型不支持'
    default:
      return '请求参数不合法'
  }
}

export async function buildApp(
  deps: Deps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== 'test',
  })

  app.setErrorHandler((error, request, reply) => {
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

    const statusCode = errorStatusCode(error)
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: clientErrorCode(statusCode),
          message: clientErrorMessage(statusCode),
        },
      })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: '服务器内部错误' },
    })
  })

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: '接口不存在' },
    })
  })

  await registerAuth(app, deps.config.jwtSecret)
  registerAuthRoutes(app, deps)

  app.get('/health', async () => {
    await sql`select 1`.execute(deps.db)
    return { ok: true }
  })

  registerCategoryRoutes(app, deps)
  registerTopicRoutes(app, deps)

  return app
}
