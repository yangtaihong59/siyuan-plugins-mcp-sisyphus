# document

This tool covers document CRUD, tree navigation, metadata, and daily-note oriented document operations.

When to read this page: you need to create, move, query, or convert documents.

Related pages:

- [Path Semantics](../path-semantics.md)
- [Permissions](../permissions.md)

## Common Actions

| Group | Actions |
|------|---------|
| Create and read | `create`, `lookup`, `ensure_link_targets`, `get_doc`, `get_outline` |
| Tree navigation | `get_child_blocks`, `get_child_docs`, `list_tree`, `search_docs` |
| Metadata and mutations | `rename`, `move`, `remove`, `set_attr`, `duplicate` |
| Daily note / conversion | `create_daily_note`, `heading_to_doc`, `doc_to_heading` |

## Parameters and Semantics

- `create` takes either a human-readable `path`, or `parentPath` + `title`; omit `markdown` to create an empty document. Prefer `path` for child documents. The `parentPath` + `title` mode accepts either a human-readable parent path or a storage path ending in `.sy` returned by `lookup`.
- `lookup` resolves by `id`, storage `path`, or human-readable `hpath` / `hPath`; use `include` to request `id`, `ids`, `path`, `hpath`, or `docInfo`.
- `ensure_link_targets` provisions a reusable import link map inside one exact scope: `notebook` + direct-parent `parentId`. `resolve` and `reuse` accept only explicit direct-child document IDs. `create` accepts explicit new titles, but never treats a matching existing title as identity: it reports `same_title_child_requires_explicit_id` in `unresolved` instead. Every resolved or created output includes exact `id`, notebook, storage `path`, and `hPath` readback.
- `ensure_link_targets(dryRun=true)` is valid only for `mode="create"`; it inspects and reports `wouldCreate` without mutation. `resolve` and `reuse` are read-only discovery operations. A real `create` follows the normal two-call contract: preflight with `validateOnly=true`, then exactly one request with a fresh UUIDv7 `requestId` and returned `expectedStructureHash`. Do not retry after an unknown transport outcome: inspect or reuse the original request ID. The action never automatically removes documents it created.
- The returned `idPath` includes available `id` / `ids`. When several documents share the same hpath, `include: ["ids"]` returns all matching IDs; the tool includes a SQL fallback.
- `rename`, `remove`, and `move` often need a storage path if you are not using document IDs.
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
- Never use a title search result as a link target. Re-run `ensure_link_targets` in `resolve` or `reuse` mode with the exact ID returned by an earlier successful result.

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

```json
{
  "action": "ensure_link_targets",
  "notebook": "<notebook-id>",
  "parentId": "<parent-document-id>",
  "mode": "reuse",
  "targets": [{ "key": "source-index", "id": "<direct-child-document-id>" }]
}
```

For a new target, call the same action first with `mode: "create"` and `validateOnly: true`, then commit exactly once using the returned `expectedStructureHash`, a fresh UUIDv7 `requestId`, and an explicit title target. A same-title child is an unresolved result, not an implicit reuse.

CLI:

```bash
siyuan document create --notebook <notebook-id> --path "/Inbox/Weekly Note" --markdown "Weekly report body"
siyuan document lookup --id <doc-id> --include path
siyuan document ensure_link_targets --notebook <notebook-id> --parent-id <parent-document-id> --mode reuse --targets-json '[{"key":"source-index","id":"<direct-child-document-id>"}]'
```

## Action List

- `create`
- `lookup`
- `ensure_link_targets`
- `rename`
- `remove`
- `move`
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
