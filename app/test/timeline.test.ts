// @ts-expect-error 测试运行在 Node 环境，但 uni 的 tsconfig 不包含 Node 类型
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listRecords } from '../src/api/records'
import type { RecordView } from '../src/api/types'
import { useTimelineStore } from '../src/stores/timeline'

vi.mock('../src/api/records', () => ({
  listRecords: vi.fn(),
}))

const timelinePageUrl = new URL('../src/pages/timeline/index.vue', import.meta.url)

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
  it('把年份透传到列表请求', async () => {
    vi.mocked(listRecords).mockResolvedValueOnce({ items: [], nextCursor: null })
    const store = useTimelineStore()

    await store.reset({ year: '2025' })

    expect(listRecords).toHaveBeenCalledWith({ year: '2025', limit: 20 })
    expect(store.filter.year).toBe('2025')
  })

  it('把月份透传到列表请求', async () => {
    vi.mocked(listRecords).mockResolvedValueOnce({ items: [], nextCursor: null })
    const store = useTimelineStore()

    await store.reset({ month: '2025-07' })

    expect(listRecords).toHaveBeenCalledWith({ month: '2025-07', limit: 20 })
    expect(store.filter.month).toBe('2025-07')
  })

  it('把日期透传到列表请求', async () => {
    vi.mocked(listRecords).mockResolvedValueOnce({ items: [], nextCursor: null })
    const store = useTimelineStore()

    await store.reset({ date: '2026-11-16' })

    expect(listRecords).toHaveBeenCalledWith({ date: '2026-11-16', limit: 20 })
    expect(store.filter.date).toBe('2026-11-16')
  })
})

describe('timeline page integration', () => {
  it('用日粒度时间轴选择日期，请求只按 date 过滤', () => {
    const source = readFileSync(timelinePageUrl, 'utf8')

    expect(source).toContain("import DayAxis from '../../components/DayAxis.vue'")
    expect(source).toContain("import { getRecordDays } from '../../api/queries'")
    expect(source).toContain("import { formatFullDateLabel } from '../../utils/date'")
    expect(source).toContain('<DayAxis')
    expect(source).toContain(':items="days"')
    expect(source).toContain(':selected="selectedDate"')
    expect(source).toContain('@select="selectDay"')
    expect(source).toContain('async function selectDay')
    expect(source).toContain('timeline.reset({ date })')
    expect(source).not.toContain('YearAxis')
    expect(source).not.toContain('groupByMonth')
    expect(source).not.toContain('month-group')
  })

  it('搜索与选日互斥：点日期清空搜索，搜索时清空选中日期', () => {
    const source = readFileSync(timelinePageUrl, 'utf8')
    const selectDaySource = source.slice(
      source.indexOf('async function selectDay'),
      source.indexOf('async function submitSearch'),
    )
    const submitSearchSource = source.slice(
      source.indexOf('async function submitSearch'),
      source.indexOf('async function clearSearch'),
    )

    expect(selectDaySource).toContain('activeSearch.value = null')
    expect(selectDaySource).toContain("searchText.value = ''")
    expect(selectDaySource).toContain('selectedDate.value = date')
    expect(submitSearchSource).toContain('selectedDate.value = null')
  })

  it('没有记录时不发带空值的 date 过滤', () => {
    const source = readFileSync(timelinePageUrl, 'utf8')
    const filterSource = source.slice(
      source.indexOf('function currentFilter'),
      source.indexOf('onShow(async'),
    )

    expect(filterSource).toContain('if (selectedDate.value)')
    expect(filterSource).not.toContain("date: ''")
  })
})
