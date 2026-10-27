# Data Flow

This page describes the complete request flow from MCP client to SiYuan, including tool discovery, tool calling, CLI direct invocation, resource requests, error handling, and all other pathways.

Use case: You are debugging why a tool call succeeded/failed/results were filtered, or need to understand which checkpoints a request passes through.

---

## 1. Tool Discovery Flow (`tools/list`)

```
MCP Client
    ↓ ListToolsRequest
server.ts: ListToolsRequestSchema handler
    ↓
getToolConfig()  [30s TTL cache / in-flight deduplication]
    ↓ Read from SiYuan storage /data/storage/petal/.../mcpToolsConfig
    ↓ normalizeToolConfig(raw)  [Three-format compatibility migration]
prepareAllTools(config, runtime)
    ↓ Static categories are no-ops; extension refreshes the official plugin/native tool cache
listAllTools(config, runtime)
    ↓ Iterate over 13 categories in TOOL_REGISTRY
    ↓ For each module: module.listTools(config[category], runtime)
        ↓ tools/internal/define-tool.ts: listTools()
            ↓ Filter enabled actions
            ↓ tools/internal/shared.ts: buildAggregatedTool(category, description, config, variants)
                ↓ Merge all enabled action schemas into single ToolDescriptor
                ↓ Inject common actions hint + dangerous warning into description
    ↓ Flatten and return ToolDescriptor[]
    ↓ Filter out tools where category enabled=false or all actions disabled
MCP Client ← ToolDescriptor[]
```

**Key checkpoints**:
- `config[category].enabled === false` → entire tool is invisible
- `config[category].actions[action] === false` → that action's schema is not merged into `inputSchema`
- `buildAggregatedTool` detects all actions disabled → returns empty array (tool filtered out)

---

## 2. Tool Call Flow (`tools/call`)

### 2.1 Complete Call Chain

```
MCP Client
    ↓ CallToolRequest { name: "notebook", arguments: { action: "list" } }
server.ts: CallToolRequestSchema handler
    ↓
Step 1: Parse tool name
    resolveCategory("notebook") → "notebook"
    getToolConfig() → config
    If config.notebook.enabled === false
        → Return { error: { type: "tool_disabled", tool: "notebook", ... } }

Step 2: Lifecycle wrapping
    runToolCall(ctx, handler)
        ctx = { client, category: "notebook", name: "notebook",
               action: "list", args: { action: "list" }, requestText: JSON.stringify(args) }
        ↓
    Step 2a: Puppy preparation
        earnPuppyBalance()  (+1)
        writePuppyEvent({ status: "running", tool: "notebook", action: "list" })
        ↓
    Step 2b: Business handler
        TOOL_REGISTRY["notebook"].callTool(client, args, config.notebook, permMgr)
            ↓
        defineTool factory:
            tryHandleHelpAction() → No (action is not "help")
            actionSchema.parse({ action: "list" }) → Passes Zod validation
            Check config.notebook.actions["list"] === true → Passes
            handler({ client, rawArgs: { action: "list" }, permMgr })
                ↓
            src/api/notebook.ts: listNotebooks(client)
                ↓
            SiYuanClient.request("/api/notebook/lsNotebooks")
                ↓
            SiYuan HTTP API → Returns notebook list
                ↓
            Build ToolResult { content: [...] }
                ↓
        Return ToolResult
        ↓
    Step 2c: Puppy cleanup
        writePuppyEvent({ status: "success", ... })
        ↓
    Step 2d: Analytics
        buildAnalyticsEvent()
            measureApproxText(requestText) → request tokens
            measureApproxContent(result.content) → response tokens
            estimateResultSizeHint() → '0' / '0-200' / '200-1K' / ...
        persistAnalyticsEvent()  [await in CLI, fire-and-forget otherwise]
        maybeSendTelemetry()  [fire-and-forget]
        ↓
    Return ToolResult
MCP Client ← ToolResult
```

### 2.2 Permission Checkpoint

For operations involving notebook-scoped data, permission checks happen **inside the business handler**:

```
Handler execution
    ↓
tools/internal/context.ts: ensurePermissionForDocumentId(client, permMgr, id, "write")
    ↓
resolveDocumentContextById(client, id) → Query SQL/API for notebookId
    ↓
checkPermissionForDocumentContext(permMgr, notebookId, "write")
    ↓
permMgr.canWrite(notebookId) → Check permission file
    ↓
If insufficient → return createPermissionDeniedResult()
    Otherwise → Continue business logic
```

**Note**: Permission checks are not unified in `server.ts` or `tool-lifecycle.ts`. Each tool handler **explicitly calls** them according to business needs (e.g. `list` only needs `r`, `remove` needs `rwd`).

### 2.3 Error Handling Chain

```
Business handler throws error
    ↓
defineTool factory catch
    ↓
createErrorResult(error, context)
    ├─ ZodError → { type: "validation_error", message: "Invalid parameters: ..." }
    ├─ SiYuanError → { type: "api_error", code: error.code, message: error.msg }
    └─ Other Error → { type: "internal_error", message: error.message }
    ↓
Return ToolResult containing error
    ↓
tool-lifecycle.ts: runToolCall catch
    buildAnalyticsEvent(status="error")
    persistAnalyticsEvent()
    maybeSendTelemetry()
    throw error (continue upward)
    ↓
server.ts: CallToolRequestSchema handler catch
    Return MCP Error response
```

**Error classification**:

| Type | Trigger condition | Client experience |
|------|-------------------|-------------------|
| `validation_error` | Zod schema validation fails | Parameter error hint |
| `api_error` | SiYuan HTTP API returns code ≠ 0 | API error (includes SiYuan error code) |
| `disabled_error` | Tool or action is disabled | "Tool/Action is disabled" |
| `permission_denied` | Insufficient notebook permission | "Permission denied for notebook ..." |
| `internal_error` | Unexpected exception | Internal error message |

---

## 3. CLI Direct Invocation Flow

CLI bypasses MCP protocol and directly reuses core logic:

```
Terminal: siyuan-sisyphus notebook list
    ↓
cli/index.ts: parseArgs(["notebook", "list"])
    ↓
cli/args.ts: minimist first pass
    → command = "dispatch", tool = "notebook", action = "list"
    → extractToolRest() → rest = []
    ↓
cli/dispatch.ts: runDispatch()
    ↓
Step 1: Validation
    resolveCategory("notebook") → Exists ✓
    "list".replace(/-/g, "_") → "list"
    ACTIONS_BY_CATEGORY["notebook"].includes("list") → Exists ✓

Step 2: Config resolution
    loadFileConfig() → Read ~/.siyuan-sisyphus/config.json
    resolveConfig({ cliUrl, cliToken, profile }) → Merge by priority
    applyConfigToEnv() → Set SIYUAN_API_URL / SIYUAN_TOKEN

Step 3: Client & permissions
    new SiYuanClient(baseUrl) + setToken(token)
    ensureRequiredPluginInstalled(client) → Read plugin.json to verify plugin exists
    new PermissionManager(client).load()

Step 4: Tool config
    read /data/storage/petal/.../mcpToolsConfig → normalizeToolConfig()

Step 5: Flag mapping
    TOOL_REGISTRY["notebook"].listTools(toolConfig.notebook) → Get inputSchema
    mapFlagsToArgs([], inputSchema) → {}  [No extra flags]
    Assemble payload: { action: "list" }

Step 6: Execute (reuses plugin core)
    runToolCall(ctx, () => TOOL_REGISTRY["notebook"].callTool(client, payload, config, permMgr))
        ↓ Identical lifecycle + handler path as plugin mode
    Return ToolResult

Step 7: Render
    renderToolResult(result, { json: false, debug: false })
        → Human-readable: green ✓ + notebook list
    If TTY and multi-page → runInteractivePaging()

Terminal output
```

**CLI vs Plugin Mode Differences**:

| Difference | Plugin Mode | CLI Mode |
|------------|-------------|----------|
| Outer protocol | MCP stdio/HTTP | Direct function calls |
| Config source | SiYuan storage (UI-controlled) | `~/.siyuan-sisyphus/config.json` |
| Tool toggles | User fine-controlled | Same UI-controlled config |
| Dangerous actions | Modern protocol gate; instruction fallback for legacy clients | User typing command is confirmation |
| Analytics | Fire-and-forget | Synchronously flushed |
| Permission default | Unconfigured notebook defaults to `r` (read-only) | Same `PermissionManager` behavior |
| Result rendering | MCP JSON | Human-readable / `--json` |

---

## 4. Resource Request Flow (`resources/read`)

MCP Resources provide static help docs and dynamic action help, **bypassing normal tool calls**.

### 4.1 Static Resources

```
MCP Client
    ↓ ListResourcesRequest
server.ts: ListResourcesRequestSchema handler
    ↓ resources.ts: listHelpResources()
Return static resource list:
    - siyuan://help/tool-overview
    - siyuan://help/path-semantics
    - siyuan://help/examples
    - siyuan://help/ai-layout-guide

MCP Client
    ↓ ReadResourceRequest { uri: "siyuan://help/tool-overview" }
server.ts: ReadResourceRequestSchema handler
    ↓ resources.ts: readHelpResource(uri)
        → Match URI prefix → Return predefined Markdown help text
```

### 4.2 Dynamic Resource Templates

```
MCP Client
    ↓ ListResourceTemplatesRequest
server.ts: ListResourceTemplatesRequestSchema handler
    ↓ resources.ts: listHelpResourceTemplates()
Return resource templates:
    - siyuan://help/action/{tool}/{action}

MCP Client
    ↓ ReadResourceRequest { uri: "siyuan://help/notebook/list" }
server.ts: ReadResourceRequestSchema handler
    ↓ resources.ts: readHelpResource(uri)
        → Parse tool="notebook", action="list"
        → Call corresponding tool's help generation logic
        → Return detailed help text for that action
```

**Dynamic help content sources**:
- Guidance and action hints from `help.ts`
- `VARIANTS` definitions in each tool module (accepted shapes, required fields, example)
- `presentation/invocation-format.ts` automatically translates to CLI equivalent (used in CLI `help` subcommand)

---

## 5. HTTP Transport Special Flows

### 5.1 Session Management

```
AI Client → POST /mcp (initialize request, no mcp-session-id)
http-transport.ts → Create new Session → Generate session-id
                  → Store in Map<string, SessionEntry>
                  → Response header Set-Cookie: mcp-session-id=xxx
                  → Return 200 + JSON-RPC response

Subsequent requests → POST /mcp (with mcp-session-id header)
         → Lookup SessionEntry from Map
         → Reuse same Server instance
         → Return response
```

### 5.2 Auth Flow

```
AI Client → POST /mcp
         → Authorization: Bearer <token>
http-transport.ts → Read SIYUAN_MCP_TOKEN env var
                  → Compare with Bearer token from request
                  → Mismatch → Return 401 Unauthorized
                  → Match → Continue processing
```

### 5.3 Parent Watchdog

```
On HTTP server startup, read SIYUAN_MCP_PARENT_PID
         → Set timer to check if that PID is still running
         → If parent exited → Call server.shutdown() → Process exits
```

**Purpose**: When the SiYuan main process crashes or closes, the embedded HTTP MCP server automatically cleans up to avoid zombie processes.

---

## 6. Config Loading & Migration Flow

### 6.1 Plugin Mode Config Loading

```
Plugin onload()
    ↓
loadPersistedToolConfig() [tool-config-storage.ts]
    ↓ loadData("mcpToolsConfig")
    If exists → normalizeToolConfig(raw) [Three-format compatibility]
           → Check: if category enabled=true but all actions=false → Auto set enabled=false
           → Return ToolConfig
    If not exists → buildDefaultToolConfig()
             → savePersistedToolConfig() [First-time write of defaults]
    ↓
Save to plugin instance variable
```

### 6.2 CLI Config Loading

```
CLI startup
    ↓
loadFileConfig() [cli/config.ts]
    ↓ Read ~/.siyuan-sisyphus/config.json (compatible with old path)
    If exists → Parse JSON → Return config object
    If not exists → Return null
    ↓
resolveConfig(options)
    apiUrl  = options.cliUrl || env.SIYUAN_API_URL || activeProfile.apiUrl || DEFAULT_API_URL
    token   = options.cliToken || env.SIYUAN_TOKEN || activeProfile.token || ''
```

---

## 7. Analytics & Telemetry Data Flow

### 7.1 Analytics Event Write

```
Tool call completes (success or failure)
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
    ├─ error_type (if any)
    └─ error_code (if any)
    ↓
analytics.ts: appendAnalyticsEvent()
    Read existing analytics JSONL file
    Append new event line
    If file > 2MB → Rotate (rename to .1, create new)
    Write to SiYuan storage
    ↓
If transport === "cli" → await write completion
Otherwise → fire-and-forget (errors swallowed by .catch)
```

### 7.2 Telemetry Report

```
tool-lifecycle.ts: maybeSendTelemetry()
    ↓
telemetry.ts: Check last report time
    If interval insufficient → Skip
    If interval sufficient → Read analytics events → Build aggregated payload
        ├─ total_calls
        ├─ success_rate
        ├─ avg_duration_ms
        ├─ top_actions[]
        ├─ transport_distribution
        └─ error_rate
    ↓
POST to telemetry endpoint (configured by telemetryConfig.endpoint)
    ↓
Fire-and-forget (.catch swallows errors, does not affect main flow)
```

---

## 8. Puppy Mascot State Flow

```
MCP Server (tool-lifecycle.ts)
    ↓ writePuppyEvent()
puppy-state.ts: Write puppyEvents.json
    ↓
ToolPuppy.svelte (via puppy-polling.ts)
    ↓ Poll every 500ms POST /api/file/getFile
Read puppyEvents.json
    ↓
Parse event array → Take latest event
    ↓
State machine transition:
    status="running" → Set corresponding tool icon + action marker + animation
    status="success" → Show ✓ green badge + heart burst (probabilistic)
    status="error"   → Show ✗ red badge + sad eyes
    status="dangerous" → Show ⚠ exclamation + dangerous eyes
    ↓
Idle 3 seconds → Return to idle state
    ↓
puppy-motion.ts: Random idle action scheduling (stand/sit/look/groom/lie/sleep)
```

**Decoupled design**: Puppy UI and MCP Server do **not directly share JS objects/memory**. They communicate through filesystem event files. This allows Puppy to run independently of the server (e.g. in test mode without a backend).

---

## 9. Complete Request Lifecycle Sequence

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
