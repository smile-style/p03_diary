import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../../server/src/app.js'
import { loadConfig } from '../../server/src/config.js'
import { createDb } from '../../server/src/db/db.js'
import { migrateToLatest } from '../../server/src/db/migrate.js'
import { LocalFileStorage } from '../../server/src/images/storage.js'
import { backupDatabase } from './backup.js'
import { resolveDataDir } from './data-dir.js'
import { loadOrCreateSecrets } from './secrets.js'
import {
  autoUpdaterQuitAndInstall,
  registerUpdateIpc,
  startSilentCheck,
} from './update.js'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = 47821

export function resolveWebRoot(opts: {
  isPackaged: boolean
  resourcesPath: string
  here: string
}): string {
  return opts.isPackaged
    ? join(opts.resourcesPath, 'web')
    : join(opts.here, '../../../../app/dist/build/h5')
}

async function startDesktop(): Promise<void> {
  await app.whenReady()

  const dataDir = resolveDataDir({
    documentsPath: app.getPath('documents'),
    homePath: app.getPath('home'),
    oneDrivePath: process.env.OneDrive ?? null,
    override: process.env.WXDAILY_DATA_DIR,
  })

  await mkdir(join(dataDir, 'images'), { recursive: true })
  await mkdir(join(dataDir, 'backups'), { recursive: true })

  const secrets = await loadOrCreateSecrets(dataDir)
  const config = loadConfig({
    DATA_DIR: dataDir,
    JWT_SECRET: secrets.jwtSecret,
    FILE_URL_SECRET: secrets.fileUrlSecret,
    PORT: String(PORT),
    WEB_ROOT: resolveWebRoot({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      here,
    }),
  })

  const db = createDb(config.databaseFile)
  await migrateToLatest(db)

  try {
    await backupDatabase(config.databaseFile, join(dataDir, 'backups'))
  } catch (error) {
    console.error('启动备份失败', error)
  }

  const server = await buildApp({
    config,
    db,
    storage: new LocalFileStorage(config.storageDir),
  })

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) {
      return
    }
    event.preventDefault()
    quitting = true
    void (async () => {
      await server.close()
      await db.destroy()
      app.quit()
    })()
  })

  try {
    await server.listen({ port: PORT, host: '127.0.0.1' })
  } catch {
    await dialog.showMessageBox({
      message: '端口 47821 被占用',
      detail: '请关闭占用该端口的程序后重新打开。',
    })
    app.quit()
    return
  }

  ipcMain.on('wx-daily:open-data-folder', () => {
    void shell.openPath(dataDir).then((error) => {
      if (error) console.error('打开数据文件夹失败', error)
    })
  })

  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 760,
    minHeight: 600,
    title: '生活记录',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      additionalArguments: [`--wx-data-path=${dataDir}`, `--wx-app-version=${app.getVersion()}`],
    },
  })

  registerUpdateIpc({
    isPackaged: app.isPackaged,
    currentVersion: app.getVersion(),
    quitAndInstall: () => {
      quitting = false
      autoUpdaterQuitAndInstall()
    },
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })
  mainWindow = window

  startSilentCheck()

  await window.loadURL(`http://127.0.0.1:${PORT}/`)
}

let mainWindow: BrowserWindow | null = null

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  if (process.env.WXDAILY_DESKTOP_NO_AUTOSTART !== '1') {
    void startDesktop()
  }
}



