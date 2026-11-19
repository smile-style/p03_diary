import { describe, expect, it, vi } from 'vitest'
import { createJsonBodyParser } from '../src/json-body-parser.js'

function call(parser: ReturnType<typeof createJsonBodyParser>, body: unknown) {
  return new Promise<{ error: unknown; value: unknown }>((resolve) => {
    ;(parser as any)({}, body, (error: unknown, value: unknown) => {
      resolve({ error, value })
    })
  })
}

describe('createJsonBodyParser', () => {
  it('空 body 解析为 undefined，且不调用默认解析器', async () => {
    const defaultParser = vi.fn()
    const parser = createJsonBodyParser(defaultParser as any)

    expect(await call(parser, '')).toEqual({ error: null, value: undefined })
    expect(await call(parser, undefined)).toEqual({ error: null, value: undefined })
    expect(defaultParser).not.toHaveBeenCalled()
  })

  it('非空 body 原样交给默认解析器', async () => {
    const defaultParser = vi.fn((_req, body, done) => done(null, { seen: body }))
    const parser = createJsonBodyParser(defaultParser as any)

    expect(await call(parser, '{"a":1}')).toEqual({ error: null, value: { seen: '{"a":1}' } })
    expect(defaultParser).toHaveBeenCalledOnce()
  })

  it('默认解析器的错误原样透传', async () => {
    const boom = new Error('bad json')
    const defaultParser = vi.fn((_req, _body, done) => done(boom))
    const parser = createJsonBodyParser(defaultParser as any)

    expect((await call(parser, '{"broken"')).error).toBe(boom)
  })
})