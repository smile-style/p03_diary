import { sql, type Kysely } from 'kysely'
import type { DB } from '../db.js'

const UUID_DEFAULT = `(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))))`
const NOW_DEFAULT = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

export async function up(db: Kysely<DB>): Promise<void> {
  await sql`
    create table users (
      id text primary key default ${sql.raw(UUID_DEFAULT)},
      created_at text not null default ${sql.raw(NOW_DEFAULT)}
    )
  `.execute(db)

  await sql`
    create table user_identities (
      id text primary key default ${sql.raw(UUID_DEFAULT)},
      user_id text not null references users(id) on delete cascade,
      provider text not null,
      subject text not null,
      created_at text not null default ${sql.raw(NOW_DEFAULT)},
      unique(provider, subject)
    )
  `.execute(db)

  await sql`
    create table categories (
      id text primary key default ${sql.raw(UUID_DEFAULT)},
      user_id text not null references users(id) on delete cascade,
      name text not null,
      sort_order integer not null default 0,
      created_at text not null default ${sql.raw(NOW_DEFAULT)},
      unique(user_id, name)
    )
  `.execute(db)

  await sql`
    create table topics (
      id text primary key default ${sql.raw(UUID_DEFAULT)},
      user_id text not null references users(id) on delete cascade,
      category_id text references categories(id) on delete set null,
      name text not null,
      created_at text not null default ${sql.raw(NOW_DEFAULT)},
      unique(user_id, name)
    )
  `.execute(db)

  await sql`
    create table records (
      id text primary key default ${sql.raw(UUID_DEFAULT)},
      user_id text not null references users(id) on delete cascade,
      topic_id text references topics(id) on delete set null,
      record_date text not null,
      body text not null default '',
      links text not null default '[]',
      created_at text not null default ${sql.raw(NOW_DEFAULT)},
      updated_at text not null default ${sql.raw(NOW_DEFAULT)}
    )
  `.execute(db)

  await sql`
    create table excerpts (
      id text primary key default ${sql.raw(UUID_DEFAULT)},
      record_id text not null references records(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      position integer not null,
      quote text not null,
      thought text not null default '',
      starred integer not null default 0
    )
  `.execute(db)

  await sql`
    create table images (
      id text primary key default ${sql.raw(UUID_DEFAULT)},
      user_id text not null references users(id) on delete cascade,
      record_id text references records(id) on delete set null,
      storage_key text not null,
      mime text not null,
      status text not null default 'ok',
      trace_id text,
      position integer not null default 0,
      created_at text not null default ${sql.raw(NOW_DEFAULT)},
      constraint images_status_check check (status in ('pending','ok','rejected'))
    )
  `.execute(db)

  await sql`
    create table tags (
      id text primary key default ${sql.raw(UUID_DEFAULT)},
      user_id text not null references users(id) on delete cascade,
      name text not null,
      unique(user_id, name)
    )
  `.execute(db)

  await sql`
    create table record_tags (
      record_id text not null references records(id) on delete cascade,
      tag_id text not null references tags(id) on delete cascade,
      primary key (record_id, tag_id)
    )
  `.execute(db)

  await sql`
    create index records_user_date_idx
    on records (user_id, record_date desc, created_at desc)
  `.execute(db)
}

export async function down(db: Kysely<DB>): Promise<void> {
  for (const table of [
    'record_tags',
    'tags',
    'images',
    'excerpts',
    'records',
    'topics',
    'categories',
    'user_identities',
    'users',
  ]) {
    await sql`drop table if exists ${sql.table(table)}`.execute(db)
  }
}