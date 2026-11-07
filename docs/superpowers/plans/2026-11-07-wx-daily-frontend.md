# wx_daily 前端（uni-app 小程序）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `app/` 下做出生活记录小程序的 uni-app 前端，用真实后端接口跑通「登录 → 时间线 → 写记录 → 回看」全链路，再补齐日历、主题、标签、★ 看好与分类管理。

**Architecture:** `app/` 是独立于 `server/` 的 uni-app + Vue 3 + TypeScript 工程，Vite 构建，Pinia 管理登录态与时间线游标。网络层是一个薄封装（注入 JWT、统一解 `{ error: { code, message } }`、401 清会话），业务逻辑（日期、搜索分流、草稿、编辑器→请求体）全部抽成 `src/utils/` 下的纯函数，用 Vitest 覆盖；页面层只做渲染与事件绑定，在微信开发者工具里手工验收。

**Tech Stack:** uni-app（mp-weixin）、Vue 3.5、TypeScript 5.9、Vite 5.2.8、Pinia 3、Vitest 2.1.9（Node 环境）。

**Spec:** `docs/superpowers/specs/2026-11-06-wx-daily-frontend-design.md`

---

## Global Constraints

- 所有前端的命令都在 `app/` 目录下执行。
- **`app/package.json` 不能有 `"type": "module"`。** `@dcloudio/vite-plugin-uni` 是 CJS 包，加上 `type: module` 后构建会失败并报 `uni is not a function`。这是实测结论，不是建议。
- **`vite` 必须精确为 `5.2.8`。** `@dcloudio/vite-plugin-uni@3.0.0-5030420261029002` 的 peerDependency 是 `vite@5.2.8`（精确版本，不是范围）。用 5.4.x 会直接 ERESOLVE 失败。
- **所有 `@dcloudio/*` 包使用同一版本 `3.0.0-5030420261029002`**，混版本会报编译器不匹配。
- **`vitest` 用 `2.1.9`**（vite 5 的最后一个主兼容线）。`vitest@3+` 要求 vite ^6，`vitest@5` 要求 vite ^6.4，均不可用。
- **测试必须走独立的 `vitest.config.ts`。** 如果让 Vitest 读默认的 `vite.config.ts`，它会加载 uni 插件，然后因 `vue/compiler-sfc` 解析失败而崩。`vitest.config.ts` 里只写 `test` 字段，不 import uni 插件。
- **API 基地址写在 `src/config.ts`**，从 `import.meta.env.VITE_API_BASE_URL` 读取，缺省值 `http://192.168.8.16:3000`。不得在业务代码里散落硬编码地址。
- 小程序开发期必须在微信开发者工具「详情 → 本地设置」勾选「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」。
- **图片 URL 有效期 3600 秒，绝不写入持久化存储。** 只在内存与页面状态里持有。
- **日期一律用 `YYYY-MM-DD` 字符串**，用本地时间构造，不得用 `toISOString().slice(0,10)`（UTC 会差一天）。
- **错误提示直接展示服务端的 `error.message`**（已经是中文）。
- 主色 `#07c160`，辅助文字 `#8a8a8a`，分隔线 `#eeeeee`，★ 用 `#f0a020`。
- 提交信息用中文，采用 `feat(app): …` / `fix(app): …` / `test(app): …` 前缀。

## 后端接口契约（实现时以此为准）

所有业务接口需 `Authorization: Bearer <token>`。错误统一为 `{ "error": { "code": string, "message": string } }`。

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/auth/wechat` | `{ code: string }` | `{ token: string }` |
| GET | `/categories` | — | `{ items: Category[] }` |
| POST | `/categories` | `{ name: string }` | `Category`（201） |
| PATCH | `/categories/:id` | `{ name?: string, sortOrder?: number }` | `Category` |
| DELETE | `/categories/:id` | — | 204 |
| GET | `/topics` | — | `{ categories: (Category & { topics: TopicSummary[] })[], uncategorized: TopicSummary[] }` |
| GET | `/topics/:id` | — | `TopicSummary` |
| POST | `/topics` | `{ name: string, categoryId: string \| null }` | `{ id, name, categoryId }`（201） |
| PATCH | `/topics/:id` | `{ name?: string, categoryId?: string \| null }` | `{ id, name, categoryId }` |
| DELETE | `/topics/:id` | — | 204 |
| GET | `/records` | `?date&topicId&tag&q&starred=1&cursor&limit` | `{ items: RecordView[], nextCursor: string \| null }` |
| POST | `/records` | `RecordInput` | `RecordView`（201） |
| GET | `/records/:id` | — | `RecordView` |
| PUT | `/records/:id` | `RecordInput` | `RecordView` |
| DELETE | `/records/:id` | — | 204 |
| POST | `/images` | multipart，字段名 `file` | `{ id, url, status }`（201） |
| GET | `/calendar` | `?month=YYYY-MM` | `{ days: { date: string, count: number }[] }` |
| GET | `/tags` | — | `{ items: { name: string, count: number }[] }` |
| GET | `/excerpts/starred` | `?cursor&limit` | `{ items: StarredItem[], nextCursor: string \| null }` |

```ts
type Category = { id: string; name: string; sortOrder: number }
type TopicSummary = { id: string; name: string; categoryId: string | null; recordCount: number; starredCount: number; lastRecordDate: string | null }
type RecordView = {
  id: string
  topicId: string | null
  topic: { id: string; name: string } | null
  recordDate: string
  body: string
  links: string[]
  excerpts: { id: string; quote: string; thought: string; starred: boolean }[]
  images: { id: string; url: string | null; status: 'ok' | 'pending' | 'rejected' }[]
  tags: string[]
  createdAt: string
  updatedAt: string
}
type RecordInput = {
  topicId: string | null
  recordDate: string
  body: string
  links: string[]
  excerpts: { quote: string; thought: string; starred: boolean }[]
  imageIds: string[]
}
type StarredItem = {
  excerpt: { id: string; quote: string; thought: string; starred: true }
  record: { id: string; recordDate: string; topic: { id: string; name: string } | null }
}
```

服务端校验上限（前端要在提交前拦住，给出中文提示）：正文 ≤ 20000 字；摘抄 ≤ 50 条，每条 `quote` 1–5000 字、`thought` ≤ 5000 字；图片 ≤ 9 张；链接 ≤ 10 条且必须是 http/https URL；分类名 ≤ 20 字；主题名 ≤ 50 字；`limit` 1–50。

**标签没有独立字段**：服务端从「正文 + 每条摘抄的 `thought`」里用 `/[#＃]([\p{L}\p{N}_]+)/gu` 提取。所以工具栏的「#标签」按钮只是往光标处插入一个 `#` 字符。

## Review Focus

1. **图片 URL 过期**：一条记录停留超过 1 小时后再滚动到，图片应能被重新拉取而不是永久裂图。测试：`src/api/client.ts` 不把 `RecordView` 写入任何 storage；时间线在页面 `onShow` 时若距上次加载超过 50 分钟则整体重拉。任务放在 Task 3。
2. **跨时区/跨零点的「今天」**：用 `toISOString().slice(0,10)` 在 UTC+8 的凌晨会给出前一天。测试：`todayLocal(new Date(2026, 2, 16, 0, 30))` 必须是 `2026-03-16`，`todayLocal(new Date(2026, 11, 31, 23, 59))` 必须是 `2026-12-31`。任务放在 Task 3。
3. **搜索词分流**：输入 `#投资` 应走 `tag=投资`；输入 `投资 #新能源` 应走 `q=投资 #新能源`（整串模糊匹配）；输入单独的 `#` 应视同空搜索。测试放在 Task 3。
4. **401 之后**：token 过期时，第一个请求失败就清掉本地 token 并重新走 `wx.login`，且**不能无限重试**（一个请求最多重试一次）。测试放在 Task 1。
5. **保存失败不丢内容**：`CONTENT_REJECTED`(422) 与 `CHECK_UNAVAILABLE`(503) 时草稿必须仍在本地，用户返回再进来内容还在。测试放在 Task 4。

---

## 文件结构

```
app/
  package.json              无 "type": "module"
  vite.config.ts            uni 插件
  vitest.config.ts          独立，不加载 uni
  tsconfig.json
  index.html                H5 调试用
  .env.development          VITE_API_BASE_URL
  src/
    main.ts                 createSSRApp + pinia
    App.vue                 全局样式变量、启动时 ensureSession
    pages.json              4 个 tabBar 页 + 5 个普通页
    manifest.json           mp-weixin.appid = wx88af793357981870
    config.ts               API_BASE_URL、STORAGE_KEYS、常量
    api/types.ts            上面所有契约类型
    api/client.ts           request<T>()：注入 token、解错误、401 重试一次
    api/auth.ts  categories.ts  topics.ts  records.ts  images.ts  queries.ts
    stores/auth.ts          token、ensureSession()、logout()
    stores/timeline.ts      items、nextCursor、loading、loadMore()、reset()
    utils/date.ts
    utils/search.ts
    utils/draft.ts
    utils/record-input.ts
    components/RecordCard.vue
    components/EmptyState.vue
    pages/timeline/index.vue
    pages/calendar/index.vue
    pages/topics/index.vue
    pages/mine/index.vue
    pages/record/edit.vue
    pages/record/detail.vue
    pages/topic/detail.vue
    pages/tag/detail.vue
    pages/starred/index.vue
  test/
    client.test.ts  date.test.ts  search.test.ts  draft.test.ts  record-input.test.ts
```

---

### Task 1: 工程脚手架、配置、网络层与测试链路

**Files:**
- Create: `app/package.json`, `app/vite.config.ts`, `app/vitest.config.ts`, `app/tsconfig.json`, `app/index.html`, `app/.env.development`, `app/.gitignore`, `app/src/main.ts`, `app/src/App.vue`, `app/src/pages.json`, `app/src/manifest.json`, `app/src/config.ts`, `app/src/api/types.ts`, `app/src/api/client.ts`
- Test: `app/test/client.test.ts`

**Interfaces:**
- Produces:
  - `src/config.ts`: `export const API_BASE_URL: string`、`export const TOKEN_KEY = 'wxdaily.token'`、`export const DRAFT_KEY_PREFIX = 'wxdaily.draft.'`、`export const COLORS = { primary: '#07c160', muted: '#8a8a8a', border: '#eeeeee', star: '#f0a020' }`
  - `src/api/types.ts`: 上面契约一节的全部类型，逐个 `export type`
  - `src/api/client.ts`: `export class ApiError extends Error { code: string; status: number }`、`export async function request<T>(path: string, options?: { method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; body?: unknown; query?: Record<string, string | number | undefined>; auth?: boolean }): Promise<T>`、`export function setToken(token: string | null): void`、`export function getToken(): string | null`、`export async function uploadImage(filePath: string): Promise<{ id: string; url: string | null; status: string }>`

- [ ] **Step 1: 写 `package.json`（注意不要有 `type` 字段）**

```json
{
  "name": "wx-daily-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev:mp-weixin": "uni -p mp-weixin",
    "build:mp-weixin": "uni build -p mp-weixin",
    "dev:h5": "uni",
    "build:h5": "uni build",
    "test": "vitest run --config vitest.config.ts",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@dcloudio/uni-app": "3.0.0-5030420261029002",
    "@dcloudio/uni-components": "3.0.0-5030420261029002",
    "@dcloudio/uni-h5": "3.0.0-5030420261029002",
    "@dcloudio/uni-mp-weixin": "3.0.0-5030420261029002",
    "pinia": "3.0.4",
    "vue": "3.5.45",
    "vue-i18n": "11.2.8"
  },
  "devDependencies": {
    "@dcloudio/types": "3.4.8",
    "@dcloudio/uni-cli-shared": "3.0.0-5030420261029002",
    "@dcloudio/vite-plugin-uni": "3.0.0-5030420261029002",
    "typescript": "5.9.2",
    "vite": "5.2.8",
    "vitest": "2.1.9",
    "vue-tsc": "2.1.10"
  }
}
```

- [ ] **Step 2: 安装并确认无 peer 冲突**

Run: `cd app && pnpm install`
Expected: 安装成功。若报 `ERESOLVE … peer vite@"5.2.8"`，说明 `vite` 版本没锁死，回头检查 `package.json`。

- [ ] **Step 3: 写 `vite.config.ts`、`vitest.config.ts`、`tsconfig.json`**

`vite.config.ts`：
```ts
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [uni()],
})
```

`vitest.config.ts`（关键：不 import uni）：
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
```

`tsconfig.json`：`target: ES2022`、`module: ESNext`、`moduleResolution: Bundler`、`strict: true`、`jsx: preserve`、`types: ["@dcloudio/types", "vite/client"]`、`include: ["src/**/*.ts", "src/**/*.vue", "test/**/*.ts"]`、`skipLibCheck: true`。

- [ ] **Step 4: 写 `src/config.ts` 和 `src/api/types.ts`**

`src/config.ts`：
```ts
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://192.168.8.16:3000'
export const TOKEN_KEY = 'wxdaily.token'
export const DRAFT_KEY_PREFIX = 'wxdaily.draft.'
export const COLORS = {
  primary: '#07c160',
  muted: '#8a8a8a',
  border: '#eeeeee',
  star: '#f0a020',
} as const
```

`app/.gitignore`（必写，否则 `node_modules` 会被提交）：
```
node_modules/
dist/
.env.local
*.log
```

`.env.development` 要提交，它只含地址不含密钥。

`index.html` 是 H5 调试用的最小模板：`<div id="app"></div>` + `<script type="module" src="/src/main.ts"></script>`。

`src/api/types.ts`：把「后端接口契约」一节的 `Category`、`TopicSummary`、`RecordView`、`RecordInput`、`StarredItem`，以及 `TopicOverview`（`/topics` 的响应）、`CalendarDay`、`TagCount`、`Page<T>`（`{ items: T[]; nextCursor: string | null }`）全部导出。

`.env.development`：`VITE_API_BASE_URL=http://192.168.8.16:3000`

- [ ] **Step 5: 写失败的 `test/client.test.ts`**

测试用 `vi.stubGlobal` 替换 `uni.request`，不依赖真机。要求覆盖：
1. `request` 自动带上 `Authorization: Bearer <token>`（先 `setToken('abc')`）。
2. 成功时返回解析后的 body。
3. 服务端返回 `{ error: { code: 'CONTENT_REJECTED', message: '内容未通过安全检查，请修改后再保存' } }` 且 HTTP 422 时，抛出 `ApiError`，`code === 'CONTENT_REJECTED'`，`message` 等于那句中文。
4. 401 时清空 token（`getToken()` 返回 `null`），并且**同一个请求最多重试一次**：用一个记录调用次数的假实现，断言总共只调用了 2 次就抛错。
5. `query` 里的 `undefined` 值不出现在最终 URL 里。

- [ ] **Step 6: 运行测试确认失败**

Run: `cd app && pnpm test`
Expected: FAIL，报找不到 `src/api/client.ts` 或函数未定义。

- [ ] **Step 7: 实现 `src/api/client.ts`**

要点：
- 用 `uni.request` 的 Promise 风格（`uni.request({ url, method, data, header, success, fail })` 手动包 Promise 更稳，因为类型定义在 `@dcloudio/types` 里）。
- `auth !== false` 时注入 `Authorization`。
- `statusCode === 401` 且当前有 token 且未重试过 → 清 token，重发一次；第二次还 401 就直接抛 `ApiError`（避免无限循环）。
- 非 2xx：把 `data.error` 转成 `ApiError(status, code, message)`；拿不到 `error` 时用 `请求失败（<status>）`。
- `uploadImage` 用 `uni.uploadFile`，`name: 'file'`，成功后 `JSON.parse(res.data)`。

- [ ] **Step 8: 运行测试确认通过**

Run: `cd app && pnpm test`
Expected: PASS。

- [ ] **Step 9: 写骨架页面与 `pages.json` / `manifest.json`，确认能构建**

`pages.json` 至少包含四个 tabBar 页（`pages/timeline/index`、`pages/calendar/index`、`pages/topics/index`、`pages/mine/index`）+ 五个普通页。tabBar 先只配 `text`，不配图标（实测可构建）。`manifest.json` 的 `mp-weixin.appid` 填 `wx88af793357981870`，`mp-weixin.setting.urlCheck` 填 `false`，`mp-weixin.setting.es6` 填 `true`。

Run: `cd app && pnpm build:mp-weixin`
Expected: `DONE  Build complete.`，产出 `dist/build/mp-weixin/app.json` 且其中 `tabBar.list` 有四项。

- [ ] **Step 10: 提交**

```bash
git add app
git commit -m "feat(app): 搭建 uni-app 工程、网络层与测试链路"
```

---

### Task 2: 登录态与启动流程

**Files:**
- Create: `app/src/api/auth.ts`, `app/src/stores/auth.ts`, `app/src/pages/timeline/index.vue`（先只放登录后的占位）
- Modify: `app/src/App.vue`, `app/src/api/client.ts`

**Interfaces:**
- Consumes: Task 1 的 `request`、`setToken`、`getToken`、`TOKEN_KEY`
- Produces: `src/api/auth.ts` 的 `export async function loginWithWechat(code: string): Promise<{ token: string }>`；`src/stores/auth.ts` 的 `useAuthStore()`，暴露 `token: Ref<string | null>`、`ready: Ref<boolean>`、`ensureSession(): Promise<void>`、`logout(): void`

- [ ] **Step 1: 实现 `api/auth.ts`**

`loginWithWechat(code)` → `request<{ token: string }>('/auth/wechat', { method: 'POST', body: { code }, auth: false })`。

- [ ] **Step 2: 实现 `stores/auth.ts`**

`ensureSession()` 的流程：
1. 从 storage 读 token（`uni.getStorageSync(TOKEN_KEY)`），有就 `setToken` 并 `ready = true` 返回。
2. 没有就 `uni.login({ provider: 'weixin' })` 拿 `code`。
3. `loginWithWechat(code)` → 存 token 到 storage 与 `client`。
4. 失败时把 `baseMessage` 记下来交给页面展示，`ready = true`（不要在启动时静默卡死）。
5. 用 `ready` 防止重复执行（多次调用只跑一次）。

`logout()` 清 storage、`setToken(null)`、重置 `ready`。

- [ ] **Step 3: `App.vue` 在 `onLaunch` 里 `ensureSession()`**

同时把颜色变量写进 `page` 的样式。

- [ ] **Step 4: 在时间线页显示三种状态：加载中 / 登录失败（带重试按钮）/ 已登录占位**

- [ ] **Step 5: 手工验证**

Run: `cd app && pnpm dev:mp-weixin`，用微信开发者工具打开 `dist/dev/mp-weixin`。
Expected: 打开小程序后自动完成登录，页面显示「已登录」。开发者工具 Network 里能看到 `POST /auth/wechat` 返回 200。清掉 Storage 里 `wxdaily.token` 后重新编译，会重新登录。

- [ ] **Step 6: 提交**

```bash
git add app
git commit -m "feat(app): 微信登录与启动会话"
```

---

### Task 3: 日期工具、搜索分流、时间线（含分页）

**Files:**
- Create: `app/src/utils/date.ts`, `app/src/utils/search.ts`, `app/src/api/records.ts`, `app/src/api/queries.ts`, `app/src/stores/timeline.ts`, `app/src/components/RecordCard.vue`, `app/src/components/EmptyState.vue`
- Modify: `app/src/pages/timeline/index.vue`
- Test: `app/test/date.test.ts`, `app/test/search.test.ts`

**Interfaces:**
- Produces：
  - `utils/date.ts`: `todayLocal(now?: Date): string`（**接受可选 `Date` 以便测试**）、`monthOf(date: string): string`、`shiftMonth(month: string, delta: number): string`、`calendarCells(month: string): { date: string; inMonth: boolean }[]`（固定 42 格，周日开头）、`formatDateLabel(date: string, today?: string): string`（今年内显示 `11月6日`，跨年显示 `2025年11月6日`）
  - `utils/search.ts`: `parseSearchInput(raw: string): { tag?: string; q?: string }`
  - `api/types.ts` 追加：`export type RecordFilter = { date?: string; topicId?: string; tag?: string; q?: string; starred?: boolean }`
  - `api/records.ts`: `listRecords(params: { date?: string; topicId?: string; tag?: string; q?: string; starred?: boolean; cursor?: string; limit?: number }): Promise<Page<RecordView>>`、`getRecord(id): Promise<RecordView>`、`createRecord(input: RecordInput): Promise<RecordView>`、`updateRecord(id, input: RecordInput): Promise<RecordView>`、`deleteRecord(id): Promise<void>`
  - `api/queries.ts`: `getCalendar(month: string): Promise<{ days: CalendarDay[] }>`、`getTags(): Promise<{ items: TagCount[] }>`、`getStarredExcerpts(params: { cursor?: string; limit?: number }): Promise<Page<StarredItem>>`
  - `stores/timeline.ts`: `useTimelineStore()`，暴露 `items: Ref<RecordView[]>`、`nextCursor: Ref<string | null>`、`loading`、`error: Ref<string | null>`、`filter: Ref<RecordFilter>`、`reset(filter?: RecordFilter): Promise<void>`、`loadMore(): Promise<void>`、`lastLoadedAt: Ref<number>`

- [ ] **Step 1: 写失败的 `test/date.test.ts`**

必须包含这些用例（全部与运行环境的时区无关，不要用 `process.env.TZ` 或 `vi.setSystemTime` 制造时区差异）：
- `todayLocal(new Date(2026, 2, 16, 0, 30))` === `'2026-03-16'`。这条是本任务的核心里程碑：用本地 `getFullYear/getMonth/getDate` 拼出来的日期不能因为跨 UTC 零点而变成 `2026-03-15`。
- `todayLocal(new Date(2026, 0, 1, 0, 0))` === `'2026-01-01'`，补零正确。
- `todayLocal(new Date(2026, 11, 31, 23, 59))` === `'2026-12-31'`。
- `shiftMonth('2026-01', -1) === '2025-12'`、`shiftMonth('2026-12', 1) === '2027-01'`、`shiftMonth('2026-02', 0) === '2026-02'`。
- `calendarCells('2026-11')` 长度 42。已核实 2026-11-01 是周日，所以首格是 `2026-11-01` 且 `inMonth === true`。再验 `calendarCells('2026-10')`：2026-10-01 是周四，首格应为 `2026-09-27` 且 `inMonth === false`。
- `formatDateLabel('2026-11-06', '2026-11-06') === '11月6日'`，`formatDateLabel('2025-12-31', '2026-11-06') === '2025年12月31日'`。

- [ ] **Step 2: 写失败的 `test/search.test.ts`**

- `parseSearchInput('#投资')` → `{ tag: '投资' }`
- `parseSearchInput('＃投资')`（全角）→ `{ tag: '投资' }`
- `parseSearchInput('投资 #新能源')` → `{ q: '投资 #新能源' }`
- `parseSearchInput('#')` → `{}`
- `parseSearchInput('   ')` → `{}`
- `parseSearchInput('#a_b1')` → `{ tag: 'a_b1' }`（下划线与数字合法）

- [ ] **Step 3: 运行确认失败**

Run: `cd app && pnpm test`
Expected: FAIL，找不到两个 util 文件。

- [ ] **Step 4: 实现 `utils/date.ts` 与 `utils/search.ts`**

`todayLocal` 用 `d.getFullYear() / getMonth()+1 / getDate()` 拼字符串并补零。
`calendarCells` 先算当月 1 号的星期几（`new Date(year, month-1, 1).getDay()`），往前回退到周日，再生成 42 天。
`parseSearchInput` 用 `/^[#＃]([\p{L}\p{N}_]+)$/u` 匹配整串。

- [ ] **Step 5: 运行确认通过**

Run: `cd app && pnpm test`
Expected: PASS。

- [ ] **Step 6: 实现 API 模块、timeline store、`RecordCard.vue`**

`RecordCard` 接收 `record: RecordView`，显示：日期 label、所属主题（可点，跳 `topic/detail`）、正文摘要（`line-clamp` 两行）、摘抄引用块（最多显示 2 条，★ 的条目前加 ★）、标签胶囊、图片缩略图（`status === 'rejected'` 时整张不渲染，`'pending'` 时渲染一个灰底占位）、图片数。整卡点击进 `record/detail`。

`timeline.reset(filter)`：清空 items、`nextCursor`，请求第一页，`limit: 20`，记录 `lastLoadedAt = Date.now()`。
`timeline.loadMore()`：`nextCursor` 为空或 `loading` 时直接返回；否则带 cursor 请求并 append。

- [ ] **Step 7: 实现时间线页**

顶部搜索框（`uni-search-bar` 或自绘 `<input>`），回车/确认时 `parseSearchInput` → `reset(filter)`。列表用 `scroll-view` + `@scrolltolower="loadMore"`。三态：首屏 loading、空态（`EmptyState`，文案「还没有记录，点右下角 ＋ 写下第一条」）、列表。右下角悬浮 ＋ 按钮 → `uni.navigateTo('/pages/record/edit')`。

**过期刷新**：在 `onShow` 里判断 `Date.now() - lastLoadedAt > 50 * 60 * 1000`，是则 `reset()`，以避免图片 URL 过期后整屏裂图。

- [ ] **Step 8: 手工验证**

Run: `cd app && pnpm dev:mp-weixin`
Expected: 后端有一条记录时，时间线能看到它；滚到底能加载第二页（先在后端造 25 条以上记录）；搜索 `#投资` 只剩带该标签的记录；搜索普通词能模糊匹配；下拉不重复加载。

- [ ] **Step 9: 提交**

```bash
git add app
git commit -m "feat(app): 时间线列表、搜索与游标分页"
```

---

### Task 4: 写记录 / 编辑记录（正文、摘抄卡片、★、标签、图片、链接、草稿）

**Files:**
- Create: `app/src/utils/draft.ts`, `app/src/utils/record-input.ts`, `app/src/api/images.ts`, `app/src/api/topics.ts`, `app/src/pages/record/edit.vue`
- Test: `app/test/draft.test.ts`, `app/test/record-input.test.ts`

**Interfaces:**
- Produces：
  - `utils/draft.ts`: `export type EditorDraft = { topicId: string | null; recordDate: string; body: string; excerpts: { quote: string; thought: string; starred: boolean }[]; links: string[]; imageIds: string[] }`、`saveDraft(key: string, draft: EditorDraft): void`、`loadDraft(key: string): EditorDraft | null`、`clearDraft(key: string): void`、`draftKeyFor(recordId?: string): string`（无 id → `'wxdaily.draft.new'`，有 id → `'wxdaily.draft.record.<id>'`）、`emptyDraft(today: string): EditorDraft`
  - `utils/record-input.ts`: `buildRecordInput(draft: EditorDraft): RecordInput`、`validateDraft(draft: EditorDraft): string | null`（返回中文错误或 `null`）
  - `api/images.ts`: `uploadImageApi(filePath: string): Promise<{ id: string; url: string | null; status: string }>`
  - `api/topics.ts`: `getTopicOverview(): Promise<TopicOverview>`、`getTopic(id): Promise<TopicSummary>`、`createTopic(name: string, categoryId: string | null): Promise<{ id: string; name: string; categoryId: string | null }>`、`updateTopic(id, changes: { name?: string; categoryId?: string | null }): Promise<{ id: string; name: string; categoryId: string | null }>`、`deleteTopic(id): Promise<void>`。（Task 7 的主题页复用这份模块，不再重复创建。）

- [ ] **Step 1: 写失败的 `test/record-input.test.ts`**

- `buildRecordInput` 会 trim 正文、丢掉 `quote` 为空的摘抄、丢弃 `thought` 的空格、丢弃空链接、去掉重复的 `imageIds`。
- `validateDraft` 在正文、摘抄、图片全空时返回「记录不能为空」。
- 正文超过 20000 字返回包含「20000」的提示；摘抄超过 50 条返回包含「50」的提示；图片超过 9 张返回包含「9」的提示；链接不是 `http(s)://` 开头返回包含「链接」的提示。
- 空白正文但有一条带内容的摘抄时，`validateDraft` 返回 `null`（允许只发摘抄）。

- [ ] **Step 2: 写失败的 `test/draft.test.ts`**

用 `vi.stubGlobal('uni', { setStorageSync, getStorageSync, removeStorageSync })` 的假实现：
- `draftKeyFor()` 两种形态正确。
- `saveDraft` 后 `loadDraft` 能拿回同样内容。
- `clearDraft` 后 `loadDraft` 返回 `null`。
- `loadDraft` 遇到损坏的 JSON 字符串返回 `null` 而不是抛错。

- [ ] **Step 3: 运行确认失败**

Run: `cd app && pnpm test`
Expected: FAIL。

- [ ] **Step 4: 实现两个 util 与 `api/images.ts`**

`uploadImageApi` 调 `client.ts` 的 `uploadImage`。

- [ ] **Step 5: 实现 `pages/record/edit.vue`**

结构（对应草图的「B. 摘抄卡片」）：
- 顶部：取消（返回并提示「草稿已保存」）、标题（新建「新记录」/编辑「编辑记录」）、保存。
- 第一行两个 picker：所属主题（数据来自 `GET /topics`，扁平化成「分类名 / 主题名」，另有一项「不选主题」）、日期（`mode="date"`，默认 `todayLocal()`）。
- 正文 `<textarea>`，绑定 `draft.body`。
- 摘抄卡片列表：每张卡片是一个 `quote` 输入框 + `thought` 输入框 + ★ 开关（`switch`）+ 删除按钮。下方「＋ 添加一段摘抄」。
- 图片九宫格：已选图片缩略图 + 删除按钮 + 最后一张是「＋」触发 `uni.chooseImage`，选完逐张 `uploadImage` 并把 id 追加进 `imageIds`。上传中显示 spinner，失败 `uni.showToast`。
- 链接区：文本输入 + 添加。
- 工具栏四个按钮：摘抄（追加一张空卡片）、#标签（往正文末尾插入 `#`，因为小程序无法可靠拿到光标位置，统一追加到末尾并提示）、图片（同「＋」）、链接（追加一个空链接行）。
- 底部安全区留白。

**自动存草稿**：`body`、`excerpts`、`links` 变化时 `debounce 800ms` 调 `saveDraft`。页面 `onUnload` 再存一次。

**保存流程**：`validateDraft` → 不通过则 toast 并中止 → `POST /records` 或 `PUT /records/:id` → 成功 `clearDraft` → `uni.showToast('已保存')` → `uni.navigateBack()`。失败时：`ApiError.code` 为 `CONTENT_REJECTED` 或 `CHECK_UNAVAILABLE` 时用 `uni.showModal` 展示 `error.message` 并明确告诉用户「内容已保存在草稿里」，**不清草稿**。

**编辑模式**：`onLoad` 里若带 `id`，先 `loadDraft`，没有草稿就 `getRecord(id)` 回填。

- [ ] **Step 6: 运行测试确认通过**

Run: `cd app && pnpm test`
Expected: PASS。

- [ ] **Step 7: 手工验证**

Expected：写一条带正文、两段摘抄（其中一段标 ★）、两张图片、一个链接的记录，保存后回到时间线能看到它；杀掉小程序再进来，刚才未保存的内容仍在输入框里；把正文清空后保存会提示「记录不能为空」。

- [ ] **Step 8: 提交**

```bash
git add app
git commit -m "feat(app): 记录编辑器、摘抄卡片与本地草稿"
```

---

### Task 5: 记录详情与删除

**Files:**
- Create: `app/src/pages/record/detail.vue`
- Modify: `app/src/components/RecordCard.vue`（提供只读展示模式）

**Interfaces:**
- Consumes: Task 3 的 `getRecord`、`deleteRecord`；Task 4 的 `draftKeyFor`、`clearDraft`

- [ ] **Step 1: 实现详情页**

`onLoad({ id })` → `getRecord(id)`。展示完整正文、全部摘抄（★ 高亮）、全部图片（点击 `uni.previewImage`）、标签、链接（点击复制，因为小程序不好直接外跳）、主题。
右上角「编辑」→ `navigateTo('/pages/record/edit?id=' + id)`。底部「删除」→ `uni.showModal` 二次确认 → `DELETE /records/:id` → `clearDraft(draftKeyFor(id))` → toast 后 `navigateBack`。
删除后回到上一页需要刷新：用 `uni.$emit('records:changed')`，时间线/主题详情等页面 `onShow` 时监听并可简单 `reset()`。或者更简单：`navigateBack` 后由上一页 `onShow` 无条件重新 `reset()`。**计划采用后者**，避免事件总线泄漏。

- [ ] **Step 2: 手工验证**

Expected：点开一条记录能看到全部内容；编辑改正文后返回详情是新的；删除后确认，上一页不再有它。图片点击能放大。

- [ ] **Step 3: 提交**

```bash
git add app
git commit -m "feat(app): 记录详情与删除"
```

---

### Task 6: 日历

**Files:**
- Create: `app/src/pages/calendar/index.vue`
- Modify: `app/src/utils/date.ts`（若 Task 3 的 `calendarCells` 不够用，可在此扩展，但不得改名）

**Interfaces:**
- Consumes: `getCalendar(month)`、`listRecords({ date })`、`calendarCells`、`shiftMonth`、`monthOf`、`todayLocal`

- [ ] **Step 1: 实现页面**

顶部月份标题 + 左右切换（`shiftMonth`，不跨过当前月之后的两个月更远的限制不做）。7 列格子里：日期数字，`inMonth === false` 的格子文字用 `#cccccc`，有记录的日期下方一个 4px 绿色圆点，今天用绿色描边，选中的日子绿底白字。
下方列出选中日子的记录（`listRecords({ date })`），复用 `RecordCard`。点某天 → 拉当天记录。
初始选中 `todayLocal()`，初始月份 `monthOf(todayLocal())`。
切月时并行请求 `/calendar`，并把选中日清空或改为该月 1 号（选后者，避免下面区域突然空白）。

- [ ] **Step 2: 手工验证**

Expected：有记录的日子有绿点；点某天下面出现当天记录；切到上个月再切回来绿点仍在；跨年切换（2026-01 → 2025-12）标题正确。

- [ ] **Step 3: 提交**

```bash
git add app
git commit -m "feat(app): 日历视图"
```

---

### Task 7: 主题列表、主题详情、★ 我看好的

**Files:**
- Create: `app/src/pages/topics/index.vue`, `app/src/pages/topic/detail.vue`, `app/src/pages/starred/index.vue`
- Modify: `app/src/stores/timeline.ts`（支持 `topicId` 与 `starred` 过滤）

**Interfaces:**
- Consumes: Task 4 的 `api/topics.ts`（`getTopicOverview`、`getTopic`、`createTopic`、`updateTopic`、`deleteTopic`）
- Produces: 无新增模块。页面内直接使用 `listRecords({ topicId, starred })` 与 `getStarredExcerpts()`。

- [ ] **Step 1: 实现主题列表页**

顶部一行「★ 我看好的」入口（跳 `starred/index`）。
下面按 `/topics` 返回的 `categories` 分组渲染，每组标题是分类名，组内每个主题一张卡：主题名、`12 条 · ★3 · 最近更新 11月6日`（`lastRecordDate` 为 `null` 时显示「暂无记录」）。`uncategorized` 非空时放在最后一个分组，标题「未分类」。
右上角「＋」：`uni.showActionSheet` 选「新建主题」或「管理分类」。新建主题弹窗（`uni.showModal` 只能输入一行，够用）→ 选分类（`showActionSheet`）→ `createTopic` → 刷新。
底部「常用标签」区块：`getTags()`，每个标签一个胶囊，点击跳 `tag/detail?name=`。

- [ ] **Step 2: 实现主题详情页**

`onLoad({ id })` → `getTopic(id)` 拿标题与统计。
顶部「全部 / 只看 ★」分段控件。
列表：`listRecords({ topicId, starred })`，同样走游标分页，复用 `RecordCard`。
右下角 ＋ → `navigateTo('/pages/record/edit?topicId=' + id)`（编辑器 `onLoad` 读 `topicId` 预置）。

- [ ] **Step 3: 实现 ★ 我看好的页**

`getStarredExcerpts` 游标分页。每条显示：日期、摘抄原文（引用样式）、我的想法、所属主题、以及「查看原记录」→ `record/detail?id=`。

- [ ] **Step 4: 手工验证**

Expected：主题页分组与统计数字正确；进主题详情只有该主题的记录；切成「只看 ★」只剩含 ★ 摘抄的记录；点「我看好的」能看到全局的 ★ 摘抄；从主题详情 ＋ 新建的记录自动带上该主题。

- [ ] **Step 5: 提交**

```bash
git add app
git commit -m "feat(app): 主题列表、主题详情与看好摘抄"
```

---

### Task 8: 标签页、我的（分类管理）

**Files:**
- Create: `app/src/api/categories.ts`, `app/src/pages/tag/detail.vue`, `app/src/pages/mine/index.vue`

**Interfaces:**
- Produces: `api/categories.ts` 的 `listCategories()`、`createCategory(name)`、`updateCategory(id, changes)`、`deleteCategory(id)`

- [ ] **Step 1: 实现标签详情页**

`onLoad({ name })` → `listRecords({ tag: name })`，游标分页，标题显示 `#name`。空态文案「这个标签下还没有记录」。

- [ ] **Step 2: 实现「我的」页**

- 顶部：账号说明（**没有用户信息接口**，所以显示固定文案「微信登录」+ 一个默认头像占位）。
- 「分类管理」：列表显示分类名与排序序号，支持改名（`uni.showModal`）、删除（二次确认，提示「分类下的主题会归入未分类」）、新增。
- 「清除本地缓存」：清掉草稿与 token，`logout()`，提示重新进入会重新登录。
- 「关于」：版本号。

- [ ] **Step 3: 手工验证**

Expected：新增分类后主题页出现新分组；改名后主题页同步；删除分类时该分类下的主题跑到「未分类」；退出登录后重新进入自动重新登录。

- [ ] **Step 4: 提交**

```bash
git add app
git commit -m "feat(app): 标签详情与分类管理"
```

---

## 收尾验收清单

在微信开发者工具里，用一个全新的微信号（或清空 Storage）从头走一遍：

- [ ] 首次打开自动登录，进入时间线
- [ ] 新建一条记录：选主题、改日期、写正文、加两段摘抄（一段 ★）、传两张图、加一个链接，保存成功
- [ ] 该记录立刻出现在时间线顶部，图片能显示
- [ ] 编辑它：删掉一段摘抄、删掉一张图，保存后详情正确
- [ ] 删除它：二次确认后消失
- [ ] 日历上有记录的日子有绿点，点进去能看到当天记录
- [ ] 主题页分组统计正确；进主题详情；切「只看 ★」
- [ ] 「★ 我看好的」能列出所有标星摘抄
- [ ] 搜索 `#标签` 与普通关键词都能命中
- [ ] 断网时保存：报错但草稿还在，恢复网络后能保存
- [ ] `pnpm test` 全绿、`pnpm build:mp-weixin` 成功
