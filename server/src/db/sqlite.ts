import { DatabaseSync } from 'node:sqlite'
import { Kysely, SqliteDialect, type SqliteStatement } from 'kysely'
import type { DB } from './db.js'

export function normalizeParameter(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === undefined) return null
  return value
}

type NodeSqliteStatement = ReturnType<DatabaseSync['prepare']>

function toPlain(row: unknown): Record<string, unknown> {
  return { ...(row as Record<string, unknown>) }
}

function normalizeParameters(params: ReadonlyArray<unknown>): any[] {
  return params.map(normalizeParameter)
}

function wrap(stmt: NodeSqliteStatement): SqliteStatement {
  return {
    get reader() {
      return stmt.columns().length > 0
    },
    all(params) {
      return stmt.all(...normalizeParameters(params)).map(toPlain)
    },
    run(params) {
      return stmt.run(...normalizeParameters(params))
    },
    *iterate(params) {
      for (const row of stmt.iterate(...normalizeParameters(params))) {
        yield toPlain(row)
      }
    },
  }
}

export function createNodeSqliteDatabase(filename: string) {
  const db = new DatabaseSync(filename)
  db.exec('pragma journal_mode = wal')
  db.exec('pragma busy_timeout = 5000')
  return {
    close: () => db.close(),
    prepare: (text: string) => wrap(db.prepare(text)),
  }
}

export function createSqliteDb(filename: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new SqliteDialect({ database: createNodeSqliteDatabase(filename) }),
  })
}