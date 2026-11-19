export type BodyParserDone = (error: Error | null, body?: unknown) => void

/**
 * 把「声明了 application/json 但没有 body」当合法请求处理。
 * 非空 body 一律交回 Fastify 默认解析器，保留畸形 JSON 报错与原型污染防护。
 */
export function createJsonBodyParser(
  defaultParser: (request: unknown, body: string, done: BodyParserDone) => void,
) {
  return (request: unknown, body: string, done: BodyParserDone): void => {
    if (body === '' || body === undefined || body === null) {
      done(null, undefined)
      return
    }
    defaultParser(request, body, done)
  }
}