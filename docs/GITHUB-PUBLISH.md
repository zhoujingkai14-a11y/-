# 上传 GitHub 前后

## 发布范围

**只上传当前这份干净的 mingdan 发布目录。** 不要上传原开发工作区、runtime、outputs、local.settings.json、.dev.vars、.openai、已有订单/备份或此前的 Git 历史。

此目录的 LICENSE 按 AGPL-3.0-only 准备。首次公开前应确认你接受允许商用、同许可证及修改版网络服务源码公开条件；如果还希望保留独家卖断的可能，先维持私有仓库，再调整开源范围。

## 建立新仓库

在 GitHub 创建一个新仓库，初始不生成额外 README 或许可证。首次可设为 Private，完成远端检查后再决定公开。

~~~sh
git init -b codex/github-release
git add .
npm run check:git
npm test
git commit -m "Prepare Mingdan open source release"
git remote add origin https://github.com/YOUR_ACCOUNT/mingdan.git
git push -u origin HEAD:main
~~~

若本目录已初始化 Git，跳过 init；不要把原开发仓库的 origin、历史或对象复制过来。只使用你自己已登录的 GitHub 账号，令牌不写入 remote URL。以上是待执行说明，本次准备不自动上传。

## 公开前远端检查

1. 核对 LICENSE、README、THIRD_PARTY_NOTICES 与发布范围。
2. 确认 GitHub Actions 的 Linux/Windows 测试通过；本机测试通过不代表远端任务已运行。
3. 打开可用的 Secret scanning、Push protection、Private vulnerability reporting。
4. 检查仓库 Code / Commit history 没有密钥、数据、部署标识和私密文件。
5. 描述、Topics、截图与 Release 说明只使用虚构案例。试用链接在国内网络验证后再填写。

GitHub Issues 提供行为问题和需求建议模板；没有流量不能直接推断没有需求。优先收集完成真实报价、下一笔订单复用的脱敏反馈，不公开客户原文。
