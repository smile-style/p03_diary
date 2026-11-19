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
      'pnpm run build && pnpm run clean && electron-builder --win --config electron-builder.yml',
    )
  })
  it('dist 前先清理 release，避免残留目录导致文件锁失败', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts.dist).toContain('clean')
    expect(pkg.scripts.clean).toContain('release')
  })

  it('安装包文件名使用 ASCII，避免更新 URL 百分号编码', async () => {
    const yaml = await readFile(join(process.cwd(), 'electron-builder.yml'), 'utf8')

    expect(yaml).toContain('artifactName: wx-daily-setup-${version}.exe')
  })
  it('desktop 与 app 的版本号一致', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string
    }
    const appPkg = JSON.parse(
      await readFile(join(process.cwd(), '..', 'app', 'package.json'), 'utf8'),
    ) as { version: string }
    const manifest = JSON.parse(
      await readFile(join(process.cwd(), '..', 'app', 'src', 'manifest.json'), 'utf8'),
    ) as { versionName: string; versionCode: string }

    expect(pkg.version).toBe('0.2.2')
    expect(appPkg.version).toBe(pkg.version)
    expect(manifest.versionName).toBe(pkg.version)
    expect(manifest.versionCode).toBe('202')
  })

  it('配置了 GitHub Releases 发布渠道', async () => {
    const yaml = await readFile(join(process.cwd(), 'electron-builder.yml'), 'utf8')

    expect(yaml).toContain('publish:')
    expect(yaml).toContain('provider: github')
    expect(yaml).toContain('owner: smile-style')
    expect(yaml).toContain('repo: p03_diary')
  })

})
