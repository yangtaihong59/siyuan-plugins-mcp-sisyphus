# av 工具

这个工具覆盖属性视图与数据库式操作。

适用场景：你需要查看或修改真实的思源属性视图，而不是用 Markdown 表格模拟数据库。

相关页面：

- [常见任务](../common-tasks.md)
- [权限模型](../permissions.md)

## 常见动作

| 分组 | 动作 |
|------|---------|
| 读取 | `get`, `render`, `get_attribute_view_keys`, `get_attribute_view_filter_sort`, `search`, `get_primary_key_values` |
| 行操作 | `add_rows`, `remove_rows`, `duplicate_rows` |
| 列操作 | `add_column`, `remove_column`, `set_column_options` |
| 单元格更新 | `set_cells` |
| 结构 | `duplicate` |

## 参数与语义

- `render` 在 `createIfNotExist=true` 且传入 `blockID` 时，也可创建并实体化 AV。此时 `blockID` 表示目标父级 / 插入上下文，MCP 会通过思源风格的 spun AV block DOM 与 transaction 完成插入。
- 渲染已有 AV 时，规范参数名是 `id`，值为 AV ID。为了减少 Agent 从 `search` 到 `render` 的参数转换，`render` 也接受 `avID` 作为兼容别名，且 `av.search` 结果会包含可复用的 `renderArgs`。
- 保留 `render(createIfNotExist=true)` 返回的 `blockID`。后续 AV 读写通常只需要 `avID`；MCP 会从行绑定块、镜像数据库块，或 blocks 表中的 AV 块记录自动解析 owning database block。需要固定某个数据库块视图、存在多个镜像候选，或需要为刚创建的空 AV 提供显式兜底时，再传 `blockID`。
- `set_cells` 由 `valueType` 决定值类型，既支持单格字段，也支持 `cells` / `items` 数组。
- `rowID` 指行 item ID，不是源块 ID。
- `set_column_options` 接收一个 `select` 或 `mSelect` 字段的完整目标选项列表。这是替换而不是补丁：列表中省略的名称会通过原生 transaction 操作被移除；空列表合法。引入新名称时，思源可能暂时保留追加顺序；此时 MCP 返回 `intermediate_option_order`，绝不会暗中发送第二笔排序事务。
- `duplicate_rows` 接收按顺序排列、且出现在持久顶层 view 中的规范**绑定**行 item ID；它会创建 detached 文本记录副本，不接受 detached 源行、单元格 value ID 或绑定源块 ID。主键文本和允许复制的单元格值会被复制，rollup/created/updated 则遵循思源的原生复制行为。双向 relation 的复制还会写入目标 AV 的反向值。
- AV 写操作会尽量对齐思源前端 transaction operation，包括行、列、单元格操作，以及数据库块 `updated` 刷新元数据。
- `duplicate` 对齐思源“复制为镜像”的流程：复制 AV 定义、生成数据库块 DOM，并通过 transaction 插入镜像数据库块。提供 `previousID` 时会作为插入位置；否则使用 `blockID` 或自动解析到的 owning database block 作为默认插入上下文。

## 安全规则

- AV 操作是真实数据库操作，不是 Markdown 表格编辑。
- 结构化数据应使用 `av`，不要在 Markdown 中模拟数据库行为。
- `set_column_options` 与 `duplicate_rows` 都是危险的 W2 写入：执行前需要用户明确确认，并先使用 `validateOnly=true` 做严格预检。`duplicate_rows` 还要求源 AV carrier 和每个已解析的反向 relation 目标 carrier 均具有 `rw` 或 `rwd` 权限。
- 如果任一 action 返回 `outcome_unknown` 或 `readback_mismatch`，不要自动重试；先检查精确的源 AV 和 relation 目标。

## 示例

MCP：

```json
{
  "action": "get",
  "id": "<attribute-view-id>"
}
```

```json
{
  "action": "add_column",
  "avID": "<attribute-view-id>",
  "keyName": "Status",
  "keyType": "select"
}
```

CLI：

```bash
siyuan av get --id <attribute-view-id>
siyuan av render --av-id <attribute-view-id>
siyuan av add-column --av-id <attribute-view-id> --key-name Status --key-type select
siyuan av add-rows --av-id <attribute-view-id> --block-ids <block-id>
siyuan av add-rows --av-id <attribute-view-id> --primary-key-texts "Plain text row"
```

## 动作列表

- `get`
- `render`
- `get_attribute_view_keys`
- `get_attribute_view_filter_sort`
- `search`
- `add_rows`
- `remove_rows`
- `add_column`
- `remove_column`
- `set_cells`
- `set_column_options`
- `duplicate_rows`
- `duplicate`
- `get_primary_key_values`
