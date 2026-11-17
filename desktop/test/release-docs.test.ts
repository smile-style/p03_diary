import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(process.cwd(), '..')
const guidePath = join(repoRoot, 'docs', 'release-guide.md')
const desktopDocPath = join(repoRoot, 'docs', 'windows-desktop.md')

describe('release documentation', () => {
  it('发布指南覆盖版本、构建、上传、匿名可读检查与真实更新验收', () => {
    const guide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : ''

    expect(guide).toContain('desktop/package.json')
    expect(guide).toContain('app/src/manifest.json')
    expect(guide).toContain('app/package.json')
    expect(guide).toContain('pnpm run build:h5')
    expect(guide).toContain('pnpm run dist')
    expect(guide).toContain('gh release create v0.2.1')
    expect(guide).toContain('latest.yml')
    expect(guide).toContain('releases/latest/download/latest.yml')
    expect(guide).toContain('返回 200')
    expect(guide).toContain('0.1.0')
    expect(guide).toContain('未验证')
  })

  it('桌面版文档说明更新入口、开发模式与手动覆盖安装', () => {
    const doc = readFileSync(desktopDocPath, 'utf8')

    expect(doc).toContain('## 应用更新')
    expect(doc).toContain('“我的”页面')
    expect(doc).toContain('开发模式')
    expect(doc).toContain('不会发起更新网络请求')
    expect(doc).toContain('GitHub Releases')
    expect(doc).toContain('手动下载')
    expect(doc).toContain('数据目录不受影响')
  })
})