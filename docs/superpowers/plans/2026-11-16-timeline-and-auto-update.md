# 时间线横向年份轴 + 应用内自动更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把时间线改成「横向年份轴 + 按年/按月分组」的样式，并给桌面版加上应用内检查/下载/安装更新的能力。

**Architecture:** 后端新增两个只读聚合接口（`/years`、`/year-months`），并让 `listRecords` 接受 `year` 与 `month` 过滤；前端新增 `YearAxis` 组件与 `groupByMonth` 纯函数，重写时间线页面主体；桌面端新增 `update.ts`，用 `electron-updater` 通过 IPC 把状态推给渲染层（并缓存最后状态供晚挂载的页面拉取），「我的」页加一张更新卡片。

**Tech Stack:** uni-app + Vue 3（H5 目标）、Fastify + Kysely + node:sqlite、Electron 45 + electron-updater 6.8、electron-builder 26。

**Spec:** `docs/superpowers/specs/2026-11-16-timeline-and-auto-update-design.md`

## Global Constraints

- 分支：`smile-style/windows_daily`。
- 前端只能用 uni 内置组件与手写 CSS，**不得引入第三方 UI 库**。
- 记录日期是 `YYYY-MM-DD` 纯字符串（SQLite 里是 TEXT）。`year` / `month` 过滤必须用字符串范围比较（`>= 'YYYY-01-01' and < '<YYYY+1>-01-01'`），**不要用 `strftime` / `substr`**，否则走不到 `records_user_date_idx` 索引。（`/years`、`/year-months` 是聚合，用 `substr` 是对的。）
- **月份筛选必须走服务端**：年内记录超过一页时，前端过滤会把「还没加载到」误显示成「没有记录」。月份标题的条数也必须来自服务端聚合，不能数已加载条数。
- 新接口与既有接口保持同一套返回约定：`{ items: [...] }`、错误一律 `{ error: { code, message } }`。
- 所有面向用户的中文文案沿用现有风格。
- 版本号唯一来源是 `desktop/package.json` 的 `version`；`app/src/manifest.json` 的 `versionName` 必须与之相同，并加测试钉住。本次发布版本为 `0.2.0`。
- 开发模式（`app.isPackaged === false`）下不得发起任何更新网络请求。
- `server/test/tags.test.ts` 全程不动。
- 每完成一个 Task 提交一次 commit。

## 已知现状（动手前必须知道）

- **`desktop/release/` 当前是坏的**：`win-unpacked` 里只有 `resources/default_app.asar`，缺 exe / app.asar / web。原因是 electron-builder 解压后重命名 `win-unpacked.tmp` 时被 Windows 文件锁拒绝（`EPERM` / `EBUSY`）。把输出目录换到 `%TEMP%` 后可以成功，说明配置本身没问题，是目录锁。Task 7 要修掉它。
- **GitHub 仓库 `smile-style/p03_diary` 目前访问不到**：`gh repo view` 报「仓库不存在」，`git ls-remote origin` 无法认证。自动更新要求客户端能**匿名**读取 Release 资产。Task 8 的 `publish` 配置因此留了明确的待定段，见该 Task。
- 台式机没有 Docker/Postgres，测试全部跑在 SQLite 上；`server`、`app`、`desktop` 三套测试目前全绿（73 / 42 / 14）。

---

### Task 1: 后端聚合接口 `/years` 与 `/year-months`

**Files:**
- Modify: `server/src/queries/routes.ts`
- Test: `server/test/queries.test.ts`

**Interfaces:**
- Consumes: `app.requireUser`、`Deps.db`
- Produces:
  - `GET /years` → `{ items: { year: string; count: number }[] }`，按年份倒序；无记录时 `items` 为空数组
  - `GET /year-months?year=YYYY` → `{ items: { month: string; count: number }[] }`，`month` 形如 `2026-05`，按月份倒序；`year` 缺失或格式非法时 400；该年无记录时 `items` 为空数组

- [ ] **Step 1: 写失败测试**

在 `server/test/queries.test.ts` 追加（沿用文件里已有的 `createTestApp`、`login`、`authHeader`、`apps`）：

```ts
describe('GET /years', () => {
  it('按年聚合记录数并按年份倒序返回', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    const dates = ['2024-03-01', '2024-11-20', '2025-01-05', '2026-05-11', '2026-05-12']
    for (const recordDate of dates) {
      await app.inject({
        method: 'POST',
        url: '/records',
        headers: authHeader(token),
        payload: { topicId: null, recordDate, body: 'x', links: [], excerpts: [], imageIds: [] },
      })
    }

    const res = await app.inject({ method: 'GET', url: '/years', headers: authHeader(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      items: [
        { year: '2026', count: 2 },
        { year: '2025', count: 1 },
        { year: '2024', count: 2 },
      ],
    })
  })

  it('没有记录时返回空数组', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    const res = await app.inject({ method: 'GET', url: '/years', headers: authHeader(token) })

    expect(res.json()).toEqual({ items: [] })
  })

  it('不返回其他用户的年份', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const tokenA = await login(app, 'A')
    const tokenB = await login(app, 'B')

    await app.inject({
      method: 'POST',
      url: '/records',
      headers: authHeader(tokenB),
      payload: { topicId: null, recordDate: '2019-01-01', body: 'B 的记录', links: [], excerpts: [], imageIds: [] },
    })

    const res = await app.inject({ method: 'GET', url: '/years', headers: authHeader(tokenA) })
    expect(res.json()).toEqual({ items: [] })
  })
})

describe('GET /year-months', () => {
  it('返回该年的月份与记录数，按月份倒序', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    const dates = ['2026-05-11', '2026-05-12', '2026-03-01', '2025-12-31']
    for (const recordDate of dates) {
      await app.inject({
        method: 'POST',
        url: '/records',
        headers: authHeader(token),
        payload: { topicId: null, recordDate, body: 'x', links: [], excerpts: [], imageIds: [] },
      })
    }

    const res = await app.inject({
      method: 'GET', url: '/year-months?year=2026', headers: authHeader(token),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      items: [
        { month: '2026-05', count: 2 },
        { month: '2026-03', count: 1 },
      ],
    })
  })

  it('不同年份的同月份不会混在一起', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    for (const recordDate of ['2025-05-01', '2026-05-01']) {
      await app.inject({
        method: 'POST',
        url: '/records',
        headers: authHeader(token),
        payload: { topicId: null, recordDate, body: 'x', links: [], excerpts: [], imageIds: [] },
      })
    }

    const res = await app.inject({
      method: 'GET', url: '/year-months?year=2026', headers: authHeader(token),
    })

    expect(res.json()).toEqual({ items: [{ month: '2026-05', count: 1 }] })
  })

  it('year 缺失或格式非法时返回 400', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    for (const url of ['/year-months', '/year-months?year=26', '/year-months?year=abcd']) {
      const res = await app.inject({ method: 'GET', url, headers: authHeader(token) })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION')
    }
  })

  it('该年没有记录时返回空数组', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    const res = await app.inject({
      method: 'GET', url: '/year-months?year=2026', headers: authHeader(token),
    })

    expect(res.json()).toEqual({ items: [] })
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd server && pnpm test -- test/queries.test.ts -t "year"`
Expected: FAIL，`/years` 与 `/year-months` 都拿到 404。

- [ ] **Step 3: 实现 `/years` 与 `/year-months`**

在 `server/src/queries/routes.ts` 的 `registerQueryRoutes` 里，紧挨着 `/calendar` 之后加：

```ts
app.get('/years', { preHandler: app.requireUser }, async (request) => {
  const rows = await deps.db
    .selectFrom('records')
    .select([
      sql<string>`substr(record_date, 1, 4)`.as('year'),
      sql<number>`cast(count(*) as integer)`.as('count'),
    ])
    .where('user_id', '=', request.userId)
    .groupBy(sql`substr(record_date, 1, 4)`)
    .orderBy(sql`substr(record_date, 1, 4)`, 'desc')
    .execute()

  return {
    items: rows.map((row) => ({ year: row.year, count: Number(row.count) })),
  }
})

app.get('/year-months', { preHandler: app.requireUser }, async (request) => {
  const { year } = z
    .object({ year: z.string().regex(/^\d{4}$/, 'Year must be four digits') })
    .parse(request.query)

  const rows = await deps.db
    .selectFrom('records')
    .select([
      sql<string>`substr(record_date, 1, 7)`.as('month'),
      sql<number>`cast(count(*) as integer)`.as('count'),
    ])
    .where('user_id', '=', request.userId)
    .where('record_date', '>=', `${year}-01-01`)
    .where('record_date', '<', `${String(Number(year) + 1).padStart(4, '0')}-01-01`)
    .groupBy(sql`substr(record_date, 1, 7)`)
    .orderBy(sql`substr(record_date, 1, 7)`, 'desc')
    .execute()

  return {
    items: rows.map((row) => ({ month: row.month, count: Number(row.count) })),
  }
})
```

注意：这两个都是**聚合**，用 `substr` 是对的；Task 2 的**过滤**才必须用字符串范围比较。`/year-months` 里的年份范围条件只是缩小扫描范围，不是分组依据。

- [ ] **Step 4: 运行，确认通过**

Run: `cd server && pnpm test -- test/queries.test.ts -t "year"`
Expected: `/years` 3 个 + `/year-months` 4 个，共 7 个用例全部 PASS。

- [ ] **Step 5: 跑全量**

Run: `cd server && pnpm test`
Expected: 全部 PASS（此前 73 个 + 新增 7 个 = 80）。

- [ ] **Step 6: 提交**

```bash
git add server/src/queries/routes.ts server/test/queries.test.ts
git commit -m "feat(server): 新增 /years 与 /year-months 聚合接口"
```

---

### Task 2: `listRecords` 支持 `year` 与 `month` 过滤

**Files:**
- Modify: `server/src/queries/routes.ts`
- Test: `server/test/queries.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `GET /records?year=YYYY` 只返回该年记录
  - `GET /records?month=YYYY-MM` 只返回该月记录
  - 优先级 `date` > `month` > `year`，三者只生效一个

- [ ] **Step 1: 写失败测试**

```ts
describe('GET /records?year=', () => {
  async function seed(token: string, app: FastifyInstance) {
    for (const recordDate of ['2024-12-31', '2025-01-01', '2025-06-15', '2026-01-01']) {
      await app.inject({
        method: 'POST',
        url: '/records',
        headers: authHeader(token),
        payload: { topicId: null, recordDate, body: recordDate, links: [], excerpts: [], imageIds: [] },
      })
    }
  }

  it('只返回该年的记录，且不跨年泄漏', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)
    await seed(token, app)

    const res = await app.inject({
      method: 'GET', url: '/records?year=2025', headers: authHeader(token),
    })
    const dates = res.json().items.map((item: { recordDate: string }) => item.recordDate)

    expect(dates).toEqual(['2025-06-15', '2025-01-01'])
  })

  it('同一年的记录超过一页时翻页不重不漏', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    for (let day = 1; day <= 5; day += 1) {
      await app.inject({
        method: 'POST',
        url: '/records',
        headers: authHeader(token),
        payload: {
          topicId: null,
          recordDate: `2025-04-0${day}`,
          body: `第 ${day} 条`,
          links: [], excerpts: [], imageIds: [],
        },
      })
    }
    await app.inject({
      method: 'POST',
      url: '/records',
      headers: authHeader(token),
      payload: { topicId: null, recordDate: '2024-04-05', body: '去年', links: [], excerpts: [], imageIds: [] },
    })

    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 3; page += 1) {
      const res = await app.inject({
        method: 'GET',
        url: `/records?year=2025&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: authHeader(token),
      })
      const body = res.json() as { items: { id: string }[]; nextCursor: string | null }
      seen.push(...body.items.map((item) => item.id))
      if (!body.nextCursor) break
      cursor = body.nextCursor
    }

    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
  })

  it('year 与 date 同时出现时以 date 为准', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)
    await seed(token, app)

    const res = await app.inject({
      method: 'GET',
      url: '/records?year=2025&date=2024-12-31',
      headers: authHeader(token),
    })
    const dates = res.json().items.map((item: { recordDate: string }) => item.recordDate)

    expect(dates).toEqual(['2024-12-31'])
  })

  it('year 格式不合法时返回 400', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    const res = await app.inject({
      method: 'GET', url: '/records?year=25', headers: authHeader(token),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION')
  })

  it('只返回该月的记录', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)
    await seed(token, app)

    const res = await app.inject({
      method: 'GET', url: '/records?month=2025-06', headers: authHeader(token),
    })
    const dates = res.json().items.map((item: { recordDate: string }) => item.recordDate)

    expect(dates).toEqual(['2025-06-15'])
  })

  it('12 月不会跨到下一年的 1 月', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)
    await seed(token, app)

    const res = await app.inject({
      method: 'GET', url: '/records?month=2024-12', headers: authHeader(token),
    })
    const dates = res.json().items.map((item: { recordDate: string }) => item.recordDate)

    expect(dates).toEqual(['2024-12-31'])
  })

  it('month 比 year 更具体：同时出现时以 month 为准', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)
    await seed(token, app)

    const res = await app.inject({
      method: 'GET', url: '/records?year=2025&month=2026-01', headers: authHeader(token),
    })
    const dates = res.json().items.map((item: { recordDate: string }) => item.recordDate)

    expect(dates).toEqual(['2026-01-01'])
  })

  it('同一月份记录超过一页时翻页不重不漏', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    for (let day = 1; day <= 5; day += 1) {
      await app.inject({
        method: 'POST',
        url: '/records',
        headers: authHeader(token),
        payload: {
          topicId: null,
          recordDate: `2025-07-0${day}`,
          body: `第 ${day} 条`,
          links: [], excerpts: [], imageIds: [],
        },
      })
    }

    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 3; page += 1) {
      const res = await app.inject({
        method: 'GET',
        url: `/records?month=2025-07&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: authHeader(token),
      })
      const body = res.json() as { items: { id: string }[]; nextCursor: string | null }
      seen.push(...body.items.map((item) => item.id))
      if (!body.nextCursor) break
      cursor = body.nextCursor
    }

    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
  })

  it('month 格式不合法时返回 400', async () => {
    const { app } = await createTestApp()
    apps.push(app)
    const token = await login(app)

    for (const month of ['2025-6', '2025-13-01', 'abc']) {
      const res = await app.inject({
        method: 'GET', url: `/records?month=${month}`, headers: authHeader(token),
      })
      expect(res.statusCode).toBe(400)
    }
  })
})
```

文件顶部若没有 `FastifyInstance` 类型导入，补 `import type { FastifyInstance } from 'fastify'`。

- [ ] **Step 2: 运行，确认失败**

Run: `cd server && pnpm test -- test/queries.test.ts -t "records?"`
Expected: 除「year 与 date 同时出现」外，其余新用例 FAIL（`year` / `month` 未生效）。

- [ ] **Step 3: 在 `recordQuerySchema` 里加 `year` 与 `month`**

```ts
year: z
  .string()
  .regex(/^\d{4}$/, 'Year must be four digits')
  .optional(),
month: z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM')
  .optional(),
```

注意 `month` 的正则要排除 `00`、`13` 这类非法月份，否则 `2025-13` 会被当成合法值传下去。

- [ ] **Step 4: 在 `listRecords` 里加过滤**

放在 `if (query.date !== undefined)` 之后：

```ts
if (query.date === undefined && query.month !== undefined) {
  const [yearPart, monthPart] = query.month.split('-')
  const nextMonth =
    Number(monthPart) === 12
      ? `${Number(yearPart) + 1}-01`
      : `${yearPart}-${String(Number(monthPart) + 1).padStart(2, '0')}`

  idsQuery = idsQuery
    .where('record.record_date', '>=', `${query.month}-01`)
    .where('record.record_date', '<', `${nextMonth}-01`)
} else if (query.date === undefined && query.year !== undefined) {
  const nextYear = String(Number(query.year) + 1).padStart(4, '0')
  idsQuery = idsQuery
    .where('record.record_date', '>=', `${query.year}-01-01`)
    .where('record.record_date', '<', `${nextYear}-01-01`)
}
```

优先级由 `else if` 表达：`date` 存在时两者都不生效；否则 `month` 赢过 `year`。三者只生效一个，不要叠加（叠加会算错交集，且语义含糊）。

- [ ] **Step 5: 运行，确认通过**

Run: `cd server && pnpm test -- test/queries.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: 跑全量并提交**

Run: `cd server && pnpm test`

```bash
git add server/src/queries/routes.ts server/test/queries.test.ts
git commit -m "feat(server): 记录列表支持按年与按月过滤"
```

---

### Task 3: `groupByMonth` 纯函数

**Files:**
- Create: `app/src/utils/timeline-groups.ts`
- Test: `app/test/timeline-groups.test.ts`

**Interfaces:**
- Consumes: `RecordView`（`app/src/api/types.ts`）
- Produces:
  - `export type TimelineGroup = { month: string; label: string; records: RecordView[] }`
  - `export function groupByMonth(records: RecordView[]): TimelineGroup[]`

- [ ] **Step 1: 写失败测试**

`app/test/timeline-groups.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { RecordView } from '../src/api/types'
import { groupByMonth } from '../src/utils/timeline-groups'

function record(id: string, recordDate: string): RecordView {
  return {
    id,
    topicId: null,
    topic: null,
    recordDate,
    body: id,
    links: [],
    excerpts: [],
    images: [],
    tags: [],
    createdAt: `${recordDate}T00:00:00.000Z`,
    updatedAt: `${recordDate}T00:00:00.000Z`,
  }
}

describe('groupByMonth', () => {
  it('按月份分组，组间倒序，组内保持原顺序', () => {
    const groups = groupByMonth([
      record('a', '2026-05-12'),
      record('b', '2026-05-11'),
      record('c', '2026-04-30'),
      record('d', '2025-12-01'),
    ])

    expect(groups.map((group) => group.month)).toEqual(['2026-05', '2026-04', '2025-12'])
    expect(groups[0].records.map((item) => item.id)).toEqual(['a', 'b'])
    expect(groups[1].records.map((item) => item.id)).toEqual(['c'])
  })

  it('label 使用「YYYY年M月」且月份不补零', () => {
    const groups = groupByMonth([record('a', '2026-01-05'), record('b', '2026-10-05')])

    expect(groups.map((group) => group.label)).toEqual(['2026年10月', '2026年1月'])
  })

  it('空数组返回空数组', () => {
    expect(groupByMonth([])).toEqual([])
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd app && pnpm test -- test/timeline-groups.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

要点：`month = recordDate.slice(0, 7)`；先按月份聚合进 `Map`（保持插入顺序），再对月份键排序 `desc`；`label` 用 `Number(month.slice(5,7))` 去掉前导零。

- [ ] **Step 4: 运行，确认通过**

Run: `cd app && pnpm test -- test/timeline-groups.test.ts`
Expected: 3 个用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/utils/timeline-groups.ts app/test/timeline-groups.test.ts
git commit -m "feat(app): 新增时间线按月分组工具"
```

---

### Task 4: 前端 API 层支持年份

**Files:**
- Modify: `app/src/api/types.ts`、`app/src/api/records.ts`、`app/src/api/queries.ts`
- Test: `app/test/client.test.ts` 或新增 `app/test/queries.test.ts`

**Interfaces:**
- Consumes: 后端 `GET /years`、`GET /year-months?year=`、`GET /records?year=`、`GET /records?month=`
- Produces:
  - `RecordFilter` 增加 `year?: string`、`month?: string`
  - `ListRecordParams` 增加 `year?: string`、`month?: string`，并透传到 query
  - `export async function getYears(): Promise<{ items: { year: string; count: number }[] }>`
  - `export async function getYearMonths(year: string): Promise<{ items: { month: string; count: number }[] }>`

- [ ] **Step 1: 写失败测试**

`app/test/queries.test.ts`（新建）：

```ts
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd app && pnpm test -- test/queries.test.ts`
Expected: FAIL，`getYears` 未导出。

- [ ] **Step 3: 实现三处改动**

- `app/src/api/types.ts` 的 `RecordFilter` 加 `year?: string` 与 `month?: string`。
- `app/src/api/records.ts` 的 `ListRecordParams` 加 `year?: string` 与 `month?: string`，并在 `request` 的 `query` 对象里加 `year: params.year, month: params.month`。
- `app/src/api/queries.ts` 加：

```ts
export async function getYears(): Promise<{ items: { year: string; count: number }[] }> {
  return request<{ items: { year: string; count: number }[] }>('/years')
}

export async function getYearMonths(
  year: string,
): Promise<{ items: { month: string; count: number }[] }> {
  return request<{ items: { month: string; count: number }[] }>('/year-months', {
    query: { year },
  })
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd app && pnpm test -- test/queries.test.ts`
Expected: 5 个用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/api app/test/queries.test.ts
git commit -m "feat(app): 请求层支持年份/月份聚合与过滤"
```

---

### Task 5: `YearAxis` 组件

**Files:**
- Create: `app/src/components/YearAxis.vue`
- Modify: `app/src/App.vue`（新增颜色变量）
- Test: 样式类组件，无单测（靠 Task 6 的页面手工验收）

**Interfaces:**
- Consumes: 无
- Produces: 组件 `YearAxis`，props `{ items: { year: string; count: number }[]; selected: string | null }`，emit `select(year: string | null)`（`null` 表示「全部年份」）

- [ ] **Step 1: 在 `app/src/App.vue` 的 `page` 选择器里加变量**

```css
--color-timeline-axis: #d0021b;
--color-timeline-line: #e6e6e6;
```

- [ ] **Step 2: 写组件**

要求（结构按此写，样式细节可微调，但视觉必须与参考图一致：一条横线贯穿、节点为**红色空心圆**、选中的节点加粗）：

- 根节点 `scroll-view class="year-axis" scroll-x :scroll-into-view="activeAnchor" scroll-with-animation`。
- 内部 `view class="year-axis__track"`，用 `display: flex; align-items: flex-start;`。
- **最左先放一个「全部」节点**，`id="year-all"`，`@click="emit('select', null)"`；当 `props.selected === null` 时高亮。它的文字是「全部」，不显示计数。
- 每个年份一个 `view class="year-node" :id="'year-' + item.year"`，`@click="emit('select', item.year)"`：
  - 上方：`text class="year-node__year"` 显示 4 位年份。
  - 中间：`view class="year-node__dot"`，`border: 4rpx solid var(--color-timeline-axis)`、`border-radius: 50%`、尺寸 `36rpx`；选中时 `background: var(--color-timeline-axis)`。
  - 下方：`text class="year-node__count"` 显示 `item.count`。
- 横线：在 `year-node__dot` 上用 `::before` / `::after` 画左右两段 `height: 4rpx; background: var(--color-timeline-axis);`，首尾节点不画外侧那半段（用 `.year-node:first-child .year-node__dot::before { display: none }` 同法处理 `last-child` 的 `::after`）。
- `activeAnchor = computed(() => props.selected === null ? 'year-all' : 'year-' + props.selected)`。
- **`items` 为空时仍然渲染**（只显示「全部」节点）：用户可能一条记录都没有，但轴不能消失导致界面跳变。父组件不再用 `v-if="years.length"` 包它。

- [ ] **Step 3: 类型检查**

Run: `cd app && pnpm run typecheck`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add app/src/components/YearAxis.vue app/src/App.vue
git commit -m "feat(app): 新增横向年份轴组件"
```

---

### Task 6: 重写时间线页面

**Files:**
- Modify: `app/src/pages/timeline/index.vue`
- Test: `app/test/timeline.test.ts`（追加 store 侧用例）

**Interfaces:**
- Consumes: `YearAxis`、`groupByMonth`、`getYears`、`getYearMonths`、`RecordFilter.year`、`RecordFilter.month`
- Produces: 页面行为，无导出接口

- [ ] **Step 1: 追加 store 用例 — 年份与月份进入 filter**

在 `app/test/timeline.test.ts` 的 `describe('timeline store')` 里追加：

```ts
it('把年份透传到列表请求', async () => {
  vi.mocked(listRecords).mockResolvedValueOnce({ items: [], nextCursor: null })
  const store = useTimelineStore()

  await store.reset({ year: '2025' })

  expect(listRecords).toHaveBeenCalledWith({ year: '2025', limit: 20 })
  expect(store.filter.year).toBe('2025')
})

it('把月份透传到列表请求', async () => {
  vi.mocked(listRecords).mockResolvedValueOnce({ items: [], nextCursor: null })
  const store = useTimelineStore()

  await store.reset({ month: '2025-07' })

  expect(listRecords).toHaveBeenCalledWith({ month: '2025-07', limit: 20 })
  expect(store.filter.month).toBe('2025-07')
})
```

- [ ] **Step 2: 运行，确认真实通过**

Run: `cd app && pnpm test -- test/timeline.test.ts`
Expected: PASS（store 本身已经透传 filter，这两条是回归保护）。若失败说明 store 有字段白名单，按失败信息补上 `year` / `month`。

- [ ] **Step 3: 改页面脚本**

在现有 `index.vue` 的 `<script setup>` 里：

- 新增 import：`getYears`、`getYearMonths`（`../../api/queries`）、`groupByMonth`（`../../utils/timeline-groups`）、`YearAxis`（`../../components/YearAxis.vue`）。
- 新增状态：

```ts
const years = ref<{ year: string; count: number }[]>([])
const selectedYear = ref<string | null>(null)
const activeMonth = ref<string | null>(null)
const months = ref<{ month: string; count: number }[]>([])
```

- `onShow` 里在 `await auth.ensureSession()` 与 `if (auth.baseMessage) return` 之后：

```ts
await loadYears()
await timeline.reset(currentFilter())
```

新增函数：

```ts
async function loadYears(): Promise<void> {
  try {
    const result = await getYears()
    years.value = result.items
    if (!selectedYear.value && result.items.length > 0) {
      selectedYear.value = result.items[0]!.year
    }
  } catch {
    years.value = []
  }
  await loadMonths()
}

async function loadMonths(): Promise<void> {
  if (!selectedYear.value) {
    months.value = []
    return
  }
  try {
    const result = await getYearMonths(selectedYear.value)
    months.value = result.items
  } catch {
    months.value = []
  }
}

// 当前生效的筛选条件。date / month / year 三者只取一个，后端也是这个优先级。
function currentFilter(): RecordFilter {
  const filter = { ...timeline.filter }
  if (activeMonth.value) {
    return { ...filter, month: activeMonth.value, year: undefined, date: undefined }
  }
  if (selectedYear.value) {
    return { ...filter, year: selectedYear.value, month: undefined, date: undefined }
  }
  return { ...filter, year: undefined, month: undefined, date: undefined }
}

// 传 null 表示「全部年份」
async function selectYear(year: string | null): Promise<void> {
  selectedYear.value = year
  activeMonth.value = null
  await loadMonths()
  await timeline.reset(currentFilter())
}

async function toggleMonth(month: string): Promise<void> {
  // 点同一个月标题再次取消筛选
  if (activeMonth.value === month) {
    activeMonth.value = null
    await timeline.reset({ ...currentFilterNoMonth() })
    return
  }
  activeMonth.value = month
  await timeline.reset({
    ...timeline.filter,
    month,
    year: undefined,
    date: undefined,
  })
}

function currentFilterNoMonth(): RecordFilter {
  const filter = { ...timeline.filter }
  delete filter.month
  delete filter.date
  if (selectedYear.value) filter.year = selectedYear.value
  return filter
}

// 月份标题上的条数来自服务端聚合，不是已加载条数
function monthCount(month: string): number {
  return months.value.find((item) => item.month === month)?.count ?? 0
}
```

- 搜索相关函数改为保留年份与月份：

```ts
function submitSearch() {
  const parsed = parseSearchInput(searchText.value)
  void timeline.reset({ ...parsed, ...currentFilter() })
}

function clearSearch() {
  searchText.value = ''
  void timeline.reset(currentFilter())
}
```

- `retryLoad()` 同样用 `currentFilter()`。

- [ ] **Step 4: 改页面模板**

在 `.search-bar` 之后、`.timeline-scroll` 之前插入：

```html
<YearAxis
  :items="years"
  :selected="selectedYear"
  @select="selectYear"
/>
```

把原来的 `RecordCard v-for="record in timeline.items"` 一段换成按月分组渲染。**月份筛选已由服务端完成，模板只渲染 `timeline.items`，不再做本地过滤**：

```html
<template v-else>
  <view v-for="group in groups" :key="group.month" class="month-group">
    <view class="month-group__header" @click="toggleMonth(group.month)">
      <text class="month-group__title">{{ group.label }}</text>
      <text
        v-if="selectedYear && !activeMonth"
        class="month-group__count"
      >{{ monthCount(group.month) }} 条</text>
    </view>
    <RecordCard
      v-for="record in group.records"
      :key="record.id"
      :record="record"
    />
  </view>
  <view v-if="timeline.loading" class="loading-more"><text>正在加载更多…</text></view>
  <view v-else-if="!timeline.nextCursor" class="list-end"><text>已经到底了</text></view>
</template>
```

脚本里新增：

```ts
const groups = computed(() => groupByMonth(timeline.items))
```

**注意「全部年份」态**：`selectedYear === null` 时按月分组仍可用，但不显示条数（跨年聚合条数没有意义），也不允许点月份标题切到月份筛选（月份是跨年的，语义不一致）。实现时给 `toggleMonth` 加一句守卫：

```ts
async function toggleMonth(month: string): Promise<void> {
  if (!selectedYear.value) return
  // ...其余见上方的 toggleMonth 实现
}
```

**月份筛选必须走服务端**：`toggleMonth` 会调用 `timeline.reset(...)` 重新请求，不能在前端对已加载数据做过滤。原因是年内记录超过一页时，前端过滤会把「还没加载到」误显示成「没有记录」；月份标题上的条数也必须来自 `/year-months` 聚合，不能数已加载条数。

- [ ] **Step 5: 加样式**

```css
.month-group__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 28rpx 28rpx 8rpx;
}
.month-group__title {
  color: var(--color-text);
  font-size: 28rpx;
  font-weight: 600;
}
.month-group__count {
  color: var(--color-muted);
  font-size: 22rpx;
}
```

`.year-axis` 占位高度要计入 `.timeline-scroll` 的 `height: calc(100vh - ...)` 计算，否则底部会被裁掉。把原来的 `113rpx` 改成「搜索栏 + 年份轴」的实际高度（用固定 `120rpx` 给年份轴，即 `233rpx`）。

- [ ] **Step 6: 测试与类型检查**

Run: `cd app && pnpm test && pnpm run typecheck`
Expected: 全部 PASS，无类型错误。

- [ ] **Step 7: 构建 H5 并肉眼确认**

Run: `cd app && pnpm run build:h5`
Expected: 构建成功。

- [ ] **Step 8: 提交**

```bash
git add app/src/pages/timeline/index.vue app/test/timeline.test.ts
git commit -m "feat(app): 时间线改为横向年份轴与按月分组"
```

---

### Task 7: 修好打包流程（修掉 `release/` 文件锁问题）

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/electron-builder.yml`
- Test: `desktop/test/electron-builder.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `pnpm run dist` 能产出完整 `release/win-unpacked`（含 exe、`resources/app.asar`、`resources/web`）

- [ ] **Step 1: 写失败测试**

在 `desktop/test/electron-builder.test.ts` 追加：

```ts
it('dist 前先清理 release，避免残留目录导致文件锁失败', async () => {
  const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }

  expect(pkg.scripts.dist).toContain('clean')
  expect(pkg.scripts.clean).toContain('release')
})

it('安装包文件名使用 ASCII，避免更新 URL 百分号编码', async () => {
  const yaml = await readFile(join(process.cwd(), 'electron-builder.yml'), 'utf8')

  expect(yaml).toContain('artifactName: wx-daily-setup-${version}.exe')
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd desktop && pnpm test -- test/electron-builder.test.ts`
Expected: 两个新用例 FAIL。

- [ ] **Step 3: 加 clean 脚本**

`desktop/package.json` 的 `scripts` 增加（用 Node 而不是 rimraf，避免再加依赖）：

```json
"clean": "node -e \"require('node:fs').rmSync('release',{recursive:true,force:true})\""
```

并把 `dist` 改为：

```json
"dist": "pnpm run build && pnpm run clean && electron-builder --win --config electron-builder.yml"
```

若 `clean` 因文件被占用抛 `EPERM`/`EBUSY`，脚本要捕获并打印：

```
release 目录被占用，请关闭正在运行的生活记录，并关闭资源管理器里打开的 release 文件夹后重试。
```

然后 `process.exit(1)`。用 `node -e` 内联时可写成：

```js
try { require('node:fs').rmSync('release',{recursive:true,force:true}) }
catch (e) {
  if (e.code === 'EPERM' || e.code === 'EBUSY') {
    console.error('release 目录被占用，请关闭正在运行的生活记录，并关闭资源管理器里打开的 release 文件夹后重试。')
    process.exit(1)
  }
  throw e
}
```

- [ ] **Step 4: 改 `electron-builder.yml` 加 `artifactName`**

在 `nsis:` 下加：

```yaml
  artifactName: wx-daily-setup-${version}.exe
```

- [ ] **Step 5: 运行测试**

Run: `cd desktop && pnpm test`
Expected: 全部 PASS。

- [ ] **Step 6: 实际打包验证**

Run: `cd app && pnpm run build:h5 && cd ../desktop && pnpm run dist`
Expected: `release/` 下出现 `wx-daily-setup-0.1.0.exe` 与 `latest.yml`，且 `release/win-unpacked/resources/` 里有 `app.asar` 与 `web/`。

若仍报 `EPERM`/`EBUSY`：先确认没有正在运行的应用进程（`tasklist | grep 生活记录`），再重试。仍失败则在计划文档里记下错误原文并停下报告。

- [ ] **Step 7: 提交**

```bash
git add desktop/package.json desktop/electron-builder.yml desktop/test/electron-builder.test.ts
git commit -m "build(desktop): 打包前清理 release 并固定 ASCII 安装包名"
```

---

### Task 8: 更新模块 `update.ts`

**Files:**
- Create: `desktop/src/update.ts`
- Test: `desktop/test/update.test.ts`
- Modify: `desktop/package.json`（加 `electron-updater`）

**Interfaces:**
- Consumes: `electron-updater` 的 `autoUpdater`
- Produces:
  - `export type UpdateState`（七种形态，见下）
  - `export function mapUpdaterEvent(event: string, payload: unknown, current: UpdateState): UpdateState`
  - `export function registerUpdateIpc(opts: { isPackaged: boolean; currentVersion: string; quitAndInstall: () => void }): void`

- [ ] **Step 1: 装依赖**

Run: `cd desktop && pnpm add electron-updater@^6.8.0`
Expected: 安装成功。

- [ ] **Step 2: 写失败测试**

`desktop/test/update.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))
vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    autoDownload: true,
    autoInstallOnAppQuit: true,
  },
}))

const { mapUpdaterEvent, registerUpdateIpc } = await import('../src/update.js')

describe('mapUpdaterEvent', () => {
  it('checking-for-update 映射为 checking', () => {
    expect(mapUpdaterEvent('checking-for-update', {}, { kind: 'idle' })).toEqual({ kind: 'checking' })
  })

  it('update-available 带上版本号与更新说明', () => {
    const state = mapUpdaterEvent(
      'update-available',
      { version: '0.2.0', releaseNotes: '修复若干问题' },
      { kind: 'checking' },
    )
    expect(state).toEqual({ kind: 'available', version: '0.2.0', notes: '修复若干问题' })
  })

  it('releaseNotes 不是字符串时置为 null', () => {
    const state = mapUpdaterEvent(
      'update-available',
      { version: '0.2.0', releaseNotes: [{ note: 'x' }] },
      { kind: 'checking' },
    )
    expect(state).toEqual({ kind: 'available', version: '0.2.0', notes: null })
  })

  it('update-not-available 映射为 up-to-date', () => {
    expect(mapUpdaterEvent('update-not-available', {}, { kind: 'checking' })).toEqual({
      kind: 'up-to-date',
    })
  })

  it('download-progress 的百分比取整并夹在 0-100', () => {
    expect(
      mapUpdaterEvent('download-progress', { percent: 42.7 }, { kind: 'downloading', percent: 0 }),
    ).toEqual({ kind: 'downloading', percent: 43 })

    expect(
      mapUpdaterEvent('download-progress', { percent: 180 }, { kind: 'downloading', percent: 0 }),
    ).toEqual({ kind: 'downloading', percent: 100 })
  })

  it('update-downloaded 带版本号', () => {
    expect(
      mapUpdaterEvent('update-downloaded', { version: '0.2.0' }, { kind: 'downloading', percent: 100 }),
    ).toEqual({ kind: 'downloaded', version: '0.2.0' })
  })

  it('error 只保留 message，保留上一次的可用信息', () => {
    const state = mapUpdaterEvent('error', new Error('net::ERR_NAME_NOT_RESOLVED'), { kind: 'checking' })
    expect(state).toEqual({ kind: 'error', message: 'net::ERR_NAME_NOT_RESOLVED' })
  })

  it('未知事件原样返回', () => {
    const current = { kind: 'idle' as const }
    expect(mapUpdaterEvent('something-else', {}, current)).toBe(current)
  })
})

describe('registerUpdateIpc', () => {
  it('非打包模式下不发网络请求，直接返回错误态', async () => {
    const { ipcMain } = await import('electron')
    const { autoUpdater } = await import('electron-updater')
    registerUpdateIpc({ isPackaged: false, currentVersion: '0.1.0', quitAndInstall: vi.fn() })

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === 'wx-daily:update:check')![1]
    const result = await (handler as any)({})

    expect(result).toEqual({ kind: 'error', message: '开发模式不检查更新' })
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('打包模式下配置自动下载关闭', async () => {
    const { autoUpdater } = await import('electron-updater')
    registerUpdateIpc({ isPackaged: true, currentVersion: '0.1.0', quitAndInstall: vi.fn() })

    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
  })
})
```

- [ ] **Step 3: 运行，确认失败**

Run: `cd desktop && pnpm test -- test/update.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现 `desktop/src/update.ts`**

要点：

- `UpdateState` 就是 spec §6.4 的七种形态。
- `mapUpdaterEvent(event, payload, current)` 纯函数，按上表实现；`releaseNotes` 只有 `typeof === 'string'` 才采用；`percent` 用 `Math.min(100, Math.max(0, Math.round(n)))`，`n` 非数字时用 0；`error` 取 `payload instanceof Error ? payload.message : String(payload)`；未知事件返回 `current` 本体（测试用 `toBe` 钉住引用相等）。
- `registerUpdateIpc({ isPackaged, currentVersion, quitAndInstall })`：
  - 先注册 `ipcMain.handle('wx-daily:update:check')`、`handle('wx-daily:update:download')`、`handle('wx-daily:update:get-state')`、`on('wx-daily:update:install')`。
  - **`get-state` 必须存在**：启动时的静默检查很可能在用户打开「我的」页之前就结束，只推送不给拉取会让「有新版本」标记永远显示不出来。它直接返回模块级 `state`。
  - **非打包模式**：`check` 直接 `return { kind: 'error', message: '开发模式不检查更新' }`，且**不要**在顶层 `new` 任何 updater 相关对象或调用其方法。
  - 打包模式：
    - `autoUpdater.autoDownload = false`、`autoUpdater.autoInstallOnAppQuit = true`。
    - `check` → `await autoUpdater.checkForUpdates()`，返回当前状态快照。
    - `download` → `await autoUpdater.downloadUpdate()`。
    - `install` → 调传入的 `quitAndInstall()`。
    - 把 `checking-for-update`、`update-available`、`update-not-available`、`download-progress`、`update-downloaded`、`error` 六个事件全部 `autoUpdater.on(name, payload => { state = mapUpdaterEvent(name, payload, state); broadcast(state) })`。
    - `broadcast` 遍历 `BrowserWindow.getAllWindows()` 逐个 `webContents.send('wx-daily:update:state', state)`。
  - 模块级 `let state: UpdateState = { kind: 'idle' }`，所有状态变化都写回它。
  - 打包模式下导出一个 `startSilentCheck()`（供 `main.ts` 在窗口创建后调用），它调一次 `autoUpdater.checkForUpdates()` 并吞掉异常——失败不弹窗、不打断启动。

- [ ] **Step 5: 运行，确认通过**

Run: `cd desktop && pnpm test -- test/update.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add desktop/package.json desktop/pnpm-lock.yaml desktop/src/update.ts desktop/test/update.test.ts
git commit -m "feat(desktop): 新增应用更新模块与事件映射"
```

---

### Task 9: 接上主进程与 preload

**Files:**
- Modify: `desktop/src/main.ts`、`desktop/src/preload.cts`
- Test: `desktop/test/preload.test.ts`、`desktop/test/main.test.ts`

**Interfaces:**
- Consumes: Task 8 的 `registerUpdateIpc`
- Produces:
  - preload 暴露 `wxDailyDesktop.update.{ check, download, install, onState }` 与 `wxDailyDesktop.version`
  - 主进程在窗口创建后注册更新 IPC

- [ ] **Step 1: 写失败测试**

`desktop/test/preload.test.ts` 追加：

```ts
it('preload 暴露更新相关方法', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'preload.cts'), 'utf8')

  expect(source).toContain("'wx-daily:update:check'")
  expect(source).toContain("'wx-daily:update:download'")
  expect(source).toContain("'wx-daily:update:install'")
  expect(source).toContain("'wx-daily:update:state'")
  expect(source).toContain('version')
})
```

`desktop/test/main.test.ts` 追加：

```ts
it('主进程接入了更新模块', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main.ts'), 'utf8')

  expect(source).toContain('registerUpdateIpc')
  expect(source).toContain('quitAndInstall')
})
```

两处都需要在文件顶部已有 `readFile` 的基础上确认 import 齐全。

- [ ] **Step 2: 运行，确认失败**

Run: `cd desktop && pnpm test -- test/preload.test.ts test/main.test.ts`
Expected: 两个新用例 FAIL。

- [ ] **Step 3: 改 `preload.cts`**

在 `contextBridge.exposeInMainWorld` 的对象里追加：

```js
version: readArg('--wx-app-version='),
update: {
  check: () => ipcRenderer.invoke('wx-daily:update:check'),
  download: () => ipcRenderer.invoke('wx-daily:update:download'),
  install: () => ipcRenderer.send('wx-daily:update:install'),
  getState: () => ipcRenderer.invoke('wx-daily:update:get-state'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('wx-daily:update:state', listener)
    return () => ipcRenderer.removeListener('wx-daily:update:state', listener)
  },
},
```

版本号通过主进程的 `additionalArguments` 传 `--wx-app-version=<version>`，preload 里复用现有的 `PREFIX` 解析写法（抽一个 `readArg(prefix)` 小函数，`dataPath` 也改用它）。**不要用环境变量**，它不会随窗口创建传递。测试里断言 `'--wx-app-version='` 前缀存在。

- [ ] **Step 4: 改 `main.ts`**

- import：`import { registerUpdateIpc } from './update.js'`，以及 `import { createRequire } from 'node:module'`（若需要读 `package.json` 版本）。版本号用 `app.getVersion()`。
- 在 `BrowserWindow` 创建之后、`loadURL` 之前调用：

```ts
registerUpdateIpc({
  isPackaged: app.isPackaged,
  currentVersion: app.getVersion(),
  quitAndInstall: () => {
    quitting = false
    autoUpdaterQuitAndInstall()
  },
})
```

- 把 quitAndInstall 的真实实现放在 `update.ts` 内部（`import { autoUpdater } from 'electron-updater'` 后调 `autoUpdater.quitAndInstall()`），`main.ts` 只需传一个薄回调，避免 main 直接依赖 electron-updater。**注意**：`before-quit` 里的 `quitting` 标志要放行，否则安装被 `preventDefault` 卡住。
- `additionalArguments` 里追加 `--wx-app-version=${app.getVersion()}`。

- [ ] **Step 5: 运行，确认通过**

Run: `cd desktop && pnpm test`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add desktop/src/main.ts desktop/src/preload.cts desktop/test
git commit -m "feat(desktop): 主进程接入更新模块并在 preload 暴露"
```

---

### Task 10: 「我的」页更新卡片

**Files:**
- Modify: `app/src/pages/mine/index.vue`
- Test: 无单测（靠手工验收；bridge 不存在时的分支可加一条纯函数测试，见 Step 3）

**Interfaces:**
- Consumes: `wxDailyDesktop.update`、`wxDailyDesktop.version`
- Produces: 页面行为

- [ ] **Step 1: 加状态与逻辑**

在 `index.vue` 的 `<script setup>` 里：

```ts
type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string; notes: string | null }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

const updateState = ref<UpdateState>({ kind: 'idle' })
const appVersion = ref(manifest.versionName)
const hasBridge = ref(false)
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  const bridge = (globalThis as any).wxDailyDesktop
  if (!bridge) return
  hasBridge.value = true
  if (bridge.version) appVersion.value = bridge.version

  // 顺序不能反：先拉一次已缓存的状态（启动静默检查可能早已结束），再订阅后续推送。
  // 反过来会在两次调用之间漏掉状态。
  if (bridge.update?.getState) {
    try {
      const cached = (await bridge.update.getState()) as UpdateState | undefined
      if (cached) updateState.value = cached
    } catch {
      // 拿不到缓存就保持 idle，不阻断页面
    }
  }
  if (bridge.update?.onState) {
    unsubscribe = bridge.update.onState((state: UpdateState) => {
      updateState.value = state
    })
  }
})

onUnmounted(() => {
  unsubscribe?.()
})

function bridgeCall(name: 'check' | 'download', fallbackMessage: string): void {
  const bridge = (globalThis as any).wxDailyDesktop
  const fn = bridge?.update?.[name]
  if (!fn) {
    updateState.value = { kind: 'error', message: fallbackMessage }
    return
  }
  updateState.value = name === 'check' ? { kind: 'checking' } : updateState.value
  void Promise.resolve(fn())
    .then((result: UpdateState | undefined) => {
      if (result) updateState.value = result
    })
    .catch((error: unknown) => {
      updateState.value = {
        kind: 'error',
        message: error instanceof Error ? error.message : '更新失败',
      }
    })
}

function applyUpdate(): void {
  const bridge = (globalThis as any).wxDailyDesktop
  bridge?.update?.install?.()
}
```

- [ ] **Step 2: 加卡片模板**

放在 `settings-card` 的「打开数据文件夹」之前：

```html
<view class="section-card update-card">
  <view class="update-card__header">
    <text class="update-card__title">应用更新</text>
    <text class="update-card__version">v{{ appVersion }}</text>
  </view>

  <view v-if="!hasBridge" class="update-card__state">
    <text class="update-card__hint">桌面版可用</text>
  </view>

  <template v-else>
    <view v-if="updateState.kind === 'idle'" class="update-card__actions">
      <button class="update-button" @click="bridgeCall('check', '无法检查更新')">检查更新</button>
    </view>
    <view v-else-if="updateState.kind === 'checking'" class="update-card__state">
      <text class="update-card__hint">正在检查…</text>
    </view>
    <view v-else-if="updateState.kind === 'up-to-date'" class="update-card__state">
      <text class="update-card__hint">已是最新版本</text>
    </view>
    <view v-else-if="updateState.kind === 'available'" class="update-card__state">
      <text class="update-card__hint">发现新版本 v{{ updateState.version }}</text>
      <text v-if="updateState.notes" class="update-card__notes">{{ updateState.notes }}</text>
      <button class="update-button" @click="bridgeCall('download', '无法下载更新')">立即更新</button>
    </view>
    <view v-else-if="updateState.kind === 'downloading'" class="update-card__state">
      <text class="update-card__hint">下载中 {{ updateState.percent }}%</text>
    </view>
    <view v-else-if="updateState.kind === 'downloaded'" class="update-card__state">
      <text class="update-card__hint">下载完成，重启后生效</text>
      <button class="update-button" @click="applyUpdate">立即重启</button>
    </view>
    <view v-else-if="updateState.kind === 'error'" class="update-card__state">
      <text class="update-card__error">{{ updateState.message }}</text>
      <button class="update-button" @click="bridgeCall('check', '无法检查更新')">重试</button>
    </view>
  </template>
</view>
```

同时把「关于」里的 `版本 {{ version }}` 改为 `版本 {{ appVersion }}`，并删除原来的 `const version = manifest.versionName`（若别处没用到）。

- [ ] **Step 3: 加样式**

```css
.update-card {
  padding: 0;
}
.update-card__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 28rpx 28rpx 12rpx;
}
.update-card__title {
  color: var(--color-text);
  font-size: 30rpx;
  font-weight: 600;
}
.update-card__version {
  color: var(--color-muted);
  font-size: 24rpx;
}
.update-card__state,
.update-card__actions {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: 8rpx 28rpx 28rpx;
}
.update-card__hint {
  color: var(--color-muted);
  font-size: 24rpx;
}
.update-card__notes {
  color: var(--color-muted);
  font-size: 22rpx;
  line-height: 1.5;
  white-space: pre-wrap;
}
.update-card__error {
  color: #d94b4b;
  font-size: 24rpx;
}
.update-button {
  align-self: flex-start;
  padding: 0 36rpx;
  border-radius: 32rpx;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 24rpx;
  line-height: 64rpx;
}
```

- [ ] **Step 4: 测试与类型检查**

Run: `cd app && pnpm test && pnpm run typecheck`
Expected: 全部 PASS。若 `onUnmounted` 未导入需补上。

- [ ] **Step 5: 构建 H5**

Run: `cd app && pnpm run build:h5`
Expected: 成功。

- [ ] **Step 6: 提交**

```bash
git add app/src/pages/mine/index.vue
git commit -m "feat(app): 我的页新增应用更新卡片"
```

---

### Task 11: 配置 `publish` 并统一版本号

**Files:**
- Modify: `desktop/electron-builder.yml`、`desktop/package.json`、`app/src/manifest.json`
- Test: `desktop/test/electron-builder.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 打包时生成 `latest.yml`；`desktop` 与 `app` 版本号一致

- [ ] **Step 1: 写失败测试 — 版本一致**

```ts
it('desktop 与 app 的版本号一致', async () => {
  const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string
  }
  const manifest = JSON.parse(
    await readFile(join(process.cwd(), '..', 'app', 'src', 'manifest.json'), 'utf8'),
  ) as { versionName: string }

  expect(manifest.versionName).toBe(pkg.version)
})
```

- [ ] **Step 2: 运行，确认通过（当前应已经一致）**

Run: `cd desktop && pnpm test -- test/electron-builder.test.ts -t "版本号一致"`
Expected: PASS（两者都是 `0.1.0`）。这条测试的价值是防止以后改版本时漏改。

- [ ] **Step 2.5: 升版本到 `0.2.0`**

三处一起改：

- `desktop/package.json` 的 `version` → `"0.2.0"`
- `app/src/manifest.json` 的 `versionName` → `"0.2.0"`，`versionCode` → `"200"`
- `app/package.json` 的 `version` → `"0.2.0"`

再跑一次 Step 2 的版本一致测试确认仍 PASS。

> **基线包**：手工验收「从旧版更新到新版」需要一个可安装的 `0.1.0`。在改版本**之前**先执行一次 Task 7 的打包流程，把产出的 `wx-daily-setup-0.1.0.exe` 复制到仓库外（例如 `%TEMP%\wx-daily-baseline\`）留存。改完版本再打包得到 `0.2.0`。

- [ ] **Step 3: 写 publish 配置**

在 `desktop/electron-builder.yml` 末尾加：

```yaml
publish:
  provider: github
  owner: smile-style
  repo: p03_diary
```

**注意**：这个仓库当前匿名不可达（见「已知现状」）。在确认仓库改为 public、或 Release 资产公开可读之前，**自动更新会在真实环境失败**。实现者不要擅自改成别的 provider，也不要删掉这段——保留它并在此处留一行注释：

```yaml
# 待确认：仓库需可匿名读取 Release 资产。
# 若仍为私有，改用：
# publish:
#   provider: generic
#   url: https://<你的域名>/wx-daily/
```

- [ ] **Step 4: 写失败测试 — publish 段存在**

```ts
it('配置了 GitHub Releases 发布渠道', async () => {
  const yaml = await readFile(join(process.cwd(), 'electron-builder.yml'), 'utf8')

  expect(yaml).toContain('publish:')
  expect(yaml).toContain('provider: github')
  expect(yaml).toContain('repo: p03_diary')
})
```

Run: `cd desktop && pnpm test -- test/electron-builder.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 打包确认 `latest.yml` 生成**

Run: `cd app && pnpm run build:h5 && cd ../desktop && pnpm run dist`
Expected: `release/latest.yml` 存在，内容含 `version: 0.2.0` 与 `path: wx-daily-setup-0.2.0.exe`。

- [ ] **Step 6: 提交**

```bash
git add desktop/electron-builder.yml desktop/test/electron-builder.test.ts desktop/package.json app/src/manifest.json
git commit -m "build(desktop): 配置 GitHub Releases 发布渠道并锁定版本一致性"
```

---

### Task 12: 文档与端到端验收

**Files:**
- Modify: `docs/windows-desktop.md`
- Create: `docs/release-guide.md`

**Interfaces:**
- Consumes: 前 11 个 Task 的产物
- Produces: 无代码接口

- [ ] **Step 1: 写 `docs/release-guide.md`**

覆盖：

1. 改版本号：`desktop/package.json` 的 `version` 与 `app/src/manifest.json` 的 `versionName` **都要改**（有测试会拦住不一致）。
2. 构建：`cd app && pnpm run build:h5 && cd ../desktop && pnpm run dist`。
3. 上传：用 `gh release create v0.2.0 release/wx-daily-setup-0.2.0.exe release/latest.yml --notes "..."`。
4. 仓库可见性要求：Release 资产必须能被匿名下载，否则客户端更新会 404。附上自检命令：
   `curl -sI https://github.com/smile-style/p03_diary/releases/latest/download/latest.yml`
   返回 200 才算可用。
5. 本地验证：从 Releases 里的**旧版本**安装包安装，点「检查更新」，确认走完 下载 → 立即重启 → 版本号变化。

- [ ] **Step 2: 在 `docs/windows-desktop.md` 补一节「应用更新」**

说明：更新入口在「我的」页；开发模式不检查更新；自动更新依赖 GitHub Releases；手动更新仍可直接下载新安装包覆盖安装（数据在文档目录，不受影响）。

- [ ] **Step 3: 手工验收清单**

逐条确认并记录：

- 时间线：年份轴出现，点击不同年份列表切换；点「全部」回到跨年视图。
- 月份标题的条数与实际相符。**年内记录超过 20 条时，点某个月仍能看到该月全部记录**（这是本次修复的核心场景：旧设计用前端过滤会误显示「没有记录」）。
- 月份分组标题与条数正确；点月份只显示该月，再点取消。
- 搜索「`#标签`」与关键词在选中年份内生效；清空搜索后仍停在原年份；点「全部」后可跨年搜索。
- 记录变多（>20 条）时往下滚动加载更多，分组标题不会重复出现错乱。
- 「我的」页显示 `v0.2.0`；无 bridge 时（浏览器）卡片显示「桌面版可用」。
- 冷启动后直接进「我的」页，若存在新版本，卡片上应能显示「发现新版本」（验证 `get-state` 缓存通道生效）。
- 打包版点「检查更新」：无网时显示可读错误，不卡住、不转圈不停。
- 打包版配合一个真实 Release 完成一次更新：先装 `0.1.0` 基线包，再点更新升到 `0.2.0`（若发布渠道尚未就绪，明确记录为「未验证」而不是「通过」）。

- [ ] **Step 4: 跑三套测试**

Run:
```
cd server && pnpm test
cd ../app && pnpm test && pnpm run typecheck
cd ../desktop && pnpm test
```
Expected: 三套全绿。

- [ ] **Step 5: 提交**

```bash
git add docs/windows-desktop.md docs/release-guide.md
git commit -m "docs: 补充发布流程与更新使用说明"
```

---

## Self-Review

**Spec coverage**

| Spec 条目 | 对应 Task |
|---|---|
| §5.1 年份轴 / 年份切换 / 「全部」态 / 月份分组 | Task 5、Task 6 |
| §5.1 月份条数来自服务端聚合 | Task 1（`/year-months`）、Task 4、Task 6 |
| §5.1 搜索保留年份、可切到「全部」跨年搜 | Task 6 Step 3 |
| §6.1 `/years` 与 `/year-months` 接口 | Task 1 |
| §6.2 `year` / `month` 过滤（字符串范围比较，优先级 date > month > year） | Task 2 |
| §6.3 `RecordFilter`、`getYears`/`getYearMonths`、`YearAxis`、`groupByMonth`、页面重写 | Task 3、Task 4、Task 5、Task 6 |
| §5.2 / §6.4 更新状态机与 IPC（含 `get-state` 缓存） | Task 8、Task 9 |
| §5.2 开发模式不请求 | Task 8 Step 2 的第 1 条 IPC 用例 |
| §6.5 打包配置 / `artifactName` / 版本 0.2.0 / 文件锁修复 / 基线包 | Task 7、Task 11 |
| §6.6 「我的」页更新卡片 | Task 10 |
| §7 验收 | Task 12 |
| §8 发布渠道待确认 | Task 11 Step 3 的注释 + `docs/release-guide.md` 的自检命令 |

**Review Focus 对应测试**

| 风险 | 钉住的测试 |
|---|---|
| 年份过滤跨年泄漏（`2024-12-31` 混进 2025） | Task 2 Step 1「只返回该年的记录」 |
| 年内翻页重复/遗漏 | Task 2 Step 1「同一年的记录超过一页时翻页不重不漏」 |
| **月份筛选误报「没有记录」**（本次修复的核心问题） | Task 2 Step 1「只返回该月的记录」「12 月不会跨到下一年的 1 月」「同一月份记录超过一页时翻页不重不漏」 |
| `month` 优先于 `year` 的优先级错乱 | Task 2 Step 1「month 比 year 更具体」 |
| 非法月份（`2025-13`）被当成合法值 | Task 2 Step 1「month 格式不合法时返回 400」 |
| 年份/月份过滤绕过索引 | 无自动化测试；实现约束已写进 Global Constraints 与 Task 2 Step 4 |
| `/years`、`/year-months` 泄漏其他用户数据 | Task 1 Step 1 |
| 开发模式误发更新请求 | Task 8 的 IPC 用例 |
| 启动静默检查结果在晚挂载的页面上丢失 | Task 8 的 `get-state` 通道 + Task 12 的冷启动验收项 |
| 版本号多处不一致 | Task 11 Step 1 |
| 打包产物不完整（当前实际故障） | Task 7 Step 6 的实际打包验证 |

**类型一致性**

- `UpdateState` 七种形态在 Task 8（desktop）与 Task 10（app）各定义一份。两份必须逐字一致：`idle / checking / up-to-date / available{version,notes} / downloading{percent} / downloaded{version} / error{message}`。
- `groupByMonth` 的 `TimelineGroup` 在 Task 3 定义，Task 6 消费，字段名 `month / label / records`。
- `getYears` 返回 `{ items: { year, count } }`、`getYearMonths` 返回 `{ items: { month, count } }`，与 Task 1 的后端返回一致。
- `YearAxis` 的 emit 签名 `select(year: string | null)` 在 Task 5 定义，Task 6 的 `selectYear` 按此实现。
