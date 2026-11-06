# wx_daily 服务端部署与备份

本文档适用于在云服务器上通过 Docker Compose 部署 API、PostgreSQL 和每日备份。以下命令默认在仓库根目录执行。

## 前置条件

- 一台可运行 Docker Engine 与 Docker Compose v2 的服务器。
- 服务器已安装 `curl`。
- 不需要在宿主机安装 Node.js 或 PostgreSQL。

## 首次部署

1. 复制环境变量模板并填写所有占位符：

   ```sh
   cp server/.env.example server/.env
   ```

   必须替换 `JWT_SECRET`、`FILE_URL_SECRET`、`WECHAT_APP_ID`、`WECHAT_SECRET`、`WECHAT_PUSH_TOKEN`、`POSTGRES_PASSWORD` 和 `PUBLIC_BASE_URL`。`DATABASE_URL` 中的数据库用户名、密码和库名必须与 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 一致。`server/.env` 包含密钥，不得提交到 Git。

2. 构建并启动服务：

   ```sh
   docker compose up -d --build
   ```

3. 查看容器状态并检查 API 健康状态：

   ```sh
   docker compose ps
   curl -fsS http://<服务器IP>:3000/health
   ```

   正常响应为 `{"ok":true}`。如果未就绪，使用 `docker compose logs -f api` 排查；API 启动时会先执行数据库迁移。

## 微信开发者工具联调

开发阶段在微信开发者工具中进入“详情 -> 本地设置”，勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”，即关闭“校验合法域名”限制。小程序请求地址可直接使用 `http://<服务器IP>:3000`，也可以在本机 `hosts` 文件中把一个测试域名绑定到服务器 IP。

正式上线不能依赖上述开发设置：必须使用已通过 ICP 备案的正式域名，并配置 HTTPS。

## 自动备份

`backup` 服务启动后立即执行一次备份，之后每 24 小时执行一次。宿主机备份目录是 `./backups`；每次会生成：

- `wxdaily-YYYYmmdd-HHMM.dump`：PostgreSQL 自定义格式备份。
- `wxdaily-YYYYmmdd-HHMM-uploads.tar.gz`：图片上传目录压缩包。

备份时间使用 UTC，保留最近 14 天，超期的 `wxdaily-*` 文件会自动删除。需要手动触发一次时运行：

```sh
docker compose exec backup sh /deploy/backup.sh
```

## 数据库与 uploads 恢复

恢复前先停止 API，避免恢复期间继续写入。下面的命令在服务器 Bash 中执行，并把示例文件名替换为实际备份文件：

```sh
docker compose stop api

docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < ./backups/wxdaily-YYYYmmdd-HHMM.dump

docker compose run --rm --no-deps --entrypoint sh backup -c \
  'rm -rf /data/uploads/* && tar -xzf /backups/wxdaily-YYYYmmdd-HHMM-uploads.tar.gz -C /data/uploads --strip-components=1'

docker compose start api
```

恢复完成后再次请求 `/health`。数据库与 uploads 必须来自同一时间点；uploads 压缩包内含顶层 `uploads/` 目录，因此使用 `--strip-components=1` 恢复到挂载卷的根目录。

## 当前验证限制

当前开发环境没有 Docker CLI；因此本机未执行 `docker compose config -q`、`docker compose up -d --build`、自动备份或恢复冒烟测试，不能把它们视为已通过。部署前必须在具备 Docker 的服务器上完成这些验证。
