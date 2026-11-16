import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { z, ZodError } from 'zod'
import type { Deps } from '../deps.js'
import { validation } from '../errors.js'
import { loadRecordViews, type RecordView } from '../records/service.js'

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const base64UrlPattern = /^[A-Za-z0-9_-]+$/

function isRealCalendarDate(value: string): boolean {
  if (!datePattern.test(value)) {
    return false
  }

  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return (
    year >= 1 &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  )
}

const dateSchema = z
  .string()
  .regex(datePattern, 'Date must use YYYY-MM-DD')
  .refine(isRealCalendarDate, 'Date must be a real calendar date')

const uuidSchema = z.string().uuid('ID must be a UUID')

// SQLite 的 strftime('%f') 固定输出三位毫秒。
const cursorTimestampSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false
  }
  const parsed = new Date(value)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 19) === value.slice(0, 19)
  )
}, 'Cursor timestamp is invalid')

const recordCursorSchema = z
  .object({
    recordDate: dateSchema,
    createdAt: cursorTimestampSchema,
    id: uuidSchema,
  })
  .strict()

const starredCursorSchema = z
  .object({
    recordDate: dateSchema,
    createdAt: cursorTimestampSchema,
    recordId: uuidSchema,
    excerptId: uuidSchema,
  })
  .strict()

const limitSchema = z.coerce
  .number('Limit must be an integer')
  .int('Limit must be an integer')
  .min(1, 'Limit must be between 1 and 50')
  .max(50, 'Limit must be between 1 and 50')
  .default(20)

const recordQuerySchema = z.object({
  date: dateSchema.optional(),
  topicId: uuidSchema.optional(),
  tag: z.string().optional(),
  q: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed ? trimmed : undefined
    }),
  starred: z.literal('1', 'Starred must equal 1').optional(),
  cursor: z.string().optional(),
  limit: limitSchema,
})

type RecordQuery = z.output<typeof recordQuerySchema>

type RecordCursor = z.output<typeof recordCursorSchema>
type StarredCursor = z.output<typeof starredCursorSchema>

type TimelineRow = {
  id: string
  record_date: string
  created_at: string
}

type StarredRow = {
  record_id: string
  excerpt_id: string
  record_date: string
  created_at: string
}

type StarredItem = {
  excerpt: {
    id: string
    quote: string
    thought: string
    starred: true
  }
  record: {
    id: string
    recordDate: string
    topic: { id: string; name: string } | null
  }
}

function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function parseCursor<T>(schema: z.ZodType<T>, encoded: string): T {
  try {
    if (!base64UrlPattern.test(encoded)) {
      throw new Error('Cursor is not base64url')
    }
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
      throw new Error('Cursor is not canonical base64url')
    }
    return schema.parse(JSON.parse(decoded))
  } catch (error) {
    if (error instanceof ZodError) {
      throw error
    }
    throw validation('Cursor is invalid')
  }
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function recordCursor(row: TimelineRow): RecordCursor {
  return {
    recordDate: row.record_date,
    createdAt: row.created_at,
    id: row.id,
  }
}

function starredCursor(row: StarredRow): StarredCursor {
  return {
    recordDate: row.record_date,
    createdAt: row.created_at,
    recordId: row.record_id,
    excerptId: row.excerpt_id,
  }
}

export async function listRecords(
  deps: Deps,
  userId: string,
  queryInput: unknown,
) {
  const query: RecordQuery = recordQuerySchema.parse(queryInput)
  const cursor = query.cursor
    ? parseCursor(recordCursorSchema, query.cursor)
    : undefined

  let idsQuery = deps.db
    .selectFrom('records as record')
    .select([
      'record.id as id',
      'record.record_date as record_date',
      'record.created_at as created_at',
    ])
    .where('record.user_id', '=', userId)

  if (query.date !== undefined) {
    idsQuery = idsQuery.where('record.record_date', '=', query.date)
  }
  if (query.topicId !== undefined) {
    idsQuery = idsQuery.where('record.topic_id', '=', query.topicId)
  }
  if (query.tag !== undefined) {
    idsQuery = idsQuery.where(sql<boolean>`exists (
      select 1
      from record_tags as filtered_record_tag
      inner join tags as filtered_tag
        on filtered_tag.id = filtered_record_tag.tag_id
      where filtered_record_tag.record_id = record.id
        and filtered_tag.user_id = ${userId}
        and filtered_tag.name = ${query.tag}
    )`)
  }
  if (query.starred === '1') {
    idsQuery = idsQuery.where(sql<boolean>`exists (
      select 1
      from excerpts as starred_excerpt
      where starred_excerpt.record_id = record.id
        and starred_excerpt.user_id = ${userId}
        and starred_excerpt.starred = 1
    )`)
  }
  if (query.q !== undefined) {
    const pattern = `%${escapeLikeLiteral(query.q)}%`
    idsQuery = idsQuery.where(sql<boolean>`(
      lower(record.body) like lower(${pattern}) escape '\\'
      or exists (
        select 1
        from excerpts as search_excerpt
        where search_excerpt.record_id = record.id
          and search_excerpt.user_id = ${userId}
          and (
            lower(search_excerpt.quote) like lower(${pattern}) escape '\\'
            or lower(search_excerpt.thought) like lower(${pattern}) escape '\\'
          )
      )
    )`)
  }
  if (cursor !== undefined) {
    idsQuery = idsQuery.where(sql<boolean>`(
      record.record_date < ${cursor.recordDate}
      or (
        record.record_date = ${cursor.recordDate}
        and record.created_at < ${cursor.createdAt}
      )
      or (
        record.record_date = ${cursor.recordDate}
        and record.created_at = ${cursor.createdAt}
        and record.id < ${cursor.id}
      )
    )`)
  }

  const rows = await idsQuery
    .orderBy('record.record_date', 'desc')
    .orderBy('record.created_at', 'desc')
    .orderBy('record.id', 'desc')
    .limit(query.limit + 1)
    .execute()

  const pageRows = rows.slice(0, query.limit)
  const items = await loadRecordViews(
    deps.db,
    deps.config,
    userId,
    pageRows.map((row) => row.id),
  )
  const lastRow = pageRows.at(-1)

  return {
    items,
    nextCursor:
      rows.length > query.limit && lastRow
        ? encodeCursor(recordCursor(lastRow))
        : null,
  }
}

export function registerQueryRoutes(app: FastifyInstance, deps: Deps): void {
  app.get(
    '/calendar',
    { preHandler: app.requireUser },
    async (request) => {
      const { month } = z.object({ month: monthSchema }).parse(request.query)
      const year = Number(month.slice(0, 4))
      const monthNumber = Number(month.slice(5, 7))
      const nextYear = monthNumber === 12 ? year + 1 : year
      const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
      const nextMonthStart = `${String(nextYear).padStart(4, '0')}-${String(
        nextMonth,
      ).padStart(2, '0')}-01`

      const rows = await deps.db
        .selectFrom('records')
        .select([
          'record_date as date',
          sql<number>`cast(count(*) as integer)`.as('count'),
        ])
        .where('user_id', '=', request.userId)
        .where('record_date', '>=', `${month}-01`)
        .where('record_date', '<', nextMonthStart)
        .groupBy('record_date')
        .orderBy('record_date')
        .execute()

      return {
        days: rows.map((row) => ({ ...row, count: Number(row.count) })),
      }
    },
  )

  app.get('/tags', { preHandler: app.requireUser }, async (request) => {
    const rows = await deps.db
      .selectFrom('record_tags as record_tag')
      .innerJoin('records as record', 'record.id', 'record_tag.record_id')
      .innerJoin('tags as tag', 'tag.id', 'record_tag.tag_id')
      .select([
        'tag.name as name',
        sql<number>`cast(count(${sql.ref('record_tag.record_id')}) as integer)`.as('count'),
      ])
      .where('tag.user_id', '=', request.userId)
      .where('record.user_id', '=', request.userId)
      .groupBy('tag.name')
      .orderBy(
        sql<number>`count(${sql.ref('record_tag.record_id')})`,
        'desc',
      )
      .orderBy('tag.name')
      .execute()

    return {
      items: rows.map((row) => ({ ...row, count: Number(row.count) })),
    }
  })

  app.get(
    '/excerpts/starred',
    { preHandler: app.requireUser },
    async (request) => {
      const { cursor: encodedCursor, limit } = z
        .object({
          cursor: z.string().optional(),
          limit: limitSchema,
        })
        .parse(request.query)
      const cursor = encodedCursor
        ? parseCursor(starredCursorSchema, encodedCursor)
        : undefined

      let rowsQuery = deps.db
        .selectFrom('excerpts as excerpt')
        .innerJoin('records as record', 'record.id', 'excerpt.record_id')
        .select([
          'excerpt.id as excerpt_id',
          'record.id as record_id',
          'record.record_date as record_date',
          'record.created_at as created_at',
        ])
        .where('excerpt.user_id', '=', request.userId)
        .where('record.user_id', '=', request.userId)
        .where('excerpt.starred', '=', 1)

      if (cursor !== undefined) {
        rowsQuery = rowsQuery.where(sql<boolean>`(
          record.record_date < ${cursor.recordDate}
          or (
            record.record_date = ${cursor.recordDate}
            and record.created_at < ${cursor.createdAt}
          )
          or (
            record.record_date = ${cursor.recordDate}
            and record.created_at = ${cursor.createdAt}
            and record.id < ${cursor.recordId}
          )
          or (
            record.record_date = ${cursor.recordDate}
            and record.created_at = ${cursor.createdAt}
            and record.id = ${cursor.recordId}
            and excerpt.id < ${cursor.excerptId}
          )
        )`)
      }

      const rows = await rowsQuery
        .orderBy('record.record_date', 'desc')
        .orderBy('record.created_at', 'desc')
        .orderBy('record.id', 'desc')
        .orderBy('excerpt.id', 'desc')
        .limit(limit + 1)
        .execute()

      const pageRows: StarredRow[] = rows.slice(0, limit)
      const recordIds = [...new Set(pageRows.map((row) => row.record_id))]
      const views = await loadRecordViews(
        deps.db,
        deps.config,
        request.userId,
        recordIds,
      )
      const viewsById = new Map<string, RecordView>(
        views.map((view) => [view.id, view]),
      )
      const items: StarredItem[] = []

      for (const row of pageRows) {
        const view = viewsById.get(row.record_id)
        const excerpt = view?.excerpts.find((item) => item.id === row.excerpt_id)
        if (!view || !excerpt?.starred) {
          continue
        }
        items.push({
          excerpt: {
            id: excerpt.id,
            quote: excerpt.quote,
            thought: excerpt.thought,
            starred: true,
          },
          record: {
            id: view.id,
            recordDate: view.recordDate,
            topic: view.topic,
          },
        })
      }

      const lastRow = pageRows.at(-1)
      return {
        items,
        nextCursor:
          rows.length > limit && lastRow
            ? encodeCursor(starredCursor(lastRow))
            : null,
      }
    },
  )
}

const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Month must use YYYY-MM')
  .refine((value) => {
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(5, 7))
    return year >= 1 && month >= 1 && month <= 12
  }, 'Month must be a real calendar month')
