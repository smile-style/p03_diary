import { Migrator, type Migration, type MigrationProvider, type Kysely } from 'kysely'
import type { DB } from './db.js'
import * as init from './migrations/001_init.js'

const provider: MigrationProvider = {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      '001_init': init,
    }
  },
}

export async function migrateToLatest(db: Kysely<DB>): Promise<void> {
  const migrator = new Migrator({ db, provider })
  const { error, results } = await migrator.migrateToLatest()

  if (error) {
    throw error
  }

  for (const result of results ?? []) {
    if (result.status === 'Error') {
      throw new Error(`数据库迁移失败：${result.migrationName}`)
    }
  }
}
