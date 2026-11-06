export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://192.168.8.16:3000'
export const TOKEN_KEY = 'wxdaily.token'
export const DRAFT_KEY_PREFIX = 'wxdaily.draft.'
export const COLORS = {
  primary: '#07c160',
  muted: '#8a8a8a',
  border: '#eeeeee',
  star: '#f0a020',
} as const
