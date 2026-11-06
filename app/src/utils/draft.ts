import { DRAFT_KEY_PREFIX } from '../config'

export type EditorDraft = {
  topicId: string | null
  recordDate: string
  body: string
  excerpts: { quote: string; thought: string; starred: boolean }[]
  links: string[]
  imageIds: string[]
}

export function draftKeyFor(recordId?: string): string {
  return recordId
    ? `${DRAFT_KEY_PREFIX}record.${recordId}`
    : `${DRAFT_KEY_PREFIX}new`
}

export function emptyDraft(today: string): EditorDraft {
  return {
    topicId: null,
    recordDate: today,
    body: '',
    excerpts: [],
    links: [],
    imageIds: [],
  }
}

export function saveDraft(key: string, draft: EditorDraft): void {
  uni.setStorageSync(key, JSON.stringify(draft))
}

export function loadDraft(key: string): EditorDraft | null {
  const raw = uni.getStorageSync(key)
  if (typeof raw !== 'string' || !raw) return null

  try {
    const parsed = JSON.parse(raw) as EditorDraft
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.excerpts)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearDraft(key: string): void {
  uni.removeStorageSync(key)
}
