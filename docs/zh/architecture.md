# SiYuan MCP Sisyphus 架构文档

本文档详细说明 SiYuan MCP Sisyphus 的系统架构、核心模块设计以及关键技术决策。

---

## 1. 系统架构概览

SiYuan MCP Sisyphus 采用三层架构设计：

```
┌─────────────────────────────────────────────────────────────────┐
│                      AI Agent / MCP Client                       │
│         (Claude Desktop, Cherry Studio, Cline, etc.)            │
└──────────────────────────────┬──────────────────────────────────┘
                               │ MCP Protocol
                               │ (stdio / HTTP)
┌──────────────────────────────▼──────────────────────────────────┐
│                     MCP Server Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Server    │  │   Config    │  │      Permissions        │  │
│  │  (server.ts)│  │  (config.ts)│  │    (permissions.ts)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                  10 Aggregated Tools                         ││
│  │  notebook │ document │ block │ av │ file │ search │ tag     ││
│  │  system   │ flashcard│ mascot│                            ││
│  └─────────────────────────────────────────────────────────────┘│
└──────────────────────────────┬──────────────────────────────────┘
                               │ SiYuan HTTP API
                               │ (Authorization: Token xxx)
┌──────────────────────────────▼──────────────────────────────────┐
│                     SiYuan Note Kernel                           │
│              (http://127.0.0.1:6806)                             │
└──────────────────────────────────────────────────────────────────┘
```

### 1.1 架构分层说明

| 层级 | 职责 | 关键技术 |
|------|------|----------|
| **AI Agent 层** | 发起工具调用请求 | MCP 客户端实现 |
| **MCP Server 层** | 协议解析、权限控制、请求分发 | @modelcontextprotocol/sdk |
| **API 适配层** | 思源 HTTP API 封装 | Fetch API |
| **数据层** | 笔记数据存储 | SiYuan Kernel |

---

## 2. 核心模块详解

### 2.1 Plugin 入口 (src/index.ts)

**职责：**
- 思源插件生命周期管理 (onload/onunload)
- HTTP 服务器启动/停止控制
- UI 组件管理 (ToolPuppy)
- 配置持久化

**关键方法：**
```typescript
// 插件入口类
export default class SiyuanMCP extends Plugin {
    async onload()          // 插件加载：初始化配置、启动HTTP服务
    onLayoutReady()         // 布局就绪：初始化UI组件
    async onunload()        // 插件卸载：清理资源
    openSetting()           // 打开设置面板
}
```

**代码位置：** `src/index.ts`

---

### 2.2 MCP Server (src/mcp/server.ts)

**职责：**
- MCP 协议实现
- Tool/Action 路由分发
- 服务端 Instructions 生成
- stdio/HTTP 双模式支持

**核心流程：**
```typescript
// 1. 创建 MCP Server 实例
const server = new Server(
    { name: 'siyuan-mcp', version: '2.0.0' },
    { capabilities: { tools: {}, resources: {} } }
);

// 2. 注册请求处理器
server.setRequestHandler(ListToolsRequestSchema, async () => {...});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // 3. 解析请求
    const { name, arguments: args } = request.params;
    const action = args.action;
    
    // 4. 权限检查
    // 5. 调用对应工具处理器
    // 6. 返回结果
});
```

**双模式启动：**
- **stdio 模式** (默认): 通过 StdioServerTransport 与父进程通信
- **HTTP 模式**: 通过 startHttpMcpServer() 启动 HTTP 服务

**代码位置：** `src/mcp/server.ts`

---

### 2.3 HTTP Transport (src/mcp/http-transport.ts)

**职责：**
- HTTP 流式传输实现
- Bearer Token 鉴权
- 多客户端会话管理

**设计特点：**
- 每个客户端连接创建独立 Server 实例
- 支持 Stateful 会话
- 解决 WSL/远程场景 stdio 不便问题

**代码位置：** `src/mcp/http-transport.ts`

---

### 2.4 聚合工具层 (src/mcp/tools/*.ts)

10 个聚合工具的设计是该项目的核心架构决策：

| 工具 | Actions | 说明 |
|------|---------|------|
| **notebook** | 11 | 笔记本管理、权限控制 |
| **document** | 20 | 文档 CRUD、树操作 |
| **block** | 24 | 块级操作、属性管理 |
| **av** | 13 | 属性视图/数据库操作 |
| **file** | 12 | 资源上传、导出、模板 |
| **search** | 11 | 全文搜索、SQL查询 |
| **tag** | 3 | 标签管理 |
| **system** | 10 | 系统信息、通知 |
| **flashcard** | 8 | 闪卡复习、卡组管理 |
| **mascot** | 3 | 交互反馈、商店 |

**工具实现模式：**
```typescript
// 1. 定义工具列表
export function listNotebookTools(config: ToolConfig[\'notebook\']) {
    return [{
        name: \'notebook\',
        description: \'Common actions: list, create...\',
        inputSchema: { ... }
    }];
}

// 2. 实现调用处理器
export async function callNotebookTool(client, args, config, permMgr) {
    switch (args.action) {
        case \'list\': return await handleList(client, permMgr);
        case \'create\': return await handleCreate(client, args, permMgr);
        // ...
    }
}
```

**代码位置：** `src/mcp/tools/*.ts`

---

### 2.5 工具注册表 (src/mcp/tool-registry.ts)

**职责：**
- 统一管理 10 个聚合工具的注册信息
- 提供 `listAllTools()` 和 `resolveCategory()` 等通用查询能力
- 解耦 `server.ts` 与具体工具实现，新增工具时无需修改 server 主逻辑

**核心设计：**
```typescript
export const TOOL_REGISTRY: Record<ToolCategory, ToolModule> = {
    notebook: { category: 'notebook', listTools: ..., callTool: ... },
    document: { category: 'document', listTools: ..., callTool: ... },
    // ...
};
```

**代码位置：** `src/mcp/tool-registry.ts`

---

### 2.6 工具调用生命周期 (src/mcp/tool-lifecycle.ts)

**职责：**
- 包装每一次工具调用，注入统一的副作用生命周期
- 吉祥物事件记录（puppy-state）：每次调用前写 `running`，成功后写 `success/error`
- 分析事件收集（analytics）：记录调用时长、参数、结果大小、错误码
- 遥测上报（telemetry）：按需发送匿名使用数据

**设计原则：**
- 所有副作用均为 fire-and-forget，失败从不阻塞工具调用
- 非 mascot 类工具每次成功调用自动赚取 1 枚硬币

**代码位置：** `src/mcp/tool-lifecycle.ts`

---

### 2.7 API 封装层 (src/api/*.ts)

**职责：**
- 思源 HTTP API 的 TypeScript 封装
- 统一错误处理
- 响应数据解析

**模块划分：**
| 模块 | 文件 | API 数量 |
|------|------|----------|
| Client | `client.ts` | 基础 HTTP 客户端 |
| Notebook | `notebook.ts` | 笔记本相关 API |
| Document | `document.ts` | 文档相关 API |
| Block | `block.ts` | 块操作 API |
| Attribute | `attribute.ts` | 属性操作 API |
| AV | `av.ts` | 属性视图 API |
| File | `file.ts` | 文件操作 API |
| Search | `search.ts` | 搜索相关 API |
| Tag | `tag.ts` | 标签 API |
| System | `system.ts` | 系统 API |
| Flashcard | `flashcard.ts` | 闪卡 API |

**代码位置：** `src/api/*.ts`

---

### 2.8 权限管理 (src/mcp/permissions.ts)

**职责：**
- 笔记本级权限控制
- 四态权限模型实现

**权限模型：**
```typescript
type PermissionLevel = \'none\' | \'r\' | \'rw\' | \'rwd\';

// none: 禁止所有操作
// r:    只允许读
// rw:   允许读写，禁止删除
// rwd:  允许读写删
```

**权限检查流程：**
1. 获取操作目标笔记本 ID
2. 查询该笔记本的权限设置
3. 校验操作类型与权限级别
4. 无权限时返回明确错误

**代码位置：** `src/mcp/permissions.ts`

---

### 2.9 配置管理 (src/mcp/config.ts)

**职责：**
- 工具配置结构定义
- 配置验证与迁移
- 默认配置生成

**配置结构：**
```typescript
interface ToolConfig {
    notebook: { enabled: boolean; actions: string[] };
    document: { enabled: boolean; actions: string[] };
    block: { enabled: boolean; actions: string[] };
    // ... 共10个工具
}
```

**代码位置：** `src/mcp/config.ts`

---

## 3. 数据流说明

### 3.1 典型工具调用流程

```
┌─────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Agent  │────▶│ MCP Server  │────▶│ Tool Handler │────▶│ SiYuan API  │
└─────────┘     └─────────────┘     └──────────────┘     └─────────────┘
     │                │                   │                   │
     │ 1. Call Tool   │                   │                   │
     │───────────────▶│                   │                   │
     │                │ 2. Parse Action   │                   │
     │                │ 3. Check Config   │                   │
     │                │ 4. Check Permission                   │
     │                │                   │ 5. Call SiYuan    │
     │                │                   │──────────────────▶│
     │                │                   │ 6. Return Data    │
     │                │                   │◀──────────────────│
     │                │ 7. Format Result  │                   │
     │ 8. Response    │◀─────────────────│                   │
     │◀───────────────│                   │                   │
```

### 3.2 配置读取流程

```
┌────────────────┐     ┌─────────────────────┐     ┌────────────────┐
│  MCP Server    │────▶│  SiYuan API         │────▶│  Config File   │
│  (listTools)   │     │  (/api/file/getFile)│     │  (mcpToolsConfig)
└────────────────┘     └─────────────────────┘     └────────────────┘
        │                       │                       │
        │ 1. Try API Read       │ 2. File Read          │ 3. Parse JSON
        │──────────────────────▶│──────────────────────▶│
        │                       │ 4. Return Content     │
        │ 5. Parse Config       │◀──────────────────────│
        │◀──────────────────────│                       │
        │ 6. Fallback to Default│ (if API unavailable)  │
```

---

## 4. 关键技术决策

### 4.1 聚合工具设计 (10 tools + actions)

**问题：**
- 思源有 50+ API 端点
- 分散的工具会导致 Agent 选择困难
- 工具列表过长增加 Token 消耗

**决策：**
将相关 API 聚合为 10 个工具，通过 `action` 参数分发：
```typescript
// 聚合前 (分散设计)
tools: [createNotebook, renameNotebook, deleteNotebook, ...] // 50+ tools

// 聚合后 (当前设计)  
tools: [notebook, document, block, ...] // 10 tools
// 通过 action 参数: notebook(action="create")
```

**收益：**
- Agent 工具选择准确率提升
- Token 消耗减少
- API 扩展更方便

---

### 4.2 渐进式披露设计

**问题：**
- 115 个 actions 全部暴露在 Tool Description 中过于冗长
- Agent 初次调用认知负荷大

**决策：**
三层信息架构：
1. **Tool Description**: 仅展示高频 Common Actions
2. **Help Resources**: 按需读取详细文档 (`siyuan://help/...`)
3. **Response Truncation**: 大数据集自动截断并提示分页

**收益：**
- 首次调用简洁高效
- 完整能力保留
- 向后兼容

---

### 4.3 四态权限模型

**问题：**
- 需要细粒度的笔记本级访问控制
- 不同 Agent 应有不同权限

**决策：**
```
none ──▶ r ──▶ rw ──▶ rwd
禁止    只读   读写    完全
```

- `none`: 完全禁止
- `r`: 只读，写操作被拒绝
- `rw`: 读写，删除被拒绝
- `rwd`: 完全访问

**收益：**
- 简单清晰
- 覆盖主要场景
- 易于理解和配置

---

### 4.4 HTTP + stdio 双模式

**问题：**
- 不同部署场景需要不同传输方式
- Docker 无法使用 stdio
- WSL 场景 HTTP 更方便

**决策：**
- 默认 stdio 模式（简单、安全）
- 可选 HTTP 模式（远程、WSL）
- 通过环境变量 `SIYUAN_MCP_TRANSPORT` 切换

**收益：**
- 覆盖所有部署场景
- 用户可按需选择
- 平滑迁移路径

---

## 5. 目录结构

```
src/
├── index.ts                    # 插件入口
├── server-launcher.ts          # HTTP 服务器启动器
├── index.scss                  # 样式文件
├── api/                        # 思源 API 封装
│   ├── client.ts              # HTTP 客户端
│   ├── notebook.ts            # 笔记本 API
│   ├── document.ts            # 文档 API
│   ├── block.ts               # 块 API
│   ├── attribute.ts           # 属性 API
│   ├── av.ts                  # 属性视图 API
│   ├── file.ts                # 文件 API
│   ├── search.ts              # 搜索 API
│   ├── tag.ts                 # 标签 API
│   ├── system.ts              # 系统 API
│   ├── flashcard.ts           # 闪卡 API
│   └── transaction.ts         # 事务 API
├── mcp/                        # MCP 服务器实现
│   ├── server.ts              # 主服务器
│   ├── http-transport.ts      # HTTP 传输
│   ├── tool-registry.ts       # 工具注册表
│   ├── tool-lifecycle.ts      # 工具调用生命周期
│   ├── config.ts              # 工具配置
│   ├── permissions.ts         # 权限管理
│   ├── types.ts               # 类型定义
│   ├── help.ts                # 帮助系统
│   ├── resources.ts           # MCP 资源
│   ├── analytics.ts           # 分析事件
│   ├── telemetry.ts           # 遥测上报
│   ├── telemetry-config.ts    # 遥测配置
│   ├── runtime.ts             # 运行时检测
│   ├── normalize.ts           # 数据规范化
│   ├── process.ts             # 进程管理
│   └── puppy-state.ts         # 吉祥物状态
│   └── tools/                 # 工具实现
│       ├── notebook.ts
│       ├── document.ts
│       ├── block.ts
│       ├── av.ts
│       ├── file.ts
│       ├── search.ts
│       ├── tag.ts
│       ├── system.ts
│       ├── flashcard.ts
│       ├── mascot.ts
│       ├── ui-refresh.ts
│       ├── shared.ts
│       └── context.ts
├── components/                 # Svelte 组件
│   ├── ToolPuppy.svelte       # 吉祥物组件
│   ├── puppy-interactions.ts  # 交互逻辑
│   ├── puppy-motion.ts        # 动画逻辑
│   └── puppy-tool-visuals.ts  # 视觉反馈
├── setting/                    # 设置面板
│   ├── mcp-config.svelte      # MCP 配置 UI
│   ├── tool-config.ts         # 工具配置逻辑
│   └── tool-config-storage.ts # 配置存储
├── types/                      # 类型定义
│   ├── index.d.ts
│   └── api.d.ts
└── libs/                       # 工具库
    ├── components/            # 组件库
    ├── error.ts               # 错误处理
    └── promise-pool.ts        # 并发控制
```

---

## 6. 扩展指南

### 6.1 添加新工具

1. **创建工具文件**: `src/mcp/tools/newtool.ts`
2. **定义 list 函数**: 返回工具描述和 schema
3. **实现 call 函数**: 处理各 action
4. **注册到 config**: `src/mcp/config.ts`
5. **注册到 tool-registry**: `src/mcp/tool-registry.ts`
6. **添加 API 封装** (如需要): `src/api/newtool.ts`

### 6.2 添加新 Action

1. **定义参数类型**: `src/mcp/types.ts`
2. **实现 handler**: 在对应工具文件中添加 case
3. **更新 config**: 添加 action 到允许列表
4. **更新文档**: 添加帮助信息

---

## 7. 相关文档

- [API 参考](./api-reference.md) - 完整的 Action 文档
- [开发指南](./development-guide.md) - 开发环境搭建
- [部署指南](./deployment.md) - 安装与配置
