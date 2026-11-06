import { request } from './client'
import type { Page, RecordInput, RecordView } from './types'

type ListRecordParams = {
  date?: string
  topicId?: string
  tag?: string
  q?: string
  starred?: boolean
  cursor?: string
  limit?: number
}

export async function listRecords(params: ListRecordParams = {}): Promise<Page<RecordView>> {
  return request<Page<RecordView>>('/records', {
    query: {
      date: params.date,
      topicId: params.topicId,
      tag: params.tag,
      q: params.q,
      starred: params.starred ? 1 : undefined,
      cursor: params.cursor,
      limit: params.limit,
    },
  })
}

export async function getRecord(id: string): Promise<RecordView> {
  return request<RecordView>(`/records/${encodeURIComponent(id)}`)
}

export async function createRecord(input: RecordInput): Promise<RecordView> {
  return request<RecordView>('/records', { method: 'POST', body: input })
}

export async function updateRecord(id: string, input: RecordInput): Promise<RecordView> {
  return request<RecordView>(`/records/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
  })
}

export async function deleteRecord(id: string): Promise<void> {
  await request<void>(`/records/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
