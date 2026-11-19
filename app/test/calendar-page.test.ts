// @ts-expect-error 测试运行在 Node 环境，但 uni 的 tsconfig 不包含 Node 类型
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageUrl = new URL('../src/pages/calendar/index.vue', import.meta.url)

describe('calendar page scrolling', () => {
  it('记录区有自己的滚动容器，加载更多不再由整页滚动触发', () => {
    const source = readFileSync(pageUrl, 'utf8')
    const outer = source.slice(
      source.indexOf('<scroll-view'),
      source.indexOf('<view class="calendar-inner"'),
    )

    expect(source).toContain('class="day-panel__scroll"')
    expect(source).toContain('@scrolltolower="loadMoreRecords"')
    expect(outer).not.toContain('@scrolltolower')
  })

  it('记录区与面板用 flex 撑满剩余高度', () => {
    const source = readFileSync(pageUrl, 'utf8')

    expect(source).toContain('.day-panel__scroll {')
    expect(source).toContain('flex: 1')
    expect(source).toContain("grid-template-rows: minmax(0, 1fr)")
  })

  it('窄屏退回整页滚动', () => {
    const source = readFileSync(pageUrl, 'utf8')
    const start = source.indexOf('@media (max-width: 840px)')
    const end = source.indexOf('@media (max-width: 699px)', start)
    const mobile = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(mobile).toMatch(/\.calendar-inner\s*\{\s*height: auto;/)
    expect(mobile).toMatch(/\.calendar-layout\s*\{\s*grid-template-rows: none;/)
    expect(mobile).toMatch(/\.day-panel__scroll\s*\{\s*height: auto;/)
  })
})