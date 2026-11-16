import { afterEach, describe, expect, it, vi } from 'vitest'
import { getYears, getYearMonths } from '../src/api/queries'
import { listRecords } from '../src/api/records'
import { setToken } from '../src/api/client'

type CallbackOptions = { success?: (r: any) => void; fail?: (e: any) => void }

function installUni(data: unknown) {
  const request = vi.fn((opts: CallbackOptions & any) => {
    opts.success?.({ statusCode: 200, data })
    return 1
  })
  vi.stubGlobal('uni', { request })
  return request
}

afterEach(() => {
  vi.unstubAllGlobals()
  setToken(null)
})

describe('年份相关请求', () => {
  it('getYears 请求 /years', async () => {
    const request = installUni({ items: [{ year: '2026', count: 3 }] })

    const result = await getYears()

    expect(result.items[0]).toEqual({ year: '2026', count: 3 })
    expect(request.mock.calls[0][0].url).toContain('/years')
  })

  it('getYearMonths 带上 year 查询参数', async () => {
    const request = installUni({ items: [{ month: '2026-05', count: 2 }] })

    const result = await getYearMonths('2026')

    expect(result.items[0]).toEqual({ month: '2026-05', count: 2 })
    expect(request.mock.calls[0][0].url).toContain('/year-months')
    expect(request.mock.calls[0][0].url).toContain('year=2026')
  })

  it('listRecords 带上 year 参数', async () => {
    const request = installUni({ items: [], nextCursor: null })

    await listRecords({ year: '2025', limit: 20 })

    expect(request.mock.calls[0][0].url).toContain('year=2025')
  })

  it('listRecords 带上 month 参数', async () => {
    const request = installUni({ items: [], nextCursor: null })

    await listRecords({ month: '2025-07', limit: 20 })

    expect(request.mock.calls[0][0].url).toContain('month=2025-07')
  })

  it('listRecords 不传 year / month 时 URL 中都不出现', async () => {
    const request = installUni({ items: [], nextCursor: null })

    await listRecords({ limit: 20 })

    const url = request.mock.calls[0][0].url as string
    expect(url).not.toContain('year=')
    expect(url).not.toContain('month=')
  })
})