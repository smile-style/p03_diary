import type { WechatClient } from '../auth/wechat-client.js'
import { AppError } from '../errors.js'

export interface ContentChecker {
  checkText(text: string, openid: string | null): Promise<'pass' | 'reject'>
  submitImage(
    url: string,
    openid: string | null,
  ): Promise<{ status: 'ok' } | { status: 'pending'; traceId: string }>
}

const CHECK_UNAVAILABLE_MESSAGE =
  '内容检查暂时不可用，内容已保留，请稍后再试'

const TEXT_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check'
const IMAGE_CHECK_URL = 'https://api.weixin.qq.com/wxa/media_check_async'
const TEXT_CHUNK_SIZE = 2500
const REQUEST_TIMEOUT_MS = 5000

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function checkUnavailable(): AppError {
  return new AppError(503, 'CHECK_UNAVAILABLE', CHECK_UNAVAILABLE_MESSAGE)
}

async function readJson(response: Response): Promise<JsonRecord> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw checkUnavailable()
  }

  if (!response.ok || !isRecord(body)) {
    throw checkUnavailable()
  }

  return body
}

export class PassThroughChecker implements ContentChecker {
  async checkText(
    _text: string,
    _openid: string | null,
  ): Promise<'pass'> {
    return 'pass'
  }

  async submitImage(
    _url: string,
    _openid: string | null,
  ): Promise<{ status: 'ok' }> {
    return { status: 'ok' }
  }
}

export class WechatChecker implements ContentChecker {
  constructor(
    private readonly wechat: WechatClient,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async checkText(
    text: string,
    openid: string | null,
  ): Promise<'pass' | 'reject'> {
    if (openid === null || text.length === 0) {
      return 'pass'
    }

    for (let offset = 0; offset < text.length; offset += TEXT_CHUNK_SIZE) {
      const content = text.slice(offset, offset + TEXT_CHUNK_SIZE)
      const suggestion = await this.checkTextChunk(content, openid)
      if (suggestion === 'reject') {
        return 'reject'
      }
    }

    return 'pass'
  }

  async submitImage(
    url: string,
    openid: string | null,
  ): Promise<{ status: 'ok' } | { status: 'pending'; traceId: string }> {
    if (openid === null) {
      return { status: 'ok' }
    }

    try {
      const token = await this.wechat.getAccessToken()
      const endpoint = new URL(IMAGE_CHECK_URL)
      endpoint.searchParams.set('access_token', token)

      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          media_url: url,
          media_type: 2,
          version: 2,
          scene: 4,
          openid,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const body = await readJson(response)

      if (body.errcode !== 0 || typeof body.errcode !== 'number') {
        throw checkUnavailable()
      }
      if (typeof body.trace_id !== 'string' || body.trace_id.length === 0) {
        throw checkUnavailable()
      }

      return { status: 'pending', traceId: body.trace_id }
    } catch {
      throw checkUnavailable()
    }
  }

  private async checkTextChunk(
    content: string,
    openid: string,
  ): Promise<'pass' | 'reject'> {
    try {
      const token = await this.wechat.getAccessToken()
      const endpoint = new URL(TEXT_CHECK_URL)
      endpoint.searchParams.set('access_token', token)

      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          version: 2,
          scene: 4,
          openid,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const body = await readJson(response)

      if (body.errcode === 87014) {
        return 'reject'
      }
      if (body.errcode !== 0 || typeof body.errcode !== 'number') {
        throw checkUnavailable()
      }
      if (!isRecord(body.result) || typeof body.result.suggest !== 'string') {
        throw checkUnavailable()
      }

      return body.result.suggest === 'risky' ? 'reject' : 'pass'
    } catch {
      throw checkUnavailable()
    }
  }
}