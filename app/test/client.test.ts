import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  getToken,
  request,
  setToken,
} from '../src/api/client'

function respondWith(statusCode: number, data: unknown) {
  return vi.fn((options: any) => {
    options.success({ statusCode, data })
    return 1
  })
}

describe('request', () => {
  beforeEach(() => {
    setToken(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setToken(null)
  })

  it('injects the bearer token', async () => {
    setToken('abc')
    const requestMock = respondWith(200, { ok: true })
    vi.stubGlobal('uni', { request: requestMock })

    await request<{ ok: boolean }>('/records')

    expect(requestMock).toHaveBeenCalledOnce()
    expect(requestMock.mock.calls[0][0].header.Authorization).toBe(
      'Bearer abc',
    )
  })

  it('returns the parsed response body', async () => {
    vi.stubGlobal('uni', { request: respondWith(200, { items: [], nextCursor: null }) })

    const result = await request<{ items: unknown[]; nextCursor: null }>('/records')

    expect(result).toEqual({ items: [], nextCursor: null })
  })

  it('throws ApiError with the server message on a non-2xx response', async () => {
    vi.stubGlobal(
      'uni',
      {
        request: respondWith(422, {
          error: {
            code: 'CONTENT_REJECTED',
            message: '内容未通过安全检查，请修改后再保存',
          },
        }),
      },
    )

    const failure = request('/records', { method: 'POST', body: {} })

    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toMatchObject({
      code: 'CONTENT_REJECTED',
      status: 422,
      message: '内容未通过安全检查，请修改后再保存',
    })
  })

  it('clears the token and retries a 401 only once', async () => {
    setToken('expired')
    const requestMock = respondWith(401, {
      error: { code: 'UNAUTHORIZED', message: '登录已过期' },
    })
    vi.stubGlobal('uni', { request: requestMock })

    await expect(request('/records')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    })
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(getToken()).toBeNull()
  })

  it('omits undefined query values from the final URL', async () => {
    const requestMock = respondWith(200, { items: [], nextCursor: null })
    vi.stubGlobal('uni', { request: requestMock })

    await request('/records', {
      query: { date: '2026-11-06', tag: undefined },
    })

    expect(requestMock.mock.calls[0][0].url).toBe(
      'http://192.168.8.16:3000/records?date=2026-11-06',
    )
  })
})
