# Extension Points

This page explains how to safely extend the system and the boundary constraints that must be followed.

Use case: You want to add new tools, modify the transport layer, extend CLI command surface, or change configuration behavior.

---

## Extensible Areas

### 1. Adding a New Tool Category

If you want to expose a new set of SiYuan API capabilities to MCP clients, follow these steps:

#### Step-by-step Checklist

1. **API Wrappers** (`src/api/`)
   - Create or extend the corresponding domain file under `src/api/`
   - Follow the pure function style: `export async function newAction(client: SiYuanClient, ...) { ... }`
   - Add request/response types in `src/types/api.d.ts`

2. **Config Definition** (`src/core/config.ts`)
   - Add the new category name to the `ToolCategory` union type
   - Define the action list in `ACTIONS_BY_CATEGORY`
   - Set defaults in `buildDefaultToolConfig()`
   - (Optional) Mark `basic` / `advanced` in `ACTION_TIERS`
   - (Optional) Add destructive actions to `DANGEROUS_ACTIONS`

3. **Tool Implementation** (`src/tools/`)
   - Create `src/tools/{category}/index.ts` + `src/tools/{category}/handlers.ts`
   - Keep shared tool-layer infrastructure under `src/tools/internal/`; cross-tool helpers belong in `src/tools/internal/helpers/`
   - Use the `defineTool()` factory:
     ```typescript
     export const { listTools: listXxxTools, callTool: callXxxTool } = defineTool({
         category: 'xxx',
         description: '...',
         variants: [...],
     });
     ```
   - Each variant contains: `action` (name), `description`, `schema` (Zod), `handler` (business logic)
   - For permission checks in handlers, use `tools/internal/context.ts`: `ensurePermissionForDocumentId` / `ensurePermissionForNotebook`

4. **Registry Registration** (`src/mcp/tool-registry.ts`)
   - Add entry to `TOOL_REGISTRY`:
     ```typescript
     xxx: { category: 'xxx', listTools: listXxxTools, callTool: callXxxTool }
     ```

5. **Help Text** (`src/core/help.ts`)
   - Add guidance text for the category
   - Add hints for each action

6. **Resource Registration** (`src/mcp/resources.ts`, optional)
   - If dynamic help resources are needed, add routing in `readHelpResource()`

7. **Settings Panel** (`src/ui/setting/mcp-config.svelte` and sub-panels)
   - Add category checkbox in `ToolCategoriesPanel`
   - Add corresponding i18n text

8. **Testing**
   - `tests/unit/tools/{category}.test.ts`: Cover schema and handler for each action
   - `tests/integration/server.test.ts`: Ensure new tool appears in `listTools()`
   - `tests/unit/cli/flag-mapper.test.ts`: If CLI exposes new flags, verify mapping

9. **Documentation**
   - `docs/reference/tools/{category}.md` and `docs/zh/reference/tools/{category}.md`
   - Update `API_MCP_MAPPING.md`

#### Dependency Graph

```
api/{category}.ts  →  types/api.d.ts
     ↓
tools/{category}/index.ts → tools/internal/define-tool.ts → tools/internal/shared.ts → config.ts + help.ts + types.ts
     ↓
tool-registry.ts
     ↓
resources.ts (optional)
```

---

### 2. Adding a New Action to an Existing Category

If you are only adding a new action to an existing category, the steps are greatly simplified:

1. **API Wrapper**: Add function in corresponding `src/api/{category}.ts`
2. **Config Definition**: Add action name to `ACTIONS_BY_CATEGORY[category]` in `src/core/config.ts`
3. **Tool Implementation**: Add variant to `variants` array in corresponding `src/tools/{category}/index.ts`
4. **Help Text**: Add action hint in `src/core/help.ts`
5. **Testing**: Cover new action in `tests/unit/tools/{category}.test.ts`
6. **Documentation**: Update corresponding reference page and `API_MCP_MAPPING.md`

**Note**: Tool descriptions and config action lists **must stay consistent**. If an action is listed in config but not implemented in variants, or vice versa, it will cause runtime errors or inconsistent user experience.

---

### 3. Adding New Help Resources (MCP Resources)

MCP Resources are static or dynamic help documents that AI clients can fetch via `ReadResourceRequest`.

#### Adding Static Resources

In `src/mcp/resources.ts`:
1. Add resource metadata in `listHelpResources()`
2. Add URI matching branch in `readHelpResource()`
3. Define resource content text in `src/core/help.ts`

#### Adding Dynamic Resource Templates

Dynamic templates follow the `siyuan://help/action/{tool}/{action}` pattern. For new template types:
1. Add template URI in `listHelpResourceTemplates()`
2. Parse new template parameters in `readHelpResource()` and route to corresponding generation logic

---

### 4. Extending CLI Rendering

CLI result rendering is in `src/cli/render.ts`. To support new payload types:

1. Add recognition logic in `renderSuccessPayload()` type-guard branches
2. Implement corresponding render function (refer to existing `renderArrayPayload()` / `renderPaginatedPayload()` etc.)
3. Ensure the payload can be properly `JSON.stringify`ed in `--json` mode

**Note**: When adding rendering logic, also update `src/shared/invocation-format.ts` to ensure help text consistency between MCP and CLI modes.

---

### 5. Extending Settings Panel UI

The settings panel uses Svelte components integrated with SiYuan native UI (`b3-tab-bar`, `b3-list`).

#### Adding New Config Fields

1. Define new field in `src/core/config.ts` (`ToolConfig`, defaults and `normalizeToolConfig`)
2. Add `loadXxx()` / `saveXxx()` in `src/ui/setting/tool-config-storage.ts`
3. Add key prefix routing in `src/ui/setting/mcp-config.svelte`'s `onChanged` dispatcher
4. Add UI control in corresponding sub-panel component
5. Load new config in `src/index.ts` `onload()`

#### Adding New Sub-panels

1. Create new Svelte component under `src/ui/setting/mcp-config/`
2. Register new panel in `src/ui/setting/mcp-config.svelte`'s tab-bar and content area
3. Add i18n text to `dev/i18n/` and `public/i18n/`

---

### 6. Extending Transport Layer

Currently supports stdio and HTTP/S. To add new transports:

1. Create transport implementation file under `src/core/` (e.g. `websocket-transport.ts`)
2. Implement the Transport interface from MCP SDK
3. Add new transport mode branch in `src/mcp/server.ts` `startMcpServer()`
4. Add configuration UI in settings panel `HttpServerPanel` (or create new panel)
5. Update documentation for new transport usage

---

## Boundary Constraints

### Security Boundaries

| Constraint | Description | Violation Consequence |
|-----------|-------------|----------------------|
| **Must access data through SiYuan API** | All data read/write (files, config, permissions) goes through `SiYuanClient` | Violation makes remote scenarios unsafe; plugin review will be rejected |
| **Notebook permissions must remain enforced** | Any notebook-scoped mutation must call `ensurePermissionForDocumentId` / `ensurePermissionForNotebook` before operation | Violation renders permission model ineffective |
| **Destructive actions must be marked** | New destructive actions must be added to `DANGEROUS_ACTIONS` | Violation leads to accidental AI execution of dangerous operations |
| **HTTP non-loopback must enable token** | If HTTP server binds to non-127.0.0.1, token auth is required | Violation leads to unauthorized remote access |
| **CLI does not do secondary confirmation** | CLI dangerous actions do not popup confirm (user typing command is confirmation) | Do not try to add interactive confirmation in CLI; would break scripting use |

### Code Boundaries

| Constraint | Description |
|-----------|-------------|
| **Do not modify TOOL_REGISTRY static structure** | Keep `Record<ToolCategory, ToolModule>` compile-time deterministic; do not introduce dynamic scanning or reflection |
| **Do not break Zod Schema consistency** | Schemas in `src/tools/{category}/schemas.ts` must align with action lists in `config.ts` and variant schemas in `tools/{category}/index.ts` |
| **Do not introduce global state** | `SiYuanClient`, `PermissionManager` etc. should be passed as parameters; do not store in module-level variables (CLI and plugin may have multiple instances) |
| **Maintain CJS output format** | All artifacts in Vite config are CommonJS; do not introduce ESM-only dependencies |
| **Keep Node built-ins external** | Preserve Node built-in modules in server/cli Rollup external; do not bundle them |

### Documentation Boundaries

| Constraint | Description |
|-----------|-------------|
| **Tool docs must align with config action lists** | Action lists in `docs/zh|en/reference/tools/{category}.md` must fully match `ACTIONS_BY_CATEGORY` in `src/core/config.ts` |
| **Bilingual sync** | All doc changes must update both `zh/` and `en/` versions |
| **API mapping docs must be updated** | New actions must update `API_MCP_MAPPING.md` and `API_COMPLETE_MAPPING.md` |

---

## Testing Strategy

### Testing Requirements for New Tools/Actions

| Test Type | Required | Validation Content |
|-----------|----------|-------------------|
| **Action Schema Exposure** | ✓ | New action appears in `inputSchema.properties.action.enum` |
| **Handler Logic** | ✓ | Mock `SiYuanClient` and `PermissionManager`, verify handler behavior |
| **Zod Validation** | ✓ | Test valid/invalid parameters separately |
| **Permission Checks** | ✓ (if notebook-scoped mutation) | Mock different permission levels, verify blocking behavior |
| **Help Output** | ✓ | `action="help"` returns correct help content |
| **Integration Tests** | ✓ | New tool appears in `listTools()` results; end-to-end call returns expected result |
| **Schema Snapshot** | Recommended | `tests/unit/tools/help-output.snapshot.test.ts` locks help output |
| **CLI Flag Mapping** | Recommended (if CLI exposes new flags) | Verify kebab↔camel mapping and type coercion |

### Test Commands

```bash
pnpm test              # Run unit + integration tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage report
pnpm test:smoke        # Smoke tests (requires running SiYuan instance)
```

---

## Release Checklist

After completing extension development, verify in this order:

- [ ] `pnpm build` succeeds with no TypeScript errors
- [ ] `pnpm build:cli` succeeds
- [ ] `pnpm test` passes completely
- [ ] `pnpm test:smoke` passes (if applicable)
- [ ] Documentation updated (zh + en)
- [ ] `API_MCP_MAPPING.md` updated
- [ ] Settings panel UI updated (if applicable)
- [ ] i18n text added (if applicable)
- [ ] `CHANGELOG.md` recorded
