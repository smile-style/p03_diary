import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../config.js'
import type { Deps } from '../deps.js'
import { AppError, notFound, validation } from '../errors.js'
import { signFileUrl, verifyFileUrl } from './signed-url.js'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const EXTENSIONS_BY_MIME = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

type ImageRowForView = {
  id: string
  storage_key: string
  status: 'pending' | 'ok' | 'rejected'
}

export function toImageView(
  row: ImageRowForView,
  config: Config,
): { id: string; url: string | null; status: 'ok' | 'pending' | 'rejected' } {
  return {
    id: row.id,
    url:
      row.status === 'rejected'
        ? null
        : signFileUrl(row.storage_key, config.fileUrlSecret, config.publicBaseUrl),
    status: row.status,
  }
}

function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', 'Forbidden')
}

function queryString(
  query: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = query[name]
  return typeof value === 'string' ? value : undefined
}

export function registerImageRoutes(app: FastifyInstance, deps: Deps): void {
  app.post(
    '/images',
    { preHandler: app.requireUser },
    async (request, reply) => {
      let file
      try {
        file = await request.file()
      } catch {
        throw validation('Upload a valid image file')
      }

      if (!file || file.fieldname !== 'file') {
        throw validation('Upload a valid image file')
      }

      const extension = EXTENSIONS_BY_MIME.get(file.mimetype)
      if (!extension) {
        file.file.resume()
        throw validation('Only JPEG, PNG, WebP, and GIF images are supported')
      }

      let data: Buffer
      try {
        data = await file.toBuffer()
      } catch {
        throw validation('Image files must not exceed 10 MB')
      }

      if (data.length > MAX_FILE_SIZE) {
        throw validation('Image files must not exceed 10 MB')
      }

      const storageKey = `${request.userId}/${randomUUID()}.${extension}`
      try {
        await deps.storage.put(storageKey, data)

        const row = await deps.db
          .insertInto('images')
          .values({
            user_id: request.userId,
            record_id: null,
            storage_key: storageKey,
            mime: file.mimetype,
            status: 'ok',
            trace_id: null,
          })
          .returning(['id', 'storage_key', 'status'])
          .executeTakeFirstOrThrow()

        return reply.status(201).send(toImageView(row, deps.config))
      } catch (error) {
        await deps.storage.remove(storageKey).catch(() => undefined)
        throw error
      }
    },
  )

  app.get('/files/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*']
    const query = request.query as Record<string, unknown>
    const exp = queryString(query, 'exp')
    const sig = queryString(query, 'sig')

    if (
      !key ||
      exp === undefined ||
      sig === undefined ||
      !verifyFileUrl(key, exp, sig, deps.config.fileUrlSecret)
    ) {
      throw forbidden()
    }

    const row = await deps.db
      .selectFrom('images')
      .select(['mime', 'status'])
      .where('storage_key', '=', key)
      .executeTakeFirst()

    if (!row || row.status === 'rejected') {
      throw notFound('File not found')
    }

    const data = await deps.storage.get(key)
    if (data === null) {
      throw notFound('File not found')
    }

    return reply.type(row.mime).send(data)
  })
}
