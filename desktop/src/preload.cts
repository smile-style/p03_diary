const { contextBridge, ipcRenderer } = require('electron')

const readArg = (prefix = '') =>
  process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? ''

contextBridge.exposeInMainWorld('wxDailyDesktop', {
  dataPath: readArg('--wx-data-path='),
  version: readArg('--wx-app-version='),
  openDataFolder: () => ipcRenderer.send('wx-daily:open-data-folder'),
  update: {
    check: () => ipcRenderer.invoke('wx-daily:update:check'),
    download: () => ipcRenderer.invoke('wx-daily:update:download'),
    install: () => ipcRenderer.send('wx-daily:update:install'),
    getState: () => ipcRenderer.invoke('wx-daily:update:get-state'),
    onState: (callback = Function.prototype) => {
      const listener = (_event = null, state = {}) => callback(state)
      ipcRenderer.on('wx-daily:update:state', listener)
      return () => ipcRenderer.removeListener('wx-daily:update:state', listener)
    },
  },
})
