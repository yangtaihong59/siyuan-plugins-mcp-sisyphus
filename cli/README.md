# siyuan-sisyphus

[English](./README.md) | [中文](./README_zh_CN.md)

> ⚠️ **Prerequisite: This CLI requires the `siyuan-plugins-mcp-sisyphus` plugin from this repo.** Install and enable the plugin in SiYuan first, then open the plugin settings panel and configure permissions before running CLI tool commands. The CLI now checks this requirement and will fail fast if the plugin is missing or not initialized.

Direct command-line control for [SiYuan Note](https://b3log.org/siyuan). Think of it like `obsidian-cli` but for SiYuan — every MCP tool (fs, block, document, notebook, av, search, tag, file, timeline, system, flashcard, extension, mascot, feedback) is exposed as a subcommand you can call directly from a shell.

> **Latest:** `v0.2.6` exposes the expanded guarded AV, snapshot, image-audit, image-reading, extension-diagnostic, and link-resolution workflows, and preserves mixed text/image results in JSON output. Thanks to [@LoneFireBlossom](https://github.com/LoneFireBlossom) for [PR #48](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/pull/48) and PRs #50–#56, [@ray24777](https://github.com/ray24777) for [PR #57](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/pull/57), and [@adminclaw](https://github.com/adminclaw) for [PR #58](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/pull/58).

> **For AI models and coding agents:** before doing any SiYuan work with this CLI, run `siyuan-sisyphus skill install` first. The bundled skills provide the task-specific operating rules for safe search, reading, editing, export, database, tag, flashcard, timeline, and system workflows.

The published npm package is `siyuan-sisyphus`. It installs the primary command `siyuan-sisyphus`, and also provides the shorter alias `sisyphus` to avoid colliding with SiYuan's official CLI.

```bash
siyuan-sisyphus notebook list
siyuan-sisyphus document create --notebook 20240318... --path "/Inbox/Test" --markdown "Hello"
siyuan-sisyphus block append --parent-id 20240318abc --data-type markdown --data "- item"
siyuan-sisyphus search fulltext --query "keyword" --page-size 10 --json | jq '.data[].hPath'
```

## Requirements

- Node.js 18+
- A running SiYuan instance reachable over HTTP (local or remote)
- The SiYuan API token (`SiYuan > Settings > About > API token`)

## Strict safe writes

Strict safe writes are enabled by default in the plugin under Settings → MCP → Settings & Debug. Mutation commands first run the action with `validateOnly=true`, then submit a fresh UUIDv7 `requestId` and the returned `expected*Hash`. The returned value is a temporary in-memory lease credential, normally beginning with four hexadecimal characters; it is never used as a 16-bit state comparison because the HTTP coordinator resolves it to the leased full SHA-256 and compares that full hash with a fresh read before writing.

Keep the plugin-hosted MCP HTTP server enabled while using strict CLI mutations. The CLI forwards these writes to that single coordinator so CLI, stdio, and HTTP do not create independent lease pools. Expired, consumed, or restart-invalidated leases require a new preflight. Turning strict writes off restores the legacy direct-call contract without hash concurrency checks, request idempotency, or post-write verification.

## Install

```bash
# Global install; this installs both `siyuan-sisyphus` and `sisyphus`
npm i -g siyuan-sisyphus

# Or run once without installing
npx -p siyuan-sisyphus siyuan-sisyphus --help
```

## Quick start

```bash
siyuan-sisyphus init
# …answer the prompts (profile name + API URL + token). This writes ~/.siyuan-sisyphus/config.json (0600).

siyuan-sisyphus skill install # agents/models should do this before further work
siyuan-sisyphus notebook list  # verify connectivity
siyuan-sisyphus config list    # see saved profiles
siyuan-sisyphus list           # see all available tools
siyuan-sisyphus list block     # see all actions for a tool
siyuan-sisyphus help block append
```

## Agent skill bundles

The npm package carries two related skill bundles:

- `cli` uses terminal command examples and is still the default for `skill list`, `skill read`, and `skill install`.
- `mcp` uses MCP tool-call examples for agents that connect through the plugin server.

```bash
siyuan-sisyphus skill list --bundle mcp
siyuan-sisyphus skill read siyuan-mcp-browse-read --bundle mcp
siyuan-sisyphus skill install --bundle mcp
siyuan-sisyphus skill install --bundle all
```

Use `--bundle all` to install both sets. Regular MCP clients do not need this local installation: they can read `siyuan://skills/index` and `siyuan://skills/{name}` directly from the server, or explicitly invoke a matching MCP prompt. Prompts are not automatically activated. For exact, current action parameters, use `siyuan://help/action/{tool}/{action}`; skills focus on workflow and safety.

## Command shape

```
siyuan-sisyphus <tool> <action> [--flag value ...]   Execute any MCP tool-action
siyuan-sisyphus list [tool]                          List tools or a tool's actions
siyuan-sisyphus help <tool> [action]                 Detailed help for a tool or action
siyuan-sisyphus init                                 Interactive config setup
siyuan-sisyphus config list|get|set|use ...          Manage saved SiYuan profiles
siyuan-sisyphus skill list|read|install [--bundle cli|mcp|all]
                                                     Inspect or install agent skills
siyuan-sisyphus --help | -h                          Top-level help
siyuan-sisyphus --version | -v                       Print version
```

### Flag conventions

- **Kebab, camel, or snake**: `--parent-id`, `--parentID`, `--parentId`, and `--item_id` all map to the schema field they spell.
- **Action names**: `set_open_state` or `set-open-state` — either form works.
- **Booleans**: `--opened` (true), `--opened=false`, or `--no-opened` (false).
- **Arrays**: repeat the flag (`--ids a --ids b`), use comma-separated (`--ids a,b`), or pass exact JSON with `--<key>-json '["a","b"]'`.
- **Complex objects**: use a JSON sidecar flag such as `--assets-json '[{...}]'`.
- **`-json` precedence**: if both plain flags and `--<key>-json` are provided, the JSON sidecar wins.

### Global flags

| Flag | Purpose |
|---|---|
| `--config <file>` | Load config from `<file>` instead of `~/.siyuan-sisyphus/config.json` |
| `--profile <name>` | Use a saved profile for this invocation |
| `--url <url>` | Override SiYuan API URL |
| `--token <token>` | Override SiYuan API token |
| `--json` | Emit compact single-line JSON (for scripting with `jq`, etc.) |
| `--debug` | Include stack traces and ignored-flag warnings |

For mixed-content actions such as `file read-image`, human-readable mode prints the metadata summary. `--json` also preserves non-text MCP content under `content`; image payloads are base64-encoded and can be large.

### Paging

Paginated results use the same `page` / `pageSize` contract as the MCP tools. In an interactive terminal, human-readable output shows the full current MCP page and lets you browse pages without switching to JSON:

- Press `Enter` or `n` for the next page.
- Press `p` for the previous page.
- Press `q`, `Esc`, or `Ctrl+C` to quit paging.

For pipes and scripts, keep pagination explicit with `--page`, `--page-size`, and `--json`.

Long Markdown reads such as `fs read` and `document get-doc` use complete display-block windows instead of character slices. Continue from the returned `nextWindow` with `--block-start`, and tune the window with `--block-limit` or `--token-budget` when needed:

```bash
siyuan-sisyphus fs read --path "/Notebook/Long Note" --block-start 0 --block-limit 24
siyuan-sisyphus document get-doc --id 20240318xyz --block-start 24 --token-budget 6000
```

## Examples

```bash
# Notebooks
siyuan-sisyphus notebook list
siyuan-sisyphus --profile work notebook list
siyuan-sisyphus notebook create --name "Work" --icon 1f4d4

# Documents
siyuan-sisyphus document create --notebook 20240318... --path "/Inbox/Daily" --markdown "# Today"
siyuan-sisyphus document list-tree --notebook 20240318... --max-depth 2
siyuan-sisyphus document get-doc --id 20240318xyz --mode markdown

# Blocks
siyuan-sisyphus block info --id 20240318xyz
siyuan-sisyphus block append --parent-id 20240318abc --data-type markdown --data "- new item"
siyuan-sisyphus block get-kramdown --id 20240318xyz
siyuan-sisyphus block word-count --id 20240318xyz

# Search
siyuan-sisyphus search fulltext --query "TODO" --page-size 20
siyuan-sisyphus search fulltext --query "TODO" --page 2 --page-size 20
siyuan-sisyphus search query-sql --stmt "SELECT id, content FROM blocks WHERE type='h' LIMIT 5"

# Timeline diff (keep the returned tag and fresh changeKey)
siyuan-sisyphus timeline list-nodes --scope document --document-id 20240318xyz
siyuan-sisyphus timeline create-node --name "Before revision" --scope document --document-id 20240318xyz
siyuan-sisyphus timeline compare-node --document-id 20240318xyz --tag <timeline-tag> --page-size 20

# Friendly aliases
siyuan-sisyphus fs replace --path "/Notebook/Doc" --old A --new B
siyuan-sisyphus av render --av-id <attribute-view-id>
siyuan-sisyphus file upload-asset --file /private/tmp/demo.txt

# Piping to jq
siyuan-sisyphus notebook list --json | jq '.[] | select(.closed==false) | .name'
siyuan-sisyphus document search-docs --notebook <id> --query "proposal" --json | jq '.data[].hPath'
```

## Configuration

Precedence: **`--url`/`--token` > `--profile` > environment variable > active config profile > default**.

### Environment variables

| Variable | Purpose |
|---|---|
| `SIYUAN_API_URL` | SiYuan base URL (default `http://127.0.0.1:6806`) |
| `SIYUAN_TOKEN` | SiYuan API token |

### Profile commands

```bash
siyuan-sisyphus config list
siyuan-sisyphus config set work --url http://127.0.0.1:6807 --token <siyuan-token>
siyuan-sisyphus config use work
siyuan-sisyphus config get work
siyuan-sisyphus --profile default notebook list
```

### Config file shape (`~/.siyuan-sisyphus/config.json`)

```json
{
  "currentProfile": "default",
  "profiles": {
    "default": {
      "apiUrl": "http://127.0.0.1:6806",
      "token": "<siyuan-token>"
    },
    "work": {
      "apiUrl": "http://127.0.0.1:6807",
      "token": "<siyuan-token>"
    }
  }
}
```

Older single-endpoint files with top-level `apiUrl` and `token` are still read as the `default` profile.

## Relation to the SiYuan plugin

The CLI and the SiYuan plugin (`siyuan-plugins-mcp-sisyphus`) share the same tool-handler code under the hood, but the two entry points are independent:

- The **plugin** runs an MCP server inside SiYuan and talks to AI clients over stdio/HTTP (configured in the plugin's settings panel).
- The **CLI** connects to SiYuan over the HTTP API and executes one operation per invocation — no server, no long-running process.

If you already used the older config path `~/.siyuan-mcp/config.json`, the CLI still reads it as a fallback until you create a new config under `~/.siyuan-sisyphus/config.json`.

The CLI respects the same plugin UI configuration as MCP clients: disabled tools/actions are hidden from `list`/`help` and cannot be executed. Notebook-level permissions are also enforced by reading the same `/data/storage/petal/...` configuration through the API.

## License

MIT © Taihong Yang
