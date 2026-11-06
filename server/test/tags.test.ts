import { describe, expect, it } from 'vitest'
import { extractTags } from '../src/records/tags.js'

describe('extractTags', () => {
  it.each([
    [['#十五五 和 #投资'], ['十五五', '投资']],
    [['＃投资，看好'], ['投资']],
    [['只有 # 号'], []],
    [['#投资 #投资'], ['投资']],
    [['#AI #ai'], ['AI', 'ai']],
    [['结尾#新能源'], ['新能源']],
    [['#one_2 #two-three #三'], ['one_2', 'two', '三']],
  ])('extractTags(%j) -> %j', (input, expected) => {
    expect(extractTags(input)).toEqual(expected)
  })

  it('de-duplicates in first-occurrence order across every supplied text', () => {
    expect(extractTags(['#乙 #甲', '文字 #甲 #丙 #乙'])).toEqual(['乙', '甲', '丙'])
  })
})
