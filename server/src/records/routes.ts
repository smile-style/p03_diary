import type { FastifyInstance } from 'fastify'
import type { Deps } from '../deps.js'
import { notFound } from '../errors.js'
import { listRecords } from '../queries/routes.js'
import {
  deleteRecord,
  loadRecordViews,
  saveRecord,
  type RecordInput,
  type RecordView,
} from './service.js'

async function requireRecordView(
  deps: Deps,
  userId: string,
  recordId: string,
): Promise<RecordView> {
  const [view] = await loadRecordViews(deps.db, deps.config, userId, [recordId])
  if (!view) {
    throw notFound('记录不存在')
  }
  return view
}

export function registerRecordRoutes(app: FastifyInstance, deps: Deps): void {
  app.get(
    '/records',
    { preHandler: app.requireUser },
    async (request) => listRecords(deps, request.userId, request.query),
  )

  app.post(
    '/records',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const recordId = await saveRecord(
        deps,
        request.userId,
        request.body as RecordInput,
      )
      const view = await requireRecordView(deps, request.userId, recordId)
      return reply.status(201).send(view)
    },
  )

  app.get(
    '/records/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const { id } = request.params as { id: string }
      return requireRecordView(deps, request.userId, id)
    },
  )

  app.put(
    '/records/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const { id } = request.params as { id: string }
      await saveRecord(
        deps,
        request.userId,
        request.body as RecordInput,
        id,
      )
      return requireRecordView(deps, request.userId, id)
    },
  )

  app.delete(
    '/records/:id',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const deleted = await deleteRecord(deps, request.userId, id)
      if (!deleted) {
        throw notFound('记录不存在')
      }
      return reply.status(204).send()
    },
  )
}
