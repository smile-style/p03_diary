// @ts-expect-error 测试运行在 Node 环境，但 uni 的 tsconfig 不包含 Node 类型
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageUrl = new URL('../src/pages/mine/index.vue', import.meta.url)

describe('mine update card', () => {
  it('挂载时先拉取缓存状态，再订阅后续更新事件', () => {
    const source = readFileSync(pageUrl, 'utf8')
    const mounted = source.slice(
      source.indexOf('onMounted(async'),
      source.indexOf('onUnmounted(() => {'),
    )
    const installed = source.indexOf("bridge?.update?.install?.()")

    expect(source).toContain('type UpdateState =')
    expect(source).toContain('const appVersion = ref(manifest.versionName)')
    expect(mounted).toContain('bridge.update?.getState')
    expect(mounted).toContain('bridge.update?.onState')
    expect(mounted.indexOf('getState')).toBeLessThan(mounted.indexOf('onState'))
    expect(source).toContain("name: 'check' | 'download'")
    expect(installed).toBeGreaterThan(-1)
  })

  it('渲染检查、下载、重启安装以及错误和进度状态', () => {
    const source = readFileSync(pageUrl, 'utf8')

    expect(source).toContain('应用更新')
    expect(source).toContain('当前 v{{ appVersion }}')
    expect(source).toContain("updateState.kind === 'checking'")
    expect(source).toContain("updateState.kind === 'available'")
    expect(source).toContain("updateState.kind === 'downloading'")
    expect(source).toContain("updateState.kind === 'downloaded'")
    expect(source).toContain("updateState.kind === 'error'")
    expect(source).toContain('立即更新')
    expect(source).toContain('立即重启')
    expect(source).toContain('打开数据文件夹')
    expect(source.indexOf('应用更新')).toBeLessThan(source.indexOf('打开数据文件夹'))
  })

  it('使用现有设计变量提供更新卡片样式', () => {
    const source = readFileSync(pageUrl, 'utf8')
    expect(source).toContain('.update-card__error {')
    expect(source).toContain('.progress-track {')
    expect(source).toContain('.setting-item {')
  })
})
