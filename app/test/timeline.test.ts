import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listRecords } from '../src/api/records'
import type { RecordView } from '../src/api/types'
import { useTimelineStore } from '../src/stores/timeline'

vi.mock('../src/api/records', () => ({
  listRecords: vi.fn(),
}))

function record(id: string): RecordView {
  return {
    id,
    topicId: null,
    topic: null,
    recordDate: '2026-11-06',
    body: id,
    links: [],
    excerpts: [],
    images: [],
    tags: [],
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  }
}

describe('timeline store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(listRecords).mockReset()
  })

  it('loads the first page with the current filter and a limit of 20', async () => {
    vi.mocked(listRecords).mockResolvedValueOnce({
      items: [record('a'), record('b')],
      nextCursor: 'next-page',
    })
    const store = useTimelineStore()

    await store.reset({ tag: '投资', starred: true })

    expect(listRecords).toHaveBeenCalledWith({
      tag: '投资',
      starred: true,
      limit: 20,
    })
    expect(store.items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(store.nextCursor).toBe('next-page')
    expect(store.lastLoadedAt).toBeGreaterThan(0)
  })

  it('appends the next page without duplicate records', async () => {
    vi.mocked(listRecords)
      .mockResolvedValueOnce({
        items: [record('a'), record('b')],
        nextCursor: 'next-page',
      })
      .mockResolvedValueOnce({
        items: [record('b'), record('c')],
        nextCursor: null,
      })
    const store = useTimelineStore()
    await store.reset({ topicId: 'topic-1' })

    await store.loadMore()

    expect(listRecords).toHaveBeenLastCalledWith({
      topicId: 'topic-1',
      cursor: 'next-page',
      limit: 20,
    })
    expect(store.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(store.nextCursor).toBeNull()
  })
})
