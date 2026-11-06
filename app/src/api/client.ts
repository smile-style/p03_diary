import { API_BASE_URL } from '../config'

export class ApiError extends Error {
  code: string
  status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type RequestOptions = {
  method?: RequestMethod
  body?: unknown
  query?: Record<string, string | number | undefined>
  auth?: boolean
}

let token: string | null = null

export function setToken(nextToken: string | null): void {
  token = nextToken
}

export function getToken(): string | null {
  return token
}

function buildUrl(
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const base = API_BASE_URL.replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const pairs = Object.entries(query ?? {}).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  )
  const search = pairs
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&')
  return `${base}${normalizedPath}${search ? `?${search}` : ''}`
}

function errorFromResponse(status: number, data: unknown): ApiError {
  const error =
    typeof data === 'object' && data !== null && 'error' in data
      ? (data as { error?: { code?: unknown; message?: unknown } }).error
      : undefined
  const code =
    typeof error?.code === 'string' ? error.code : `HTTP_${status}`
  const message =
    typeof error?.message === 'string'
      ? error.message
      : `请求失败（${status}）`
  return new ApiError(status, code, message)
}

function requestOnce<T>(
  path: string,
  options: RequestOptions,
): Promise<{ status: number; data: T }> {
  const method = options.method ?? 'GET'
  const header: Record<string, string> = {}
  if (options.auth !== false && token) {
    header.Authorization = `Bearer ${token}`
  }

  return new Promise((resolve, reject) => {
    uni.request({
      url: buildUrl(path, options.query),
      method: method as any,
      data: options.body as any,
      header,
      success: (response) => {
        resolve({
          status: response.statusCode,
          data: response.data as T,
        })
      },
      fail: (error) => {
        reject(new Error(error.errMsg || '网络请求失败'))
      },
    })
  })
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const first = await requestOnce<T>(path, options)
  if (first.status === 401 && getToken() !== null) {
    setToken(null)
    const retried = await requestOnce<T>(path, options)
    if (retried.status >= 200 && retried.status < 300) {
      return retried.data
    }
    throw errorFromResponse(retried.status, retried.data)
  }

  if (first.status >= 200 && first.status < 300) {
    return first.data
  }
  throw errorFromResponse(first.status, first.data)
}

type UploadResponse = {
  id: string
  url: string | null
  status: string
}

function parseUploadBody(data: unknown): UploadResponse {
  if (typeof data !== 'string') {
    return data as UploadResponse
  }
  try {
    return JSON.parse(data) as UploadResponse
  } catch {
    throw new Error('上传响应格式错误')
  }
}

function uploadOnce(
  filePath: string,
): Promise<{ status: number; data: unknown }> {
  const header: Record<string, string> = {}
  if (token) {
    header.Authorization = `Bearer ${token}`
  }

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: buildUrl('/images'),
      filePath,
      name: 'file',
      header,
      success: (response) =>
        resolve({ status: response.statusCode, data: response.data }),
      fail: (error) =>
        reject(new Error(error.errMsg || '图片上传失败')),
    })
  })
}

export async function uploadImage(filePath: string): Promise<UploadResponse> {
  const first = await uploadOnce(filePath)
  if (first.status === 401 && getToken() !== null) {
    setToken(null)
    const retried = await uploadOnce(filePath)
    if (retried.status >= 200 && retried.status < 300) {
      return parseUploadBody(retried.data)
    }
    throw errorFromResponse(retried.status, parseMaybeJson(retried.data))
  }

  if (first.status >= 200 && first.status < 300) {
    return parseUploadBody(first.data)
  }
  throw errorFromResponse(first.status, parseMaybeJson(first.data))
}

function parseMaybeJson(data: unknown): unknown {
  if (typeof data !== 'string') {
    return data
  }
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}
