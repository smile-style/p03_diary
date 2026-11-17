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
})

describe('timeline page integration', () => {
  it('使用服务端年份与月份聚合，并按月分组请求后的记录', () => {
    const source = readFileSync(timelinePageUrl, 'utf8')

    expect(source).toContain("import YearAxis from '../../components/YearAxis.vue'")
    expect(source).toContain("import { getYearMonths, getYears } from '../../api/queries'")
    expect(source).toContain("import { groupByMonth } from '../../utils/timeline-groups'")
    expect(source).toContain('<YearAxis')
    expect(source).toContain(':items="years"')
    expect(source).toContain(':selected="selectedYear"')
    expect(source).toContain('@select="selectYear"')
    expect(source).toContain('const groups = computed(() => groupByMonth(timeline.items))')
    expect(source).toContain('{{ monthCount(group.month) }} 条')
    expect(source).toContain('<AppShell')
    expect(source).toContain('active="timeline"')
    expect(source).toContain('class="timeline-inner"')
  })

  it('月份切换重新走服务端列表请求，并在全部年份时禁止月份筛选', () => {
    const source = readFileSync(timelinePageUrl, 'utf8')
    const toggleMonthSource = source.slice(
      source.indexOf('async function toggleMonth'),
      source.indexOf('function currentFilterNoMonth'),
    )

    expect(toggleMonthSource).toContain('if (!selectedYear.value) return')
    expect(toggleMonthSource).toContain('await timeline.reset({')
    expect(toggleMonthSource).toContain('month,')
    expect(toggleMonthSource).not.toContain('timeline.items.filter')
  })
})
