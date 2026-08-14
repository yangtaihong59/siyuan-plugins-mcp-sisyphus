# 常见任务

这个页面把常见目标映射到 MCP 参数和 CLI 命令。

适用场景：你已经知道要做什么，但还不知道该用哪个工具。

相关页面：

- [参考首页](./index.md)
- [工具索引](./tools/index.md)

## 修改前先选择正确的路径

对于 Sisyphus 自有的修改型 action，应保持“严格安全写入”开启；当 action 的 Schema 暴露前置条件时，先用完全相同的 action 执行 `validateOnly=true`。提交时使用返回的短凭据和新的 UUIDv7 `requestId`；成功结果会通过有界读回和只保存元数据的幂等账本验证。这是进程级协调协议，不是思源内核事务，也不会自动回滚。思源界面、其他插件、直接调用内核、导出、同步、通知、反馈以及官方 `extension` 调用都不在这项保证内。

通过插件 HTTP 服务进入的 MCP/Agent 调用直接使用协调器。stdio 或独立 CLI 收到的严格修改会转交同一个插件内置协调器，不会另建本地队列或租约池。如果插件 HTTP 协调器不可用，应先修复这条路径，不要改走未协调的写入再重试。只读 action 和外部副作用 action 各自遵循自己的路径。

## 列出笔记本

```json
{ "action": "list" }
```

```bash
siyuan notebook list
```

## 创建文档

```json
{
  "action": "create",
  "notebook": "<notebook-id>",
  "path": "/Inbox/Note",
  "markdown": "正文内容"
}
```

```bash
siyuan document create --notebook <notebook-id> --path "/Inbox/Note" --markdown "正文内容"
```

不要在 `markdown` 正文开头重复写同名 `# Note`。`document.create` 和 `fs.write` 会自动把“与文档标题相同”的开头 H1 去掉，避免双标题；不同标题的 H1 会保留。

如果需要立即拿到文档 ID，优先用 `document.create`，它会直接返回 `id`。如果只想按人类可读路径创建或覆盖正文，用 `fs.write` 更简单。两者都支持在 Markdown 中直接写真实标签和双链：

```json
{
  "action": "create",
  "notebook": "<notebook-id>",
  "path": "/Inbox/带链接的笔记",
  "markdown": "关联 ((20260610000000-abcdefg '完整标题')) #研究/待整理#"
}
```

`((id))` 裸双链会在写入前自动解析目标块并补成 `((id '锚文本'))`。如果锚文本解析失败，MCP 会降级写成 `((id 'id'))` 并返回 warning。`[^1]` 脚注式引用和 `[text](siyuan://blocks/id)` 都允许写入，但结果会提示它们不会创建思源真实反链。

## 修改已有内容

当前版本可以直接使用 `fs.replace` 或 `block.replace` 修改包含标签和双链的段落，不需要外部 DOM 注入脚本。

```json
{
  "action": "replace",
  "path": "/Inbox/带链接的笔记",
  "edit": {
    "old": "关联 ((20260610000000-abcdefg '完整标题')) #研究/待整理#",
    "new": "已整理 ((20260610000000-abcdefg '完整标题')) #研究/完成#"
  }
}
```

已验证的安全场景包括：

- 替换包含双链的整段
- 替换包含标签的整段
- 把整个 `#标签#` 替换为普通文本
- `block.replace` 对同类场景同样有效

`block.update` 的 `dataType="markdown"` 和 `dataType="dom"` 也会把 Markdown 里的 `((id '标题'))`、`((id))`、`#标签#` 规范化为真实思源 inline 结构。不要手工拼复杂 DOM。

## 追加块

```json
{
  "action": "append",
  "parentID": "<doc-or-block-id>",
  "dataType": "markdown",
  "data": "New paragraph"
}
```

```bash
siyuan block append --parent-id <doc-or-block-id> --data-type markdown --data "New paragraph"
```

批量移动多个块时传 `ids` 数组即可。工具内部会倒序调用底层移动接口来保持最终顺序，不需要调用方自己倒序。

## 搜索内容

```json
{
  "action": "fulltext",
  "query": "TODO"
}
```

```bash
siyuan search fulltext --query "TODO"
```

## 读取属性视图

```json
{
  "action": "get",
  "id": "<attribute-view-id>"
}
```

```bash
siyuan av get --id <attribute-view-id>
```

## 比较并恢复文档时间线

使用 `timeline` 工具列出现有节点，并为当前文档创建命名基线：

```json
{
  "action": "list_nodes",
  "scope": "document",
  "documentId": "<文档 ID>",
  "page": 1,
  "pageSize": 50
}
```

```json
{
  "action": "create_node",
  "name": "改写前",
  "scope": "document",
  "documentId": "<文档 ID>"
}
```

保存返回的 `tag`。修改文档后，用该节点进行比较：

```json
{
  "action": "compare_node",
  "documentId": "<文档 ID>",
  "tag": "<时间线 tag>",
  "page": 1,
  "pageSize": 20,
  "includeUnchanged": false
}
```

调用 `rollback_document`、`rollback_block` 或 `delete_node` 前，必须指出准确的文档和节点、说明影响，并获得用户明确确认。需要可恢复测试时，先为当前状态创建保护节点。确认后，整篇文档回退使用：

```json
{
  "action": "rollback_document",
  "documentId": "<文档 ID>",
  "tag": "<时间线 tag>"
}
```

回退后重新读取文档验证结果。`rollback_block` 还需要最近一次 `compare_node` 返回的不透明 `changeKey`。`delete_node` 只移除保护 tag，底层快照仍然保留。

对应 CLI 命令：

```bash
siyuan-sisyphus timeline create-node --name "改写前" --scope document --document-id <文档 ID> --json
siyuan-sisyphus timeline compare-node --document-id <文档 ID> --tag <时间线 tag> --page-size 20 --json
# 仅在用户明确确认后执行：
siyuan-sisyphus timeline rollback-document --document-id <文档 ID> --tag <时间线 tag> --json
```

## 同名文档

当同一父级下存在同名文档时，使用：

```json
{
  "action": "lookup",
  "notebook": "<notebook-id>",
  "hpath": "/Inbox/同名文档",
  "include": ["ids", "path", "hpath"]
}
```

返回的 `idPath.ids` 会列出匹配到的多个文档 ID。工具内部已包含 SQL 兜底，不需要调用方手写 `SELECT ... WHERE hpath = ... AND type = 'd'`。
