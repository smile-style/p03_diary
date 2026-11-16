import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn(),
    quit: vi.fn(),
  },
}))

process.env.WXDAILY_DESKTOP_NO_AUTOSTART = '1'
const { resolveWebRoot } = await import('../src/main.js')

describe('resolveWebRoot', () => {
  it('开发模式从编译产物定位仓库内的 H5', () => {
    const here = join('C:\\', 'repo', 'desktop', 'dist', 'desktop', 'src')
    expect(
      resolveWebRoot({
        isPackaged: false,
        resourcesPath: join('C:\\', 'resources'),
        here,
      }),
    ).toBe(join('C:\\', 'repo', 'app', 'dist', 'build', 'h5'))
  })

  it('打包模式使用 extraResources 中的 web 目录', () => {
    const resourcesPath = join('C:\\', 'Program Files', '生活记录', 'resources')
    expect(
      resolveWebRoot({
        isPackaged: true,
        resourcesPath,
        here: join('C:\\', 'unused'),
      }),
    ).toBe(join(resourcesPath, 'web'))
  })
})
