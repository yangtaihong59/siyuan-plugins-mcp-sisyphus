# file

这个工具覆盖资源上传、导出、模板渲染、OCR 与资源维护。

适用场景：你需要上传资源、导出内容、渲染模板，或查询文档关联资源。

相关页面：

- [权限模型](../permissions.md)
- [故障排查](../../getting-started/troubleshooting.md)

## 常见 Actions

| 分组 | Actions |
|------|---------|
| 上传 / 导出 | `upload_asset`, `export_md`, `export_resources`, `extract_doc` |
| 渲染 | `render` |
| 资源查看 | `get_doc_assets`, `get_image_ocr_text`, `list_unused_assets` |
| 资源变更 | `remove_unused_assets`, `rename_asset`, `delete_asset` |

`get_doc_assets` 是直接引用资源查看动作，只返回当前文档树直接引用的资源，不会展开查询嵌入块。需要查看完整文档内容和资源时，应使用 `extract_doc`。

## 安全规则

- `upload_asset` 需要确认，并会读取本地文件路径，属于二进制传输的显式例外。
- 大文件上传需要额外确认。
- `delete_asset` 与 `remove_unused_assets` 需要确认。
- `export_resources` 如果指定本地输出路径，也应谨慎处理。
- `extract_doc` 将导出文件写入本地文件系统（默认 `~/siyuan-extracted/`），每次导出前会清空整个输出目录，避免旧提取结果无限积累。

## 示例

MCP：

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

这个结果只表示文档树直接资源；如果需要查看附件内容，请提取整个文档。

将文档和资源提取到本地目录：

```json
{
  "action": "extract_doc",
  "id": "<doc-id>",
  "outputDir": "/Users/me/siyuan-extracted"
}
```

`extract_doc` 会把 Markdown 和引用资源写入非压缩目录，方便 AI 工具直接检查附件内容。

模板渲染：

```json
{
  "action": "render",
  "engine": "template",
  "id": "<doc-id>",
  "path": "/path/to/siyuan/data/templates/report.md"
}
```

`engine="template"` 渲染工作区模板文件。模板内使用思源分隔符，例如 `.action{.title}`、`.action{.id}`、`.action{.name}`、`.action{.alias}`；`&#123;&#123;.title&#125;&#125;` 这类双花括号占位符不会被该引擎替换。

```json
{
  "action": "render",
  "engine": "sprig",
  "template": "Today: <sprig date expression>"
}
```

`engine="sprig"` 渲染双花括号语法的内联字符串并支持 Sprig 函数，但没有文档上下文。

CLI：

```bash
siyuan file get-doc-assets --id <doc-id> --asset-type image
siyuan file extract-doc --id <doc-id> --output-dir ./siyuan-extracted
```

## Action 列表

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
