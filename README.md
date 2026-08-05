# SiYuan Sisyphus MCP & CLI

[![MCP Toplist](https://mcptoplist.com/badge/glama%2Fyangtaihong59%2Fsiyuan-plugins-mcp-sisyphus.svg)](https://mcptoplist.com/server/glama%2Fyangtaihong59%2Fsiyuan-plugins-mcp-sisyphus)

<p align="left">
  <a href="https://www.npmjs.com/package/siyuan-sisyphus">
    <img src="https://img.shields.io/npm/v/siyuan-sisyphus?style=flat-square&color=%23cb3837" alt="npm version">
  </a>
  <a href="https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/yangtaihong59/siyuan-plugins-mcp-sisyphus?style=flat-square&color=%23007ec6" alt="license">
  </a>
  <a href="https://yangtaihong59.github.io/siyuan-plugins-mcp-sisyphus/">
    <img src="https://img.shields.io/badge/docs-VitePress-646cff?style=flat-square&logo=vitepress" alt="Documentation">
  </a>
  <a href="https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/releases">
    <img src="https://img.shields.io/github/v/release/yangtaihong59/siyuan-plugins-mcp-sisyphus?style=flat-square&color=%23007ec6" alt="GitHub release">
  </a>
</p>

<p align="left">
  <a href="https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README.md">English</a> |
  <a href="https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README_zh_CN.md">中文</a> |
  <a href="https://yangtaihong59.github.io/siyuan-plugins-mcp-sisyphus/">Documentation</a>
</p>

> Connect external AI agents, the existing Sisyphus toolset, and SiYuan's official MCP plugin ecosystem.

> **Latest:** `v0.5.1` — Isolates official MCP extension failures so Sisyphus tools, the CLI, and the outer MCP server keep working; adds copy-ready AI setup prompts for MCP and CLI connections. CLI is now `v0.2.1`.

## Project Direction Update

I originally built SiYuan Sisyphus simply because I wanted my own SiYuan notes to connect more naturally with external AI agents. Now that SiYuan provides an official MCP implementation, I am glad to see a broader shared ecosystem taking shape. As one plugin developer within that ecosystem, I want Sisyphus to preserve its existing workflows while embracing official MCP and working alongside other plugins to make the connection between SiYuan and external agents smoother and more reliable.

This does not replace the existing project:

- the 13 Sisyphus aggregate tools, parameter conventions, notebook permissions, and existing agent workflows remain compatible;
- Sisyphus now connects to SiYuan's official MCP endpoint and discovers tools registered by other plugins;
- native SiYuan MCP tools can also be included explicitly, but remain disabled by default because they have a different security boundary;
- permission management, the document timeline, and multiple connection options continue to be maintained.

```mermaid
flowchart LR
    Agent["External AI agents<br/>Claude / Codex / Cursor / Cline / ..."]
    Sisyphus["SiYuan Sisyphus<br/>MCP + CLI"]
    Builtin["Sisyphus aggregate tools<br/>existing workflows remain compatible"]
    Bridge["extension<br/>official MCP bridge"]
    Api["SiYuan /api/*"]
    OfficialMcp["SiYuan /mcp"]
    PluginTools["Tools registered by other plugins"]
    NativeTools["Native SiYuan MCP tools<br/>optional, disabled by default"]
    Workspace["SiYuan workspace"]

    Agent --> Sisyphus
    Sisyphus --> Builtin
    Sisyphus --> Bridge
    Builtin --> Api --> Workspace
    Bridge --> OfficialMcp --> PluginTools
    OfficialMcp -. high-risk option .-> NativeTools
```

The boundary is deliberate: Sisyphus-owned capabilities—including `fs`, the document timeline, permission management, CLI, document tools, and the other aggregate workflows—always use SiYuan's `/api/*` endpoints and never depend on official MCP. `/mcp` belongs exclusively to `extension`, where it discovers and forwards tools registered by other plugins and native SiYuan tools explicitly enabled by the user.

## One Connection, Two Compatible Tool Ecosystems

| Tool source | Default | Best suited for | Compatibility and security boundary |
|---|---|---|---|
| **Sisyphus aggregate tools** | Enabled | Stable read, search, edit, database, permission, and automation workflows | Existing actions and parameters remain compatible and pass through Sisyphus permissions and dangerous-action controls |
| **Official plugin MCP tools** | Enabled | New capabilities registered by other SiYuan plugins through official MCP | Dynamically discovered by `extension`; the official tool name becomes the action |
| **Native SiYuan MCP tools** | Disabled | Testing and comparison in trusted local environments | Execute with the administrator session or API Token and bypass Sisyphus notebook permissions and dangerous-action confirmation |

Existing users do not need to rewrite Sisyphus calls as official tools. The original tool surface remains available; official plugin tools add a new ecosystem entry point over the same connection.

Plugin developers only need to register a tool with SiYuan's official MCP registry. Sisyphus can discover it there without requiring a separate Sisyphus-specific adapter.

## What It Is

SiYuan Sisyphus connects external AI agents to SiYuan so they can safely read, search, edit, and organize the workspace.

It provides two entry points:

- **MCP plugin**: connect SiYuan to Claude Desktop, Claude Code, Codex, Cursor, Cherry Studio, Cline, and other MCP-capable clients while bridging the official MCP plugin ecosystem.
- **CLI `siyuan-sisyphus`**: let agents, terminals, and scripts operate SiYuan through short commands for one-shot tasks and automation.

Both entry points share the same underlying SiYuan operations. Sisyphus-owned tools share one permission model; official tools forwarded through `extension` retain their own permission semantics.

## Quick Start

1. Install the plugin from the SiYuan marketplace, or build it from source using the development guide.
2. Open `Plugin -> SiYuan Sisyphus MCP & CLI -> Settings`.
3. Choose MCP or CLI on the connection page.
4. Copy the generated client configuration, or initialize the CLI with `siyuan-sisyphus init`.
5. Verify the connection with a read-only task such as listing notebooks or reading the SiYuan version.
6. To use official MCP tools registered by other plugins, expand “Extension Tools” in tool settings and inspect the discovery status.

```bash
npm i -g siyuan-sisyphus
siyuan-sisyphus init
sisyphus notebook list
```

For complete installation and connection instructions, see [Getting Started](./docs/getting-started/index.md).

## Core Capabilities

- **Official MCP plugin ecosystem integration**: discover tools registered by other plugins through SiYuan's official MCP and expose them to external agents.
- **Existing agent workflow compatibility**: retain the original Sisyphus aggregate tools, actions, CLI, and permission configuration.
- **AI-friendly note access**: use human-readable `fs` paths such as `/Notebook/Project/Note` without requiring agents to understand block IDs or document-tree internals.
- **MCP and CLI entry points**: use MCP for multi-step agent workflows and CLI for scripts, automation, and small one-shot tasks.
- **Notebook-level safety**: assign each notebook `none`, `r`, `rw`, or `rwd` access.
- **Low-context tool design**: group 100+ SiYuan capabilities into 13 action-routed tools and load detailed guidance only when needed.
- **Scenario Skills for agents**: provide guidance for browsing, editing, search, databases, exports, tags, flashcards, system safety, and SiYuan markup.
- **Git-like document timeline**: create named timeline nodes, compare snapshots, and roll back a document when needed.
- **Practical connection setup**: generate connection snippets for common AI clients and local, remote, and Docker deployments.

## Official MCP Ecosystem Integration

On SiYuan 3.7.0+, `extension` reads the official `/mcp` registry and turns allowed official tools into dynamic actions:

```json
{
  "action": "plugin__example__search",
  "arguments": {
    "action": "query",
    "keyword": "MCP"
  }
}
```

All downstream parameters stay inside `arguments`, so a downstream tool can use its own `action` field without colliding with Sisyphus routing.

The tool settings page reports plugin/native tool counts, exposed count, schema size, source, and risk information. Individual tools can also be disabled.

Connections are version-gated and lazy. Sisyphus first reads the SiYuan version through `/api/system/version`; versions below 3.7.0 never receive a `/mcp` request. The official endpoint is contacted only when `extension` is enabled or when the user inspects or refreshes extension tools in settings. The outer MCP Server does not wait for initial discovery when listing tools: successful results are cached, a tool-list-changed notification is sent, and later `tools/list` calls reuse the cache instead of forcing a refresh.

If `/mcp` is unavailable, only dynamic extension actions are hidden. The remaining aggregate tools continue to work and outer MCP Server startup is unaffected. Official MCP integration does not raise the installation floor for the plugin; `minAppVersion` remains 2.9.0.

> **Security note:** official plugin tools and optional native SiYuan tools do not pass through the notebook permissions or action-level dangerous-operation controls applied to Sisyphus-owned tools. Native tools in particular should only be enabled for local or fully trusted clients.

See the [`extension` tool documentation](./docs/reference/tools/extension.md) for full calling conventions.

## Git-Like Document Timeline

<p align="center">
  <img src="docs/archive/timeline.png" alt="Document Timeline" width="720">
</p>
<p align="center"><em>Document Timeline: named snapshots, visual diff, and rollback for SiYuan notes.</em></p>

The timeline gives ordinary SiYuan documents a source-control-style safety layer:

- create named timeline nodes for the current document;
- compare a historical snapshot with the current document;
- switch between unified and split diff;
- use a minimap-style change navigator and collapse unchanged blocks;
- roll back the whole document, or restore supported parsed blocks individually.

This is a document-focused timeline built on SiYuan snapshots. It is intentionally not a complete Git replacement or source-control workflow.

## MCP And CLI Entry Points

Use **MCP** when an AI client should discover tools, compose multi-step operations, and verify results. It fits agent workflows involving search, reading, editing, database inspection, and official plugin tools.

Use **CLI** when one terminal command is enough. It avoids placing long tool schemas in the model context and works well for scripts, automation, and small one-shot tasks.

MCP and CLI share the same Sisyphus core call path, preventing one capability from developing different semantics across two entry points.

## Scenario Skills For Agents

The MCP server includes scenario-oriented guidance for browsing, editing, search, databases, exports, tags, flashcards, system safety, and SiYuan markup. A regular MCP client does not need to install anything: it can read `siyuan://skills/index`, then load the matching `siyuan://skills/{name}` resource. The matching MCP prompts are user-invoked workflow starters; they are not applied automatically.

Agents that support installable `SKILL.md` packages can install the same guidance locally:

```bash
siyuan-sisyphus skill install --bundle mcp # MCP calling conventions
siyuan-sisyphus skill install --bundle all # MCP and CLI bundles
```

Plain `siyuan-sisyphus skill install` remains the CLI bundle for backward compatibility. Skills describe workflows and safety decisions; the current parameter source of truth remains `siyuan://help/action/{tool}/{action}` or the corresponding `action="help"` response.

## Safety Model

Sisyphus-owned tools are designed around explicit user control:

- each notebook can be read-only, writable, deletable, or hidden from AI;
- dangerous actions such as delete, move, replace, and asset upload are treated separately;
- MCP and CLI share the same core behavior, so switching entry points does not create a second permission model;
- remote and Docker use cases go through the SiYuan HTTP API instead of assuming direct access to local workspace files.

The official MCP bridge is a separate tool source. Forwarded calls execute with the current SiYuan administrator session or API Token and do not automatically inherit the notebook permissions or dangerous-action controls above. Before enabling or invoking them, ensure that the external agent, network environment, and downstream tool are trusted.

## Future Direction And Feedback

The project will focus on improving the complete experience of connecting external agents to SiYuan, including:

- connection configuration and compatibility across popular agent products;
- HTTP, stdio, local, remote, and Docker deployments;
- discovery, synchronization, filtering, and schema footprint of official MCP tools;
- clearer call status, actionable errors, and connection recovery;
- task-oriented Skills, help, and progressive disclosure;
- real-world validation and experience comparisons across agent products.

Bug reports, experience notes, and design suggestions are welcome:

- [GitHub Issues](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/issues) for public discussion of problems, requests, and design ideas;
- the built-in `feedback` tool, which agents can call as `feedback(action="submit", description="...")`.

Do not include API tokens, secrets, private note content, or sensitive local paths in feedback.

## Read The Docs

- [Getting Started](./docs/getting-started/index.md)
- [Common Tasks](./docs/reference/common-tasks.md)
- [Tool Reference](./docs/reference/index.md)
- [Permissions](./docs/reference/permissions.md)
- [Development Guide](./docs/development/index.md)
- [中文 README](./README_zh_CN.md)

## Support

If you find this project helpful, please consider supporting it. Your support helps sustain maintenance and future Agent integration work.

### Sponsor Thanks

Thanks to **undefined**, **Fngd Z**, **ou**, **米建**, **锋🌀☁️**, **wooh** and all other kind supporters for sponsoring this project.

<p align="left">
  <img src="docs/archive/thank.jpeg" alt="Support QR code" width="280">
</p>

## License

MIT
