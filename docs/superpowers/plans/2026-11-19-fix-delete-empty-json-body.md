# 记录/主题/分类删除报「请求参数不合法」修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有不携带请求体的 `DELETE` 请求不再被后端 400 拒绝，从而恢复「删除记录、删除主题、删除分类」这三个入口。

**Architecture:** 只改后端一处：在 `buildApp` 里给 `application/json` 注册一个自定义内容类型解析器，空 body 解析为 `undefined`（不报错），非空 body 仍交给 Fastify 自带的默认 JSON 解析器（保留原型污染防护）。前端不动。

**Tech Stack:** Fastify 5（`addContentTypeParser` / `getDefaultJsonParser`）、Kysely、Vitest（`app.inject`）。

**Spec:** 无独立设计文档；根因取证与实测结论见本文 §1–§2。

## Global Constraints

- 不改 `app/` 下任何前端代码（这是服务端兼容性问题，客户端不该为服务端的严格解析做适配）。
- 不改任何路由的校验逻辑，不改错误响应格式 `{ error: { code, message } }`。
- 必须保留 Fastify 默认 JSON 解析器的安全行为：畸形 JSON 仍返回 400，`__proto__` 注入仍被拒绝。
- `Content-Type: application/json` 的 **非空** body 行为必须与改动前完全一致（`POST /records`、`PUT /records/:id`、`PATCH` 等所有现有测试都不许变）。
- 命令在 `server/` 下执行；Windows 上 `pnpm` 不可用时用 `pnpm.cmd`。

## Review Focus

1. **带 `Content-Type: application/json` 但不带 body 的 DELETE**：这是线上真实失败路径，必须返回 204 而不是 400。三类删除（记录 / 主题 / 分类）都要覆盖。
2. **畸形 JSON**（`{"broken`）：仍然 400 `VALIDATION`，不能被"容错"顺带放宽。
3. **原型污染 payload**（`{"__proto__":{"x":1}}`）：仍然被拒（400），不能因为换了解析器而丢掉防护。
4. **`Content-Type` 带 charset 变体**（`application/json; charset=utf-8`、大写 `UTF-8`）：与不带 charset 表现一致。
5. **本来就合法的写请求**：`POST /records` 正常返回 201，`PUT` 正常返回 200，不受影响。

---

## §1 根因

### 1.1 现象

详情页点「删除」→ 短暂显示「删除中」→ toast 报 **「请求参数不合法」**，记录仍在。总共 65 条记录，`2026-11-10` 那 2 条都在，一条没删掉。

### 1.2 根因（已实测复现）

服务端 `server/src/app.ts` 没有定制内容类型解析器，用的是 Fastify 默认 JSON 解析器：

`server/node_modules/fastify/lib/content-type-parser.js:341-347`
```js
function defaultJsonParser (req, body, done) {
  if (body.length === 0) {
    done(new FST_ERR_CTP_EMPTY_JSON_BODY(), undefined)   // ← 空 body 直接报错
    return
  }
  ...
}
```

该错误状态码是 400（`fastify/lib/errors.js:122-126`），被 `app.ts` 的 `setErrorHandler` 映射成：

```
clientErrorCode(400)   → 'VALIDATION'
clientErrorMessage(400) → '请求参数不合法'
```

也就是用户看到的那句话。

完整链路：

1. `app/src/api/records.ts:47-49` — `deleteRecord()` 发 `request(url, { method: 'DELETE' })`，**没有 body**。
2. `app/src/api/client.ts:74-84` — `requestOnce` 只放 `Authorization`，不设 `Content-Type`。`uni.request` 收到 `method !== 'GET'` 时**自动补** `Content-Type: application/json`（已核对 `@dcloudio/uni-h5` 的 `RequestOptions.formatArgs.header`：`if (params.method !== HTTP_METHODS[0]) { header['Content-Type'] = 'application/json' }`，`HTTP_METHODS[0]` 是 `GET`）。
3. `uni.request` 在 `method !== 'GET'` 时还把 `data` 转成 body；没传 `data` 时 `params.data = value || ""`，于是 body 是**空字符串**。
4. 服务端收到 `Content-Type: application/json` + `Content-Length: 0` → Fastify 默认解析器判空 → 400 `FST_ERR_CTP_EMPTY_JSON_BODY`。

### 1.3 为什么现有测试没抓到

`server/test/records.test.ts:527-532` 等处直接用 `app.inject({ method: 'DELETE', url })`，**不带 `content-type`**，Fastify 走「无 body 不需要解析」的路径，直接 204。测试覆盖的是"服务端正确"，漏掉的是"真实客户端会补这个头"。所以这不是回归，是一直存在、只是 Task 7 的手工核对路径第一次踩到。

### 1.4 实测证据

同一份 `buildApp`，只差请求头：

```
DELETE 无 content-type              -> 204
DELETE application/json + 空 body   -> 400 {"error":{"code":"VALIDATION","message":"请求参数不合法"}}
DELETE application/json + body ""   -> 400 {"error":{"code":"VALIDATION","message":"请求参数不合法"}}
```

### 1.5 影响范围

`app/src/api/` 下三处 `DELETE`，全部不带 body，因此**全部**会失败：

| 调用点 | 用户可触达的入口 |
|---|---|
| `app/src/api/records.ts:48` | 记录详情页「删除」 |
| `app/src/api/topics.ts:39` | 主题详情页删除主题 |
| `app/src/api/categories.ts:28` | 「我的」里的分类管理 |

Task 7 只验了记录删除，另两个同样是坏的，一并修。

---

## §2 修复方案

**改后端，不改前端。**

在 `buildApp` 里为 `application/json` 注册自定义解析器：空 body → `done(null, undefined)`；非空 → 交给 `app.getDefaultJsonParser('error', 'error')` 返回的原函数（等于现有行为，含原型污染防护与畸形 JSON 报错）。

为什么不选前端方案（发送时把 `Content-Type` 改成 `text/plain`）：实测能让 DELETE 通过，但它把「不带 body」伪装成文本请求，属于在客户端迁就服务端的严格解析；一旦以后有接口对 `Content-Type` 有语义要求就会再踩坑。服务端本来就应该容忍"声明了 JSON 但没有 body"——HTTP 规范允许 DELETE 无 body，这个严格判定是 Fastify 的默认值而非业务要求。

为什么不直接 `app.addContentTypeParser('*', …)`：会把 `multipart/form-data`（图片上传）也吞掉，破坏上传流程。

---

## §3 文件结构

```
server/
  src/app.ts                       改：新增 createJsonBodyParser + 注册
  src/json-body-parser.ts          建：解析器工厂（便于单独测试）
  test/json-body-parser.test.ts    建：解析器单元测试
  test/records.test.ts             改：补真实客户端形态的 DELETE 用例
  test/queries.test.ts             改：补 /record-days 不影响（已有）；不需要改
  test/health.test.ts              改：补畸形 JSON / 原型污染仍失败
```

把解析器放进独立文件，是因为它需要三种行为（空 body / 合法 JSON / 畸形 JSON）的独立断言，塞进 `app.ts` 里就只能靠集成测试间接覆盖。

---

## §4 任务

### Task 1: 抽出 JSON body 解析器

**Files:**
- Create: `server/src/json-body-parser.ts`
- Test: `server/test/json-body-parser.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BodyParserDone = (error: Error | null, body?: unknown) => void
  export function createJsonBodyParser(
    defaultParser: (request: unknown, body: string, done: BodyParserDone) => void,
  ): (request: unknown, body: string, done: BodyParserDone) => void
  ```
  返回的函数：`body` 为空字符串（`''`）或 `undefined`/`null` 时 `done(null, undefined)`；否则原样调 `defaultParser(request, body, done)`。

- [ ] **Step 1: 写失败测试**

新建 `server/test/json-body-parser.test.ts`：

```ts
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
```

> 上面 `should: { break should }` 是笔误，删掉它——那两行不写。测试只保留 `expect(await call(parser, ''))...` 和 `expect(await call(parser, undefined))...` 与 `expect(defaultParser).not.toHaveBeenCalled()`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- json-body-parser`
Expected: 失败，无法解析 `../src/json-body-parser.js`。

- [ ] **Step 3: 实现**

`server/src/json-body-parser.ts`：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- json-body-parser`
Expected: 3 个用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/json-body-parser.ts server/test/json-body-parser.test.ts
git commit -m "feat(server): 新增容忍空 body 的 JSON 内容类型解析器"
```

---

### Task 2: 在 buildApp 中注册解析器

**Files:**
- Modify: `server/src/app.ts`（`app.setErrorHandler(...)` 之后、`await app.register(multipart, …)`（约 102 行）之前插入）
- Test: `server/test/health.test.ts`（追加）

**Interfaces:**
- Consumes: `createJsonBodyParser`（Task 1）
- Produces: `buildApp` 返回的实例对 `application/json` 使用新解析器

- [ ] **Step 1: 写失败测试**

`server/test/health.test.ts` 追加：

```ts
  it('声明 application/json 但没有 body 时不报 400', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    app.delete('/test-empty-delete', async () => ({ ok: true }))

    const res = await app.inject({
      method: 'DELETE',
      url: '/test-empty-delete',
      headers: { 'content-type': 'application/json' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('带 charset 的 application/json 空 body 同样不报 400', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    app.delete('/test-empty-delete', async () => ({ ok: true }))

    for (const contentType of [
      'application/json; charset=utf-8',
      'application/json;charset=UTF-8',
    ]) {
      const res = await app.inject({
        method: 'DELETE',
        url: '/test-empty-delete',
        headers: { 'content-type': contentType },
      })
      expect(res.statusCode).toBe(200)
    }
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- health`
Expected: 两个新用例失败，实际 400（`FST_ERR_CTP_EMPTY_JSON_BODY`）。

- [ ] **Step 3: 注册**

在 `server/src/app.ts`：

- 顶部 import 加：`import { createJsonBodyParser } from './json-body-parser.js'`
- 在 `app.setErrorHandler(...)` 整个块之后、`await app.register(multipart, …)` 之前插入：

```ts
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    createJsonBodyParser(app.getDefaultJsonParser('error', 'error')),
  )
```

说明：两个 `'error'` 是 Fastify 默认对 `__proto__` / `constructor` 的处置策略，必须与 Fastify 自己注册默认解析器时用的一致，否则安全行为会变化。

- [ ] **Step 4: 跑全量后端测试**

Run: `cd server && pnpm test`
Expected: 全绿。重点看：`畸形 JSON 请求返回 400 VALIDATION`、`不支持的 Content-Type 返回 415 VALIDATION` 仍然通过。

- [ ] **Step 5: 提交**

```bash
git add server/src/app.ts server/test/health.test.ts
git commit -m "fix(server): 容忍 Content-Type: application/json 的空 body"
```

---

### Task 3: 用真实客户端形态覆盖三类删除

**Files:**
- Modify: `server/test/records.test.ts`
- Modify: `server/test/categories-topics.test.ts`（若无合适位置就在文件末尾追加 `describe`）

**Interfaces:**
- Consumes: 各测试文件已有的 `createTestApp` / `loginAs` / `authHeader` / `apps`
- Produces: 无（纯测试）

- [ ] **Step 1: 写失败测试（记录删除）**

`server/test/records.test.ts` 追加（`request` 是该文件内已有的封装，会自动拼 `authorization`）：

```ts
describe('DELETE /records/:id 兼容 uni.request 的默认请求头', () => {
  it('带 content-type: application/json 且不带 body 时仍能删除', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    const token = await loginAs(app, deps, 'delete-with-json-header')

    const created = await request(app, token, {
      method: 'POST',
      url: '/records',
      payload: recordPayload(),
    })
    const id = created.json<RecordViewBody>().id

    const res = await app.inject({
      method: 'DELETE',
      url: `/records/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })

    expect(res.statusCode).toBe(204)
    expect(await deps.db.selectFrom('records').select('id').where('id', '=', id).execute()).toEqual([])
  })
})
```

- [ ] **Step 2: 写失败测试（主题、分类删除）**

`server/test/categories-topics.test.ts` 追加（沿用该文件已有的建主题/建分类 helper 与 `request` 封装；若文件内没有统一的 `request`，就用 `app.inject` + `authHeader(token)`）：

```ts
describe('DELETE 兼容 uni.request 的默认请求头', () => {
  it('主题：带 content-type: application/json 且不带 body 时仍能删除', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    const token = await loginAs(app, deps, 'topic-delete-json-header')
    const topic = await deps.db
      .insertInto('topics')
      .values({ user_id: app.jwt.decode<{ sub: string }>(token)!.sub, category_id: null, name: '待删主题', created_at: new Date().toISOString() })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const res = await app.inject({
      method: 'DELETE',
      url: `/topics/${topic.id}`,
      headers: { ...authHeader(token), 'content-type': 'application/json' },
    })

    expect(res.statusCode).toBe(204)
  })

  it('分类：带 content-type: application/json 且不带 body 时仍能删除', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    const token = await loginAs(app, deps, 'category-delete-json-header')
    const category = await deps.db
      .insertInto('categories')
      .values({ user_id: app.jwt.decode<{ sub: string }>(token)!.sub, name: '待删分类', created_at: new Date().toISOString() })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const res = await app.inject({
      method: 'DELETE',
      url: `/categories/${category.id}`,
      headers: { ...authHeader(token), 'content-type': 'application/json' },
    })

    expect(res.statusCode).toBe(204)
  })
})
```

> 如果 `topics` / `categories` 表有 `sort_order` 等非空无默认值字段，按该表定义补上（`server/src/db/db.ts` 里 `sort_order` 是 `Generated<number>`，可不传）。

- [ ] **Step 3: 先确认这些测试在修复前会失败（可选但推荐）**

若 Task 2 已经提交，可临时 `git stash` 掉 `server/src/app.ts` 的改动再跑；不方便就跳过——`/tmp` 下的复现脚本已经证明过 400，此处只需确认修复后为 204。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- records categories-topics`
Expected: 三个新用例 PASS（204）。

- [ ] **Step 5: 提交**

```bash
git add server/test/records.test.ts server/test/categories-topics.test.ts
git commit -m "test(server): 覆盖 uni.request 默认请求头下的三类删除"
```

---

### Task 4: 确认安全边界没被放宽

**Files:**
- Test: `server/test/health.test.ts`（追加）

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 写测试**

`server/test/health.test.ts` 追加：

```ts
  it('自定义解析器不放过畸形 JSON', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    app.post('/test-body', async (request) => request.body)

    const res = await app.inject({
      method: 'POST',
      url: '/test-body',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION')
  })

  it('自定义解析器仍拦截原型污染', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    app.post('/test-body', async (request) => request.body)

    const res = await app.inject({
      method: 'POST',
      url: '/test-body',
      headers: { 'content-type': 'application/json' },
      payload: '{"__proto__":{"polluted":true}}',
    })

    expect(res.statusCode).toBe(400)
  })
```

- [ ] **Step 2: 跑测试**

Run: `cd server && pnpm test -- health`
Expected: 两个新用例 PASS。（若第二步只读测试已经在 Task 2 的 `畸形 JSON` 用例覆盖过，此处保留是为了钉住"换解析器后安全策略没变"。）

- [ ] **Step 3: 提交**

```bash
git add server/test/health.test.ts
git commit -m "test(server): 钉住 JSON 解析器的安全边界"
```

---

### Task 5: 全量验证与手工复核

**Files:** 无代码改动。

- [ ] **Step 1: 三个包全量测试**

```bash
cd server && pnpm test
cd ../app && pnpm test && pnpm typecheck
cd ../desktop && pnpm test
```
Expected: 全绿。

- [ ] **Step 2: 重建 H5 与桌面端**

```bash
cd app && pnpm run build:h5
cd ../desktop && pnpm start
```

> 桌面端打包时 `../app/dist/build/h5` 会被拷进 `resources/web`；只改 `server/` 的话，桌面端本身也需要 `pnpm run build`（它把 `server/src` 一起编译）。按 `docs/windows-desktop.md` 的流程走一遍即可。

- [ ] **Step 3: 手工复核清单**

- 记录详情页删除一条记录：toast 显示「已删除」，返回上一页，时间线该天条数减 1；若该天清零，日期从轴上消失。
- 主题详情页删除一个空主题：成功，返回上一页。
- 「我的」→ 分类管理删除一个分类：成功，下面的主题进入「未分类」。
- 删除一条**带图片**的记录：成功，且图片文件被清理（`deleteRecord` 里已有的 `removeFiles` 路径正常工作）。
- 编辑记录后保存（PUT）：仍然正常，没有因为解析器改动而丢字段。
- 上传图片（multipart）：仍然正常（确认 `*` 解析器没有被覆盖）。

- [ ] **Step 4: 复核 65 条记录的数据未被误伤**

删除前记录总数 65、`2026-11-10` 有 2 条。手工删 1 条后应为 64、该天 1 条。其余日期条数不变。

- [ ] **Step 5: 提交（如有残留改动）**

```bash
git status
git add -A server
git commit -m "chore(server): 删除请求校验修复收尾"
```
