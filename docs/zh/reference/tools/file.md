# file 工具

这个工具覆盖资源上传、导出、模板发现与管理、模板渲染、OCR 与资源维护。

适用场景：你需要上传资源、导出内容、查找/读取/创建/更新/删除/渲染模板，或查询文档关联资源。

相关页面：

- [权限模型](../permissions.md)
- [故障排查](../../getting-started/troubleshooting.md)

## 常见动作

| 分组 | 动作 |
|------|---------|
| 上传 / 导出 | `upload_asset`, `export_md`, `export_markdown_snapshot`, `export_resources`, `extract_doc` |
| 模板 | `list_templates`, `read_template`, `create_template`, `update_template`, `delete_template`, `save_doc_as_template`, `render` |
| 资源查看 | `get_doc_assets`, `audit_image_refs`, `get_image_ocr_text`, `list_unused_assets` |
| 资源变更 | `remove_unused_assets`, `rename_asset`, `delete_asset` |

`get_doc_assets` 是直接引用资源查看动作，只返回当前文档树直接引用的资源，不会展开查询嵌入块。需要查看完整文档内容和资源时，应使用 `extract_doc`。

`audit_image_refs` 是只读的导入验收动作。调用方传入文档 ID 和源 Markdown 或预处理 Markdown 中的 expected 图片引用；Sisyphus 通过思源 HTTP API 读取文档直接引用的图片，并返回 expected、actual、missing、extra 引用。比较按文件名 basename 进行，并忽略思源追加的时间戳/ID 后缀。它不读取本地 `.sy` 文件，也不会修复缺失或多余引用。

## 安全规则

- `upload_asset` 需要确认，并会读取本地文件路径，属于二进制传输的显式例外。规范参数是 `assetsDirPath + localFilePath`；`file` 可作为 `localFilePath` 的简写，`assetsDirPath` 默认 `/assets/`。
- 大文件上传需要额外确认。
- `delete_template`、`delete_asset` 与 `remove_unused_assets` 需要确认。`delete_template` 默认关闭。
- 模板写入通过思源工作区文件 API 写 `/data/templates/...`，不会直接写本地文件系统。
- `export_resources` 如果指定本地输出路径，也应谨慎处理。
- `extract_doc` 将导出文件写入本地文件系统（默认 `~/siyuan-extracted/`），每次导出前会清空整个输出目录，避免旧提取结果无限积累。结果会返回 `outputRoot` 和 `defaultOutputDirUsed`；需要稳定路径时请显式传 `outputDir`，例如 `/private/tmp/...`。

## 示例

MCP：

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

这个结果只表示文档树直接资源；如果需要查看附件内容，请提取整个文档。

只读审计导入后的图片引用：

```json
{
  "action": "audit_image_refs",
  "id": "<doc-id>",
  "expectedRefs": ["assets/cover.png", "assets/figure.png"]
}
```

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

先查找模板：

```json
{
  "action": "list_templates",
  "query": "report"
}
```

`list_templates` 使用思源自身的模板选择接口，并返回可复用的 `readArgs` 与 `renderArgsTemplate`。

读取模板源码：

```json
{
  "action": "read_template",
  "path": "/path/to/siyuan/data/templates/report.md"
}
```

`read_template` 只会通过思源认证后的 `/templates/` 静态路由读取 `data/templates` 下的 Markdown 模板，不是通用工作空间文件读取器。

从 Markdown 创建或覆盖模板：

```json
{
  "action": "create_template",
  "path": "reports/monthly.md",
  "markdown": "# .action{.title}\n\n## Summary\n"
}
```

如果模板已存在，`create_template` 默认返回 `template_exists`；需要覆盖时传 `overwrite=true`。如果要求模板必须已存在，使用 `update_template`：

```json
{
  "action": "update_template",
  "path": "reports/monthly.md",
  "markdown": "# .action{.title}\n\n## Updated Summary\n"
}
```

把已有文档另存为根模板：

```json
{
  "action": "save_doc_as_template",
  "id": "<doc-id>",
  "name": "meeting-note"
}
```

删除已有模板前先用 `list_templates` 解析路径：

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

## 动作列表

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

`file(action="export_markdown_snapshot")` 通过思源 API 返回一页确定性 Markdown 快照，不写主机文件系统，也不启动后台任务。请求必须明确给出 `notebookID`，并且在 `roots`（例如 `/`）与 `documentIDs` 中二选一；用 `limit` 和不透明的 `cursor` 分批、可续跑地获取结果。

每个文档返回 API 解析出的 ID、标题、hPath、存储路径、安全的相对 `.md` 路径、canonical metadata，以及 `sha256:v1:` 元数据/正文哈希。排序固定为 hPath 后 ID。重复 hPath 会保留全部文档并用 ID 消歧；大小写不敏感路径冲突和 API/导出不一致会进入 `conflicts`/`errors`，不会猜测覆盖。这个响应是一页结果，不是已经落盘的整库备份；由调用方决定是否及在哪里保存。
