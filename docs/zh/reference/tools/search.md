# search 工具

这个工具覆盖全文搜索、语义搜索、反链、SQL 只读查询、资源搜索，以及受控查找替换。

适用场景：你需要跨工作区查找内容，或查询索引内容。

相关页面：

- [权限模型](../permissions.md)
- [错误类型](../error-types.md)

## 常见动作

| 分组 | 动作 |
|------|---------|
| 文本搜索 | `fulltext`, `semantic`, `search_refs` |
| 图谱 / 引用关系 | `get_backlinks`, `list_invalid_refs` |
| SQL / 资源 | `query_sql`, `search_assets`, `fulltext_asset_content` |
| 修改类 | `find_replace` |

## 安全规则

- `find_replace` 是本工具唯一的修改类操作，需要显式确认。
- `query_sql` 是只读操作，只接受 `SELECT` 语句；请自行添加 `LIMIT`。它会保留用户选择的全部列。所有笔记本都可读时原样执行（`scope.mode: "full"`）；只要存在不可读笔记本，就进入受限模式（`scope.mode: "restricted"`）：只能读取 `blocks`、`spans`、`attributes`、`assets`、`refs`、`file_annotation_refs`，`FROM`/`JOIN` 后的每个表引用都会被改写为只含可读笔记本行的子查询（`refs` 还要求被引用的定义块可读）；`sqlite_*`/`pragma_*`、带 schema 前缀的表名、其他表以及与表同名的 CTE 都会被拒绝。执行后仍能归属到不可读笔记本的行会再被过滤一次。首次使用受限模式前（之后每 30 分钟一次），服务器会先发送一条无害的自检语句，确认内核原样执行改写后的 SQL；自检失败时以 `restricted_sql_unavailable` 拒绝受限 SQL，绝不退回为不受限执行。
- `fulltext(methodName="sql")` 与数字参数 `method=2` 没有受限模式：存在不可读笔记本时直接拒绝。查询文档清单、块数/字符数、骨架候选或同名分组时，使用 [`document.query`](./document.md#权限范围内的文档查询)：服务器生成固定查询，在聚合前落实权限范围，不需要开放隐藏笔记本。
- 搜索结果会在适用时按笔记本权限过滤。
- `get_backlinks` 只需目标 `id`，使用内核全局反链查询。指定 `scopeRootId` / `refTreeID` 时改查对应引用文档；省略的 `keyword` 会补为空字符串以满足内核请求格式。
- 全文搜索可能略滞后于刚写入的内容，因为索引是最终一致的。
- `semantic` 要求思源 3.7.0+、已启用嵌入模型并完成原生嵌入索引；加密笔记本不会进入该索引。
- 插件的“嵌入模型”设置页在思源 3.7.0–3.7.1 可编辑原生配置；连接测试、索引统计、重建和失败项重试要求思源 3.7.2+。

## 示例

MCP：

```json
{
  "action": "fulltext",
  "query": "meeting notes",
  "methodName": "keyword",
  "sortBy": "relevance"
}
```

```json
{
  "action": "semantic",
  "query": "与弹性分布式系统相关的想法",
  "typeShortcodes": ["h", "p"]
}
```

```json
{
  "action": "query_sql",
  "sql": "SELECT id, content, type FROM blocks LIMIT 10"
}
```

CLI：

```bash
siyuan search fulltext --query "meeting notes" --method-name keyword --sort-by relevance
siyuan search semantic --query "与弹性分布式系统相关的想法" --type-shortcodes-json '["h","p"]'
siyuan search query-sql --sql "SELECT id, content, type FROM blocks LIMIT 10"
```

给 AI 调用方的提示：

- 优先使用 `methodName`、`sortBy`、`query`、`sql` 等语义别名，少用数字型 `method` / `orderBy` 或 `k` 这类短字段。
- `fulltext` 默认返回 `plainContent` 和 `excerpt`，不需要仅为了纯文本而设置 `stripHtml=true`。
- 涉及 `parentId`、`hasTags` 或权限过滤时，`kernel*` 元数据描述思源原始搜索页，`returned*` 元数据描述当前响应中的过滤后数据。

## 动作列表

- `fulltext`
- `semantic`
- `query_sql`
- `get_backlinks`
- `search_refs`
- `find_replace`
- `search_assets`
- `fulltext_asset_content`
- `list_invalid_refs`

参见 [读取范围与数据库操作指引](../read-results.md)。
