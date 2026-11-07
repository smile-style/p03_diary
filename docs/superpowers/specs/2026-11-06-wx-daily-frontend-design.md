# 生活记录小程序 · 前端设计（uni-app）

日期：2026-11-06
状态：待确认
上游设计：`docs/superpowers/specs/2026-11-06-wx-daily-diary-design.md`

## 1. 范围

后端（`server/`）已完成并通过独立评审：微信登录、分类 / 主题 / 记录（摘抄卡片、★、标签、图片）、时间线 / 日历 / 标签 / 搜索 / ★ 查询、内容安全、Docker 部署。本文件只描述前端。

**本阶段目标**：在微信小程序里，用真实后端接口跑通「登录 → 看时间线 → 写一条记录 → 回看得回去」这条完整链路，再按页面逐步补齐到设计文档 5.2 节的全部界面。

**本阶段不做**：Android App 打包（同一份代码后续直接编译，本阶段只保证不写死小程序专有 API 之外的逻辑）、分享、离线同步、AI 标签推荐。

## 2. 关键约束（来自后端现状，前端必须适配）

1. **没有 CORS，也不需要**。小程序 `uni.request` 不受同源策略约束，直接请求 `http://192.168.8.16:3000`。开发期在开发者工具中关闭「校验合法域名」。H5 调试走 Vite 代理，不改后端。
2. **后端没有用户信息接口**。只有 `POST /auth/wechat` 返回 JWT。所以「我的」页不显示昵称头像，只做分类管理、清除本地缓存、退出登录。
3. **图片 URL 1 小时过期**。`signFileUrl` 默认 TTL 3600 秒。记录对象**不得写入本地持久化**，只在内存中保存；重新进入页面或数据超过 50 分钟就重新拉取。否则会出现整屏裂图。
4. **列表是游标分页**。`GET /records` 返回 `{ items, nextCursor }`，`nextCursor` 是 base64url 字符串，不能再当页码用。`limit` 范围 1–50，默认 20。
5. **日期是 `YYYY-MM-DD` 纯字符串，「今天」由前端决定**，后端不做时区换算。用 `toISOString()` 取今天在 UTC+8 会错一天，必须用本地 `getFullYear / getMonth / getDate`。
6. **标签不是提交字段**。服务端从「正文 + 摘抄的想法」里用 `[#＃]([\p{L}\p{N}_]+)` 提取，`RecordInput` 里没有 `tags`。所以工具栏的「#标签」只是往光标处插一个 `#`，标签的增删改等于改文本。
7. **摘抄 id 每次保存都会变**。`saveRecord` 是先删后插。前端不能用摘抄 id 作为列表 key 的稳定标识而依赖其跨保存不变。
8. **上传的图片没有删除接口**。在编辑器里上传后放弃保存，图片会成为孤儿（服务端只在 PUT 时删除被移除的图）。接受这个损耗，不做清理 UI。
9. **错误响应统一为 `{ error: { code, message } }`**，`message` 是中文，可直接展示给用户。`CONTENT_REJECTED`(422) 和 `CHECK_UNAVAILABLE`(503) 都必须保留草稿。

## 3. 技术选型（已定）

| 项 | 选择 | 理由 |
|---|---|---|
| 框架 | uni-app + Vue 3 + TypeScript + Vite | 设计文档已定；一套代码后续出 Android |
| 状态 | Pinia | 与 Vue 3 配套，体量小 |
| UI | 不引第三方组件库 | 界面已有草图，手写样式更贴合；只有原生 picker 和 uni 内置组件 |
| 测试 | Vitest（纯函数 + 请求层） | 页面级 UI 无法在 Node 里跑，靠开发者工具手工验收 |
| 目录 | `app/` | 与 `server/` 平级，各自独立安装依赖 |

**版本必须对齐（实测过的约束）**：`@dcloudio/vite-plugin-uni` 的 peer 依赖把 `vite` 钉死在 `5.2.8`，装 5.4.x 会直接 ERESOLVE 失败。所有 `@dcloudio/*` 包用同一个版本号。

## 4. 结构

```
app/
  src/
    main.ts  App.vue  pages.json  manifest.json  uni.scss
    config.ts               API 地址、常量
    api/
      client.ts             请求封装：注入 token、解析错误、401 单次重试
      records.ts  topics.ts  categories.ts  images.ts  queries.ts  auth.ts
      types.ts              与服务端契约一一对应的 TS 类型
    stores/
      auth.ts               token、login()、refreshToken()、logout()
      timeline.ts           列表 + 游标 + 去重
    utils/
      date.ts               今天 / 月份 / 日历格子 / 中文日期
      draft.ts              草稿序列化与恢复
      record-input.ts       编辑器状态 → RecordInput
      search.ts             "#标签" 与关键词的分流
      tags.ts               光标处插入 #标签
    components/             记录卡片、摘抄卡片、空态、加载态
    pages/
      timeline/index        Tab 1  时间线（含搜索）
      calendar/index        Tab 2  日历
      topics/index          Tab 3  主题（含 ★我看好的 入口）
      mine/index            Tab 4  我的
      record/edit           新建 / 编辑记录
      record/detail         记录详情（编辑、删除）
      topic/detail          主题详情（全部 / 只看★）
      tag/detail            标签下的记录
      starred/index         所有 ★ 摘抄
    styles/                 颜色、间距变量
  test/
```

## 5. 我的决定（可推翻）

- **底部四个 Tab**：时间线 / 日历 / 主题 / 我的，与草图 A 一致。
- **搜索框放在时间线顶部**，不单开搜索页。输入 `#投资` 这种整串的标签形式走 `tag` 参数，其他走 `q` 参数。
- **主题详情页复用记录卡片组件**，通过 `GET /records?topicId=` 拉数据，不新增接口。
- **记录详情页独立存在**，不做成「列表里直接展开」。这样删除和编辑有明确落点。
- **主色 `#07c160`（微信绿）**，从草图沿用；颜色统一用 CSS 变量，写在 `App.vue` 的 `page` 选择器上。
- **草稿按记录粒度存**：新建用 `draft:new`，编辑用 `draft:record:<id>`。成功保存后清除。
- **日历以周日开头**，表头 `日 一 二 三 四 五 六`。

## 6. 验收方式

每个阶段都要满足：`pnpm test` 全绿、`pnpm build:mp-weixin` 成功、开发者工具里手工走一遍该页面的主流程。手工清单写进实现计划末尾。
