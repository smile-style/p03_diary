import { Kysely, PostgresDialect, type Generated } from 'kysely'
import { Pool } from 'pg'

export type ImageStatus = 'pending' | 'ok' | 'rejected'

export interface UsersTable {
  id: Generated<string>
  created_at: Generated<Date>
}

export interface UserIdentitiesTable {
  id: Generated<string>
  user_id: string
  provider: string
  subject: string
  created_at: Generated<Date>
}

export interface CategoriesTable {
  id: Generated<string>
  user_id: string
  name: string
  sort_order: Generated<number>
  created_at: Generated<Date>
}

export interface TopicsTable {
  id: Generated<string>
  user_id: string
  category_id: string | null
  name: string
  created_at: Generated<Date>
}

export interface RecordsTable {
  id: Generated<string>
  user_id: string
  topic_id: string | null
  record_date: string
  body: Generated<string>
  links: Generated<string[]>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface ExcerptsTable {
  id: Generated<string>
  record_id: string
  user_id: string
  position: number
  quote: string
  thought: Generated<string>
  starred: Generated<boolean>
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
  created_at: Generated<Date>
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

export function createDb(url: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url }),
    }),
  })
}
