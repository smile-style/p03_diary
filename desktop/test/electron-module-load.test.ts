import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('打包后 ESM 模块加载', () => {
  it('更新模块使用 CommonJS 兼容的 electron-updater 默认导入', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'update.ts'), 'utf8')

    expect(source).toContain("import electronUpdater from 'electron-updater'")
    expect(source).toContain('function getAutoUpdater()')
    expect(source).toContain('return electronUpdater.autoUpdater')
    expect(source).not.toContain("import { autoUpdater } from 'electron-updater'")
  })
})
