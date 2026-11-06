import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDraft,
  draftKeyFor,
  emptyDraft,
  loadDraft,
  saveDraft,
  type EditorDraft,
} from '../src/utils/draft'

const storage = new Map<string, unknown>()

describe('draft storage', () => {
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('uni', {
      setStorageSync: vi.fn((key: string, value: unknown) => storage.set(key, value)),
      getStorageSync: vi.fn((key: string) => storage.get(key) ?? ''),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds stable new and edit draft keys', () => {
    expect(draftKeyFor()).toBe('wxdaily.draft.new')
    expect(draftKeyFor('record-1')).toBe('wxdaily.draft.record.record-1')
  })

  it('creates an empty draft for the given date', () => {
    expect(emptyDraft('2026-11-06')).toEqual({
      topicId: null,
      recordDate: '2026-11-06',
      body: '',
      excerpts: [],
      links: [],
      imageIds: [],
    })
  })

  it('saves, restores, and clears a draft', () => {
    const value: EditorDraft = {
      topicId: 'topic-1',
      recordDate: '2026-11-06',
      body: '正文',
      excerpts: [{ quote: '原文', thought: '想法', starred: true }],
      links: ['https://example.com'],
      imageIds: ['image-1'],
    }

    saveDraft('draft-key', value)
    expect(loadDraft('draft-key')).toEqual(value)

    clearDraft('draft-key')
    expect(loadDraft('draft-key')).toBeNull()
  })

  it('returns null for corrupted persisted JSON', () => {
    storage.set('broken', '{not-json')

    expect(loadDraft('broken')).toBeNull()
  })
})
