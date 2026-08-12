# `extension`

`extension` bridges tools exposed through the official MCP endpoint introduced in SiYuan 3.7.0.

## Discovery

```json
{
  "action": "list",
  "refresh": true
}
```

While `extension.includeNativeTools=false`, the response is intentionally compact: it reports only connection state, plugin/native source counts, exposed count, schema size, and `detailsIncluded=false`. It omits the complete `tools` array so disabled native-tool discovery does not consume agent context.

After native tools are enabled, `detailsIncluded=true` and the response also reports individual tool names, descriptions, read-only declarations, effect scopes, degraded schemas, and tools blocked in Sisyphus settings. General `extension` help follows the same rule; targeted `help(topic="<tool>")` can still inspect one explicitly requested tool.

Tools with `source="plugin"` are included by default. Set `extension.includeNativeTools=true` in the plugin settings to include `source="native"` tools. Missing source metadata is treated as native for compatibility. Tools imported from external MCP servers (`source="mcp"`) and this plugin's own namespace remain excluded.

Native tools are disabled by default because they overlap with several Sisyphus action families and materially increase the `extension` schema.
An official tool named `help` or `list` is reported as a reserved-action conflict and is not exposed.

## Calling an official tool

The official full name becomes the action. Downstream parameters always stay inside `arguments`:

```json
{
  "action": "plugin__example_plugin__search",
  "arguments": {
    "action": "query",
    "keyword": "MCP"
  }
}
```

The nested shape avoids collisions when the downstream plugin tool has its own `action` parameter. The CLI equivalent is:

```bash
siyuan extension plugin__example_plugin__search \
  --arguments-json '{"action":"query","keyword":"MCP"}'
```

With native tools enabled, their official unprefixed name is used directly:

```json
{
  "action": "document",
  "arguments": {
    "action": "read",
    "id": "20240318112233-abc123"
  }
}
```

```bash
siyuan extension document \
  --arguments-json '{"action":"read","id":"20240318112233-abc123"}'
```

## Package and lifecycle diagnostics

`extension` also provides two Sisyphus-owned read-only diagnostics. They are not themselves forwarded as official MCP tools, and they never accept a host filesystem path. The registry diagnostic makes an explicit read-only official `tools/list` refresh.

### Validate explicit package content

Use `validate_package` before a separate install or enablement task. Give it the candidate manifest and only the package text files that matter to the package shape and executable surfaces:

```json
{
  "action": "validate_package",
  "package": {
    "type": "plugin",
    "manifest": {
      "name": "example-plugin",
      "version": "1.0.0",
      "minAppVersion": "3.7.0",
      "displayName": {"default": "Example Plugin"},
      "description": {"default": "Example"},
      "kernels": ["darwin"]
    },
    "files": {
      "index.js": "module.exports = class Example extends Plugin { onunload() {} };",
      "kernel.js": "// candidate source supplied by the caller"
    }
  },
  "runtime": {
    "appVersion": "3.7.3",
    "backend": "darwin",
    "frontend": "desktop"
  }
}
```

It checks shared metadata, `minAppVersion`, optional backend/frontend/kernel compatibility, theme modes, required `theme.css`/`index.html`/`index.js`, runtime-derived manifest fields that should not be authored, and visible executable surfaces. For a plugin it also reports static signs of `onunload` plus `siyuan.mcp.registerTool`/`unregisterTool` calls. It is deliberately a static result: a valid package is neither installed nor trusted, loaded, running, registered, reloaded, or functionally verified.

Use only relative filenames in `package.files`. The action does not read `path`, expand an archive, scan a directory, install a package, alter trust, enable/disable a plugin, or reload SiYuan. Supply package content explicitly through the MCP/CLI request so remote deployments have the same boundary as local deployments.

### Read back plugin MCP registration

After an independently authorized lifecycle step, use `diagnose_plugin_mcp` to force a fresh official `tools/list` observation for one plugin's kernel MCP registrations:

```json
{
  "action": "diagnose_plugin_mcp",
  "pluginName": "example-plugin",
  "expectedToolNames": ["echo"],
  "expectedState": "present"
}
```

The manifest name is transformed with SiYuan's current rule—each non-alphanumeric character becomes `_`—so the expected local `echo` tool is checked as `plugin__example_plugin__echo`. The response includes only registry evidence with `source="plugin"`, the selected tools, any expectation result, and explicit lifecycle limits.

The distinction matters:

| Observation | What it supports | What it does not support |
|---|---|---|
| `validate_package` static result | Candidate metadata/file shape and visible executable-risk signals | Provenance, trust, installation, discovery, loading, running state, registration, reload, or behavior |
| Fresh `Source="plugin"` registry entry | The named kernel-plugin MCP tool is registered at that observation; kernel running is a limited inference | Frontend plugin/UI loaded, widget iframe works, every tool function works, or a reload happened |
| Fresh registry absence | The named tool was absent from that observation | Disable, unload, cleanup, or reload completed successfully |

Neither diagnostic invokes a plugin MCP handler. A real reload/disable test remains a separate, explicitly approved live-notebook operation and must read back the correct surface afterwards: plugin MCP tools via a fresh registry, frontend behavior through the real UI, widgets through the iframe, and themes through the relevant appearance surface.

## Safety and lifecycle

- Before connecting to `/mcp`, Sisyphus checks the SiYuan version through `/api/system/version`. Versions below 3.7.0 are marked unsupported without contacting the official endpoint.
- A connection is created only when `extension` is enabled, extension settings are inspected, or discovery is explicitly refreshed.
- Tools without `readOnlyHint=true` require explicit user confirmation.
- Official MCP tool calls are sent once and are never retried. A transport failure after dispatch is reported as an unknown execution state.
- Discovery may reconnect and retry once because it is read-only.
- Initial discovery runs in the background for the outer MCP Server, so the remaining tool list is not blocked. Successful results are cached and emit a tool-list-changed notification.
- Later outer `tools/list` calls reuse the cache instead of contacting `/mcp`; `extension(action="list", refresh=true)` refreshes explicitly.
- If `/mcp` is unavailable or an explicit refresh fails, only dynamic extension actions are hidden. Other Sisyphus tools and the outer MCP Server remain available.
- The settings page provides a master switch, a native-tool source switch, and per-tool blocking.

Official discovery requires SiYuan 3.7.0 or newer, an administrator session, and a valid API token. This requirement applies only to `extension`; the Sisyphus plugin itself keeps `minAppVersion` at 2.9.0.

> [!WARNING]
> Native-tool forwarding does not pass through Sisyphus notebook permissions, disabled actions, or dangerous-action confirmation. Calls execute directly with the current SiYuan administrator session or API Token. Native aggregate tools also do not currently expose inner action-level risk metadata through `tools/list`, so tool-level `readOnlyHint` cannot distinguish read-only actions from mutating actions. Treat every native forwarded call as potentially side-effecting, enable it only for local or fully trusted clients, and never expose it to untrusted remote clients.

## Official MCP and Sisyphus

Sisyphus-owned `fs`, timeline, permission management, CLI, document tools, and other aggregate capabilities always use `/api/*`. Official `/mcp` is an isolated side path owned by `extension`, not an implementation dependency of built-in capabilities.

| Concern | Official SiYuan MCP | Sisyphus |
|---|---|---|
| Registration | Native tools and plugins register independent tools | Tools are grouped by category and action |
| Namespace | Native names or `plugin__<plugin>__<tool>` | The official name becomes an `extension` action |
| Metadata | `source`, `readOnlyHint`, `effectScope` | Preserved in discovery, help, and safety descriptions |
| Change notification | Official registry declares `listChanged=false` | Refresh points compare caches and notify outer clients |
| CLI | Not provided by the official registry | Uses the same bridge through `siyuan extension ...` |
| Calls | Direct official `tools/call` | One-shot forwarding with no replay |
