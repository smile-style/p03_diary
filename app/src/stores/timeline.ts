import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listRecords } from '../api/records'
import type { RecordFilter, RecordView } from '../api/types'

const PAGE_SIZE = 20

export const useTimelineStore = defineStore('timeline', () => {
  const items = ref<RecordView[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const filter = ref<RecordFilter>({})
  const lastLoadedAt = ref(0)
  let requestVersion = 0

  function messageOf(value: unknown): string {
    return value instanceof Error && value.message ? value.message : '加载失败'
  }

  async function reset(nextFilter: RecordFilter = filter.value): Promise<void> {
    const version = ++requestVersion
    filter.value = { ...nextFilter }
    items.value = []
    nextCursor.value = null
    error.value = null
    loading.value = true

    try {
      const page = await listRecords({ ...filter.value, limit: PAGE_SIZE })
      if (version !== requestVersion) return
      items.value = page.items
      nextCursor.value = page.nextCursor
      lastLoadedAt.value = Date.now()
    } catch (loadError) {
      if (version !== requestVersion) return
      error.value = messageOf(loadError)
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (loading.value || !nextCursor.value) return

    const version = requestVersion
    const cursor = nextCursor.value
    loading.value = true
    error.value = null

    try {
      const page = await listRecords({
        ...filter.value,
        cursor,
        limit: PAGE_SIZE,
      })
      if (version !== requestVersion) return
      const existingIds = new Set(items.value.map((item) => item.id))
      items.value.push(...page.items.filter((item) => !existingIds.has(item.id)))
      nextCursor.value = page.nextCursor
      lastLoadedAt.value = Date.now()
    } catch (loadError) {
      if (version === requestVersion) error.value = messageOf(loadError)
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  return {
    items,
    nextCursor,
    loading,
    error,
    filter,
    lastLoadedAt,
    reset,
    loadMore,
  }
})
