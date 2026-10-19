# 总览

这个页面描述系统最顶层的分层关系、运行形态与技术栈。

适用场景：你需要快速建立从 AI Agent 到 SiYuan 数据边界的完整认知。

---

## 四层架构

系统从外到内分为四个层次：

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: AI Agent / MCP Client                             │
│  - Claude Desktop / Kimi CLI / Cursor / 其他 MCP 客户端     │
│  - 通过 stdio 或 HTTP(S) 发起 MCP 协议请求                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: MCP Server / CLI                                  │
│  ┌──────────────┐  ┌─────────────────────────────────────┐  │
│  │ 插件 MCP Server│  │ 独立 CLI (siyuan-sisyphus)         │  │
│  │ - stdio 模式  │  │ - 直接调用 TOOL_REGISTRY           │  │
│  │ - HTTP 模式   │  │ - 不经过 MCP 协议                  │  │
│  └──────────────┘  └─────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 插件运行时 & 工具层                                │
│  - Tool Registry (14 个聚合工具)                            │
│  - Tool Lifecycle (analytics / telemetry / mascot)          │
│  - Permission Manager (笔记本级四级权限)                    │
│  - 设置面板 & 吉祥物 UI                                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: SiYuan HTTP API & 数据模型                        │
│  - SiYuanClient (统一 HTTP 封装)                            │
│  - 笔记本 / 文档 / 块 / 属性视图 / 文件 / 搜索 / 标签 等 API │
│  - SQLite 数据存储                                          │
└─────────────────────────────────────────────────────────────┘
```

**关键边界**：Layer 1 与 Layer 2 之间走 [Model Context Protocol](https://modelcontextprotocol.io/)（MCP）标准协议；Layer 2 与 Layer 3 之间在插件模式下也是 MCP 协议（`ListToolsRequestSchema` / `CallToolRequestSchema`），但在 CLI 模式下则是**直接函数调用**。Sisyphus 自带能力从 Layer 3 到 Layer 4 始终走 SiYuan `/api/*`，**绝不以官方 MCP 替代 API，也不直接访问本地文件系统**。唯一旁路是 `extension`：它按需访问官方 `/mcp`，只负责发现和转发其他插件 Tool 与用户主动开启的原生 Tool。

### 官方 MCP 隔离边界

- `fs`、文档时间线、权限管理、CLI、文档工具及其他 Sisyphus 自带能力只依赖 `/api/*`。
- `extension` 启用或用户打开扩展工具设置后，先用 `/api/system/version` 检查版本；低于 3.7.0 时不请求 `/mcp`。
- 首次发现异步执行，成功结果被缓存；普通 `tools/list` 不强制刷新。
- `/mcp` 失败只移除动态扩展 action，不阻塞外层 Server，也不影响其他聚合工具。
- 3.7.0 是 `extension` 的能力门槛，不是插件安装门槛；插件 `minAppVersion` 保持 2.9.0。

---

## 双产物架构

本仓库同时产出两种可独立使用的产品：

| 维度 | SiYuan 插件 | 独立 CLI (`siyuan-sisyphus`) |
|------|------------|------------------------------|
| **入口文件** | `src/index.ts` | `src/cli/index.ts` |
| **构建产物** | `dist/index.js` + `dist/mcp-server.cjs` | `cli/dist/cli.cjs` |
| **运行形态** | 长进程，随 SiYuan 启动 | 短进程，一次调用即退出 |
| **传输方式** | stdio（默认）/ HTTP（可选） | 直接函数调用，不走 MCP 传输 |
| **配置来源** | 插件设置面板 → SiYuan 存储 | CLI profile + SiYuan 存储中的插件 UI 配置 |
| **工具开关** | 用户通过 UI 精细控制每个 action | 同样遵守 UI 中的 tool/action 开关 |
| **权限管理** | 从 SiYuan 存储读取权限文件 | 同一套 `PermissionManager`；未配置 notebook 默认 `r`（只读） |
| **适用场景** | AI 客户端接入、日常持续使用 | 脚本化操作、CI/CD、快速查询 |

两种产物**共用同一套核心**：`TOOL_REGISTRY`、`SiYuanClient`、`PermissionManager`、`tool-lifecycle`、所有 `src/api/*` 封装。差异仅在于外层包装（MCP Server vs CLI 参数解析）和配置持久化方式。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **构建** | Vite | 多入口编译（renderer / server / cli），输出 CommonJS |
| **前端框架** | Svelte | 设置面板 `McpConfig`、吉祥物 `ToolPuppy` |
| **语言** | TypeScript | 源码 ESM（`"type": "module"`），产物 CJS |
| **MCP 协议** | 拆分后的 MCP TypeScript SDK v2 包 | 2026-07-28 + legacy 的 stdio/HTTP 双代服务 |
| **校验** | Zod ^4.3.6 | 所有 tool action 的输入参数校验（约 913 行 schema） |
| **测试** | Vitest | Unit + Integration + Smoke 三层测试 |
| **文档** | VitePress | 双语站点（英文默认 + 简体中文 `/zh/`） |
| **CLI 解析** | minimist | 两轮解析：全局 flags + schema-aware action flags |

---

## 运行形态对比

### 插件 stdio 模式（默认）

```
AI 客户端 (如 Claude Desktop)
    ↓ 启动子进程
SiYuan.app → 加载插件 → 启动 mcp-server.cjs (stdio)
    ↓ MCP stdio 协议
调用 TOOL_REGISTRY → SiYuanClient → SiYuan HTTP API
```

- 由 AI 客户端负责启动 `dist/mcp-server.cjs` 子进程
- 标准输入输出作为 MCP 传输通道
- 适合本地桌面端 AI 助手（Claude Desktop、Kimi CLI 等）

### 插件 HTTP 模式

```
AI 客户端 / 浏览器 / 第三方服务
    ↓ HTTP POST (Bearer Token)
SiYuan.app → 加载插件 → 启动内嵌 HTTP Server
    ↓ MCP 2026-07-28 无状态请求或 legacy StreamableHTTP 会话
调用 TOOL_REGISTRY → SiYuanClient → SiYuan HTTP API
```

- 插件 `onload()` 时自动启动 HTTP server（若用户开启）
- 使用 SDK 标准分类器服务两代协议：modern 请求无状态，旧客户端继续使用 `mcp-session-id` 会话
- 在分发前校验浏览器 Origin 主机名与 JSON POST Content-Type
- 支持 TLS（自定义证书）、Token 鉴权、父进程看门狗（父进程退出自毁）
- 适合远程访问、浏览器插件、多客户端共享

modern 工具描述包含标题、通用结构化输出契约和保守 annotations。支持表单 elicitation 的 modern 客户端会在高危调用进入工具生命周期前暂停并确认；不支持时跳过弹框，保留权限和严格预检。可选的草案 SEP-2640 扩展增加 `skills/list`、`skills/get` 和带摘要的 `skill://` 资源，但不替代稳定的帮助 Resource 与 Prompt。

### CLI 直接操作模式

```
终端用户
    ↓ shell 命令
siyuan-sisyphus notebook list
    ↓ 直接 import
src/cli/dispatch.ts → TOOL_REGISTRY[notebook].callTool()
    ↓ runToolCall (复用生命周期)
SiYuanClient → SiYuan HTTP API
    ↓ 渲染
终端输出 (人类可读 / --json)
```

- 不启动任何 MCP server 进程
- 直接 `import` 插件源码中的 `TOOL_REGISTRY` 和 `runToolCall`
- 一次调用、一次请求、立即退出
- 支持交互式分页（TTY 下按 Enter/n/p/q 翻页）

---

## 关键事实速查

1. **聚合工具表面**：13 个 MCP tool（fs / notebook / document / block / av / file / search / tag / system / flashcard / extension / mascot / feedback），而非 100+ 个单用途工具。
2. **配置热加载**：`server.ts` 中 `getToolConfig()` 带 30 秒 TTL 缓存 + in-flight 去重，设置面板改动后无需重启即可生效。
3. **危险动作门禁**：`DANGEROUS_ACTIONS` 集合标记了 15 个高危 action。支持表单 elicitation 的 MCP 2026-07-28 调用会在确认接受前被阻止；无表单能力及 legacy 客户端采用 description 与 instructions 中的用户授权约定，权限与严格预检不变。
4. **Analytics 与 Telemetry**：每次工具调用都会记录 analytics 事件（JSONL 格式，2MB 自动轮转），telemetry 按配置周期聚合上报；CLI 模式下 analytics 会同步等待落盘。
5. **Puppy 吉祥物**：通过轮询 `puppyEvents.json` 文件与 MCP server 解耦通信，支持空闲动画、拖拽、工资卡、测试模式等状态机。
