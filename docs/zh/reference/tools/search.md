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
- `query_sql` 是只读操作，只接受 `SELECT` 语句；请自行添加 `LIMIT`。
- 搜索结果会在适用时按笔记本权限过滤。
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
