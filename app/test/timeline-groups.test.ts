import { describe, expect, it } from 'vitest'
import type { RecordView } from '../src/api/types'
import { groupByMonth } from '../src/utils/timeline-groups'

function record(id: string, recordDate: string): RecordView {
  return {
    id,
    topicId: null,
    topic: null,
    recordDate,
    body: id,
    links: [],
    excerpts: [],
    images: [],
    tags: [],
    createdAt: `${recordDate}T00:00:00.000Z`,
    updatedAt: `${recordDate}T00:00:00.000Z`,
  }
}

describe('groupByMonth', () => {
  it('按月份分组，组间倒序，组内保持原顺序', () => {
    const groups = groupByMonth([
      record('a', '2026-05-12'),
      record('b', '2026-05-11'),
      record('c', '2026-04-30'),
      record('d', '2025-12-01'),
    ])

    expect(groups.map((group) => group.month)).toEqual(['2026-05', '2026-04', '2025-12'])
    expect(groups[0].records.map((item) => item.id)).toEqual(['a', 'b'])
    expect(groups[1].records.map((item) => item.id)).toEqual(['c'])
  })

  it('label 使用「YYYY年M月」且月份不补零', () => {
    const groups = groupByMonth([record('a', '2026-01-05'), record('b', '2026-10-05')])

    expect(groups.map((group) => group.label)).toEqual(['2026年10月', '2026年1月'])
  })

  it('空数组返回空数组', () => {
    expect(groupByMonth([])).toEqual([])
  })
})