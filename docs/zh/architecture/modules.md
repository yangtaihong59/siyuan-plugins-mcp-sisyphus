# 模块划分

这个页面按职责划分核心模块，详细说明每个模块的职责边界、关键接口与依赖关系。

适用场景：你需要知道修改某块功能时该去哪个文件，或追踪一个 bug 的模块归属。

---

## 模块总览图

```
src/
├── index.ts                  # 插件生命周期入口
├── core/                     # MCP Server 核心
│   ├── server.ts             # MCP Server 创建与 Handler 注册
│   ├── http-transport.ts     # HTTP/S MCP 传输层
│   ├── tool-registry.ts      # 聚合工具注册表，包含动态 extension action
│   ├── tool-lifecycle.ts     # 工具调用 AOP 切面（analytics/telemetry/puppy）
│   ├── permissions.ts        # 笔记本级四级权限管理
│   ├── config.ts             # ToolConfig schema / 默认值 / 迁移
│   ├── types.ts              # Zod Schema 定义中心
│   ├── analytics.ts          # Analytics 事件读写
│   ├── telemetry.ts          # 遥测数据聚合与上报
│   ├── telemetry-config.ts   # 遥测配置 schema
│   ├── puppy-state.ts        # Mascot 状态管理
│   ├── token-usage.ts        # Token 近似计算
│   ├── runtime.ts            # 运行时环境检测
│   ├── process.ts            # 进程管理辅助
│   ├── resources.ts          # MCP 资源注册（帮助文档）
│   ├── server-instructions.ts# MCP Server instructions 构建
│   ├── help.ts               # 帮助文案中心
│   ├── normalize.ts          # 请求参数归一化
│   └── noops/                # SDK v2 显式 no-op schema validator
│       └── noop-schema-validator.ts
├── tools/                    # 聚合工具的实现
│   ├── index.ts              # Barrel export：统一导出所有工具
│   ├── internal/             # 工具层共享基础设施
│   │   ├── types.ts          # 工具层共享类型
│   │   ├── define-tool.ts    # 工具工厂
│   │   ├── shared.ts         # 共享基础设施
│   │   ├── schema-builder.ts # 聚合 ToolDescriptor schema 拼装
│   │   ├── schema-analyzer.ts# schema 分析与描述裁剪
│   │   ├── result-factory.ts # 标准结果工厂
│   │   ├── pagination.ts     # 分页工具
│   │   ├── context.ts        # 权限上下文解析
│   │   ├── errorTranslation.ts # 思源错误码 → 用户友好文案
│   │   ├── validation.ts     # 参数校验辅助
│   │   ├── ui-refresh.ts     # 触发思源 UI 刷新
│   │   ├── help-render.ts    # help action 输出渲染
│   │   ├── help-router.ts    # help 路由分发
│   │   └── helpers/          # 跨工具 helper，如 notebookName 补全
│   ├── notebook/             # notebook 工具
│   │   ├── index.ts          # variants + list/call 导出
│   │   └── handlers.ts       # 业务 handler
│   ├── document/             # document 工具
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── block/                # block 工具
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── av/                   # av（数据库）工具
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── search/               # search 工具
│   │   ├── index.ts
│   │   ├── handlers.ts
│   │   ├── sql-builder.ts    # SQL 查询构建辅助
│   │   └── permission-filter.ts # 搜索结果权限过滤
│   ├── file/                 # file 工具
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── system/               # system 工具
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── flashcard/            # flashcard 工具
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── tag/                  # tag 工具
│   ├── timeline/             # 时间线快照 diff 与回档工具
│   │   └── index.ts
│   └── mascot/               # mascot 工具
│       └── index.ts
├── cli/
│   ├── index.ts              # CLI 程序入口
│   ├── args.ts               # 命令行参数解析
│   ├── dispatch.ts           # CLI 核心执行引擎
│   ├── flag-mapper.ts        # Schema-aware flag → args 转换
│   ├── render.ts             # 结果渲染层
│   ├── config.ts             # 配置读写与解析
│   ├── init.ts               # 交互式初始化向导
│   ├── list-help.ts          # list / help 子命令
│   ├── config-command.ts     # config 子命令
│   └── plugin-check.ts       # 插件安装校验
├── api/
│   ├── client.ts             # SiYuanClient 统一 HTTP 封装
│   ├── notebook.ts           # 笔记本 API 封装
│   ├── document.ts           # 文档 API 封装
│   ├── block.ts              # 块 API 封装
│   ├── av.ts                 # 属性视图 API 封装
│   ├── search.ts             # 搜索 API 封装
│   ├── file.ts               # 文件 API 封装
│   ├── system.ts             # 系统 API 封装
│   ├── tag.ts                # 标签 API 封装
│   ├── flashcard.ts          # 闪卡 API 封装
│   ├── transaction.ts        # 事务 API 封装
│   ├── notification.ts       # 通知 API 封装
│   └── template.ts           # 模板 API 封装
├── ui/                       # UI 层
│   ├── components/           # Svelte UI 组件（Puppy 吉祥物系统）
│   │   ├── ToolPuppy.svelte
│   │   ├── Puppy*.svelte
│   │   └── puppy-*.ts
│   ├── setting/              # 插件设置面板
│   │   ├── mcp-config.svelte
│   │   ├── mcp-config/*.svelte
│   │   ├── tool-config-storage.ts
│   │   ├── tool-config.ts
│   │   └── telemetry-config.ts
│   └── shared/               # UI 共享组件
│       ├── setting-panel.svelte
│       └── Form/             # 表单原子组件
├── shared/                   # 通用工具库
│   ├── error.ts              # 错误类型与错误码映射
│   ├── promise-pool.ts       # 并发限制 Promise 池
│   ├── async.ts              # 异步工具
│   ├── constants.ts          # 共享常量
│   ├── help-payload.ts       # Help 负载构建
│   ├── invocation-format.ts  # MCP/CLI 双模式呈现统一
│   └── index.d.ts            # 共享类型声明
└── types/
    ├── api.d.ts              # SiYuan API 请求/响应类型
    ├── index.d.ts            # 核心类型别名与 Block 结构
    └── shared.ts             # 跨层共享类型
```

---

## 1. 插件入口：`src/index.ts`

**职责**：SiYuan 插件的生命周期管理、HTTP server 自动启动、设置面板挂载、吉祥物 UI 挂载。

**类**：`SiyuanMCP extends Plugin`

| 方法 | 职责 |
|------|------|
| `onload()` | 加载 `ToolConfig`、`PuppySettings`、`HttpServerSettings`；检查 `HttpServerLauncher` 支持性；若启用则自动 `startHttpServer()` |
| `onLayoutReady()` | 创建 `#sy-puppy-root` DOM 容器，挂载 `ToolPuppy` Svelte 组件 |
| `onunload()` | 销毁 Puppy 组件、停止 HTTP server |
| `uninstall()` | 清理插件数据 `removeData("mcpToolsConfig")` |
| `openSetting()` | 创建 SiYuan `Dialog`，挂载 `McpConfig` 设置面板 |
| `startHttpServer()` | 读取 `window.siyuan.config.api.token`，调用 `httpLauncher.start()` |
| `updateHttpServerSettings(next)` | 运行时热更新：先 stop → 持久化 → 按需 restart |

**依赖**：`ui/setting/tool-config-storage`、`ui/components/ToolPuppy`、`ui/setting/mcp-config.svelte`、`server-launcher`（HttpServerLauncher）

---

## 2. MCP Server：`src/core/server.ts`

**职责**：创建 MCP `Server` 实例，注册 7 个 handler，管理 transport 模式（stdio / HTTP），加载配置与权限。启用 Skills 扩展时，还会额外注册 2 个条件 handler。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `createSiYuanServer()` | 核心工厂。初始化 `SiYuanClient`、加载 `ToolConfig`（30s TTL）、创建 `Server` 实例 |
| `startMcpServer()` | 进程入口。解析 transport mode，启动 stdio 或 HTTP server |
| `getToolConfig()` | 带防抖的 ToolConfig 热加载，in-flight 去重 |

**始终注册的 7 个 Handler**：

| Handler | 协议 Schema | 行为 |
|---------|-------------|------|
| `ListToolsRequestSchema` | `server.setRequestHandler` | 调用 `getToolConfig()` → `listAllTools(config)`，只返回 enabled 且有 enabled action 的 tool |
| `ListResourcesRequestSchema` | 静态资源列表 | `listHelpResources()` |
| `ListResourceTemplatesRequestSchema` | 资源模板 | `listHelpResourceTemplates()`（`siyuan://help/action/{tool}/{action}`） |
| `ReadResourceRequestSchema` | 读资源 | `readHelpResource(uri)` → 静态内容或动态 action help |
| `PromptsListRequestSchema` | Prompt 列表 | `listMcpPrompts()` |
| `PromptsGetRequestSchema` | Prompt 查询 | `getMcpPrompt(name, task)` |
| `CallToolRequestSchema` | 调用工具 | 解析 name + action → `resolveCategory()` → 检查 enabled → `runToolCall()` → `TOOL_REGISTRY[category].callTool()` |

启用 `SIYUAN_MCP_SKILLS_EXTENSION`（默认启用）时，`skills/list` 和 `skills/get` 还会额外注册两个条件 Skills 扩展 handler。

**依赖**：`http-transport.ts`、`tool-registry.ts`、`tool-lifecycle.ts`、`permissions.ts`、`config.ts`、`resources.ts`、`server-instructions.ts`

---

## 3. 工具注册表：`src/core/tool-registry.ts`

**职责**：维护 `TOOL_REGISTRY` 映射表，将 `TOOL_CATEGORIES` 声明的 category 统一收敛为 `ToolModule` 接口。category 模块在编译期注册，`extension` 在可选的 prepare 阶段动态发现 action 集合。

**关键接口**：

```typescript
interface ToolModule {
    category: ToolCategory;
    prepare?(config: CategoryToolConfig<...>, runtime?: OfficialMcpRuntime): Promise<unknown>;
    listTools(config: CategoryToolConfig<...>, runtime?: OfficialMcpRuntime): ToolDescriptor[];
    callTool(client: SiYuanClient, args: unknown, config: CategoryToolConfig<...>, permMgr: PermissionManager, runtime?: OfficialMcpRuntime): Promise<ToolResult>;
}
```

**关键导出**：

| 导出 | 说明 |
|------|------|
| `TOOL_REGISTRY: Record<ToolCategory, ToolModule>` | `TOOL_CATEGORIES` 声明的聚合 category 编译期映射 |
| `prepareAllTools(config, runtime)` | 在动态校验或列举前执行可选的发现/准备钩子 |
| `listAllTools(config, runtime)` | 扁平化聚合所有启用状态下的 tool descriptor |
| `resolveCategory(name)` | 从 tool name（如 `"notebook"`）反查 category |
| `TOOL_CATEGORIES` | 常量数组，决定枚举顺序 |

**设计要点**：
- **无反射/无扫描**：category 注册不涉及文件系统扫描或动态 import；只有 `extension` 通过官方 MCP 协议发现下游 action。
- **类型擦除**：每个 tool 模块的精确类型签名在注册时通过 `as` 做受控加宽，使 registry 可统一迭代
- **工厂收敛**：每个 category 内部使用 `defineTool()` 工厂生成 `{ listTools, callTool }`

**依赖**：各 `tools/{category}/index.ts` + `tools/{category}/handlers.ts` 模块

---

## 4. 工具生命周期：`src/core/tool-lifecycle.ts`

**职责**：在工具调用外层注入 AOP 切面——puppy 事件、analytics 记录、telemetry 触发。

**核心函数**：`runToolCall(ctx, handler)`

**注入顺序**：

```
runToolCall(ctx, handler)
  ├─ 1. Puppy 准备阶段
  │     ├─ mascot 类 tool：readPuppyStats()（可能消费 balance）
  │     └─ 其他 tool：earnPuppyBalance()（+1 balance）
  │     └─ writePuppyEvent({ status: 'running' })
  │
  ├─ 2. 执行业务 handler
  │     └─ result = await handler()
  │
  ├─ 3. 异常捕获（若 throw）
  │     ├─ buildAnalyticsEvent(status='error')
  │     ├─ persistAnalyticsEvent()  ← CLI 模式 await，其他 fire-and-forget
  │     ├─ maybeSendTelemetry()     ← fire-and-forget
  │     └─ throw error（继续抛给上层）
  │
  ├─ 4. 成功/业务错误收尾
  │     ├─ readPuppyStats() / extractMascotEventMeta()
  │     └─ writePuppyEvent({ status: 'success'|'error' })
  │
  └─ 5. Analytics & Telemetry
        ├─ buildAnalyticsEvent()（含 token 用量估算 chars/4）
        ├─ persistAnalyticsEvent()
        └─ maybeSendTelemetry()
```

**关键设计**：
- analytics/telemetry 的写入/网络失败都被 `.catch(() => {})` 吞掉，**绝不阻塞**主流程
- CLI 模式下 `persistAnalyticsEvent` 会 `await`，保证进程退出前数据已落盘
- Token 估算：`requestApproxTokens + responseApproxTokens` 按 `chars/4` 近似

**依赖**：`puppy-state.ts`、`analytics.ts`、`telemetry.ts`、`token-usage.ts`、`runtime.ts`

---

## 5. 权限管理：`src/core/permissions.ts`

**职责**：笔记本级四级权限的读取、校验、持久化。

**类**：`PermissionManager`

| 方法 | 说明 |
|------|------|
| `load()` / `reload()` | 从 SiYuan API 读取权限文件 → JSON.parse → 在内存中归一化旧值，不自动写回 |
| `save()` | 通过 `SiYuanClient.writeFile` 写入权限文件 |
| `get(notebookId)` | 返回四级权限，默认 `r` 只读（未配置时兜底） |
| `canRead(notebookId)` | `get() !== 'none'` |
| `canWrite(notebookId)` | `['rw', 'rwd'].includes(get())` |
| `canDelete(notebookId)` | `get() === 'rwd'` |

**存储位置**：`/data/storage/petal/siyuan-plugins-mcp-sisyphus/notebookPermissions`

**CLI 兼容**：CLI 启动时也会创建 `PermissionManager` 并读取同一份权限文件；未配置的 notebook 兜底为 `r`（只读）。

**依赖**：`api/client.ts`

---

## 6. 工具配置：`src/core/config.ts`

**职责**：ToolConfig 的完整 schema 定义、默认值生成、多格式兼容迁移。

**配置结构（Canonical Format）**：

```typescript
type ToolConfig = {
    notebook:  { enabled: boolean, actions: { list: boolean, create: boolean, ... } };
    document:  { enabled: boolean, actions: { ... } };
    // ... 以 TOOL_CATEGORIES 声明的 category 为准
    file:      { enabled: boolean, actions: { ... }, uploadLargeFileThresholdMB: number };
    // ...
    userRulesText: string;  // 用户自定义规则文本
};
```

**历史兼容迁移**：`normalizeToolConfig(raw)` 支持三种格式：
1. **Nested config（canonical）**：`{ "notebook": { "enabled": true, "actions": { "list": true } } }`
2. **Legacy category config**：`{ "notebook": ["list", "create"] }`（字符串数组）
3. **Legacy flat keys**：`{ "list_notebooks": true }`（约 170 个旧 tool name 映射表 `LEGACY_TOOL_TO_ACTION`）

**其他关键导出**：

| 导出 | 说明 |
|------|------|
| `buildDefaultToolConfig()` | 生成出厂默认值（含 `userRulesText`） |
| `ACTIONS_BY_CATEGORY` | 每个 category 的 action 列表 |
| `ACTION_TIERS` | action 分级：`basic` / `advanced` |
| `DANGEROUS_ACTIONS` | 危险动作集合 |
| `isDangerousAction()` | 判断 action 是否需要确认警告 |
| `getActionTier()` | 返回 action 的分级 |

---

## 7. 工具工厂与共享层：`src/tools/internal/`

### `internal/define-tool.ts` — 工具工厂

**核心函数**：`defineTool<Action>(options): DefinedTool<Action>`

将 `variants + handlers + actionSchema` 收敛为标准的 `{ listTools, callTool }` 接口：
- `listTools(config)` → 调用 `buildAggregatedTool()` 生成 MCP `ToolDescriptor`
- `callTool(...)` → 处理 `action="help"` → `actionSchema.parse()` → 检查 action enabled → 派发 handler → catch 并 `createErrorResult`

### `internal/shared.ts` — 共享基础设施

| 导出 | 说明 |
|------|------|
| `buildAggregatedTool()` | 将多个 action variant 合并为单个 MCP Tool 的 `inputSchema` |
| `createErrorResult()` | 统一错误格式化（ZodError → `validation_error`；SiYuanError → `api_error`） |
| `tryHandleHelpAction()` | `action="help"` 的内置帮助路由 |

### `internal/context.ts` — 权限上下文解析

| 导出 | 说明 |
|------|------|
| `ensurePermissionForDocumentId()` | 通过 ID 查 SQL/API 得 notebook → 校验权限 |
| `ensurePermissionForNotebook()` | 直接校验 notebook 权限 |
| `createPermissionDeniedResult()` | 权限不足时的统一错误结果 |

---

## 8. HTTP 传输层：`src/core/http-transport.ts`

**职责**：基于 SDK v2 实现 HTTP MCP 传输，逐请求分类并路由到 MCP 2026-07-28 无状态 handler 或 legacy 有会话 handler。

**特性**：
- **双时代路由**：modern 请求无状态；legacy 会话通过 `Map<string, SessionEntry>` 和 `mcp-session-id` 分发
- **请求校验**：分发前校验配置的 `Origin` hostname 与 JSON content type
- **Bearer Token 认证**：通过 `SIYUAN_MCP_TOKEN` 环境变量验证
- **TLS**：`SIYUAN_MCP_TLS_CERT` + `SIYUAN_MCP_TLS_KEY` + optional CA
- **父进程看门狗**：监控 `SIYUAN_MCP_PARENT_PID`，父进程退出则 shutdown
- **MCP 2026-07-28 + legacy 兼容**：共享一套 runtime，同时保留旧客户端

---

## 9. CLI 层：`src/cli/`

### `index.ts` — 程序入口

调用 `parseArgs()` 解析 `process.argv`，根据 `command` 字段分发到 `runDispatch` / `runList` / `runHelp` / `runInit` / `runConfigCommand`。

### `args.ts` — 参数解析

使用 `minimist` 做**两轮解析**：
1. **第一轮**：解析全局 flags（`--help` / `--version` / `--config` / `--profile` / `--url` / `--token` / `--json` / `--debug`）
2. **识别子命令**：`init` / `list` / `help` / `config` / `<tool> <action>`
3. **第二轮**：对 `dispatch` 命令，通过 `extractToolRest()` 把全局 flags 剔除，剩余部分交给 `flag-mapper.ts`

### `dispatch.ts` — 核心执行引擎

完整执行链：

```
resolveCategory(tool) → action.replace(/-/g, '_') 标准化
→ loadFileConfig → resolveConfig → applyConfigToEnv
→ new SiYuanClient(baseUrl) + setToken
→ ensureRequiredPluginInstalled(client)  [插件安装校验]
→ new PermissionManager(client).load()
→ 从 SiYuan 存储读取 mcpToolsConfig  [遵守同一份 UI tool/action 开关]
→ TOOL_REGISTRY[category].listTools() → 取 inputSchema
→ mapFlagsToArgs(rest, inputSchema)  [flag-mapper.ts]
→ 组装 payload: { action: normalizedAction, ...mappedArgs }
→ runToolCall(ctx, () => module.callTool(...))  [复用生命周期]
→ renderToolResult(result, { json, debug })
→ 若 TTY 且多页 → runInteractivePaging()
```

### `flag-mapper.ts` — 基于 Schema 的 Flag 映射

对 `inputSchema.properties` 中的每个 property：
- 生成 **4 种别名**：原始名、kebab-case、snake_case、camelCase
- **大小写不敏感**：维护 `canonicalByLower` Map
- **类型强转**：boolean / number / array / object / JSON-sidecar（`--<key>-json`）

### `render.ts` — 结果渲染

| 模式 | 行为 |
|------|------|
| `--json` | `JSON.stringify(payload) + '\n'`，紧凑单行 |
| 默认人类可读 | 按 payload 类型自动选择渲染策略（字符串/数组/分页对象/Help Index/Action Help/普通对象） |
| 错误输出 | 统一走 `renderCliError()` 到 **stderr** |

**ANSI 颜色**：通过 `supportsColor(stream)` 检测 TTY，启用绿/青/黄/红/暗淡灰配色。

### `config.ts` — 配置管理

**配置优先级**（以代码实际为准）：

```
CLI flag (--url / --token)
  > 环境变量 (SIYUAN_API_URL / SIYUAN_TOKEN)
  > active profile (config.json 中的 currentProfile)
  > 默认值 (http://127.0.0.1:6806)
```

- 支持多 profile：`profiles: Record<string, { apiUrl, token }>` + `currentProfile`
- 默认路径：`~/.siyuan-sisyphus/config.json`（兼容旧路径 `~/.siyuan-mcp/config.json`）
- 文件权限：目录 `0o700`，文件 `0o600`

### `init.ts` — 交互初始化向导

通过 `readline` 询问 profile 名称、API URL、token、是否设为当前 profile，最后写入配置文件。

### `plugin-check.ts` — 插件安装校验

在 dispatch 前通过 SiYuan API 读取 `plugin.json` 与权限文件，确保 `siyuan-plugins-mcp-sisyphus` 插件已安装且就绪。

---

## 10. API 层：`src/api/`

**核心类**：`SiYuanClient`（`client.ts`）

| 特性 | 说明 |
|------|------|
| **实例化** | `new SiYuanClient(config)`，`baseUrl` 默认 `http://127.0.0.1:6806`，`timeout` 默认 5s |
| **Token 管理** | `setToken()` / `getAuthHeaders()` 注入 `Authorization: Token <token>` |
| **统一请求** | `request<T>(endpoint, data?)` 自动解析 `SiYuanResponse<T>`（`code === 0` 返回 `data`，否则抛 `SiYuanError`） |
| **文件操作** | `readFile()` / `readFileBinary()` / `writeFile()`（FormData + File 上传） |
| **超时控制** | `fetchWithTimeout()` 使用 `AbortController` |

**按领域拆分的函数式 API 模块**：

| 文件 | 领域 | 典型函数 |
|------|------|----------|
| `notebook.ts` | 笔记本 | `listNotebooks`, `createNotebook`, `openNotebook` |
| `document.ts` | 文档树 | `createDoc`, `renameDoc`, `removeDoc`, `moveDocs` |
| `block.ts` | 块操作 | `insertBlock`, `appendBlock`, `updateBlock`, `deleteBlock` |
| `av.ts` | 属性视图 | `getAttributeView`, `addAttributeViewBlocks`, `setAttributeViewBlockAttr` |
| `search.ts` | 搜索与引用 | `fullTextSearchBlock`, `querySQL`, `findReplace` |
| `file.ts` | 文件与资产 | `uploadAsset`, `exportMdContent`, `renderTemplate` |
| `system.ts` | 系统与 UI | `getVersion`, `reloadUI`, `reloadProtyle` |
| `tag.ts` | 标签 | `listTags`, `renameTag` |
| `flashcard.ts` | 闪卡 | `getRiffDueCards`, `reviewRiffCard` |
| `transaction.ts` | 事务 | `performTransactions` |
| `attribute.ts` | 块属性 | `setBlockAttrs`, `getBlockAttrs` |

所有业务模块均导出**纯函数**，接收 `client: SiYuanClient` 作为首个参数。无全局实例，便于 CLI 与 Plugin 两端复用。

---

## 11. 设置模块：`src/ui/setting/`

### `tool-config.ts` — Schema 定义

定义 `TOOL_CATEGORIES` 中的 `ToolCategory`，每个含 `enabled` + `actions` + 额外字段（如 `file` 的 `uploadLargeFileThresholdMB`、`extension` 的 `includeNativeTools` 与 `blockedTools`）。

### `tool-config-storage.ts` — 持久化层

使用 SiYuan 插件 `loadData` / `saveData` API 管理 4 组配置：
1. `mcpToolsConfig` → `ToolConfig`
2. `puppySettings` → `PuppySettings`
3. `mcpHttpSettings` → `HttpServerSettings`（首次加载自动生成随机 32-byte token）
4. `telemetryConfig` → `TelemetryConfig`

所有 `load*` 函数均做 `normalize*` 防御性转换。

### `mcp-config.svelte` — 设置面板主组件

- 左侧 `b3-tab-bar` 分组导航，右侧 `config__tab-wrap` 内容区
- 全局 `onChanged` 事件分发器：根据 key 前缀路由到不同持久化函数

### 子面板组件

| 组件 | 职责 |
|------|------|
| `HttpServerPanel` | HTTP/HTTPS 开关、host/port/token/TLS、客户端配置片段生成、实时状态与日志 |
| `ToolCategoriesPanel` | 工具分类的 checkbox + Notebook 权限矩阵（`none/r/rw/rwd`） |
| `PuppyPanel` | 吉祥物开关 + 可见性/气泡/点击提示/测试模式 |
| `TelemetryPanel` | 遥测开关/间隔/endpoint；本地分析看板（总调用数、token、错误率、Top Actions、Daily Trend） |
| `UserRulesPanel` | 用户自定义规则文本域 |

---

## 12. 吉祥物系统：`src/ui/components/`

**架构**：Puppy 不直接调用 JS API，而是通过**轮询 JSON 事件文件**（`puppyEvents.json`）与 MCP server 解耦通信。

| 组件/文件 | 职责 |
|-----------|------|
| `ToolPuppy.svelte` | **核心容器**。管理状态机（idle/reading/writing/deleting/moving/dangerous/success/error）、轮询事件文件、拖拽逻辑、空闲动画调度 |
| `PuppyAwakeSVG.svelte` | 清醒状态像素猫 SVG（52×52）。含猫身、尾巴、爪子、多组眼睛表情、8 种工具图标、工资卡余额显示 |
| `PuppySleepingSVG.svelte` | 睡眠状态叠加层：飘出的 "zZz" 动画 |
| `PuppyBubble.svelte` | 气泡与特效层：文字气泡、工资卡气泡、爱心爆发、喂食道具 |
| `PuppyResultOverlay.svelte` | 结果/危险状态 SVG 叠加：红叉、感叹号、错误角标 |
| `puppy-polling.ts` | `createJsonFilePoller`：定时 POST `/api/file/getFile` 读取 `puppyEvents.json` |
| `puppy-state.ts` | `src/core/` 中的状态管理：`totalCalls`、`balance`、`earn/spend/writeEvent` |
| `puppy-position.ts` | `localStorage` 读写 Puppy 屏幕坐标 |
| `puppy-drag.ts` | 拖拽会话状态机：区分 click 与 drag |
| `puppy-test-mode.ts` | `createTestModeRunner`：定时随机选取 action，模拟状态流转 |

---

## 13. 表示层：`src/shared/invocation-format.ts`

**职责**：将 MCP 风格的工具调用表示转换为 CLI 风格的命令行表示，实现**双模式呈现统一**。

**核心设计**：工具描述、示例、错误提示等内容只需编写一次（以 MCP 风格为主），通过 `translatePresentationText()` / `translatePresentationPayload()` 在 CLI 模式下自动适配为命令行语法。

| 函数 | 说明 |
|------|------|
| `formatFieldRef()` | `mcp` 下为原字段名，`cli` 下转为 `--kebab-case` flag |
| `formatActionRef()` | `mcp` 下为 `tool(action="...")`，`cli` 下为 `siyuan <tool> <kebab-action>` |
| `formatActionCall()` | 完整调用格式化：CLI 下展开为带 flag 的命令行 |

---

## 14. 工具库：`src/shared/`

| 文件 | 职责 |
|------|------|
| `error.ts` | `SiYuanResponse<T>` 统一响应结构、`SiYuanError` 异常类、`errorCodeMap`（-1~20 错误码映射） |
| `promise-pool.ts` | `PromiseLimitPool<T>`：限制并发数的 Promise 池，支持 `add(fn)` + `awaitAll()` |

---

## 15. 类型定义：`src/types/`

| 文件 | 内容 |
|------|------|
| `api.d.ts`（496 行） | SiYuan HTTP API 请求/响应类型：笔记本、文档、块、属性、查询、搜索、文件、代理、消息等 |
| `index.d.ts`（106 行） | 核心类型别名：`DocumentId`, `BlockId`, `NotebookId`；`Block` 完整结构；`BlockType` / `BlockSubType` 完整枚举；`Window` 接口扩展 |
