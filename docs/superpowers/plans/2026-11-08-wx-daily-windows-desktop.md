# Windows 桌面版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有的微信小程序 + Postgres 后端改造成一个 Windows 桌面应用：Electron 外壳内置 Fastify 服务，数据用 SQLite 存在用户自己的文档目录，断网可用。

**Architecture:** Electron 主进程直接 import 现有的 `server/src` 代码，在进程内启动 Fastify，只监听 `127.0.0.1:47821`；同一个 Fastify 用 `@fastify/static` 托管 uni-app 的 H5 构建产物，窗口加载 `http://127.0.0.1:47821/`（同源，无 CORS）。数据层把 Postgres 换成 `node:sqlite`，通过一个适配 Kysely `SqliteDialect` 的薄包装接入。登录退化为单用户本地令牌。

**Tech Stack:** Electron 45、Fastify 5、Kysely 0.28.5（内置 `SqliteDialect`）、`node:sqlite`、uni-app H5、electron-builder。

**Spec:** `docs/superpowers/specs/2026-11-08-wx-daily-windows-desktop-design.md`

## Global Constraints

- 分支：`smile-style/windows_daily`。这是**单向分叉**，不要求 `build:mp-weixin` 仍然可用，也不需要与 `dev1` 保持同步。
- 数据目录：`%USERPROFILE%\Documents\wx-daily\`，若 Documents 被 OneDrive 接管则回退到 `%USERPROFILE%\wx-daily\`。可用环境变量 `WXDAILY_DATA_DIR` 覆盖。
- 固定端口 `47821`。不得改成随机端口（localStorage 按 origin 隔离，端口变则草稿丢失）。
- 不导入小程序的历史数据，首启为空库。
- 所有面向用户的中文文案、错误消息、默认分类名（`投资 / 学习 / 好文章 / 生活`）沿用现有实现，不得改写。
- 所有对用户的报错走现有 `{ error: { code, message } }` 结构。
- `server/test/tags.test.ts` 是纯函数测试，全程保留不动。
- 每完成一个 Task 提交一次 git commit。

## 执行前必读：这台机器上没有 Postgres

**本机没有安装 Docker，也没有可用的 Postgres。** 因此：

- 不要尝试 `docker compose up`、不要尝试连接 `localhost:5433`，也不要为了跑测试去装数据库。
- 现有 `server/test` 全套在 Task 3 之前是**跑不起来的**（`helpers.ts` 连的是 Postgres）。这不代表你改坏了什么。
- 从 Task 3 起，测试套件才在 SQLite 上恢复可运行。Task 1、Task 2 各自的测试是自包含的，可以独立跑绿。
- 任务顺序是刻意排的：先证明 `node:sqlite` 可用 → 再写驱动适配器 → 再整体切换数据层并同步修 SQL 方言 → 之后才动登录和前端。

## 已实测确认的 SQLite 事实（写代码前必须知道）

这些结论已在目标环境（Node 26 / SQLite 3.54）用 `node:sqlite` 实测，不要凭 SQLite 常识推翻：

| 事实 | 后果 |
|---|---|
| Kysely 0.28.5 **自带** `SqliteDialect`，需要的是 `{ close(), prepare(sql) }` 形状的对象 | 不需要自己写方言，只写驱动适配器 |
| `node:sqlite` 的 statement **没有 `reader` 属性** | 适配器用 `stmt.columns().length > 0` 推导，且必须用 getter 延迟求值 |
| `node:sqlite` 的 `all(array)` 会把数组当成**具名参数**并报错 | 适配器必须 `all(...params)` 展开 |
| 绑定 `Date` 对象会**静默写入 NULL** | 适配器必须把 `Date` 转 ISO 字符串 |
| `count(*)::int` 在 SQLite 语法错误 | 改成 `cast(count(*) as integer)` |
| `ilike` 在 SQLite 语法错误 | 改成 `lower(x) like lower(?)` |
| 行值比较 `(a,b,c) < (?,?,?)` **不报错但结果错误** | 必须改写成显式 `or/and` 展开 |
| `NULLS LAST`、`ON CONFLICT DO NOTHING`、`RETURNING`、`json_extract` 都可用 | 保持不变 |
| 唯一约束冲突：`error.errcode === 2067`（主键冲突是 `1555`） | 冲突判断要改 |
| `VACUUM INTO '<path>'` 可用 | 用它做数据库备份，不要直接复制文件 |
| `pragma journal_mode = wal`、`pragma busy_timeout` 可用；外键默认已开启 | 连接后设置 |
| 非确定性的 `randomblob()` 可以作为列的 DEFAULT | UUID 默认值可以在建表时声明 |

## Review Focus

按「最可能让使用者踩坑」排序。每一条都必须在指定 Task 里有测试钉住：

1. **翻页游标**：记录多于一页时往下翻，不能重复或跳过（行值比较改写后最容易错位）。
2. **重启后会话**：关掉窗口再打开，不应停在「请先登录」，草稿还在。
3. **搜索**：中文子串、大小写混排、含 `%` / `_` 的字面量都要能搜到且不误匹配。
4. **数据目录**：OneDrive 接管「文档」时不能把数据库写进同步盘。
5. **日期边界**：跨月、跨年的日历绿点与「今天」判定不能错一天。

## File Structure

**新建**

```
desktop/
  package.json                  Electron 依赖与打包脚本
  tsconfig.json                 同时编译 desktop/src 与 ../server/src
  electron-builder.yml          NSIS 安装包配置
  src/data-dir.ts               数据目录解析（含 OneDrive 回退）
  src/secrets.ts                jwtSecret / fileUrlSecret 的生成与复用
  src/backup.ts                 VACUUM INTO 备份与保留策略
  src/preload.ts                暴露 openDataFolder / dataPath
  src/main.ts                   主进程入口
  test/data-dir.test.ts
  test/secrets.test.ts
  test/backup.test.ts
server/src/db/sqlite.ts         驱动适配器 + createSqliteDb
server/src/auth/local.ts        ensureLocalUser + DEFAULT_CATEGORIES
server/test/sqlite-adapter.test.ts
```

**修改**

```
server/src/db/db.ts             createDb → 委托 sqlite.ts；表类型 links/boolean/timestamp 改 TEXT/INTEGER
server/src/db/migrations/001_init.ts   重写为 SQLite 版
server/src/config.ts            字段改为 dataDir/databaseFile/webRoot，去掉微信
server/src/deps.ts              去掉 wechat、checker
server/src/app.ts               去掉 moderation 路由，注册 @fastify/static
server/src/server.ts            改用新配置与 createDb
server/src/auth/routes.ts       /auth/wechat → /auth/local
server/src/records/service.ts   去掉 checker，links 读写 JSON，时间字段转换
server/src/images/routes.ts     去掉 checker，status 固定 ok
server/src/queries/routes.ts    游标、搜索、count、时间格式改造
server/src/topics/routes.ts     count / ::text / starred 改造
server/src/categories/routes.ts 冲突错误码改造
server/test/helpers.ts          ✓ Task 3 改 SQLite；✓ Task 4 改 loginAs
server/test/health.test.ts      查 sqlite_master
app/src/config.ts               API_BASE_URL 默认 ''
app/src/api/auth.ts             loginLocal
app/src/stores/auth.ts          改为调 /auth/local
app/src/pages/mine/index.vue    账号卡片文案 + 打开数据文件夹
app/test/auth.test.ts           重写
```

**删除**

```
server/src/auth/wechat-client.ts
server/src/moderation/           整个目录（checker.ts、push-routes.ts）
server/test/wechat-client.test.ts
server/test/checker.test.ts
server/test/deployment-config.test.ts
```

---

### Task 1: 验证 Electron 里的 `node:sqlite`

这一步决定整个数据层走哪条路，必须先做。

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/src/spike.ts`（临时，验证完删除）
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: spec §4.2 的一行实测结论；Task 2 依赖此结论。

- [ ] **Step 1: 建 `desktop/package.json`**

```json
{
  "name": "wx-daily-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/desktop/src/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "electron .",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^24.3.0",
    "electron": "^45.2.3",
    "electron-builder": "^26.18.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: 装依赖**

Run: `cd desktop && npm install`
Expected: 安装成功，`node_modules/.bin/electron` 存在。

- [ ] **Step 3: 写临时 spike 入口 `desktop/src/spike.ts`**

Electron 主进程脚本：`app.whenReady()` 之后用 `import { DatabaseSync } from 'node:sqlite'` 建内存库、建一张表、插入一行中文、读回、`console.log(JSON.stringify(rows))`，然后 `app.exit(0)`。用 `try/catch` 包住，失败时 `console.error('node:sqlite 不可用:', error.message)` 并 `app.exit(1)`。

- [ ] **Step 4: 运行 spike**

Run: `cd desktop && npx tsc src/spike.ts --module nodenext --moduleResolution nodenext --outDir dist-spike && npx electron dist-spike/spike.js`
Expected: 打印含中文的那一行，退出码 0。

- [ ] **Step 5: 记录结论**

若成功：在 spec §4.2 末尾追加一行 `> 实测（2026-11-08）：Electron 45 主进程中 node:sqlite 可用。`
若失败：**停下来**，把错误原文报告给发起人，不要自行改走 `better-sqlite3`。

- [ ] **Step 6: 清理并提交**

删掉 `desktop/src/spike.ts` 与 `desktop/dist-spike`。往根 `.gitignore` 追加 `desktop/node_modules/`、`desktop/dist/`。

```bash
git add desktop/package.json desktop/package-lock.json .gitignore docs/superpowers/specs/
git commit -m "chore(desktop): 验证 Electron 内置 node:sqlite 可用"
```

---

### Task 2: SQLite 驱动适配器

**Files:**
- Create: `server/src/db/sqlite.ts`
- Create: `server/test/sqlite-adapter.test.ts`

**Interfaces:**
- Consumes: `node:sqlite` 的 `DatabaseSync`；Kysely 的 `SqliteDialect`、`SqliteDatabase`、`SqliteStatement` 类型
- Produces:
  - `normalizeParameter(value: unknown): unknown`
  - `createNodeSqliteDatabase(filename: string)` — 满足 Kysely 的 `SqliteDatabase`
  - `createSqliteDb(filename: string): Kysely<DB>` — Task 3 用它实现 `createDb`

- [ ] **Step 1: 写失败测试**

`server/test/sqlite-adapter.test.ts`：

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql, type Kysely } from 'kysely'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteDb } from '../src/db/sqlite.js'
import type { DB } from '../src/db/db.js'

const dirs: string[] = []
const dbs: Kysely<DB>[] = []

async function tempDb(): Promise<Kysely<DB>> {
  const dir = await mkdtemp(join(tmpdir(), 'wx-daily-sqlite-'))
  dirs.push(dir)
  const db = createSqliteDb(join(dir, 'app.db'))
  dbs.push(db)
  return db
}

afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => db.destroy()))
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('sqlite 驱动适配器', () => {
  it('能建表、插入中文、读回', async () => {
    const db = await tempDb()
    await sql`create table t (a text, b integer)`.execute(db)
    await sql`insert into t (a, b) values (${'中文'}, ${1})`.execute(db)
    const rows = await sql<{ a: string; b: number }>`select a, b from t`.execute(db)
    expect(rows.rows).toEqual([{ a: '中文', b: 1 }])
  })

  it('Date 参数被存成 ISO 字符串而不是 NULL', async () => {
    const db = await tempDb()
    await sql`create table t (d text)`.execute(db)
    const now = new Date('2026-11-08T01:02:03.400Z')
    await sql`insert into t (d) values (${now})`.execute(db)
    const rows = await sql<{ d: string }>`select d from t`.execute(db)
    expect(rows.rows[0]?.d).toBe('2026-11-08T01:02:03.400Z')
  })

  it('boolean 参数存成 0/1', async () => {
    const db = await tempDb()
    await sql`create table t (b integer)`.execute(db)
    await sql`insert into t (b) values (${true})`.execute(db)
    const rows = await sql<{ b: number }>`select b from t`.execute(db)
    expect(rows.rows[0]?.b).toBe(1)
  })

  it('读取与写入语句都能正确执行', async () => {
    const db = await tempDb()
    await sql`create table t (a text)`.execute(db)
    await sql`insert into t (a) values (${'x'})`.execute(db)
    await sql`update t set a = ${'y'}`.execute(db)
    const rows = await sql<{ a: string }>`select a from t`.execute(db)
    expect(rows.rows).toEqual([{ a: 'y' }])
  })

  it('事务提交后可见，抛错后回滚不留痕', async () => {
    const db = await tempDb()
    await sql`create table t (a text)`.execute(db)
    await db.transaction().execute(async (trx) => {
      await sql`insert into t (a) values (${'kept'})`.execute(trx)
    })
    await expect(
      db.transaction().execute(async (trx) => {
        await sql`insert into t (a) values (${'dropped'})`.execute(trx)
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    const rows = await sql<{ a: string }>`select a from t`.execute(db)
    expect(rows.rows).toEqual([{ a: 'kept' }])
  })

  it('外键级联删除生效', async () => {
    const db = await tempDb()
    await sql`create table p (id text primary key)`.execute(db)
    await sql`create table c (id text primary key, pid text references p(id) on delete cascade)`.execute(db)
    await sql`insert into p (id) values (${'p1'})`.execute(db)
    await sql`insert into c (id, pid) values (${'c1'}, ${'p1'})`.execute(db)
    await sql`delete from p where id = ${'p1'}`.execute(db)
    const rows = await sql<{ n: number }>`select count(*) as n from c`.execute(db)
    expect(rows.rows[0]?.n).toBe(0)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd server && npx vitest run test/sqlite-adapter.test.ts`
Expected: FAIL，`Failed to resolve import "../src/db/sqlite.js"`。

- [ ] **Step 3: 实现 `server/src/db/sqlite.ts`**

照抄这些决定，不要另辟蹊径：

- 导入：`import { DatabaseSync } from 'node:sqlite'`、`import { Kysely, SqliteDialect } from 'kysely'`、`import type { DB } from './db.js'`。
- `export function normalizeParameter(value: unknown): unknown`：`value instanceof Date` → `value.toISOString()`；`typeof value === 'boolean'` → `value ? 1 : 0`；`value === undefined` → `null`；其余原样返回。
- 内部 `function wrap(stmt)` 返回一个同时满足 `SqliteStatement` 的对象：
  - `get reader()` → `stmt.columns().length > 0`。**必须是 getter**：Kysely 先 `prepare` 再读 `reader`，而 `columns()` 要求语句已就绪；getter 延迟求值才正确。
  - `all(params)` → `stmt.all(...params.map(normalizeParameter)).map(toPlain)`
  - `run(params)` → `stmt.run(...params.map(normalizeParameter))`
  - `iterate(params)` → 生成器，逐行 `stmt.iterate(...params.map(normalizeParameter))` 并 `toPlain`
  - `toPlain(row)` → `({ ...row })`，因为 `node:sqlite` 返回的是 null 原型对象，Kysely 与 zod 都按普通对象处理更安全。
- `export function createNodeSqliteDatabase(filename: string)`：`const db = new DatabaseSync(filename)`，执行 `db.exec('pragma journal_mode = wal')` 与 `db.exec('pragma busy_timeout = 5000')`，返回 `{ close: () => db.close(), prepare: (text: string) => wrap(db.prepare(text)) }`。
- `export function createSqliteDb(filename: string): Kysely<DB>`：`return new Kysely<DB>({ dialect: new SqliteDialect({ database: createNodeSqliteDatabase(filename) }) })`。

- [ ] **Step 4: 运行，确认通过**

Run: `cd server && npx vitest run test/sqlite-adapter.test.ts`
Expected: 6 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/db/sqlite.ts server/test/sqlite-adapter.test.ts
git commit -m "feat(server): 为 node:sqlite 增加 Kysely 驱动适配器"
```

---

### Task 3: 数据层整体切到 SQLite

这是最大的一步。做完之后 `server/test` 全量在 SQLite 上跑绿，Task 2 的适配器被真正用起来。

**Files:**
- Modify: `server/src/db/db.ts`
- Rewrite: `server/src/db/migrations/001_init.ts`
- Modify: `server/src/records/service.ts`
- Modify: `server/src/queries/routes.ts`
- Modify: `server/src/topics/routes.ts`
- Modify: `server/src/categories/routes.ts`
- Modify: `server/src/server.ts`
- Modify: `server/test/helpers.ts`
- Modify: `server/test/health.test.ts`
- Test: `server/test/queries.test.ts`（追加）、`server/test/records.test.ts`（追加）

**Interfaces:**
- Consumes: Task 2 的 `createSqliteDb(filename)`
- Produces:
  - `createDb(filename: string): Kysely<DB>`（签名从 URL 改为文件路径）
  - `toIsoString(value: string | Date): string`（放在 `server/src/db/db.ts`）
  - 表类型变化：`RecordsTable.links` 变 `Generated<string>`（JSON 文本）、`ExcerptsTable.starred` 变 `Generated<number>`、所有 `created_at` / `updated_at` 变 `Generated<string>`

- [ ] **Step 1: 改 `server/src/db/db.ts` 的表类型与 `createDb`**

- `UsersTable.created_at`、`CategoriesTable.created_at`、`TopicsTable.created_at`、`RecordsTable.created_at`/`updated_at`、`ImagesTable.created_at`：`Generated<Date>` → `Generated<string>`。
- `RecordsTable.links`：`Generated<string[]>` → `Generated<string>`。
- `ExcerptsTable.starred`：`Generated<boolean>` → `Generated<number>`。
- 删除 `PostgresDialect`、`Pool` 的 import 与 `createDb` 的旧实现，改为：

```ts
export function createDb(filename: string): Kysely<DB> {
  return createSqliteDb(filename)
}

export function toIsoString(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString()
}
```

`user_identities` 表与类型**保留**，Task 4 才会清理。

- [ ] **Step 2: 重写 `server/src/db/migrations/001_init.ts`**

用 `sql` 模板执行纯 SQL（不要用 `db.schema`）。定义两个常量并在建表时插值：

```ts
const UUID_DEFAULT = `(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))))`
const NOW_DEFAULT = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
```

表定义（`id` 一律 `text primary key default ${UUID_DEFAULT}`，时间列一律 `text not null default ${NOW_DEFAULT}`）：

- `users(id, created_at)`
- `user_identities(id, user_id text not null references users(id) on delete cascade, provider text not null, subject text not null, created_at, unique(provider, subject))`
- `categories(id, user_id ..., name text not null, sort_order integer not null default 0, created_at, unique(user_id, name))`
- `topics(id, user_id ..., category_id text references categories(id) on delete set null, name text not null, created_at, unique(user_id, name))`
- `records(id, user_id ..., topic_id text references topics(id) on delete set null, record_date text not null, body text not null default '', links text not null default '[]', created_at, updated_at)`
- `excerpts(id, record_id text not null references records(id) on delete cascade, user_id ..., position integer not null, quote text not null, thought text not null default '', starred integer not null default 0)`
- `images(id, user_id ..., record_id text references records(id) on delete set null, storage_key text not null, mime text not null, status text not null default 'ok', trace_id text, position integer not null default 0, created_at, constraint images_status_check check (status in ('pending','ok','rejected')))`
- `tags(id, user_id ..., name text not null, unique(user_id, name))`
- `record_tags(record_id text not null references records(id) on delete cascade, tag_id text not null references tags(id) on delete cascade, primary key (record_id, tag_id))`

索引只要一条：`create index records_user_date_idx on records (user_id, record_date desc, created_at desc)`。**不要**建 trgm 索引，不要写 `create extension`。

`down()` 按相反顺序 `drop table if exists`。

- [ ] **Step 3: 改 `server/test/helpers.ts` 用临时 SQLite 库**

- 删除 `databaseUrl`、`TEST_DATABASE_URL`、`resetDb`、`createDb(databaseUrl)` 相关代码，以及 `testConfig` 里的 `databaseUrl`。
- `createTestApp` 改为：`const dir = await mkdtemp(join(tmpdir(), 'wx-daily-test-'))`，`const db = overrides.db ?? createDb(join(dir, 'app.db'))`，`await migrateToLatest(db)`。
- `storageDir` = `join(dir, 'storage')`。
- `onClose` 里 `await rm(dir, { recursive: true, force: true })`，并销毁自己创建的 db。
- **此步保留** `FakeWechatClient` 与 `PassThroughChecker`（`Deps` 还没精简，Task 4 才删）。

- [ ] **Step 4: 改 `server/test/health.test.ts` 的表清单断言**

```ts
const tables = await sql<{ name: string }>`
  select name from sqlite_master where type = 'table' and name not like 'sqlite_%'
`.execute(deps.db)

expect(tables.rows.map((row) => row.name)).toEqual(
  expect.arrayContaining([
    'users', 'user_identities', 'categories', 'topics',
    'records', 'excerpts', 'images', 'tags', 'record_tags',
  ]),
)
```

- [ ] **Step 5: 改 `server/src/records/service.ts`**

- 写入：`links: JSON.stringify(parsed.links)`（`insert` 与 `update` 两处）。
- `loadRecordViews`：
  - `sql<string>\`record.record_date::text\`.as('record_date')` → `'record.record_date as record_date'`
  - `links: JSON.parse(record.links) as string[]`
  - `createdAt: toIsoString(record.created_at)`、`updatedAt: toIsoString(record.updated_at)`
  - `starred: excerpt.starred === 1`
- `saveRecord` 里 `.set({ updated_at: new Date() })` 保留不动（适配器会转成 ISO 字符串）。

- [ ] **Step 6: 改 `server/src/queries/routes.ts`**

1. **时间格式**：删掉两处 `to_char(record.created_at at time zone 'UTC', ...)`，改成 `'record.created_at as created_at'`；`record.record_date::text` 改成 `'record.record_date as record_date'`。
2. **游标正则**：`cursorTimestampSchema` 里的正则 `\.\d{6}Z` 改成 `\.\d{3}Z`（SQLite 的 `%f` 只给三位毫秒），并加一行注释说明原因。
3. **记录游标比较** — 把原来的行值比较

```ts
idsQuery = idsQuery.where(sql<boolean>`(
  record.record_date,
  record.created_at,
  record.id
) < (
  ${cursor.recordDate}::date,
  ${cursor.createdAt}::timestamptz,
  ${cursor.id}::uuid
)`)
```

改成显式展开：

```ts
idsQuery = idsQuery.where(sql<boolean>`(
  record.record_date < ${cursor.recordDate}
  or (
    record.record_date = ${cursor.recordDate}
    and record.created_at < ${cursor.createdAt}
  )
  or (
    record.record_date = ${cursor.recordDate}
    and record.created_at = ${cursor.createdAt}
    and record.id < ${cursor.id}
  )
)`)
```

不要写 `cast(... as text)`：SQLite 里这些列本来就是 TEXT，直接比较即可。
4. **starred 游标比较**：同样把四列行值比较展开成三级 `or`（`record_date` → `created_at` → `record.id` → `excerpt.id`）。
5. **计数**：`/calendar` 与 `/tags` 里的 `count(*)::int` 改成 `cast(count(*) as integer)`，读出后包 `Number(...)`。
6. **搜索**：把 `ilike` 改成 `lower(...) like lower(...)`，三处（`record.body`、`search_excerpt.quote`、`search_excerpt.thought`）。`escapeLikeLiteral` 保持不动。

- [ ] **Step 7: 改 `server/src/topics/routes.ts`**

- `max(record.record_date)::text` → `cast(max(record.record_date) as text)`
- `count(distinct record.id)::int`、`count(excerpt.id)::int` → `cast(... as integer)`，读出后 `Number(...)`
- `excerpt.starred = true` → `excerpt.starred = 1`

- [ ] **Step 8: 改 `server/src/categories/routes.ts` 的唯一冲突判断**

```ts
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const errcode = (error as { errcode?: unknown }).errcode
  return errcode === 2067 || errcode === 1555
}
```

- [ ] **Step 9: 改 `server/src/server.ts` 的启动方式**

`const db = createDb(config.databaseFile)`（Postgres 版本用 `config.databaseUrl`，Task 4 才改 `Config`；此步先用现有 `Config.databaseUrl` 字段承载文件路径，等同于改字段名——见 Task 4 Step 5 的完整 `Config`。为避免中间态类型错乱，**此步直接把 `Config.databaseUrl` 重命名为 `databaseFile`**，并同步改 `loadConfig` 的 env 名 `DATABASE_URL` → `DATABASE_FILE`）。

- [ ] **Step 10: 追加游标翻页测试**

在 `server/test/queries.test.ts` 追加：

```ts
it('游标翻页不重复也不遗漏', async () => {
  const { app } = await createTestApp()
  apps.push(app)
  const token = await login(app)
  const created: string[] = []

  for (let i = 0; i < 5; i += 1) {
    const res = await app.inject({
      method: 'POST', url: '/records',
      headers: authHeader(token),
      payload: {
        topicId: null,
        recordDate: `2026-03-0${i + 1}`,
        body: `第 ${i} 条`,
        links: [], excerpts: [], imageIds: [],
      },
    })
    created.push(res.json().id)
  }

  const seen: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < 3; page += 1) {
    const res = await app.inject({
      method: 'GET',
      url: `/records?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      headers: authHeader(token),
    })
    const body = res.json() as { items: { id: string }[]; nextCursor: string | null }
    seen.push(...body.items.map((item) => item.id))
    cursor = body.nextCursor
  }

  expect(seen).toHaveLength(5)
  expect(new Set(seen).size).toBe(5)
  expect(seen).toEqual([...created].reverse())
})

it('搜索匹配中文子串，且把 % 和 _ 当作字面量', async () => {
  const { app } = await createTestApp()
  apps.push(app)
  const token = await login(app)

  for (const body of ['今天看了十五五规划', '折扣 100% 到手', 'a_b 命名']) {
    await app.inject({
      method: 'POST', url: '/records', headers: authHeader(token),
      payload: { topicId: null, recordDate: '2026-03-01', body, links: [], excerpts: [], imageIds: [] },
    })
  }

  const hit = await app.inject({
    method: 'GET', url: `/records?q=${encodeURIComponent('十五五')}`, headers: authHeader(token),
  })
  expect(hit.json().items).toHaveLength(1)

  const percent = await app.inject({
    method: 'GET', url: `/records?q=${encodeURIComponent('100%')}`, headers: authHeader(token),
  })
  expect(percent.json().items).toHaveLength(1)

  const underscore = await app.inject({
    method: 'GET', url: `/records?q=${encodeURIComponent('a_b')}`, headers: authHeader(token),
  })
  expect(underscore.json().items).toHaveLength(1)
})
```

- [ ] **Step 11: 追加时间字段测试**

在 `server/test/records.test.ts` 追加：

```ts
it('保存后 createdAt / updatedAt 是合法 ISO 字符串，links 读回是数组', async () => {
  const { app } = await createTestApp()
  apps.push(app)
  const token = await login(app)

  const created = await app.inject({
    method: 'POST', url: '/records', headers: authHeader(token),
    payload: {
      topicId: null, recordDate: '2026-03-01', body: 'x',
      links: ['https://example.com/a'], excerpts: [], imageIds: [],
    },
  })
  const body = created.json()
  expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt)
  expect(new Date(body.updatedAt).toISOString()).toBe(body.updatedAt)
  expect(body.links).toEqual(['https://example.com/a'])
})
```

- [ ] **Step 12: 跑全量测试**

Run: `cd server && npm test`
Expected: 全部 PASS。若有用例失败，按失败原因逐个修代码，**不要靠删用例或 `.skip` 过关**（唯一例外是 Task 4 Step 8 明确要删的那些）。

- [ ] **Step 13: 提交**

```bash
git add server/src server/test
git commit -m "feat(server): 数据层从 Postgres 切换到 SQLite"
```

---

### Task 4: 本机单用户登录，移除微信与内容审核

**Files:**
- Create: `server/src/auth/local.ts`
- Delete: `server/src/auth/wechat-client.ts`、`server/src/moderation/`（整个目录）
- Modify: `server/src/auth/routes.ts`、`server/src/deps.ts`、`server/src/app.ts`、`server/src/config.ts`、`server/src/records/service.ts`、`server/src/images/routes.ts`
- Delete: `server/test/wechat-client.test.ts`、`server/test/checker.test.ts`、`server/test/deployment-config.test.ts`
- Modify: `server/test/helpers.ts`、`server/test/auth.test.ts`、`server/test/images.test.ts`

**Interfaces:**
- Consumes: `Deps`、`createDb`、`Config`
- Produces:
  - `DEFAULT_CATEGORIES: readonly ['投资','学习','好文章','生活']`
  - `ensureLocalUser(db: Kysely<DB>): Promise<string>` — 幂等，返回唯一本地用户 id
  - `Deps = { config: Config; db: Kysely<DB>; storage: FileStorage }`
  - `Config = { port, databaseFile, dataDir, jwtSecret, fileUrlSecret, storageDir, publicBaseUrl, webRoot }`
  - `GET /auth/local` → `{ token: string }`
  - 测试辅助 `loginAs(app, deps, label)` 替代 `login(app, openid)`

- [ ] **Step 1: 写失败测试 — `/auth/local` 幂等且带默认分类**

把 `server/test/auth.test.ts` 里依赖 `/auth/wechat` 与 plpgsql 触发器的用例整段替换为：

```ts
it('GET /auth/local 返回可用 token', async () => {
  const { app } = await createTestApp()
  apps.push(app)
  const res = await app.inject({ method: 'GET', url: '/auth/local' })
  expect(res.statusCode).toBe(200)
  expect(typeof res.json().token).toBe('string')

  const me = await app.inject({
    method: 'GET', url: '/categories', headers: authHeader(res.json().token),
  })
  expect(me.statusCode).toBe(200)
})

it('重复调用 /auth/local 不会重复建用户', async () => {
  const { app, deps } = await createTestApp()
  apps.push(app)
  await app.inject({ method: 'GET', url: '/auth/local' })
  await app.inject({ method: 'GET', url: '/auth/local' })

  const users = await sql<{ n: number }>`select count(*) as n from users`.execute(deps.db)
  expect(users.rows[0]?.n).toBe(1)
})

it('首次登录写入四个默认分类', async () => {
  const { app } = await createTestApp()
  apps.push(app)
  const token = (await app.inject({ method: 'GET', url: '/auth/local' })).json().token
  const res = await app.inject({ method: 'GET', url: '/categories', headers: authHeader(token) })
  expect(res.json().items.map((item: { name: string }) => item.name)).toEqual([
    '投资', '学习', '好文章', '生活',
  ])
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd server && npx vitest run test/auth.test.ts`
Expected: FAIL，`/auth/local` 返回 404。

- [ ] **Step 3: 实现 `server/src/auth/local.ts`**

```ts
export const DEFAULT_CATEGORIES = ['投资', '学习', '好文章', '生活'] as const

export async function ensureLocalUser(db: Kysely<DB>): Promise<string>
```

行为：先 `select id from users order by created_at limit 1`；有则直接返回；没有则在一个事务里插入 `users` 一行，再按 `DEFAULT_CATEGORIES` 顺序插入 `categories`（`sort_order` 用下标），返回新 id。

- [ ] **Step 4: 改 `server/src/auth/routes.ts`**

删除 `loginBodySchema`、`defaultCategories`、`/auth/wechat` 路由，改为：

```ts
export function registerAuthRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/auth/local', async () => {
    const userId = await ensureLocalUser(deps.db)
    return { token: app.jwt.sign({ sub: userId }, { expiresIn: '30d' }) }
  })
}
```

- [ ] **Step 5: 改 `server/src/config.ts`**

```ts
export type Config = {
  port: number
  databaseFile: string
  dataDir: string
  jwtSecret: string
  fileUrlSecret: string
  storageDir: string
  publicBaseUrl: string
  webRoot: string | null
}
```

zod schema：`DATA_DIR` 必填；`PORT` 默认 `47821`；`DATABASE_FILE` 默认 `${DATA_DIR}/app.db`；`STORAGE_DIR` 默认 `${DATA_DIR}/images`；`JWT_SECRET`、`FILE_URL_SECRET` 必填；`PUBLIC_BASE_URL` 默认 `http://127.0.0.1:${PORT}`；`WEB_ROOT` 可选，缺省 `null`。**删除**全部 `WECHAT_*`、`CONTENT_CHECK`、`DATABASE_URL`。

- [ ] **Step 6: 精简 `Deps` 与 `app.ts`**

- `server/src/deps.ts` → `export type Deps = { config: Config; db: Kysely<DB>; storage: FileStorage }`，删除 `createChecker` 与相关 import。
- `server/src/app.ts` 删除 `registerWechatPushRoutes` 的 import 与调用。错误处理器整体保留。
- 删除 `server/src/moderation/` 目录与 `server/src/auth/wechat-client.ts`。

- [ ] **Step 7: 去掉业务代码里的审核与微信身份**

- `server/src/records/service.ts`：删掉 `identity` 查询、`checkedText` 拼接、`deps.checker.checkText` 调用与 `CONTENT_REJECTED` 分支（保留 `recordInputSchema` 校验）。
- `server/src/images/routes.ts`：删掉 `identity` 查询、`callbackUrl` 计算、`deps.checker.submitImage`；插入 `images` 时用 `status: 'ok'`、`trace_id: null`。
- `server/src/server.ts`：删掉 `HttpWechatClient`、`createChecker` 的构造，`buildApp` 只传 `{ config, db, storage }`。

- [ ] **Step 8: 改测试辅助与受影响用例**

- `server/test/helpers.ts`：删掉 `FakeWechatClient`、`PassThroughChecker`；`Deps` 只组装 `{ config, db, storage }`。新增导出：

```ts
export async function loginAs(
  app: FastifyInstance,
  deps: Deps,
  label = 'A',
): Promise<string> {
  const user = await deps.db
    .insertInto('users')
    .values({ created_at: new Date().toISOString() })
    .returning('id')
    .executeTakeFirstOrThrow()
  return app.jwt.sign({ sub: user.id }, { expiresIn: '30d' })
}
```

`label` 参数只用于日志/可读性，不参与建用户逻辑。

- 把所有测试文件里的 `login(app, 'A')` → `loginAs(app, deps, 'A')`、`login(app, 'B')` → `loginAs(app, deps, 'B')`；需要时从 `createTestApp()` 解构出 `deps`。
- `server/test/images.test.ts`：删除依赖 `CapturingChecker` 的用例（上传后 pending、签名回调改 ok/rejected、`trace_id` 断言等）。**保留至少一条**上传用例，并在其中断言 `status === 'ok'`、`trace_id === null`、且能用签名 URL 取回原图字节。
- 删除 `wechat-client.test.ts`、`checker.test.ts`、`deployment-config.test.ts`。
- **不要删除跨用户隔离用例**（如「A 看不到 B 的记录」）。它们改用两个 `loginAs` 拿到的 token 后照常断言——这是 `user_id` 过滤没写坏的唯一保险。

- [ ] **Step 9: 跑全量测试**

Run: `cd server && npm test`
Expected: 全部 PASS。确认跨用户隔离用例仍在且通过。

- [ ] **Step 10: 提交**

```bash
git add -A server
git commit -m "feat(server): 本机单用户登录，移除微信登录与内容审核"
```

---

### Task 5: 前端改为本机登录

**Files:**
- Modify: `app/src/config.ts`、`app/src/api/auth.ts`、`app/src/stores/auth.ts`
- Modify: `app/src/pages/mine/index.vue`
- Rewrite: `app/test/auth.test.ts`

**Interfaces:**
- Consumes: `GET /auth/local` → `{ token: string }`
- Produces: `loginLocal(): Promise<{ token: string }>`；`useAuthStore()` 的对外成员（`token`、`ready`、`baseMessage`、`ensureSession`、`logout`）保持不变，页面无需改动

- [ ] **Step 1: 改 `app/src/config.ts`**

```ts
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''
```

其余常量不动。桌面版走同源相对路径，所以默认空串。

- [ ] **Step 2: 重写 `app/src/api/auth.ts`**

```ts
import { request } from './client'

export async function loginLocal(): Promise<{ token: string }> {
  return request<{ token: string }>('/auth/local', { auth: false })
}
```

- [ ] **Step 3: 改 `app/src/stores/auth.ts`**

- 删掉 `requestWechatCode`。
- `performLogin` 改为：**无论本地有没有 token，都调一次 `loginLocal()`**（本机接口零成本，彻底消除「令牌过期卡在请先登录」）。成功后写 `token.value`、`setToken(...)`、`uni.setStorageSync(TOKEN_KEY, ...)`；失败则清空 token 并把 `error.message` 写进 `baseMessage`；`finally` 里 `ready.value = true`。
- `logout()` 保持不变。
- `ensureSession()` 的短路逻辑保留（`ready` 为 true 时直接 resolve）。

- [ ] **Step 4: 重写 `app/test/auth.test.ts`**

用 `vi.stubGlobal('uni', {...})` 模拟：`request` 走 `success({ statusCode: 200, data: { token: 'local-token' } })`，`getStorageSync`/`setStorageSync`/`removeStorageSync` 用 `Map` 实现。断言四条：

1. 首次启动（无本地 token）会请求 `/auth/local` 并写入 storage。
2. 已有本地 token 时**仍会**请求一次 `/auth/local`（覆盖旧 token）。
3. 请求失败时 `baseMessage` 有值、`ready` 为 true。
4. `logout()` 清空 storage 与内存 token。

- [ ] **Step 5: 改 `app/src/pages/mine/index.vue`**

- 账号卡片：`微信登录` → `本机单用户`；`生活记录与你的微信账号绑定` → `数据保存在这台电脑上，不联网也能用`；头像文字 `微` → `本`。
- 「清除本地缓存」弹窗文案改为：`将删除本机草稿与登录信息，重新进入后会自动恢复会话。`；成功提示同步去掉「小程序」字样。
- `settings-card` 里在「清除本地缓存」**上方**新增一项：

```html
<view class="setting-item" @click="openDataFolder">
  <view>
    <text class="setting-item__title">打开数据文件夹</text>
    <text class="setting-item__hint">{{ dataPath }}</text>
  </view>
  <text class="setting-item__arrow">›</text>
</view>
<view class="setting-divider" />
```

- `script` 里新增：

```ts
const dataPath = ref('桌面版可查看')
function openDataFolder(): void {
  const bridge = (globalThis as any).wxDailyDesktop
  if (bridge?.openDataFolder) bridge.openDataFolder()
}
onMounted(() => {
  const bridge = (globalThis as any).wxDailyDesktop
  if (bridge?.dataPath) dataPath.value = bridge.dataPath
})
```

（`onMounted` 若未导入需补上。）bridge 不存在时（浏览器调试）点击静默无操作。

- [ ] **Step 6: 跑前端测试与类型检查**

Run: `cd app && npm test && npm run typecheck`
Expected: 全部 PASS，类型检查无错误。

- [ ] **Step 7: 构建 H5**

Run: `cd app && npm run build:h5`
Expected: 产出 `app/dist/build/h5/index.html`。**如果实际输出目录不是这个路径，记下来**，Task 6 与 Task 9 要用。

- [ ] **Step 8: 提交**

```bash
git add app
git commit -m "feat(app): 前端改为本机单用户登录，我的页增加数据目录入口"
```

---

### Task 6: 服务端托管 H5 静态文件

**Files:**
- Modify: `server/package.json`（加 `@fastify/static`）
- Modify: `server/src/app.ts`
- Test: `server/test/health.test.ts`

**Interfaces:**
- Consumes: `Config.webRoot`（Task 4 已加）
- Produces: 根路径 `/` 在配置了 `webRoot` 时返回 `index.html`

- [ ] **Step 1: 写失败测试**

在 `server/test/health.test.ts` 追加（文件顶部补 `mkdtemp`、`writeFile`、`tmpdir`、`join` 的 import，并在 `afterEach` 里清理新建目录）：

```ts
it('配置了 webRoot 时根路径返回 index.html', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wx-daily-web-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>ok</title>')

  const { app } = await createTestApp({ config: { webRoot: dir } })
  apps.push(app)

  const res = await app.inject({ method: 'GET', url: '/' })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toContain('text/html')
  expect(res.body).toContain('ok')
})

it('未配置 webRoot 时根路径仍是 JSON 404', async () => {
  const { app } = await createTestApp()
  apps.push(app)
  const res = await app.inject({ method: 'GET', url: '/' })
  expect(res.statusCode).toBe(404)
  expect(res.json().error.code).toBe('NOT_FOUND')
})

it('配置了 webRoot 也不影响接口路径', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wx-daily-web-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>ok</title>')

  const { app } = await createTestApp({ config: { webRoot: dir } })
  apps.push(app)

  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ ok: true })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd server && npx vitest run test/health.test.ts`
Expected: FAIL，根路径返回 404。

- [ ] **Step 3: 实现**

- `server/package.json` 加 `"@fastify/static": "^8.0.0"`，`npm install`。
- `server/src/app.ts` 在注册业务路由**之后**、`setNotFoundHandler` **之前**加入：

```ts
if (deps.config.webRoot !== null) {
  await app.register(fastifyStatic, { root: deps.config.webRoot })
}
```

**不要设 `wildcard: false`**：那会在注册时扫盘建路由，新增文件不会被服务。默认的 `wildcard: true` 注册 `GET /*`，而 Fastify 的路由优先级是「静态 > 参数 > 通配」，所以 `/records`、`/images`、`/health` 不会被它抢走（第 3 条测试就是钉这个）。

- [ ] **Step 4: 运行，确认通过**

Run: `cd server && npx vitest run test/health.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/package.json server/package-lock.json server/src/app.ts server/test/health.test.ts
git commit -m "feat(server): 用 @fastify/static 托管 H5 构建产物"
```

---

### Task 7: 数据目录、密钥与备份

**Files:**
- Create: `desktop/tsconfig.json`、`desktop/src/data-dir.ts`、`desktop/src/secrets.ts`、`desktop/src/backup.ts`
- Create: `desktop/test/data-dir.test.ts`、`desktop/test/secrets.test.ts`、`desktop/test/backup.test.ts`

**Interfaces:**
- Consumes: `node:path`、`node:fs/promises`、`node:crypto`、`node:sqlite`
- Produces:
  - `resolveDataDir(opts: { documentsPath: string; homePath: string; oneDrivePath: string | null; override?: string }): string`
  - `loadOrCreateSecrets(dataDir: string): Promise<{ jwtSecret: string; fileUrlSecret: string }>`
  - `backupDatabase(databaseFile: string, backupsDir: string, now?: Date, keep?: number): Promise<string>`

- [ ] **Step 1: 建 `desktop/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "..",
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "../server/src/**/*.ts"]
}
```

- [ ] **Step 2: 写失败测试 — 数据目录**

`desktop/test/data-dir.test.ts`：

```ts
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
```

- [ ] **Step 3: 运行，确认失败**

Run: `cd desktop && npx vitest run test/data-dir.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现 `desktop/src/data-dir.ts`**

- 目录名固定 `wx-daily`。
- `override` 非空时直接返回 `normalize(override)`。
- 否则判定：`oneDrivePath !== null` 且 `normalize(documentsPath).toLowerCase().startsWith(normalize(oneDrivePath).toLowerCase() + sep)` → 用 `join(homePath, 'wx-daily')`；否则 `join(documentsPath, 'wx-daily')`。

- [ ] **Step 5: 写失败测试 — 密钥**

`desktop/test/secrets.test.ts`：

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOrCreateSecrets } from '../src/secrets.js'

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'wx-daily-secrets-'))
}

describe('loadOrCreateSecrets', () => {
  it('首次生成两个不同的 64 位十六进制密钥并落盘', async () => {
    const dir = await tempDir()
    const first = await loadOrCreateSecrets(dir)
    expect(first.jwtSecret).toMatch(/^[0-9a-f]{64}$/)
    expect(first.fileUrlSecret).toMatch(/^[0-9a-f]{64}$/)
    expect(first.jwtSecret).not.toBe(first.fileUrlSecret)

    const raw = JSON.parse(await readFile(join(dir, 'secret.key'), 'utf8'))
    expect(raw.jwt).toBe(first.jwtSecret)
    expect(raw.fileUrl).toBe(first.fileUrlSecret)
  })

  it('第二次调用复用已有密钥', async () => {
    const dir = await tempDir()
    const first = await loadOrCreateSecrets(dir)
    expect(await loadOrCreateSecrets(dir)).toEqual(first)
  })

  it('密钥文件损坏时重新生成而不是崩溃', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'secret.key'), '{not json')
    const result = await loadOrCreateSecrets(dir)
    expect(result.jwtSecret).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 6: 运行，确认失败**

Run: `cd desktop && npx vitest run test/secrets.test.ts`
Expected: FAIL。

- [ ] **Step 7: 实现 `desktop/src/secrets.ts`**

`randomBytes(32).toString('hex')` 生成；文件 `secret.key` 内容 `{ "jwt": "...", "fileUrl": "..." }`；读取失败、JSON 解析失败或字段不是 64 位十六进制时重新生成并覆盖。

- [ ] **Step 8: 写失败测试 — 备份**

`desktop/test/backup.test.ts`：

```ts
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupDatabase } from '../src/backup.js'

async function makeDb() {
  const dir = await mkdtemp(join(tmpdir(), 'wx-daily-backup-'))
  const dbFile = join(dir, 'app.db')
  const db = new DatabaseSync(dbFile)
  db.exec('create table t (a text)')
  db.prepare('insert into t (a) values (?)').run('一行')
  db.close()
  return { dir, dbFile, backups: join(dir, 'backups') }
}

describe('backupDatabase', () => {
  it('备份出的库能被独立打开且内容一致', async () => {
    const { dbFile, backups } = await makeDb()
    const path = await backupDatabase(dbFile, backups, new Date('2026-11-08T10:20:30Z'))

    expect(path.endsWith('app-20261108-102030.db')).toBe(true)
    const copy = new DatabaseSync(path)
    expect(copy.prepare('select a from t').all()[0]).toMatchObject({ a: '一行' })
    copy.close()
  })

  it('超过保留份数时删掉最旧的', async () => {
    const { dbFile, backups } = await makeDb()
    for (let i = 0; i < 5; i += 1) {
      await backupDatabase(dbFile, backups, new Date(Date.UTC(2026, 10, 8, 10, 0, i)), 3)
    }
    const files = (await readdir(backups)).sort()
    expect(files).toHaveLength(3)
    expect(files[0]).toBe('app-20261108-100002.db')
  })
})
```

- [ ] **Step 9: 运行，确认失败**

Run: `cd desktop && npx vitest run test/backup.test.ts`
Expected: FAIL。

- [ ] **Step 10: 实现 `desktop/src/backup.ts`**

- 文件名时间戳 `YYYYMMDD-HHmmss`（UTC），由 `now.toISOString()` 去掉 `-`、`:`、毫秒与 `T` 得到：`2026-11-08T10:20:30.000Z` → `20261108-102030`。
- `mkdir(backupsDir, { recursive: true })`。
- 打开 `new DatabaseSync(databaseFile)`，执行 `vacuum into '<绝对路径>'`（路径里的 `\` 转 `/`，单引号转 `''`），然后 `close()`。
- 列出 `app-*.db`，按文件名排序，超出 `keep`（默认 30）的从头删。
- 返回新备份的完整路径。

- [ ] **Step 11: 跑测试**

Run: `cd desktop && npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 12: 提交**

```bash
git add desktop
git commit -m "feat(desktop): 数据目录解析、本机密钥与 SQLite 备份"
```

---

### Task 8: Electron 主进程

**Files:**
- Create: `desktop/src/preload.ts`、`desktop/src/main.ts`
- Modify: `desktop/package.json`（运行时依赖 + scripts）

**Interfaces:**
- Consumes: `resolveDataDir`、`loadOrCreateSecrets`、`backupDatabase`（Task 7）；`createDb`、`migrateToLatest`、`buildApp`、`loadConfig`（Task 3/4）；`LocalFileStorage`（既有）
- Produces: 可运行的桌面应用入口 `desktop/dist/desktop/src/main.js`

- [ ] **Step 1: 往 `desktop/package.json` 补运行时依赖**

与 `server/package.json` 同版本区间：`fastify`、`kysely`、`@fastify/jwt`、`@fastify/multipart`、`@fastify/static`、`zod`。

> `desktop` 会编译 `../server/src`，所以这些依赖必须装在 `desktop/node_modules` 里。装完 `npm install`。

- [ ] **Step 2: 写 `desktop/src/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'

const PREFIX = '--wx-data-path='

contextBridge.exposeInMainWorld('wxDailyDesktop', {
  dataPath: process.argv.find((arg) => arg.startsWith(PREFIX))?.slice(PREFIX.length) ?? '',
  openDataFolder: () => ipcRenderer.send('wx-daily:open-data-folder'),
})
```

- [ ] **Step 3: 写 `desktop/src/main.ts`**

顺序必须是：单实例锁 → 取路径 → 建目录 → 密钥 → 建库 → 迁移 → 备份 → 起服务 → 建窗口。

- `import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'`、`import { dirname, join } from 'node:path'`、`import { fileURLToPath } from 'node:url'`、`import { mkdir } from 'node:fs/promises'`。
- **ESM 路径基准**：`desktop/package.json` 是 `"type": "module"`，`__dirname` 不存在。文件顶部加：

```ts
const here = dirname(fileURLToPath(import.meta.url))
```

后面所有 `__dirname` 都换成 `here`。
- `const PORT = 47821`。
- `if (!app.requestSingleInstanceLock()) { app.quit() }`，否则监听 `second-instance` 聚焦已有窗口。
- `await app.whenReady()` 之后依次：
  1. `const dataDir = resolveDataDir({ documentsPath: app.getPath('documents'), homePath: app.getPath('home'), oneDrivePath: process.env.OneDrive ?? null, override: process.env.WXDAILY_DATA_DIR })`
  2. `await mkdir(join(dataDir, 'images'), { recursive: true })`、`await mkdir(join(dataDir, 'backups'), { recursive: true })`
  3. `const secrets = await loadOrCreateSecrets(dataDir)`
  4. `const config = loadConfig({ DATA_DIR: dataDir, JWT_SECRET: secrets.jwtSecret, FILE_URL_SECRET: secrets.fileUrlSecret, PORT: String(PORT), WEB_ROOT: resolveWebRoot() })`
  5. `const db = createDb(config.databaseFile)`；`await migrateToLatest(db)`
  6. `await backupDatabase(config.databaseFile, join(dataDir, 'backups'))` —— 失败只 `console.error`，不阻断启动
  7. `const server = await buildApp({ config, db, storage: new LocalFileStorage(config.storageDir) })`
  8. `try { await server.listen({ port: PORT, host: '127.0.0.1' }) } catch { await dialog.showMessageBox({ message: '端口 47821 被占用', detail: '请关闭占用该端口的程序后重新打开。' }); app.quit(); return }`
  9. 建 `BrowserWindow`：`webPreferences: { preload: join(here, 'preload.js'), contextIsolation: true, additionalArguments: [\`--wx-data-path=${dataDir}\`] }`，`loadURL(\`http://127.0.0.1:${PORT}/\`)`
- `function resolveWebRoot(): string`：`app.isPackaged ? join(process.resourcesPath, 'web') : join(here, '../../../app/dist/build/h5')`
  （`here` = `desktop/dist/desktop/src`，往上三层是仓库根，再进 `app/dist/build/h5`。编译后务必按 Step 6 实际打开确认，别只靠推算。）
- `ipcMain.on('wx-daily:open-data-folder', () => void shell.openPath(dataDir))`
- `window-all-closed` → `app.quit()`；`before-quit` → `await server.close()`、`await db.destroy()`

- [ ] **Step 4: 改 `desktop/package.json` 的 scripts**

```json
"build": "tsc -p tsconfig.json",
"start": "npm run build && electron ."
```

- [ ] **Step 5: 编译**

Run: `cd desktop && npm run build`
Expected: 无类型错误，产出 `dist/desktop/src/main.js` 与 `dist/desktop/src/preload.js`、`dist/server/src/*.js`。

- [ ] **Step 6: 手工跑起来**

Run: `cd app && npm run build:h5 && cd ../desktop && npm start`
Expected: 窗口打开，显示时间线页面，没有「请先登录」。

若窗口白屏，先用 DevTools 看网络面板：`http://127.0.0.1:47821/` 是否 200、JS 资源是否 404（多半是 `resolveWebRoot()` 指错了目录）。

- [ ] **Step 7: 手工验收**

- 新建一条记录 → 出现在时间线。
- `Documents\wx-daily\` 下有 `app.db`、`images\`、`backups\`、`secret.key`。
- 「我的」页点击「打开数据文件夹」→ 资源管理器打开该目录。
- 关窗再开 → 不要求重新登录，草稿还在。

- [ ] **Step 8: 提交**

```bash
git add desktop
git commit -m "feat(desktop): Electron 主进程内置服务与窗口"
```

---

### Task 9: 打包安装包

**Files:**
- Create: `desktop/electron-builder.yml`
- Modify: `desktop/package.json`

**Interfaces:**
- Consumes: Task 8 的编译产物、`app/dist/build/h5`
- Produces: `desktop/release/生活记录 Setup 0.1.0.exe`

- [ ] **Step 1: 写 `desktop/electron-builder.yml`**

```yaml
appId: com.wxdaily.desktop
productName: 生活记录
directories:
  output: release
files:
  - dist/**
  - package.json
  - node_modules/**
extraResources:
  - from: ../app/dist/build/h5
    to: web
win:
  target: nsis
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false
```

`deleteAppDataOnUninstall: false` 是双保险：数据本来就不在安装目录里。

- [ ] **Step 2: 加打包脚本**

```json
"dist": "npm run build && electron-builder --win --config electron-builder.yml"
```

- [ ] **Step 3: 打包**

Run: `cd app && npm run build:h5 && cd ../desktop && npm run dist`
Expected: `desktop/release/` 下出现安装包 exe。

- [ ] **Step 4: 安装验证**

装到默认位置 → 启动 → 能写记录 → 关掉 → 覆盖安装一次 → 数据还在。
装到另一个目录 → 启动 → 看到的是同一份数据（数据在文档目录下，与安装位置无关）。

- [ ] **Step 5: 提交**

```bash
git add desktop
git commit -m "build(desktop): 用 electron-builder 打 NSIS 安装包"
```

---

### Task 10: 端到端验收与说明文档

**Files:**
- Create: `docs/windows-desktop.md`

**Interfaces:**
- Consumes: 前 9 个 Task 的产物
- Produces: 无代码接口

- [ ] **Step 1: 断网状态下逐条验收**

物理断网（或关掉 Wi-Fi），逐条确认并记录结果：

- 双击图标能打开，显示时间线。
- 新建记录（正文、摘抄卡片、★ 看好、`#标签`）→ 保存成功。
- 上传图片 → 显示出来。
- 搜索：中文关键词、`#标签`、含 `%` 的字面量各搜一次。
- 日历：切到上个月再切回，有记录的日子显示绿点；点某天能看到当天记录。
- 主题：新建分类 → 新建主题 → 追加一条记录 → 主题列表计数与最近日期正确。
- ★ 我看好的：能看到刚标星的摘抄。
- 写一半草稿 → 关窗口 → 重开 → 草稿还在。
- 关窗口再开 → 不要求重新登录。
- 记录超过 20 条时往下翻页不重复、不遗漏。
- `Documents\wx-daily\backups\` 里有本次启动的备份文件。

- [ ] **Step 2: 写 `docs/windows-desktop.md`**

覆盖：如何开发（先 `app` 构建 H5，再 `desktop` 编译启动）、数据存在哪、如何手动备份（整个 `wx-daily` 文件夹拷走即可）、如何清空重来、已知限制（仅 Windows、单用户、不与小程序同步、导出 zip 未实现）。

- [ ] **Step 3: 提交**

```bash
git add docs/windows-desktop.md
git commit -m "docs: Windows 桌面版使用与开发说明"
```

---

## Self-Review

**Spec coverage**

| Spec 条目 | 对应 Task |
|---|---|
| §4.1 数据目录 + OneDrive 回退 | Task 7、Task 8 |
| §4.2 node:sqlite / spike / 方言差异 | Task 1、Task 2、Task 3 |
| §4.3 本地登录 + 密钥持久化 + ensureSession 覆盖 | Task 4、Task 5、Task 7 |
| §4.4 移除内容审核 | Task 4 |
| §4.5 同源托管 + 固定端口 | Task 5、Task 6、Task 8 |
| §4.6 Electron 外壳 + 单实例 | Task 8 |
| §4.7 启动备份 | Task 7；**导出 zip 未实现**，已降级为「手动拷贝文件夹」，见下方缺口 |
| §4.8 测试改造 | Task 3、Task 4 |
| §5 分四阶段 | Task 1–10 即四阶段的展开 |
| §6 验收 | Task 10 |

**有意简化（已记录）**：spec §4.7 的「导出备份 zip」未进计划。`backups/` 自动备份已覆盖防丢诉求，且整个数据目录可以直接拷贝，zip 只是便利功能。Task 10 的文档里写明「手动备份 = 拷贝整个 `wx-daily` 文件夹」。

**Review Focus 对应测试**

| Review Focus | 钉住的测试 |
|---|---|
| 1. 翻页游标 | Task 3 Step 10 |
| 2. 重启后会话 | Task 5 Step 4（第 2 条：已有 token 仍覆盖）+ Task 8 Step 7 手工 |
| 3. 搜索 | Task 3 Step 10（第 2 条用例） |
| 4. 数据目录 | Task 7 Step 2 |
| 5. 日期边界 | 既有 `app/test/date.test.ts` + Task 10 手工日历验收 |

**类型一致性**

- `createDb(filename: string)` 在 Task 3 定义，Task 8 消费。
- `Config` 在 Task 4 成型（含 `webRoot`），Task 6 消费 `webRoot`，Task 8 传全部字段。
- `Deps` 在 Task 4 精简为 `{config, db, storage}`，此后所有引用一致。
- `loginAs(app, deps, label)` 在 Task 4 Step 8 定义，其后所有测试文件用它。
