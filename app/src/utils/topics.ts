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

export function topicDeleteConfirmContent(
  topic: Pick<TopicSummary, 'name' | 'recordCount'>,
): string {
  if (topic.recordCount > 0) {
    return `「${topic.name}」下的 ${topic.recordCount} 条记录会保留，但不再归属任何主题。删除后无法恢复，确定删除吗？`
  }
  return `「${topic.name}」还没有记录。删除后无法恢复，确定删除吗？`
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