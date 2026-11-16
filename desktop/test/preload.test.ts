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
})

