import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loginLocal } from '../api/auth'
import { getToken, setToken } from '../api/client'
import { TOKEN_KEY } from '../config'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const ready = ref(false)
  const baseMessage = ref<string | null>(null)
  let sessionPromise: Promise<void> | null = null

  const storedToken = uni.getStorageSync(TOKEN_KEY)
  if (typeof storedToken === 'string' && storedToken) {
    token.value = storedToken
    setToken(storedToken)
  }

  async function performLogin(): Promise<void> {
    baseMessage.value = null

    try {
      const result = await loginLocal()
      token.value = result.token
      setToken(result.token)
      uni.setStorageSync(TOKEN_KEY, result.token)
    } catch (error) {
      token.value = null
      setToken(null)
      uni.removeStorageSync(TOKEN_KEY)
      baseMessage.value =
        error instanceof Error && error.message ? error.message : '登录失败'
    } finally {
      ready.value = true
    }
  }

  function ensureSession(): Promise<void> {
    if (ready.value) {
      return Promise.resolve()
    }
    if (sessionPromise) {
      return sessionPromise
    }

    sessionPromise = performLogin().finally(() => {
      sessionPromise = null
    })
    return sessionPromise
  }

  function logout(): void {
    uni.removeStorageSync(TOKEN_KEY)
    setToken(null)
    token.value = null
    ready.value = false
    baseMessage.value = null
    sessionPromise = null
  }

  return { token, ready, baseMessage, ensureSession, logout }
})