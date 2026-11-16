import { BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string; notes: string | null }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

const UPDATE_EVENTS = [
  'checking-for-update',
  'update-available',
  'update-not-available',
  'download-progress',
  'update-downloaded',
  'error',
] as const

let state: UpdateState = { kind: 'idle' }
let updaterEnabled = false

function payloadRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : {}
}

export function mapUpdaterEvent(
  event: string,
  payload: unknown,
  current: UpdateState,
): UpdateState {
  switch (event) {
    case 'checking-for-update':
      return { kind: 'checking' }
    case 'update-available': {
      const info = payloadRecord(payload)
      return {
        kind: 'available',
        version: typeof info.version === 'string' ? info.version : '',
        notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
      }
    }
    case 'update-not-available':
      return { kind: 'up-to-date' }
    case 'download-progress': {
      const percent = payloadRecord(payload).percent
      const value = typeof percent === 'number' && Number.isFinite(percent) ? percent : 0
      return { kind: 'downloading', percent: Math.min(100, Math.max(0, Math.round(value))) }
    }
    case 'update-downloaded': {
      const info = payloadRecord(payload)
      return {
        kind: 'downloaded',
        version: typeof info.version === 'string' ? info.version : '',
      }
    }
    case 'error':
      return {
        kind: 'error',
        message: payload instanceof Error ? payload.message : String(payload),
      }
    default:
      return current
  }
}

function broadcast(nextState: UpdateState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('wx-daily:update:state', nextState)
  }
}

export function registerUpdateIpc(opts: {
  isPackaged: boolean
  currentVersion: string
  quitAndInstall: () => void
}): void {
  const { isPackaged, quitAndInstall } = opts
  updaterEnabled = isPackaged

  ipcMain.handle('wx-daily:update:check', async () => {
    if (!isPackaged) {
      state = { kind: 'error', message: '开发模式不检查更新' }
      return state
    }

    await autoUpdater.checkForUpdates()
    return state
  })

  ipcMain.handle('wx-daily:update:download', async () => {
    if (!isPackaged) {
      return state
    }

    await autoUpdater.downloadUpdate()
    return state
  })

  ipcMain.handle('wx-daily:update:get-state', () => state)
  ipcMain.on('wx-daily:update:install', () => quitAndInstall())

  if (!isPackaged) {
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  for (const event of UPDATE_EVENTS) {
    autoUpdater.on(event, (payload: unknown) => {
      state = mapUpdaterEvent(event, payload, state)
      broadcast(state)
    })
  }
}

export function startSilentCheck(): void {
  if (!updaterEnabled) {
    return
  }

  void autoUpdater.checkForUpdates().catch(() => undefined)
}
