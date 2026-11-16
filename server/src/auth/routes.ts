import type { FastifyInstance } from 'fastify'
import type { Deps } from '../deps.js'
import { ensureLocalUser } from './local.js'

export function registerAuthRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/auth/local', async () => {
    const userId = await ensureLocalUser(deps.db)
    return { token: app.jwt.sign({ sub: userId }, { expiresIn: '30d' }) }
  })
}
