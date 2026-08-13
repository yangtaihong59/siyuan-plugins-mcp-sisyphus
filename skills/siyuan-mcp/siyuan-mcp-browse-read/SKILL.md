---
name: siyuan-mcp-browse-read
description: MCP playbook for browsing and reading SiYuan notes. Use for notebooks, document trees, human-readable paths, IDs, storage paths, block content, and read-only discovery.
---

# Browse and Read SiYuan with MCP

Start with `fs` and human-readable paths. Drop to document or block actions only when IDs, storage paths, metadata, or block structure are required.

## Discovery workflow

```text
notebook(action="list")
```
```text
fs(action="ls", path="/")
```
```text
fs(action="tree", path="/Notebook/Folder", maxDepth=4)
```
```text
fs(action="read", path="/Notebook/Folder/Doc", blockStart=0, blockLimit=50, tokenBudget=2000)
```

Use search-assisted discovery when the path is unknown:

```text
fs(action="search", path="/Notebook", query="keyword", page=1, pageSize=20)
```
```text
search(action="fulltext", query="keyword", page=1, pageSize=20)
```

## Low-level reads

```text
document(action="lookup", id="<doc-id>", include=["path","hpath","notebook"])
```
```text
document(action="get_doc", id="<doc-id>", mode="markdown")
```
```text
block(action="get_kramdown", id="<block-id>")
```

## Path semantics

| Value | Example | Typical use |
| --- | --- | --- |
| Workspace path | `/Notebook/Folder/Doc` | `fs` actions |
| Notebook-local hpath | `/Folder/Doc` | document create or lookup with notebook |
| Storage path | `/20260712123000-abc123.sy` | low-level rename, remove, or move |

Never derive a storage path from a title. Resolve the document first and reuse the returned path. For `fs.read` and Markdown `document.get_doc`, treat `hasNextWindow=true` as incomplete data and continue with the returned `nextWindow`. For list and search results, continue with explicit `page` and `pageSize` values.

Discovery identifies candidates; it does not authorize a write. Before changing one result, reread it by stable ID or resolved path and record the exact target. If a read is incomplete, continue the bounded window or page sequence instead of deciding from a truncated response.
