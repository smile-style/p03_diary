import { request } from './client'
import type { TopicOverview, TopicSummary } from './types'

type TopicResult = {
  id: string
  name: string
  categoryId: string | null
}

export async function getTopicOverview(): Promise<TopicOverview> {
  return request<TopicOverview>('/topics')
}

export async function getTopic(id: string): Promise<TopicSummary> {
  return request<TopicSummary>(`/topics/${encodeURIComponent(id)}`)
}

export async function createTopic(
  name: string,
  categoryId: string | null,
): Promise<TopicResult> {
  return request<TopicResult>('/topics', {
    method: 'POST',
    body: { name, categoryId },
  })
}

export async function updateTopic(
  id: string,
  changes: { name?: string; categoryId?: string | null },
): Promise<TopicResult> {
  return request<TopicResult>(`/topics/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: changes,
  })
}

export async function deleteTopic(id: string): Promise<void> {
  await request<void>(`/topics/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
