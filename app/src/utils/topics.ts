import type { TopicOverview, TopicSummary } from '../api/types'
import { formatDateLabel, todayLocal } from './date'

export function topicStatsLabel(
  topic: TopicSummary,
  today: string = todayLocal(),
): string {
  const latest = topic.lastRecordDate
    ? `最近更新 ${formatDateLabel(topic.lastRecordDate, today)}`
    : '暂无记录'
  return `${topic.recordCount} 条 · ★${topic.starredCount} · ${latest}`
}

export function topicCategoryChoices(
  overview: TopicOverview,
): { id: string | null; label: string }[] {
  return [
    { id: null, label: '未分类' },
    ...overview.categories.map((category) => ({
      id: category.id as string | null,
      label: category.name,
    })),
  ]
}