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

export async function getYears(): Promise<{ items: { year: string; count: number }[] }> {
  return request<{ items: { year: string; count: number }[] }>('/years')
}

export async function getYearMonths(
  year: string,
): Promise<{ items: { month: string; count: number }[] }> {
  return request<{ items: { month: string; count: number }[] }>('/year-months', {
    query: { year },
  })
}
