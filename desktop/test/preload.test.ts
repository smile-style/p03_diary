import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

describe('sandboxed preload', () => {
  it('以 CommonJS 方式暴露数据目录与打开文件夹桥接', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'preload.cts'), 'utf8')
    let exposed: { key: string; value: any } | undefined
    const send = vi.fn()
    const context = {
      process: { argv: ['electron', '--wx-data-path=D:\\wx-data'] },
      require: (id: string) => {
        expect(id).toBe('electron')
        return {
          contextBridge: {
            exposeInMainWorld: (key: string, value: unknown) => {
              exposed = { key, value }
            },
          },
          ipcRenderer: { send },
        }
      },
    }

    expect(() => new vm.Script(source).runInNewContext(context)).not.toThrow()
    expect(exposed?.key).toBe('wxDailyDesktop')
    expect(exposed?.value.dataPath).toBe('D:\\wx-data')
    exposed?.value.openDataFolder()
    expect(send).toHaveBeenCalledWith('wx-daily:open-data-folder')
  })

  it('preload 暴露更新相关方法', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'preload.cts'), 'utf8')

    expect(source).toContain("'wx-daily:update:check'")
    expect(source).toContain("'wx-daily:update:download'")
    expect(source).toContain("'wx-daily:update:install'")
    expect(source).toContain("'wx-daily:update:state'")
    expect(source).toContain('version')
    expect(source).toContain("'--wx-app-version='")
  })

  it('preload 更新桥接传递版本、状态订阅与取消订阅', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'preload.cts'), 'utf8')
    let exposed: { key: string; value: any } | undefined
    const invoke = vi.fn(async (channel: string) => channel)
    const send = vi.fn()
    const on = vi.fn()
    const removeListener = vi.fn()
    const context = {
      process: {
        argv: ['electron', '--wx-data-path=D:\\wx-data', '--wx-app-version=0.2.0'],
      },
      require: (id: string) => {
        expect(id).toBe('electron')
        return {
          contextBridge: {
            exposeInMainWorld: (key: string, value: unknown) => {
              exposed = { key, value }
            },
          },
          ipcRenderer: { invoke, send, on, removeListener },
        }
      },
    }

    new vm.Script(source).runInNewContext(context)

    expect(exposed?.value.version).toBe('0.2.0')
    await exposed?.value.update.check()
    await exposed?.value.update.download()
    exposed?.value.update.install()
    expect(invoke).toHaveBeenCalledWith('wx-daily:update:check')
    expect(invoke).toHaveBeenCalledWith('wx-daily:update:download')
    expect(send).toHaveBeenCalledWith('wx-daily:update:install')

    const callback = vi.fn()
    const unsubscribe = exposed?.value.update.onState(callback)
    const listener = on.mock.calls[0][1]
    listener({}, { kind: 'available', version: '0.2.0', notes: null })
    expect(callback).toHaveBeenCalledWith({ kind: 'available', version: '0.2.0', notes: null })

    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith('wx-daily:update:state', listener)
  })
})

