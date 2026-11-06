import { describe, expect, it } from 'vitest'
import type { RecordView } from '../src/api/types'
import {
  copyableLinks,
  previewableImageUrls,
  topicLabel,
} from '../src/utils/record-display'

function record(overrides: Partial<RecordView> = {}): RecordView {
  return {
    id: 'record-1',
    topicId: null,
    topic: null,
    recordDate: '2026-11-07',
    body: '正文',
    links: [],
    excerpts: [],
    images: [],
    tags: [],
    createdAt: '2026-11-07T00:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
    ...overrides,
  }
}

describe('record detail display helpers', () => {
  it('returns only previewable image URLs in record order', () => {
    expect(
      previewableImageUrls(
        record({
          images: [
            { id: '1', url: 'https://example.com/1.jpg', status: 'ok' },
            { id: '2', url: null, status: 'pending' },
            { id: '3', url: 'https://example.com/3.jpg', status: 'rejected' },
            { id: '4', url: 'https://example.com/4.jpg', status: 'ok' },
          ],
        }),
      ),
    ).toEqual(['https://example.com/1.jpg', 'https://example.com/4.jpg'])
  })

  it('returns a readable topic label', () => {
    expect(topicLabel({ id: 'topic-1', name: '投资' })).toBe('投资')
    expect(topicLabel(null)).toBe('未分类')
  })

  it('trims and drops empty links before copying', () => {
    expect(copyableLinks(record({ links: [' https://example.com ', '', '   '] }))).toEqual([
      'https://example.com',
    ])
  })
})