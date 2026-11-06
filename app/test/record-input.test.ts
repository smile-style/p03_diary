import { describe, expect, it } from 'vitest'
import { buildRecordInput, validateDraft } from '../src/utils/record-input'
import type { EditorDraft } from '../src/utils/draft'

function draft(overrides: Partial<EditorDraft> = {}): EditorDraft {
  return {
    topicId: null,
    recordDate: '2026-11-06',
    body: '',
    excerpts: [],
    links: [],
    imageIds: [],
    ...overrides,
  }
}

describe('buildRecordInput', () => {
  it('trims body and thoughts, drops empty excerpts and links, and deduplicates images', () => {
    const input = buildRecordInput(
      draft({
        body: '  今天有想法  ',
        excerpts: [
          { quote: '  原文  ', thought: '  我的想法  ', starred: true },
          { quote: '   ', thought: '只有想法', starred: false },
          { quote: '第二段', thought: '   ', starred: false },
        ],
        links: [' https://example.com ', '', '   '],
        imageIds: ['image-1', 'image-2', 'image-1'],
      }),
    )

    expect(input).toEqual({
      topicId: null,
      recordDate: '2026-11-06',
      body: '今天有想法',
      excerpts: [
        { quote: '原文', thought: '我的想法', starred: true },
        { quote: '第二段', thought: '', starred: false },
      ],
      links: ['https://example.com'],
      imageIds: ['image-1', 'image-2'],
    })
  })
})

describe('validateDraft', () => {
  it('rejects a completely empty record', () => {
    expect(validateDraft(draft())).toContain('记录不能为空')
  })

  it('allows an excerpt when the body is blank', () => {
    expect(
      validateDraft(
        draft({
          excerpts: [{ quote: '摘抄内容', thought: '', starred: false }],
        }),
      ),
    ).toBeNull()
  })

  it('enforces body, excerpt, and image limits', () => {
    expect(validateDraft(draft({ body: 'x'.repeat(20001) }))).toContain('20000')
    expect(
      validateDraft(
        draft({
          excerpts: Array.from({ length: 51 }, (_, index) => ({
            quote: `quote-${index}`,
            thought: '',
            starred: false,
          })),
        }),
      ),
    ).toContain('50')
    expect(
      validateDraft(
        draft({
          body: '有正文',
          imageIds: Array.from({ length: 10 }, (_, index) => `image-${index}`),
        }),
      ),
    ).toContain('9')
  })

  it('rejects links that are not http or https URLs', () => {
    expect(validateDraft(draft({ body: '有正文', links: ['ftp://example.com'] }))).toContain(
      '链接',
    )
  })

  it('enforces link count and excerpt text limits', () => {
    expect(
      validateDraft(
        draft({
          body: '有正文',
          links: Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`),
        }),
      ),
    ).toContain('10')
    expect(
      validateDraft(
        draft({
          excerpts: [{ quote: 'x'.repeat(5001), thought: '', starred: false }],
        }),
      ),
    ).toContain('5000')
    expect(
      validateDraft(
        draft({
          excerpts: [{ quote: '原文', thought: 'x'.repeat(5001), starred: false }],
        }),
      ),
    ).toContain('5000')
  })
})
