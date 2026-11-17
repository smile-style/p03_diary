// @ts-expect-error 测试运行在 Node 环境，但 uni 的 tsconfig 不包含 Node 类型
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const componentUrl = new URL('../src/components/YearAxis.vue', import.meta.url)
const appUrl = new URL('../src/App.vue', import.meta.url)

describe('YearAxis', () => {
  it('始终渲染全部节点与年份节点，并提供横向滚动锚点', () => {
    const source = readFileSync(componentUrl, 'utf8')

    expect(source).toContain('scroll-view')
    expect(source).toContain('scroll-x')
    expect(source).toContain(':scroll-into-view="activeAnchor"')
    expect(source).toContain('scroll-with-animation')
    expect(source).toContain('id="year-all"')
    expect(source).toContain('全部')
    expect(source).toContain('v-for="item in items"')
  })

  it('选择全部时回传 null，并高亮当前年份节点', () => {
    const source = readFileSync(componentUrl, 'utf8')

    expect(source).toContain('selected: string | null')
    expect(source).toContain("emit('select', null)")
    expect(source).toContain("emit('select', item.year)")
    expect(source).toContain("props.selected === null ? 'year-all' : 'year-' + props.selected")
    expect(source).toContain('year-chip--active')
  })

  it('定义时间线轴的全局颜色变量', () => {
    const source = readFileSync(appUrl, 'utf8')

    expect(source).toContain('--color-timeline-axis: var(--color-accent);')
    expect(source).toContain('--color-timeline-line: var(--color-border);')
    expect(source).toContain('--color-accent: #9a3412;')
  })
})