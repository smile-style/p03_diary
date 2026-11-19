# 时间线改日粒度横轴 + 日历只滚动记录区 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把时间线从「按年份筛选 + 按月分组」改成「按日期横向轴选一天 + 下方只看那一天」，并把日历页改成「页面不滚动，只有右侧记录区滚动」。

**Architecture:** 后端新增一个只读的按天聚合接口 `GET /record-days`（复用现有 `record_date` 索引）；前端用新的 `DayAxis` 组件替换 `YearAxis`，页面状态收敛为「选中日期 / 搜索」二选一，列表统一走现有 `listRecords`（`date` 或搜索条件）。日历页只改结构：把 `@scrolltolower` 从页面级 `scroll-view` 移到记录区自己的 `scroll-view`，日历卡片固定，右侧面板 `flex` 撑满剩余高度。

**Tech Stack:** uni-app 3（Vue 3 + TS，H5 与 mp-weixin 共用页面）、Fastify 5 + Kysely、Vitest（前端用源码断言测试，后端用 `app.inject`）。

**Spec:** 无独立设计文档。需求、根因与目标行为见本文 §1–§2；实现细节以本文件为准。

## Global Constraints

- 页面只能用 uni 内置组件与 CSS，不能引入第三方 UI 库。
- 日期一律是 `YYYY-MM-DD` 字符串，不做时区换算；「今天」由前端决定。
- 每个接口按 `user_id` 隔离数据；访问别人的数据一律 404，不读取、不修改。
- 错误响应统一 `{ "error": { "code": string, "message": string } }`，`message` 用中文。
- 样式一律使用 `App.vue` 里已有的 CSS 变量（`--color-surface`、`--color-ink`、`--color-border`…），不新增颜色字面量。
- 修改后 `app`、`server`、`desktop` 三个包的测试必须全绿；`app` 还要过 `pnpm typecheck`。
- 所有命令：前端在 `app/` 下执行，后端在 `server/` 下执行，桌面在 `desktop/` 下执行。Windows 上如 `pnpm` 不可用，用 `pnpm.cmd`。

## Review Focus

1. **一条记录都没有**：时间线日轴为空、没有选中日期；此时不能发出 `date=` 的空过滤、不能停留在「正在翻阅」转圈状态，要直接显示空状态。
2. **同一天超过 20 条记录**：滚动加载更多必须仍然限定在那一天，不能把别的日期混进来，也不能重复。
3. **搜索与选日互斥**：搜索后点任意日期必须退出搜索（清空搜索框）；清空搜索必须回到「最近有记录的那一天」，而不是回到空列表。
4. **跨年数据**：2025 与 2026 的日期必须能在轴上区分；`scroll-into-view` 锚点 id 必须唯一。
5. **窗口小**：窗口高度不足或宽度 ≤840px 时，日历页记录区不能被挤成 0 高、内容不能被裁掉（页面滚动作为兜底）。

---

## §1 问题与根因

### 1.1 时间线粒度错了：结构上就是「年 + 月」，没有「天」

现象（图一）：时间线顶部是 `全部 / 2026` 年份胶囊，下方按月分组（`2026年11月`），记录按整月平铺。用户要的是「日期横轴，点某天只看那天」。

根因链（`app/src/pages/timeline/index.vue`）：

- `app/src/pages/timeline/index.vue:19-22` — 页面状态只有 `years`、`selectedYear`、`activeMonth`、`months`，没有「选中日期」这个概念。
- `app/src/pages/timeline/index.vue:41-65` — 数据来自 `GET /years` 与 `GET /year-months`，两者都是年/月聚合。
- `app/src/pages/timeline/index.vue:67-77` — `currentFilter()` 只产出 `year` / `month`，从不产出 `date`。
- `app/src/pages/timeline/index.vue:199-204` + `app/src/components/YearAxis.vue` — 轴组件接收的是年份数组，视觉与交互都是「年」。
- `app/src/pages/timeline/index.vue:223-257` + `app/src/utils/timeline-groups.ts` — 列表被 `groupByMonth` 重新按月分区，块状呈现。
- `app/src/api/queries.ts:22-31` — 前端只有 `/years`、`/year-months` 两个聚合读接口，没有按天聚合的接口。

结论：不是样式调不好的问题，而是**数据粒度与页面状态都停在「月」**，必须补一个按天聚合的接口 + 一个按天选择的轴。

### 1.2 日历页整页滚动：全页只有一个滚动容器

现象（图二）：上下滚动时标题、日历卡片、记录区一起移动。

根因链（`app/src/pages/calendar/index.vue`）：

- `app/src/pages/calendar/index.vue:168-173` — 整个页面内容包在一个 `<scroll-view class="page-scroll" scroll-y>` 里，`@scrolltolower` 也挂在这个页面级容器上。
- `app/src/pages/calendar/index.vue:338-343` — `.calendar-layout` 只是两列 grid，没有任何高度约束，行高由内容决定；`.calendar-inner`（292-297）也没有 `height`。
- `app/src/pages/calendar/index.vue:481-484` — `.day-panel` 用 `min-height: 520px`，会随内容增高，不会自己滚。
- `app/src/App.vue:191-194` + `app/src/components/AppShell.vue:444-448` — `.page-scroll { height: 100% }`、`.workspace-content { overflow: hidden }`，说明外层高度是被约束好的；只是页面内部没有把这个高度用起来。

结论：滚动能力全在页面级容器上，记录区没有自己的滚动上下文，所以「加载更多」也只能由整页滚动触发。

---

## §2 目标行为

### 2.1 时间线（日粒度）

```
[搜索框                        ] [正在看 2026年11月16日]
──────────────────────────────────────────────────────────
 2026 │ 16  │ 15  │ 14  │  …（左右滑动，仅列出有记录的日期）
      │11月·4条│11月·2条│11月·1条│
──────────────────────────────────────────────────────────
2026年11月16日                                    4 条
┌────────────────────────────────────────────────────────┐
│ 记录卡片（当天）                                        │
└────────────────────────────────────────────────────────┘
```

- 轴上的每一项是「有记录的日期」，按日期倒序；年份变化处插入一个年份标记（跨年时能分辨）。
- 默认选中「最近有记录的那一天」；一条记录都没有时不显示轴与选中态。
- 轴可左右滑动，选中项通过 `scroll-into-view` 自动滚入可视区。
- 下方只是「选中那一天」的记录，按服务端顺序（`record_date desc, created_at desc`）平铺，**不再按月分组、不再有月份标题**。
- 当天的记录超过 20 条时，页面滚动到底继续加载，只发 `date` + `cursor`。
- 搜索：搜索是全局的，提交搜索后清空选中日期、列表换成搜索结果（卡片显示日期列）；点任意日期清空搜索回到那天的视图；清空搜索回到最近有记录的那一天。
- 「正在看」指示：搜索时显示「搜索结果」，否则显示 `2026年11月16日`；右侧的「N 条」取自服务端按天聚合（不是已加载条数）。

### 2.2 日历（只滚动记录区）

- 宽度 > 840px：整页不滚动；标题与日历卡片固定；右侧记录面板的头（`所选日期` / 日期 / 条数）固定，只有记录列表区域滚动，「加载更多」由该区域触发。
- 宽度 ≤ 840px（单列布局）或窗口高度不足时：退回整页滚动，内容不被裁剪。
- 记录面板右上角的条数改为服务端当日聚合数（`dayCounts`），不随已加载页数跳动。

### 2.3 非目标

- 不改动 `server` 的 `/years`、`/year-months`（已有测试与实现，保留；本次只是前端不再调用）。
- 不改 `listRecords` 的过滤语义（`date` / `year` / `month` 互斥优先级保持不变）。
- 不改主题、标签、收藏等其他页面。
- 不为日轴做虚拟滚动；个人日记量级（数百天）直接渲染。

---

## §3 文件结构

```
server/
  src/queries/routes.ts                    改：新增 GET /record-days
  test/queries.test.ts                     改：新增 describe('GET /record-days')
app/
  src/api/types.ts                         改：新增 RecordDayCount
  src/api/queries.ts                       改：新增 getRecordDays；删除 getYears / getYearMonths
  src/utils/date.ts                        改：新增 formatFullDateLabel、dayChipParts
  src/components/DayAxis.vue               建：日粒度横向轴
  src/components/YearAxis.vue              删
  src/utils/timeline-groups.ts             删
  src/pages/timeline/index.vue             重写主体
  src/pages/calendar/index.vue             改：滚动结构
  test/queries.test.ts                     改
  test/date.test.ts                        改
  test/day-axis.test.ts                    建
  test/year-axis.test.ts                   删
  test/timeline-groups.test.ts             删
  test/timeline.test.ts                    改
  test/calendar-page.test.ts               建
```

---

## §4 任务

### Task 1: 后端按天聚合接口 `GET /record-days`

**Files:**
- Modify: `server/src/queries/routes.ts`（在 `app.get('/year-months'…)` 之后、`app.get('/tags'…)` 之前插入）
- Test: `server/test/queries.test.ts`（文件末尾追加）

**Interfaces:**
- Consumes: `deps.db`（`records` 表，`user_id` + `record_date`，已有索引 `(user_id, record_date desc, created_at desc)`）
- Produces: `GET /record-days` → `{ items: { date: string; count: number }[] }`，按 `date` 倒序；前端 `getRecordDays()` 依赖这个结构

- [ ] **Step 1: 写失败测试**

在 `server/test/queries.test.ts` 末尾追加（沿用文件内已有的 `createTestApp` / `loginAs` / `authHeader` / `apps`）：

```ts
describe('GET /record-days', () => {
  it('按天聚合记录数并按日期倒序返回', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    const token = await loginAs(app, deps)

    for (const recordDate of ['2026-11-16', '2026-11-16', '2026-11-14', '2025-12-31']) {
      await app.inject({
        method: 'POST',
        url: '/records',
        headers: authHeader(token),
        payload: { topicId: null, recordDate, body: 'x', links: [], excerpts: [], imageIds: [] },
      })
    }

    const res = await app.inject({ method: 'GET', url: '/record-days', headers: authHeader(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      items: [
        { date: '2026-11-16', count: 2 },
        { date: '2026-11-14', count: 1 },
        { date: '2025-12-31', count: 1 },
      ],
    })
  })

  it('没有记录时返回空数组', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    const token = await loginAs(app, deps)

    const res = await app.inject({ method: 'GET', url: '/record-days', headers: authHeader(token) })

    expect(res.json()).toEqual({ items: [] })
  })

  it('不返回其他用户的日期', async () => {
    const { app, deps } = await createTestApp()
    apps.push(app)
    const tokenA = await loginAs(app, deps, 'A')
    const tokenB = await loginAs(app, deps, 'B')

    await app.inject({
      method: 'POST',
      url: '/records',
      headers: authHeader(tokenB),
      payload: { topicId: null, recordDate: '2019-01-01', body: 'B 的记录', links: [], excerpts: [], imageIds: [] },
    })

    const res = await app.inject({ method: 'GET', url: '/record-days', headers: authHeader(tokenA) })

    expect(res.json()).toEqual({ items: [] })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- queries`
Expected: 三个用例失败，首个报 404（路由不存在）。

- [ ] **Step 3: 实现路由**

在 `server/src/queries/routes.ts` 的 `registerQueryRoutes` 中新增，写法和同文件 `/years`（321-336 行）一致，只是按 `record_date` 分组、正序键 `'desc'`：

```ts
app.get('/record-days', { preHandler: app.requireUser }, async (request) => {
  // select record_date as date, cast(count(*) as integer) as count
  // where user_id = request.userId
  // group by record_date
  // order by record_date desc
  // 返回 { items: [{ date, count: Number(row.count) }] }
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- queries`
Expected: 全部通过（含原有 `/years`、`/year-months` 用例）。

- [ ] **Step 5: 提交**

```bash
git add server/src/queries/routes.ts server/test/queries.test.ts
git commit -m "feat(server): 新增按天聚合的 /record-days 接口"
```

---

### Task 2: 前端日聚合客户端 + 日期格式化工具

**Files:**
- Modify: `app/src/api/types.ts`（文件末尾追加）
- Modify: `app/src/api/queries.ts`
- Modify: `app/src/utils/date.ts`
- Test: `app/test/queries.test.ts`、`app/test/date.test.ts`

**Interfaces:**
- Produces:
  - `export type RecordDayCount = { date: string; count: number }`
  - `export async function getRecordDays(): Promise<{ items: RecordDayCount[] }>`（请求 `GET /record-days`）
  - `export function formatFullDateLabel(date: string): string` — `'2026-11-06'` → `'2026年11月6日'`（始终带年份，月/日不补零）
  - `export function dayChipParts(date: string): { day: string; month: string; year: string }` — `'2026-11-06'` → `{ day: '6', month: '11月', year: '2026' }`
- Consumes: `request`（`app/src/api/client.ts`）

- [ ] **Step 1: 写失败测试**

`app/test/queries.test.ts` 的 `describe('年份相关请求')` 之后追加（沿用文件里的 `installUni`）：

```ts
describe('按天聚合请求', () => {
  it('getRecordDays 请求 /record-days', async () => {
    const request = installUni({ items: [{ date: '2026-11-16', count: 4 }] })

    const result = await getRecordDays()

    expect(result.items[0]).toEqual({ date: '2026-11-16', count: 4 })
    expect(request.mock.calls[0][0].url).toContain('/record-days')
  })
})
```

并把顶部 import 改为 `import { getRecordDays, getYearMonths, getYears } from '../src/api/queries'`（`getYears` / `getYearMonths` 在 Task 5 才会删掉）。

`app/test/date.test.ts` 追加：

```ts
  it('formats an explicit full date label', () => {
    expect(formatFullDateLabel('2026-11-06')).toBe('2026年11月6日')
    expect(formatFullDateLabel('2025-01-09')).toBe('2025年1月9日')
  })

  it('builds day chip parts for the axis', () => {
    expect(dayChipParts('2026-11-16')).toEqual({ day: '16', month: '11月', year: '2026' })
    expect(dayChipParts('2025-01-09')).toEqual({ day: '9', month: '1月', year: '2025' })
  })
```

同时把 `formatFullDateLabel`、`dayChipParts` 加进该文件的 import 列表。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && pnpm test -- test/queries.test.ts test/date.test.ts`
Expected: 失败，`getRecordDays` / `formatFullDateLabel` / `dayChipParts` 未导出。

- [ ] **Step 3: 实现**

`app/src/api/types.ts` 末尾：

```ts
export type RecordDayCount = {
  date: string
  count: number
}
```

`app/src/api/queries.ts` 新增 `getRecordDays()`，结构对齐同文件 `getYears()`（不带 query）：

```ts
export async function getRecordDays(): Promise<{ items: RecordDayCount[] }> {
  return request<{ items: RecordDayCount[] }>('/record-days')
}
```

`app/src/utils/date.ts` 新增两个纯函数（复用文件里已有的 `pad2` 风格，但**展示**不补零）：

```ts
export function formatFullDateLabel(date: string): string
export function dayChipParts(date: string): { day: string; month: string; year: string }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && pnpm test -- test/queries.test.ts test/date.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/api/types.ts app/src/api/queries.ts app/src/utils/date.ts app/test/queries.test.ts app/test/date.test.ts
git commit -m "feat(app): 新增按天聚合客户端与日期格式化工具"
```

---

### Task 3: `DayAxis` 日粒度横向轴组件

**Files:**
- Create: `app/src/components/DayAxis.vue`
- Test: `app/test/day-axis.test.ts`

**Interfaces:**
- Consumes: `RecordDayCount`（Task 2）、`dayChipParts`（Task 2）
- Produces: 组件 `DayAxis`，props `{ items: RecordDayCount[]; selected: string | null }`，emit `select: [date: string]`（只回传具体日期，没有「全部」态）

- [ ] **Step 1: 写失败测试**

新建 `app/test/day-axis.test.ts`，写法与现有 `app/test/year-axis.test.ts` 一致（源码断言）：

```ts
// @ts-expect-error 测试运行在 Node 环境，但 uni 的 tsconfig 不包含 Node 类型
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const componentUrl = new URL('../src/components/DayAxis.vue', import.meta.url)

describe('DayAxis', () => {
  it('用横向 scroll-view 承载日期，并保留选中项滚入可视区的锚点', () => {
    const source = readFileSync(componentUrl, 'utf8')

    expect(source).toContain('scroll-x')
    expect(source).toContain(':scroll-into-view="activeAnchor"')
    expect(source).toContain('scroll-with-animation')
    expect(source).toContain("'day-' + item.date")
    expect(source).toContain('v-for="item in items"')
  })

  it('点日期只回传日期，并高亮选中项', () => {
    const source = readFileSync(componentUrl, 'utf8')

    expect(source).toContain('selected: string | null')
    expect(source).toContain("emit('select', item.date)")
    expect(source).toContain('day-chip--active')
    expect(source).not.toContain('全部')
  })

  it('跨年时插入年份标记', () => {
    const source = readFileSync(componentUrl, 'utf8')

    expect(source).toContain("type: 'year'")
    expect(source).toContain('day-axis__year')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && pnpm test -- test/day-axis.test.ts`
Expected: 失败（文件不存在）。

- [ ] **Step 3: 实现组件**

`app/src/components/DayAxis.vue`：

- `props`：`items: RecordDayCount[]`、`selected: string | null`；`emit('select', date: string)`。
- `const activeAnchor = computed(() => (props.selected ? 'day-' + props.selected : ''))`。
- 把 `items` 展开成渲染序列（`computed`，供跨年分隔用）；年份取 `date.slice(0, 4)`，与上一个不同就插一个 `{ type: 'year', year }` 节点：

```ts
type AxisNode =
  | { type: 'year'; year: string }
  | { type: 'day'; date: string; count: number }

const nodes = computed<AxisNode[]>(() => {
  // 顺序遍历 props.items，年份变化时 push 年份节点，再 push 日期节点
})
```

- 模板：`<scroll-view class="day-axis" scroll-x :scroll-into-view="activeAnchor" scroll-with-animation>` →
  `<view class="day-axis__track">` 里 `v-for="node in nodes"`：
  - 年份节点：`<text class="day-axis__year">{{ node.year }}</text>`
  - 日期节点：`<button :id="'day-' + node.date" class="day-chip" :class="{ 'day-chip--active': props.selected === node.date }" :aria-label="...">`，内部两行：`day-chip__day`（`dayChipParts(node.date).day`，17px 粗体，`--font-display`）、`day-chip__meta`（`{{ dayChipParts(node.date).month }} · {{ node.count }} 条`，10px，`--color-muted`）。
  - `aria-label` 用 `formatFullDateLabel(node.date) + '，共 ' + node.count + ' 条记录'`。
- 样式：沿用 `YearAxis` 的变量与尺寸；`.day-axis { width: 100%; white-space: nowrap; }`、`.day-axis__track { display: inline-flex; min-width: 100%; gap: 8px; padding: 2px 0 6px; border-bottom: 1px solid var(--color-border); }`（这条线就是「时间横轴」的视觉基线）；`.day-chip { min-width: 72px; min-height: 54px; border: 1px solid var(--color-border); border-radius: 13px; background: var(--color-surface); flex: none; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; }`；`.day-chip--active` 用 `--color-ink` 背景 + `--color-surface` 文字（与 `YearAxis` 激活态一致）；`.day-axis__year { align-self: center; flex: none; padding: 0 2px; color: var(--color-muted); font-family: var(--font-display); font-size: 11px; letter-spacing: 0.12em; }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && pnpm test -- test/day-axis.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/src/components/DayAxis.vue app/test/day-axis.test.ts
git commit -m "feat(app): 新增日粒度横向时间轴组件"
```

---

### Task 4: 时间线页改为「选中一天」

**Files:**
- Modify: `app/src/pages/timeline/index.vue`（script / template / style 全部替换主体）
- Test: `app/test/timeline.test.ts`（`describe('timeline page integration')` 整段替换）

**Interfaces:**
- Consumes: `DayAxis`（Task 3）、`getRecordDays`、`RecordDayCount`、`formatFullDateLabel`（Task 2）、`useTimelineStore`（现有，`reset({ date })` 已支持）、`parseSearchInput`
- Produces: 页面状态 `days: Ref<RecordDayCount[]>`、`selectedDate: Ref<string | null>`、`activeSearch: Ref<{ tag?: string; q?: string } | null>`

- [ ] **Step 1: 写失败测试**

`app/test/timeline.test.ts`：保留文件上半部分 `describe('timeline store')`，把 `describe('timeline page integration')` 整段替换为：

```ts
describe('timeline page integration', () => {
  it('用日粒度时间轴选择日期，请求只按 date 过滤', () => {
    const source = readFileSync(timelinePageUrl, 'utf8')

    expect(source).toContain("import DayAxis from '../../components/DayAxis.vue'")
    expect(source).toContain("import { getRecordDays } from '../../api/queries'")
    expect(source).toContain("import { formatFullDateLabel } from '../../utils/date'")
    expect(source).toContain('<DayAxis')
    expect(source).toContain(':items="days"')
    expect(source).toContain(':selected="selectedDate"')
    expect(source).toContain('@select="selectDay"')
    expect(source).toContain('async function selectDay')
    expect(source).toContain('timeline.reset({ date })')
    expect(source).not.toContain('YearAxis')
    expect(source).not.toContain('groupByMonth')
    expect(source).not.toContain('month-group')
  })

  it('搜索与选日互斥：点日期清空搜索，搜索时清空选中日期', () => {
    const source = readFileSync(timelinePageUrl, 'utf8')
    const selectDaySource = source.slice(
      source.indexOf('async function selectDay'),
      source.indexOf('async function submitSearch'),
    )
    const submitSearchSource = source.slice(
      source.indexOf('async function submitSearch'),
      source.indexOf('async function clearSearch'),
    )

    expect(selectDaySource).toContain('activeSearch.value = null')
    expect(selectDaySource).toContain("searchText.value = ''")
    expect(selectDaySource).toContain('selectedDate.value = date')
    expect(submitSearchSource).toContain('selectedDate.value = null')
  })

  it('没有记录时不发带空值的 date 过滤', () => {
    const source = readFileSync(timelinePageUrl, 'utf8')
    const filterSource = source.slice(
      source.indexOf('function currentFilter'),
      source.indexOf('onShow'),
    )

    expect(filterSource).toContain('if (selectedDate.value)')
    expect(filterSource).not.toContain("date: ''")
  })
})
```

同时在 `describe('timeline store')` 里补一条（Task 4 会用到 `date` 过滤，先把它钉住）：

```ts
  it('把日期透传到列表请求', async () => {
    vi.mocked(listRecords).mockResolvedValueOnce({ items: [], nextCursor: null })
    const store = useTimelineStore()

    await store.reset({ date: '2026-11-16' })

    expect(listRecords).toHaveBeenCalledWith({ date: '2026-11-16', limit: 20 })
    expect(store.filter.date).toBe('2026-11-16')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && pnpm test -- test/timeline.test.ts`
Expected: 前三个用例失败（页面仍是 `YearAxis` / `groupByMonth`）；新增的 store 用例应直接通过。

- [ ] **Step 3: 重写页面 script**

`app/src/pages/timeline/index.vue` 的 `<script setup>` 整段替换为下列状态与函数（模板与样式见 Step 4）。模板里已有的 `auth` 相关逻辑（`onShow` 里的 `ensureSession` / `baseMessage`、`retryLogin`）与 `createRecord` 原样保留：

```ts
const auth = useAuthStore()
const timeline = useTimelineStore()
const searchText = ref('')
const days = ref<RecordDayCount[]>([])
const selectedDate = ref<string | null>(null)
const activeSearch = ref<{ tag?: string; q?: string } | null>(null)

const isInitialLoading = computed(
  () => timeline.loading && timeline.items.length === 0,
)
const scopeTitle = computed(() => {
  if (activeSearch.value) return '搜索结果'
  if (selectedDate.value) return formatFullDateLabel(selectedDate.value)
  return '还没有记录'
})
const scopeCount = computed(() => {
  if (activeSearch.value || !selectedDate.value) return ''
  const found = days.value.find((item) => item.date === selectedDate.value)
  return found ? `${found.count} 条` : ''
})

// 当前生效的筛选条件：搜索优先，其次选中日期；都没有就不过滤
function currentFilter(): RecordFilter {
  if (activeSearch.value) return { ...activeSearch.value }
  if (selectedDate.value) return { date: selectedDate.value }
  return {}
}

onShow(async () => {
  await auth.ensureSession()
  if (auth.baseMessage) return
  await loadDays()
  await timeline.reset(currentFilter())
})

async function loadDays(): Promise<void> {
  try {
    const result = await getRecordDays()
    days.value = result.items
  } catch {
    days.value = []
  }
  // 选中的那天已经没有任何记录时，退回最近有记录的一天
  if (
    selectedDate.value &&
    !days.value.some((item) => item.date === selectedDate.value)
  ) {
    selectedDate.value = null
  }
  if (!activeSearch.value && !selectedDate.value && days.value.length > 0) {
    selectedDate.value = days.value[0]!.date
  }
}

async function selectDay(date: string): Promise<void> {
  activeSearch.value = null
  searchText.value = ''
  selectedDate.value = date
  await timeline.reset({ date })
}

async function submitSearch(): Promise<void> {
  const parsed = parseSearchInput(searchText.value)
  activeSearch.value = Object.keys(parsed).length > 0 ? parsed : null
  if (activeSearch.value) {
    selectedDate.value = null
  } else if (!selectedDate.value && days.value.length > 0) {
    selectedDate.value = days.value[0]!.date
  }
  await timeline.reset(currentFilter())
}

async function clearSearch(): Promise<void> {
  searchText.value = ''
  activeSearch.value = null
  await loadDays()
  await timeline.reset(currentFilter())
}

function retryLoad(): void {
  void timeline.reset(currentFilter())
}
```

- [ ] **Step 4: 重写模板与样式**

模板主体（`AppShell` 开头、`写一条` 按钮、`auth.ready` / `auth.baseMessage` 两段状态保留不动）：

```html
<scroll-view class="page-scroll" scroll-y lower-threshold="80" @scrolltolower="timeline.loadMore">
  <view class="timeline-inner">
    <view class="timeline-toolbar"> …搜索框 + scope-indicator（不变）… </view>

    <DayAxis
      v-if="days.length > 0"
      class="timeline-days"
      :items="days"
      :selected="selectedDate"
      @select="selectDay"
    />

    <view v-if="days.length > 0 || activeSearch" class="day-summary">
      <text class="day-summary__title">{{ scopeTitle }}</text>
      <text v-if="scopeCount" class="day-summary__count">{{ scopeCount }}</text>
    </view>

    …isInitialLoading / error / EmptyState 三段保持现有写法…

    <view v-else class="day-records">
      <RecordCard
        v-for="record in timeline.items"
        :key="record.id"
        :record="record"
        :show-date="activeSearch !== null"
      />
      <view v-if="timeline.loading" class="loading-more"><text>正在继续翻阅…</text></view>
      <view v-else-if="!timeline.nextCursor" class="list-end"><text>已经翻到最早的一页</text></view>
    </view>
  </view>
</scroll-view>
```

注意：`loading-more` / `list-end` 原来在 `.timeline-groups` 里，现在放进 `.day-records` 容器，且只在有内容时渲染。

样式改动：
- 删掉 `.timeline-groups`、`.month-group`、`.month-group__header`、`.month-group__title`、`.month-group__hint`、`.month-group__meta`、`.month-group__count`、`.month-group__arrow`、`.month-group__records` 全部规则（含 699px 媒体查询里的 `.month-group__header`、`.month-group__title`、`.month-group__records`）。
- `.timeline-days { margin-bottom: 22px; }`
- 新增：

```css
.day-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  padding: 0 3px 12px;
  border-bottom: 1px solid var(--color-border);
}

.day-summary__title {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.day-summary__count {
  color: var(--color-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.day-records {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

- `scope-indicator` 的文案仍由 `scopeTitle` 驱动（`正在看` + `{{ scopeTitle }}`），窄屏隐藏规则不变。
- import 改为 `DayAxis`、`getRecordDays`、`formatFullDateLabel`；删掉 `getYearMonths`、`getYears`、`YearAxis`、`groupByMonth` 的 import；`RecordFilter` 类型仍需从 `../../api/types` 引入，并引入 `RecordDayCount`。

- [ ] **Step 5: 跑测试与类型检查**

Run: `cd app && pnpm test -- test/timeline.test.ts && pnpm typecheck`
Expected: PASS；`typecheck` 无错误。

- [ ] **Step 6: 提交**

```bash
git add app/src/pages/timeline/index.vue app/test/timeline.test.ts
git commit -m "feat(app): 时间线改为日粒度时间轴逐日查看"
```

---

### Task 5: 删除年份轴相关的死代码

**Files:**
- Delete: `app/src/components/YearAxis.vue`、`app/test/year-axis.test.ts`、`app/src/utils/timeline-groups.ts`、`app/test/timeline-groups.test.ts`
- Modify: `app/src/api/queries.ts`（删 `getYears`、`getYearMonths`）
- Modify: `app/test/queries.test.ts`（删对应两个用例与 import）
- Modify: `app/src/App.vue`（删只给年份轴用的 `--color-timeline-axis` / `--color-timeline-line`，如仍被 `DayAxis` 使用则保留）

**Interfaces:**
- Consumes: 无
- Produces: 无（纯删除；`server` 的 `/years`、`/year-months` 保留不动）

- [ ] **Step 1: 确认没有残留引用**

Run: `cd app && grep -rn "YearAxis\|getYears\|getYearMonths\|timeline-groups\|groupByMonth" src test`
Expected: 无输出。

- [ ] **Step 2: 删除文件与代码**

删除上述四个文件；删除 `app/src/api/queries.ts` 中的 `getYears`、`getYearMonths` 与随之无用的 `import type { CalendarDay, Page, StarredItem, TagCount }` 中未使用的类型；删除 `app/test/queries.test.ts` 里 `describe('年份相关请求')` 的两个用例与 import。

`App.vue` 的两个变量：若 `grep -rn "color-timeline" app/src` 已无引用则删除，否则保留。

- [ ] **Step 3: 跑全部前端测试与类型检查**

Run: `cd app && pnpm test && pnpm typecheck`
Expected: 全部 PASS，`typecheck` 无错误。

- [ ] **Step 4: 提交**

```bash
git add -A app
git commit -m "refactor(app): 移除年份轴与按月分组的遗留代码"
```

---

### Task 6: 日历页只滚动记录区

**Files:**
- Modify: `app/src/pages/calendar/index.vue`
- Test: `app/test/calendar-page.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `loadDay` / `loadMoreRecords` / `dayCounts` / `records`
- Produces: 新增 computed `selectedDayCount: ComputedRef<number>`

- [ ] **Step 1: 写失败测试**

新建 `app/test/calendar-page.test.ts`，同样用源码断言（仓库现有页面的测试风格）：

```ts
// @ts-expect-error 测试运行在 Node 环境，但 uni 的 tsconfig 不包含 Node 类型
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageUrl = new URL('../src/pages/calendar/index.vue', import.meta.url)

describe('calendar page scrolling', () => {
  it('记录区有自己的滚动容器，加载更多不再由整页滚动触发', () => {
    const source = readFileSync(pageUrl, 'utf8')
    const outer = source.slice(
      source.indexOf('<scroll-view'),
      source.indexOf('<view class="calendar-inner"'),
    )

    expect(source).toContain('class="day-panel__scroll"')
    expect(source).toContain('@scrolltolower="loadMoreRecords"')
    expect(outer).not.toContain('@scrolltolower')
  })

  it('记录区与面板用 flex 撑满剩余高度', () => {
    const source = readFileSync(pageUrl, 'utf8')

    expect(source).toContain('.day-panel__scroll {')
    expect(source).toContain('flex: 1')
    expect(source).toContain("grid-template-rows: minmax(0, 1fr)")
  })

  it('窄屏退回整页滚动', () => {
    const source = readFileSync(pageUrl, 'utf8')

    expect(source).toContain('@media (max-width: 840px)')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && pnpm test -- test/calendar-page.test.ts`
Expected: 三个用例失败。

- [ ] **Step 3: 改模板结构**

把 `<scroll-view class="page-scroll" …>` 的 `@scrolltolower="loadMoreRecords"` 删掉（保留 `scroll-y`，作为小窗口时的兜底滚动）。

把 `.day-panel` 内部改为「固定头 + 可滚动列表」：

```html
<view class="day-panel">
  <view class="day-panel__header"> …保持现有结构… </view>

  <scroll-view
    class="day-panel__scroll"
    scroll-y
    lower-threshold="80"
    @scrolltolower="loadMoreRecords"
  >
    …isInitialRecordsLoading / recordsError / EmptyState / 记录列表与“加载更多”…
  </scroll-view>
</view>
```

同时把 `day-panel__header` 右上角的条数改成服务端当日聚合（`records.length` 随分页跳动，看起来像 bug）：

```ts
const selectedDayCount = computed(() => dayCounts.value[selectedDate.value] ?? 0)
```

模板：`{{ selectedDayCount ? selectedDayCount + ' 条' : '空' }}`。

- [ ] **Step 4: 改样式**

- `.calendar-inner`：加 `display: flex; height: 100%; flex-direction: column;`，`padding-bottom` 改 `28px`（整页不再需要 56px 的底部留白）。**不要**加 `overflow: hidden`——窗口过矮时让页面滚动兜底，不能裁剪内容。
- `.calendar-heading`：加 `flex: none;`。
- `.calendar-layout`：加 `flex: 1; min-height: 0;`，`align-items: start` 改 `stretch`，并加 `grid-template-rows: minmax(0, 1fr);`。
- `.calendar-card`：加 `align-self: start;`（日历卡片保持自然高度，不拉伸）。
- `.calendar-card, .day-panel` 共享的圆角/边框规则保持不变。
- `.day-panel`：`min-height: 520px` 改为 `display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden;`（其余 padding 22px 保留）。
- `.day-panel__header`：加 `flex: none;`。
- 新增：

```css
.day-panel__scroll {
  min-height: 0;
  flex: 1;
  height: 100%;
}
```

- 在 `@media (max-width: 840px)` 里加：`.calendar-inner { height: auto; }`、`.calendar-layout { grid-template-rows: none; }`、`.day-panel__scroll { height: auto; }`，让单列布局回到整页滚动（该断点已有 `.day-panel { min-height: 0 }`）。
- `@media (max-width: 1050px)` / `(max-width: 699px)` 的现有规则保持不变。

- [ ] **Step 5: 跑测试、类型检查与构建**

Run: `cd app && pnpm test && pnpm typecheck`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add app/src/pages/calendar/index.vue app/test/calendar-page.test.ts
git commit -m "fix(app): 日历页固定日历卡片，只有记录区滚动"
```

---

### Task 7: 端到端验证（H5 + 桌面）

**Files:** 无代码改动；只验证。

- [ ] **Step 1: 全量测试**

```bash
cd app && pnpm test && pnpm typecheck
cd ../server && pnpm test
cd ../desktop && pnpm test
```
Expected: 三个包全绿。

- [ ] **Step 2: 构建 H5 并启动桌面**

```bash
cd app && pnpm run build:h5
cd ../desktop && pnpm start
```

- [ ] **Step 3: 时间线核对清单**

- 顶部出现日期横轴，只有「有记录的日期」；左右滑动顺畅；默认选中最近一天并自动滚入可视区。
- 点不同日期，下方只剩那一天的记录，标题显示 `2026年11月16日` 与总条数。
- 同一天记录超过 20 条时滚到底会继续加载，且不会混入别的日期。
- 跨年数据里年份标记出现，能区分 2025 与 2026。
- 输入 `#标签` 或关键词搜索：列表变成全量搜索结果、卡片显示日期列；点任意日期后搜索框被清空、回到按天视图；清空搜索回到最近一天。
- 删掉某天的全部记录后回到时间线：那天从轴上消失，选中回落到最近有记录的一天。

- [ ] **Step 4: 日历核对清单**

- 窗口 1100×800：上下滚动鼠标滚轮，只有右侧记录区滚动，标题与日历卡片不动。
- 切换日期、切换月份：列表回到顶部，条数显示为当日总数。
- 某天记录超过 20 条时，在记录区内滚到底触发加载更多。
- 把窗口拖到 800px 宽：变成单列布局，整页可滚动，日历与记录都能看到、没有内容被裁掉。
- 把窗口高度拖到最小（600px）：内容可达、记录区仍可滚动。

- [ ] **Step 5: 若无异常，打一个提交或交给人工验收**

本任务不新增代码；如验证中发现偏差，回到对应任务修正后重跑该任务的测试，再重走本任务。
