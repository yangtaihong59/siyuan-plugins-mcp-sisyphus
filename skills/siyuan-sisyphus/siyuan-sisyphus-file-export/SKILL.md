---
name: siyuan-sisyphus-file-export
description: CLI-only playbook for SiYuan assets and exports with siyuan-sisyphus. Use for uploads, direct image reads, Markdown export, document extraction, resource ZIP export, stored OCR text, templates, and safe asset maintenance.
---

# Handle SiYuan Files and Exports with the CLI

File actions are the explicit exception to the normal remote-only data path: uploads and local exports may touch the machine running the server. Confirm local paths and scope first.

```bash
siyuan-sisyphus file upload-asset --assets-dir-path '/assets/' --local-file-path '/absolute/path/to/image.png' --json
```
```bash
siyuan-sisyphus file export-md --id '<doc-id>' --json
```
```bash
siyuan-sisyphus file extract-doc --id '<doc-id>' --output-dir '/tmp/siyuan-extract' --json
```
```bash
siyuan-sisyphus file export-resources --paths-json '["assets/file.png","assets/file.pdf"]' --json
```
```bash
siyuan-sisyphus file get-doc-assets --id '<doc-id>' --asset-type 'image' --json
```
```bash
siyuan-sisyphus file read-image --id '<doc-id>' --path 'assets/image.png' --json
```
```bash
siyuan-sisyphus file get-image-ocr-text --path 'assets/image.png' --json
```

When Markdown contains an `assets/...` image and visual content matters, read one relevant image with `read_image`. Supply exactly one authorized document ID or human-readable document path; do not bulk-inline a whole document. MCP clients receive a standard image block without a host-file write; CLI default output shows metadata, while explicit `--json` retains the non-text block for scripts. `get_image_ocr_text` only reads OCR already stored by SiYuan and does not run recognition; use it when direct vision is unavailable.

Large uploads must stop and require explicit confirmation before retrying with the large-file confirmation field. A document extraction output directory may be cleared; use a task-specific empty directory. Before renaming, deleting, or removing unused assets, list the exact targets and obtain approval. Verify returned paths after the operation. Read `siyuan-sisyphus help file upload-asset` for current size and path constraints.
