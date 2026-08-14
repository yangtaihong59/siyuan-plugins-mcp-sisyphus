# block 工具

这个工具覆盖块插入、块更新、块移动、元数据、引用与文档上下文辅助操作。

适用场景：你需要直接操作块内容，而不是在整篇文档级别工作。

相关页面：

- [权限模型](../permissions.md)
- [document 工具](./document.md)

## 常见动作

| 分组 | 动作 |
|------|---------|
| 插入与更新 | `insert`, `prepend`, `append`, `update` |
| 移动与结构 | `move`, `set_fold_state`, `get_children`, `breadcrumb` |
| 元数据 | `set_attrs`, `get_attrs`, `info`, `dom`, `get_kramdown`, `batch_kramdown` |
| 引用 / 工具类 | `transfer_references`, `word_count`, `recent_updated` |
| 日记辅助 | `add_to_daily_note` |
| 文档上下文 | `docs_info` |

## 参数与语义

- `dataType` 通常是 `markdown` 或 `dom`。
- `prepend` 和 `append` 既可以作用于文档，也可以作用于块的子列表。
- `update` 是整块替换，不是标题小节编辑器。更新标题时，结构化的 `dataType="dom"` 请求必须只包含目标块对应的一个已解析 `NodeHeading`，不能把标题以及标题小节后面的段落、列表或其他块一起作为 payload；思源会把非文档块更新规范化为第一个内容块。
- 构造结构化 DOM 更新时，要保留目标块已有的 IAL。把标题文字插入 HTML 前先按 HTML 文本转义；原始的 `<`、`>`、`&` 或引号可能改变 DOM，而不是成为标题文字。需要保留属性或行内结构时，写入前先读取目标块的 DOM/kramdown。
- 只改一个现有块的纯文字时，优先使用 `replace`：先读取该块的 kramdown，拿其中精确的旧片段，再让 `block.replace` 在原始 DOM 上打补丁。这样不必为了改标题文字重建标题，也不容易丢失标记和 IAL。`replace` 不会遍历标题后续兄弟块或子块。
- `move` 至少需要一个目标定位字段，例如 `parentID` 或 `previousID`。
- 批量 `move` 时，`ids` 按期望的最终顺序传入。工具只会在内部倒序调用思源底层 API，并在结果中返回 `apiCallOrder` 便于排查。
- `add_to_daily_note` 通过 `position` 把内容追加或前置到当天日记。
- `batch_kramdown` 接受 1–20 个块或文档 ID，对每个输入项解析读取权限，再用一次内核请求获取允许读取的内容。响应与输入顺序一致，重复 ID 会保留；无权限或不存在的 ID 以逐项错误返回。

## 安全规则

- `delete` 和 `move` 需要显式确认。
- 多行内容优先使用 `append`、`prepend` 或 `insert`，不要滥用 `update`。
- 写入接口返回成功不等于结构正确。`update`、`replace` 或 kramdown/IAL 规范化后，要按固定目标读回 `get_kramdown`；涉及结构时还要读 `dom`、`get_children` 或 `info`。确认目标 ID、块类型、标题级别、IAL/属性以及父子边界；不能只凭渲染文字、搜索结果或 API 成功包验收。
- 导入后的 callout 和列表也必须做结构读回。外观看起来像 callout 的块仍可能是 `NodeBlockquote`，段落、表格或图片也可能跑出原本的列表项。修复后检查 `NodeCallout` 与 `NodeBlockquote` 的区别、列表父子顺序和层级，以及图片 kramdown 是否保留；拆段时要分别处理 `NodeSoftBreak` 和字面 `\n`。
- block handler 只是透明的思源原生包装，不会静默过滤思源超级块 close-marker 伪条目，也不会改写由内核产生的 SQL 错误（例如受影响版本把显式 `LIMIT` 的诊断替换成回退错误）。应保留原生结果，按对应的思源上游版本和修复边界处理。

## 示例

MCP：

```json
{
  "action": "append",
  "parentID": "<doc-id>",
  "dataType": "markdown",
  "data": "- [ ] Todo item"
}
```

CLI：

```bash
siyuan block append --parent-id <doc-id> --data-type markdown --data "- [ ] Todo item"
```

## 动作列表

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
