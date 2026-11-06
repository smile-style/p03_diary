import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ImageStatus } from '../db/db.js'
import type { Deps } from '../deps.js'
import { AppError } from '../errors.js'

function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', 'Forbidden')
}

function queryString(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = (request.query as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

function hasValidSignature(request: FastifyRequest, deps: Deps): boolean {
  const timestamp = queryString(request, 'timestamp')
  const nonce = queryString(request, 'nonce')
  const signature = queryString(request, 'signature')
  if (!timestamp || !nonce || !signature || !/^[a-f0-9]{40}$/.test(signature)) {
    return false
  }

  const expected = createHash('sha1')
    .update([deps.config.wechatPushToken, timestamp, nonce].sort().join(''))
    .digest('hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  const actualBuffer = Buffer.from(signature, 'hex')
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  )
}

function assertValidSignature(request: FastifyRequest, deps: Deps): void {
  if (!hasValidSignature(request, deps)) {
    throw forbidden()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function registerWechatPushRoutes(
  app: FastifyInstance,
  deps: Deps,
): void {
  const signatureGuard = async (request: FastifyRequest): Promise<void> => {
    assertValidSignature(request, deps)
  }

  app.get(
    '/wechat/push',
    { onRequest: signatureGuard },
    async (request, reply) => {
      return reply
        .type('text/plain')
        .send(queryString(request, 'echostr') ?? '')
    },
  )

  app.post(
    '/wechat/push',
    { onRequest: signatureGuard },
    async (request, reply) => {
      const body = request.body
      if (
        isRecord(body) &&
        body.Event === 'wxa_media_check' &&
        typeof body.trace_id === 'string' &&
        body.trace_id.length > 0 &&
        isRecord(body.result) &&
        typeof body.result.suggest === 'string'
      ) {
        const status: ImageStatus =
          body.result.suggest === 'risky' ? 'rejected' : 'ok'

        await deps.db
          .updateTable('images')
          .set({ status })
          .where('trace_id', '=', body.trace_id)
          .execute()
      }

      return reply.type('text/plain').send('success')
    },
  )
}
