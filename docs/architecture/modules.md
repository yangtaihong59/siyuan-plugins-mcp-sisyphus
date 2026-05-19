# Modules

This page divides core modules by responsibility, detailing each module's boundaries, key interfaces, and dependencies.

Use case: You need to know which file to modify for a specific feature, or trace the module归属 of a bug.

---

## Module Overview

```
src/
├── index.ts                  # Plugin lifecycle entry
├── core/                     # MCP Server core
│   ├── server.ts             # MCP Server creation & handler registration
│   ├── http-transport.ts     # HTTP/S MCP transport layer
│   ├── tool-registry.ts      # Static registry of 11 aggregated tools
│   ├── tool-lifecycle.ts     # Tool call AOP wrapper (analytics/telemetry/puppy)
│   ├── permissions.ts        # Notebook-level 4-tier permission management
│   ├── config.ts             # ToolConfig schema / defaults / migration
│   ├── types.ts              # Zod Schema definitions center
│   ├── analytics.ts          # Analytics event read/write
│   ├── telemetry.ts          # Telemetry aggregation & reporting
│   ├── telemetry-config.ts   # Telemetry config schema
│   ├── puppy-state.ts        # Mascot state management
│   ├── token-usage.ts        # Token approximation
│   ├── runtime.ts            # Runtime environment detection
│   ├── process.ts            # Process management helpers
│   ├── resources.ts          # MCP Resource registration (help docs)
│   ├── server-instructions.ts# MCP Server instructions builder
│   ├── help.ts               # Help text center
│   ├── normalize.ts          # Request parameter normalization
│   └── noops/                # No-op shims for heavy MCP SDK modules
│       ├── noop-schema-validator.ts
│       └── noop-experimental-tasks.ts
├── tools/                    # 11 aggregated tool implementations
│   ├── index.ts              # Barrel export: re-exports all tool modules
│   ├── internal/             # Shared infrastructure for the tool layer
│   │   ├── types.ts          # Shared types for the tool layer
│   │   ├── define-tool.ts    # Tool factory
│   │   ├── shared.ts         # Shared infrastructure
│   │   ├── schema-builder.ts # Aggregated ToolDescriptor schema assembly
│   │   ├── schema-analyzer.ts# Schema analysis & description trimming
│   │   ├── result-factory.ts # Standard result factory (JSON / paginated / error)
│   │   ├── pagination.ts     # Pagination utilities
│   │   ├── context.ts        # Permission context resolution
│   │   ├── errorTranslation.ts # SiYuan error code → user-friendly text
│   │   ├── validation.ts     # Parameter validation helpers
│   │   ├── ui-refresh.ts     # Trigger SiYuan UI refresh
│   │   ├── help-render.ts    # Help action output rendering
│   │   ├── help-router.ts    # Help routing dispatcher
│   │   └── helpers/          # Cross-tool helpers such as notebookName enrichment
│   ├── notebook/             # notebook tool
│   │   ├── index.ts          # variants + list/call exports
│   │   └── handlers.ts       # business handlers
│   ├── document/             # document tool
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── block/                # block tool
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── av/                   # av (database) tool
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── search/               # search tool
│   │   ├── index.ts
│   │   ├── handlers.ts
│   │   ├── sql-builder.ts    # SQL query builder helper
│   │   └── permission-filter.ts # Search result permission filtering
│   ├── file/                 # file tool
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── system/               # system tool
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── flashcard/            # flashcard tool
│   │   ├── index.ts
│   │   └── handlers.ts
│   ├── tag/                  # tag tool
│   │   └── index.ts
│   └── mascot/               # mascot tool
│       └── index.ts
├── cli/
│   ├── index.ts              # CLI program entry
│   ├── args.ts               # Command-line argument parsing
│   ├── dispatch.ts           # CLI core execution engine
│   ├── flag-mapper.ts        # Schema-aware flag → args conversion
│   ├── render.ts             # Result rendering layer
│   ├── config.ts             # Config read/write & resolution
│   ├── init.ts               # Interactive initialization wizard
│   ├── list-help.ts          # list / help subcommands
│   ├── config-command.ts     # config subcommand
│   └── plugin-check.ts       # Plugin installation verification
├── api/
│   ├── client.ts             # SiYuanClient unified HTTP wrapper
│   ├── notebook.ts           # Notebook API wrapper
│   ├── document.ts           # Document API wrapper
│   ├── block.ts              # Block API wrapper
│   ├── av.ts                 # Attribute View API wrapper
│   ├── search.ts             # Search API wrapper
│   ├── file.ts               # File API wrapper
│   ├── system.ts             # System API wrapper
│   ├── tag.ts                # Tag API wrapper
│   ├── flashcard.ts          # Flashcard API wrapper
│   ├── transaction.ts        # Transaction API wrapper
│   ├── notification.ts       # Notification API wrapper
│   └── template.ts           # Template API wrapper
├── ui/                       # UI layer
│   ├── components/           # Svelte UI components (Puppy mascot system)
│   │   ├── ToolPuppy.svelte
│   │   ├── Puppy*.svelte
│   │   └── puppy-*.ts
│   ├── setting/              # Plugin settings panel
│   │   ├── mcp-config.svelte
│   │   ├── mcp-config/*.svelte
│   │   ├── tool-config-storage.ts
│   │   ├── tool-config.ts
│   │   └── telemetry-config.ts
│   └── shared/               # Shared UI components
│       ├── setting-panel.svelte
│       └── Form/             # Form atoms (form-input, form-wrap, index)
├── shared/                   # Shared utilities
│   ├── error.ts              # Error types & error code mapping
│   ├── promise-pool.ts       # Concurrency-limited Promise pool
│   ├── async.ts              # Async utilities
│   ├── constants.ts          # Shared constants
│   ├── help-payload.ts       # Help payload builder
│   ├── invocation-format.ts  # Dual-mode presentation unification (MCP/CLI)
│   └── index.d.ts            # Shared type declarations
└── types/
    ├── api.d.ts              # SiYuan API request/response types
    ├── index.d.ts            # Core type aliases & Block structure
    └── shared.ts             # Cross-layer shared types
```

---

## 1. Plugin Entry: `src/index.ts`

**Responsibility**: SiYuan plugin lifecycle management, auto HTTP server startup, settings panel mounting, mascot UI mounting.

**Class**: `SiyuanMCP extends Plugin`

| Method | Responsibility |
|--------|---------------|
| `onload()` | Load `ToolConfig`, `PuppySettings`, `HttpServerSettings`; check `HttpServerLauncher` support; auto `startHttpServer()` if enabled |
| `onLayoutReady()` | Create `#sy-puppy-root` DOM container, mount `ToolPuppy` Svelte component |
| `onunload()` | Destroy Puppy component, stop HTTP server |
| `uninstall()` | Clean up plugin data `removeData("mcpToolsConfig")` |
| `openSetting()` | Create SiYuan `Dialog`, mount `McpConfig` settings panel |
| `startHttpServer()` | Read `window.siyuan.config.api.token`, call `httpLauncher.start()` |
| `updateHttpServerSettings(next)` | Runtime hot-update: stop → persist → restart as needed |

**Dependencies**: `ui/setting/tool-config-storage`, `ui/components/ToolPuppy`, `ui/setting/mcp-config.svelte`, `server-launcher`

---

## 2. MCP Server: `src/core/server.ts`

**Responsibility**: Create MCP `Server` instance, register 5 handlers, manage transport modes (stdio / HTTP), load config & permissions.

**Key functions**:

| Function | Description |
|----------|-------------|
| `createSiYuanServer()` | Core factory. Initialize `SiYuanClient`, load `ToolConfig` (30s TTL), create `Server` instance |
| `startMcpServer()` | Process entry. Parse transport mode, start stdio or HTTP server |
| `getToolConfig()` | Debounced ToolConfig hot-loading, in-flight deduplication |

**5 registered handlers**:

| Handler | Protocol Schema | Behavior |
|---------|-----------------|----------|
| `ListToolsRequestSchema` | `server.setRequestHandler` | Call `getToolConfig()` → `listAllTools(config)`, return only enabled tools with enabled actions |
| `ListResourcesRequestSchema` | Static resource list | `listHelpResources()` |
| `ListResourceTemplatesRequestSchema` | Resource templates | `listHelpResourceTemplates()` (`siyuan://help/action/{tool}/{action}`) |
| `ReadResourceRequestSchema` | Read resource | `readHelpResource(uri)` → static content or dynamic action help |
| `CallToolRequestSchema` | Call tool | Parse name + action → `resolveCategory()` → check enabled → `runToolCall()` → `TOOL_REGISTRY[category].callTool()` |

**Dependencies**: `http-transport.ts`, `tool-registry.ts`, `tool-lifecycle.ts`, `permissions.ts`, `config.ts`, `resources.ts`, `server-instructions.ts`

---

## 3. Tool Registry: `src/core/tool-registry.ts`

**Responsibility**: Maintain static `TOOL_REGISTRY` mapping table, converging 11 categories into the `ToolModule` interface.

**Key interface**:

```typescript
interface ToolModule {
    category: ToolCategory;
    listTools(config: CategoryToolConfig<...>): ToolDescriptor[];
    callTool(client: SiYuanClient, args: unknown, config: CategoryToolConfig<...>, permMgr: PermissionManager): Promise<ToolResult>;
}
```

**Key exports**:

| Export | Description |
|--------|-------------|
| `TOOL_REGISTRY: Record<ToolCategory, ToolModule>` | Static mapping of 11 categories, determined at compile time |
| `listAllTools(config)` | Flatten and aggregate all enabled tool descriptors |
| `resolveCategory(name)` | Reverse lookup category from tool name (e.g. `"notebook"`) |
| `TOOL_CATEGORIES` | Constant array determining enumeration order |

**Design points**:
- **No reflection / no scanning**: No filesystem scanning or dynamic imports; all registrations are compile-time determined
- **Type erasure**: Each tool module's precise type signature is widened via `as` at registration time, allowing uniform registry iteration
- **Factory convergence**: Each category internally uses `defineTool()` factory to generate `{ listTools, callTool }`

**Dependencies**: Individual `tools/{category}/index.ts` + `tools/{category}/handlers.ts` modules

---

## 4. Tool Lifecycle: `src/core/tool-lifecycle.ts`

**Responsibility**: Inject AOP aspects around tool calls — puppy events, analytics recording, telemetry triggering.

**Core function**: `runToolCall(ctx, handler)`

**Injection order**:

```
runToolCall(ctx, handler)
  ├─ 1. Puppy preparation
  │     ├─ mascot tool: readPuppyStats() (may spend balance)
  │     └─ other tools: earnPuppyBalance() (+1)
  │     └─ writePuppyEvent({ status: "running" })
  │
  ├─ 2. Execute business handler
  │     └─ result = await handler()
  │
  ├─ 3. Exception catch (if thrown)
  │     ├─ buildAnalyticsEvent(status="error")
  │     ├─ persistAnalyticsEvent()  ← await in CLI mode, fire-and-forget otherwise
  │     ├─ maybeSendTelemetry()     ← fire-and-forget
  │     └─ throw error (continue upward)
  │
  ├─ 4. Success / business error cleanup
  │     ├─ readPuppyStats() / extractMascotEventMeta()
  │     └─ writePuppyEvent({ status: "success"|"error" })
  │
  └─ 5. Analytics & Telemetry
        ├─ buildAnalyticsEvent() (includes token estimation chars/4)
        ├─ persistAnalyticsEvent()
        └─ maybeSendTelemetry()
```

**Key design**:
- Analytics/telemetry write/network failures are swallowed by `.catch(() => {})`, **never blocking** main flow
- In CLI mode, `persistAnalyticsEvent` is `await`ed to ensure data is flushed before process exit
- Token estimation: `requestApproxTokens + responseApproxTokens` approximated by `chars/4`

**Dependencies**: `puppy-state.ts`, `analytics.ts`, `telemetry.ts`, `token-usage.ts`, `runtime.ts`

---

## 5. Permission Management: `src/core/permissions.ts`

**Responsibility**: Notebook-level 4-tier permission reading, validation, and persistence.

**Class**: `PermissionManager`

| Method | Description |
|--------|-------------|
| `load()` / `reload()` | Read permission file from SiYuan API → JSON.parse → normalize old values in memory without writing |
| `save()` | Write permission file via `SiYuanClient.writeFile` |
| `get(notebookId)` | Return 4-tier permission, default `r` read-only (fallback when not configured) |
| `canRead(notebookId)` | `get() !== 'none'` |
| `canWrite(notebookId)` | `['rw', 'rwd'].includes(get())` |
| `canDelete(notebookId)` | `get() === 'rwd'` |

**Storage location**: `/data/storage/petal/siyuan-plugins-mcp-sisyphus/notebookPermissions`

**CLI compatibility**: CLI also creates a `PermissionManager` on startup and reads the same permission file; unconfigured notebooks fall back to `r` (read-only).

**Dependencies**: `api/client.ts`

---

## 6. Tool Config: `src/core/config.ts`

**Responsibility**: Complete ToolConfig schema definition, default generation, multi-format compatibility migration.

**Config structure (Canonical Format)**:

```typescript
type ToolConfig = {
    notebook:  { enabled: boolean, actions: { list: boolean, create: boolean, ... } };
    document:  { enabled: boolean, actions: { ... } };
    // ... 11 categories total
    file:      { enabled: boolean, actions: { ... }, uploadLargeFileThresholdMB: number };
    // ...
    userRulesText: string;  // User custom rules text
};
```

**Historical compatibility migration**: `normalizeToolConfig(raw)` supports three formats:
1. **Nested config (canonical)**: `{ "notebook": { "enabled": true, "actions": { "list": true } } }`
2. **Legacy category config**: `{ "notebook": ["list", "create"] }` (string array)
3. **Legacy flat keys**: `{ "list_notebooks": true }` (~170 old tool names mapped via `LEGACY_TOOL_TO_ACTION`)

**Other key exports**:

| Export | Description |
|--------|-------------|
| `buildDefaultToolConfig()` | Generate factory defaults (including `userRulesText`) |
| `ACTIONS_BY_CATEGORY` | Action list per category |
| `ACTION_TIERS` | Action tier: `basic` / `advanced` |
| `DANGEROUS_ACTIONS` | Dangerous action set |
| `isDangerousAction()` | Check if action needs confirmation warning |
| `getActionTier()` | Return action tier |

---

## 7. Tool Factory & Shared Layer: `src/tools/internal/`

### `internal/define-tool.ts` — Tool Factory

**Core function**: `defineTool<Action>(options): DefinedTool<Action>`

Converges `variants + handlers + actionSchema` into standard `{ listTools, callTool }` interface:
- `listTools(config)` → calls `buildAggregatedTool()` to generate MCP `ToolDescriptor`
- `callTool(...)` → handles `action="help"` → `actionSchema.parse()` → checks action enabled → dispatches handler → catches and `createErrorResult`

### `internal/shared.ts` — Shared Infrastructure

| Export | Description |
|--------|-------------|
| `buildAggregatedTool()` | Merge multiple action variants into a single MCP Tool `inputSchema` |
| `createErrorResult()` | Uniform error formatting (ZodError → `validation_error`; SiYuanError → `api_error`) |
| `tryHandleHelpAction()` | Built-in help routing for `action="help"` |

### `internal/context.ts` — Permission Context Resolution

| Export | Description |
|--------|-------------|
| `ensurePermissionForDocumentId()` | Resolve notebook via SQL/API by ID → validate permission |
| `ensurePermissionForNotebook()` | Directly validate notebook permission |
| `createPermissionDeniedResult()` | Unified error result for insufficient permissions |

---

## 8. HTTP Transport: `src/core/http-transport.ts`

**Responsibility**: Streamable HTTP MCP Server implementation based on `@modelcontextprotocol/sdk/server/streamableHttp.js`.

**Features**:
- **Session management**: `Map<string, SessionEntry>`, dispatched by `mcp-session-id` header
- **Bearer Token auth**: Validated via `SIYUAN_MCP_TOKEN` environment variable
- **TLS**: `SIYUAN_MCP_TLS_CERT` + `SIYUAN_MCP_TLS_KEY` + optional CA
- **Parent Watchdog**: Monitors `SIYUAN_MCP_PARENT_PID`, self-destructs when parent exits
- **MCP 2025-03-26 spec**: Supports latest Streamable HTTP specification

---

## 9. CLI Layer: `src/cli/`

### `index.ts` — Program Entry

Calls `parseArgs()` to parse `process.argv`, dispatches to `runDispatch` / `runList` / `runHelp` / `runInit` / `runConfigCommand` based on `command` field.

### `args.ts` — Argument Parsing

Uses `minimist` for **two-pass parsing**:
1. **First pass**: Parse global flags (`--help` / `--version` / `--config` / `--profile` / `--url` / `--token` / `--json` / `--debug`)
2. **Identify subcommand**: `init` / `list` / `help` / `config` / `<tool> <action>`
3. **Second pass**: For `dispatch` command, strip global flags via `extractToolRest()`, pass remainder to `flag-mapper.ts`

### `dispatch.ts` — Core Execution Engine

Full execution chain:

```
resolveCategory(tool) → action.replace(/-/g, "_") normalization
→ loadFileConfig → resolveConfig → applyConfigToEnv
→ new SiYuanClient(baseUrl) + setToken
→ ensureRequiredPluginInstalled(client)  [Plugin installation check]
→ new PermissionManager(client).load()
→ read mcpToolsConfig from SiYuan storage  [same UI-controlled tool/action toggles]
→ TOOL_REGISTRY[category].listTools() → get inputSchema
→ mapFlagsToArgs(rest, inputSchema)  [flag-mapper.ts]
→ Assemble payload: { action: normalizedAction, ...mappedArgs }
→ runToolCall(ctx, () => module.callTool(...))  [reuses lifecycle]
→ renderToolResult(result, { json, debug })
→ If TTY and multi-page → runInteractivePaging()
```

### `flag-mapper.ts` — Schema-aware Flag Mapping

For each property in `inputSchema.properties`:
- Generate **4 aliases**: original name, kebab-case, snake_case, camelCase
- **Case-insensitive**: Maintain `canonicalByLower` Map
- **Type coercion**: boolean / number / array / object / JSON-sidecar (`--<key>-json`)

### `render.ts` — Result Rendering

| Mode | Behavior |
|------|----------|
| `--json` | `JSON.stringify(payload) + '\n'`, compact single line |
| Default human-readable | Auto-select rendering strategy by payload type (string/array/paginated/Help Index/Action Help/plain object) |
| Error output | Unified `renderCliError()` to **stderr** |

**ANSI colors**: Enabled via `supportsColor(stream)` TTY detection. Green/cyan/yellow/red/dim gray palette.

### `config.ts` — Config Management

**Config priority** (actual code behavior):

```
CLI flag (--url / --token)
  > Environment variable (SIYUAN_API_URL / SIYUAN_TOKEN)
  > Active profile (currentProfile in config.json)
  > Default (http://127.0.0.1:6806)
```

- Multi-profile support: `profiles: Record<string, { apiUrl, token }>` + `currentProfile`
- Default path: `~/.siyuan-sisyphus/config.json` (compatible with old path `~/.siyuan-mcp/config.json`)
- File permissions: directory `0o700`, file `0o600`

### `init.ts` — Interactive Init Wizard

Uses `readline` to ask for profile name, API URL, token, whether to set as current, then writes config file.

### `plugin-check.ts` — Plugin Installation Verification

Before dispatch, reads `plugin.json` and permission files via SiYuan API to ensure `siyuan-plugins-mcp-sisyphus` is installed and ready.

---

## 10. API Layer: `src/api/`

**Core class**: `SiYuanClient` (`client.ts`)

| Feature | Description |
|---------|-------------|
| **Instantiation** | `new SiYuanClient(config)`, `baseUrl` defaults to `http://127.0.0.1:6806`, `timeout` defaults to 5s |
| **Token management** | `setToken()` / `getAuthHeaders()` inject `Authorization: Token <token>` |
| **Unified request** | `request<T>(endpoint, data?)` auto-parses `SiYuanResponse<T>` (returns `data` when `code === 0`, throws `SiYuanError` otherwise) |
| **File operations** | `readFile()` / `readFileBinary()` / `writeFile()` (FormData + File upload) |
| **Timeout control** | `fetchWithTimeout()` using `AbortController` |

**Domain-specific functional API modules**:

| File | Domain | Typical functions |
|------|--------|-------------------|
| `notebook.ts` | Notebook | `listNotebooks`, `createNotebook`, `openNotebook` |
| `document.ts` | Document tree | `createDoc`, `renameDoc`, `removeDoc`, `moveDocs` |
| `block.ts` | Block operations | `insertBlock`, `appendBlock`, `updateBlock`, `deleteBlock` |
| `av.ts` | Attribute View | `getAttributeView`, `addAttributeViewBlocks`, `setAttributeViewBlockAttr` |
| `search.ts` | Search & refs | `fullTextSearchBlock`, `querySQL`, `findReplace` |
| `file.ts` | Files & assets | `uploadAsset`, `exportMdContent`, `renderTemplate` |
| `system.ts` | System & UI | `getVersion`, `reloadUI`, `reloadProtyle` |
| `tag.ts` | Tags | `listTags`, `renameTag` |
| `flashcard.ts` | Flashcards | `getRiffDueCards`, `reviewRiffCard` |
| `transaction.ts` | Transactions | `performTransactions` |
| `attribute.ts` | Block attrs | `setBlockAttrs`, `getBlockAttrs` |

All business modules export **pure functions** taking `client: SiYuanClient` as first argument. No global instances, enabling reuse by both CLI and Plugin.

---

## 11. Settings Module: `src/ui/setting/`

### `tool-config.ts` — Schema Definition

Defines 10 `ToolCategory` entries, each with `enabled` + `actions` + extra fields (e.g. `file`'s `uploadLargeFileThresholdMB`).

### `tool-config-storage.ts` — Persistence Layer

Uses SiYuan plugin `loadData` / `saveData` API to manage 4 config groups:
1. `mcpToolsConfig` → `ToolConfig`
2. `puppySettings` → `PuppySettings`
3. `mcpHttpSettings` → `HttpServerSettings` (auto-generates random 32-byte token on first load)
4. `telemetryConfig` → `TelemetryConfig`

All `load*` functions perform defensive `normalize*` conversion.

### `mcp-config.svelte` — Settings Panel Main Component

- Left `b3-tab-bar` group navigation, right `config__tab-wrap` content area
- Global `onChanged` event dispatcher: routes by key prefix to different persist functions

### Sub-panel Components

| Component | Responsibility |
|-----------|---------------|
| `HttpServerPanel` | HTTP/HTTPS toggle, host/port/token/TLS, client config snippet generation, real-time status & logs |
| `ToolCategoriesPanel` | 9 tool category checkboxes + Notebook permission matrix (`none/r/rw/rwd`) |
| `PuppyPanel` | Mascot toggle + visibility/bubble/click hint/test mode |
| `TelemetryPanel` | Telemetry toggle/interval/endpoint; local analytics dashboard (total calls, tokens, error rate, Top Actions, Daily Trend) |
| `UserRulesPanel` | User custom rules text area |

---

## 12. Mascot System: `src/ui/components/`

**Architecture**: Puppy does not directly call JS APIs. Instead, it communicates with the MCP server via **polling JSON event files** (`puppyEvents.json`) for decoupling.

| Component/File | Responsibility |
|----------------|---------------|
| `ToolPuppy.svelte` | **Core container**. Manages state machine (idle/reading/writing/deleting/moving/dangerous/success/error), polls event files, drag logic, idle animation scheduling |
| `PuppyAwakeSVG.svelte` | Awake pixel cat SVG (52×52). Body, tail, paws, multiple eye expressions, 9 tool icons + action markers, wage card balance display |
| `PuppySleepingSVG.svelte` | Sleep state overlay: floating "zZz" animation |
| `PuppyBubble.svelte` | Bubble & effects layer: text bubbles, wage card bubbles, heart bursts (`❤`), feeding props |
| `PuppyResultOverlay.svelte` | Result/danger state SVG overlay: red X, exclamation mark, error badge |
| `puppy-polling.ts` | `createJsonFilePoller`: periodically POST `/api/file/getFile` to read `puppyEvents.json` |
| `puppy-state.ts` | State management in `src/core/`: `totalCalls`, `balance`, `earn/spend/writeEvent` |
| `puppy-position.ts` | `localStorage` read/write for Puppy screen coordinates |
| `puppy-drag.ts` | Drag session state machine: distinguish click vs drag |
| `puppy-test-mode.ts` | `createTestModeRunner`: periodically random action selection, simulating state transitions |

---

## 13. Presentation Layer: `src/shared/invocation-format.ts`

**Responsibility**: Convert MCP-style tool invocation representation into CLI-style command line representation, achieving **dual-mode presentation unification**.

**Core design**: Tool descriptions, examples, and error messages are written once (MCP style), then automatically adapted to CLI syntax via `translatePresentationText()` / `translatePresentationPayload()`.

| Function | Description |
|----------|-------------|
| `formatFieldRef()` | MCP: original field name; CLI: `--kebab-case` flag |
| `formatActionRef()` | MCP: `tool(action="...")`; CLI: `siyuan <tool> <kebab-action>` |
| `formatActionCall()` | Full invocation formatting: CLI expands to flag-bearing command line |

---

## 14. Utilities: `src/shared/`

| File | Responsibility |
|------|---------------|
| `error.ts` | `SiYuanResponse<T>` unified response structure, `SiYuanError` exception class, `errorCodeMap` (-1~20 error code mapping) |
| `promise-pool.ts` | `PromiseLimitPool<T>`: concurrency-limited Promise pool, supports `add(fn)` + `awaitAll()` |

---

## 15. Type Definitions: `src/types/`

| File | Content |
|------|---------|
| `api.d.ts` (496 lines) | SiYuan HTTP API request/response types: notebook, document, block, attribute, query, search, file, proxy, message, etc. |
| `index.d.ts` (106 lines) | Core type aliases: `DocumentId`, `BlockId`, `NotebookId`; full `Block` structure; complete `BlockType` / `BlockSubType` enums; `Window` interface extensions |
