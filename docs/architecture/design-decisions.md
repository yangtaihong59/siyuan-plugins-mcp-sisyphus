# Design Decisions

This page documents major architectural decisions and the trade-offs behind them. Each decision includes **problem context**, **choice made**, **rejected alternatives**, and **current outcome**.

Use case: You are judging whether a change aligns with the current design direction, or need to understand why something was designed the way it is.

---

## 1. Aggregated Tool Design

### Problem Context

SiYuan provides approximately 459 HTTP API endpoints. Exposing one MCP tool per endpoint would create a surface of 100+ tools, leading to:
- **Exploding context cost**: Each MCP `list_tools` returning 100+ descriptors consumes massive system prompt tokens
- **Poor discoverability**: LLMs struggle to choose correctly from 100+ tools
- **Naming collisions**: Many similar names (`listNotebooks` / `listDocs` / `listBlocks`) cause confusion

### Choice Made

Aggregate related APIs by domain into **13 MCP tools**:

| MCP Tool | SiYuan Domain Covered | Action Count |
|----------|----------------------|-------------|
| `fs` | Filesystem-style document operations | 7 |
| `notebook` | Notebook CRUD | ~10 |
| `document` | Document tree operations | ~17 |
| `block` | Block-level operations | ~21 |
| `av` | Attribute View (database) | ~13 |
| `file` | Files & assets | ~11 |
| `search` | Search & query | ~11 |
| `tag` | Tag management | ~3 |
| `system` | System & UI | ~10 |
| `flashcard` | Flashcard review | ~8 |
| `extension` | Official plugin tools and optional native SiYuan MCP tools | Dynamic |
| `mascot` | Mascot interaction | ~3 |
| `feedback` | Product feedback submission | 1 |

Each tool distinguishes specific operations via the `action` parameter, e.g.:
```
notebook(action="list")
notebook(action="create")
notebook(action="rename")
```

### Rejected Alternatives

- **Option A: One API, One Tool**: Each SiYuan API maps to one MCP tool. Rejected: context cost too high, LLM selection difficulty.
- **Option B: Hide action layer completely**: Only expose a small set of tools, with actions as internal implementation details. Rejected: LLM needs to know available operations, and different actions have very different parameters that cannot be hidden under a unified schema.
- **Option C: Dynamically show by frequency**: Only show relevant tools based on context. Rejected: MCP protocol currently has no dynamic `list_tools` mechanism; would require complex server-side state machine.

### Current Outcome

- MCP tool surface reduced from 100+ to **12**
- `list_tools` response size reduced from ~50KB to ~**8KB**
- Significantly improved LLM tool discoverability
- Each action's parameters are strictly validated via Zod schema, reducing error rates

---

## 2. Progressive Disclosure

### Keep only routing and common call contracts at mount time

Keep the 14 aggregated tools and their existing action API. Do not split each action into a separate tool.

| Layer | Responsibility |
| --- | --- |
| Initialize `instructions` | Cross-tool routing, path formats, user rules/memory priority, confirmation and strict-write preflight |
| `tool.description` | Purpose and boundaries, compact `action(required fields)` signatures; `*` marks confirmation-required actions |
| `inputSchema` | Enabled action enum, field types and constraints, one description per field; defer large nested shapes |
| `action="help", topic="<action>"` | Complete original parameter schema, alternative required fields, examples, domain guidance and confirmation requirements |
| `siyuan://help/action/{tool}/{action}` | The same full parameter schema and Markdown help; use the help action when resources are unavailable |
| `siyuan://skills/*` and docs | Multi-step workflows, layout/domain guidance and full reference |

Global rules appear once. App handoff rules stay on the relevant App descriptors and responses. Merged fields no longer concatenate every action's description or repeat both parameter-contract and required-by lists. Compatibility aliases remain accepted at runtime while discovery favors canonical names.

Nested merged schemas exceeding 600 characters are reduced to container types and help pointers in `tools/list` only. Short shapes, scalar types and enums remain. **Original action schemas, Zod validation, internal CLI action branches, write preflight and permissions remain intact.** Help returns the full schema root, preserving `required`, composition constraints and reference targets. Complex calls should fetch action help first; this adds a help round trip for those tasks.

### Measurement and regression budgets

Run `npm run analyze:mcp` (or `pnpm analyze:mcp`). The script loads the actual registry and measures `instructions.trim().length + JSON.stringify({ tools }).length`; it no longer maintains a duplicate hard-coded tool catalog. Pass `--root PATH` to measure another source tree.

| Default configuration | Before (dev HEAD) | After |
| --- | ---: | ---: |
| Instructions | 20,988 chars | 3,216 chars |
| tools/list (14 tools) | 133,583 chars | 57,720 chars |
| Total | 154,571 chars | 60,936 chars |
| Approximate tokens (chars / 4) | 38,643 | 15,234 |
| AV tool within the total | 42,515 chars | 11,231 chars |

Total reduction: **60.6%**. Scope: default config, empty user rules/memory, no dynamically discovered third-party tools or optional MCP Apps. Additional client-visible descriptors cost extra. Tokens are estimates, not measurements with a Claude/OpenAI tokenizer. User rules and memory are never truncated to fit the budget.

`tests/unit/core/mcp-payload.test.ts` caps default payloads at 64,000 characters and all-static-actions payloads at 66,000, with separate instructions/AV limits. It also checks full help, nested validation and disabled actions. Run `npm test` to verify.

### Sources and limits

- [OpenAI metadata guidance](https://developers.openai.com/plugins/guides/optimize-metadata): describe tool purpose and scope precisely, document arguments and constrained values, and use truthful annotations.
- [OpenAI Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search): clients can defer tool loading to reduce persistent context. `defer_loading` is a client API option, not a portable MCP server field.

This project implements disclosure through its existing help/resources for client compatibility. The 600-character threshold and payload budgets are project decisions, not official MCP requirements. Real-model A/B error-rate evaluation has not been performed; unit/integration tests verify protocol, parameter and safety behavior.

---

## 3. Permission Model

### Problem Context

When external AI Agents connect to SiYuan, controllable data access boundaries are needed:
- Some notebooks may contain sensitive information
- AI should not be able to arbitrarily delete or modify important data
- Permission control needs moderate granularity (too fine is hard to manage, too coarse offers no protection)

### Choice Made

Adopt **notebook-level 4-tier permissions**:

| Level | Permission | Use Case |
|-------|-----------|----------|
| `none` | Completely blocked | Sensitive notebooks |
| `r` | Read-only | Reference notebooks |
| `rw` | Read-write (no delete) | Daily work notebooks |
| `rwd` | Full permission | Trusted areas |

**Implementation details**:
- Permission file stored at `/data/storage/petal/siyuan-plugins-mcp-sisyphus/notebookPermissions`
- Read/write via SiYuan API, never directly accessing local filesystem
- Unconfigured notebooks default to `r` (read-only) so missing permission entries do not grant write/delete access
- Permission checks are **explicitly called** by business handlers, not unified middleware (different actions have different needs)

### Rejected Alternatives

- **Option A: Document-level permissions**: Too fine-grained, high management cost, and SiYuan natively does not support document-level permissions.
- **Option B: Action-level permissions (each action individually toggleable)**: Already exists (ToolConfig's `actions`), but this is a feature toggle, not a security boundary. Security boundaries need to be on the data dimension (notebook).
- **Option C: Global read-only mode**: Too blunt, cannot satisfy the need for some notebooks writable and some not.

### Current Outcome

- Settings panel provides Notebook permission matrix UI
- Permission validation occurs before API calls, blocking unauthorized operations
- CLI mode defaults to full open if permission file cannot be read (CLI user typing command is considered confirmation)

---

## 4. Plugin & CLI Shared Core

### Problem Context

The project needs to support two usage patterns:
1. **Plugin mode**: AI clients communicate with the SiYuan plugin via MCP protocol
2. **CLI mode**: Users execute commands directly in the terminal

Independent implementations would cause code duplication, inconsistent behavior, and doubled maintenance cost.

### Choice Made

**CLI directly imports plugin source code**, sharing the following core modules:

```
Shared layers:
├── src/api/client.ts           SiYuanClient
├── src/core/tool-registry.ts    TOOL_REGISTRY
├── src/core/tool-lifecycle.ts   runToolCall (puppy/analytics/telemetry)
├── src/core/config.ts           buildDefaultToolConfig, ACTIONS_BY_CATEGORY
├── src/core/permissions.ts      PermissionManager
├── src/tools/*/index.ts          All tool implementations
└── src/shared/invocation-format.ts  Dual-mode presentation unification

Layers CLI does NOT use:
├── @modelcontextprotocol/server Does not start MCP server
├── src/core/server.ts           Skips ListTools/CallTool handlers
├── src/core/http-transport.ts   Does not start HTTP server
├── src/core/resources.ts        Does not expose MCP Resources
├── src/core/server-instructions.ts  No instructions
└── src/index.ts                Skips plugin lifecycle
```

### Rejected Alternatives

- **Option A: CLI spawns child MCP server**: Attempted in early versions. Rejected: complex process management, slow startup, resource waste, difficult debugging.
- **Option B: CLI fully independent implementation**: Rejected: severe code duplication; tool logic changes would need to be synced in two places.

### Current Outcome

- CLI output `cli.cjs` is a self-contained bundle with no `node_modules` dependency
- Tool bug fixes only need to change one place (`src/tools/`), fixing both plugin and CLI simultaneously
- CLI behavior is 100% consistent with the plugin (except config source and tool toggle defaults)

---

## 5. Transport Layer Choice

### Problem Context

The MCP protocol supports multiple transport methods. The most suitable one needs to be chosen for each usage scenario.

### Choice Made

Support **stdio** (default) and **HTTP/S** transports:

| Transport | Implementation | Use Case |
|-----------|---------------|----------|
| stdio | SDK v2 `serveStdio()` with legacy serving enabled | Local AI clients across both protocol eras |
| HTTP | SDK v2 request classifier + modern/legacy handlers | Remote access, browsers, multi-client sharing |

**HTTP mode enhancements**:
- **Dual-era negotiation**: MCP 2026-07-28 requests use a strict stateless handler; legacy requests retain independent sessions
- **Input hardening**: Validates `Origin` and JSON content type before protocol dispatch
- **Bearer Token auth**: Prevents unauthorized access
- **TLS support**: Encrypted transport for production
- **Parent Watchdog**: Auto-cleanup when SiYuan main process exits

### Rejected Alternatives

- **Option A: stdio only**: Cannot satisfy remote access and browser scenarios.
- **Option B: Replace the endpoint with a modern-only handler**: Rejected because existing clients still negotiate older protocol revisions.
- **Option C: WebSocket transport**: MCP protocol has not standardized WebSocket transport; poor compatibility.

### Current Outcome

- stdio mode works out of the box with zero configuration
- HTTP mode provides a complete configuration panel; users can customize host/port/token/TLS
- Both modes can be switched with one click in the settings panel

---

## 6. CLI Config Priority

### Problem Context

CLI needs to support multiple config sources with clear conflict resolution priority.

### Choice Made

```
Priority from high to low:
1. CLI flag        (--url / --token)
2. Environment variable (SIYUAN_API_URL / SIYUAN_TOKEN)
3. Config file     (active profile in ~/.siyuan-sisyphus/config.json)
4. Default         (http://127.0.0.1:6806)
```

**Multi-profile support**:
- `config.json` contains `profiles: Record<string, { apiUrl, token }>`
- `currentProfile` field indicates the default active profile
- `--profile <name>` can temporarily switch

### Rejected Alternatives

- **Option A: Config file only**: Inconvenient for scripting and CI/CD.
- **Option B: Environment variable highest priority**: Inconvenient for users to temporarily override (e.g. testing different endpoints).
- **Option C: No profile concept**: Poor experience when managing multiple environments (local/remote/work/personal).

### Current Outcome

- Scripting: `siyuan-sisyphus block list --url http://remote:6806 --token xxx`
- CI/CD integration: `SIYUAN_API_URL=... siyuan-sisyphus ...`
- Daily development: Configure once with `siyuan-sisyphus config set default --url http://127.0.0.1:6806`, then call directly

---

## 7. Build Design

### Problem Context

The project needs to produce three artifacts (plugin UI, MCP server, CLI) with different tech stacks (browser vs Node.js environment).

### Choice Made

**Vite multi-entry configuration**:

```
BUILD_TARGET=renderer  →  dist/index.js       (Browser environment, Svelte UI)
BUILD_TARGET=server    →  dist/mcp-server.cjs (Node.js environment, MCP Server)
BUILD_TARGET=cli       →  cli/dist/cli.cjs    (Node.js environment, Standalone CLI)
```

**Key build decisions**:

| Decision | Description |
|----------|-------------|
| Output format | All CommonJS (CJS), compatible with SiYuan plugin loading mechanism |
| inlineDynamicImports | Force inline dynamic imports, single-file output |
| server/cli external | Preserve Node built-in modules (fs/path/http etc.), do not bundle |
| renderer external | Only exclude `siyuan` (injected by SiYuan runtime) |
| CLI shebang | Inject `#!/usr/bin/env node` header, `chmod 755` |
| SDK lightweight | Custom rollup plugin replaces `validation/ajv-provider.js` and `experimental/tasks/*` with local noop implementations to reduce bundle size |

### Rejected Alternatives

- **Option A: Direct tsc compilation**: Cannot control bundle size, no tree-shaking or noop replacement.
- **Option B: Direct esbuild / rollup**: Vite already provides out-of-the-box TypeScript + Svelte support; no need to reconfigure.
- **Option C: Separate package.json and build flow per artifact**: Too high maintenance cost; Vite multi-entry is flexible enough.

### Current Outcome

- `pnpm dev` simultaneously watches renderer + server
- `pnpm build` produces `dist/index.js` + `dist/mcp-server.cjs` + `package.zip`
- `pnpm build:cli` produces `cli/dist/cli.cjs` (self-contained, zero dependencies)
- Artifact sizes: index.js ~30KB, mcp-server.cjs ~284KB, cli.cjs ~(self-contained)

---

## 8. Error Handling Strategy

### Problem Context

The system needs to handle errors from multiple sources: Zod validation, SiYuan API, network timeouts, insufficient permissions, config anomalies, etc. Different errors need to be presented differently to different consumers (LLM vs human terminal users).

### Choice Made

**Unified error formatting** (`tools/internal/shared.ts: createErrorResult`):

```
ZodError          → type: "validation_error",  message: "Invalid parameters: ..."
SiYuanError       → type: "api_error",         code: siYuanCode, message: siYuanMsg
Permission denied → type: "permission_denied", message: "Permission denied for notebook ..."
Disabled tool/action → type: "disabled_error", message: "Tool/Action is disabled"
Other Error       → type: "internal_error",    message: error.message
```

**Presentation layer unification** (`presentation/invocation-format.ts`):
- MCP mode: Error text maintains `tool(action="...")` style
- CLI mode: Error text automatically translates to `siyuan <tool> <action> --flag` style

### Rejected Alternatives

- **Option A: Throw raw Error directly to MCP SDK**: Would cause LLM to receive unfriendly stack traces.
- **Option B: Each error formats independently**: Hard to maintain, inconsistent style.

### Current Outcome

- LLM receives structured error information and can auto-correct parameters
- CLI users receive human-readable error hints with field-level validation details
- All error types have explicit `type` fields for client-side classification

---

## 9. Puppy Mascot Architecture

### Problem Context

A visual feedback mechanism is needed so users can perceive when the AI Agent is operating SiYuan, while adding a touch of fun.

### Choice Made

**Decoupled file polling architecture**:

```
MCP Server (tool-lifecycle.ts)          Puppy UI (ToolPuppy.svelte)
    │                                        │
    │  writePuppyEvent()                     │  createJsonFilePoller()
    │     ↓                                  │     ↓ every 500ms
    │  puppyEvents.json  ←───────────────────│  POST /api/file/getFile
    │                                        │     ↓
    │                                        │  Parse events → Drive state machine
```

**Key design**:
- Does not directly share JS objects/memory; communicates via filesystem for decoupling
- Puppy can run independently of the server (test mode)
- Position persisted via `localStorage`
- Animation state machine (idle/reading/writing/deleting/moving/dangerous/success/error)

### Rejected Alternatives

- **Option A: Directly share JS variables**: Too tightly coupled; Puppy component and server must be in the same process.
- **Option B: Use SiYuan broadcast/event bus**: Higher complexity, requires native SiYuan support.
- **Option C: WebSocket push**: Requires additional ports and connection management; over-engineered.

### Current Outcome

- Puppy animations are smooth, state transitions are timely (500ms polling interval)
- Test mode runs all animations without a backend
- Fun features like wage card, heart bursts, and feeding increase user engagement

---

## 10. Dangerous Action Confirmation Strategy

### Problem Context

Certain operations (delete/remove/find_replace etc.) are destructive and need to prevent accidental AI execution.

### Choice Made

**Protocol confirmation with legacy fallback**:

1. **`DANGEROUS_ACTIONS` set**: Hard-coded in `config.ts` with 15 high-risk actions
2. **Auto-injected warnings**: `buildAggregatedTool()` automatically appends `"⚠️ Dangerous action: ... requires user confirmation"` to tool descriptions
3. **Server Instructions**: `server-instructions.ts` emphasizes high-risk operations requiring confirmation in MCP instructions
4. **Modern code-level gate**: MCP 2026-07-28 calls use multi-round elicitation before the tool lifecycle begins; cancellation or rejection returns without executing the action
5. **Compatibility fallback**: Legacy MCP clients keep the instruction/help warning flow because they cannot express the new confirmation exchange; CLI command entry remains the user's confirmation
6. **Tool metadata**: Conservative annotations expose destructive/read-only hints to capable clients

### Rejected Alternatives

- **Option A: Require modern elicitation from every client**: Rejected because it would break legacy clients that do not advertise the capability.
- **Option B: Completely prohibit dangerous actions**: Too conservative; many legitimate automation scenarios need delete/remove.
- **Option C: Each dangerous action requires extra token/password**: Increases usage barrier, inconsistent with MCP protocol design philosophy.

### Current Outcome

- Modern clients receive an enforceable protocol-level confirmation request; legacy clients receive explicit warnings
- Users can completely disable specific actions via ToolConfig
- Settings panel provides visual marking for "dangerous actions"
