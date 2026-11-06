import { describe, expect, it } from 'vitest'
import type { TopicSummary } from '../src/api/types'
import {
  topicCategoryChoices,
  topicStatsLabel,
} from '../src/utils/topics'

function topic(overrides: Partial<TopicSummary> = {}): TopicSummary {
  return {
    id: 'topic-1',
    name: '投资',
    categoryId: null,
    recordCount: 12,
    starredCount: 3,
    lastRecordDate: '2026-11-06',
    ...overrides,
  }
}

describe('topic display helpers', () => {
  it('formats topic statistics with the latest record date', () => {
    expect(topicStatsLabel(topic(), '2026-11-07')).toBe(
      '12 条 · ★3 · 最近更新 11月6日',
    )
  })

  it('shows an empty hint when a topic has no records', () => {
    expect(
      topicStatsLabel(topic({ recordCount: 0, starredCount: 0, lastRecordDate: null })),
    ).toBe('0 条 · ★0 · 暂无记录')
  })

  it('builds category choices with an uncategorized option', () => {
    expect(
      topicCategoryChoices({
        categories: [
          { id: 'category-1', name: '生活', sortOrder: 1, topics: [] },
          { id: 'category-2', name: '工作', sortOrder: 2, topics: [] },
        ],
        uncategorized: [],
      }),
    ).toEqual([
      { id: null, label: '未分类' },
      { id: 'category-1', label: '生活' },
      { id: 'category-2', label: '工作' },
    ])
  })
})