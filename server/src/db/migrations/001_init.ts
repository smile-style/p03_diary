import { sql, type Kysely } from 'kysely'
import type { DB } from '../db.js'

export async function up(db: Kysely<DB>): Promise<void> {
  await sql`create extension if not exists pg_trgm`.execute(db)

  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('user_identities')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('subject', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('user_identities_provider_subject_unique', ['provider', 'subject'])
    .execute()

  await db.schema
    .createTable('categories')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('categories_user_name_unique', ['user_id', 'name'])
    .execute()

  await db.schema
    .createTable('topics')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('category_id', 'uuid', (col) =>
      col.references('categories.id').onDelete('set null'),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('topics_user_name_unique', ['user_id', 'name'])
    .execute()

  await db.schema
    .createTable('records')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('topic_id', 'uuid', (col) =>
      col.references('topics.id').onDelete('set null'),
    )
    .addColumn('record_date', 'date', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('links', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('excerpts')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('record_id', 'uuid', (col) =>
      col.notNull().references('records.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('quote', 'text', (col) => col.notNull())
    .addColumn('thought', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('starred', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()

  await db.schema
    .createTable('images')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('record_id', 'uuid', (col) =>
      col.references('records.id').onDelete('set null'),
    )
    .addColumn('storage_key', 'text', (col) => col.notNull())
    .addColumn('mime', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('ok'))
    .addColumn('trace_id', 'text')
    .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('images_status_check', sql`status in ('pending', 'ok', 'rejected')`)
    .execute()

  await db.schema
    .createTable('tags')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addUniqueConstraint('tags_user_name_unique', ['user_id', 'name'])
    .execute()

  await db.schema
    .createTable('record_tags')
    .addColumn('record_id', 'uuid', (col) =>
      col.notNull().references('records.id').onDelete('cascade'),
    )
    .addColumn('tag_id', 'uuid', (col) =>
      col.notNull().references('tags.id').onDelete('cascade'),
    )
    .addPrimaryKeyConstraint('record_tags_pkey', ['record_id', 'tag_id'])
    .execute()

  await sql`
    create index records_user_date_idx
    on records (user_id, record_date desc, created_at desc)
  `.execute(db)
  await sql`
    create index records_body_trgm_idx
    on records using gin (body gin_trgm_ops)
  `.execute(db)
  await sql`
    create index excerpts_quote_trgm_idx
    on excerpts using gin (quote gin_trgm_ops)
  `.execute(db)
  await sql`
    create index excerpts_thought_trgm_idx
    on excerpts using gin (thought gin_trgm_ops)
  `.execute(db)
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.schema.dropTable('record_tags').ifExists().execute()
  await db.schema.dropTable('tags').ifExists().execute()
  await db.schema.dropTable('images').ifExists().execute()
  await db.schema.dropTable('excerpts').ifExists().execute()
  await db.schema.dropTable('records').ifExists().execute()
  await db.schema.dropTable('topics').ifExists().execute()
  await db.schema.dropTable('categories').ifExists().execute()
  await db.schema.dropTable('user_identities').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()
}
