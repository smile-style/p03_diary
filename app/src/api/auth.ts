import { request } from './client'

export async function loginWithWechat(code: string): Promise<{ token: string }> {
  return request<{ token: string }>('/auth/wechat', {
    method: 'POST',
    body: { code },
    auth: false,
  })
}
