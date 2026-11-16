const { contextBridge, ipcRenderer } = require('electron')

const PREFIX = '--wx-data-path='

contextBridge.exposeInMainWorld('wxDailyDesktop', {
  dataPath: process.argv.find((arg) => arg.startsWith(PREFIX))?.slice(PREFIX.length) ?? '',
  openDataFolder: () => ipcRenderer.send('wx-daily:open-data-folder'),
})
