export function parseSearchInput(raw: string): { tag?: string; q?: string } {
  const value = raw.trim()
  if (!value || value === '#' || value === '＃') {
    return {}
  }

  const tagMatch = value.match(/^[#＃]([\p{L}\p{N}_]+)$/u)
  if (tagMatch) {
    return { tag: tagMatch[1] }
  }

  return { q: value }
}
