import { describe, expect, it } from 'vitest'
import type { TopicSummary } from '../src/api/types'
import {
  topicCategoryChoices,
  topicDeleteConfirmContent,
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

  it('explains that records are retained when deleting a non-empty topic', () => {
    expect(topicDeleteConfirmContent(topic())).toBe(
      '「投资」下的 12 条记录会保留，但不再归属任何主题。删除后无法恢复，确定删除吗？',
    )
  })

  it('uses the empty-topic confirmation when a topic has no records', () => {
    expect(topicDeleteConfirmContent(topic({ recordCount: 0 }))).toBe(
      '「投资」还没有记录。删除后无法恢复，确定删除吗？',
    )
  })

  it('uses only recordCount for the delete confirmation', () => {
    expect(
      topicDeleteConfirmContent(
        topic({ recordCount: 4, starredCount: 99, lastRecordDate: null }),
      ),
    ).toBe(
      '「投资」下的 4 条记录会保留，但不再归属任何主题。删除后无法恢复，确定删除吗？',
    )
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