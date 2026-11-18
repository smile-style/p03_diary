// @ts-expect-error 测试运行在 Node 环境，但 uni 的 tsconfig 不包含 Node 类型
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const componentUrl = new URL('../src/components/DayAxis.vue', import.meta.url)

describe('DayAxis', () => {
  it('用横向 scroll-view 承载日期，并保留选中项滚入可视区的锚点', () => {
    const source = readFileSync(componentUrl, 'utf8')

    expect(source).toContain('scroll-x')
    expect(source).toContain(':scroll-into-view="activeAnchor"')
    expect(source).toContain('scroll-with-animation')
    expect(source).toContain("'day-' + node.date")
    expect(source).toContain('v-for="node in nodes"')
  })

  it('点日期只回传日期，并高亮选中项', () => {
    const source = readFileSync(componentUrl, 'utf8')

    expect(source).toContain('selected: string | null')
    expect(source).toContain("emit('select', node.date)")
    expect(source).toContain('day-chip--active')
    expect(source).not.toContain('全部')
  })

  it('跨年时插入年份标记', () => {
    const source = readFileSync(componentUrl, 'utf8')

    expect(source).toContain("type: 'year'")
    expect(source).toContain('day-axis__year')
  })
})