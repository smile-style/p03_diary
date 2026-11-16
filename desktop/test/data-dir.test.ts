import { describe, expect, it } from 'vitest'
import { resolveDataDir } from '../src/data-dir.js'

const base = {
  documentsPath: 'C:\\Users\\u\\Documents',
  homePath: 'C:\\Users\\u',
  oneDrivePath: null as string | null,
}

describe('resolveDataDir', () => {
  it('默认放在文档目录下', () => {
    expect(resolveDataDir(base)).toBe('C:\\Users\\u\\Documents\\wx-daily')
  })

  it('文档目录被 OneDrive 接管时回退到用户目录', () => {
    expect(
      resolveDataDir({
        ...base,
        documentsPath: 'C:\\Users\\u\\OneDrive\\Documents',
        oneDrivePath: 'C:\\Users\\u\\OneDrive',
      }),
    ).toBe('C:\\Users\\u\\wx-daily')
  })

  it('OneDrive 路径大小写不敏感', () => {
    expect(
      resolveDataDir({
        ...base,
        documentsPath: 'c:\\users\\u\\onedrive\\documents',
        oneDrivePath: 'C:\\Users\\u\\OneDrive',
      }),
    ).toBe('C:\\Users\\u\\wx-daily')
  })

  it('环境变量覆盖优先于一切', () => {
    expect(
      resolveDataDir({
        ...base,
        oneDrivePath: 'C:\\Users\\u\\OneDrive',
        documentsPath: 'C:\\Users\\u\\OneDrive\\Documents',
        override: 'D:\\data\\wx',
      }),
    ).toBe('D:\\data\\wx')
  })
})