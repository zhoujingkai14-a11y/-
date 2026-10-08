# 来源、依赖与素材说明

本发布版的应用模块和前端由明单项目制作，包含 AI 辅助编写与人工迭代。源码包没有第三方 npm 运行时依赖，也不包含 Next.js、shadcn、Sites 构建模板、react-bits、GSAP 或它们的构建产物。此前开发环境中的这些文件不进入本仓库。

- **Node.js 24**：使用标准库，包括 HTTP、Crypto、Fetch 和内置 SQLite。本源码包不重分发 Node 可执行文件。Node 的许可证与依赖声明由 Node 项目维护，见 <https://github.com/nodejs/node/blob/main/LICENSE>。
- **SQLite**：Node 的内置 SQLite 提供数据库能力。本包只含项目自身的 SQL 结构迁移，不含 SQLite 源码或任何已有数据库。见 <https://www.sqlite.org/copyright.html>。
- **DeepSeek API**：外部模型服务，本包只含调用代码，没有模型权重或服务密钥。使用者自行注册并遵守服务方条款，见 <https://api-docs.deepseek.com/>。
- **GitHub Actions**：仅在上传后用于验证，使用官方 checkout/setup-node，固定到审查时的提交哈希；没有复制其源码到应用。
- **glass-atrium.webp**：本项目按用户选定的折光玻璃方向生成的背景图。人工检查为抽象空间背景，没有客户截图、人物、商标或实拍订单资料；生成侧车文件和本机路径没有进入发布包。不宣称对 AI 生成素材拥有独占版权。
- **图标与字体**：当前页面使用内联 SVG 与系统字体，没有打包商业字体、外部图标字体或 CDN 脚本。

应用代码适用根目录 LICENSE。第三方平台和服务的商标及条款不因本项目开源而改变。
