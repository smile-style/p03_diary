import { createHash, createHmac } from 'node:crypto'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import type { Config } from '../src/config.js'
import { AppError } from '../src/errors.js'
import { toImageView } from '../src/images/routes.js'
import { signFileUrl, verifyFileUrl } from '../src/images/signed-url.js'
import { LocalFileStorage } from '../src/images/storage.js'
import type { ContentChecker } from '../src/moderation/checker.js'
import { authHeader, createTestApp, login } from './helpers.js'

const ONE_HOUR_SECONDS = 60 * 60
const ONE_DAY_SECONDS = 24 * ONE_HOUR_SECONDS
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const apps: FastifyInstance[] = []
const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

type ImageCheckResult = Awaited<ReturnType<ContentChecker['submitImage']>>

class CapturingChecker implements ContentChecker {
  readonly calls: Array<{ url: string; openid: string | null }> = []

  constructor(private readonly result: ImageCheckResult | Error = { status: 'ok' }) {}

  async checkText(): Promise<'pass'> {
    return 'pass'
  }

  async submitImage(
    url: string,
    openid: string | null,
  ): Promise<ImageCheckResult> {
    this.calls.push({ url, openid })
    if (this.result instanceof Error) {
      throw this.result
    }
    return this.result
  }
}

function multipartFile(
  data: Buffer,
  options: {
    mime?: string
    filename?: string
    field?: string
  } = {},
): { payload: Buffer; contentType: string } {
  const boundary = '----wx-daily-image-test-boundary'
  const mime = options.mime ?? 'image/jpeg'
  const filename = options.filename ?? 'photo.jpg'
  const field = options.field ?? 'file'
  const start = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  )
  const end = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([start, data, end]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

async function upload(
  app: FastifyInstance,
  token: string | undefined,
  data: Buffer,
  options: { mime?: string; filename?: string; field?: string } = {},
) {
  const multipart = multipartFile(data, options)
  return app.inject({
    method: 'POST',
    url: '/images',
    headers: {
      'content-type': multipart.contentType,
      ...(token ? authHeader(token) : {}),
    },
    payload: multipart.payload,
  })
}

function signedRequestUrl(url: string): string {
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.search}`
}

async function filesUnder(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true })
    const files: string[] = []
    for (const entry of entries) {
      if ((await stat(join(dir, entry))).isFile()) {
        files.push(entry)
      }
    }
    return files
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function pushSignature(timestamp: string, nonce: string, token: string): string {
  return createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex')
}

function pushUrl(
  config: Config,
  query: Record<string, string>,
): string {
  return `/wechat/push?${new URLSearchParams(query).toString()}`
}

function signedPushQuery(
  config: Config,
  timestamp = '1780000000',
  nonce = 'test-nonce',
): Record<string, string> {
  return {
    timestamp,
    nonce,
    signature: pushSignature(timestamp, nonce, config.wechatPushToken),
  }
}

function viewConfig(): Config {
  return {
    port: 3000,
    databaseUrl: 'postgres://unused',
    jwtSecret: 'fake-jwt-secret',
    fileUrlSecret: 'fake-file-url-secret',
    wechatAppId: 'fake-app-id',
    wechatSecret: 'fake-wechat-secret',
    wechatPushToken: 'fake-push-token',
    contentCheck: 'off',
    storageDir: join(tmpdir(), 'unused-view-storage'),
    publicBaseUrl: 'http://localhost:3000',
  }
}

describe('image upload and private file access', () => {
  it('uploads, stores, signs, and serves the original bytes', async () => {
    const checker = new CapturingChecker({ status: 'ok' })
    const { app, deps } = await createTestApp({ checker })
    apps.push(app)
    const token = await login(app, 'image-owner-a')
    const userId = app.jwt.decode<{ sub: string }>(token)!.sub
    const original = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])

    const response = await upload(app, token, original)

    expect(response.statusCode).toBe(201)
    const body = response.json<{ id: string; url: string; status: string }>()
    expect(body).toEqual({
      id: expect.any(String),
      url: expect.any(String),
      status: 'ok',
    })
    expect(body).not.toHaveProperty('traceId')

    const row = await deps.db
      .selectFrom('images')
      .select(['storage_key', 'mime', 'record_id', 'status', 'trace_id'])
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow()
    expect(row).toMatchObject({
      mime: 'image/jpeg',
      record_id: null,
      status: 'ok',
      trace_id: null,
    })
    expect(row.storage_key).toMatch(
      new RegExp(`^${userId}/[0-9a-f-]{36}\\.jpg$`),
    )
    await expect(deps.storage.get(row.storage_key)).resolves.toEqual(original)

    const url = new URL(body.url)
    expect(url.origin).toBe('http://localhost:3000')
    const exp = url.searchParams.get('exp')!
    const sig = url.searchParams.get('sig')!
    expect(verifyFileUrl(row.storage_key, exp, sig, deps.config.fileUrlSecret)).toBe(
      true,
    )

    const file = await app.inject({
      method: 'GET',
      url: signedRequestUrl(body.url),
    })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toContain('image/jpeg')
    expect(file.rawPayload).toEqual(original)
    expect(checker.calls).toHaveLength(1)
  })

  it('passes the exact WeChat openid and a 24-hour callback URL to the checker', async () => {
    const checker = new CapturingChecker({
      status: 'pending',
      traceId: 'trace-from-checker',
    })
    const { app, deps } = await createTestApp({ checker })
    apps.push(app)
    const token = await login(app, 'exact-openid')
    const before = Math.floor(Date.now() / 1000)

    const response = await upload(app, token, Buffer.from('png bytes'), {
      mime: 'image/png',
      filename: 'ignored-name.png',
    })
    const after = Math.floor(Date.now() / 1000)

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ status: 'pending' })
    expect(response.json()).not.toHaveProperty('traceId')

    const row = await deps.db.selectFrom('images').selectAll().executeTakeFirstOrThrow()
    expect(row.trace_id).toBe('trace-from-checker')
    expect(checker.calls).toHaveLength(1)
    expect(checker.calls[0]!.openid).toBe('exact-openid')

    const callbackUrl = new URL(checker.calls[0]!.url)
    const callbackExp = Number(callbackUrl.searchParams.get('exp'))
    expect(callbackExp).toBeGreaterThanOrEqual(before + ONE_DAY_SECONDS)
    expect(callbackExp).toBeLessThanOrEqual(after + ONE_DAY_SECONDS)
    expect(
      verifyFileUrl(
        row.storage_key,
        callbackExp,
        callbackUrl.searchParams.get('sig')!,
        deps.config.fileUrlSecret,
      ),
    ).toBe(true)

    const responseUrl = new URL(response.json<{ url: string }>().url)
    const responseExp = Number(responseUrl.searchParams.get('exp'))
    expect(responseExp).toBeGreaterThanOrEqual(before + ONE_HOUR_SECONDS)
    expect(responseExp).toBeLessThanOrEqual(after + ONE_HOUR_SECONDS)
  })

  it('requires Bearer authentication before accepting a file', async () => {
    const checker = new CapturingChecker()
    const { app } = await createTestApp({ checker })
    apps.push(app)

    const response = await upload(app, undefined, Buffer.from('image'))

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
    expect(checker.calls).toEqual([])
  })

  it('rejects an unsupported MIME without leaving a row or file', async () => {
    const { app, deps } = await createTestApp({ checker: new CapturingChecker() })
    apps.push(app)
    const token = await login(app)

    const response = await upload(app, token, Buffer.from('not an image'), {
      mime: 'text/plain',
      filename: 'notes.txt',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await deps.db.selectFrom('images').select('id').execute()).toEqual([])
    expect(await filesUnder(deps.config.storageDir)).toEqual([])
  })

  it('rejects files larger than 10 MB without leaving a row or file', async () => {
    const { app, deps } = await createTestApp({ checker: new CapturingChecker() })
    apps.push(app)
    const token = await login(app)

    const response = await upload(app, token, Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x61))

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await deps.db.selectFrom('images').select('id').execute()).toEqual([])
    expect(await filesUnder(deps.config.storageDir)).toEqual([])
  })

  it('rejects tampered and expired signatures before revealing whether a file exists', async () => {
    const { app, deps } = await createTestApp({
      checker: new CapturingChecker({ status: 'ok' }),
    })
    apps.push(app)
    const token = await login(app)
    const response = await upload(app, token, Buffer.from('secret-image-bytes'))
    const body = response.json<{ id: string; url: string }>()
    const row = await deps.db
      .selectFrom('images')
      .select('storage_key')
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow()

    const tampered = new URL(body.url)
    const sig = tampered.searchParams.get('sig')!
    tampered.searchParams.set('sig', `${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`)
    const tamperedResponse = await app.inject({
      method: 'GET',
      url: signedRequestUrl(tampered.toString()),
    })
    expect(tamperedResponse.statusCode).toBe(403)
    expect(tamperedResponse.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(tamperedResponse.rawPayload).not.toContain('secret-image-bytes')

    const expiredUrl = signFileUrl(
      row.storage_key,
      deps.config.fileUrlSecret,
      deps.config.publicBaseUrl,
      -60,
    )
    const expiredResponse = await app.inject({
      method: 'GET',
      url: signedRequestUrl(expiredUrl),
    })
    expect(expiredResponse.statusCode).toBe(403)
    expect(expiredResponse.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(expiredResponse.rawPayload).not.toContain('secret-image-bytes')

    await deps.db
      .updateTable('images')
      .set({ status: 'rejected' })
      .where('id', '=', body.id)
      .execute()
    const rejectedResponse = await app.inject({
      method: 'GET',
      url: signedRequestUrl(body.url),
    })
    expect(rejectedResponse.statusCode).toBe(404)
    expect(rejectedResponse.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(rejectedResponse.rawPayload).not.toContain('secret-image-bytes')
  })
})

describe('WeChat async media callback', () => {
  it('marks a pending image rejected when the signed callback reports risky', async () => {
    const checker = new CapturingChecker({ status: 'pending', traceId: 'risky-trace' })
    const { app, deps } = await createTestApp({ checker })
    apps.push(app)
    const token = await login(app)
    const uploadResponse = await upload(app, token, Buffer.from('pending-image'))
    const uploaded = uploadResponse.json<{ id: string; url: string }>()

    const response = await app.inject({
      method: 'POST',
      url: pushUrl(deps.config, signedPushQuery(deps.config)),
      headers: { 'content-type': 'application/json' },
      payload: {
        Event: 'wxa_media_check',
        trace_id: 'risky-trace',
        result: { suggest: 'risky' },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('success')
    const row = await deps.db
      .selectFrom('images')
      .select(['status', 'trace_id'])
      .where('id', '=', uploaded.id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('rejected')

    const file = await app.inject({
      method: 'GET',
      url: signedRequestUrl(uploaded.url),
    })
    expect(file.statusCode).toBe(404)
    expect(file.rawPayload).not.toContain('pending-image')
  })

  it('marks a pending image ok for every signed non-risky result', async () => {
    const checker = new CapturingChecker({ status: 'pending', traceId: 'review-trace' })
    const { app, deps } = await createTestApp({ checker })
    apps.push(app)
    const token = await login(app)
    const uploadResponse = await upload(app, token, Buffer.from('review-image'))
    const uploaded = uploadResponse.json<{ id: string; url: string }>()

    const response = await app.inject({
      method: 'POST',
      url: pushUrl(deps.config, signedPushQuery(deps.config)),
      headers: { 'content-type': 'application/json' },
      payload: {
        Event: 'wxa_media_check',
        trace_id: 'review-trace',
        result: { suggest: 'review' },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('success')
    const row = await deps.db
      .selectFrom('images')
      .select('status')
      .where('id', '=', uploaded.id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('ok')

    const file = await app.inject({
      method: 'GET',
      url: signedRequestUrl(uploaded.url),
    })
    expect(file.statusCode).toBe(200)
    expect(file.rawPayload).toEqual(Buffer.from('review-image'))
  })

  it('rejects a wrong callback signature without changing image status', async () => {
    const checker = new CapturingChecker({ status: 'pending', traceId: 'unchanged-trace' })
    const { app, deps } = await createTestApp({ checker })
    apps.push(app)
    const token = await login(app)
    const uploadResponse = await upload(app, token, Buffer.from('unchanged-image'))
    const uploaded = uploadResponse.json<{ id: string }>()
    const query = {
      ...signedPushQuery(deps.config),
      signature: '0'.repeat(40),
    }

    const response = await app.inject({
      method: 'POST',
      url: pushUrl(deps.config, query),
      headers: { 'content-type': 'application/json' },
      payload: {
        Event: 'wxa_media_check',
        trace_id: 'unchanged-trace',
        result: { suggest: 'risky' },
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    const row = await deps.db
      .selectFrom('images')
      .select('status')
      .where('id', '=', uploaded.id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe('pending')
  })

  it('returns echostr unchanged for a correctly signed GET', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    const echostr = 'echo value & unchanged?'

    const response = await app.inject({
      method: 'GET',
      url: pushUrl(deps.config, {
        ...signedPushQuery(deps.config),
        echostr,
      }),
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe(echostr)
    expect(response.headers['content-type']).toContain('text/plain')
  })

  it('treats unknown events and unknown trace ids as successful no-ops', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)

    const unknownEvent = await app.inject({
      method: 'POST',
      url: pushUrl(deps.config, signedPushQuery(deps.config)),
      headers: { 'content-type': 'application/json' },
      payload: { Event: 'something_else' },
    })
    const unknownTrace = await app.inject({
      method: 'POST',
      url: pushUrl(deps.config, signedPushQuery(deps.config)),
      headers: { 'content-type': 'application/json' },
      payload: {
        Event: 'wxa_media_check',
        trace_id: 'does-not-exist',
        result: { suggest: 'risky' },
      },
    })

    expect(unknownEvent.statusCode).toBe(200)
    expect(unknownEvent.body).toBe('success')
    expect(unknownTrace.statusCode).toBe(200)
    expect(unknownTrace.body).toBe('success')
  })

  it('removes the stored object and image row when the checker fails', async () => {
    const checker = new CapturingChecker(
      new AppError(503, 'CHECK_UNAVAILABLE', 'fake checker unavailable'),
    )
    const { app, deps } = await createTestApp({ checker })
    apps.push(app)
    const token = await login(app)

    const response = await upload(app, token, Buffer.from('cleanup-image'))

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: { code: 'CHECK_UNAVAILABLE' } })
    expect(await deps.db.selectFrom('images').select('id').execute()).toEqual([])
    expect(await filesUnder(deps.config.storageDir)).toEqual([])
  })
})

describe('storage and signed URL helpers', () => {
  it('stores nested keys, returns null for missing keys, and removes idempotently', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wx-daily-storage-'))
    temporaryDirs.push(dir)
    const storage = new LocalFileStorage(dir)
    const key = 'user-id/8a9f7c76-4b42-4f95-91d2-07be419786a0.webp'

    await expect(storage.get(key)).resolves.toBeNull()
    await storage.put(key, Buffer.from('stored bytes'))
    await expect(storage.get(key)).resolves.toEqual(Buffer.from('stored bytes'))
    await storage.remove(key)
    await storage.remove(key)
    await expect(storage.get(key)).resolves.toBeNull()
  })

  it('rejects absolute and traversal keys for every storage operation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wx-daily-storage-safe-'))
    temporaryDirs.push(dir)
    const storage = new LocalFileStorage(dir)
    const absolute = join(tmpdir(), 'outside-image.jpg')

    for (const key of ['../outside-image.jpg', 'user/../../outside-image.jpg', absolute]) {
      await expect(storage.put(key, Buffer.from('escape'))).rejects.toThrow()
      await expect(storage.get(key)).rejects.toThrow()
      await expect(storage.remove(key)).rejects.toThrow()
    }
  })

  it('signs the exact key and expiry with lowercase HMAC-SHA256 and rejects tampering or expiry', () => {
    const key = 'user-id/image.jpg'
    const secret = 'fake-signing-secret'
    const exp = 1_800_000_000
    const url = signFileUrl(key, secret, 'http://localhost:3000/', 60)
    const parsed = new URL(url)
    const actualExp = parsed.searchParams.get('exp')!
    const actualSig = parsed.searchParams.get('sig')!

    expect(url).toMatch(/^http:\/\/localhost:3000\/files\/user-id\/image\.jpg\?exp=\d+&sig=[a-f0-9]{64}$/)
    expect(url).not.toContain('localhost:3000//files')
    expect(actualSig).toBe(
      createHmac('sha256', secret).update(`${key}${actualExp}`).digest('hex'),
    )
    expect(verifyFileUrl(key, actualExp, actualSig, secret, Number(actualExp) * 1000)).toBe(
      true,
    )
    expect(verifyFileUrl(key, actualExp, `${actualSig.slice(0, -1)}0`, secret)).toBe(false)
    expect(verifyFileUrl(key, actualExp, actualSig, secret, (Number(actualExp) + 1) * 1000)).toBe(
      false,
    )
    expect(verifyFileUrl(key, 'not-a-number', actualSig, secret)).toBe(false)
    expect(verifyFileUrl(key, exp, 'not-hex', secret)).toBe(false)
  })

  it('returns a signed normal URL for ok and pending images, but no URL for rejected images', () => {
    const config = viewConfig()
    const ok = toImageView(
      { id: 'ok-id', storage_key: 'user/ok.jpg', status: 'ok' },
      config,
    )
    const pending = toImageView(
      { id: 'pending-id', storage_key: 'user/pending.jpg', status: 'pending' },
      config,
    )
    const rejected = toImageView(
      { id: 'rejected-id', storage_key: 'user/rejected.jpg', status: 'rejected' },
      config,
    )

    expect(ok.status).toBe('ok')
    expect(pending.status).toBe('pending')
    expect(ok.url).not.toBeNull()
    expect(pending.url).not.toBeNull()
    expect(rejected).toEqual({ id: 'rejected-id', url: null, status: 'rejected' })

    for (const view of [ok, pending]) {
      const url = new URL(view.url!)
      const parsedTtl =
        Number(url.searchParams.get('exp')) - Math.floor(Date.now() / 1000)
      expect(parsedTtl).toBeGreaterThanOrEqual(ONE_HOUR_SECONDS - 1)
      expect(parsedTtl).toBeLessThanOrEqual(ONE_HOUR_SECONDS)
    }
  })
})
