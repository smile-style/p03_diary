import type { RecordView } from '../api/types'

export function previewableImageUrls(
  record: Pick<RecordView, 'images'>,
): string[] {
  return record.images
    .filter((image) => image.status === 'ok' && Boolean(image.url))
    .map((image) => image.url as string)
}

export function topicLabel(topic: RecordView['topic']): string {
  return topic?.name ?? '未分类'
}

export function copyableLinks(record: Pick<RecordView, 'links'>): string[] {
  return record.links.map((link) => link.trim()).filter(Boolean)
}