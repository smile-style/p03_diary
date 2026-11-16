import type { RecordView } from '../api/types'

export type TimelineGroup = {
  month: string
  label: string
  records: RecordView[]
}

export function groupByMonth(records: RecordView[]): TimelineGroup[] {
  const groups = new Map<string, RecordView[]>()

  for (const record of records) {
    const month = record.recordDate.slice(0, 7)
    const group = groups.get(month)

    if (group) {
      group.push(record)
    } else {
      groups.set(month, [record])
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, groupedRecords]) => ({
      month,
      label: `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`,
      records: groupedRecords,
    }))
}