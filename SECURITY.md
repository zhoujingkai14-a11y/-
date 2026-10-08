# 安全问题报告

请勿在公开 Issue 中粘贴 API Key、密码、恢复密钥、客户确认码、真实消息或数据库。

上传 GitHub 后，维护者应在 Security 设置启用 Private vulnerability reporting 与可用的 Secret scanning / Push protection。发现权限隔离、链接泄漏或可利用漏洞时，请优先使用仓库 Security 页的私密报告入口。该入口尚未启用时，只提交不含利用细节和隐私的联系请求，等待私密渠道。

配置只放在服务端环境变量或本机 `.env`；Git 忽略不是加密。泄露的真实 Key 应先在供应商处撤销/轮换，之后处理 Git 历史；只删除当前文件不能撤销已公开的密钥。

本项目提供本地发布检查与 CI，不构成完整渗透测试。没有承诺安全报告响应时间或长期安全维护期限。
