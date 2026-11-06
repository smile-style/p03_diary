import { AppError } from '../errors.js'

export interface WechatClient {
  code2Session(code: string): Promise<{ openid: string }>
  getAccessToken(): Promise<string>
}

type WechatJson = Record<string, unknown>

function isRecord(value: unknown): value is WechatJson {
  return typeof value === 'object' && value !== null
}

function unauthorized() {
  return new AppError(
    401,
    'UNAUTHORIZED',
    '登录失败，请重试',
  )
}

function serviceUnavailable() {
  return new AppError(
    503,
    'CHECK_UNAVAILABLE',
    '微信服务暂不可用',
  )
}

export class HttpWechatClient implements WechatClient {
  private cachedAccessToken: { value: string; expiresAt: number } | undefined

  constructor(
    private readonly appId: string,
    private readonly secret: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async code2Session(code: string): Promise<{ openid: string }> {
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
    url.searchParams.set('appid', this.appId)
    url.searchParams.set('secret', this.secret)
    url.searchParams.set('js_code', code)
    url.searchParams.set('grant_type', 'authorization_code')

    const response = await this.fetchFn(url)
    const body: unknown = await response.json().catch(() => ({}))

    if (
      !response.ok ||
      !isRecord(body) ||
      (typeof body.errcode === 'number' && body.errcode !== 0) ||
      typeof body.openid !== 'string' ||
      body.openid.length === 0
    ) {
      throw unauthorized()
    }

    return { openid: body.openid }
  }

  async getAccessToken(): Promise<string> {
    if (
      this.cachedAccessToken &&
      Date.now() < this.cachedAccessToken.expiresAt
    ) {
      return this.cachedAccessToken.value
    }

    const response = await this.fetchFn(
      'https://api.weixin.qq.com/cgi-bin/stable_token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credential',
          appid: this.appId,
          secret: this.secret,
        }),
      },
    )
    const body: unknown = await response.json().catch(() => ({}))

    if (
      !response.ok ||
      !isRecord(body) ||
      (typeof body.errcode === 'number' && body.errcode !== 0) ||
      typeof body.access_token !== 'string' ||
      body.access_token.length === 0 ||
      typeof body.expires_in !== 'number' ||
      body.expires_in <= 0
    ) {
      throw serviceUnavailable()
    }

    const cacheSeconds = Math.max(0, body.expires_in - 300)
    this.cachedAccessToken = {
      value: body.access_token,
      expiresAt: Date.now() + cacheSeconds * 1000,
    }

    return body.access_token
  }
}
