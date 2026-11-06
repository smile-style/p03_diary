import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WechatClient } from '../src/auth/wechat-client.js'
import type { Config } from '../src/config.js'
import { createChecker } from '../src/deps.js'
import { AppError } from '../src/errors.js'
import {
  PassThroughChecker,
  WechatChecker,
} from '../src/moderation/checker.js'

const unavailableMessage = '内容检查暂时不可用，内容已保留，请稍后再试'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(
  handler: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch
}

function fakeWechat(token = 'access-token'): WechatClient & {
  getAccessToken: ReturnType<typeof vi.fn<() => Promise<string>>>
} {
  return {
    code2Session: vi.fn(async () => ({ openid: 'unused' })),
    getAccessToken: vi.fn(async () => token),
  }
}

function testConfig(contentCheck: Config['contentCheck']): Config {
  return {
    port: 3000,
    databaseUrl: 'postgres://unused',
    jwtSecret: 'jwt-secret',
    fileUrlSecret: 'file-secret',
    wechatAppId: 'app-id',
    wechatSecret: 'wechat-secret',
    wechatPushToken: 'push-token',
    contentCheck,
    storageDir: './uploads',
    publicBaseUrl: 'http://localhost:3000',
  }
}

type CapturedRequest = {
  input: string | URL | Request
  init?: RequestInit
  url: URL
  body: unknown
}

function captureRequest(
  input: string | URL | Request,
  init?: RequestInit,
): CapturedRequest {
  return {
    input,
    init,
    url: new URL(String(input)),
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  }
}

async function expectCheckUnavailable(promise: Promise<unknown>): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(AppError)
  expect(error).toMatchObject({
    status: 503,
    code: 'CHECK_UNAVAILABLE',
    message: unavailableMessage,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WechatChecker.checkText', () => {
  it('checks 4000 characters in 2500-unit chunks and rejects a risky second chunk', async () => {
    const token = 'token +/=&'
    const wechat = fakeWechat(token)
    const text = `${'a'.repeat(2500)}${'b'.repeat(1500)}`
    const requests: CapturedRequest[] = []
    const fetchFn = fakeFetch(async (input, init) => {
      const request = captureRequest(input, init)
      requests.push(request)
      return jsonResponse({
        errcode: 0,
        errmsg: 'ok',
        result: { suggest: requests.length === 1 ? 'pass' : 'risky' },
      })
    })
    const checker = new WechatChecker(wechat, fetchFn)

    await expect(checker.checkText(text, 'openid-1')).resolves.toBe('reject')

    expect(wechat.getAccessToken).toHaveBeenCalledTimes(2)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.url.origin).toBe('https://api.weixin.qq.com')
      expect(request.url.pathname).toBe('/wxa/msg_sec_check')
      expect(request.url.searchParams.get('access_token')).toBe(token)
      expect(request.init?.method).toBe('POST')
      expect(request.init?.headers).toEqual({ 'content-type': 'application/json' })
      expect(request.init?.signal).toBeInstanceOf(AbortSignal)
      expect(request.body).toMatchObject({
        version: 2,
        scene: 4,
        openid: 'openid-1',
      })
    }
    expect(requests[0]!.body).toEqual({
      content: 'a'.repeat(2500),
      version: 2,
      scene: 4,
      openid: 'openid-1',
    })
    expect(requests[1]!.body).toEqual({
      content: 'b'.repeat(1500),
      version: 2,
      scene: 4,
      openid: 'openid-1',
    })
  })

  it('treats review as pass', async () => {
    const wechat = fakeWechat()
    const fetchFn = fakeFetch(async () =>
      jsonResponse({
        errcode: 0,
        errmsg: 'ok',
        result: { suggest: 'review' },
      }),
    )
    const checker = new WechatChecker(wechat, fetchFn)

    await expect(checker.checkText('content', 'openid-1')).resolves.toBe('pass')
  })

  it('does not call the token or fetch APIs for empty text', async () => {
    const wechat = fakeWechat()
    const fetchFn = fakeFetch(async () => jsonResponse({ errcode: 0 }))
    const checker = new WechatChecker(wechat, fetchFn)

    await expect(checker.checkText('', 'openid-1')).resolves.toBe('pass')
    expect(wechat.getAccessToken).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('preserves whitespace and does not trim request content', async () => {
    const wechat = fakeWechat()
    const requests: CapturedRequest[] = []
    const fetchFn = fakeFetch(async (input, init) => {
      requests.push(captureRequest(input, init))
      return jsonResponse({ errcode: 0, result: { suggest: 'pass' } })
    })
    const checker = new WechatChecker(wechat, fetchFn)

    await expect(checker.checkText('  content  ', 'openid-1')).resolves.toBe('pass')

    expect(requests[0]!.body).toEqual({
      content: '  content  ',
      version: 2,
      scene: 4,
      openid: 'openid-1',
    })
  })

  it('rejects errcode 87014', async () => {
    const wechat = fakeWechat()
    const fetchFn = fakeFetch(async () =>
      jsonResponse({ errcode: 87014, errmsg: 'risky content' }),
    )
    const checker = new WechatChecker(wechat, fetchFn)

    await expect(checker.checkText('content', 'openid-1')).resolves.toBe('reject')
  })
})

describe('WechatChecker failures', () => {
  it('maps a network failure to the exact 503 AppError', async () => {
    const checker = new WechatChecker(
      fakeWechat(),
      fakeFetch(async () => {
        throw new Error('network down')
      }),
    )

    await expectCheckUnavailable(checker.checkText('content', 'openid-1'))
  })

  it('maps an abort/timeout failure to the exact 503 AppError', async () => {
    const checker = new WechatChecker(
      fakeWechat(),
      fakeFetch(async () => {
        throw new DOMException('The operation timed out', 'TimeoutError')
      }),
    )

    await expectCheckUnavailable(checker.checkText('content', 'openid-1'))
  })

  it('maps a nonzero non-87014 errcode to the exact 503 AppError', async () => {
    const checker = new WechatChecker(
      fakeWechat(),
      fakeFetch(async () => jsonResponse({ errcode: -1, errmsg: 'system error' })),
    )

    await expectCheckUnavailable(checker.checkText('content', 'openid-1'))
  })

  it('maps malformed JSON to the exact 503 AppError', async () => {
    const checker = new WechatChecker(
      fakeWechat(),
      fakeFetch(async () =>
        new Response('{', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expectCheckUnavailable(checker.checkText('content', 'openid-1'))
  })

  it('maps a non-2xx response to the exact 503 AppError', async () => {
    const checker = new WechatChecker(
      fakeWechat(),
      fakeFetch(async () =>
        jsonResponse({ errcode: 0, result: { suggest: 'pass' } }, 500),
      ),
    )

    await expectCheckUnavailable(checker.checkText('content', 'openid-1'))
  })

  it('maps a missing successful text payload field to the exact 503 AppError', async () => {
    const checker = new WechatChecker(
      fakeWechat(),
      fakeFetch(async () => jsonResponse({ errcode: 0, errmsg: 'ok' })),
    )

    await expectCheckUnavailable(checker.checkText('content', 'openid-1'))
  })

  it('maps an access-token failure to the exact 503 AppError', async () => {
    const wechat = fakeWechat()
    wechat.getAccessToken.mockRejectedValueOnce(new Error('token unavailable'))
    const checker = new WechatChecker(wechat, fakeFetch(async () => jsonResponse({})))

    await expectCheckUnavailable(checker.checkText('content', 'openid-1'))
  })
})

describe('WechatChecker.submitImage', () => {
  it('posts the exact image payload and maps trace_id to a pending traceId', async () => {
    const token = 'image token+/=&'
    const wechat = fakeWechat(token)
    const requests: CapturedRequest[] = []
    const fetchFn = fakeFetch(async (input, init) => {
      requests.push(captureRequest(input, init))
      return jsonResponse({
        errcode: 0,
        errmsg: 'ok',
        trace_id: 'trace-123',
      })
    })
    const checker = new WechatChecker(wechat, fetchFn)

    await expect(
      checker.submitImage('https://example.com/image.jpg', 'openid-1'),
    ).resolves.toEqual({ status: 'pending', traceId: 'trace-123' })

    expect(wechat.getAccessToken).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const request = requests[0]!
    expect(request.url.origin).toBe('https://api.weixin.qq.com')
    expect(request.url.pathname).toBe('/wxa/media_check_async')
    expect(request.url.searchParams.get('access_token')).toBe(token)
    expect(request.init?.method).toBe('POST')
    expect(request.init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(request.init?.signal).toBeInstanceOf(AbortSignal)
    expect(request.body).toEqual({
      media_url: 'https://example.com/image.jpg',
      media_type: 2,
      version: 2,
      scene: 4,
      openid: 'openid-1',
    })
  })

  it('maps a missing trace_id to the exact 503 AppError', async () => {
    const checker = new WechatChecker(
      fakeWechat(),
      fakeFetch(async () => jsonResponse({ errcode: 0, errmsg: 'ok' })),
    )

    await expectCheckUnavailable(
      checker.submitImage('https://example.com/image.jpg', 'openid-1'),
    )
  })
})

describe('null openid bypasses WeChat checks', () => {
  it('passes text without requesting a token or fetching', async () => {
    const wechat = fakeWechat()
    const fetchFn = fakeFetch(async () => jsonResponse({ errcode: 0 }))
    const checker = new WechatChecker(wechat, fetchFn)

    await expect(checker.checkText('content', null)).resolves.toBe('pass')
    expect(wechat.getAccessToken).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('passes images without requesting a token or fetching', async () => {
    const wechat = fakeWechat()
    const fetchFn = fakeFetch(async () => jsonResponse({ errcode: 0 }))
    const checker = new WechatChecker(wechat, fetchFn)

    await expect(
      checker.submitImage('https://example.com/image.jpg', null),
    ).resolves.toEqual({ status: 'ok' })
    expect(wechat.getAccessToken).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('PassThroughChecker', () => {
  it('always passes text and images', async () => {
    const checker = new PassThroughChecker()

    await expect(checker.checkText('anything', 'openid-1')).resolves.toBe('pass')
    await expect(
      checker.submitImage('https://example.com/image.jpg', 'openid-1'),
    ).resolves.toEqual({ status: 'ok' })
  })
})

describe('createChecker', () => {
  it('selects PassThroughChecker when contentCheck is off', () => {
    const checker = createChecker(testConfig('off'), fakeWechat())

    expect(checker).toBeInstanceOf(PassThroughChecker)
  })

  it('selects WechatChecker when contentCheck is wechat', () => {
    const checker = createChecker(testConfig('wechat'), fakeWechat())

    expect(checker).toBeInstanceOf(WechatChecker)
  })
})