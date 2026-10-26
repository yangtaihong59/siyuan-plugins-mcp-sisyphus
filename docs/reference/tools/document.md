# document

`create.notebook` requires a notebook ID from `notebook.list`, not a name. If a readable notebook name is supplied, the error identifies the matching IDs so the caller can correct the argument without changing permissions.

In every mode, creation requires `notebook + path` or `notebook + parentPath + title`; use `parentPath="/"` for the notebook root. `notebook + title` alone is invalid and preflight rejects it without issuing a credential. After changing business arguments, preflight again for a new `requestId`; reuse an ID only to retry the same request.

This tool covers document CRUD, tree navigation, metadata, and daily-note oriented document operations.

When to read this page: you need to create, move, query, or convert documents.

Related pages:

- [Path Semantics](../path-semantics.md)
- [Permissions](../permissions.md)

## Common Actions

| Group | Actions |
|------|---------|
| Create and read | `create`, `lookup`, `query`, `ensure_link_targets`, `get_doc`, `get_outline` |
| Tree navigation | `get_child_blocks`, `get_child_docs`, `list_tree`, `search_docs` |
| Metadata and mutations | `rename`, `move`, `reorder`, `remove`, `set_attr`, `duplicate` |
| Daily note / conversion | `create_daily_note`, `heading_to_doc`, `doc_to_heading` |

## Parameters and Semantics

- `create` takes either a human-readable `path`, or `parentPath` + `title`; omit `markdown` to create an empty document. Prefer `path` for child documents. The `parentPath` + `title` mode accepts either a human-readable parent path or a storage path ending in `.sy` returned by `lookup`.
- `lookup` resolves by `id`, storage `path`, or human-readable `hpath` / `hPath`; use `include` to request `id`, `ids`, `path`, `hpath`, or `docInfo`.
- In strict mode, `create` / `create_daily_note` verify the returned document ID in the requested notebook. Matching paths in other notebooks are excluded from creation readback.
- `ensure_link_targets` preserves its complete `linkMap`, dispositions, and counts even with slim responses, including read-only resolution/reuse with `changed=false`. An empty `created` array does not mean no target was resolved.
- `ensure_link_targets` provisions a reusable import link map inside one exact scope: `notebook` + direct-parent `parentId`. `resolve` and `reuse` accept only explicit direct-child document IDs. `create` accepts explicit new titles, but never treats a matching existing title as identity: it reports `same_title_child_requires_explicit_id` in `unresolved` instead. Every resolved or created output includes exact `id`, notebook, storage `path`, and `hPath` readback.
- `ensure_link_targets(dryRun=true)` is valid only for `mode="create"`; it inspects and reports `wouldCreate` without mutation. `resolve` and `reuse` are read-only discovery operations. A real `create` follows the normal two-call contract: preflight with `validateOnly=true`, then exactly one request with the server-issued `requestId` and returned `expectedStructureHash`. Do not retry after an unknown transport outcome: inspect or reuse the original request ID. The action never automatically removes documents it created.
- The returned `idPath` includes available `id` / `ids`. When several documents share the same hpath, `include: ["ids"]` returns all matching IDs; the tool includes a SQL fallback.
- `rename`, `remove`, and `move` often need a storage path if you are not using document IDs.
- `rename(items:[{id,title}])` renames up to 50 documents through one bounded preflight and one ordered receipt (256 KiB serialized input limit). `items` is mutually exclusive with single-document arguments. Preflight rejects duplicate IDs, target collisions, existing sibling names, ambiguous same-level results, rename cycles, and batches with parent-child dependencies. Each item is rechecked before dispatch; the first failure or unknown stops the batch and later items are `not_started`. Completed items are never rolled back. Replaying the original `requestId` returns the original receipt without running remaining items; only proven `not_started` items may be submitted as a new preflight.
- `reorder` takes a notebook or parent-document `parentID` plus `orderedIDs`. The array must contain every visible direct child document ID exactly once. It enables custom notebook sorting (`sortMode: 6`) and does not move, rename, or edit any document.
- `get_child_docs` requires a document `id`; it does not accept `notebook + path`.
- `list_tree` uses `notebook + path`, and `path` is a storage path such as `/` or `/20240318112233-abc123.sy`, not a human-readable path.
- If bulk `remove` hits SiYuan's short `indexing` window, retry by deleting one document at a time with `notebook + storage path`.
- `set_attr` writes document metadata attributes by document ID.
- `get_outline` calls SiYuan's native outline endpoint and returns the heading tree, block IDs, nesting, and `headingCount` without reading the document body. Use `get_doc` instead when you also need editable Markdown.

## Permission-scoped document queries

`query` lists indexed documents and computes bounded statistics without accepting raw SQL. The server generates fixed SQL, restricts every input to readable notebooks before aggregation, and sends it through SiYuan's HTTP API. Other notebooks can remain `none`.

| Parameter | Meaning |
|---|---|
| `notebooks` | Optional notebook ID array; defaults to all readable, open notebooks. An explicitly requested unknown, unreadable, or closed notebook is rejected. |
| `fields` | Projection; defaults to all of `id`, `notebook`, `title`, `path`, `hpath`, `created`, `updated`, `blockCount`, `contentChars`, `sameTitleCount`. |
| `title`, `hpathPrefix` | Literal, case-sensitive title substring; notebook-local human path matching the exact path or descendants. |
| `minBlocks`, `maxBlocks`, `minChars`, `maxChars` | Inclusive nonnegative integer statistic bounds. |
| `duplicatesOnly` | Return documents whose `sameTitleCount` exceeds 1. |
| `sortBy`, `sortOrder` | `id`, `title`, `created`, `updated`, `blockCount`, `contentChars`, or `sameTitleCount`; defaults to `updated` / `desc`, with `asc` also available. |
| `page`, `pageSize` | Defaults to 1 / 50; page size is at most 100. |

`blockCount` counts non-document (`type != 'd'`) index rows, including containers. `contentChars` sums SQLite `length(content)` over those rows; it is neither native word count, UTF-8 byte size, nor deduplicated visible body characters. `sameTitleCount` counts exact matching titles in the selected notebooks and title/path scope **before** statistic bounds are applied. A matching title or size alone does not prove duplicate content.

Results use standard pagination with `total`, `hasNextPage`, and `nextSteps`; continue while another page is advertised. `scope.notebooks` identifies the queried notebooks; `scope.excludedClosedNotebooks` reports only readable closed notebooks excluded from the default scope. The index may lag recent writes, and multiple pages do not share a frozen snapshot.

Examples, each passed to the `document` tool:

```json
{"action":"query","sortBy":"blockCount","sortOrder":"desc","pageSize":50}
```

```json
{"action":"query","maxBlocks":0,"fields":["id","notebook","title","hpath","blockCount","contentChars"]}
```

```json
{"action":"query","duplicatesOnly":true,"sortBy":"sameTitleCount"}
```

```json
{"action":"query","notebooks":["<notebook-id>"],"hpathPrefix":"/Project","fields":["id","title","hpath","updated"]}
```

`maxBlocks: 0` finds title-only skeleton candidates in the index. Read candidates by exact ID before deciding to modify them.

## Markdown and Title Rules

- `create` markdown does not need a same-name leading `# Title`; if present, it is stripped to avoid duplicate visible titles.
- `create` accepts `((id 'title'))`, naked `((id))`, and `#tag#` directly. Naked refs are expanded to explicit anchors; if lookup fails, MCP falls back to `((id 'id'))` with a warning.
- `create` allows footnote-style refs such as `[^1]` and `[text](siyuan://blocks/id)`, but the result includes a hint because they do not create SiYuan backlinks.
- `get_doc` returns the same editable Markdown shape as `fs.read`, preserving `((id 'title'))` and `#tag#`.
- `get_doc mode="markdown"` tries full text by default, capped at 256 KiB UTF-8 and 2000 complete blocks. Explicit `blockStart`, `blockLimit`, and `tokenBudget` remain supported. Continue using `nextWindow`; `outlineScope="window"` and `totalBlocks=null` until EOF. A single oversized block fails explicitly. `includeBlockIds=true` adds sidecar references.
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
  "mode": "resolve",
  "targets": [{ "key": "source-index", "id": "<direct-child-document-id>" }]
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

```json
{
  "action": "ensure_link_targets",
  "notebook": "<notebook-id>",
  "parentId": "<parent-document-id>",
  "mode": "create",
  "targets": [{ "key": "source-index", "title": "New Target" }],
  "validateOnly": true
}
```

Replace placeholder IDs with actual IDs returned by the tools. `resolve`/`reuse` targets use `key` + `id`; `create` targets use `key` + `title`. Never send both `id` and `title`, or `key` alone. The create example only preflights; commit exactly once with unchanged business arguments, `validateOnly: false`, the returned `expectedStructureHash`, and the server-issued `requestId`. A same-title child is an unresolved result, not an implicit reuse.

CLI:

```bash
siyuan document create --notebook <notebook-id> --path "/Inbox/Weekly Note" --markdown "Weekly report body"
siyuan document lookup --id <doc-id> --include path
siyuan document query --max-blocks 0 --page-size 100
siyuan document reorder --parent-id <notebook-or-parent-doc-id> --ordered-ids-json '["<doc-id-1>","<doc-id-2>"]'
siyuan document ensure_link_targets --notebook <notebook-id> --parent-id <parent-document-id> --mode resolve --targets-json '[{"key":"source-index","id":"<direct-child-document-id>"}]'
siyuan document ensure_link_targets --notebook <notebook-id> --parent-id <parent-document-id> --mode reuse --targets-json '[{"key":"source-index","id":"<direct-child-document-id>"}]'
siyuan document ensure_link_targets --notebook <notebook-id> --parent-id <parent-document-id> --mode create --targets-json '[{"key":"source-index","title":"New Target"}]' --validate-only
```

## Action List

- `create`
- `lookup`
- `query`
- `ensure_link_targets`
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

See [Read scope and database guidance](../read-results.md).

### Safe document / heading conversion

Both conversion actions require strict preflight; submit the returned `preflight.commitArgs` unchanged.

- `doc_to_heading`: `srcID` must be a document without child documents. `targetID` must be an actual heading block in another document (use `get_outline`), never a document root. Self/descendant merges are rejected before writing; passing a root anchor can corrupt documents in affected kernels. `after` selects placement before/after the target heading section.
- `heading_to_doc`: `headingID` must be an actual heading. Omitted `targetPath` means `/`, the target notebook root. An explicit `targetPath` is an existing parent document's ID-based `.sy` storage path, not a title path. Alternatively, `previousPath` selects placement after an existing sibling document in `targetNotebook`; do not combine it with a non-root `targetPath`. The returned `id` is the converted heading's stable ID, now a document ID.

Invalid anchors and paths fail during preflight without invoking the native conversion. Writes with an unknown outcome must be inspected, not repeated with a new request ID.
