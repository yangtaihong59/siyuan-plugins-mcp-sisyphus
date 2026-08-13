---
name: siyuan-mcp-search-query
description: MCP playbook for finding and querying SiYuan content. Use for fulltext, semantic search, read-only SQL, backlinks, references, assets, dynamic query blocks, and safe find-replace.
---

# Search and Query SiYuan with MCP

Search to identify candidates, read the target by ID or path, and only then edit. Use explicit pagination for repeatable results.

```text
search(action="fulltext", query="keyword", page=1, pageSize=20)
```
```text
search(action="semantic", query="concept or meaning", typeShortcodes=["h","p"], page=1, pageSize=20)
```
```text
search(action="fulltext", query="keyword", parentId="<doc-id>", typeShortcodes=["h","p"])
```
```text
search(action="query_sql", stmt="SELECT id, hpath, content FROM blocks WHERE type = 'p' ORDER BY updated DESC LIMIT 10")
```
```text
search(action="get_backlinks", id="<block-or-doc-id>", mode="both")
```
```text
search(action="search_refs", id="<block-id>", beforeLen=512)
```
```text
search(action="search_assets", query="diagram", exts=["png","jpg","webp"])
```

SQL must be read-only and must include `LIMIT`. Useful tables include `blocks`, `blocks_fts`, `attributes`, `refs`, `spans`, and `assets`.

## Find and replace

This action mutates content. First search, read each target, show the exact old/new text and IDs, and obtain explicit approval.

```text
search(action="find_replace", k="old text", r="new text", ids=["<doc-id>"])
```

Read the changed blocks again. Recent writes can take time to enter the search index; verify a fresh mutation by ID or path rather than assuming an empty search means failure. Use `siyuan://help/action/search/query_sql` for live SQL action constraints.
