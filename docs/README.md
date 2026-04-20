# SiYuan MCP Sisyphus Documentation

> [中文](#中文文档) | [English](#english-docs)

---

## 中文文档

SiYuan MCP Sisyphus 是一个将思源笔记连接到 AI Agent 的 MCP 服务器插件。本文档提供完整的开发和使用指南。

### 文档导航

| 文档 | 说明 | 链接 |
|------|------|------|
| **架构文档** | 系统设计与模块架构详解 | [中文](./zh/architecture.md) · [English](./en/architecture.md) |
| **API 参考** | 完整的 MCP 工具和 Action 参考手册 | [中文](./zh/api-reference.md) · [English](./en/api-reference.md) |
| **开发指南** | 开发环境搭建、构建系统与贡献指南 | [中文](./zh/development-guide.md) · [English](./en/development-guide.md) |
| **部署指南** | 安装方式、连接配置与故障排查 | [中文](./zh/deployment.md) · [English](./en/deployment.md) |
| **经验洞察** | 架构设计经验与最佳实践总结 | [洞察](./insights.md) |

### 快速链接

- **项目主页**: [GitHub](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus)
- **主 README**: [README_zh_CN.md](../README_zh_CN.md)
- **更新日志**: [CHANGELOG.md](../CHANGELOG.md)
- **问题反馈**: [GitHub Issues](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/issues)

### 核心特性

- 10 个聚合工具，115+ 个 Action，覆盖思源笔记绝大部分功能
- 支持 HTTP 和 stdio 两种连接方式，同时提供 CLI (`siyuan-sisyphus`)
- 四态权限模型 (none/r/rw/rwd)，支持笔记本级权限控制
- 渐进式披露设计，减少 Token 占用

---

## English Docs

SiYuan MCP Sisyphus is an MCP server plugin that connects SiYuan Note to AI Agents. This documentation provides comprehensive development and usage guides.

### Documentation Navigation

| Document | Description | Link |
|----------|-------------|------|
| **Architecture** | System design and module architecture details | [English](./en/architecture.md) · [中文](./zh/architecture.md) |
| **API Reference** | Complete MCP tools and actions reference | [English](./en/api-reference.md) · [中文](./zh/api-reference.md) |
| **Development Guide** | Dev environment setup, build system, and contribution guide | [English](./en/development-guide.md) · [中文](./zh/development-guide.md) |
| **Deployment Guide** | Installation methods, connection config, and troubleshooting | [English](./en/deployment.md) · [中文](./zh/deployment.md) |
| **Insights** | Architecture design insights and best practices | [Insights](./insights.md) |

### Quick Links

- **Project Home**: [GitHub](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus)
- **Main README**: [README.md](../README.md)
- **Changelog**: [CHANGELOG.md](../CHANGELOG.md)
- **Issue Tracker**: [GitHub Issues](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/issues)

### Core Features

- 10 aggregated tools with 115+ actions covering most SiYuan Note features
- Support for HTTP and stdio connection modes, plus CLI (`siyuan-sisyphus`)
- Four-state permission model (none/r/rw/rwd) with notebook-level access control
- Progressive disclosure design to reduce token consumption

---

## 文档贡献 / Contributing to Docs

### 报告文档问题

如果您发现文档中的错误或不足之处，请通过以下方式反馈：

1. 提交 [GitHub Issue](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/issues)
2. 直接提交 Pull Request 修复

### 文档编写规范

- 中英文文档内容保持一致
- 使用清晰的标题层级结构
- 代码示例需要经过验证
- 链接使用相对路径

---

## 版本信息

当前文档版本: **v0.3.1**

最后更新: 2026-04-19
