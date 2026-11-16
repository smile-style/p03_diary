import type { Generated, Kysely } from 'kysely'
import { createSqliteDb } from './sqlite.js'

export type ImageStatus = 'pending' | 'ok' | 'rejected'

export interface UsersTable {
  id: Generated<string>
  created_at: Generated<string>
}

export interface UserIdentitiesTable {
  id: Generated<string>
  user_id: string
  provider: string
  subject: string
  created_at: Generated<string>
}

export interface CategoriesTable {
  id: Generated<string>
  user_id: string
  name: string
  sort_order: Generated<number>
  created_at: Generated<string>
}

export interface TopicsTable {
  id: Generated<string>
  user_id: string
  category_id: string | null
  name: string
  created_at: Generated<string>
}

export interface RecordsTable {
  id: Generated<string>
  user_id: string
  topic_id: string | null
  record_date: string
  body: Generated<string>
  links: Generated<string>
  created_at: Generated<string>
  updated_at: Generated<string>
}

export interface ExcerptsTable {
  id: Generated<string>
  record_id: string
  user_id: string
  position: number
  quote: string
  thought: Generated<string>
  starred: Generated<number>
}

export interface ImagesTable {
  id: Generated<string>
  user_id: string
  record_id: string | null
  storage_key: string
  mime: string
  status: Generated<ImageStatus>
  trace_id: string | null
  position: Generated<number>
  created_at: Generated<string>
}

export interface TagsTable {
  id: Generated<string>
  user_id: string
  name: string
}

export interface RecordTagsTable {
  record_id: string
  tag_id: string
}

export interface DB {
  users: UsersTable
  user_identities: UserIdentitiesTable
  categories: CategoriesTable
  topics: TopicsTable
  records: RecordsTable
  excerpts: ExcerptsTable
  images: ImagesTable
  tags: TagsTable
  record_tags: RecordTagsTable
}

export function createDb(filename: string): Kysely<DB> {
  return createSqliteDb(filename)
}

export function toIsoString(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString()
}
