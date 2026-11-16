# 生活记录 · Windows 桌面版设计

日期：2026-11-08
分支：`smile-style/windows_daily`（从 `smile-style/dev1` 快进拉出）
状态：待确认
上游设计：`docs/superpowers/specs/2026-11-06-wx-daily-diary-design.md`、`2026-11-06-wx-daily-frontend-design.md`

## 1. 为什么做

发起人想要一个**只在自己的 Windows 电脑上用**的版本：离线可写、数据完全掌握在自己手里。

已明确的产品取向（发起人原话）：

- 只在电脑上做「能离线写、能自己掌控数据」的版本。
- 先走 Electron 方案；等产品成熟后再考虑用 Tauri 优化（体积 / 内存）。
- 用一个专门的 git 分支做 Windows 版。

### 1.1 这是一条分叉，不是共存

`smile-style/windows_daily` 是一条**单向分叉**：从这里往后，它与 `dev1` / `main` 各自演进。

- 这一支改 SQLite、删微信登录、删内容审核、改测试夹具，**不需要**保证 `build:mp-weixin` 还能构建。
- `deploy/`、`docker-compose*.yml`、`server/Dockerfile` 在这一支不再维护，也不删除（保留历史，便于回看；不参与本支构建与测试）。
- 代价：`dev1` 以后新增的页面或功能不会自动出现在这一支，需要手工挑选（cherry-pick）。这是「用一个专门分支」的必然结果，接受。

所以下文所有「改成 SQLite」「删掉」都是**在这一支上直接改**，不做方言无关的双写。

## 2. 目标与非目标

### 目标（第一版）

- 双击图标即用，不装数据库、不装 Docker、不需要网络。
- 数据存在**用户自己能找到的文件夹**（见 §4.1）。
- 完整保留产品设计里的四类能力：时间线、日历、主题（含分类与 ★ 看好）、标签与搜索；记录的摘抄卡片、图片、链接、`#标签` 一个不少。
- 服务端测试套件改造成 SQLite 环境后全绿，作为「没改坏」的证据。

### 非目标（第一版不做）

- 与小程序 / 云端的数据同步。两边是独立的库（一次性导入见 §2.1）。
- 多用户、账号体系、微信登录。
- 内容安全审核（本机单人使用，不存在 UGC 审核诉求）。
- 桌面专用界面（三栏布局、快捷键、托盘、开机自启）。第一版界面原样复用手机版。
- 自动更新、代码签名、微软商店上架。

### 2.1 历史数据导入（待发起人决定）

小程序若已经在用，桌面版首启是空库。是否要一次性把云端记录搬到本机，尚未确定，见 §8 待定项。若要做，是一份独立的一次性导出脚本（Postgres → SQLite，含 `images/` 目录同步与 `id` 保持不变），不进主流程。

### 反目标

- 数据存在隐藏目录里，用户找不到、拷不走。
- 升级安装覆盖用户数据。
- 换数据库的过程中功能悄悄退化（搜索搜不到、日历错一天、图片裂图）。
- 重启后草稿丢失、或卡在「请先登录」。

## 3. 方案与取舍

| 方案 | 做法 | 结论 |
|---|---|---|
| **A. Electron + 复用 Fastify（已选）** | Electron 主进程内置现有 Fastify 服务，只监听 `127.0.0.1` 固定端口；窗口加载 uni-app 的 H5 构建；Kysely 方言从 Postgres 换 SQLite | 保留全部现有代码与测试结构，改动集中在数据层、登录、外壳。代价是安装包 ~150MB、内存 ~200MB，自用无感 |
| B. Tauri v2 + Rust 重写数据层 | 系统 WebView2，包体十兆级；但没有 Node 运行时，要么 sidecar 打 Node，要么用 rusqlite 把 `server/src` 重写一遍 | 体积内存更优，但代价是重写半个后端、丢掉现成测试。**留作产品成熟后的优化项** |
| C. 不套外壳，浏览器打开 | 本机起服务，浏览器访问 | 不是桌面 app：无图标、无单实例、关浏览器即断。排除 |

方案 A 的再确认（发起人 2026-11-08 决定）：先 A，成熟后再评估 B。

## 4. 关键决定（我的判断，可推翻）

### 4.1 数据目录

```
%USERPROFILE%\Documents\wx-daily\
  app.db            主数据库（SQLite）
  images\           原图（LocalFileStorage 根目录）
  backups\          自动备份的数据库快照
  secret.key        本机 JWT 密钥（跨重启复用，见 §4.3）
```

不选 `%APPDATA%`：原始痛点就是「XMind 的文件存在哪里找不到」，所以放在用户会主动去翻的地方。

**OneDrive 重定向的处理**：Windows 上「文档」常被 OneDrive 接管，SQLite 主库放同步目录有被并发写入损坏的风险。启动时检测解析后的文档路径是否位于 OneDrive 目录下（路径含 `\OneDrive` 或 `app.getPath('documents')` 与 `ONE DRIVE` 环境指示不一致），若是则回退到 `%USERPROFILE%\wx-daily\`。两个位置都在用户的用户目录下，都能直接翻到。「我的」页显示实际使用的路径，并提供「打开数据文件夹」。

路径来源统一封装为一个函数，允许环境变量 `WXDAILY_DATA_DIR` 覆盖——用于测试与多份数据并存。

### 4.2 数据库：Postgres → SQLite

用 **Node 内置的 `node:sqlite`**，不引入 `better-sqlite3`：免去原生模块重编译，配 electron-builder 不需要额外配置。

**先做 spike 验证**：Electron 内嵌的 Node 版本低于本机 Node 26，历史上出现过 `node:sqlite` 未编进二进制的情况。第 1 阶段开工第一件事，在目标 Electron 版本里 `require('node:sqlite')` 建库写读一遍。若不可用，退 `better-sqlite3`（它有面向 Electron 的预编译产物，通常无需 MSVC；本机没有 Visual Studio 构建工具，若预编译也缺就得另选 Electron 版本）——这条退路在第 1 阶段结束前必须有个结论。

写入用 Kysely + 自定义方言。Kysely 官方没有 first-party SQLite 方言：

- 自建方言约 150–200 行，只覆盖本项目用到的语法，用改造后的测试套件验证。
- 或引 `kysely-node-sqlite` 这类社区包。**先按自建方言写**；若测试暴露的语法面比预期大，再换社区包。

需要逐一处理的方言差异（从现有代码里扫出来的）：

| 现有 Postgres 写法 | 位置 | SQLite 处理 |
|---|---|---|
| `uuid` 生成（`gen_random_uuid()`） | 迁移 | 应用层 `crypto.randomUUID()` 生成 |
| `timestamptz` / `date` | 迁移、游标 | 统一存 `TEXT`：日期 `YYYY-MM-DD`，时间 `YYYY-MM-DDTHH:MM:SS.sssZ`（定长，字典序 = 时间序） |
| 行值比较 `(a,b,c) < (?,?,?)` | `queries/routes.ts` 游标 | 改成分项比较 `a < ? or (a = ? and b < ?) or ...` |
| `ilike` | 搜索 | `lower(x) like lower(?)`；`%`/`_` 转义沿用现有 `escapeLikeLiteral` |
| `pg_trgm` 扩展与索引 | 迁移 | 删除；单人数据量下 `LIKE '%q%'` 全表扫描足够 |
| `record_date::text`、`to_char(...)` | 查询 | 列本身就是 TEXT，不再需要格式化 |
| `count(*)::int` | 日历、标签 | `count(*)`，读出后 `Number()` 转换 |
| 布尔 `true` | 查询 | SQLite 存 0/1，方言层转换 |
| `text[] links` | records 表 | 改存 JSON 文本，读写时序列化 |

改造范围：`server/src/db/`（新写一份 SQLite 初始迁移，旧 Postgres 迁移在本支删掉）、`server/src/queries/routes.ts`、`records/service.ts`、`records/tags.ts`、`categories/routes.ts`、`topics/routes.ts`、`images/routes.ts`、`images/signed-url.ts` 中涉及类型的地方。

> 实测（2026-11-08）：Electron 45 主进程中 node:sqlite 可用。

### 4.3 登录与本地会话

删掉 `/auth/wechat`、`auth/wechat-client.ts`、`moderation/`（含 `push-routes.ts`）、`config.ts` 里的微信相关字段。

新增：

- **`ensureLocalUser()`**：启动时若 `users` 表为空，插入一个用户并写入默认分类（投资 / 学习 / 好文章 / 生活），返回其 id。
- **`GET /auth/local`**：返回该用户的 token，可重复调用，幂等。
- **JWT 密钥持久化**：首次启动生成随机密钥写入数据目录的 `secret.key`，之后复用。否则每次启动旧 token 全部失效。

**前端对应改动**（这里推翻原设计里「store 不动」的说法）：

- `stores/auth.ts` 改调 `/auth/local`，去掉 `uni.login`。
- `ensureSession()` 在启动时即使本地已有 token 也调一次 `/auth/local` 覆盖（本机接口零成本），彻底消除「令牌过期 → 卡在请先登录」这一整个失败模式。
- 「我的」页去掉微信相关文案，增加「打开数据文件夹」并显示实际数据路径。

`requireUser` 与 `user_id` 过滤**保留不动**——单用户时它退化为恒真条件，但结构还在，未来若要恢复多用户不必重写。

### 4.4 内容安全

`moderation/` 整个目录与 `push-routes.ts` 删除；图片入库时 `status` 直接写 `ok`。`fileUrlSecret` 签名机制保留（无害，且图片路由已有测试）。

### 4.5 前端

- 用已有的 `build:h5` 产出静态文件，由 Fastify 用 `@fastify/static` 托管在同一端口，Electron 窗口加载 `http://127.0.0.1:<固定端口>/`。**这样同源，`uni.request` 直连不需要 CORS 代理。**
- `config.ts` 的 `API_BASE_URL` 在桌面构建下改为空串（走同源相对路径）。
- 其余页面、组件、utils 不动。

**端口必须固定**，不能随机。原因：H5 下 `uni.setStorageSync` 就是 localStorage，按 origin（含端口）隔离。端口一变，`utils/draft.ts` 的草稿（`DRAFT_KEY_PREFIX`）全部落在旧 origin，等于被清空；`wxdaily.token` 同理。

- 固定端口 `47821`。启动时先尝试绑定；若被占用，不静默换端口，而是弹窗告知「端口 47821 被占用，请关闭占用该端口的程序后重试」。
- 之后若确有冲突困扰，再考虑自定义协议或把草稿搬进文件存储——第一版不做，避免过度设计。

### 4.6 Electron 外壳

```
desktop/
  main.ts        主进程：起服务 → 建窗口 → 退出时关库
  preload.ts     只暴露最小能力（打开数据文件夹、显示版本与数据路径）
  package.json   打包配置（electron-builder，NSIS 安装包）
```

- 服务与窗口同进程；`server.listen({ port: 47821, host: '127.0.0.1' })`。
- 单实例：`app.requestSingleInstanceLock()`，第二个实例聚焦到已有窗口。
- 菜单：去掉默认菜单栏，保留刷新 / 开发者工具（开发模式）。
- 关闭窗口即退出进程，服务与数据库随之关闭（不常驻托盘）。

### 4.7 数据安全

- 每次启动、`app.db` 迁移成功并打开后，把数据库文件复制一份到 `backups/app-<YYYYMMDD-HHmm>.db`，保留最近 30 份。
- 「我的」页新增「导出备份」，打一个 zip（db + images）到用户选的目录。

### 4.8 测试怎么办

现有 `server/test` 与改造方向直接冲突，必须一并改（这是 §1.1 分叉决定的必然结果）：

| 现有测试 | 处理 |
|---|---|
| `helpers.ts` 连 Postgres、`truncate ... restart identity` | 改为每个用例一个内存 / 临时文件 SQLite 库；清理方式改为 `delete from` 或直接换新库 |
| `health.test.ts` 查 `pg_tables` | 改查 `sqlite_master` |
| `auth.test.ts` 的 plpgsql 触发器用例（测首登默认分类失败回滚） | 删除该机制本身，改成测 `ensureLocalUser()` 幂等 |
| 6 个文件里多次 `login(app)` 依赖 `/auth/wechat` | 换成测试辅助函数：直接插两个用户 + 各自签 token，**跨用户隔离的用例保留并继续断言** |
| `deployment-config.test.ts` 断言 Dockerfile/compose 里有微信配置 | 删除（本支不再维护部署） |
| `wechat-client.test.ts`、`checker.test.ts` | 删除 |

验收线：改造后的套件全绿，且**跨用户隔离用例一条不少**——单用户产品里这条看似无用，但它是 `RecordsTable.user_id` 过滤没写坏的唯一保险。

## 5. 分阶段

工作量大，按四步走，每步结束都能自己跑起来看：

1. **数据层换 SQLite**：spike 验证 `node:sqlite` → 新迁移 → 方言 → 查询改造 → 测试改造；`server test` 全绿，界面不碰。
2. **本机登录与审核移除**：`/auth/local`、`secret.key`、`ensureLocalUser()`、前端 auth store 改造、删 moderation；测试全绿。
3. **Electron 外壳跑通**：主进程起服务、窗口加载 H5 构建、固定端口、数据目录、OneDrive 回退、启动备份；手动验收九个页面。
4. **打包安装包**：electron-builder 出 NSIS 安装包，装到另一目录验证不覆盖数据。

## 6. 验收

- `pnpm --dir server test` 全绿（SQLite 环境，含跨用户隔离用例）。
- `pnpm --dir app test` 与 `typecheck` 全绿。
- 断网状态下：能新建记录、加摘抄卡片与 ★、上传图片、搜到刚写的内容、日历上出现绿点。
- **写一半草稿 → 关窗口 → 重开，草稿还在**；不再要求重新登录。
- 杀掉进程后重启，数据仍在。
- 卸载重装到同目录，数据仍在；装到新目录，数据目录不受影响。
- 数据文件夹能直接拷到另一台电脑并打开。

## 7. 留给实现者决定

- 自建 SQLite 方言 vs 社区包（按测试结果定）。
- H5 构建产物如何进入 Electron 资源目录（打包脚本还是 `extraResources`）。
- 图片上传时的 multipart 处理与磁盘写入是否保持现有 `@fastify/multipart` 写法（倾向保持）。
- 是否在 SQLite 上加 `updated_at` 之类的索引、以及备份时是否需要 `VACUUM INTO` 而非直接复制文件（倾向用 `VACUUM INTO`，避免复制到写了一半的库）。

## 8. 待发起人决定

- **历史数据一次性导入**：小程序里如果已经有内容，要不要在桌面版首启时导进来（§2.1）。
