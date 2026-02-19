# SiYuan MCP Sisyphus

[English](./README.md) | [中文](./README_zh_CN.md)

MCP server for SiYuan Note. Provides 41 tools for AI integration with SiYuan through the Model Context Protocol.

## Features

- **Complete SiYuan Note API Support**: Access all major SiYuan APIs through MCP (except SQL)
- **41 Tools Available**: Full coverage of notebook, document, block, and file operations

## ⚠️ Important Notes

### High-Risk Operations and Confirmation

The MCP server sends **Server Instructions** to AI, requiring that the following operations **must be explained to the user and wait for confirmation** before execution. Do not call them without user confirmation (Note: This depends on the AI, and this tool is not responsible for consequences of dangerous operations):

- **Delete operations**: `remove_notebook`, `remove_document`, `remove_document_by_id`, `delete_block`
- **Move operations**: `move_documents`, `move_documents_by_id`, `move_block`

If your client supports and displays MCP instructions, the AI will first ask "I will execute X. Proceed?" and only call the tool after user confirmation. You can also emphasize these conventions in your project or Cursor rules.

**❕ We also provide toggle buttons for all tools in the settings. If you are concerned, you can disable them in the settings.**

## Installation

### From SiYuan Marketplace

1. Open SiYuan Note
2. Go to Settings > Marketplace
3. Search for "SiYuan MCP"
4. Install and enable the plugin

### From Source

```bash
# Clone the repository
git clone https://github.com/your-repo/siyuan-plugins-mcp-sisyphus.git

# Install dependencies
pnpm install

# Build
pnpm run build

# Link for development
pnpm run make-link
```

## Usage

### MCP Client Configuration

Configure the MCP server in your preferred client. Any client supporting the MCP stdio protocol can connect using:

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "node",
      "args": ["/absolute/path/SiYuan/data/plugins/siyuan-mcp-sisyphus/mcp-server.cjs"]
    }
  }
}
```

## Available Tools

### Notebook Operations (8 tools)

| Tool | Description |
|------|-------------|
| `list_notebooks` | List all notebooks in the workspace |
| `create_notebook` | Create a new notebook |
| `open_notebook` | Open a notebook |
| `close_notebook` | Close a notebook |
| `remove_notebook` | Remove a notebook |
| `rename_notebook` | Rename a notebook |
| `get_notebook_conf` | Get notebook configuration |
| `set_notebook_conf` | Set notebook configuration |

### Document Operations (11 tools)

| Tool | Description |
|------|-------------|
| `create_document` | Create a new document with markdown content |
| `rename_document` | Rename a document by path |
| `rename_document_by_id` | Rename a document by ID |
| `remove_document` | Remove a document by path |
| `remove_document_by_id` | Remove a document by ID |
| `move_documents` | Move multiple documents to a new location |
| `move_documents_by_id` | Move multiple documents by ID |
| `get_document_path` | Get file path by document ID |
| `get_hpath_by_path` | Get hierarchical path by file path |
| `get_hpath_by_id` | Get hierarchical path by document ID |
| `get_ids_by_hpath` | Get document IDs by hierarchical path |

### Block Operations (13 tools)

| Tool | Description |
|------|-------------|
| `insert_block` | Insert a new block at specified position |
| `prepend_block` | Insert a block at the beginning of parent |
| `append_block` | Insert a block at the end of parent |
| `update_block` | Update block content |
| `delete_block` | Delete a block |
| `move_block` | Move a block to new position |
| `fold_block` | Fold a block (collapse children) |
| `unfold_block` | Unfold a block (expand children) |
| `get_block_kramdown` | Get block content in kramdown format |
| `get_child_blocks` | Get all child blocks of a parent |
| `transfer_block_ref` | Transfer block references |
| `set_block_attrs` | Set block attributes |
| `get_block_attrs` | Get block attributes |

### File Operations (9 tools)

| Tool | Description |
|------|-------------|
| `upload_asset` | Upload file to assets directory |
| `render_template` | Render a template with document context |
| `render_sprig` | Render a Sprig template |
| `export_md_content` | Export document as Markdown |
| `export_resources` | Export resources as ZIP |
| `push_msg` | Push a notification message |
| `push_err_msg` | Push an error message |
| `get_version` | Get SiYuan version |
| `get_current_time` | Get current system time |

## Development

### Project Structure

```
siyuan-plugins-mcp-sisyphus/
├── src/
│   ├── api/           # SiYuan API wrappers
│   ├── mcp/           # MCP server implementation
│   │   ├── tools/     # Tool implementations
│   │   ├── server.ts  # Main server
│   │   └── types.ts   # Type definitions
│   └── index.ts       # Plugin entry point
├── public/i18n/       # Internationalization
└── package.json
```

## License

MIT

