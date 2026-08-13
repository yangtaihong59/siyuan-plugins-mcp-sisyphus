# document 工具

这个工具覆盖文档 CRUD、树结构查询、元数据，以及与日记/转换相关的文档操作。

适用场景：你需要创建、移动、查询或转换文档。

相关页面：

- [路径语义](../path-semantics.md)
- [权限模型](../permissions.md)

## 常见动作

| 分组 | 动作 |
|------|---------|
| 创建与读取 | `create`, `lookup`, `get_doc`, `get_outline` |
| 树结构查询 | `get_child_blocks`, `get_child_docs`, `list_tree`, `search_docs` |
| 元数据与修改 | `rename`, `move`, `reorder`, `remove`, `set_attr`, `duplicate` |
| 日记 / 转换 | `create_daily_note`, `heading_to_doc`, `doc_to_heading` |

## 参数与语义

- `create` 支持人类可读 `path`，也支持 `parentPath` + `title`；省略 `markdown` 即创建空文档。创建子文档时优先使用 `path`。`parentPath` + `title` 可传人类可读父路径，也可传 `lookup` 返回的 `.sy` 结尾 storage path。
- `lookup` 可按 `id`、存储 `path`、人类可读 `hpath` / `hPath` 查找；用 `include` 请求 `id`、`ids`、`path`、`hpath` 或 `docInfo`。
- `lookup` 返回的 `idPath` 会包含可用的 `id` / `ids`。当同一 hpath 有多个同名文档时，`include: ["ids"]` 会返回全部匹配 ID；内部已包含 SQL 兜底。
- `rename`、`remove`、`move` 在非 ID 模式下通常需要存储路径。
- `reorder` 接收笔记本或父文档 `parentID` 与 `orderedIDs`。数组必须把全部可见直属子文档 ID 各包含一次。它会启用笔记本自定义排序（`sortMode: 6`），但不会移动、重命名或修改文档正文。
- `get_child_docs` 必须传文档 `id`，不接受 `notebook + path`。
- `list_tree` 使用 `notebook + path`，其中 `path` 是 `/` 或 `/20240318112233-abc123.sy` 这类存储路径，不是人类可读路径。
- 如果批量 `remove` 遇到思源短暂的 `indexing` 窗口，请改用 `notebook + storage path` 逐个删除并重试。
- `set_attr` 按文档 ID 写入文档元数据属性。
- `get_outline` 调用思源原生大纲接口，不读取正文即可返回标题树、标题块 ID、嵌套关系和 `headingCount`。如果还需要可编辑 Markdown，请使用 `get_doc`。

## Markdown 与标题规则

- `create` 的 `markdown` 不需要写同名 `# 标题`；如果写了，工具会自动剥离，避免双标题。
- `create` 支持直接写 `((id '标题'))`、裸 `((id))` 和 `#标签#`。裸双链会自动补齐锚文本；如果解析失败，会降级为 `((id 'id'))` 并返回 warning。
- `create` 允许 `[^1]` 脚注式引用和 `[text](siyuan://blocks/id)` 写入，但结果会提示它们不会创建思源真实反链。
- `get_doc` 返回与 `fs.read` 一致的可编辑 Markdown，保留 `((id '标题'))` 和 `#标签#`。
- `get_doc mode="markdown"` 始终返回完整展示块窗口。可使用 `nextWindow` 继续读取，或传入 `blockStart`、`blockLimit` 和 `tokenBudget`；响应同时包含全文标题 `outline`。`includeBlockIds=true` 会增加独立块引用，不改变 `content`。
- 字符级 `page/pageSize` 分页已经移除。`mode="html"` 仍返回不分页的当前视图 HTML，并继续使用 `size`。

## 安全规则

- `remove`、`move` 需要显式确认。
- 按路径修改前先确认路径类型。

## 示例

MCP：

```json
{
  "action": "create",
  "notebook": "<notebook-id>",
  "path": "/Inbox/Weekly Note",
  "markdown": "周报正文"
}
```

```json
{
  "action": "lookup",
  "id": "<doc-id>",
  "include": "path"
}
```

CLI：

```bash
siyuan document create --notebook <notebook-id> --path "/Inbox/Weekly Note" --markdown "周报正文"
siyuan document lookup --id <doc-id> --include path
siyuan document reorder --parent-id <笔记本或父文档ID> --ordered-ids-json '["<文档ID-1>","<文档ID-2>"]'
```

## 动作列表

- `create`
- `lookup`
- `rename`
- `remove`
- `move`
- `reorder`
- `get_child_blocks`
- `get_child_docs`
- `set_attr`
- `list_tree`
- `search_docs`
- `get_doc`
- `get_outline`
- `create_daily_note`
- `duplicate`
- `heading_to_doc`
- `doc_to_heading`
