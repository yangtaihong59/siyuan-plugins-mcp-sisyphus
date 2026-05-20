# SiYuan Sisyphus MCP & CLI

<p align="left">
  <a href="https://www.npmjs.com/package/siyuan-sisyphus">
    <img src="https://img.shields.io/npm/v/siyuan-sisyphus?style=flat-square&color=%23cb3837" alt="npm version">
  </a>
  <a href="https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/yangtaihong59/siyuan-plugins-mcp-sisyphus?style=flat-square&color=%23007ec6" alt="license">
  </a>
  <a href="https://yangtaihong59.github.io/siyuan-plugins-mcp-sisyphus/">
    <img src="https://img.shields.io/badge/docs-VitePress-646cff?style=flat-square&logo=vitepress" alt="Documentation">
  </a>
  <a href="https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/releases">
    <img src="https://img.shields.io/github/v/release/yangtaihong59/siyuan-plugins-mcp-sisyphus?style=flat-square&color=%23007ec6" alt="GitHub release">
  </a>
</p>

<p align="left">
  <a href="https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README.md">English</a> |
  <a href="https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README_zh_CN.md">中文</a> |
  <a href="https://yangtaihong59.github.io/siyuan-plugins-mcp-sisyphus/">Documentation</a>
</p>

> **最新版本：**`v0.4.7` — 优化文档时间线滚动联动，提升启动后 dock 入口注册稳定性，并补充赞赏支持入口。

<p align="center">
  <img src="docs/archive/timeline.png" alt="文档时间线" width="720">
</p>
<p align="center"><em>文档时间线：给思源笔记提供命名快照、可视化 diff 和回退能力。</em></p>

## 这是什么

SiYuan Sisyphus 让 AI Agent 安全地阅读、搜索、编辑和整理你的思源工作空间。

它同时提供两种入口：

- **MCP 插件**：把思源连接到 Claude Desktop、Claude Code、Codex、Cursor、Cherry Studio、Cline 等支持 MCP 的客户端。
- **CLI `siyuan-sisyphus`**：让 Agent、终端和脚本用短命令直接操作思源。

两种入口共享同一套权限模型和同一套底层思源操作能力。

## 特有功能

- **类 Git 文档时间线**：为单篇文档创建命名时间线节点，对比历史快照与当前状态，并在需要时进行文档/块级回退。
- **AI 友好的笔记访问方式**：`fs` 工具支持 `/笔记本/项目/文档` 这类人类可读路径，让 AI 不必理解块 ID 和文档树细节。
- **MCP 与 CLI 双入口**：提供 MCP 和 CLI 两种连接方式，共享一套权限管理。
- **笔记本级安全边界**：每个笔记本可独立设置 `none`、`r`、`rw`、`rwd` 权限。
- **低上下文工具设计**：把 100+ 个思源能力收敛为 11 个按 action 路由的聚合工具，详细说明按需查看。
- **实用连接配置**：插件设置页提供常见 AI 客户端和部署方式的可复制连接配置。

## 类 Git 文档时间线

文档时间线给普通思源文档补上一层类似源码版本管理的安全网：

- 为当前文档创建命名时间线节点；
- 对比历史快照与当前文档；
- 在统一 diff 和并排 diff 之间切换；
- 使用变更缩略导航，并折叠未变化块；
- 回退整篇文档，或单独恢复部分已解析块。

这是基于思源快照构建的单文档时间线，不是完整 Git 替代品，也不是完整源码管理工作流。

## MCP 与 CLI 双入口

当你希望 AI 客户端自动发现工具、组合多步操作时，使用 **MCP**。它适合搜索、阅读、修改、检查数据库和验证结果等 Agent 工作流。

当一个终端命令就够时，使用 **CLI**。它不会把长工具 schema 塞进模型上下文，更适合脚本、自动化和小型单次任务。

```bash
npm i -g siyuan-sisyphus
siyuan-sisyphus init
siyuan notebook list
```

## 安全边界

SiYuan Sisyphus 的默认设计是让用户明确控制 AI 的操作范围：

- 每个笔记本都可以设为只读、可写、可删除，或完全隐藏；
- 删除、移动、替换、上传资源等危险动作会被单独处理；
- MCP 与 CLI 共用核心行为，切换入口不会产生第二套权限模型；
- 远程和 Docker 场景通过思源 HTTP API 操作，不假设可以直接读写本地工作空间文件。

## 快速开始

1. 从思源集市安装插件，或按源码安装文档构建。
2. 打开 `插件 -> SiYuan Sisyphus MCP & CLI -> 设置`。
3. 在连接配置页选择 MCP 或 CLI。
4. 复制自动生成的客户端配置，或用 `siyuan-sisyphus init` 初始化 CLI。
5. 先执行列出笔记本、读取思源版本等只读任务验证连接。

完整安装和连接步骤请看下面的文档入口。

## 继续阅读

- [快速开始](./docs/zh/getting-started/index.md)
- [常见任务](./docs/zh/reference/common-tasks.md)
- [工具参考](./docs/zh/reference/index.md)
- [权限模型](./docs/zh/reference/permissions.md)
- [开发文档](./docs/zh/development/index.md)
- [English README](./README.md)

## 赞赏支持

如果你觉得这个项目对你有帮助，欢迎赞赏支持！
给孩子买点 token 吧！
<p align="left">
  <img src="docs/archive/thank.jpeg" alt="赞赏码" width="200">
</p>

## 许可证

MIT
