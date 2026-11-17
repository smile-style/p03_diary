function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function monthTitle(month: string): string {
  const [year, monthNumber] = month.split('-')
  return `${year}年${Number(monthNumber)}月`
}

export function calendarCountMap(
  days: { date: string; count: number }[],
): Record<string, number> {
  return Object.fromEntries(days.map((day) => [day.date, day.count]))
}
export function shiftMonth(month: string, delta: number): string {
  const [yearText, monthText] = month.split('-')
  const date = new Date(Number(yearText), Number(monthText) - 1 + delta, 1)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

export function calendarCells(month: string): { date: string; inMonth: boolean }[] {
  const [yearText, monthText] = month.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const firstDay = new Date(year, monthIndex, 1)
  const startDate = new Date(year, monthIndex, 1 - firstDay.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate() + index,
    )
    return {
      date: todayLocal(date),
      inMonth: date.getFullYear() === year && date.getMonth() === monthIndex,
    }
  })
}

export function formatDateLabel(date: string, today: string = todayLocal()): string {
  const [year, month, day] = date.split('-').map(Number)
  const label = `${month}月${day}日`
  return date.slice(0, 4) === today.slice(0, 4) ? label : `${year}年${label}`
}
export function formatFullDateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

export function dayChipParts(date: string): { day: string; month: string; year: string } {
  const [year, month, day] = date.split('-').map(Number)
  return { day: String(day), month: `${month}月`, year: String(year) }
}
