import { sql, type Kysely, type Transaction } from 'kysely'
import { z } from 'zod'
import type { Config } from '../config.js'
import type { DB } from '../db/db.js'
import type { Deps } from '../deps.js'
import { AppError, notFound } from '../errors.js'
import { toImageView } from '../images/routes.js'
import { extractTags } from './tags.js'

export type RecordInput = {
  topicId: string | null
  recordDate: string
  body: string
  links: string[]
  excerpts: { quote: string; thought: string; starred: boolean }[]
  imageIds: string[]
}

export type RecordView = {
  id: string
  topicId: string | null
  topic: { id: string; name: string } | null
  recordDate: string
  body: string
  links: string[]
  excerpts: { id: string; quote: string; thought: string; starred: boolean }[]
  images: ReturnType<typeof toImageView>[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/

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

const excerptSchema = z.object({
  quote: z.string().min(1, '摘抄原文不能为空').max(5000, '摘抄原文不能超过 5000 个字符'),
  thought: z.string().max(5000, '摘抄想法不能超过 5000 个字符').optional().default(''),
  starred: z.boolean(),
})

const linkSchema = z
  .url('链接必须是合法 URL')
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  }, '链接必须使用 http:// 或 https://')

export const recordInputSchema = z
  .object({
    topicId: z.string().uuid('主题 ID 不合法').nullable(),
    recordDate: z
      .string()
      .regex(datePattern, '记录日期格式必须为 YYYY-MM-DD')
      .refine(isRealCalendarDate, '记录日期不是有效日期'),
    body: z.string().max(20000, '正文不能超过 20000 个字符'),
    links: z.array(linkSchema).max(10, '链接不能超过 10 条'),
    excerpts: z.array(excerptSchema).max(50, '摘抄不能超过 50 条'),
    imageIds: z.array(z.string().uuid('图片 ID 不合法')).max(9, '图片不能超过 9 张'),
  })
  .refine(
    (input) =>
      input.body.trim().length > 0 ||
      input.excerpts.length > 0 ||
      input.imageIds.length > 0,
    '记录不能为空',
  )

type ParsedRecordInput = z.output<typeof recordInputSchema>

async function assertRecordOwned(
  db: Kysely<DB>,
  userId: string,
  recordId: string,
): Promise<void> {
  const record = await db
    .selectFrom('records')
    .select('id')
    .where('id', '=', recordId)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  if (!record) {
    throw notFound('记录不存在')
  }
}

async function assertTopicOwned(
  db: Kysely<DB>,
  userId: string,
  topicId: string | null,
): Promise<void> {
  if (topicId === null) {
    return
  }

  const topic = await db
    .selectFrom('topics')
    .select('id')
    .where('id', '=', topicId)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  if (!topic) {
    throw notFound('主题不存在')
  }
}

async function assertImagesOwned(
  db: Kysely<DB>,
  userId: string,
  imageIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(imageIds)]
  if (uniqueIds.length === 0) {
    return
  }

  const images = await db
    .selectFrom('images')
    .select('id')
    .where('id', 'in', uniqueIds)
    .where('user_id', '=', userId)
    .execute()

  if (images.length !== uniqueIds.length) {
    throw notFound('图片不存在')
  }
}

async function replaceRecordTags(
  trx: Transaction<DB>,
  userId: string,
  recordId: string,
  input: ParsedRecordInput,
): Promise<void> {
  const tagNames = extractTags([
    input.body,
    ...input.excerpts.map((excerpt) => excerpt.thought),
  ])

  await trx.deleteFrom('record_tags').where('record_id', '=', recordId).execute()

  if (tagNames.length === 0) {
    return
  }

  await trx
    .insertInto('tags')
    .values(tagNames.map((name) => ({ user_id: userId, name })))
    .onConflict((conflict) => conflict.columns(['user_id', 'name']).doNothing())
    .execute()

  const tagRows = await trx
    .selectFrom('tags')
    .select(['id', 'name'])
    .where('user_id', '=', userId)
    .where('name', 'in', tagNames)
    .execute()

  await trx
    .insertInto('record_tags')
    .values(
      tagRows.map((tag) => ({
        record_id: recordId,
        tag_id: tag.id,
      })),
    )
    .execute()
}

async function removeFiles(deps: Deps, storageKeys: string[]): Promise<void> {
  await Promise.all(
    [...new Set(storageKeys)].map((key) =>
      deps.storage.remove(key).catch(() => undefined),
    ),
  )
}

export async function saveRecord(
  deps: Deps,
  userId: string,
  input: RecordInput,
  recordId?: string,
): Promise<string> {
  if (recordId !== undefined) {
    await assertRecordOwned(deps.db, userId, recordId)
  }

  const parsed = recordInputSchema.parse(input)
  await assertTopicOwned(deps.db, userId, parsed.topicId)
  await assertImagesOwned(deps.db, userId, parsed.imageIds)

  const identity = await deps.db
    .selectFrom('user_identities')
    .select('subject')
    .where('user_id', '=', userId)
    .where('provider', '=', 'wechat')
    .limit(1)
    .executeTakeFirst()
  const checkedText = [
    parsed.body,
    ...parsed.excerpts.flatMap((excerpt) => [excerpt.quote, excerpt.thought]),
    ...parsed.links,
  ].join('\n')

  const checkResult = await deps.checker.checkText(
    checkedText,
    identity?.subject ?? null,
  )
  if (checkResult === 'reject') {
    throw new AppError(
      422,
      'CONTENT_REJECTED',
      '内容未通过安全检查，请修改后再保存',
    )
  }

  let cleanupKeys: string[] = []
  const savedRecordId = await deps.db.transaction().execute(async (trx) => {
    let id: string

    if (recordId === undefined) {
      const inserted = await trx
        .insertInto('records')
        .values({
          user_id: userId,
          topic_id: parsed.topicId,
          record_date: parsed.recordDate,
          body: parsed.body,
          links: parsed.links,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      id = inserted.id
    } else {
      const updated = await trx
        .updateTable('records')
        .set({
          topic_id: parsed.topicId,
          record_date: parsed.recordDate,
          body: parsed.body,
          links: parsed.links,
          updated_at: new Date(),
        })
        .where('id', '=', recordId)
        .where('user_id', '=', userId)
        .returning('id')
        .executeTakeFirst()

      if (!updated) {
        throw notFound('记录不存在')
      }
      id = updated.id
    }

    await trx.deleteFrom('excerpts').where('record_id', '=', id).execute()
    if (parsed.excerpts.length > 0) {
      await trx
        .insertInto('excerpts')
        .values(
          parsed.excerpts.map((excerpt, position) => ({
            record_id: id,
            user_id: userId,
            position,
            quote: excerpt.quote,
            thought: excerpt.thought,
            starred: excerpt.starred,
          })),
        )
        .execute()
    }

    const existingImages = await trx
      .selectFrom('images')
      .select(['id', 'storage_key'])
      .where('record_id', '=', id)
      .where('user_id', '=', userId)
      .execute()
    const requestedImageIds = new Set(parsed.imageIds)
    const removedImages = existingImages.filter(
      (image) => !requestedImageIds.has(image.id),
    )
    cleanupKeys = removedImages.map((image) => image.storage_key)

    if (removedImages.length > 0) {
      await trx
        .deleteFrom('images')
        .where(
          'id',
          'in',
          removedImages.map((image) => image.id),
        )
        .where('user_id', '=', userId)
        .execute()
    }

    for (const [position, imageId] of parsed.imageIds.entries()) {
      await trx
        .updateTable('images')
        .set({ record_id: id, position })
        .where('id', '=', imageId)
        .where('user_id', '=', userId)
        .execute()
    }

    await replaceRecordTags(trx, userId, id, parsed)
    return id
  })

  await removeFiles(deps, cleanupKeys)
  return savedRecordId
}

export async function loadRecordViews(
  db: Kysely<DB>,
  config: Config,
  userId: string,
  ids: string[],
): Promise<RecordView[]> {
  if (ids.length === 0) {
    return []
  }

  const records = await db
    .selectFrom('records as record')
    .leftJoin('topics as topic', 'topic.id', 'record.topic_id')
    .select([
      'record.id as id',
      'record.topic_id as topic_id',
      sql<string>`record.record_date::text`.as('record_date'),
      'record.body as body',
      'record.links as links',
      'record.created_at as created_at',
      'record.updated_at as updated_at',
      'topic.id as topic_name_id',
      'topic.name as topic_name',
    ])
    .where('record.user_id', '=', userId)
    .where('record.id', 'in', ids)
    .execute()

  const excerpts = await db
    .selectFrom('excerpts')
    .select(['id', 'record_id', 'quote', 'thought', 'starred', 'position'])
    .where('user_id', '=', userId)
    .where('record_id', 'in', ids)
    .orderBy('record_id')
    .orderBy('position')
    .execute()

  const images = await db
    .selectFrom('images')
    .select(['id', 'record_id', 'storage_key', 'status', 'position'])
    .where('user_id', '=', userId)
    .where('record_id', 'in', ids)
    .orderBy('record_id')
    .orderBy('position')
    .execute()

  const tags = await db
    .selectFrom('record_tags as record_tag')
    .innerJoin('tags as tag', 'tag.id', 'record_tag.tag_id')
    .select([
      'record_tag.record_id as record_id',
      'tag.id as id',
      'tag.name as name',
    ])
    .where('tag.user_id', '=', userId)
    .where('record_tag.record_id', 'in', ids)
    .orderBy('record_tag.record_id')
    .orderBy('tag.name')
    .execute()

  const excerptsByRecord = new Map<string, RecordView['excerpts']>()
  for (const excerpt of excerpts) {
    const list = excerptsByRecord.get(excerpt.record_id) ?? []
    list.push({
      id: excerpt.id,
      quote: excerpt.quote,
      thought: excerpt.thought,
      starred: excerpt.starred,
    })
    excerptsByRecord.set(excerpt.record_id, list)
  }

  const imagesByRecord = new Map<string, RecordView['images']>()
  for (const image of images) {
    if (image.record_id === null) {
      continue
    }
    const list = imagesByRecord.get(image.record_id) ?? []
    list.push(toImageView(image, config))
    imagesByRecord.set(image.record_id, list)
  }

  const tagsByRecord = new Map<string, string[]>()
  for (const tag of tags) {
    const list = tagsByRecord.get(tag.record_id) ?? []
    list.push(tag.name)
    tagsByRecord.set(tag.record_id, list)
  }

  const viewsById = new Map<string, RecordView>()
  for (const record of records) {
    viewsById.set(record.id, {
      id: record.id,
      topicId: record.topic_id,
      topic:
        record.topic_name_id !== null && record.topic_name !== null
          ? { id: record.topic_name_id, name: record.topic_name }
          : null,
      recordDate: record.record_date,
      body: record.body,
      links: record.links,
      excerpts: excerptsByRecord.get(record.id) ?? [],
      images: imagesByRecord.get(record.id) ?? [],
      tags: tagsByRecord.get(record.id) ?? [],
      createdAt: record.created_at.toISOString(),
      updatedAt: record.updated_at.toISOString(),
    })
  }

  return ids.flatMap((id) => {
    const view = viewsById.get(id)
    return view === undefined ? [] : [view]
  })
}

export async function deleteRecord(
  deps: Deps,
  userId: string,
  recordId: string,
): Promise<boolean> {
  let cleanupKeys: string[] = []
  const deleted = await deps.db.transaction().execute(async (trx) => {
    const record = await trx
      .selectFrom('records')
      .select('id')
      .where('id', '=', recordId)
      .where('user_id', '=', userId)
      .executeTakeFirst()

    if (!record) {
      return false
    }

    const images = await trx
      .selectFrom('images')
      .select('storage_key')
      .where('record_id', '=', recordId)
      .where('user_id', '=', userId)
      .execute()
    cleanupKeys = images.map((image) => image.storage_key)

    await trx
      .deleteFrom('images')
      .where('record_id', '=', recordId)
      .where('user_id', '=', userId)
      .execute()
    await trx
      .deleteFrom('records')
      .where('id', '=', recordId)
      .where('user_id', '=', userId)
      .execute()

    return true
  })

  if (deleted) {
    await removeFiles(deps, cleanupKeys)
  }
  return deleted
}
