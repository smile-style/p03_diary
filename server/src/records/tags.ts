const TAG_PATTERN = /[#＃]([\p{L}\p{N}_]+)/gu

export function extractTags(texts: string[]): string[] {
  const tags: string[] = []
  const seen = new Set<string>()

  for (const text of texts) {
    for (const match of text.matchAll(TAG_PATTERN)) {
      const tag = match[1]
      if (tag !== undefined && !seen.has(tag)) {
        seen.add(tag)
        tags.push(tag)
      }
    }
  }

  return tags
}
