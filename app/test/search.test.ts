import { describe, expect, it } from 'vitest'
import { parseSearchInput } from '../src/utils/search'

describe('parseSearchInput', () => {
  it('treats a whole hashtag as a tag filter', () => {
    expect(parseSearchInput('#投资')).toEqual({ tag: '投资' })
    expect(parseSearchInput('＃投资')).toEqual({ tag: '投资' })
  })

  it('keeps mixed text as a keyword query', () => {
    expect(parseSearchInput('投资 #新能源')).toEqual({ q: '投资 #新能源' })
  })

  it('treats only a hashes sign or whitespace as empty', () => {
    expect(parseSearchInput('#')).toEqual({})
    expect(parseSearchInput('   ')).toEqual({})
  })

  it('accepts underscores and digits in tag names', () => {
    expect(parseSearchInput('#a_b1')).toEqual({ tag: 'a_b1' })
  })
})
