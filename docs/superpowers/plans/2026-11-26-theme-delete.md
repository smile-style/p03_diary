# 主题删除功能（详情页入口）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主题详情页提供「删除主题」入口，让用户能删掉自己建的主题；主题下的记录保留，只是不再归属任何主题。

**Architecture:** 后端与 API 层已经完成，本次只改前端一个页面 + 一个工具函数 + 两个测试文件。删除语义依赖既有的外键 `records.topic_id → topics(id) ON DELETE SET NULL`。

**Tech Stack:** uni-app（Vue 3 `<script setup>`）、Vitest 2（Node 环境；页面逻辑用纯函数单测 + `.vue` 源码断言，不做组件渲染）、`uni.showModal` / `uni.showToast` / `uni.navigateBack`。

**Spec:** 无独立设计文档；现状取证与方案取舍见 §1–§2。

**已确认的前提（主人已选方案 A）：** 删除入口只放主题详情页，列表页不做长按 / 右键删除。

---

## Global Constraints

- **不改后端**：`server/` 下任何文件都不动。`DELETE /topics/:id` 已实现且有测试。
- **不改** `app/src/api/topics.ts`：`deleteTopic(id)` 已经存在且无调用方，直接接入即可。
- 只加详情页入口；**不要**在 `app/src/pages/topics/index.vue` 加任何删除交互。
- 确认框必须写明「记录会保留」；**绝不**级联删除记录。
- 沿用既有交互约定：`uni.showModal` + `confirmText: '删除'` + `confirmColor: '#d94b4b'`；按钮用全局类 `app-button app-button--danger`（定义在 `app/src/App.vue:148`）。
- 不引入新依赖，不新增全局样式。
- 命令在 `app/` 下执行：`pnpm test`、`pnpm typecheck`（Windows 上 `pnpm` 不可用时报错就用 `pnpm.cmd`）。
- 提交信息：`feat(app): 主题详情页支持删除主题`。

---

## §1 现状（已逐条核对到行）

| 事实 | 位置 |
|---|---|
| 后端删除接口已实现：`requireUser` 鉴权、按 `user_id` 限定、删不到返回 404、成功返回 204 | `server/src/topics/routes.ts:239-255` |
| 客户端 API 已存在但**没有任何调用方** | `app/src/api/topics.ts:38-40` |
| 外键 `records.topic_id → topics(id) on delete set null`：删主题后记录保留、`topic_id` 变 NULL | `server/src/db/migrations/001_init.ts:52` |
| 后端测试已覆盖：未登录 DELETE 返回 401 且不写库；带 `content-type: application/json` 空 body 的 DELETE 返回 204 | `server/test/categories-topics.test.ts:536-560`、`:547`、`:590` |
| 详情页 actions 区目前只有「在这个主题下记录」 | `app/src/pages/topic/detail.vue:130-135` |
| 删除记录的既有写法（确认框、toast、延时返回） | `app/src/pages/record/detail.vue:101-126` |
| 删除分类的既有写法（确认文案 + 重载） | `app/src/pages/mine/index.vue:202-224` |
| 前端测试基建：纯函数单测 + `.vue` 源码字符串断言 | `app/test/topics.test.ts`、`app/test/mine-update.test.ts` |
| 主题统计文案函数已有（`topicStatsLabel`） | `app/src/utils/topics.ts:5-13` |

**结论：不需要后端改动，也不需要在服务端补测试。** 本次交付的是「入口 + 确认语义 + 前端可回归的测试」。

---

## §2 设计决定

1. **入口位置**：`AppShell` 的 `#actions` 插槽，放在「在这个主题下记录」的左边，主按钮保持最右。桌面与移动端行为一致，不需要长按 / 右键两套交互。
2. **可见性**：`v-if="topic"`，主题没加载出来时不显示（没有可删的对象，也避免删空）。
3. **确认文案必须讲清楚后果**：记录会保留、只是移出主题；这一点由数据库外键保证，文案不能写成「连同记录一起删除」。
4. **成功后去哪**：toast「已删除」→ 350ms 后 `navigateBack()` 回主题列表；列表页 `onShow` 已经会重新拉取（`app/src/pages/topics/index.vue:44-46`），无需额外通知。
5. **失败**：toast 后端错误信息（`messageOf` 已有），留在当前页。
6. **防重复**：`deleting` 标志同时禁用按钮并在函数入口守卫。

---

## §3 交互规格（验收口径）

### 3.1 入口按钮

在 `app/src/pages/topic/detail.vue` 的 `<template #actions>` 内、主按钮之前新增：

```
<button
  class="app-button app-button--danger"
  :disabled="deleting"
  v-if="topic"
  @click="confirmDelete"
>
  {{ deleting ? '删除中…' : '删除主题' }}
</button>
```

- 不用新增断点样式；AppShell 的 `.workspace-actions` 已有 `gap` 与窄屏规则（`app/src/components/AppShell.vue:416-423`、`:532-534`）。
- 按钮文案在删除过程中变为「删除中…」，并禁用。

### 3.2 确认弹窗

`uni.showModal`：

- `title: '删除主题'`
- `content` 由新函数 `topicDeleteConfirmContent(topic)` 生成：
  - `recordCount > 0` → `「{name}」下的 {recordCount} 条记录会保留，但不再归属任何主题。删除后无法恢复，确定删除吗？`
  - `recordCount === 0` → `「{name}」还没有记录。删除后无法恢复，确定删除吗？`
- `confirmText: '删除'`
- `confirmColor: '#d94b4b'`
- 取消：什么都不做，不发请求。

### 3.3 提交与结果

- `confirmDelete()`：`if (deleting.value || !topic.value) return`
- 确认后 `removeTopic()`：
  - `deleting.value = true`
  - `await deleteTopic(topic.value.id)`
  - 成功：`uni.showToast({ title: '已删除', icon: 'success' })`，`setTimeout(() => uni.navigateBack(), 350)`
  - 失败：`showToast(messageOf(deleteError))`，停留在本页
  - `finally`：`deleting.value = false`
- 删除不影响 `loadPage()` 的 `requestVersion` 机制；返回列表时由列表页 `onShow` 刷新。

---

## §4 任务

### Task 1：确认文案函数（先测后写）

**Files:** `app/src/utils/topics.ts`、`app/test/topics.test.ts`

- [ ] 在 `app/test/topics.test.ts` 追加用例（先写，确认红）：
  - 有记录：`topicDeleteConfirmContent(topic())` === `「投资」下的 12 条记录会保留，但不再归属任何主题。删除后无法恢复，确定删除吗？`
  - 无记录：`topicDeleteConfirmContent(topic({ recordCount: 0 }))` === `「投资」还没有记录。删除后无法恢复，确定删除吗？`
  - 记录数只用 `recordCount`，不依赖 `starredCount` / `lastRecordDate`
- [ ] 在 `app/src/utils/topics.ts` 新增：
  ```
  export function topicDeleteConfirmContent(
    topic: Pick<TopicSummary, 'name' | 'recordCount'>,
  ): string
  ```
- [ ] `cd app && pnpm test` 跑到全绿

### Task 2：详情页接线

**Files:** `app/src/pages/topic/detail.vue`、`app/test/topic-delete-page.test.ts`（新建）

- [ ] `detail.vue`：
  - `import { deleteTopic, getTopic } from '../../api/topics'`
  - `import { topicDeleteConfirmContent, topicStatsLabel } from '../../utils/topics'`
  - 新增 `const deleting = ref(false)`
  - 新增 `confirmDelete()` 与 `removeTopic()`，写法对齐 `app/src/pages/record/detail.vue:101-126`
  - actions 区按 §3.1 加按钮
- [ ] 新建 `app/test/topic-delete-page.test.ts`，参照 `app/test/mine-update.test.ts` 用 `readFileSync` 断言源码（Node 环境，`// @ts-expect-error` 处理 `node:fs` 类型）：
  - 包含 `topicDeleteConfirmContent(`
  - 包含 `deleteTopic(` 调用
  - 包含 `confirmColor: '#d94b4b'`
  - 包含 `setTimeout(() => uni.navigateBack(), 350)`
  - 包含 `app-button--danger`
  - 包含 `:disabled="deleting"`
  - 按钮在 `#actions` 插槽内、「在这个主题下记录」之前（用索引比较）
- [ ] `cd app && pnpm test` 全绿

### Task 3：验证

- [ ] `cd app && pnpm typecheck` 通过
- [ ] `cd app && pnpm test` 全绿（不是只跑新文件）
- [ ] `cd app && pnpm build:h5` 不报错
- [ ] 冒烟（桌面 H5 或打包版）：
  1. 打开一个**有记录**的主题详情 → 点「删除主题」→ 确认框出现且含记录数与「记录会保留」
  2. 取消 → 无请求、无变化
  3. 确认 → toast「已删除」→ 回到主题列表 → 该主题消失
  4. 打开原本属于它的记录 → 记录仍在，主题字段为空
  5. 删除一个**空**主题 → 确认文案走「还没有记录」分支
  6. 失败路径（可临时断网或改 baseUrl）→ 出现错误 toast，页面不跳转

---

## §5 验收清单

1. 主题详情页有「删除主题」，主题未加载时不显示
2. 确认框写明记录数与「记录会保留」
3. 取消不发请求
4. 确认后返回列表，该主题消失；其下记录仍存在且不再归属该主题
5. 失败时 toast 错误、停留原页
6. 删除中按钮禁用，连点只发一次请求
7. `pnpm test`、`pnpm typecheck` 通过

---

## §6 交付

- 分支：`smile-style/theme-delete`（从 `smile-style/windows_daily` @ `89294a0` 切出）
- 已就绪工作区：`C:/Users/10151/orca/workspaces/p03_wx_daily/theme-delete`
- 完成后回报：改动文件清单、`pnpm test` / `pnpm typecheck` 输出、冒烟截图（至少覆盖有记录删除与空主题删除两种确认文案）
- 若发现与本文事实不符（例如后端行为变化），先停下来说明，不要自行扩大改动范围。
