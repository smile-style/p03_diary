# Windows 桌面版发布指南

## 发布前检查

一次发布需要同时修改三处版本号，三处必须完全一致：

- `desktop/package.json` 的 `version`
- `app/src/manifest.json` 的 `versionName`
- `app/package.json` 的 `version`

同时把 `app/src/manifest.json` 的 `versionCode` 递增。当前 `0.2.1` 对应 `201`。`desktop/test/electron-builder.test.ts` 会拦截版本不一致。

发布前先跑测试：

```powershell
cd app
pnpm test
pnpm run typecheck

cd ..\desktop
pnpm test
```

## 构建安装包

先构建 H5，再生成 Windows 安装包：

```powershell
cd app
pnpm run build:h5

cd ..\desktop
pnpm run dist
```

构建完成后检查以下文件都存在且非空：

```text
desktop\release\wx-daily-setup-0.2.1.exe
desktop\release\wx-daily-setup-0.2.1.exe.blockmap
desktop\release\latest.yml
desktop\release\win-unpacked\生活记录.exe
desktop\release\win-unpacked\resources\app.asar
desktop\release\win-unpacked\resources\web\index.html
```

`latest.yml` 必须包含正确的版本和文件名：

```yaml
version: 0.2.1
path: wx-daily-setup-0.2.1.exe
```

不要手工重命名 exe、blockmap 或 `latest.yml`，否则自动更新会找不到资产。

## 上传 GitHub Release

发布仓库配置在 `desktop/electron-builder.yml`：

```yaml
publish:
  provider: github
  owner: smile-style
  repo: p03_diary
```

登录 GitHub CLI 并创建 Release：

```powershell
gh auth status
gh release create v0.2.1 `
  release/wx-daily-setup-0.2.1.exe `
  release/wx-daily-setup-0.2.1.exe.blockmap `
  release/latest.yml `
  --title "v0.2.1" --notes "生活记录 v0.2.1"
```

## 仓库可见性要求

Release 资产必须允许匿名下载。仓库或 Release 资产不可匿名读取时，客户端检查更新或下载会失败，常见结果是 HTTP 404。

使用下面的命令做匿名可读自检：

```powershell
curl.exe -L -s -o NUL -w "%{http_code}`n" https://github.com/smile-style/p03_diary/releases/latest/download/latest.yml
```

只有返回 200 才算可用。若仓库仍是私有，需要改为可匿名读取，或另建可匿名访问的 Release 资产；不要擅自改掉 `provider: github` 配置。

## 从旧版验证真实更新

1. 安装仓库外保留的 `0.1.0` 基线安装包，不要先覆盖成 `0.2.0`。
2. 打开「我的」页面，确认显示旧版本号。
3. 点击「检查更新」，确认发现 `0.2.1`。
4. 点击「立即更新」，确认出现下载进度。
5. 下载完成后点击「立即重启」，确认应用退出、安装并重新启动。
6. 回到「我的」页面，确认版本号变为 `v0.2.1`，记录和图片仍然存在。

## 本次验收记录（2026-11-16）

当前 `smile-style/p03_diary` 的 Release 资产已知无法匿名访问，因此真实更新流程记录为“未验证”，不能记为通过。

| 手工验收项 | 状态 |
| --- | --- |
| 年份轴出现，年份切换与「全部」视图 | 待用户手工验证 |
| 月份标题条数与服务端聚合一致 | 待用户手工验证 |
| 年内超过 20 条时跨页选择某月仍能看到完整结果 | 待用户手工验证 |
| 月份筛选、取消筛选与分组标题正确 | 待用户手工验证 |
| 搜索在选中年份内生效，切到「全部」后可跨年搜索 | 待用户手工验证 |
| 滚动加载更多时月份分组不重复、不错乱 | 待用户手工验证 |
| 「我的」页显示 `v0.2.0`，浏览器无 bridge 时显示「桌面版可用」 | 待用户手工验证 |
| 冷启动后「我的」页通过 `get-state` 显示静默检查结果 | 待用户手工验证 |
| 打包版无网时显示可读错误且不持续转圈 | 待用户手工验证 |
| 从 `0.1.0` 真实更新到 `0.2.0` | 未验证（发布渠道尚未就绪） |

自动化验证会覆盖服务端筛选、分页、聚合、更新状态机和页面静态约束，但不能替代上述 GUI 与真实发布链路验收。