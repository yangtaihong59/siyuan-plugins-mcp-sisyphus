---
name: siyuan-mcp-file-export
description: MCP playbook for SiYuan assets and exports. Use for uploads, direct visual image reads, Markdown export, document extraction, resource ZIP export, stored OCR text, templates, and safe asset maintenance.
---

# Handle SiYuan Files and Exports with MCP

File actions are the explicit exception to the normal remote-only data path: uploads and local exports may touch the machine running the server. Confirm local paths and scope first.

```text
file(action="upload_asset", assetsDirPath="/assets/", localFilePath="/absolute/path/to/image.png")
```
```text
file(action="export_md", id="<doc-id>")
```
```text
file(action="extract_doc", id="<doc-id>", outputDir="/tmp/siyuan-extract")
```
```text
file(action="export_resources", paths=["assets/file.png","assets/file.pdf"])
```
```text
file(action="get_doc_assets", id="<doc-id>", assetType="image")
```
```text
file(action="read_image", id="<doc-id>", path="assets/image.png")
```
```text
file(action="get_image_ocr_text", path="assets/image.png")
```

When Markdown contains an `assets/...` image and visual content matters, read one relevant image with `read_image`. Supply exactly one authorized document ID or human-readable document path; do not bulk-inline a whole document. MCP clients receive a standard image block without a host-file write; CLI default output shows metadata, while explicit `--json` retains the non-text block for scripts. `get_image_ocr_text` only reads OCR already stored by SiYuan and does not run recognition; use it when direct vision is unavailable.

Large uploads must stop and require explicit confirmation before retrying with the large-file confirmation field. A document extraction output directory may be cleared; use a task-specific empty directory. Before renaming, deleting, or removing unused assets, list the exact targets and obtain approval. Verify returned paths after the operation. Read `siyuan://help/action/file/upload_asset` for current size and path constraints.
