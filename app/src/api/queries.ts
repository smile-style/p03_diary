import { request } from './client'
import type { CalendarDay, Page, StarredItem, TagCount } from './types'

export async function getCalendar(month: string): Promise<{ days: CalendarDay[] }> {
  return request<{ days: CalendarDay[] }>('/calendar', {
    query: { month },
  })
}

export async function getTags(): Promise<{ items: TagCount[] }> {
  return request<{ items: TagCount[] }>('/tags')
}

export async function getStarredExcerpts(
  params: { cursor?: string; limit?: number } = {},
): Promise<Page<StarredItem>> {
  return request<Page<StarredItem>>('/excerpts/starred', {
    query: { cursor: params.cursor, limit: params.limit },
  })
}
