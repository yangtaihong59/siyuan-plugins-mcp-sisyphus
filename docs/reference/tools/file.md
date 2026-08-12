# file

This tool covers asset upload, export, template discovery and management, template rendering, OCR, and asset maintenance.

When to read this page: you need to upload assets, export content, find/read/create/update/delete/render templates, or query document-linked resources.

Related pages:

- [Permissions](../permissions.md)
- [Troubleshooting](../../getting-started/troubleshooting.md)

## Common Actions

| Group | Actions |
|------|---------|
| Upload / export | `upload_asset`, `export_md`, `export_markdown_snapshot`, `export_resources`, `extract_doc` |
| Templates | `list_templates`, `read_template`, `create_template`, `update_template`, `delete_template`, `save_doc_as_template`, `render` |
| Asset inspection | `get_doc_assets`, `audit_image_refs`, `get_image_ocr_text`, `list_unused_assets` |
| Asset mutations | `remove_unused_assets`, `rename_asset`, `delete_asset` |

`get_doc_assets` is a direct-reference inspection action. It reports assets referenced by the current document tree and does not expand query embed blocks. When you need to inspect the full document content and assets, use `extract_doc`.

`audit_image_refs` is a read-only import acceptance check. Pass the document ID and expected image references from source or preprocessed Markdown. It reads direct image references through SiYuan's HTTP API and returns expected, actual, missing, and extra references. Matching compares basenames and ignores SiYuan timestamp/id suffixes. It never reads local `.sy` files or repairs content.

## Safety Rules

- `upload_asset` requires confirmation and reads a local file path as an explicit binary-transfer exception. Canonical input is `assetsDirPath + localFilePath`; `file` is accepted as a shorthand for `localFilePath`, and `assetsDirPath` defaults to `/assets/`.
- Large uploads need explicit large-file confirmation.
- `delete_template`, `delete_asset`, and `remove_unused_assets` require confirmation. `delete_template` is disabled by default.
- Template writes use SiYuan's workspace file API for `/data/templates/...`; they do not write the local filesystem directly.
- `export_resources` with a local output path should be treated carefully.
- `extract_doc` writes to the local filesystem (default `~/siyuan-extracted/`) and clears the entire output directory before each export to prevent accumulation of old extracts. Results include `outputRoot` and `defaultOutputDirUsed`; pass `outputDir` explicitly for predictable paths such as `/private/tmp/...`.

## Examples

MCP:

```json
{
  "action": "upload_asset",
  "file": "/Users/me/image.png"
}
```

```json
{
  "action": "get_doc_assets",
  "id": "<doc-id>",
  "assetType": "image"
}
```

This returns direct document-tree assets only. It is not a substitute for extracting the document when you need to inspect attachment content.

Audit imported image references without touching local workspace files:

```json
{
  "action": "audit_image_refs",
  "id": "<doc-id>",
  "expectedRefs": ["assets/cover.png", "assets/figure.png"]
}
```

Extract a document and its assets into a local folder:

```json
{
  "action": "extract_doc",
  "id": "<doc-id>",
  "outputDir": "/Users/me/siyuan-extracted"
}
```

`extract_doc` writes Markdown and referenced assets into an uncompressed folder so AI tools can inspect attachment content directly.

Template rendering:

Find templates first:

```json
{
  "action": "list_templates",
  "query": "report"
}
```

`list_templates` uses SiYuan's own template picker endpoint and returns reusable `readArgs` and `renderArgsTemplate`.

Read a template source:

```json
{
  "action": "read_template",
  "path": "/path/to/siyuan/data/templates/report.md"
}
```

`read_template` only reads Markdown templates under `data/templates` through SiYuan's authenticated `/templates/` route. It is not a general workspace file reader.

Create or replace a template from Markdown:

```json
{
  "action": "create_template",
  "path": "reports/monthly.md",
  "markdown": "# .action{.title}\n\n## Summary\n"
}
```

`create_template` returns `template_exists` unless `overwrite=true` is passed for an existing template. Use `update_template` when the template must already exist:

```json
{
  "action": "update_template",
  "path": "reports/monthly.md",
  "markdown": "# .action{.title}\n\n## Updated Summary\n"
}
```

Save an existing document as a root-level template:

```json
{
  "action": "save_doc_as_template",
  "id": "<doc-id>",
  "name": "meeting-note"
}
```

Delete an existing template only after resolving it with `list_templates`:

```json
{
  "action": "delete_template",
  "path": "/path/to/siyuan/data/templates/reports/monthly.md"
}
```

```json
{
  "action": "render",
  "engine": "template",
  "id": "<doc-id>",
  "path": "/path/to/siyuan/data/templates/report.md",
  "preview": true
}
```

`engine="template"` renders a workspace template file. Inside the template, use SiYuan delimiters such as `.action{.title}`, `.action{.id}`, `.action{.name}`, and `.action{.alias}`; double-curly placeholders such as `&#123;&#123;.title&#125;&#125;` are not replaced by this engine.

```json
{
  "action": "render",
  "engine": "sprig",
  "template": "Today: <sprig date expression>"
}
```

`engine="sprig"` renders an inline string with double-curly syntax and Sprig functions, but it has no document context.

CLI:

```bash
siyuan file get-doc-assets --id <doc-id> --asset-type image
siyuan file extract-doc --id <doc-id> --output-dir ./siyuan-extracted
```

## Action List

- `upload_asset`
- `list_templates`
- `read_template`
- `create_template`
- `update_template`
- `delete_template`
- `save_doc_as_template`
- `render`
- `export_md`
- `export_markdown_snapshot`
- `export_resources`
- `list_unused_assets`
- `get_doc_assets`
- `audit_image_refs`
- `get_image_ocr_text`
- `remove_unused_assets`
- `rename_asset`
- `delete_asset`
- `extract_doc`
### `export_markdown_snapshot`

`file(action="export_markdown_snapshot")` returns one deterministic page of a Markdown snapshot without writing the host filesystem or starting a background job. The request must include an explicit `notebookID` and exactly one of `roots` (notebook-local storage paths, such as `/`) or `documentIDs`. Use `limit` and the opaque `cursor` for resumable batches.

Each returned document includes the API-resolved ID, title, hPath, storage path, a safe relative `.md` path, canonical metadata plus `sha256:v1:` metadata/content hashes. Documents are ordered by hPath and ID. Duplicate hPaths are retained and disambiguated with the document ID; case-insensitive collisions and API/export mismatches are reported in `conflicts`/`errors` rather than guessed away. The response is a page, not a completed workspace backup; callers decide whether and where to persist it.
