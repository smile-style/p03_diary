import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getToken, setToken } from '../src/api/client'
import { TOKEN_KEY } from '../src/config'
import { useAuthStore } from '../src/stores/auth'

type CallbackOptions = {
  success?: (response: any) => void
  fail?: (error: any) => void
}

function installUni(options: {
  storedToken?: string
  requestToken?: string
  requestError?: { code: string; message: string }
}) {
  const storage = new Map<string, unknown>()
  if (options.storedToken) storage.set(TOKEN_KEY, options.storedToken)
  const request = vi.fn((requestOptions: CallbackOptions & any) => {
    requestOptions.success?.({
      statusCode: options.requestError ? 503 : 200,
      data: options.requestError
        ? { error: options.requestError }
        : { token: options.requestToken ?? 'local-token' },
    })
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
    getStorageSync,
    setStorageSync,
    removeStorageSync,
  })

  return {
    request,
    storage,
    getStorageSync,
    setStorageSync,
    removeStorageSync,
  }
}

describe('local desktop auth session', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setToken(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setToken(null)
  })

  it('requests /auth/local on first startup and stores the local token', async () => {
    const fake = installUni({ requestToken: 'local-token' })
    const store = useAuthStore()

    await store.ensureSession()

    expect(fake.request).toHaveBeenCalledOnce()
    expect(fake.request.mock.calls[0][0]).toMatchObject({
      url: '/auth/local',
      method: 'GET',
    })
    expect(fake.request.mock.calls[0][0].header.Authorization).toBeUndefined()
    expect(store.token).toBe('local-token')
    expect(store.ready).toBe(true)
    expect(getToken()).toBe('local-token')
    expect(fake.setStorageSync).toHaveBeenCalledWith(TOKEN_KEY, 'local-token')
  })

  it('refreshes and replaces an existing local token on startup', async () => {
    const fake = installUni({
      storedToken: 'stored-token',
      requestToken: 'refreshed-token',
    })
    const store = useAuthStore()

    await store.ensureSession()

    expect(fake.request).toHaveBeenCalledOnce()
    expect(store.token).toBe('refreshed-token')
    expect(getToken()).toBe('refreshed-token')
    expect(fake.storage.get(TOKEN_KEY)).toBe('refreshed-token')
  })

  it('finishes startup with a visible error when local login fails', async () => {
    installUni({
      requestError: { code: 'LOGIN_UNAVAILABLE', message: '登录服务暂不可用' },
    })
    const store = useAuthStore()

    await store.ensureSession()

    expect(store.ready).toBe(true)
    expect(store.token).toBeNull()
    expect(store.baseMessage).toBe('登录服务暂不可用')
    expect(getToken()).toBeNull()
  })

  it('logout clears local storage and the in-memory token', async () => {
    const fake = installUni({ storedToken: 'stored-token' })
    const store = useAuthStore()

    store.logout()

    expect(fake.storage.has(TOKEN_KEY)).toBe(false)
    expect(fake.removeStorageSync).toHaveBeenCalledWith(TOKEN_KEY)
    expect(store.token).toBeNull()
    expect(store.ready).toBe(false)
    expect(getToken()).toBeNull()
  })
})