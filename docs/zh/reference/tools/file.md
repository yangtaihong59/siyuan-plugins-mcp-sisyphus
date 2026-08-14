# file 工具

这个工具覆盖资源上传、导出、模板发现与管理、模板渲染、OCR 与资源维护。

适用场景：你需要上传资源、导出内容、查找/读取/创建/更新/删除/渲染模板，或查询文档关联资源。

相关页面：

- [权限模型](../permissions.md)
- [故障排查](../../getting-started/troubleshooting.md)

## 常见动作

| 分组 | 动作 |
|------|---------|
| 上传 / 导出 | `upload_asset`, `export_md`, `export_resources`, `extract_doc` |
| 模板 | `list_templates`, `read_template`, `create_template`, `update_template`, `delete_template`, `save_doc_as_template`, `render` |
| 资源查看 | `get_doc_assets`, `get_image_ocr_text`, `list_unused_assets` |
| 资源变更 | `remove_unused_assets`, `rename_asset`, `delete_asset` |

`get_doc_assets` 是直接引用资源查看动作，只返回当前文档树直接引用的资源，不会展开查询嵌入块。需要查看完整文档内容和资源时，应使用 `extract_doc`。

## 导出边界

`export_md` 和 `export_resources` 是读取/导出动作，不是恢复动作。调用前先解析具体目标：`export_md` 使用文档 ID，`export_resources` 则要逐一核对每个工作区相对路径。多个文档或资源可能同名时，标题、搜索结果或凭记忆写出的路径都不够作为目标依据。

- `export_md` 会把文档 Markdown 返回在工具结果中。它不会创建 repo/history 快照，也不会写本地文件。因此这是内存中的导出，内容可能经由调用者离开思源进程；只有确实需要这个外部副作用时才另行保存。
- `export_resources` 打包显式提供的工作区路径。`assets/example.png` 这类常见资源写法会在调用内核前规范化为 `/data/assets/example.png`。返回的是文件级 ZIP，不是语义级文档备份；它本身不能恢复块 ID、引用、属性视图状态或文档树关系。
- 不传 `outputPath` 时，`export_resources` 返回内核临时导出路径。传入 `outputPath` 后，handler 会读取这个 ZIP 并写入本地文件系统，这是外部副作用，需要明确确认。执行前要解析并复核目标位置，不能因为源操作是只读就把目标路径当成无害。

按意图选择最窄的导出：文字检查用 `export_md`，选定工作区文件或便携资源包用 `export_resources`，需要连同单篇文档引用资源一起检查时用 `extract_doc`。这些动作都不会自动建立回退点。

### 有界导出读回

`export_md` 完成后，检查结果中的文档身份字段和内容，不要把 HTTP 成功 envelope 当成已经落盘的文件。`export_resources` 完成后，检查返回的临时路径或显式 `outputPath` 以及字节数；核对请求的路径集合，不要用无关目录列表代替。响应丢失时，先对精确目标/路径做一次读取，再决定是否重试；不要盲目重发一个可能已经生成本地文件的导出。

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
- `export_resources`
- `list_unused_assets`
- `get_doc_assets`
- `get_image_ocr_text`
- `remove_unused_assets`
- `rename_asset`
- `delete_asset`
- `extract_doc`
