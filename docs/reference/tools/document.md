# document

This tool covers document CRUD, tree navigation, metadata, and daily-note oriented document operations.

When to read this page: you need to create, move, query, or convert documents.

Related pages:

- [Path Semantics](../path-semantics.md)
- [Permissions](../permissions.md)

## Common Actions

| Group | Actions |
|------|---------|
| Create and read | `create`, `lookup`, `get_doc`, `get_outline` |
| Tree navigation | `get_child_blocks`, `get_child_docs`, `list_tree`, `search_docs` |
| Metadata and mutations | `rename`, `move`, `reorder`, `remove`, `set_attr`, `duplicate` |
| Daily note / conversion | `create_daily_note`, `heading_to_doc`, `doc_to_heading` |

## Parameters and Semantics

- `create` takes either a human-readable `path`, or `parentPath` + `title`; omit `markdown` to create an empty document. Prefer `path` for child documents. The `parentPath` + `title` mode accepts either a human-readable parent path or a storage path ending in `.sy` returned by `lookup`.
- `lookup` resolves by `id`, storage `path`, or human-readable `hpath` / `hPath`; use `include` to request `id`, `ids`, `path`, `hpath`, or `docInfo`.
- The returned `idPath` includes available `id` / `ids`. When several documents share the same hpath, `include: ["ids"]` returns all matching IDs; the tool includes a SQL fallback.
- `rename`, `remove`, and `move` often need a storage path if you are not using document IDs.
- `reorder` takes a notebook or parent-document `parentID` plus `orderedIDs`. The array must contain every visible direct child document ID exactly once. It enables custom notebook sorting (`sortMode: 6`) and does not move, rename, or edit any document.
- `get_child_docs` requires a document `id`; it does not accept `notebook + path`.
- `list_tree` uses `notebook + path`, and `path` is a storage path such as `/` or `/20240318112233-abc123.sy`, not a human-readable path.
- If bulk `remove` hits SiYuan's short `indexing` window, retry by deleting one document at a time with `notebook + storage path`.
- `set_attr` writes document metadata attributes by document ID.
- `get_outline` calls SiYuan's native outline endpoint and returns the heading tree, block IDs, nesting, and `headingCount` without reading the document body. Use `get_doc` instead when you also need editable Markdown.

## Markdown and Title Rules

- `create` markdown does not need a same-name leading `# Title`; if present, it is stripped to avoid duplicate visible titles.
- `create` accepts `((id 'title'))`, naked `((id))`, and `#tag#` directly. Naked refs are expanded to explicit anchors; if lookup fails, MCP falls back to `((id 'id'))` with a warning.
- `create` allows footnote-style refs such as `[^1]` and `[text](siyuan://blocks/id)`, but the result includes a hint because they do not create SiYuan backlinks.
- `get_doc` returns the same editable Markdown shape as `fs.read`, preserving `((id 'title'))` and `#tag#`.
- `get_doc mode="markdown"` always returns complete display-block windows. Continue with `nextWindow` or use `blockStart`, `blockLimit`, and `tokenBudget`; the response also includes a full heading `outline`. `includeBlockIds=true` adds sidecar block references without changing `content`.
- Character `page/pageSize` pagination has been removed. `mode="html"` remains the unpaginated current-view HTML path and continues to use `size`.

## Safety Rules

- `remove` and `move` require explicit confirmation.
- Always resolve document path type before mutating by path.

## Examples

MCP:

```json
{
  "action": "create",
  "notebook": "<notebook-id>",
  "path": "/Inbox/Weekly Note",
  "markdown": "Weekly report body"
}
```

```json
{
  "action": "lookup",
  "id": "<doc-id>",
  "include": "path"
}
```

CLI:

```bash
siyuan document create --notebook <notebook-id> --path "/Inbox/Weekly Note" --markdown "Weekly report body"
siyuan document lookup --id <doc-id> --include path
siyuan document reorder --parent-id <notebook-or-parent-doc-id> --ordered-ids-json '["<doc-id-1>","<doc-id-2>"]'
```

## Action List

- `create`
- `lookup`
- `rename`
- `remove`
- `move`
- `reorder`
- `get_child_blocks`
- `get_child_docs`
- `set_attr`
- `list_tree`
- `search_docs`
- `get_doc`
- `get_outline`
- `create_daily_note`
- `duplicate`
- `heading_to_doc`
- `doc_to_heading`
