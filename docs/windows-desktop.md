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