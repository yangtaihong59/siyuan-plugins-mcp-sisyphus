# 读取范围与数据库操作指引

文档、块、搜索及数据库的主要读取结果提供 `readInfo`。它区分“请求范围是否读完”和“这种表示包含什么”，不能用一个 `truncated=false` 代替两者。

| 字段 | 含义 |
| --- | --- |
| `scope` | 文档、块、数据库、列、视图查询、搜索查询、SQL 查询或主键查询 |
| `coverage` | `complete`：该范围在本次结果中完整返回；`partial`：明确只返回部分；`unknown`：内核信息不足以证明完整 |
| `representation` | `markdown`、`kramdown`、`textmark`、`html`、`database_raw`、`database_columns`、`view`、`search_snippets`、`sql_rows`、`primary_key_values` |
| `limitations` | 分页、从中间起读、权限过滤、未知总数、仅返回数据库占位块等已知限制 |

完整的视图结果只覆盖当前查询和视图，仍可能存在隐藏列、筛选条件。搜索摘要不是文档全文。Markdown 中的数据库占位块不包含数据库内部行列。最后一页没有下一页，也不代表这一次响应覆盖了前面的内容。

## 下一步调用

`nextSteps` 的每一项包含 `purpose`、`tool`、`arguments`。将 `arguments` 原样交给指定工具即可执行对应读取或帮助查询。它保留查询、视图、过滤及窗口参数，不生成写入值，也不替代权限检查。

- `continue_read`：继续窗口、搜索页、主键页或数据库视图。分组视图保留各组独立分页。
- `read_database`：用真实 `avID` 读取数据库；已确定承载块时同时传入 `blockID`。
- `read_view`：读取已有视图，明确 `createIfNotExist=false`。
- `read_match`：读取一个搜索命中块的内容。
- `edit_cells_help`：读取 `av.set_cells` 的完整参数帮助。

指引依据当前配置过滤禁用的工具/action；配置读取失败时省略指引。空 `nextSteps` 或字段缺失不能证明内容已完整，仍需检查 `readInfo` 和原有分页字段。未知分组总数或 ID 时不猜测续页参数。SQL 不自动重写，超过返回限制时应自行缩小查询或使用明确排序与 LIMIT/OFFSET。

## 数据库 ID 与字段位置

`databaseContext` 返回 `avID`、已明确的 `blockID`/`viewID`、列/行字段在现有响应中的位置及 `idUsage`。列类型与选项保留在 `av.keyValues[].key` 或 `keys` 中，避免再复制完整结构。

- `avID` 标识数据库；`blockID` 标识数据库承载块。镜像可能共用同一个数据库，未指定精确承载块时不猜选。
- `resolvedRows[].rowID` 是数据库行 ID；`sourceBlockID` 是绑定笔记块；单元格值 ID 不能替代它们。独立行没有源块。
- 列的 `key.id` 在 `set_cells` 中使用参数名 `columnID`，在列操作中按相应帮助使用 `keyID`。
- `get_primary_key_values` 的 `rows` 是 `{key, values}`，`blockIDs` 是数据库承载块列表，不能按位置与行配对。默认每页 16 条；`resolvedRows` 提供行映射，绑定行按源块权限过滤。

## 覆盖范围

当前覆盖 `fs.read`、`document.get_doc`、`block.get_kramdown/batch_kramdown`、`search.fulltext/semantic/query_sql`、`av.get/render/get_attribute_view_keys/get_primary_key_values`。MCP 和 CLI 使用相同的返回约定。其他读取 action 暂不承诺该字段。

全文搜索保留内核整页结果。权限或父级/标签过滤后，匹配总数未知时返回 `total=null`；`pageCount` 与 `hasNextPage` 仍用于继续扫描内核页，避免跳过后续命中。
