# wx_daily 后端服务 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出生活记录小程序的后端：微信登录、分类/主题/记录（含摘抄卡片、★、标签、图片）的增删改查，时间线/日历/标签/搜索/★ 等查询接口，内容安全检查，以及 Docker 部署和自动备份。

**Architecture:** `server/` 下一个 Fastify + TypeScript 服务，用 Kysely 访问 PostgreSQL。外部依赖（微信接口、内容检查、文件存储）都放在接口后面，通过 `Deps` 注入：测试用替身实现，生产用真实实现。每个接口都按 `user_id` 隔离数据。前端（uni-app）另写一份计划。

**Tech Stack:** Node.js 22、TypeScript 5、pnpm、Fastify 5、@fastify/jwt、@fastify/multipart、zod、Kysely + pg、Vitest、PostgreSQL 16（启用 pg_trgm）、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-11-06-wx-daily-diary-design.md`

## Global Constraints

- 每个用户的数据只有本人能访问。访问别人的资源一律返回 404（不是 403），并且不做任何修改。
- 记录不能丢：内容检查不通过或检查服务不可用时，不写入任何数据，返回明确的错误码，由前端把内容留在本地草稿里。
- 用户表与微信 openid 解耦：openid 存在 `user_identities(provider='wechat', subject=openid)` 中，`users` 表里不出现任何微信字段。
- 内容检查由 `CONTENT_CHECK=off|wechat` 切换；`off` 时全部放行。
- 图片存储走 `FileStorage` 接口，第一版实现为本地磁盘（`STORAGE_DIR`）。
- 错误响应统一为 `{ "error": { "code": string, "message": string } }`。错误码与状态码：`VALIDATION` 400、`UNAUTHORIZED` 401、`NOT_FOUND` 404、`CONFLICT` 409、`CONTENT_REJECTED` 422、`CHECK_UNAVAILABLE` 503。`message` 用中文，直接给用户看。
- 日期一律用 `YYYY-MM-DD` 字符串（PostgreSQL `date` 类型），不做时区换算。“今天”由前端决定。
- 删除分类：下面的主题保留，`category_id` 置空（归入「未分类」）。删除主题：下面的记录保留，`topic_id` 置空。
- 测试连接真实的 PostgreSQL，地址由 `TEST_DATABASE_URL` 指定。在本机运行 `docker compose -f docker-compose.test.yml up -d` 即可启动；如果本机没有 Docker，就指向云服务器上的测试库。
- 所有命令都在 `server/` 目录下执行（部署相关的除外）。

## Review Focus

1. **越权访问**：用户 B 用 A 的记录、主题、分类或图片 id 去读、改、删，或者在自己的记录里挂上 A 的 `topicId`/`imageIds`，都应返回 404，A 的数据不受影响。测试放在 Task 3、Task 5、Task 6。
2. **搜索关键词里有 `%`、`_`、`\`，或者全是空白**：应按字面匹配，空白关键词视同没传。测试放在 Task 7。
3. **标签写法的边界**：全角 `＃投资`、`#投资，` 后面紧跟中文标点、单独一个 `#`、同一标签出现两次、`#AI` 和 `#ai`。应提取为 `投资`、`投资`、无、一个、两个不同的标签（区分大小写）。测试放在 Task 6。
4. **内容检查出问题**：微信接口超时或 token 失效时应返回 503 `CHECK_UNAVAILABLE`，什么都不写入；超过 2500 字的长文要分段检查，任何一段不通过就整体拒绝。测试放在 Task 4、Task 6。
5. **编辑记录时**：从记录里移除的图片要连同文件一起删除；记录换了主题后，新旧两个主题的统计都要正确；某个标签的记录全部删掉后，它不再出现在标签列表里。测试放在 Task 6、Task 7。

---

## 文件结构

```
docker-compose.yml             生产部署：api + db + backup
docker-compose.test.yml        测试库（宿主机端口 5433）
server/
  package.json  tsconfig.json  vitest.config.ts  Dockerfile  .env.example
  src/
    config.ts                  读取环境变量，用 zod 校验 → Config
    deps.ts                    Deps 类型与 createDeps(config)
    app.ts                     buildApp(deps) → FastifyInstance（注册插件、路由、错误处理）
    server.ts                  入口：迁移 → 启动
    errors.ts                  AppError 与各错误码的辅助函数
    db/db.ts                   createDb(url)、DB 类型
    db/migrate.ts              migrateToLatest(db)
    db/migrations/001_init.ts  初始表结构
    auth/wechat-client.ts      WechatClient 接口与 HttpWechatClient
    auth/plugin.ts             JWT 插件与 requireUser 钩子
    auth/routes.ts             POST /auth/wechat
    categories/routes.ts
    topics/routes.ts           主题增删改；GET /topics 概览
    moderation/checker.ts      ContentChecker 接口、PassThroughChecker、WechatChecker
    moderation/push-routes.ts  微信消息推送（图片异步检查结果）
    images/storage.ts          FileStorage 接口与 LocalFileStorage
    images/signed-url.ts       signFileUrl / verifyFileUrl
    images/routes.ts           POST /images、GET /files/:key
    records/tags.ts            extractTags(texts)
    records/service.ts         saveRecord / loadRecordViews / deleteRecord
    records/routes.ts          记录增删改查与 GET /records 列表
    queries/routes.ts          /calendar、/tags、/excerpts/starred
  test/
    helpers.ts                 createTestApp、resetDb、login、FakeWechatClient
    *.test.ts
```

---

### Task 1: 搭好服务骨架、配置和数据库表

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/.env.example`, `server/src/config.ts`, `server/src/errors.ts`, `server/src/deps.ts`, `server/src/app.ts`, `server/src/server.ts`, `server/src/db/db.ts`, `server/src/db/migrate.ts`, `server/src/db/migrations/001_init.ts`, `docker-compose.test.yml`, `server/test/helpers.ts`
- Test: `server/test/health.test.ts`

**Interfaces:**
- Produces:
  - `type Config = { port: number; databaseUrl: string; jwtSecret: string; fileUrlSecret: string; wechatAppId: string; wechatSecret: string; wechatPushToken: string; contentCheck: 'off' | 'wechat'; storageDir: string; publicBaseUrl: string }`，由 `loadConfig(env: NodeJS.ProcessEnv): Config` 生成。缺少必填项时抛错；`contentCheck` 默认 `'off'`。
  - `type Deps = { config: Config; db: Kysely<DB>; wechat: WechatClient; checker: ContentChecker; storage: FileStorage }`（后三个类型在 Task 2/4/5 定义，本任务先用 `unknown` 占位，到那时再收紧）
  - `buildApp(deps: Deps): Promise<FastifyInstance>`
  - `class AppError extends Error { constructor(public status: number, public code: string, message: string) }`，以及 `notFound(msg = '内容不存在')`、`validation(msg)`、`conflict(msg)`。Zod 校验失败统一转成 `VALIDATION`。
  - `createDb(url: string): Kysely<DB>`、`migrateToLatest(db): Promise<void>`
  - 测试辅助：`createTestApp(overrides?: Partial<Deps>): Promise<{ app: FastifyInstance; deps: Deps }>`、`resetDb(db): Promise<void>`（TRUNCATE 所有表 CASCADE）

**表结构（001_init）：** 主键都用 `uuid default gen_random_uuid()`，时间列都用 `timestamptz default now()`。

| 表 | 列 |
|---|---|
| users | id, created_at |
| user_identities | id, user_id → users ON DELETE CASCADE, provider text, subject text, created_at；UNIQUE(provider, subject) |
| categories | id, user_id, name text, sort_order int default 0, created_at；UNIQUE(user_id, name) |
| topics | id, user_id, category_id → categories ON DELETE SET NULL（可空）, name text, created_at；UNIQUE(user_id, name) |
| records | id, user_id, topic_id → topics ON DELETE SET NULL（可空）, record_date date, body text default '', links text[] default '{}', created_at, updated_at；INDEX(user_id, record_date desc, created_at desc) |
| excerpts | id, record_id → records ON DELETE CASCADE, user_id, position int, quote text, thought text default '', starred bool default false |
| images | id, user_id, record_id → records ON DELETE SET NULL（可空）, storage_key text, mime text, status text CHECK IN ('pending','ok','rejected') default 'ok', trace_id text null, position int default 0, created_at |
| tags | id, user_id, name text；UNIQUE(user_id, name) |
| record_tags | record_id → records ON DELETE CASCADE, tag_id → tags ON DELETE CASCADE；PK(record_id, tag_id) |

另外执行 `CREATE EXTENSION IF NOT EXISTS pg_trgm`，并在 `records.body`、`excerpts.quote`、`excerpts.thought` 上建 `gin_trgm_ops` 索引。

- [ ] **Step 1: 写 `docker-compose.test.yml`**（postgres:16，`POSTGRES_PASSWORD=test`，`POSTGRES_DB=wxdaily_test`，端口 `5433:5432`），然后启动

Run: `docker compose -f docker-compose.test.yml up -d`（在仓库根目录执行）
Expected: 容器 healthy

- [ ] **Step 2: 写失败的测试 `test/health.test.ts`**

```ts
it('GET /health 返回 ok 且数据库可用', async () => {
  const { app } = await createTestApp()
  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ ok: true })
})
it('迁移后所有表都存在', async () => {
  const { deps } = await createTestApp()
  const tables = await sql<{ t: string }>`select tablename as t from pg_tables where schemaname='public'`.execute(deps.db)
  expect(tables.rows.map(r => r.t)).toEqual(expect.arrayContaining(
    ['users','user_identities','categories','topics','records','excerpts','images','tags','record_tags']))
})
```

- [ ] **Step 3: 运行，确认失败**

Run: `pnpm vitest run test/health.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现上面列出的文件。** `/health` 执行 `select 1`。`createTestApp` 使用 `TEST_DATABASE_URL`（默认 `postgres://postgres:test@localhost:5433/wxdaily_test`），先运行迁移，再 `resetDb`。`vitest.config.ts` 设置 `fileParallelism: false`，因为各测试文件共用同一个库。

- [ ] **Step 5: 运行，确认通过**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add docker-compose.test.yml server
git commit -m "feat(server): scaffold fastify app, config and initial schema"
```

---

### Task 2: 微信登录与鉴权

**Files:**
- Create: `server/src/auth/wechat-client.ts`, `server/src/auth/plugin.ts`, `server/src/auth/routes.ts`
- Modify: `server/src/deps.ts`, `server/src/app.ts`, `server/test/helpers.ts`
- Test: `server/test/auth.test.ts`, `server/test/wechat-client.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Deps`、`AppError`
- Produces:
  - `interface WechatClient { code2Session(code: string): Promise<{ openid: string }>; getAccessToken(): Promise<string> }`
  - `class HttpWechatClient implements WechatClient`，构造参数为 `(appId, secret, fetchFn = fetch)`。`code2Session` 调用 `GET https://api.weixin.qq.com/sns/jscode2session?appid&secret&js_code&grant_type=authorization_code`，返回 `errcode` 非 0 时抛 `AppError(401,'UNAUTHORIZED','登录失败，请重试')`。`getAccessToken` 调用 `POST https://api.weixin.qq.com/cgi-bin/stable_token`，结果缓存到 `expires_in - 300` 秒。
  - 测试用 `FakeWechatClient`：`code2Session('code_<x>')` 返回 `{ openid: '<x>' }`，其他 code 一律抛 401。
  - `POST /auth/wechat { code }` 返回 `{ token: string }`（JWT，`sub` 为 users.id，有效期 30 天）。
  - `app.requireUser` preHandler：校验 Bearer token，设置 `req.userId: string`，失败返回 401 `UNAUTHORIZED`。除 `/health`、`/auth/*`、`/files/*`、`/wechat/push` 外，所有路由都要挂上它。
  - 测试辅助：`login(app, openid = 'A'): Promise<string>` 返回 token；`authHeader(token)` 返回 `{ authorization: 'Bearer ' + token }`。
- 首次登录时创建用户，并插入默认分类：`投资`、`学习`、`好文章`、`生活`（sort_order 依次为 0–3）。

- [ ] **Step 1: 写失败的测试**

```ts
it('首次登录创建用户和默认分类，再次登录还是同一个用户', async () => {
  const t1 = await login(app, 'A'); const t2 = await login(app, 'A')
  expect(decodeSub(t1)).toBe(decodeSub(t2))
  const ids = await deps.db.selectFrom('user_identities').selectAll().execute()
  expect(ids).toEqual([expect.objectContaining({ provider: 'wechat', subject: 'A' })])
  const cats = await deps.db.selectFrom('categories').select('name').orderBy('sort_order').execute()
  expect(cats.map(c => c.name)).toEqual(['投资','学习','好文章','生活'])
})
it('非法 code 返回 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/auth/wechat', payload: { code: 'bad' } })
  expect(res.statusCode).toBe(401)
  expect(res.json().error.code).toBe('UNAUTHORIZED')
})
it('没有 token 访问受保护路由返回 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/categories' })
  expect(res.statusCode).toBe(401)
})
```

`wechat-client.test.ts`：注入假的 `fetchFn`，断言请求 URL 带上了 `js_code`；`errcode: 40029` 时抛出 401；连续两次 `getAccessToken` 只调用一次 fetch。

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm vitest run test/auth.test.ts test/wechat-client.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现。** 登录时在一个事务里：先按 (provider, subject) 查找身份，找不到就创建 user、identity 和默认分类。`/categories` 路由先注册一个只返回 `[]` 的占位，Task 3 再替换。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server && git commit -m "feat(server): wechat login with decoupled identities and jwt auth"
```

---

### Task 3: 分类与主题的增删改

**Files:**
- Create: `server/src/categories/routes.ts`, `server/src/topics/routes.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/categories-topics.test.ts`

**Interfaces:**
- Consumes: `requireUser`、`req.userId`、`AppError`
- Produces:
  - `GET /categories` → `{ items: { id, name, sortOrder }[] }`，按 sort_order、created_at 排序
  - `POST /categories { name }` → 201 + 该分类，新分类排在最后。`PATCH /categories/:id { name?, sortOrder? }`。`DELETE /categories/:id` → 204
  - `POST /topics { name, categoryId: string | null }` → 201 `{ id, name, categoryId }`。`PATCH /topics/:id { name?, categoryId? }`。`DELETE /topics/:id` → 204
  - 名称先 trim：分类 1–20 字，主题 1–50 字，否则返回 400。同一用户下重名返回 409 `CONFLICT`，提示「已存在同名分类」或「已存在同名主题」
  - `categoryId` 必须属于本人，否则返回 404
  - `GET /topics` 概览在 Task 7 实现

- [ ] **Step 1: 写失败的测试**

```ts
it('删除分类后主题保留且变为未分类', async () => {
  const c = await post('/categories', { name: '宏观' })
  const t = await post('/topics', { name: '十五五规划', categoryId: c.id })
  await del(`/categories/${c.id}`)
  const row = await deps.db.selectFrom('topics').selectAll().where('id','=',t.id).executeTakeFirstOrThrow()
  expect(row.category_id).toBeNull()
})
it('重名分类返回 409，空名返回 400', ...)   // 断言 error.code 分别为 CONFLICT、VALIDATION
it('B 不能读改删 A 的分类与主题，也不能把主题挂到 A 的分类下', async () => {
  // 以 A 创建分类 cA、主题 tA；以 B 执行：
  // PATCH /categories/cA、DELETE /categories/cA、PATCH /topics/tA、DELETE /topics/tA、POST /topics {categoryId: cA}
  // 每个都断言 404；最后断言 A 的数据原样存在
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm vitest run test/categories-topics.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现两组路由。** 所有查询都带 `where user_id = req.userId`；更新或删除影响 0 行时返回 404。唯一约束冲突（23505）转成 409。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server && git commit -m "feat(server): categories and topics crud with per-user isolation"
```

---

### Task 4: 内容安全检查模块

**Files:**
- Create: `server/src/moderation/checker.ts`
- Modify: `server/src/deps.ts`（按 `config.contentCheck` 选择实现）
- Test: `server/test/checker.test.ts`

**Interfaces:**
- Consumes: `WechatClient.getAccessToken()`
- Produces:
  - `interface ContentChecker { checkText(text: string, openid: string | null): Promise<'pass' | 'reject'>; submitImage(url: string, openid: string | null): Promise<{ status: 'ok' } | { status: 'pending'; traceId: string }> }`
  - 检查服务不可用（网络错误、超时 5 秒、errcode 非 0 且不是 87014）时，抛 `AppError(503,'CHECK_UNAVAILABLE','内容检查暂时不可用，内容已保留，请稍后再试')`
  - `PassThroughChecker`：`checkText` 总是返回 `'pass'`，`submitImage` 总是返回 `{ status: 'ok' }`
  - `WechatChecker(wechat, fetchFn = fetch)`：
    - `checkText` 把文本按 2500 字分段，逐段调用 `POST https://api.weixin.qq.com/wxa/msg_sec_check?access_token=…`，请求体为 `{ content, version: 2, scene: 4, openid }`。`result.suggest === 'risky'` 或 errcode 87014 视为 reject；`review` 视为 pass，避免误伤。空文本直接返回 pass，不调用接口。
    - `submitImage` 调用 `POST /wxa/media_check_async`，请求体为 `{ media_url, media_type: 2, version: 2, scene: 4, openid }`，返回 `{ status: 'pending', traceId }`
    - `openid` 为 null（以后 App 端的用户）时，直接返回 pass/ok。App 阶段再换成其他服务。

- [ ] **Step 1: 写失败的测试**

```ts
it('长文本按 2500 字分段，任意一段 risky 即 reject', async () => {
  const fetchFn = fakeFetch([{ errcode: 0, result: { suggest: 'pass' } }, { errcode: 0, result: { suggest: 'risky' } }])
  const c = new WechatChecker(fakeWechat, fetchFn)
  expect(await c.checkText('字'.repeat(4000), 'A')).toBe('reject')
  expect(fetchFn.calls).toHaveLength(2)
  expect(JSON.parse(fetchFn.calls[0].body).content).toHaveLength(2500)
})
it('review 视为通过', ...)
it('空文本不调用接口', ...)
it('网络错误或 errcode=-1 抛 CHECK_UNAVAILABLE', async () => {
  await expect(c.checkText('x', 'A')).rejects.toMatchObject({ status: 503, code: 'CHECK_UNAVAILABLE' })
})
it('submitImage 返回 pending 和 traceId', ...)
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm vitest run test/checker.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `checker.ts`，并在 `createDeps` 中按 `contentCheck` 选择实现。** 超时用 `AbortSignal.timeout(5000)`。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server && git commit -m "feat(server): switchable content checker with wechat implementation"
```

---

### Task 5: 图片上传、私有访问与异步检查回调

**Files:**
- Create: `server/src/images/storage.ts`, `server/src/images/signed-url.ts`, `server/src/images/routes.ts`, `server/src/moderation/push-routes.ts`
- Modify: `server/src/deps.ts`, `server/src/app.ts`, `server/test/helpers.ts`（使用临时目录作为存储）
- Test: `server/test/images.test.ts`

**Interfaces:**
- Consumes: `ContentChecker.submitImage`、`requireUser`
- Produces:
  - `interface FileStorage { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer | null>; remove(key: string): Promise<void> }`，以及 `LocalFileStorage(dir)`。key 的格式为 `<userId>/<uuid>.<ext>`。
  - `signFileUrl(key: string, secret: string, baseUrl: string, ttlSec = 3600): string`，生成 `${baseUrl}/files/${key}?exp=…&sig=…`，sig 为 HMAC-SHA256(key + exp) 的 hex
  - `verifyFileUrl(key, exp, sig, secret, now = Date.now()): boolean`，使用 timing-safe 比较
  - `POST /images`（multipart 字段 `file`）：仅接受 `image/jpeg|png|webp|gif`，单张 ≤ 10MB，否则返回 400。成功返回 201 `{ id, url, status }`，此时 `record_id` 为空，等保存记录时再挂上
  - `GET /files/*`：签名无效或过期返回 403；图片状态为 rejected 时返回 404
  - 微信消息推送 `/wechat/push`（明文模式，JSON 格式）：
    - `GET` 用于接入校验：`sha1(sort([token, timestamp, nonce]).join(''))` 等于 `signature` 时，原样返回 `echostr`，否则返回 403
    - `POST` 同样先校验签名。收到 `Event === 'wxa_media_check'` 时，按 `trace_id` 更新图片：`result.suggest === 'risky'` 设为 `rejected`，否则设为 `ok`。然后返回 `success`
  - `toImageView(row, config): { id: string; url: string | null; status: 'ok' | 'pending' | 'rejected' }`，rejected 时 url 为 null。供 Task 6 使用。

- [ ] **Step 1: 写失败的测试**

```ts
it('上传后返回签名 URL，可以取回原文件', ...)
it('非图片类型或超过 10MB 返回 400', ...)
it('签名被篡改或已过期返回 403', ...)
it('推送 risky 后图片变为 rejected，文件无法再访问', async () => {
  // checker 替身让 submitImage 返回 { status:'pending', traceId:'t1' }
  // 带正确签名 POST /wechat/push { Event:'wxa_media_check', trace_id:'t1', result:{ suggest:'risky' } }
  // 断言 DB 中 status==='rejected'，并且原 URL 返回 404
})
it('推送签名错误返回 403，不修改数据', ...)
it('GET /wechat/push 签名正确时回显 echostr', ...)
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm vitest run test/images.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现。** 上传流程：先写入存储，再插入一行（`status` 取 submitImage 的结果），提交给 `submitImage` 的地址是签名 URL，有效期 24 小时。用户的 openid 从 `user_identities` 中 provider='wechat' 的那一行取。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server && git commit -m "feat(server): private image upload with signed urls and async moderation callback"
```

---

### Task 6: 记录的保存、读取与删除

**Files:**
- Create: `server/src/records/tags.ts`, `server/src/records/service.ts`, `server/src/records/routes.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/tags.test.ts`, `server/test/records.test.ts`

**Interfaces:**
- Consumes: `ContentChecker.checkText`、`FileStorage.remove`、`toImageView`
- Produces:
  - `extractTags(texts: string[]): string[]`：匹配 `/[#＃]([\p{L}\p{N}_]+)/gu`，结果去重并保留首次出现的顺序，区分大小写
  - `type RecordInput = { topicId: string | null; recordDate: string; body: string; links: string[]; excerpts: { quote: string; thought: string; starred: boolean }[]; imageIds: string[] }`
  - `type RecordView = { id; topicId: string | null; topic: { id; name } | null; recordDate; body; links; excerpts: { id; quote; thought; starred }[]; images: ImageView[]; tags: string[]; createdAt; updatedAt }`
  - `saveRecord(deps, userId, input: RecordInput, recordId?: string): Promise<string>`：负责新建或整体替换
  - `loadRecordViews(db, config, userId, ids: string[]): Promise<RecordView[]>`：按传入的 ids 顺序返回。Task 7 会复用它
  - `POST /records` → 201 RecordView；`GET /records/:id`；`PUT /records/:id` → RecordView（整体替换）；`DELETE /records/:id` → 204
- 校验规则（违反返回 400）：`recordDate` 必须是合法日期，`2026-02-30` 不合法。body ≤ 20000 字；quote 1–5000 字，thought ≤ 5000 字；excerpts ≤ 50 条；links ≤ 10 条且必须是 http(s) 地址；imageIds ≤ 9 张。body、excerpts、imageIds 不能同时为空，否则提示「记录不能为空」。
- 保存流程：
  1. 校验输入
  2. 检查 `topicId`、`imageIds` 都属于本人，否则返回 404
  3. 调用 `checkText`，内容为 body、所有 quote 和 thought、links 用 `\n` 拼接。返回 reject 时报 422 `CONTENT_REJECTED`，提示「内容未通过安全检查，请修改后再保存」；返回 503 时直接透传。这两种情况都不写库
  4. 在一个事务里：写入记录、删除旧摘抄后按顺序重建、更新图片的 record_id 和 position、解除不再引用的图片、根据 body 和所有 thought 用 `extractTags` 重建 record_tags
  5. 事务提交后，删除被解除图片的文件和行

  标签只从 body 和 thought 里提取，摘抄原文里的 `#` 不算标签。
- 删除记录时，同时删除它的图片文件。

- [ ] **Step 1: 写失败的测试 `tags.test.ts`**

```ts
it.each([
  [['#十五五 和 #投资'], ['十五五','投资']],
  [['＃投资，看好'], ['投资']],
  [['只有 # 号'], []],
  [['#投资 #投资'], ['投资']],
  [['#AI #ai'], ['AI','ai']],
  [['结尾#新能源'], ['新能源']],
])('extractTags(%j) → %j', (input, out) => expect(extractTags(input)).toEqual(out))
```

- [ ] **Step 2: 写失败的测试 `records.test.ts`**

```ts
it('保存带摘抄、★、图片和标签的记录，再读回', async () => {
  // 输入：topicId 为十五五主题；body: '今天规划发布 #投资'；
  // excerpts: [{quote:'加快建设现代化产业体系', thought:'新能源 #新能源', starred:true}, {quote:'人工智能+', thought:'', starred:false}]
  // 断言：excerpts 顺序和 starred 正确；tags 为 ['投资','新能源']；images[0].url 非空；topic.name === '十五五规划'
})
it('内容被拒时返回 422，什么都不写入', async () => {
  // checker 替身让 checkText 返回 'reject'；断言 records 表为空，图片的 record_id 仍为 null
})
it('检查服务不可用时返回 503，什么都不写入', ...)
it('PUT 移除一张图片：文件被删除，行也被删除', ...)
it('非法日期 2026-02-30 和空记录返回 400', ...)
it('B 不能读、改、删 A 的记录，也不能挂 A 的 topicId 或 imageIds', ...)  // 都返回 404，A 的记录不变
it('删除主题后记录保留且 topicId 为 null', ...)
```

- [ ] **Step 3: 运行，确认失败**

Run: `pnpm vitest run test/tags.test.ts test/records.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 `tags.ts`、`service.ts` 和 `routes.ts`**

- [ ] **Step 5: 运行，确认通过**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add server && git commit -m "feat(server): record save/load/delete with excerpts, tags, images and moderation"
```

---

### Task 7: 回看接口：时间线、日历、主题概览、标签、搜索、★

**Files:**
- Create: `server/src/queries/routes.ts`
- Modify: `server/src/records/routes.ts`（新增 `GET /records`），`server/src/topics/routes.ts`（新增 `GET /topics`、`GET /topics/:id`）
- Test: `server/test/queries.test.ts`

**Interfaces:**
- Consumes: `loadRecordViews`
- Produces:
  - `GET /records?date=&topicId=&tag=&q=&starred=1&cursor=&limit=`：返回 `{ items: RecordView[]; nextCursor: string | null }`
    - 各条件之间是 AND 关系。排序为 `record_date desc, created_at desc, id desc`；`limit` 默认 20，最大 50
    - `cursor` 是上一页最后一条的 `(record_date, created_at, id)` 做 base64url 编码，格式不对时返回 400
    - `q` 先 trim，为空时视同没传。匹配 body、quote、thought 任意一处（ILIKE），`%`、`_`、`\` 都要转义
    - `starred=1` 表示至少有一张摘抄卡片是 ★ 的记录
    - `tag` 精确匹配标签名
  - `GET /calendar?month=YYYY-MM` → `{ days: { date: string; count: number }[] }`，只返回有记录的日子，按日期升序。month 格式不对时返回 400
  - `GET /tags` → `{ items: { name; count }[] }`，只返回 count > 0 的标签，按 count 降序、name 升序排列
  - `GET /excerpts/starred?cursor=&limit=` → `{ items: { excerpt: { id; quote; thought; starred: true }; record: { id; recordDate; topic: { id; name } | null } }[]; nextCursor }`，排序同时间线
  - `GET /topics` → `{ categories: { id; name; sortOrder; topics: TopicSummary[] }[]; uncategorized: TopicSummary[] }`
    - `TopicSummary = { id; name; categoryId; recordCount; starredCount; lastRecordDate: string | null }`
    - 组内按 `lastRecordDate desc nulls last, name` 排序。没有主题的分类也要出现在 `categories` 里
    - `starredCount` 统计的是 ★ 摘抄卡片的张数
  - `GET /topics/:id` → `TopicSummary`

- [ ] **Step 1: 写失败的测试**

```ts
// beforeEach：以 A 建好
// 记录1 2026-11-06 十五五 ★ #投资；记录2 2026-11-05 无主题 '读书 50%进度'；记录3 2026-11-03 #生活
// B 建一条 2026-11-06 #投资 的记录
it('时间线倒序，分页拼起来不重不漏，看不到 B 的记录', async () => {
  // limit=2 → 2 条 + nextCursor；第二页 1 条，nextCursor 为 null；三条 id 顺序为 1,2,3
})
it('date / topicId / tag / starred 过滤', ...)
it('搜索：命中 quote 和 thought；q="%" 只匹配字面的 % ；q="  " 返回全部', async () => {
  // q='50%' → 只有记录2；q='%' → 只有记录2；q='  ' → 3 条
})
it('非法 cursor 或 month 返回 400', ...)
it('日历 2026-11 返回三个有记录的日子，2026-10 返回空数组', ...)
it('标签计数：删掉唯一一条 #生活 记录后，生活不再出现', ...)
it('★ 列表只包含 A 的 ★ 摘抄，并带上记录日期和主题', ...)
it('主题概览：记录换主题后新旧主题的计数都更新；空分类也会出现', ...)
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm vitest run test/queries.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现。** 列表先用 Kysely 查出 id 列表（条件和排序在 SQL 里完成），再调用 `loadRecordViews`。所有查询都加 `user_id = req.userId`。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server && git commit -m "feat(server): timeline, calendar, topics overview, tags, search and starred queries"
```

---

### Task 8: Docker 部署与自动备份

**Files:**
- Create: `server/Dockerfile`, `docker-compose.yml`, `deploy/backup.sh`, `deploy/README.md`
- Modify: `server/.env.example`（列出所有变量和说明）

**Interfaces:**
- Consumes: `server.ts`（启动时先 `migrateToLatest` 再监听端口）
- Produces:
  - `server/Dockerfile`：多阶段构建，基础镜像 `node:22-alpine`。先 `pnpm build` 编译到 `dist/`，运行阶段只装生产依赖，`CMD ["node","dist/server.js"]`
  - `docker-compose.yml` 包含三个服务：
    - `db`：postgres:16，数据卷 `pgdata`，有 healthcheck
    - `api`：从 `server/` 构建，`env_file: server/.env`，挂载 `uploads:/data/uploads`（`STORAGE_DIR=/data/uploads`），在 db healthy 后启动，暴露端口 `3000:3000`
    - `backup`：postgres:16 镜像，循环执行 `deploy/backup.sh`。每 24 小时 `pg_dump -Fc` 一次，输出到挂载的 `./backups/wxdaily-YYYYmmdd-HHMM.dump`，并删除 14 天前的备份文件。uploads 卷同时用 tar 打包到同一目录
  - `deploy/README.md`：说明服务器上的部署步骤（复制 .env、`docker compose up -d --build`）、开发者工具里关闭「校验合法域名」并通过 IP 或 hosts 访问、以及如何用备份恢复（`pg_restore`）

- [ ] **Step 1: 写好上述文件**

- [ ] **Step 2: 校验 compose 文件**

Run: `docker compose config -q`（在仓库根目录执行）
Expected: 无输出，退出码 0

- [ ] **Step 3: 本机或服务器上冒烟测试**

Run: `docker compose up -d --build && curl -s localhost:3000/health`
Expected: `{"ok":true}`

- [ ] **Step 4: 验证备份**

Run: `docker compose exec backup sh /deploy/backup.sh && ls backups/`
Expected: 出现一个 `.dump` 文件和一个 uploads 的 tar 包

- [ ] **Step 5: 提交**

```bash
git add server/Dockerfile docker-compose.yml deploy server/.env.example
git commit -m "chore(deploy): docker compose with daily pg and uploads backup"
```
