# 数据流

这个页面描述请求从 MCP 客户端到 SiYuan 的完整流转路径，包括工具发现、工具调用、CLI 直接调用、资源请求、错误处理等全部链路。

适用场景：你在排查某个工具调用为什么成功/失败/结果被过滤，或需要理解请求经过哪些检查点。

---

## 1. 工具发现流程（`tools/list`）

```
MCP Client
    ↓ ListToolsRequest
server.ts: ListToolsRequestSchema handler
    ↓
getToolConfig()  [30s TTL 缓存 / in-flight 去重]
    ↓ 从 SiYuan 存储读取 /data/storage/petal/.../mcpToolsConfig
    ↓ normalizeToolConfig(raw)  [三种格式兼容迁移]
prepareAllTools(config, runtime)
    ↓ 静态 category 无操作；extension 刷新官方 plugin/native 工具缓存
listAllTools(config, runtime)
    ↓ 遍历 TOOL_REGISTRY 的 13 个 category
    ↓ 对每个 module: module.listTools(config[category], runtime)
        ↓ tools/internal/define-tool.ts: listTools()
            ↓ 过滤出 enabled 的 action
            ↓ tools/internal/shared.ts: buildAggregatedTool(category, description, config, variants)
                ↓ 合并所有 enabled action 的 schema 为单个 ToolDescriptor
                ↓ 在 description 中注入 common actions hint + dangerous warning
    ↓ 扁平化返回 ToolDescriptor[]
    ↓ 过滤掉 category enabled=false 或所有 action 都 disabled 的 tool
MCP Client ← ToolDescriptor[]
```

**关键检查点**：
- `config[category].enabled === false` → 整个 tool 不可见
- `config[category].actions[action] === false` → 该 action 的 schema 不被合并进 `inputSchema`
- `buildAggregatedTool` 最后若检测到所有 action 都 disabled → 返回空数组（该 tool 被过滤）

---

## 2. 工具调用流程（`tools/call`）

### 2.1 完整调用链

```
MCP Client
    ↓ CallToolRequest { name: "notebook", arguments: { action: "list" } }
server.ts: CallToolRequestSchema handler
    ↓
Step 1: 解析工具名
    resolveCategory("notebook") → "notebook"
    getToolConfig() → config
    若 config.notebook.enabled === false
        → 直接返回 { error: { type: "tool_disabled", tool: "notebook", ... } }

Step 2: 生命周期包装
    runToolCall(ctx, handler)
        ctx = { client, category: "notebook", name: "notebook",
               action: "list", args: { action: "list" }, requestText: JSON.stringify(args) }
        ↓
    Step 2a: Puppy 准备
        earnPuppyBalance()  (+1)
        writePuppyEvent({ status: "running", tool: "notebook", action: "list" })
        ↓
    Step 2b: 业务 handler
        TOOL_REGISTRY["notebook"].callTool(client, args, config.notebook, permMgr)
            ↓
        defineTool 工厂:
            tryHandleHelpAction() → 否（action 不是 "help"）
            actionSchema.parse({ action: "list" }) → 通过 Zod 校验
            检查 config.notebook.actions["list"] === true → 通过
            handler({ client, rawArgs: { action: "list" }, permMgr })
                ↓
            src/api/notebook.ts: listNotebooks(client)
                ↓
            SiYuanClient.request("/api/notebook/lsNotebooks")
                ↓
            SiYuan HTTP API → 返回笔记本列表
                ↓
            构建 ToolResult { content: [...] }
                ↓
        返回 ToolResult
        ↓
    Step 2c: Puppy 收尾
        writePuppyEvent({ status: "success", ... })
        ↓
    Step 2d: Analytics
        buildAnalyticsEvent()
            measureApproxText(requestText) → request tokens
            measureApproxContent(result.content) → response tokens
            estimateResultSizeHint() → '0' / '0-200' / '200-1K' / ...
        persistAnalyticsEvent()  [CLI 时 await，其他 fire-and-forget]
        maybeSendTelemetry()  [fire-and-forget]
        ↓
    返回 ToolResult
MCP Client ← ToolResult
```

### 2.2 权限检查点

在涉及 notebook-scoped 数据的操作中，权限检查发生在**业务 handler 内部**：

```
handler 执行
    ↓
tools/internal/context.ts: ensurePermissionForDocumentId(client, permMgr, id, "write")
    ↓
resolveDocumentContextById(client, id) → 查 SQL/API 得 notebookId
    ↓
checkPermissionForDocumentContext(permMgr, notebookId, "write")
    ↓
permMgr.canWrite(notebookId) → 检查权限文件
    ↓
若权限不足 → return createPermissionDeniedResult()
    否则 → 继续执行业务逻辑
```

**注意**：权限检查不是由 `server.ts` 或 `tool-lifecycle.ts` 统一完成，而是由每个 tool 的 handler 根据业务需求**显式调用**。这是为了支持不同 action 对权限的不同要求（如 `list` 只需要 `r`，`remove` 需要 `rwd`）。

### 2.3 错误处理链

```
业务 handler throw error
    ↓
defineTool 工厂 catch
    ↓
createErrorResult(error, context)
    ├─ ZodError → { type: "validation_error", message: "Invalid parameters: ..." }
    ├─ SiYuanError → { type: "api_error", code: error.code, message: error.msg }
    └─ 其他 Error → { type: "internal_error", message: error.message }
    ↓
返回包含 error 的 ToolResult
    ↓
tool-lifecycle.ts: runToolCall catch
    buildAnalyticsEvent(status="error")
    persistAnalyticsEvent()
    maybeSendTelemetry()
    throw error（继续向上抛）
    ↓
server.ts: CallToolRequestSchema handler catch
    返回 MCP Error 响应
```

**错误分类**：

| 类型 | 触发条件 | 客户端表现 |
|------|----------|-----------|
| `validation_error` | Zod schema 校验失败 | 参数错误提示 |
| `api_error` | SiYuan HTTP API 返回 code ≠ 0 | API 错误（含 SiYuan 错误码） |
| `disabled_error` | Tool 或 action 被禁用 | "Tool/Action is disabled" |
| `permission_denied` | 笔记本权限不足 | "Permission denied for notebook ..." |
| `internal_error` | 未预期的异常 | 内部错误信息 |

---

## 3. CLI 直接调用流程

CLI 不走 MCP 协议，直接复用核心逻辑：

```
终端: siyuan-sisyphus notebook list
    ↓
cli/index.ts: parseArgs(["notebook", "list"])
    ↓
cli/args.ts: minimist 第一轮
    → command = "dispatch", tool = "notebook", action = "list"
    → extractToolRest() → rest = []
    ↓
cli/dispatch.ts: runDispatch()
    ↓
Step 1: 合法性校验
    resolveCategory("notebook") → 存在 ✓
    "list".replace(/-/g, "_") → "list"
    ACTIONS_BY_CATEGORY["notebook"].includes("list") → 存在 ✓

Step 2: 配置解析
    loadFileConfig() → 读取 ~/.siyuan-sisyphus/config.json
    resolveConfig({ cliUrl, cliToken, profile }) → 按优先级合并
    applyConfigToEnv() → 设置 SIYUAN_API_URL / SIYUAN_TOKEN

Step 3: 客户端与权限
    new SiYuanClient(baseUrl) + setToken(token)
    ensureRequiredPluginInstalled(client) → 读取 plugin.json 确认插件存在
    new PermissionManager(client).load()

Step 4: 工具配置
    读取 /data/storage/petal/.../mcpToolsConfig → normalizeToolConfig()

Step 5: Flag 映射
    TOOL_REGISTRY["notebook"].listTools(toolConfig.notebook) → 取 inputSchema
    mapFlagsToArgs([], inputSchema) → {}  [无额外 flags]
    组装 payload: { action: "list" }

Step 6: 执行（复用插件核心）
    runToolCall(ctx, () => TOOL_REGISTRY["notebook"].callTool(client, payload, config, permMgr))
        ↓ 与插件模式完全相同的 lifecycle + handler 路径
    返回 ToolResult

Step 7: 渲染
    renderToolResult(result, { json: false, debug: false })
        → 人类可读格式：绿色 ✓ + 笔记本列表
    若 TTY 且多页 → runInteractivePaging()

终端输出结果
```

**CLI 与插件模式的差异总结**：

| 差异点 | 插件模式 | CLI 模式 |
|--------|----------|----------|
| 外层协议 | MCP stdio/HTTP | 直接函数调用 |
| 配置来源 | SiYuan 存储（UI 控制） | `~/.siyuan-sisyphus/config.json` |
| 工具开关 | 用户精细控制 | 同一份 UI 配置 |
| 危险动作 | modern 协议门禁；legacy 客户端回退到 instructions 警告 | 用户主动输入即视为确认 |
| analytics | fire-and-forget | 同步等待落盘 |
| 权限默认 | 未配置 notebook 默认 `r`（只读） | 同一套 `PermissionManager` 行为 |
| 结果渲染 | MCP JSON | 人类可读 / `--json` |

---

## 4. 资源请求流程（`resources/read`）

MCP 资源用于提供静态帮助文档和动态动作帮助，**不走普通工具调用**。

### 4.1 静态资源

```
MCP Client
    ↓ ListResourcesRequest
server.ts: ListResourcesRequestSchema handler
    ↓ resources.ts: listHelpResources()
返回静态资源列表:
    - siyuan://help/tool-overview
    - siyuan://help/path-semantics
    - siyuan://help/examples
    - siyuan://help/ai-layout-guide

MCP Client
    ↓ ReadResourceRequest { uri: "siyuan://help/tool-overview" }
server.ts: ReadResourceRequestSchema handler
    ↓ resources.ts: readHelpResource(uri)
        → 匹配 URI 前缀 → 返回预定义的 Markdown 帮助文本
```

### 4.2 动态资源模板

```
MCP Client
    ↓ ListResourceTemplatesRequest
server.ts: ListResourceTemplatesRequestSchema handler
    ↓ resources.ts: listHelpResourceTemplates()
返回资源模板:
    - siyuan://help/action/{tool}/{action}

MCP Client
    ↓ ReadResourceRequest { uri: "siyuan://help/notebook/list" }
server.ts: ReadResourceRequestSchema handler
    ↓ resources.ts: readHelpResource(uri)
        → 解析出 tool="notebook", action="list"
        → 调用对应 tool 的 help 生成逻辑
        → 返回该 action 的详细帮助文本
```

**动态 help 内容来源**：
- `help.ts` 中的 guidance、action hints
- 各 tool 模块中的 `VARIANTS` 定义（accepted shapes、required fields、example）
- `presentation/invocation-format.ts` 自动翻译为 CLI 等价表示（在 CLI `help` 子命令中使用）

---

## 5. HTTP 传输层特殊流程

### 5.1 会话管理

```
AI Client → POST /mcp (初始化请求，无 mcp-session-id)
http-transport.ts → 创建新 Session → 生成 session-id
                  → 存入 Map<string, SessionEntry>
                  → 响应头 Set-Cookie: mcp-session-id=xxx
                  → 返回 200 + JSON-RPC 响应

后续请求 → POST /mcp (带 mcp-session-id header)
         → 从 Map 查找 SessionEntry
         → 复用同一个 Server 实例
         → 返回响应
```

### 5.2 认证流程

```
AI Client → POST /mcp
         → Authorization: Bearer <token>
http-transport.ts → 读取 SIYUAN_MCP_TOKEN 环境变量
                  → 比对请求中的 Bearer token
                  → 不匹配 → 返回 401 Unauthorized
                  → 匹配 → 继续处理
```

### 5.3 父进程看门狗

```
启动 HTTP server 时读取 SIYUAN_MCP_PARENT_PID
         → 设置定时器检查该 PID 是否仍在运行
         → 若父进程已退出 → 调用 server.shutdown() → 进程退出
```

**用途**：当 SiYuan 主进程崩溃或关闭时，内嵌的 HTTP MCP server 能自动清理，避免僵尸进程。

---

## 6. 配置加载与迁移流程

### 6.1 插件模式配置加载

```
插件 onload()
    ↓
loadPersistedToolConfig() [tool-config-storage.ts]
    ↓ loadData("mcpToolsConfig")
    若存在 → normalizeToolConfig(raw) [三种格式兼容]
           → 检查：若 category enabled=true 但所有 action=false → 自动设 enabled=false
           → 返回 ToolConfig
    若不存在 → buildDefaultToolConfig()
             → savePersistedToolConfig() [首次写入默认值]
    ↓
保存到 plugin 实例变量
```

### 6.2 CLI 配置加载

```
CLI 启动
    ↓
loadFileConfig() [cli/config.ts]
    ↓ 读取 ~/.siyuan-sisyphus/config.json（兼容旧路径）
    若存在 → 解析 JSON → 返回配置对象
    若不存在 → 返回 null
    ↓
resolveConfig(options)
    apiUrl  = options.cliUrl || env.SIYUAN_API_URL || activeProfile.apiUrl || DEFAULT_API_URL
    token   = options.cliToken || env.SIYUAN_TOKEN || activeProfile.token || ''
```

---

## 7. Analytics & Telemetry 数据流

### 7.1 Analytics 事件写入

```
工具调用完成（成功或失败）
    ↓
tool-lifecycle.ts: buildAnalyticsEvent()
    ├─ timestamp
    ├─ transport: "stdio" | "http" | "cli"
    ├─ category, action
    ├─ duration_ms
    ├─ status: "success" | "error"
    ├─ request_approx_tokens (chars/4)
    ├─ response_approx_tokens (chars/4)
    ├─ result_size_hint: "0" | "0-200" | "200-1K" | "1K-10K" | ">10K"
    ├─ error_type (若有)
    └─ error_code (若有)
    ↓
analytics.ts: appendAnalyticsEvent()
    读取现有 analytics JSONL 文件
    追加新事件行
    若文件 > 2MB → 轮转（重命名为 .1，新建文件）
    写入 SiYuan 存储
    ↓
若 transport === "cli" → await 写入完成
否则 → fire-and-forget（.catch 吞掉错误）
```

### 7.2 Telemetry 上报

```
tool-lifecycle.ts: maybeSendTelemetry()
    ↓
telemetry.ts: 检查上次上报时间
    若间隔不足 → 跳过
    若间隔足够 → 读取 analytics 事件 → 构建聚合 payload
        ├─ total_calls
        ├─ success_rate
        ├─ avg_duration_ms
        ├─ top_actions[]
        ├─ transport_distribution
        └─ error_rate
    ↓
POST 到 telemetry endpoint（由 telemetryConfig.endpoint 配置）
    ↓
fire-and-forget（.catch 吞掉错误，不影响主流程）
```

---

## 8. Puppy 吉祥物状态流

```
MCP Server (tool-lifecycle.ts)
    ↓ writePuppyEvent()
puppy-state.ts: 写入 puppyEvents.json
    ↓
ToolPuppy.svelte (通过 puppy-polling.ts)
    ↓ 每 500ms POST /api/file/getFile 轮询
读取 puppyEvents.json
    ↓
解析事件数组 → 取最新事件
    ↓
状态机转换:
    status="running" → 设置对应工具图标 + action 标记 + 动画
    status="success" → 显示 ✓ 绿色角标 + 爱心爆发（概率）
    status="error"   → 显示 ✗ 红色角标 + sad 眼睛
    status="dangerous" → 显示 ⚠ 感叹号 + dangerous 眼睛
    ↓
空闲 3 秒后 → 恢复 idle 状态
    ↓
puppy-motion.ts: 随机调度空闲动作（stand/sit/look/groom/lie/sleep）
```

**解耦设计**：Puppy UI 与 MCP Server 之间**不直接共享内存/JS 对象**，而是通过文件系统事件文件通信。这使得 Puppy 可以独立于 server 运行（如测试模式下无后端也能动画）。

---

## 9. 完整请求生命周期时序图

```
AI Client          MCP Server          Tool Lifecycle      Tool Handler        SiYuan API
   |                    |                     |                   |                  |
   |──ListTools───────→|                     |                   |                  |
   |                    |──getToolConfig()───→|                   |                  |
   |                    |←─ToolConfig─────────|                   |                  |
   |                    |──listAllTools()────→|                   |                  |
   |                    |                    |──defineTool.listTools()            |
   |                    |                    |←─ToolDescriptor[]                  |
   |←─ToolDescriptor[]──|                    |                   |                  |
   |                    |                     |                   |                  |
   |──CallTool─────────→|                     |                   |                  |
   |                    |──resolveCategory()──→|                   |                  |
   |                    |←─category───────────|                   |                  |
   |                    |──runToolCall()──────→|                   |                  |
   |                    |                    |──earnPuppyBalance()                 |
   |                    |                    |──writePuppyEvent("running")         |
   |                    |                    |──handler()────────→|                  |
   |                    |                    |                   |──actionSchema.parse()           |
   |                    |                    |                   |──SiYuanClient.request()───────→|
   |                    |                    |                   |←─SiYuanResponse────────────────|
   |                    |                    |                   |──build ToolResult              |
   |                    |                    |←─ToolResult───────|                  |
   |                    |                    |──writePuppyEvent("success")         |
   |                    |                    |──appendAnalyticsEvent()            |
   |                    |                    |──maybeSendTelemetry()              |
   |                    |←─ToolResult────────|                   |                  |
   |←─ToolResult────────|                    |                   |                  |
```
