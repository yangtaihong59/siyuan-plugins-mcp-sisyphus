# file

This tool covers asset upload, export, template rendering, OCR, and asset maintenance.

When to read this page: you need to upload assets, export content, render templates, or query document-linked resources.

Related pages:

- [Permissions](../permissions.md)
- [Troubleshooting](../../getting-started/troubleshooting.md)

## Common Actions

| Group | Actions |
|------|---------|
| Upload / export | `upload_asset`, `export_md`, `export_resources`, `extract_doc` |
| Rendering | `render` |
| Asset inspection | `get_doc_assets`, `get_image_ocr_text`, `list_unused_assets` |
| Asset mutations | `remove_unused_assets`, `rename_asset`, `delete_asset` |

`get_doc_assets` is a direct-reference inspection action. It reports assets referenced by the current document tree and does not expand query embed blocks. When you need to inspect the full document content and assets, use `extract_doc`.

## Safety Rules

- `upload_asset` requires confirmation and reads a local file path as an explicit binary-transfer exception.
- Large uploads need explicit large-file confirmation.
- `delete_asset` and `remove_unused_assets` require confirmation.
- `export_resources` with a local output path should be treated carefully.
- `extract_doc` writes to the local filesystem (default `~/siyuan-extracted/`) and clears the entire output directory before each export to prevent accumulation of old extracts.

## Examples

MCP:

```json
{
  "action": "upload_asset",
  "assetsDirPath": "/assets/",
  "localFilePath": "/Users/me/image.png"
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

```json
{
  "action": "render",
  "engine": "template",
  "id": "<doc-id>",
  "path": "/path/to/siyuan/data/templates/report.md"
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
- `render`
- `export_md`
- `export_resources`
- `list_unused_assets`
- `get_doc_assets`
- `get_image_ocr_text`
- `remove_unused_assets`
- `rename_asset`
- `delete_asset`
- `extract_doc`
