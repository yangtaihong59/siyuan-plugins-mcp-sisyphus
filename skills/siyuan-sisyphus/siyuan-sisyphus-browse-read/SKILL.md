---
name: siyuan-sisyphus-browse-read
description: CLI-only playbook for browsing and reading SiYuan notes with siyuan-sisyphus. Use for notebooks, document trees, human-readable paths, IDs, storage paths, block content, and read-only discovery.
---

# Browse and Read SiYuan with the CLI

Start with `fs` and human-readable paths. Drop to document or block actions only when IDs, storage paths, metadata, or block structure are required.

## Discovery workflow

```bash
siyuan-sisyphus notebook list --json
```
```bash
siyuan-sisyphus fs ls --path '/' --json
```
```bash
siyuan-sisyphus fs tree --path '/Notebook/Folder' --max-depth '4' --json
```
```bash
siyuan-sisyphus fs read --path '/Notebook/Folder/Doc' --block-start '0' --block-limit '50' --token-budget '2000' --json
```

Use search-assisted discovery when the path is unknown:

```bash
siyuan-sisyphus fs search --path '/Notebook' --query 'keyword' --page '1' --page-size '20' --json
```
```bash
siyuan-sisyphus search fulltext --query 'keyword' --page '1' --page-size '20' --json
```

## Low-level reads

```bash
siyuan-sisyphus document lookup --id '<doc-id>' --include-json '["path","hpath","notebook"]' --json
```
```bash
siyuan-sisyphus document get-doc --id '<doc-id>' --mode 'markdown' --json
```
```bash
siyuan-sisyphus block get-kramdown --id '<block-id>' --json
```

## Path semantics

| Value | Example | Typical use |
| --- | --- | --- |
| Workspace path | `/Notebook/Folder/Doc` | `fs` actions |
| Notebook-local hpath | `/Folder/Doc` | document create or lookup with notebook |
| Storage path | `/20260712123000-abc123.sy` | low-level rename, remove, or move |

Never derive a storage path from a title. Resolve the document first and reuse the returned path. For `fs.read` and Markdown `document.get_doc`, treat `hasNextWindow=true` as incomplete data and continue with the returned `nextWindow`. For list and search results, continue with explicit `page` and `pageSize` values.

Discovery identifies candidates; it does not authorize a write. Before changing one result, reread it by stable ID or resolved path and record the exact target. If a read is incomplete, continue the bounded window or page sequence instead of deciding from a truncated response.
