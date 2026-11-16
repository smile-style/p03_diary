# Windows 桌面版使用与开发说明

## 开发运行

首次拉取代码后，先安装依赖：

```powershell
cd app
pnpm.cmd install

cd ..\desktop
pnpm.cmd install
```

开发时必须先构建 H5，再启动 Electron：

```powershell
cd app
pnpm.cmd run build:h5

cd ..\desktop
pnpm.cmd start
```

`desktop` 的 `start` 会先编译 Electron 主进程，再打开应用窗口。应用固定监听 `127.0.0.1:47821`，请不要同时启动两个桌面实例。

## 数据保存位置

默认数据目录为：

```text
C:\Users\<用户名>\Documents\wx-daily
```

如果 Windows 的“文档”目录位于 OneDrive 下，应用会改用：

```text
C:\Users\<用户名>\wx-daily
```

也可以在启动前通过 `WXDAILY_DATA_DIR` 指定其他目录。例如：

```powershell
$env:WXDAILY_DATA_DIR = 'D:\wx-daily'
pnpm.cmd start
```

数据目录包含：

- `app.db`：SQLite 数据库。
- `images\`：上传的图片。
- `backups\`：每次启动生成的数据库自动备份，默认保留最近 30 份。
- `secret.key`：本机登录和图片链接使用的密钥，请勿公开或随意删除。

应用“我的”页面可以直接打开当前数据文件夹。

## 应用更新

桌面版的更新入口在“我的”页面：

- 页面会显示当前桌面版本的版本号。
- 点击“检查更新”后，如果发现新版本，可以依次下载并在完成时点击“立即重启”安装。
- 应用启动时会静默检查一次；页面会先读取主进程缓存的状态，再接收后续变化。
- 开发模式（`app.isPackaged === false`）不会发起更新网络请求，点击检查时只显示开发模式提示。

自动更新依赖 GitHub Releases。Release 资产必须允许匿名读取，否则检查或下载更新会失败。当前发布仓库为 `smile-style/p03_diary`，发布前请按 `docs/release-guide.md` 完成构建、上传和匿名可读自检。

如果自动更新暂不可用，也可以手动下载新的 `wx-daily-setup-0.2.0.exe` 覆盖安装。数据目录不受影响：用户数据保存在文档目录下的 `wx-daily` 数据目录中；升级前仍建议按下面的步骤完整备份。
## 手动备份与恢复

最稳妥的手动备份方式是先完全关闭应用，再复制整个 `wx-daily` 文件夹到其他磁盘或备份介质。不要把 `app.db` 单独当作完整备份，因为图片仍在 `images\` 中。

恢复时，先关闭应用，用备份的整个 `wx-daily` 文件夹替换当前数据目录，再重新打开应用。

## 清空并重新开始

如需保留历史数据，先按上面的方法完整备份，然后：

1. 完全关闭应用。
2. 删除或改名整个 `wx-daily` 数据目录。
3. 重新打开应用。应用会自动创建新的数据库、密钥和备份目录。

“我的”页面的“清除本地缓存”只会清除草稿与登录信息，不会删除已有记录和图片。

## 已知限制

- 仅支持 Windows。
- 仅面向本机单用户使用，没有账号体系和多用户切换。
- 不与微信小程序或云端数据同步。
- “导出备份 zip”尚未实现，手动备份请复制整个 `wx-daily` 文件夹。