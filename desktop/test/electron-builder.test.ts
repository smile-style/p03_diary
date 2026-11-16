import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Windows 安装包配置', () => {
  it('使用 NSIS、输出到 release，并携带 H5 静态资源', async () => {
    const yaml = await readFile(join(process.cwd(), 'electron-builder.yml'), 'utf8')

    expect(yaml).toContain('appId: com.wxdaily.desktop')
    expect(yaml).toContain('productName: 生活记录')
    expect(yaml).toContain('output: release')
    expect(yaml).toContain('target: nsis')
    expect(yaml).toContain('from: ../app/dist/build/h5')
    expect(yaml).toContain('to: web')
    expect(yaml).toContain('deleteAppDataOnUninstall: false')
  })

  it('dist 脚本先构建再生成 Windows 安装包', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts.dist).toBe(
      'pnpm run build && electron-builder --win --config electron-builder.yml',
    )
  })
})