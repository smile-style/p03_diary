import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpWechatClient } from '../src/auth/wechat-client.js'
import { AppError } from '../src/errors.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch
}

afterEach(() => {
  vi.useRealTimers()
})

describe('HttpWechatClient', () => {
  it('code2Session uses jscode2session with the app credentials and code', async () => {
    const fetchFn = fakeFetch(async (input, init) => {
      const url = new URL(String(input))
      expect(`${url.origin}${url.pathname}`).toBe('https://api.weixin.qq.com/sns/jscode2session')
      expect(url.searchParams.get('appid')).toBe('app-id')
      expect(url.searchParams.get('secret')).toBe('app-secret')
      expect(url.searchParams.get('js_code')).toBe('code with spaces')
      expect(url.searchParams.get('grant_type')).toBe('authorization_code')
      expect(init?.method ?? 'GET').toBe('GET')
      return jsonResponse({ openid: 'openid-1', session_key: 'session-key' })
    })
    const client = new HttpWechatClient('app-id', 'app-secret', fetchFn)

    await expect(client.code2Session('code with spaces')).resolves.toEqual({
      openid: 'openid-1',
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('code2Session maps a WeChat errcode to a 401 UNAUTHORIZED error', async () => {
    const fetchFn = fakeFetch(async () =>
      jsonResponse({ errcode: 40029, errmsg: 'invalid code' }),
    )
    const client = new HttpWechatClient('app-id', 'app-secret', fetchFn)

    const error = await client.code2Session('bad-code').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  })

  it('getAccessToken caches until expires_in minus five minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T00:00:00Z'))
    let tokenCalls = 0
    const fetchFn = fakeFetch(async (input, init) => {
      const url = new URL(String(input))
      expect(`${url.origin}${url.pathname}`).toBe('https://api.weixin.qq.com/cgi-bin/stable_token')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        grant_type: 'client_credential',
        appid: 'app-id',
        secret: 'app-secret',
      })
      tokenCalls += 1
      return jsonResponse({ access_token: `token-${tokenCalls}`, expires_in: 600 })
    })
    const client = new HttpWechatClient('app-id', 'app-secret', fetchFn)

    await expect(client.getAccessToken()).resolves.toBe('token-1')
    await expect(client.getAccessToken()).resolves.toBe('token-1')
    expect(fetchFn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(301_000)

    await expect(client.getAccessToken()).resolves.toBe('token-2')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
