# fs Tool

Use `fs` first for ordinary pure-Markdown document file operations. It accepts human-readable workspace paths and hides notebook IDs, block IDs, and storage paths.

Path shape:

- `/<notebook name>` for a notebook root
- `/<notebook name>/<folder>/<doc>` for a document
- `/` for all readable notebook roots

## Common Actions

| Action | Purpose |
|--------|---------|
| `ls` | List direct child documents as `{ name, path, children }` |
| `tree` | List a compact recursive document tree |
| `read` | Read a document as Markdown |
| `write` | Create a document, or replace its body with `overwrite=true` |
| `reorder` | Apply a complete manual order to all visible direct child documents |
| `search` | Search Markdown lines under a document or folder path |

## AI-Editable Markdown View

- `read` returns an AI-editable Markdown view, not Markdown from `/api/export/exportMdContent`. This avoids degrading SiYuan block refs into footnotes or plain links.
- The view is built from block kramdown: block refs are preserved as `((id 'title'))`, tags are preserved as `#tag#`, and SiYuan's zero-width tag marker characters are stripped.
- Normal block and list-item IAL metadata is hidden, so `{: id="..." updated="..."}` does not leak into list text; snippets copied from `fs.read`, such as `- item`, can be used directly as `fs.replace` `old` text.
- Fenced code, math blocks, and literal user text are not globally rewritten just because they look like metadata.
- Blockquotes, tables, super blocks, and similar containers are read as containers, so child blocks are not duplicated. `fs.read` filters SiYuan-generated container IAL, but complex blocks still return a non-fidelity warning and should be modified with advanced tools.
- `read` always paginates by complete display blocks. Use the returned `nextWindow`, or pass zero-based `blockStart`, `blockLimit` (default `50`), and `tokenBudget` (default `2000`). Lists, tables, blockquotes, code fences, math blocks, and other containers are never split between windows. A window may exceed the budget by up to 15% at a complete-block boundary, and leading headings stay with the first body block even when that block requires a larger overrun; such responses set `budgetExceeded=true`.
- Every read returns a full heading `outline` with block positions. Pass `includeBlockIds=true` to receive a sidecar `blockRefs` mapping; IDs are never injected into the editable Markdown `content`.
- The old `page/pageSize` character pagination has been removed. A single block larger than `tokenBudget` is returned whole with `budgetExceeded=true`.
- `tree` and `search` recursively enumerate notebook roots through `listDocsByPath`, so `/` and `/<notebook name>` work on SiYuan versions that reject `listDocTree("/")`.

## Markdown Safety Semantics

- `write` accepts `((id 'title'))`, naked `((id))`, and `#tag#` directly. Naked refs are resolved to explicit anchors before writing; if lookup fails, MCP falls back to `((id 'id'))` with a warning.
- `write` strips a leading `# Title` when it matches the document name, avoiding duplicate visible titles.
- `write overwrite=true` refuses documents containing complex SiYuan-native blocks such as AV/database blocks, super blocks, embeds, widgets, HTML, or media. Use advanced tools for those structures.
- `replace` works block-by-block against non-complex Markdown blocks. If the document contains complex SiYuan-native blocks, those blocks are skipped and reported as `skippedComplexBlocks`; matches that only exist inside skipped blocks, or cross block boundaries, are rejected without writing.
- `replace` matches against the same AI-editable view returned by `read`, so it can directly edit ordinary Markdown blocks containing tags or block refs, and can replace a whole `#tag#` token with plain text. It is still a Markdown text operation, not a complex-block editor.
- For inline styled text, `old` should be the plain text inside the style markers, without Markdown delimiters. For example, replace `hello` inside `**hello**` or `` `hello` ``, not `**hello**` or `` `hello` ``; DOM writeback preserves the existing bold, inline-code, and similar styles.
- `replace` allows footnote-style refs and `siyuan://blocks` Markdown links, but the result includes a hint because they do not create SiYuan backlinks.

## High-risk Actions

- `rm` deletes a document and requires explicit confirmation.
- `mv` moves or renames a document and requires explicit confirmation.

## Examples

```json
{ "action": "ls", "path": "/Inbox/Meetings" }
```

```json
{ "action": "read", "path": "/Inbox/Meetings/2024 Summary" }
```

```json
{ "action": "read", "path": "/Inbox/Meetings/2024 Summary", "blockStart": 50, "blockLimit": 50, "tokenBudget": 2000, "includeBlockIds": true }
```

```json
{ "action": "write", "path": "/Inbox/Meetings/New Doc", "markdown": "Content" }
```

```json
{ "action": "search", "path": "/Inbox/Meetings", "query": "budget", "caseSensitive": false }
```

Manual ordering uses a complete permutation, not a partial move. List the parent first, then pass every visible direct child path exactly once. The action switches the notebook to custom sorting (`sortMode: 6`). Hidden documents are neither required nor reordered.

```json
{
  "action": "reorder",
  "path": "/Ideas",
  "orderedPaths": [
    "/Ideas/Know Yourself",
    "/Ideas/Understand the World",
    "/Ideas/Principles for Action"
  ]
}
```

CLI: `siyuan fs reorder --path "/Ideas" --ordered-paths-json '["/Ideas/Know Yourself","/Ideas/Understand the World","/Ideas/Principles for Action"]'`

When `fs.read` reports complex blocks or the task needs SiYuan-specific block layout, metadata, SQL, backlinks, assets, or database operations, switch to `document`, `block`, `search`, `file`, or `av`.
