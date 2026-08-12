# Common Tasks

This page maps common goals to MCP payloads and CLI commands.

When to read this page: you know the task but not the tool name yet.

Related pages:

- [Reference Home](./index.md)
- [Tools Index](./tools/index.md)

## Choose the write path before editing

For Sisyphus-owned mutations, keep Strict Safe Writes enabled and use the same action with `validateOnly=true` first when its schema exposes a precondition. Submit the returned short credential with a fresh UUIDv7 `requestId`; a successful response is verified by bounded readback and a metadata-only idempotency ledger. This is a process-level coordination protocol, not a SiYuan kernel transaction or automatic rollback. The UI, another plugin, direct kernel calls, exports, sync, notifications, feedback, and official `extension` calls remain outside that guarantee.

MCP/Agent calls over the plugin HTTP server use the coordinator directly. Strict mutation calls received over stdio or from the standalone CLI are forwarded to that same plugin-hosted coordinator; they do not get a second local queue or lease pool. If the plugin HTTP coordinator is unavailable, stop and repair that path rather than retrying the mutation through an uncoordinated route. Read-only actions and external-effect actions follow their own paths.

## List notebooks

```json
{ "action": "list" }
```

```bash
siyuan notebook list
```

## Create a document

```json
{
  "action": "create",
  "notebook": "<notebook-id>",
  "path": "/Inbox/Note",
  "markdown": "Hello"
}
```

```bash
siyuan document create --notebook <notebook-id> --path "/Inbox/Note" --markdown "Hello"
```

Do not repeat the document title as a leading `# Note` in `markdown`. `document.create` and `fs.write` strip a matching leading H1 automatically to avoid duplicate titles; a different leading H1 is preserved.

Use `document.create` when you need the document ID immediately. Use `fs.write` when a human-readable path is enough. Both accept real tags and block refs directly in Markdown:

```json
{
  "action": "create",
  "notebook": "<notebook-id>",
  "path": "/Inbox/Linked Note",
  "markdown": "Related ((20260610000000-abcdefg 'Full title')) #research/todo#"
}
```

Naked refs such as `((id))` are resolved before writing and expanded to `((id 'anchor'))`. If anchor lookup fails, MCP falls back to `((id 'id'))` with a warning. Footnote-style refs and `siyuan://blocks` Markdown links are allowed, but results include hints because they do not create SiYuan backlinks.

## Edit existing content

Current builds can use `fs.replace` or `block.replace` directly on paragraphs containing tags and block refs. External DOM injection scripts are not required.

```json
{
  "action": "replace",
  "path": "/Inbox/Linked Note",
  "edit": {
    "old": "Related ((20260610000000-abcdefg 'Full title')) #research/todo#",
    "new": "Done ((20260610000000-abcdefg 'Full title')) #research/done#"
  }
}
```

Verified safe cases include replacing a whole paragraph containing a block ref, replacing a whole paragraph containing a tag, replacing a full `#tag#` token with plain text, and the same operations through `block.replace`.

`block.update` with `dataType="markdown"` or `dataType="dom"` also normalizes Markdown-looking `((id 'title'))`, `((id))`, and `#tag#` into real SiYuan inline structures. Do not hand-build complex DOM.

## Append a block

```json
{
  "action": "append",
  "parentID": "<doc-or-block-id>",
  "dataType": "markdown",
  "data": "New paragraph"
}
```

```bash
siyuan block append --parent-id <doc-or-block-id> --data-type markdown --data "New paragraph"
```

When moving several blocks, pass `ids` in the desired final order. The tool calls the low-level move API from last to first internally so the final order is preserved.

## Search content

```json
{
  "action": "fulltext",
  "query": "TODO"
}
```

```bash
siyuan search fulltext --query "TODO"
```

## Read an attribute view

```json
{
  "action": "get",
  "id": "<attribute-view-id>"
}
```

```bash
siyuan av get --id <attribute-view-id>
```

## Compare and restore a document timeline

Use the `timeline` tool to list existing nodes and create a named document baseline:

```json
{
  "action": "list_nodes",
  "scope": "document",
  "documentId": "<doc-id>",
  "page": 1,
  "pageSize": 50
}
```

```json
{
  "action": "create_node",
  "name": "Before revision",
  "scope": "document",
  "documentId": "<doc-id>"
}
```

Keep the returned `tag`. After editing the document, compare it with that node:

```json
{
  "action": "compare_node",
  "documentId": "<doc-id>",
  "tag": "<timeline-tag>",
  "page": 1,
  "pageSize": 20,
  "includeUnchanged": false
}
```

Before `rollback_document`, `rollback_block`, or `delete_node`, identify the exact document and node, explain the consequence, and obtain explicit user approval. For a reversible test, first create a protection node for the current state. After approval, a whole-document rollback uses:

```json
{
  "action": "rollback_document",
  "documentId": "<doc-id>",
  "tag": "<timeline-tag>"
}
```

Then read the document again to verify the result. `rollback_block` instead requires a fresh opaque `changeKey` from the latest `compare_node` response. `delete_node` removes the protective tag but retains the underlying snapshot.

CLI equivalents:

```bash
siyuan-sisyphus timeline create-node --name "Before revision" --scope document --document-id <doc-id> --json
siyuan-sisyphus timeline compare-node --document-id <doc-id> --tag <timeline-tag> --page-size 20 --json
# Run only after explicit approval:
siyuan-sisyphus timeline rollback-document --document-id <doc-id> --tag <timeline-tag> --json
```

## Duplicate document names

When multiple documents under the same parent share a human-readable path, use:

```json
{
  "action": "lookup",
  "notebook": "<notebook-id>",
  "hpath": "/Inbox/Same Name",
  "include": ["ids", "path", "hpath"]
}
```

The returned `idPath.ids` lists all matching document IDs. The tool includes a SQL fallback, so callers do not need to hand-write `SELECT ... WHERE hpath = ... AND type = 'd'`.
