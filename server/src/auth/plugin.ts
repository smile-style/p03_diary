import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import jwt from '@fastify/jwt'
import { AppError } from '../errors.js'

type RequireUser = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
  }

  interface FastifyInstance {
    requireUser: RequireUser
  }
}

function unauthorized() {
  return new AppError(401, 'UNAUTHORIZED', '请先登录')
}

export async function registerAuth(
  app: FastifyInstance,
  jwtSecret: string,
): Promise<void> {
  await app.register(jwt, { secret: jwtSecret })

  app.decorateRequest('userId', '')
  app.decorate('requireUser', async (request, _reply) => {
    const authorization = request.headers.authorization
    if (!authorization) {
      throw unauthorized()
    }

    const match = /^Bearer ([^\s]+)$/i.exec(authorization)
    if (!match) {
      throw unauthorized()
    }

    try {
      const payload = await request.jwtVerify<{ sub?: unknown }>()
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw unauthorized()
      }
      request.userId = payload.sub
    } catch {
      throw unauthorized()
    }
  })
}
