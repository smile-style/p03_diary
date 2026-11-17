# 时间线横向年份轴 + 应用内自动更新 设计

日期：2026-11-16
分支：`smile-style/windows_daily`
状态：待确认
前置设计：`docs/superpowers/specs/2026-11-08-wx-daily-windows-desktop-design.md`

## 1. 为什么做

Windows 桌面版已经能跑（数据层 SQLite、本机单用户、Electron 外壳、NSIS 安装包均已落地）。在它之上做两件事：

1. **时间线改版**：从「竖向卡片流」改成参考图那种「横向年份轴 + 红节点」的视觉，让人一眼看到跨年度的分布。
2. **应用内更新**：加一个「检查更新」按钮，自动发现新版本、下载并安装，不必每次手动去拿安装包。

两件事互相独立：一个改前端，一个改桌面外壳与发布流程。

## 2. 目标与非目标

### 目标

- 时间线顶部有一条横向年份轴，节点按**年份**排布，节点下方显示该年记录数；点击节点切换到该年。
- 选中某年后，下方按「年份分组 + 月份」列出该年的记录卡片；点月份筛选到该月。
- 保留现有能力：搜索框、`#标签` 搜索、滚动加载更多、右下角 ＋ 新建、认证失败重试。
- 「我的」页有一个「检查更新」入口：显示当前版本；查到新版本时显示版本号与更新说明，可一键下载并在完成后重启安装。
- 打包产物带 `latest.yml`，可直接上传到 GitHub Releases 供客户端读取。

### 非目标（本次不做）

- 不改数据模型主结构（只新增一个只读的年份聚合接口）。
- 不做「把几百条记录横向平铺」的全量时间轴。
- 不做增量更新（差分下载）、不做灰度发布、不做自动回滚。
- 不做 Windows 代码签名（无证书；用户安装时会出现 SmartScreen 提示，属已知限制）。
- 不做 macOS / Linux 更新通道。

### 反目标

- 记录变多以后时间线卡顿或横向滚动几屏才找到内容。
- 更新把用户数据搞坏（数据目录必须完全不受安装目录影响）。
- 更新流程在无网络、GitHub 不可达时把应用卡死或反复弹窗。
- 更新按钮在开发模式（非打包）下也去真的下载安装。

## 3. 关键约束（现状事实）

| 事实 | 影响 |
|---|---|
| `app/` 是 uni-app，同时要出 H5（桌面用）。改页面必须只用 uni 内置组件与 CSS，不能引第三方 UI 库 | 年份轴用 `scroll-view scroll-x` + view/text 手写 |
| 前端 `RecordFilter` 只有 `date / topicId / tag / q / starred` | 需要新增年份范围过滤，后端 `listRecords` 要支持 |
| 后端 `listRecords` 已是游标分页，排序为 `record_date desc, created_at desc, id desc` | 新增过滤条件必须与之兼容，不能破坏游标 |
| 记录日期是 `YYYY-MM-DD` **纯字符串**，SQLite 里是 TEXT | 年份过滤用 `record_date >= 'YYYY-01-01' and < 'YYYY+1-01-01'` 字符串比较即可，不需要日期函数 |
| 已有 `/calendar?month=YYYY-MM` 按月聚合的接口 | 加 `/years` 按年聚合时照它的写法，保持一致 |
| 「我的」页版本号读 `app/src/manifest.json` 的 `versionName` | 更新检查要比较的是 Electron 打包版本（`package.json` 的 `version`），两者必须同步 |
| `electron-updater` 最新稳定为 6.8.x，依赖 `builder-util-runtime@9.7.0` | 与 electron-builder 26 配套可用 |
| **`desktop/release/` 目前是坏的**：`win-unpacked` 只有 `default_app.asar`，缺 exe / app.asar / web | 新任务必须先把打包流程修好，否则更新链路无从验证 |
| **本机没有代码签名证书** | Electron 自动更新在未签名时可用，但 Windows 安装会弹 SmartScreen |

## 4. 方案与取舍

### 4.1 时间线改版

| 方案 | 做法 | 取舍 |
|---|---|---|
| **A. 年份轴 + 年份分组列表（已选）** | 顶部横向轴只放年份节点；点年份后下方列该年记录，按月份分区；月份可再筛选 | 视觉接近参考图，记录变多仍可用；代价是「看到跨年分布」需要多点一下 |
| B. 完全照参考图横向平铺所有记录 | 每条记录一列，横向滚动 | 最像参考图，但 4 条时好看，200 条时灾难。排除 |
| C. 保持竖向列表只改日期样式 | 左侧加竖轴与节点 | 改动最小，但没达到「横向年份轴」的原始诉求。排除 |

选 A。理由：参考图的价值在「时间刻度的空间感」，而不是「必须横着滚」；A 保留了前者且不牺牲可浏览性。

### 4.2 自动更新

| 方案 | 做法 | 取舍 |
|---|---|---|
| **A. electron-updater + GitHub Releases（已选）** | 打包时生成 `latest.yml`，上传 Release；应用内 `autoUpdater.checkForUpdates()` | 与 electron-builder 天然配套，代码最少；前提是仓库/Release 资产可被匿名读取 |
| B. 自建静态服务器 | `scp` 到云服务器静态目录，`publish` 指向该 URL | 不依赖 GitHub，但要自己管 HTTPS、目录和清理 |
| C. 只检查不安装 | 调 GitHub API 比版本号，弹窗引导下载 | 实现最简单，但没有「自动安装」，不符合原始诉求 |

选 A（发起人 2026-11-16 决定）。

**阻塞前提（必须在实现前确认，见 §8）**：`gh repo view smile-style/p03_diary` 返回「仓库不存在」，`git ls-remote origin` 也无法认证。说明要么仓库名不对，要么是私有仓库。**私有仓库的 Release 资产默认不可匿名下载，自动更新会 404。** 所以要么仓库/a Release 资产公开，要么改用方案 B。

## 5. 产品行为（已和发起人确认）

### 5.1 时间线

```
┌──────────────────────────────────────────────┐
│ [ 搜索记录，或输入 #标签              ]       │
├──────────────────────────────────────────────┤
│  2024 ─●─ 2025 ─●─ 2026 ─●─→                 │  ← 横向滚动，选中节点红色
│   12      37      4                          │  ← 该年记录数
├──────────────────────────────────────────────┤
│  2026年                                       │
│  ┌── 5月 (2) ──────────────────────────┐      │  ← 月份可折叠/筛选
│  │  ┌──────────────────────────┐      │      │
│  │  │ 5月11日  主题  正文摘要…  │      │      │
│  │  └──────────────────────────┘      │      │
│  └────────────────────────────────────┘      │
└──────────────────────────────────────────────┘
```

- 轴上的年份来自新接口 `GET /years`，返回 `{ items: [{ year: "2026", count: 4 }] }`，按年份倒序。
- 首次进入默认选中「最近有记录的那一年」。**一条记录都没有时年份轴仍然显示**（只显示「全部」节点），避免界面在首屏跳动；此时列表走现有空状态。
- 点击年份节点：切换到该年（服务端过滤），列表回到该年最新一页。
- 年份多时轴横向滚动，选中项自动滚入可视区。轴最左侧有一个「全部」节点，**默认不被选中**，点它清空年份过滤、回到跨年时间线（与改版前行为一致）。
- 月份分区标题右侧的条数是**该月的真实总数**（来自 `/year-months` 聚合），不是「已加载条数」。
- 点月份标题 → 服务端按 `month` 过滤该月（再点取消）。**不做纯前端过滤**：年内记录超过一页时，前端过滤会把「还没加载到」误显示成「没有记录」。
- 保留现有：搜索（含 `#标签`）、滚动加载更多、右下角 ＋、「已经到底了」。
- **搜索始终在当前年份范围内进行**；想跨年搜索，点轴上「全部」或清空筛选。这条要写进空状态提示语，避免用户以为记录丢了。
- 搜索结果带上年份过滤时，年份轴仍显示**全部**年份（轴反映的是「哪里还有内容」，不是搜索结果）。
- 未选中任何年份（「全部」态）时，列表仍是按月分组的，只是月份标题不显示条数（跨年聚合条数没有意义）。

### 5.2 更新按钮

位置：「我的」页「打开数据文件夹」下方，新增一张「应用更新」卡片。

- 常态显示：`当前版本 v0.1.0`，右侧「检查更新」。
- 点击后状态流转：`检查中…` → 以下之一：
  - `已是最新版本`（1.5 秒后恢复常态）
  - `发现新版本 v0.2.0` + 更新说明 + 「立即更新」
  - `检查失败：<原因>` + 「重试」
- 点「立即更新」→ `下载中 42%` → `下载完成，重启后生效` + 「立即重启」。
- 点「立即重启」→ 应用退出、静默安装、自动拉起新版。
- **开发模式（`app.isPackaged === false`）下：按钮可见但只显示「开发模式不检查更新」，不发起请求。**
- 应用启动时**静默检查一次**，只有发现新版本才在「我的」页卡片上打一个「有新版本」标记，不弹窗、不打断。

## 6. 技术设计

### 6.1 后端：年份与月份聚合接口

`server/src/queries/routes.ts` 新增两个只读聚合接口，照 `/calendar` 的写法：

```ts
GET /years?          →  { items: [{ year: '2026', count: 4 }] }
GET /year-months?year=2026  →  { items: [{ month: '2026-05', count: 2 }] }
```

- `/years`：`select substr(record_date,1,4) as year, cast(count(*) as integer) as count from records where user_id = ? group by year order by year desc`。
- `/year-months`：同样的写法，`substr(record_date,1,7) as month`，`year` 用 `like 'YYYY-%'` 或字符串范围过滤，按 `month desc` 排序。
- 读出后 `count` 一律包 `Number()`。
- 两者都只依赖 `records` 表，不新增索引（聚合本来就扫全表，单人数据量足够）。

**为什么要第二个接口**：月份分区标题上要显示「该月真实总数」。如果用「当前已加载条数」代替，年内记录超过一页时会显示错误数字；如果前端自己数，同样的问题。必须由服务端给总数。

### 6.2 后端：`listRecords` 支持 `year` 与 `month` 过滤

- `recordQuerySchema` 增加：

```ts
year: z.string().regex(/^\d{4}$/, 'Year must be four digits').optional(),
month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM').optional(),
```

- `year` 过滤（**必须用字符串范围比较**，不要用 `strftime` 或 `substr`，以保证走 `records_user_date_idx`）：

```ts
if (query.date === undefined && query.month === undefined && query.year !== undefined) {
  const next = String(Number(query.year) + 1).padStart(4, '0')
  idsQuery = idsQuery
    .where('record.record_date', '>=', `${query.year}-01-01`)
    .where('record.record_date', '<', `${next}-01-01`)
}
```

- `month` 过滤（同样用字符串范围，`month` 比 `year` 更具体，因此优先）：

```ts
if (query.date === undefined && query.month !== undefined) {
  const [y, m] = query.month.split('-')
  const nextMonth = Number(m) === 12
    ? `${Number(y) + 1}-01`
    : `${y}-${String(Number(m) + 1).padStart(2, '0')}`
  idsQuery = idsQuery
    .where('record.record_date', '>=', `${query.month}-01`)
    .where('record.record_date', '<', `${nextMonth}-01`)
}
```

- 优先级：`date` > `month` > `year`。三者只生效一个（更具体的赢），避免算错交集。
- 游标逻辑不变。

### 6.3 前端：时间线

- `app/src/api/types.ts`：`RecordFilter` 增加 `year?: string`、`month?: string`。
- `app/src/api/queries.ts`：新增 `getYears()` 与 `getYearMonths(year)`。
- `app/src/api/records.ts`：`ListRecordParams` 增加 `year?`、`month?` 并透传到 query。
- 新增 `app/src/components/YearAxis.vue`：
  - props：`items: { year: string; count: number }[]`、`selected: string | null`
  - emit：`select(year: string | null)`，`null` 表示「全部年份」
  - 结构：`scroll-view scroll-x` + 最左一个「全部」节点 + 每个年份一个 `.year-node`（圆点 + 年份 + 计数）；选中态用 `--color-timeline-axis: #d0021b`（对齐参考图的红）。
  - 用 `scroll-into-view` 让选中年份自动可见。
- 新增 `app/src/utils/timeline-groups.ts`（纯函数，好测）：

```ts
export type TimelineGroup = { month: string; label: string; records: RecordView[] }
export function groupByMonth(records: RecordView[]): TimelineGroup[]
```


按 `recordDate` 的 `YYYY-MM` 分组，组内保持传入顺序，组间按月份倒序，`label` 形如 `2026年5月`。

- 改 `app/src/pages/timeline/index.vue`：
  - 顶部搜索栏下方插入 `YearAxis`。
  - 主体从 `RecordCard` 平铺改成按 `groupByMonth` 分组渲染，每组一个标题 + 卡片。
  - 新增状态 `selectedYear`；改变年份时调用 `timeline.reset({ ...filter, year })`。
  - 进页面时先 `getYears()`，默认选中 `years[0].year`（最新年）；若为空则不渲染轴。
  - 搜索提交时保留当前 `selectedYear`（即搜索在年内进行）；清空搜索时保留年份。
- 样式沿用现有 CSS 变量；红色节点用新变量 `--color-timeline-node: #d0021b`，定义在 `App.vue` 的 `page` 选择器，与现有 `--color-*` 并列。

### 6.4 Electron：更新模块

新增 `desktop/src/update.ts`（纯逻辑 + 薄封装，便于单测）：

```ts
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string; notes: string | null }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

export function registerUpdateIpc(opts: {
  isPackaged: boolean
  currentVersion: string
  quitAndInstall: () => void
}): void
```

- IPC 通道：
  - `wx-daily:update:check`（invoke，返回 `UpdateState`）
  - `wx-daily:update:download`（invoke）
  - `wx-daily:update:install`（send）
  - `wx-daily:update:get-state`（invoke，返回**主进程缓存的最新状态**）
  - `wx-daily:update:state`（主 → 渲染，推送状态）
- **必须有 `get-state`**：启动时的静默检查很可能在用户打开「我的」页之前就结束了，只推不管会让「有新版本」标记永远显示不出来。主进程用一个模块级 `let state: UpdateState` 缓存最后状态，渲染层挂载时先 `get-state` 拉一次，之后靠推送增量更新。
- 用 `electron-updater` 的 `autoUpdater`：`autoDownload = false`、`autoInstallOnAppQuit = true`。
- 事件映射：`checking-for-update` → `checking`；`update-available` → `available`（带 `version`、`releaseNotes`）；`update-not-available` → `up-to-date`；`download-progress` → `downloading`（`percent` 取整）；`update-downloaded` → `downloaded`；`error` → `error`。
- 所有错误吞掉堆栈，只把 `error.message` 传给渲染层。
- **不自动下载**：只在下发 `download` 后开始。
- `isPackaged === false` 时 `check` 直接返回 `{ kind: 'error', message: '开发模式不检查更新' }`，且**不 import 时触发网络**。

### 6.5 打包与发布配置

- `desktop/package.json` 的 `version` 是更新比较的唯一来源。**必须与 `app/src/manifest.json` 的 `versionName` 保持一致**，加一条测试钉住。
- 本次发布版本号：**`0.2.0`**。三处一起改：`desktop/package.json`、`app/src/manifest.json` 的 `versionName`、`app/package.json` 的 `version`（最后一处不影响更新，但保持一致避免混淆）。
- `electron-builder.yml` 增加：

```yaml
publish:
  provider: github
  owner: smile-style
  repo: p03_diary
```

- electron-builder 在打 NSIS 时会自动生成 `latest.yml` 与 `.blockmap`。`latest.yml` 的 URL 指向 Release 资产名——**资产名含中文（`生活记录 Setup 0.1.0.exe`）时，URL 会被百分号编码，部分客户端解析出错**。因此把 `artifactName` 固定为 ASCII：

```yaml
nsis:
  artifactName: wx-daily-setup-${version}.exe
```

- **更新说明的来源**：`electron-builder` 只在它自己执行 publish 时才把 release notes 写进 `latest.yml`。本项目是「打包后手工 `gh release upload`」，所以 `releaseNotes` 会为空，卡片上的说明区永远不显示。**接受这个限制**：卡片只显示版本号，不显示说明文字。UI 里 `notes` 分支保留（`electron-updater` 若从 GitHub 拿到说明会显示），但不要为它做额外投递机制。
- 顺带修掉当前 `dist` 脚本的文件锁问题（`win-unpacked` 重命名 `EPERM/EBUSY`）：脚本改为先 `rimraf release` 再打包，并在失败时打印明确提示；若仍被锁，提示「请关闭正在运行的生活记录 / 资源管理器窗口后重试」。
- **基线安装包**：手工验收「从旧版更新到新版」需要先有一个可安装的 0.1.0 包。当前 `desktop/release/` 是坏的，所以要先把 Task 7 的打包修复跑通，产出一个干净的 0.1.0 安装包并留存；之后改版本到 0.2.0 再打包上传。这属于 Task 12 的准备动作。

### 6.6 前端读更新状态

`app/src/pages/mine/index.vue` 新增「应用更新」卡片，通过 `globalThis.wxDailyDesktop.update` 访问（preload 暴露）：

```ts
// preload.cts 追加
update: {
  check: () => ipcRenderer.invoke('wx-daily:update:check'),
  download: () => ipcRenderer.invoke('wx-daily:update:download'),
  install: () => ipcRenderer.send('wx-daily:update:install'),
  getState: () => ipcRenderer.invoke('wx-daily:update:get-state'),
  onState: (cb: (state: unknown) => void) => {
    const listener = (_e: unknown, state: unknown) => cb(state)
    ipcRenderer.on('wx-daily:update:state', listener)
    return () => ipcRenderer.removeListener('wx-daily:update:state', listener)
  },
}
```

- **版本号如何到 preload**：preload 里拿不到 Electron 的 `app`。用主进程建窗口时的 `additionalArguments` 传 `--wx-app-version=<app.getVersion()>`，preload 按与 `--wx-data-path=` 相同的方式解析（已有 `PREFIX` 写法可照抄）。不要用环境变量——它不会随窗口创建传递。
- `bridge` 不存在时（浏览器调试），卡片显示「桌面版可用」并禁用按钮。
- 版本号显示优先用 `wxDailyDesktop.version`（来自 `app.getVersion()`），拿不到再退回 `manifest.versionName`。
- 页面挂载时：先 `await update.getState()` 拿一次，再订阅 `onState`。**顺序不能反**——先订阅后拉取会在两次调用之间漏掉状态；先拉取后订阅最多重复一次，无害。

## 7. 验收

- `server`：`pnpm test` 全绿，新增用例覆盖 `/years`、`/year-months` 聚合、`year` 与 `month` 过滤、月份与游标组合翻页、跨年不泄漏。
- `app`：`pnpm test` + `pnpm run typecheck` 全绿，新增用例覆盖 `groupByMonth`、年份/月份切换时的 `reset` 参数、`getYears`/`getYearMonths` 请求路径。
- `desktop`：`pnpm test` 全绿，新增用例覆盖 `UpdateState` 映射、`get-state` 通道存在、开发模式不发请求、版本号一致性。
- 手工：
  - 时间线显示年份轴，点不同年份列表随之变化；点「全部」回到跨年视图。
  - 月份标题的条数与实际相符；年内记录超过 20 条时，点月份仍能看到该月全部记录（这是本次修复的核心场景）。
  - 搜索在当前年份内生效；点「全部」后可跨年搜索。
  - 「我的」页显示当前版本；点「检查更新」在无网时给出手动可读的错误而不是卡住。
  - 打包后把 `release/` 里的 `latest.yml` 与 exe 上传到一个 GitHub Release，用旧版本安装并点击更新，能完成下载 → 重启 → 版本号变化。

## 8. 实现前必须先确认的一件事

**GitHub 上 `smile-style/p03_diary` 这个仓库现在访问不到**（`gh repo view` 报错、`git ls-remote` 无法认证）。自动更新要求客户端能**匿名**读取 Release 资产。

三种可行状态，实现时按实际情况选：

1. 仓库改为 public → 直接用 `provider: github`，最省事。
2. 仓库保持 private，但 Release 资产设为公开可读 → 可行，但需要显式设置。
3. 都不行 → 改方案 B（自建静态服务器），§6.5 的 `publish` 换成 `provider: generic` + `url: https://<你的域名>/wx-daily/`。

**在确认之前，Codex 应该先把时间线（§6.1–6.3）全部做完并验证，更新功能做到"代码完成但端点待填"**——即更新模块、IPC、UI 都实现并单测，`publish` 配置留一个清晰的 TODO 注释。这样不管最后走哪条路，只有配置文件需要改。

## 9. 留给实现者决定

- 年份轴上选中节点的自动滚动用 `scroll-into-view` 还是手动 `scrollLeft` 计算（倾向前者）。
- 月份分组是否做成可折叠（倾向：不做折叠，只做筛选，减少交互层级）。
- `latest.yml` 上传是手工上传还是加一个 `pnpm release` 脚本调 `gh release upload`（倾向后者，写进文档即可）。
