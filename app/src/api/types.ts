export type Category = {
  id: string
  name: string
  sortOrder: number
}

export type TopicSummary = {
  id: string
  name: string
  categoryId: string | null
  recordCount: number
  starredCount: number
  lastRecordDate: string | null
}

export type TopicOverview = {
  categories: (Category & { topics: TopicSummary[] })[]
  uncategorized: TopicSummary[]
}

export type RecordExcerpt = {
  id: string
  quote: string
  thought: string
  starred: boolean
}

export type RecordImage = {
  id: string
  url: string | null
  status: 'ok' | 'pending' | 'rejected'
}

export type RecordView = {
  id: string
  topicId: string | null
  topic: { id: string; name: string } | null
  recordDate: string
  body: string
  links: string[]
  excerpts: RecordExcerpt[]
  images: RecordImage[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type RecordInput = {
  topicId: string | null
  recordDate: string
  body: string
  links: string[]
  excerpts: { quote: string; thought: string; starred: boolean }[]
  imageIds: string[]
}

export type StarredItem = {
  excerpt: { id: string; quote: string; thought: string; starred: true }
  record: {
    id: string
    recordDate: string
    topic: { id: string; name: string } | null
  }
}

export type CalendarDay = {
  date: string
  count: number
}

export type TagCount = {
  name: string
  count: number
}

export type Page<T> = {
  items: T[]
  nextCursor: string | null
}

export type RecordFilter = {
  date?: string
  year?: string
  month?: string
  topicId?: string
  tag?: string
  q?: string
  starred?: boolean
}
