# SiYuan Sisyphus MCP & CLI

[English](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README.md) | [中文](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README_zh_CN.md)

> **Latest:** `v0.3.1` — CLI tool `siyuan-sisyphus` is now available on npm. All 10 aggregated tools and 115+ actions are callable directly from the terminal. See [CHANGELOG.md](./CHANGELOG.md) for full history.

> Recommended pairing: use this plugin together with [AI CLI Bridge for SiYuan](https://github.com/yangtaihong59/siyuan-plugins-ai-cli-bridge) to embed OpenClaw, OpenCode, kimi Code, and other web-based AI agent tools directly in the SiYuan sidebar.

This project provides **two ways to connect SiYuan Note to the outside world**, sharing the same capabilities (reading notes, searching, editing content, working with databases, exporting resources, etc.):

- **CLI tool `siyuan-sisyphus`**: Drive SiYuan directly from your terminal or scripts without an MCP client.
- **MCP Server Plugin**: Runs inside SiYuan so any MCP-capable agent can treat your notes as a callable toolset.

If these concepts are new to you, here is the simple version:
- **SiYuan**: your notes and data
- **This plugin**: wraps SiYuan capabilities as a CLI / MCP Server for safe external access
- **MCP**: the universal protocol between agents and external tools
- **Agent / MCP client**: OpenClaw, Claude Desktop, Codex, Cherry Studio, Cursor, etc.

---

## Permissions & Security

This plugin provides a **notebook-level permission model** that keeps AI operations within controllable boundaries.

### Permission Model

Each notebook can be configured with one of four permission states:

| Permission | Description |
|------------|-------------|
| `rwd` | Read, write, and delete |
| `rw` | Read and write, no delete |
| `r` | Read-only |
| `none` | No access |

---

## Install the SiYuan Plugin

Both CLI and MCP require this plugin to be installed in SiYuan first.

### From SiYuan Marketplace

1. Open SiYuan Note
2. Go to `Settings -> Marketplace`
3. Search for `SiYuan Sisyphus`
4. Install and enable the plugin

### From Source

```bash
git clone https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus.git
cd siyuan-plugins-mcp-sisyphus
pnpm install
pnpm run build
pnpm run make-link
```

---

## CLI Tool

A standalone command-line tool [`siyuan-sisyphus`](./cli/README.md) that connects to SiYuan via HTTP API, executes one operation, and exits — no long-running server required.

### Install CLI

```bash
npm i -g siyuan-sisyphus
```

### Usage Examples

```bash
# List notebooks
siyuan notebook list

# Create a document
siyuan document create --notebook <id> --path "/Inbox/Note" --markdown "# Hello"

# Full-text search
siyuan search fulltext --query "TODO" --json | jq '.data[].hPath'
```

All 10 aggregated tools (`notebook`, `document`, `block`, `av`, `search`, `tag`, `file`, `system`, `flashcard`, `mascot`) are exposed as subcommands, each dispatching operations via the `action` parameter.

---

## MCP Server Plugin

The plugin runs inside SiYuan and exposes SiYuan capabilities as an MCP Server for external agents.

### Supported Connection Modes

| Scenario | Recommended Mode |
|----------|-----------------|
| Desktop (Windows / macOS / Linux) | HTTP or stdio |
| Docker / Remote deployment | stdio (required) |

The plugin settings page provides three ready-to-copy configuration snippets at the bottom: HTTP connection, mcp-remote bridge, and stdio connection.

Open `Plugin` → `siyuan-plugins-mcp-sisyphus` → `Settings` → `🌐 Connection Config` to find them.

### HTTP Mode

The plugin hosts an HTTP MCP Server inside SiYuan. Clients connect to it directly.

**Plugin-side configuration:**

1. Default Host `127.0.0.1`, Port `36806` (change to `0.0.0.0` for WSL/remote)
2. Keep `Require Bearer token` enabled
3. Click `Start`, then check `Auto-start with SiYuan`

**Client configuration** (Cline, Cherry Studio, Cursor, Claude Code, etc.):

```json
{
  "mcpServers": {
    "siyuan": {
      "type": "http",
      "url": "http://127.0.0.1:36806/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

> Claude Code requires `"type": "http"`. Write this to the `mcpServers` field in `~/.claude.json`.  
> WSL / cross-machine: set Host to `0.0.0.0` and replace `127.0.0.1` in the client URL with the host IP. Always keep token auth enabled when binding to non-loopback addresses.

### stdio Mode

The client runs `mcp-server.cjs` as a subprocess, which connects to the SiYuan API via `SIYUAN_API_URL`.

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "node",
      "args": ["{SIYUAN_PATH}/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_TOKEN": "xxxxxx"
      }
    }
  }
}
```

- The settings page auto-fills the current workspace path and token
- Docker / LAN: change `SIYUAN_API_URL` to the Docker host IP; the client must be able to access `mcp-server.cjs`
- If SiYuan API auth is disabled, `SIYUAN_TOKEN` can be omitted
- `stdio` supports only one client connection at a time

> Docker deployments cannot start the plugin's built-in HTTP server from the frontend. Use stdio instead: expose the container's 6806 port, keep the SiYuan API token enabled, and restrict access with a firewall.

### mcp-remote Bridge

If your client only supports stdio but you want to bridge to the HTTP server:

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://127.0.0.1:36806/mcp",
        "--header",
        "Authorization: Bearer <token>"
      ]
    }
  }
}
```

### Verify Connection

After configuration, try a few read-only actions to confirm the link:

- "Show me the current SiYuan version" → `system(action="get_version")`
- "List my notebooks" → `notebook(action="list")`
- "Find documents with 'project' in the title" → `document(action="search_docs", ...)`

---

## Tool Reference

All capabilities are converged into **10 aggregated tools**, dispatching operations via the `action` field.

### Tool Overview

| Tool | Capabilities |
|------|-------------|
| `notebook` | CRUD, open/close, icons, permission management |
| `document` | Create, move, delete, query, tree structure, daily notes, icons/covers |
| `block` | Block-level read/write, attributes, fold/unfold, move, batch ops, word count |
| `av` | Attribute view (database) read/write, row/column ops, cell updates, search |
| `file` | Asset upload, export, template rendering, unused asset cleanup, OCR |
| `search` | Full-text search, SQL queries, backlinks, tag search, find & replace |
| `tag` | List, rename, remove tags |
| `system` | Version, time, notifications, config summary, system fonts |
| `flashcard` | List, review, create, and remove flashcards |
| `mascot` | Balance, shop, and purchases |

### Detailed Action List

#### `notebook`

| Action | Description |
|--------|-------------|
| `list` | List all notebooks |
| `create` | Create a notebook (supports `icon`, prefer Unicode hex like `1f4d4`) |
| `set_open_state` | Open or close a notebook |
| `remove` | Remove a notebook (requires confirmation) |
| `rename` | Rename a notebook |
| `get_conf` / `set_conf` | Get or set notebook configuration |
| `set_icon` | Set notebook icon |
| `get_permissions` | View all notebook MCP permissions |
| `set_permission` | Change notebook permission (`none` / `r` / `rw` / `rwd`) |
| `get_child_docs` | Get direct child documents at notebook root |

#### `document`

| Action | Description |
|--------|-------------|
| `create` | Create a document with Markdown content |
| `rename` | Rename a document |
| `remove` | Remove a document |
| `move` | Move a document |
| `set_icon` | Set document/folder icon |
| `set_cover` | Set or clear document cover image |
| `get_path` | Get storage path by document ID |
| `get_hpath` | Get human-readable path by ID or storage path |
| `get_ids` | Get document IDs by human-readable path |
| `get_child_blocks` | Get direct child blocks of a document |
| `get_child_docs` | Get direct child documents |
| `list_tree` | List nested document tree under a notebook path |
| `search_docs` | Search documents by title keyword |
| `get_doc` | Get document content and metadata by ID |
| `create_daily_note` | Create or return today's daily note for a notebook |
| `duplicate` | Duplicate an existing document |
| `remove_batch` | Batch remove documents by storage paths (requires confirmation) |
| `create_empty` | Create an empty document |
| `heading_to_doc` | Convert a heading block into a document |
| `doc_to_heading` | Convert a document into a heading under a target document |

#### `block`

| Action | Description |
|--------|-------------|
| `insert` / `prepend` / `append` | Insert a block at position / start / end |
| `update` | Update block content |
| `delete` | Delete a block |
| `move` | Move a block to a new position |
| `set_fold_state` | Fold or unfold a foldable block |
| `get_kramdown` | Get block content in kramdown format |
| `get_children` | Get direct child blocks |
| `transfer_ref` | Transfer block references |
| `set_attrs` / `get_attrs` | Set or get block attributes (including flashcard custom attrs) |
| `exists` | Check if a block exists |
| `info` | Get root document metadata for a block |
| `breadcrumb` | Get breadcrumb path for a block |
| `dom` | Get rendered DOM for a block |
| `recent_updated` | List recently updated content |
| `word_count` | Get word count for blocks |
| `batch_insert` | Insert multiple blocks at once |
| `batch_update` | Update multiple blocks at once |
| `append_daily_note` | Append a block to today's daily note |
| `prepend_daily_note` | Prepend a block to today's daily note |
| `doc_info` | Get document info for a block or document |
| `docs_info` | Batch get document info |

#### `av`

| Action | Description |
|--------|-------------|
| `get` | Read an attribute view (database) by `id` |
| `render_attribute_view` | Render database view, supports `createIfNotExist` |
| `get_attribute_view_keys` | Return attribute view column info |
| `get_attribute_view_filter_sort` | Return filter and sort config for a view |
| `search` | Search attribute views by keyword |
| `add_rows` | Bind existing blocks as database rows |
| `remove_rows` | Remove bound rows from an attribute view |
| `add_column` | Add a database column |
| `remove_column` | Remove a column from an attribute view |
| `set_cell` | Update a single cell |
| `batch_set_cells` | Update multiple cells in one call |
| `duplicate_block` | Duplicate the underlying database block |
| `get_primary_key_values` | Get primary-key row data |

#### `file`

| Action | Description |
|--------|-------------|
| `upload_asset` | Upload a local asset file (requires confirmation; >10MB requires extra confirmation) |
| `render_template` | Render a template with document context |
| `render_sprig` | Render a Sprig template |
| `export_md` | Export document as Markdown |
| `export_resources` | Export resources as ZIP (writing locally requires confirmation) |
| `list_unused_assets` | List unreferenced asset files |
| `get_doc_assets` | List assets referenced by a document |
| `get_image_ocr_text` | Read stored OCR text for an image asset |
| `remove_unused_assets` | Remove all unreferenced asset files |
| `rename_asset` | Rename an asset file |
| `delete_asset` | Delete an asset file |
| `set_image_alpha` | Update alpha for an image asset |

#### `search`

| Action | Description |
|--------|-------------|
| `fulltext` | Full-text search |
| `query_sql` | Execute read-only SQL (SELECT / WITH only) |
| `search_tag` | Search tags by keyword |
| `get_backlinks` | Find documents/blocks that reference a given block |
| `get_backmentions` | Find documents/blocks that mention a block name |
| `search_refs` | Search blocks referencing a given block or document |
| `find_replace` | Find and replace text (requires confirmation) |
| `search_assets` | Search asset files by filename |
| `get_asset_content` | Get a specific asset-content record |
| `fulltext_asset_content` | Full-text search indexed asset contents |
| `list_invalid_refs` | List invalid block references |

#### `tag`

| Action | Description |
|--------|-------------|
| `list` | List workspace tags |
| `rename` | Rename a tag |
| `remove` | Remove a tag |

#### `system`

| Action | Description |
|--------|-------------|
| `push_msg` / `push_err_msg` | Push notification or error message |
| `get_version` / `get_current_time` | Get version or current time |
| `workspace_info` | Get workspace metadata (disabled by default) |
| `network` | Get masked network proxy info |
| `changelog` | Get current version changelog |
| `conf` | Get masked system configuration |
| `sys_fonts` | List available system fonts |
| `boot_progress` | Get current boot progress details |

#### `flashcard`

| Action | Description |
|--------|-------------|
| `list_cards` | List due flashcards, filterable by scope and status |
| `get_decks` | List available flashcard decks |
| `get_cards` | Paginated list of all cards in a deck |
| `review_card` | Submit a review result |
| `skip_review_card` | Skip current flashcard in review flow |
| `create_card` | Turn existing blocks into flashcards |
| `add_card` | Run riff registration for deck-bound blocks |
| `remove_card` | Remove blocks from a flashcard deck (requires confirmation) |

#### `mascot`

| Action | Description |
|--------|-------------|
| `get_balance` | Get mascot's current spendable balance |
| `shop` | List mascot shop inventory |
| `buy` | Buy a mascot shop item |

Every successful MCP tool call earns the mascot 1 coin. `get_balance` also returns the lifetime earned count.

---

## Design: Progressive Disclosure

Complexity is revealed only when needed, rather than flooding the AI with everything upfront.

**① Tool Description Layer**: Detailed descriptions for high-frequency common actions and their required fields. Low-frequency or high-risk advanced actions are listed by name only, with pointers to on-demand documentation.

**② Help Layer**: Each action's detailed docs live in the `siyuan://help/action/{tool}/{action}` resource; call `action: "help"` for inline help (fallback for clients without resource support).

**③ Response Layer**: Large result sets are automatically summarized:

| Scenario | Behaviour |
|----------|-----------|
| `search.fulltext` > 20 results | Truncated + `page`/`pageSize` hint |
| `search.query_sql` > 50 rows | Truncated + `LIMIT`/`OFFSET` hint |
| `block.get_children` > 50 children | Truncated + `query_sql` filter hint |
| `document.list_tree` deep nodes | Collapsed to depth=3, expandable via `maxDepth` |
| `document.get_doc` > 8,000 chars | Truncated + `get_child_blocks` hint |

---

## Troubleshooting

### Agent cannot see the tools

- **HTTP mode**: confirm the settings panel shows `Running`; check URL and token
- **stdio mode**: verify the path points to `mcp-server.cjs`; restart the client after config changes

### Connected, but calls fail

- **HTTP mode**: SiYuan API token is forwarded automatically by the plugin; check that SiYuan is running normally
- **stdio mode**: check `SIYUAN_API_URL` and `SIYUAN_TOKEN`
- Check whether the target notebook permission is set to `r` or `none`

### Why does the agent ask for confirmation?

This is by design. High-risk actions such as delete, move, local file upload, or permission changes require user confirmation.

---

## Development

Live smoke test against a local SiYuan instance:

```bash
pnpm run build
node scripts/live_mcp_smoke.cjs
```

Project structure:

```text
siyuan-plugins-mcp-sisyphus/
├── src/
│   ├── api/           # SiYuan API wrappers
│   ├── cli/           # CLI source
│   ├── mcp/           # MCP server implementation
│   │   ├── tools/     # Aggregated tool handlers
│   │   ├── config.ts  # Config and migration helpers
│   │   ├── server.ts  # Main server
│   │   └── types.ts   # Action-level validation
│   └── index.ts       # Plugin entry point
├── cli/               # Standalone CLI npm sub-package
├── public/i18n/       # Internationalization
└── package.json
```

OpenClaw / mcporter users can follow [SKILL.md](./skills/siyuan-mcp-sisyphus/SKILL.md).

Detailed API ↔ MCP mapping: [API_MCP_MAPPING.md](./API_MCP_MAPPING.md)

## License

MIT
