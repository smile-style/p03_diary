import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))
vi.mock('electron-updater', () => {
  const autoUpdater = {
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    autoDownload: true,
    autoInstallOnAppQuit: true,
  }

  return { autoUpdater, default: { autoUpdater } }
})

const { autoUpdaterQuitAndInstall, mapUpdaterEvent, registerUpdateIpc, startSilentCheck } =
  await import('../src/update.js')

describe('mapUpdaterEvent', () => {
  it('checking-for-update 映射为 checking', () => {
    expect(mapUpdaterEvent('checking-for-update', {}, { kind: 'idle' })).toEqual({ kind: 'checking' })
  })

  it('update-available 带上版本号与更新说明', () => {
    const state = mapUpdaterEvent(
      'update-available',
      { version: '0.2.0', releaseNotes: '修复若干问题' },
      { kind: 'checking' },
    )
    expect(state).toEqual({ kind: 'available', version: '0.2.0', notes: '修复若干问题' })
  })

  it('releaseNotes 不是字符串时置为 null', () => {
    const state = mapUpdaterEvent(
      'update-available',
      { version: '0.2.0', releaseNotes: [{ note: 'x' }] },
      { kind: 'checking' },
    )
    expect(state).toEqual({ kind: 'available', version: '0.2.0', notes: null })
  })

  it('update-not-available 映射为 up-to-date', () => {
    expect(mapUpdaterEvent('update-not-available', {}, { kind: 'checking' })).toEqual({
      kind: 'up-to-date',
    })
  })

  it('download-progress 的百分比取整并夹在 0-100', () => {
    expect(
      mapUpdaterEvent('download-progress', { percent: 42.7 }, { kind: 'downloading', percent: 0 }),
    ).toEqual({ kind: 'downloading', percent: 43 })

    expect(
      mapUpdaterEvent('download-progress', { percent: 180 }, { kind: 'downloading', percent: 0 }),
    ).toEqual({ kind: 'downloading', percent: 100 })
  })

  it('update-downloaded 带版本号', () => {
    expect(
      mapUpdaterEvent('update-downloaded', { version: '0.2.0' }, { kind: 'downloading', percent: 100 }),
    ).toEqual({ kind: 'downloaded', version: '0.2.0' })
  })

  it('error 只保留 message，保留上一次的可用信息', () => {
    const state = mapUpdaterEvent('error', new Error('net::ERR_NAME_NOT_RESOLVED'), { kind: 'checking' })
    expect(state).toEqual({ kind: 'error', message: 'net::ERR_NAME_NOT_RESOLVED' })
  })

  it('未知事件原样返回', () => {
    const current = { kind: 'idle' as const }
    expect(mapUpdaterEvent('something-else', {}, current)).toBe(current)
  })
})

describe('registerUpdateIpc', () => {
  it('get-state 返回主进程缓存的最新状态', async () => {
    const { ipcMain } = await import('electron')
    const { autoUpdater } = await import('electron-updater')
    registerUpdateIpc({ isPackaged: true, currentVersion: '0.1.0', quitAndInstall: vi.fn() })

    const availableHandler = vi
      .mocked(autoUpdater.on)
      .mock.calls.find(([event]) => event === 'update-available')![1] as (payload: unknown) => void
    availableHandler({ version: '0.2.0', releaseNotes: '修复若干问题' })

    const getState = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'wx-daily:update:get-state')![1]

    expect(await (getState as any)({})).toEqual({
      kind: 'available',
      version: '0.2.0',
      notes: '修复若干问题',
    })
  })

  it('非打包模式下不发网络请求，直接返回错误态', async () => {
    const { ipcMain } = await import('electron')
    const { autoUpdater } = await import('electron-updater')
    registerUpdateIpc({ isPackaged: false, currentVersion: '0.1.0', quitAndInstall: vi.fn() })

    const handler = vi
      .mocked(ipcMain.handle)
      .mock.calls.filter(([channel]) => channel === 'wx-daily:update:check')
      .at(-1)![1]
    const result = await (handler as any)({})

    expect(result).toEqual({ kind: 'error', message: '开发模式不检查更新' })
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('非打包模式下静默检查也不发网络请求', async () => {
    const { autoUpdater } = await import('electron-updater')
    vi.mocked(autoUpdater.checkForUpdates).mockClear()
    registerUpdateIpc({ isPackaged: false, currentVersion: '0.1.0', quitAndInstall: vi.fn() })

    startSilentCheck()

    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('打包模式下配置自动下载关闭', async () => {
    const { autoUpdater } = await import('electron-updater')
    registerUpdateIpc({ isPackaged: true, currentVersion: '0.1.0', quitAndInstall: vi.fn() })

    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('打包模式下静默检查吞掉失败', async () => {
    const { autoUpdater } = await import('electron-updater')
    vi.mocked(autoUpdater.checkForUpdates).mockRejectedValueOnce(new Error('network down'))
    registerUpdateIpc({ isPackaged: true, currentVersion: '0.1.0', quitAndInstall: vi.fn() })

    expect(() => startSilentCheck()).not.toThrow()
    await Promise.resolve()

    expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
  })

  it('install 调用传入的 quitAndInstall', async () => {
    const { ipcMain } = await import('electron')
    const quitAndInstall = vi.fn()
    registerUpdateIpc({ isPackaged: true, currentVersion: '0.1.0', quitAndInstall })

    const listener = vi
      .mocked(ipcMain.on)
      .mock.calls.filter(([channel]) => channel === 'wx-daily:update:install')
      .at(-1)![1]
    listener({} as any)

    expect(quitAndInstall).toHaveBeenCalledOnce()
  })
})

describe('autoUpdaterQuitAndInstall', () => {
  it('调用 electron-updater 的退出并安装方法', async () => {
    const { autoUpdater } = await import('electron-updater')
    vi.mocked(autoUpdater.quitAndInstall).mockClear()

    autoUpdaterQuitAndInstall()

    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce()
  })
})
