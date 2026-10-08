# 部署与运维

## 本机

首次运行 `npm run configure` 创建私密 `.env`。留空模型 Key 可以完整使用手动报价和客户确认。数据库默认在 `runtime/mingdan-public.sqlite`，目录由应用建立；`npm run backup` 将一致性快照写入同目录的 `backups/`。

已有配置不会被配置脚本覆盖。修改 `.env` 后重启本实例，让 Node 重新加载。不要把实际 Key 放在命令行参数、前端脚本、Issue 或截图里。

## 公网 HTTPS

在服务器项目根目录复制 `.env.example` 为 `.env`，设置真实模型 Key、随机的管理者密码和域名：

~~~dotenv
MINGDAN_DOMAIN=mingdan.example.com
MINGDAN_PUBLIC_URL=https://mingdan.example.com
MINGDAN_ADMIN_PASSWORD=replace-with-your-own-random-password
DEEPSEEK_API_KEY=replace-on-server-only
DEEPSEEK_MODEL=deepseek-flash
~~~

管理者密码必须至少 12 位，禁止采用测试里的固定密码。公网部署模板不会读取项目作者此前的配置。

~~~sh
docker compose --env-file .env -f deploy/public-compose.yaml up -d --build
~~~

只对外开放代理的 80/443 端口，应用 8765 端口不映射到公网。模板以非 root 用户运行 Node，并使用 Docker 持久卷保存 SQLite。Caddy 接收 HTTPS、覆盖真实客户端 IP 头；只有使用受控代理时才设置 `MINGDAN_TRUST_PROXY=1`。

模板默认开放注册，没有预算、日/月调用额度上限；保留个人每分钟 2 次、全站每小时 200 次和最多 2 个并发 AI 任务。需要费用限制时，通过 Compose 环境变量设置相应 `MINGDAN_AI_*` 选项，不要误把用量估算当余额。

本次准备环境没有 Docker，因此容器构建、Linux 持久卷权限、真实域名、证书签发及国内网络访问尚需在你的服务器上验收；Node 适配和 HTTP 流程在本机测试。

## 备份与恢复

~~~sh
docker compose --env-file .env -f deploy/public-compose.yaml exec app node deploy/public-backup.mjs
~~~

备份含私密账号和订单数据，下载后保管在非公开位置。恢复时停止应用，在磁盘或卷中保留当前数据库及可能存在的 WAL/SHM 文件副本，确认目标路径后，把选定备份复制为配置的数据库文件，再启动并验证账号、订单和客户状态。禁止在服务写入时替换数据库，也不要运行 `docker compose down -v` 删除持久卷。

## 独立模型联调

自动测试不会实际消费模型 Key。需要真实模型验收时，在私密配置中填入自己的 Key，注册测试账号，使用虚构消息完成一笔报价与客户确认；检查结果、漏项、用量和费用。切勿把真实回复日志或确认链接提交到公开仓库。
