import type { RecordInput } from '../api/types'
import type { EditorDraft } from './draft'

export function buildRecordInput(draft: EditorDraft): RecordInput {
  return {
    topicId: draft.topicId,
    recordDate: draft.recordDate,
    body: draft.body.trim(),
    excerpts: draft.excerpts
      .map((excerpt) => ({
        quote: excerpt.quote.trim(),
        thought: excerpt.thought.trim(),
        starred: excerpt.starred,
      }))
      .filter((excerpt) => excerpt.quote.length > 0),
    links: draft.links.map((link) => link.trim()).filter(Boolean),
    imageIds: [...new Set(draft.imageIds.map((id) => id.trim()).filter(Boolean))],
  }
}

export function validateDraft(draft: EditorDraft): string | null {
  const body = draft.body.trim()
  const excerpts = draft.excerpts
  const links = draft.links.map((link) => link.trim()).filter(Boolean)
  const imageIds = [...new Set(draft.imageIds.map((id) => id.trim()).filter(Boolean))]

  const hasExcerpt = excerpts.some((excerpt) => excerpt.quote.trim().length > 0)
  if (!body && !hasExcerpt && imageIds.length === 0) {
    return '记录不能为空'
  }
  if (body.length > 20000) {
    return '正文不能超过 20000 字'
  }
  if (excerpts.length > 50) {
    return '摘抄不能超过 50 条'
  }
  if (
    excerpts.some(
      (excerpt) =>
        excerpt.quote.trim().length > 5000 ||
        excerpt.thought.trim().length > 5000,
    )
  ) {
    return '每条摘抄的原文和想法不能超过 5000 字'
  }
  if (imageIds.length > 9) {
    return '图片不能超过 9 张'
  }
  if (links.length > 10) {
    return '链接不能超过 10 条'
  }
  if (links.some((link) => !/^https?:\/\/\S+$/i.test(link))) {
    return '链接必须是 http 或 https 地址'
  }
  return null
}
