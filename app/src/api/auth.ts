import { request } from './client'

export async function loginLocal(): Promise<{ token: string }> {
  return request<{ token: string }>('/auth/local', { auth: false })
}