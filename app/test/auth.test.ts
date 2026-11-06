import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getToken, setToken } from '../src/api/client'
import { loginWithWechat } from '../src/api/auth'
import { useAuthStore } from '../src/stores/auth'
import { TOKEN_KEY } from '../src/config'

type CallbackOptions = {
  success?: (response: any) => void
  fail?: (error: any) => void
}

function installUni(options: {
  storedToken?: string
  loginCode?: string
  requestToken?: string
}) {
  const storage = new Map<string, unknown>()
  if (options.storedToken) storage.set(TOKEN_KEY, options.storedToken)
  const request = vi.fn((requestOptions: CallbackOptions & any) => {
    requestOptions.success?.({
      statusCode: 200,
      data: { token: options.requestToken ?? 'jwt-token' },
    })
    return 1
  })
  const login = vi.fn((loginOptions: CallbackOptions & any) => {
    loginOptions.success?.({ code: options.loginCode ?? 'wx-code' })
    return 1
  })
  const getStorageSync = vi.fn((key: string) => storage.get(key) ?? '')
  const setStorageSync = vi.fn((key: string, value: unknown) => {
    storage.set(key, value)
  })
  const removeStorageSync = vi.fn((key: string) => {
    storage.delete(key)
  })

  vi.stubGlobal('uni', {
    request,
    login,
    getStorageSync,
    setStorageSync,
    removeStorageSync,
  })

  return { request, login, storage, getStorageSync, setStorageSync, removeStorageSync }
}

describe('wechat login session', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setToken(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setToken(null)
  })

  it('requests a token with the wechat login code and without auth', async () => {
    const { request } = installUni({})

    await expect(loginWithWechat('wx-code')).resolves.toEqual({ token: 'jwt-token' })

    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0]).toMatchObject({
      url: 'http://192.168.8.16:3000/auth/wechat',
      method: 'POST',
      data: { code: 'wx-code' },
    })
    expect(request.mock.calls[0][0].header.Authorization).toBeUndefined()
  })

  it('uses an existing stored token without logging in again', async () => {
    const fake = installUni({ storedToken: 'stored-token' })
    const store = useAuthStore()

    await store.ensureSession()

    expect(store.token).toBe('stored-token')
    expect(store.ready).toBe(true)
    expect(fake.login).not.toHaveBeenCalled()
    expect(fake.request).not.toHaveBeenCalled()
    expect(getToken()).toBe('stored-token')
  })

  it('logs in once when ensureSession is called concurrently', async () => {
    const fake = installUni({ loginCode: 'wx-code', requestToken: 'new-token' })
    const store = useAuthStore()

    await Promise.all([store.ensureSession(), store.ensureSession()])

    expect(fake.login).toHaveBeenCalledOnce()
    expect(fake.request).toHaveBeenCalledOnce()
    expect(store.token).toBe('new-token')
    expect(store.ready).toBe(true)
    expect(fake.setStorageSync).toHaveBeenCalledWith(TOKEN_KEY, 'new-token')
  })

  it('finishes startup with a visible error when login fails', async () => {
    const storage = new Map<string, unknown>()
    const request = vi.fn((requestOptions: CallbackOptions & any) => {
      requestOptions.success?.({
        statusCode: 503,
        data: { error: { code: 'LOGIN_UNAVAILABLE', message: '登录服务暂不可用' } },
      })
      return 1
    })
    vi.stubGlobal('uni', {
      request,
      login: vi.fn((loginOptions: CallbackOptions & any) => {
        loginOptions.success?.({ code: 'wx-code' })
        return 1
      }),
      getStorageSync: vi.fn((key: string) => storage.get(key) ?? ''),
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    })
    const store = useAuthStore()

    await store.ensureSession()

    expect(store.ready).toBe(true)
    expect(store.token).toBeNull()
    expect(store.baseMessage).toBe('登录服务暂不可用')
  })
})
