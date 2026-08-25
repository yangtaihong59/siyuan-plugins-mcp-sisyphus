# block

This tool covers block insertion, updates, movement, metadata, references, and document-context helpers.

When to read this page: you need to manipulate block content directly instead of working at the whole-document level.

Related pages:

- [Permissions](../permissions.md)
- [document](./document.md)

## Common Actions

| Group | Actions |
|------|---------|
| Insert and update | `insert`, `prepend`, `append`, `update` |
| Movement and structure | `move`, `set_fold_state`, `get_children`, `breadcrumb` |
| Metadata | `set_attrs`, `get_attrs`, `info`, `dom`, `get_kramdown`, `batch_kramdown` |
| Reference / utility | `transfer_references`, `word_count`, `recent_updated` |
| Daily note helper | `add_to_daily_note` |
| Document context | `docs_info` |

## Parameters and Semantics

- `dataType` is usually `markdown` or `dom`.
- `prepend` and `append` work on either a document or a block child list.
- `update` is a whole-block replacement, not a section editor. For a heading, a structural `dataType="dom"` update must contain exactly one parsed `NodeHeading` for the target block. Do not send the heading together with the paragraphs, lists, or other blocks that follow it in the heading section; SiYuan normalizes a non-document update to the first content block.
- Preserve the target block's existing IAL when constructing a structural DOM update. If heading text is interpolated into HTML, escape it as HTML text first; raw `<`, `>`, `&`, or quotes can change the DOM instead of becoming heading text. Read the target DOM/kramdown before writing when you need to carry forward attributes or inline structure.
- For a plain-text edit inside one existing block, prefer `replace`: read that block's kramdown, use an exact old snippet, and let `block.replace` patch the original DOM. This avoids rebuilding a heading or dropping marks and IAL merely to change its text. `replace` does not traverse heading siblings or child blocks.
- `move` requires at least one destination hint such as `parentID` or `previousID`.
- For batch `move`, pass `ids` in the desired final order. The tool reverses only the internal SiYuan API call order and returns `apiCallOrder` for debugging.
- `add_to_daily_note` appends or prepends content to today's daily note via `position`.
- `batch_kramdown` accepts 1–20 block or document IDs, performs a read-permission resolution for each item, fetches readable content in one kernel request, and returns an ordered item for every input ID. Duplicate IDs remain duplicated in the output; denied or missing IDs are returned as per-item errors.

## Safety Rules

- `delete` and `move` require explicit confirmation.
- For multiline content, prefer `append`, `prepend`, or `insert` instead of `update`.
- A successful write response is not structural proof. After `update`, `replace`, or a kramdown/IAL normalization, read the fixed target back with `get_kramdown` and, when structure matters, `dom`, `get_children`, or `info`. Confirm the target ID, node type, heading level, IAL/attributes, and parent/child boundaries; do not use rendered text, search results, or an API success envelope as the only acceptance check.
- Imported callouts and lists need the same structural readback. A block that looks like a callout may still be `NodeBlockquote`, and paragraphs, tables, or images can escape their intended list item. Verify `NodeCallout` versus `NodeBlockquote`, list parent/child order and depth, and image kramdown after repair. Treat `NodeSoftBreak` and literal `\n` as separate cases when a repair splits paragraphs.
- The block handler is a transparent native wrapper. It does not silently filter SiYuan superblock close-marker artifacts or rewrite SQL failures caused by the kernel (for example, an affected version replacing an explicit-LIMIT diagnostic with a fallback error). Preserve the native result and resolve those cases through the corresponding SiYuan upstream version/fix boundary.

## Examples

MCP:

```json
{
  "action": "append",
  "parentID": "<doc-id>",
  "dataType": "markdown",
  "data": "- [ ] Todo item"
}
```

CLI:

```bash
siyuan block append --parent-id <doc-id> --data-type markdown --data "- [ ] Todo item"
```

## Action List

- `insert`
- `prepend`
- `append`
- `update`
- `delete`
- `move`
- `set_fold_state`
- `get_kramdown`
- `batch_kramdown`
- `get_children`
- `transfer_references`
- `set_attrs`
- `get_attrs`
- `info`
- `breadcrumb`
- `dom`
- `recent_updated`
- `word_count`
- `add_to_daily_note`
- `docs_info`
