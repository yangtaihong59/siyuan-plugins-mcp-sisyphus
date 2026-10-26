# av 工具

用于真实思源数据库。常用流程是 **search → get → query → add_rows / set_cells**；数据库不是 Markdown 表格。

## 读取与创建

| action | 参数与职责 |
| --- | --- |
| `search` | 用 `keyword` 查找数据库；支持数据库名称和主键内容匹配，返回对象仍是数据库。 |
| `get` | 必填 `avID`，`scope` 为 `structure`（默认）、`columns`、`view`、`raw`。 |
| `query` | 必填 `avID`，`mode` 为 `rows`（默认）或 `primary_keys`；支持 `keyword`、`page`、`pageSize`。 |
| `create` | 必填 `parentID`，可选新的 `avID`；创建数据库和承载块，先预检领取 `requestId`。 |

`structure` 返回数据库身份、字段及规范 `columnID`、视图摘要和查询指引，不携带全量行 ID 或单元格值。`columns` 只读取字段定义；`view` 返回实际 `viewID` 及筛选、排序、分组、列显隐和顺序；`raw` 保留完整原始 AV。分页查询结果提供规范 `rowID`，不得用 `sourceBlockID` 或单元格值 ID 替代。

`get` 和行查询可传 `blockID` 作为已验证数据库块上下文。读取选择顺序是显式 `viewID`、块当前所选视图、内核默认视图；响应返回 `selectionSource` 和 `selectionFallback`。显式无效 ID 报错。**显式读取 B 不切换当前选中 A 的块**；使用该块更新 B 仍然拒绝。

行查询支持 `viewID` 和 `groupPaging`；主键模式默认每页 16 条，拒绝 `viewID`、`groupPaging`、`fields` 和负页大小。查询永远向内核传 `createIfNotExist=false`。下一步指引只引用真实 ID 和已启用入口；末页不再建议翻页，权限过滤和未知总数保持明确。

`query(mode="rows")` 只返回一份规范 `rows` 数组（`structureVersion: 2`）。每行保留稳定 `rowID`，单元格按稳定 `columnID` 投影为 `{ "value": <原始值>, "formatted": <内核 formattedContent（若有）> }`；可选 `fields` 传入稳定 `columnID` 列表，同时投影 `rows[].cells` 与 `columns`，始终保留 `rowID` 和分页信息；未知或当前视图不可读的字段会在返回前失败，不会伪装成缺失数据。`columns` 提供 `columnID`、名称和类型。分组结果额外带每行 `groupID` 与紧凑 `groups` 摘要。旧的 `data`、`table.rows`、`view.rows`、`resolvedRows` 重复字段已移除；完整原生 payload 请使用 `get(scope="raw")`。日期保留原始 epoch 表示，MCP 不猜测时区；`formatted` 使用内核值（包括嵌套的 `value.date.formattedContent`），即使当前视图未投影任何单元格，有效行仍会保留。每次行查询都会带迁移说明。

创建在首次执行前持久化稳定的 `avID`、`blockID`，记录 `ids_reserved`、`av_created`、`carrier_inserted`、`verified` 阶段。分配 `blockID` 不代表承载块已存在。部分完成或结果未知时，返回已知 ID、最后确认阶段和当前步骤，不能换新请求自动重新创建、补做或清理。相同请求先检查账本，完成时返回原业务结果；重启后也不会再次创建。新请求指定已有 AV 时拒绝。

严格 AV 写入发现载体时，会核对同一块元素的 `data-node-id`、`data-type` 和 `data-av-id`。包含数据库的父文档不是载体；显式 `blockID` 请使用创建回执中的真实数据库块 ID。省略可选 `blockID` 时，候选集合按块 ID 稳定选择，内核仅改变候选返回顺序不会使租约失效。实际载体、权限或数据库状态改变仍会拒绝旧预检。

## 更新视图

`update_view` 必填 `avID`、`blockID`、`viewID`。块必须真实属于该 AV，且当前精确选中该视图。

| 参数 | 行为 |
| --- | --- |
| `filters`、`sorts` | 完整替换；`[]` 清空。筛选最多四层组，随后为叶子。 |
| `group` | 完整替换；`{ "field": "" }` 清除分组。非空分组要求 `method`、`order`、`hideEmpty`，数值范围方式还要求 `range`。 |
| `columnVisibility` | `[{columnID, hidden}]`，仅修改列出的字段。 |
| `columnOrder` | 当前视图全部字段的完整顺序，包含隐藏字段，不是数据库字段全集。 |

未传项保持原样；`null`、未知字段、重复列 ID、缺失字段的顺序列表均拒绝。空显隐列表不贡献修改项，单独传入时拒绝；与其他有效设置一起传入可忽略。相同配置合法，返回 `no_change`，不发送 transaction。

`select` / `mSelect` 筛选值的每个 `mSelect` 选项必须提供 `content`；`color` 可省略，按内核默认空字符串处理。读回和 `no_change` 判断将省略颜色与 `""` 视为等价；显式颜色、选项内容和筛选组合仍须精确一致。

筛选组合节点只使用 `combination` 和 `filters`；`column`、`operator`、`value`、量词和相对日期属于子级叶子条件。单个节点混合组合与叶子字段会在写入前拒绝，因为内核会忽略这些叶子条件。

预检和正式提交均校验整个请求与布局字段；不支持的布局或设置在提交前拒绝。所有原生操作放进一次 transaction 请求，但不保证内核原子提交。回读检查每项目标值和未请求配置：显隐只允许指定列的 `hidden` 改变；顺序只允许位置变化，仍保护字段其他属性；分组使用原生派生状态归一化。发现额外变化时报告完整验证未通过，不推断变化一定来自本次操作。

## 写入与独立安全边界

- `add_rows`、`remove_rows`、`duplicate_rows` 管理行；`create_from_template` 独立，因为可能创建文档。
- `add_rows` 每次只能选择一种输入模式：`blockIDs` 为绑定行，`primaryKeyTexts` 为 detached 纯文本行，`rows:[{clientKey, primaryKeyText, cells}]` 为带初始单元格的复合 detached 行。复合 `rows` 与旧输入互斥；服务端会在任何写入前生成稳定 `rowID`，并持久化 `reserved → rows_created → cells_written → verified` 阶段。初始单元格只接受标量类型；relation 会被明确拒绝，因为写入它可能修改目的数据库，而该库的权限与预检范围不在本 action 内。若行已创建但单元格写入失败，回执保留精确 `rowID` 与阶段；不要对这些行重新执行 `add_rows`。重放时若阶段仍为 `reserved`，会保守报告为已尝试/未知，绝不报告零写入。
- `remove_rows` 接受规范 `rowIDs` 或明确标注为原生接口的 `srcIDs`，两者不可混用。服务端会在派发前按当前 AV 校验每个 `rowID`；无法确认的身份会零写入拒绝。
- `add_column`、`remove_column`、`set_column_options` 分别创建、删除和配置字段；选项是完整列表替换，省略选项会被移除。
- `set_cells` 更新普通单元格；关系值必须使用 `set_relation`，因为双向关系可能写入另一数据库。`itemID`、`relatedItemIDs` 都是 AV 行 ID，不是绑定块 ID。
- `set_new_item_templates`、`configure_two_way_relation`、`configure_rollup` 保留独立入口。文档模板需要明确的 `saveLocation`；Rollup 使用原生 `RollupCalc`。
- `add_view` 创建视图；看板必须已有 select 字段。`duplicate` 保留思源复制为镜像的行为。
- 写入遵循现有权限、用户确认和严格预检规则。所有严格 mutation 响应都包含规范化 `preflight` 对象；提交时原样复制 `preflight.commitArgs`。迁移期仍保留顶层 `requestId` 与哈希字段。即使关闭通用严格模式，`create` 与复合 `add_rows` 也必须有持久账本。

## 配置迁移

配置输出包含 `avActionsVersion:2`。缺失标记或版本 1 按旧格式迁移：

| 新入口 | 旧开关来源 |
| --- | --- |
| `create` | `render` |
| `get` | `get`、`get_attribute_view_keys`、`get_attribute_view_filter_sort` |
| `query` | `render`、`get_primary_key_values` |
| `update_view` | 五个原视图配置入口 |

先合并原始显式开关，再补默认值；任一来源为 false 则关闭新入口。旧 `get:true` 不覆盖字段读取入口的 false。只有版本 2 才直接解释新开关；未知版本报错并关闭 AV 访问。读取不自动写配置，保存时持久化标记并移除旧项。旧 action 和顶层 `id` 别名不再接受。

## 示例

```json
{"action":"get","avID":"<av-id>"}
{"action":"query","avID":"<av-id>","viewID":"<view-id>","fields":["<column-id>"],"page":1,"pageSize":20}
{"action":"query","avID":"<av-id>","mode":"primary_keys","keyword":"项目"}
{"action":"add_rows","avID":"<av-id>","rows":[{"clientKey":"event-1","primaryKeyText":"会议","cells":[{"columnID":"<date-column>","valueType":"date","date":1792540800000,"includeTime":false}]}],"validateOnly":true}
{"action":"remove_rows","avID":"<av-id>","rowIDs":["<row-id>"]}
{"action":"update_view","avID":"<av-id>","blockID":"<carrier-id>","viewID":"<view-id>","filters":[],"columnVisibility":[{"columnID":"<column-id>","hidden":true}],"validateOnly":true}
```

```bash
siyuan av get --av-id <av-id>
siyuan av get --av-id <av-id> --scope view --block-id <carrier-id>
siyuan av query --av-id <av-id> --page 1 --page-size 20
siyuan av create --parent-id <parent-id> --validate-only
```

参见[读取结果](../read-results.md)与[严格安全写入](../write-safety.md)。
