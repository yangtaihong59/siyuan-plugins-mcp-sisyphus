# SiYuan AI Interface Test Manual

这是一份给 AI 执行的**统一接口测试手册**，用于用 `CLI` 或 `MCP` 对同一套 SiYuan 能力做一致性验证。

本文件只规定测试目标、覆盖范围、判定标准、清理要求和最终报告结构；不提供 action 级参数教程或可直接照抄的调用提示词。执行者必须从当前接口暴露的 contract 获取调用细节：

- `MCP` 模式：以 MCP tool description、input schema、`action="help"` 和 `siyuan://help/...` resources 为准
- `CLI` 模式：以 `siyuan-sisyphus help`、`siyuan-sisyphus list` 和实际 flag 映射为准

它吸收了 `tests/AI_TEST_WORKFLOW.md` 的“可执行流程”写法，但保持**接口无关**：

- `AI_INTERFACE_TEST.md`：统一入口，适合整轮回归、CLI/MCP 对照、人工监督执行
- `tests/AI_TEST_WORKFLOW.md`：更偏 MCP 单接口的长流程细化参考

如两份文档与**当前工具 contract**不一致，以当前工具 contract 为准；不要照搬旧别名、旧示例或过时参数。

---

## 1. 目标与总原则

目标：让 AI 在测试开始时先确认本轮测试走 `CLI` 还是 `MCP`，然后**全程只使用这一种连接方式**去操作同一个 SiYuan，测试动作、断言标准、清理要求保持一致。

必须遵守：

1. 测试开始前先确定并输出：`TEST_MODE=CLI` 或 `TEST_MODE=MCP`
2. 一旦选定，本轮**不得切换接口**
3. 只能操作本轮新建的测试对象，不得修改或删除用户已有对象
4. 每一步都要记录：
   - 连接方式
   - `tool` / `action`
   - 实际调用摘要
   - 返回摘要
   - 结论：`PASS` / `FAIL` / `BLOCKED`
5. 删除、移动、权限修改、批量替换、上传文件等高风险动作，只能针对本轮测试对象执行
6. 测试结束后必须清理测试对象；若清理失败，必须明确列出残留对象
7. 如果环境不满足前置条件，应标记 `BLOCKED`，不得臆造成功结果
8. 若接口返回 `partial: true`、`reason: "permission_filtered"`、`filteredOutCount > 0`，应按“权限过滤”语义判断，不得误判为接口故障

---

## 2. 测试模式选择

### 2.1 模式选择

AI 在正式执行前必须先确认本轮模式：

- `TEST_MODE=CLI`
- `TEST_MODE=MCP`

如果用户没有指定，应先询问用户要测哪一种。

### 2.2 统一语义，不同入口

同一个业务动作，在两种模式下的语义必须一致，只是入口不同：

- `CLI`：`siyuan-sisyphus <tool> <action> ...` 或 `siyuan <tool> <action> ...`
- `MCP`：`tool(action="...")`

调用细节不得从本测试文件推断。执行前应先读取或调用当前接口提供的帮助与 schema，再自行组织参数。

---

## 3. 覆盖范围

本手册覆盖以下 14 个聚合工具：

- `fs`
- `notebook`
- `document`
- `block`
- `av`
- `file`
- `search`
- `tag`
- `timeline`
- `system`
- `flashcard`
- `extension`
- `mascot`
- `feedback`

重点覆盖：

- 工具与 action 是否可见
- 基础读写链路是否正常
- 路径与树结构语义是否正确
- 笔记本权限模型是否正确
- 搜索 / 标签 / 系统接口是否正常
- 时间线节点创建、文档 diff、危险回档与默认关闭策略是否正常
- flashcard 的只读发现链路与条件式写链路
- AV 的创建、读写、复制、删除链路
- 清理是否完整

---

## 4. 执行前检查

### 4.1 通用前置条件

开始前必须确认：

- SiYuan 正在运行且 API 可访问
- 当前接口已完成认证（token / profile / MCP 连接）
- 至少有一个可读的已打开笔记本
- 本轮允许创建并删除测试笔记本、测试文档和测试块
- AI 有能力记录并回放本轮创建对象的 ID / 路径 / 标签

如任一条件不满足，停止测试并报告失败原因。

### 4.2 `CLI` 模式检查

必须确认：

- `siyuan-sisyphus` 或 `siyuan` 命令可执行
- 已配置 `apiUrl` / `token`，或用户允许通过 flag 指定
- 能成功执行系统版本读取动作

### 4.3 `MCP` 模式检查

必须确认：

- MCP server 可连接
- 能列出工具
- 能成功执行系统版本读取动作

### 4.4 工具可见性

必须能看到以下工具：

- `fs`
- `notebook`
- `document`
- `block`
- `av`
- `file`
- `search`
- `tag`
- `system`
- `flashcard`
- `mascot`

如果工具缺失：

- 无法连接或无法列工具：`BLOCKED`
- 工具注册异常或描述缺失：`FAIL`

---

## 5. 状态追踪变量

在执行过程中，应把以下变量记录在内存或测试日志中，后续步骤会引用它们。

| 变量名 | 必填 | 说明 |
| --- | --- | --- |
| `$TEST_MODE` | 是 | `CLI` 或 `MCP` |
| `$TEST_TS` | 是 | 时间戳，建议用于所有测试对象命名 |
| `$TEST_TAG` | 是 | 本轮唯一测试标签，如 `#ai-interface-test-<timestamp>#` |
| `$TEST_NB_ID` | 是 | 主测试笔记本 ID |
| `$TEST_NB_NAME` | 是 | 主测试笔记本名称 |
| `$ROOT_DOC_PATH` | 是 | 主测试文档的人类可读路径 |
| `$ROOT_DOC_ID` | 是 | 主测试文档 ID |
| `$ROOT_DOC_STORAGE_PATH` | 是 | 主测试文档存储路径（来自 `document.lookup`） |
| `$CHILD_DOC_PATH` | 是 | 子文档的人类可读路径 |
| `$CHILD_DOC_ID` | 是 | 子文档 ID |
| `$CHILD_DOC_STORAGE_PATH` | 建议 | 子文档存储路径 |
| `$BLOCK_ID_1` | 是 | 主测试块 ID |
| `$BLOCK_ID_2` | 建议 | 第二个测试块 ID |
| `$TAGGED_BLOCK_ID` | 建议 | 带唯一标签/关键字的块 ID |
| `$AV_BLOCK_ID` | 是 | 本轮创建的数据库块 ID |
| `$AV_ID` | 是 | 本轮创建的属性视图 ID |
| `$AV_ROW_IDS` | 建议 | `add_rows` 返回的真实行 ID 列表 |
| `$AV_DETACHED_ROW_ID` | 建议 | detached 行 ID |
| `$AV_COLUMN_ID` | 建议 | 本轮新增测试列 ID |
| `$AV_DUPLICATE_BLOCK_ID` | 建议 | `duplicate` 生成的数据库块 ID |
| `$ORIGINAL_PERMISSION` | 是 | 主测试笔记本原始权限；若未显式配置，按 `r` 记录 |
| `$TEMP_DELETE_DOC_PATH` | 建议 | 专门用于删除权限测试的文档路径 |
| `$TEMP_DELETE_DOC_STORAGE_PATH` | 建议 | 对应存储路径 |
| `$FILTER_VISIBLE_NB_ID` | 条件 | 用于权限过滤专项的“可见”对照笔记本 ID |
| `$FILTER_HIDDEN_NB_ID` | 条件 | 用于权限过滤专项的“受限”笔记本 ID；通常可复用 `$TEST_NB_ID` |
| `$FILTER_KEYWORD` | 条件 | 用于搜索过滤验证的唯一关键字 |
| `$CARD_BLOCK_ID` | 条件 | 闪卡测试块 ID |
| `$REVIEW_CARD_ID` | 条件 | 用于复习的闪卡 ID |
| `$PROMPT_GAP_LOG` | 是 | 本轮所有“首次误调用、报错后才修正”的记录列表，用于反向改进 MCP 工具提示词 |

---

## 6. 记录格式与结论定义

### 6.1 每一步至少记录

- 步骤号
- `TEST_MODE`
- `tool`
- `action`
- 实际调用摘要
- 新产生或消费的变量
- 关键返回摘要
- 结论：`PASS` / `FAIL` / `BLOCKED`
- 如果发生误调用：记录首次错误调用、错误摘要、修正后的调用、根因判断

### 6.2 结论定义

| 结论 | 含义 |
| --- | --- |
| `PASS` | 接口行为符合预期，包括成功结果和“预期的权限拒绝/确认拒绝” |
| `FAIL` | 接口行为与预期不符，或返回结构明显异常 |
| `BLOCKED` | 环境前提不足、真实资源缺失、需要用户额外授权，导致无法继续 |
| `MISS` | 本轮未覆盖该 action，仅在最终覆盖矩阵中使用 |

### 6.3 权限相关判定规则

- 写/删类操作：权限不足时返回 `permission_denied`（或等价错误）属于 `PASS`
- 搜索/列表类操作：权限不足时返回部分结果，并携带 `partial: true`、`reason: "permission_filtered"`、`filteredOutCount` 属于 `PASS`
- 如果本应被拒绝的写/删操作成功执行，则为 `FAIL`
- 如果本应可读的对象在 `rwd` / `rw` / `r` 下读失败，则为 `FAIL`

### 6.4 误调用与提示词缺口记录

测试过程中的失败不只用于判断接口是否可用，也要用于改进 MCP 暴露给 AI 的提示质量。凡是出现“AI 先按错误参数 / 错误 action / 错误语义调用，看到报错后才改对”的情况，都必须记录到 `$PROMPT_GAP_LOG`。

必须记录的字段：

| 字段 | 说明 |
| --- | --- |
| `tool` | 聚合工具名 |
| `action` | 目标 action；如果 action 写错，也要记录错误 action |
| `wrong_call` | 首次错误调用的关键参数或 CLI 命令 |
| `error_summary` | 返回的错误摘要，不需要粘贴完整堆栈 |
| `fixed_call` | 修正后成功或更接近正确语义的调用 |
| `why_ai_got_it_wrong` | AI 为什么会误判：字段名不清、必填/可选不清、ID 类型不清、旧别名干扰、帮助文案不足等 |
| `mcp_prompt_suggestion` | 建议修改的 tool description、action hint、schema description、help 文档或示例 |

以下情况必须记录：

- action 名称混用，例如 CLI kebab-case 与 MCP snake_case 混淆
- 把 human-readable path 与 storage path 用错
- 把 source block ID、cell value ID、row item ID 混用
- 把可选参数误认为必填，或把必填参数误认为可省略
- 把危险动作确认、权限拒绝、permission filtered 误判为接口故障
- 看了错误响应才知道应该调用 `help`、资源文档或另一个 action

以下情况不必记录为提示词缺口：

- 网络中断、SiYuan 未启动、token 错误等纯环境问题
- 用户临时改变测试范围导致的调用调整
- 已经由当前文档明确要求“预期失败”的权限验证

---

## 7. 建议覆盖策略

建议按下表区分“必测 / 建议测 / 条件测”。

| 工具 | 必测 | 建议测 | 条件测 / 高风险 |
| --- | --- | --- | --- |
| `fs` | `ls`、`tree`、`read`、`write`、`replace`、`search` | 根路径 `/` 的可读笔记本过滤、跨笔记本路径消歧 | `rm`、`mv`；必须纳入权限矩阵，`rm/mv` 只作用于本轮测试文档 |
| `system` | `get_version`、`get_current_time`、`conf` | `network`、`notify` | `workspace_info`、`perform_sync` |
| `notebook` | `list`、`create`、`rename`、`get_conf`、`get_child_docs`、`set_open_state`、`get_permissions`、`set_permission`、`remove` | `set_icon`、`set_conf` | 仅对本轮测试笔记本改权限 |
| `document` | `create`、`lookup`、`get_child_docs`、`list_tree`、`search_docs`、`get_doc`、`remove` | `get_child_blocks`、`duplicate`、`set_attr` | `move`、`create_daily_note` |
| `block` | `append`、`prepend`、`insert`、`update`、`get_children`、`get_kramdown`、`get_attrs`、`set_attrs`、`info`、`word_count`、`breadcrumb`、`dom`、`delete` | `insert.blocks`、`update.items`、`recent_updated`、`transfer_references`、`add_to_daily_note`、`docs_info` | `move`、`set_fold_state` |
| `search` / `tag` | `fulltext`、`query_sql`、`get_backlinks`、`tag.list(keyword)` | `semantic`（思源 3.7.0+ 且需已配置嵌入模型与索引）、`search_refs`、`search_assets`、`fulltext_asset_content`、`fulltext_asset_content(assetId)`、`tag.rename` | `find_replace`、`tag.remove` |
| `file` | `render(engine="sprig")`、`export_md`、`get_doc_assets` | `list_templates`、`read_template`、`create_template`、`update_template`、`save_doc_as_template`、`render(engine="template")`、`get_image_ocr_text` | `delete_template`、`upload_asset`、`export_resources`、`remove_unused_assets`、`delete_asset` |
| `flashcard` | `get_decks`、`list_cards`、`get_cards` | `create_card(mode="full")`、`create_card(mode="attach")`、`review_card`、`review_card(skip=true)`；`review_card.reviewedCards` 参数校验 | `remove_card` |
| `mascot` | `get_balance` | `shop` | `buy` |
| `av` | `render`、`get`、`get_attribute_view_keys`、`get_attribute_view_filter_sort`、`search`、`get_primary_key_values`、`add_rows`、`add_column`、`set_cells`、`duplicate`、`remove_rows`、`remove_column` | detached 行、空 `add_rows` no-op | 只在本轮创建的真实 AV 上执行 |

---

## 8. 核心测试流程

以下流程对 `CLI` 和 `MCP` 完全一致，只是调用入口不同。

### 8.1 System（系统）

至少执行：

- `system.get_version`
- `system.get_current_time`
- `system.conf`（建议 `mode="summary"`）

建议补充：

- `system.network`

条件执行：

- `system.notify`（分别覆盖 `level="info"` 和 `level="error"`）
- `system.workspace_info`（高风险，仅在用户允许时）
- `system.perform_sync`（高风险，仅在用户允许且测试环境允许触发同步时）

通过标准：

- `get_version` 返回可识别版本字段
- `get_current_time` 返回时间或时间戳
- `conf` 返回配置摘要或指定键值
- 其余动作返回结构自洽、无异常

### 8.2 Notebook（笔记本）

至少执行：

1. `notebook.list`
2. `notebook.create`
3. `notebook.rename`
4. `notebook.get_conf`
5. `notebook.get_child_docs`
6. `notebook.set_open_state`（关闭再打开）
7. `notebook.get_permissions`
8. `notebook.set_permission`
9. `notebook.remove`

要求验证：

- 创建后，`list` 能看到 `$TEST_NB_ID`
- `rename` 后名称变化可见
- 新建笔记本初始 `get_child_docs` 应为空或结构合理的空结果
- `get_permissions` 中若未显式出现 `$TEST_NB_ID`，应记录 `$ORIGINAL_PERMISSION=rwd`
- 删除前必须确认没有把权限停留在 `r` / `none`

建议命名：

- 测试笔记本：`AI Interface Test <timestamp>`
- 重命名后：`AI Interface Test <timestamp> Renamed`

### 8.3 Document（文档）

至少执行：

- `document.create`
- `document.lookup`
- `document.get_child_docs`
- `document.list_tree`
- `document.search_docs`
- `document.get_doc`
- `document.remove`

要求验证：

- 创建主文档、子文档和临时删除文档，并记录后续清理所需的 ID / 路径信息
- 通过 `lookup` 获取足够的定位信息，用于后续树、读取、删除和清理验证
- `get_child_docs` 只返回直属子文档
- `list_tree` 返回合理树结构
- 文档删除能力只作用于本轮创建的文档；如遇短暂索引窗口，可按当前工具帮助给出的替代方式重试
- `search_docs` 是标题级搜索，不是全文搜索

推荐最小文档集：

1. 主测试文档 `$ROOT_DOC_ID`
2. 子文档 `$CHILD_DOC_ID`
3. 一个用于删除验证的临时文档 `$TEMP_DELETE_DOC_PATH`

### 8.4 Block（块）

至少执行：

- `block.append`
- `block.prepend`
- `block.insert`
- `block.update`
- `block.get_children`
- `block.get_kramdown`
- `block.get_attrs`
- `block.set_attrs`
- `block.info`
- `block.word_count`
- `block.breadcrumb`
- `block.dom`
- `block.delete`

建议补充：

- `block.insert` 的 `blocks[]` 批量形态
- `block.update` 的 `items[]` 批量形态
- `block.recent_updated`
- `block.transfer_references`

条件执行：

- `block.move`
- `block.set_fold_state`

要求验证：

- 至少有一个块写入唯一关键字和测试标签，以支撑 `search` / `tag` 用例
- `set_attrs` 后再次 `get_attrs` 能看到更新
- `delete` 后用 `block.info` 或 `block.get_attrs` 的 not-found 错误验证对象已不存在
- `word_count` 对传入的 `ids` 数组返回统计结构
- 折叠状态相关 action 如被覆盖，应以当前接口暴露的 action contract 为准

### 8.5 Search / Tag / File / Flashcard / Mascot

#### Search

至少执行：

- `search.fulltext`
- `search.query_sql`（只测 `SELECT` / `WITH`）
- `tag.list(keyword)`
- `search.get_backlinks`（覆盖 `mode="links"`、`mode="mentions"` 或 `mode="both"`）

要求验证：

- 用唯一关键字命中本轮测试文档或测试块
- `query_sql` 必须带 `LIMIT`
- `query_sql` 只允许单条 `SELECT`，或主语句为 `SELECT` 的 `WITH` / `WITH RECURSIVE` CTE
- 非 `SELECT` / `WITH` 语句应被拒绝；`WITH ... DELETE/UPDATE/INSERT`、`SELECT ...; DELETE ...` 这类隐藏写入也应在请求 SiYuan 前被拒绝
- SQL 字符串字面量和注释中的 `DELETE` / `UPDATE` 等词不应误触发拒绝
- 当存在权限过滤时，检查 `partial` / `reason` / `filteredOutCount`

#### Tag

至少执行：

- `tag.list`

建议执行：

- `tag.rename`
- `tag.remove`

要求：

- 只操作本轮测试标签 `$TEST_TAG`
- `rename` / `remove` 后应再次验证列表或搜索结果

#### File

优先覆盖低风险 action：

- `file.render(engine="sprig")`
- `file.export_md`
- `file.get_doc_assets`

建议补充：

- `file.render(engine="template")`
- `file.get_image_ocr_text`

仅在满足真实测试条件时执行：

- `file.upload_asset`
- `file.export_resources`
- `file.remove_unused_assets`
- `file.delete_asset`

#### Flashcard

优先执行只读链路：

- `flashcard.get_decks`
- `flashcard.list_cards`
- `flashcard.get_cards`

只有在已经拿到真实 `deckID` / `cardID`，且确认不会污染用户数据时，才允许执行：

- `flashcard.create_card`
- `flashcard.create_card(mode="attach")`
- `flashcard.review_card`
- `flashcard.review_card(skip=true)`
- `flashcard.remove_card`

`review_card` 补充验证：

- 覆盖普通复习、跳过复习和已复习卡片列表透传
- 参数校验应由当前 schema 决定；非法参数不得调用内核复习接口

#### Mascot

至少执行：

- `mascot.get_balance`

建议执行：

- `mascot.shop`

只有余额足够且安全时才执行：

- `mascot.buy`

---

## 9. AV / 数据库专项规则

AV 测试必须走**本轮创建真实 AV** 的主路径，不得把“复制已有数据库”当作主测试流程。

### 9.1 主测试路径

标准起手动作是 `av.render` 创建本轮测试 AV。具体创建参数必须从当前 MCP schema/help 或 CLI help 获取，不在本手册中展开。

创建成功后，必须立即记录两个标识：

- `$AV_ID`：返回中的 `avID` / `id`
- `$AV_BLOCK_ID`：materialized 数据库块 ID

后续 AV 读写、复制和清理动作必须围绕本轮创建的 AV 执行。字段名、上下文参数和行/列/单元格 ID 语义以当前工具 contract 为准。

`render` 与 `duplicate` 都应物化真实思源数据库块。验证时不应出现前端损坏的 AV DOM，也不应产生与 AV ID 被误当作文档 / 块 ID 解析相关的持续内核错误日志。

以下写操作都应覆盖默认上下文路径；如需排查上下文歧义，再按当前工具帮助补测显式上下文路径：

- `add_rows`
- `add_column`
- `remove_rows`
- `remove_column`
- `set_cells`

### 9.2 标准调用链路

AI 必须在自己创建的 AV 上完成以下动作链路：

1. `render`
2. `get`
3. `get_attribute_view_keys`
4. `get_attribute_view_filter_sort`
5. `search`
6. `get_primary_key_values`
7. 创建 3 个普通块，准备绑定为数据库行
8. `add_rows`，分别覆盖绑定块行与 detached 纯文本主键行
9. `add_column`
10. `set_cells` 单格写入
11. `set_cells` 批量写入
12. `duplicate`
13. `remove_rows`
14. `remove_column`
15. 可选：空 `add_rows` no-op 验证

### 9.3 通过标准

| 动作 | 通过标准 |
| --- | --- |
| `render` | 成功创建 AV 块，并返回后续读写和清理所需的 AV / block 标识 |
| `get` | 能获取完整 AV 结构 |
| `get_attribute_view_keys` | 初始至少返回主键列；额外列视环境而定 |
| `get_attribute_view_filter_sort` | 能返回当前筛选 / 排序信息；空结构也算通过 |
| `search` | 能正常返回搜索结果或合理空结果 |
| `get_primary_key_values` | 能返回主键值列表 |
| `add_rows` | 成功添加绑定块行，并拿到真实行标识 |
| detached 行 | 成功添加 detached 纯文本主键行，并返回后续可操作的行标识 |
| 空 `add_rows` | 不报错，并明确说明未执行实际新增 |
| `add_column` | 成功新增测试列 |
| `set_cells` | 能给指定行写入单元格值，也能批量写入值 |
| `duplicate` | 能按思源“复制为镜像”流程复制出新的 AV 块；空 AV 与有行 AV 都应通过 |
| `remove_rows` | 能删除指定测试行 |
| `remove_column` | 能删除本轮新增测试列 |

### 9.4 AV 强约束

AI 不得：

- 把“复制已有数据库”当作 AV 主测试路径
- 跳过通过 `render` 创建本轮测试 AV
- 创建 AV 后不记录 `$AV_ID` 与 `$AV_BLOCK_ID`
- 只覆盖显式上下文路径而不覆盖默认上下文路径
- 用 Markdown 表格冒充真实 AV
- 在没有真实行标识的情况下伪造 `set_cells` 成功
- 混用绑定块、单元格 value、源块和行 item 等不同标识
- 把空结果或提示性结果误判为接口失败

---

## 10. 笔记本权限模型专项

这一节是本手册的**必测重点**。必须增强验证，不再只做“最小只读/无权限试探”。

### 10.1 权限模型

| 权限 | 读 | 写 | 删 |
| --- | --- | --- | --- |
| `rwd` | 允许 | 允许 | 允许 |
| `rw` | 允许 | 允许 | 不允许 |
| `r` | 允许 | 不允许 | 不允许 |
| `none` | 不允许 | 不允许 | 不允许 |

补充规则：

- 未配置的笔记本默认视为 `r`（只读）；新建测试笔记本后若要执行写/删基线，先显式设置为 `rwd`
- 权限变更通过 `notebook.set_permission` 生效于后续调用
- CLI 模式下，命令发出即视为用户确认；MCP 模式下，权限修改属于高风险动作
- 删除权限与写权限不同：`rw` 允许写，但不允许删除
- `fs` 是基础路径操作入口，权限专项必须覆盖 `fs.read` / `fs.write` / `fs.replace` / `fs.search` / `fs.rm` / `fs.mv`。其中 `fs.rm` 需要删权限；当前 `fs.mv` 需要源和目标笔记本写权限，不要求删权限。

### 10.2 执行边界

权限测试必须只针对**本轮测试笔记本**执行：

- 允许：新建测试笔记本、在其内部读写删、调整其权限、恢复其权限
- 禁止：对用户已有笔记本做权限降级或破坏性测试
- 建议：在降级权限前，先完成主数据准备（主文档、子文档、测试块、临时删除文档、AV 初建）

### 10.3 权限测试前准备

在开始权限矩阵前，必须先完成：

1. `notebook.get_permissions`，记录 `$ORIGINAL_PERMISSION`
   - 如果没有 `$TEST_NB_ID` 的显式条目，记录为 `r`
2. 确保存在以下可复用对象：
   - `$ROOT_DOC_ID`
   - `$ROOT_DOC_STORAGE_PATH`
   - `$BLOCK_ID_1`
   - `$TEMP_DELETE_DOC_STORAGE_PATH`
3. 为搜索过滤专项准备一个唯一关键字 `$FILTER_KEYWORD`
4. 如要验证“部分过滤”，建议再创建一个**始终保持可读**的对照笔记本 `$FILTER_VISIBLE_NB_ID`

### 10.4 `rwd`：全权限基线

必须验证：

- 读成功：
  - `fs.read`
  - `fs.search`
  - `notebook.get_conf`
  - `document.get_doc`
  - `block.get_kramdown`
- 写成功：
  - `fs.write` 创建或覆盖本轮测试文档
  - `fs.replace` 修改本轮测试文档中的唯一文本
  - `document.create` 或 `block.append`
  - `block.set_attrs`
- 删成功：
  - `fs.rm` 删除本轮临时文档
  - `document.remove` 删除本轮临时文档
  - 或 `block.delete` 删除本轮测试块

通过标准：

- `get_permissions` 确认当前为 `rwd`
- 读/写/删动作均按预期成功

### 10.5 `rw`：可读可写，不可删

步骤：

1. `notebook.set_permission(permission="rw")`
2. 再次 `get_permissions` 确认 `$TEST_NB_ID=rw`
3. 执行读验证
4. 执行写验证
5. 执行删验证（应失败）

建议验证动作：

- 读成功：`document.get_doc`、`block.get_children`、`fs.read`、`fs.search`
- 写成功：`block.append`、`document.create`、`fs.write`、`fs.replace`、`fs.mv`
- 删失败：
  - `fs.rm`
  - `document.remove`
  - `block.delete`
  - `document.move` 或 `block.move` 也可作为补充，因为移动通常需要更高权限边界

通过标准：

- 读成功
- 写成功
- 删被拒绝，且返回 `permission_denied` 或等价权限错误

### 10.6 `r`：只读，不可写，不可删

步骤：

1. `notebook.set_permission(permission="r")`
2. 再次 `get_permissions` 确认 `$TEST_NB_ID=r`
3. 执行读验证
4. 执行写验证（应失败）
5. 执行删验证（应失败）

建议验证动作：

- 读成功：`notebook.get_conf`、`document.get_doc`、`block.get_kramdown`、`fs.read`、`fs.search`
- 写失败：
  - `fs.write`
  - `fs.replace`
  - `fs.mv`
  - `document.create`
  - `block.append`
  - `block.update`
  - `block.set_attrs`
  - AV 写动作可作为补充失败验证
- 删失败：
  - `fs.rm`
  - `document.remove`
  - `block.delete`

通过标准：

- 读成功
- 所有写/删动作被拒绝

### 10.7 `none`：无读写删权限

步骤：

1. `notebook.set_permission(permission="none")`
2. 再次 `get_permissions` 确认 `$TEST_NB_ID=none`
3. 执行读验证（应失败）
4. 执行写验证（应失败）
5. 执行删验证（应失败）

建议验证动作：

- 读失败：
  - `fs.read`
  - `fs.search`
  - `notebook.get_conf`
  - `notebook.get_child_docs`
  - `document.lookup`
  - `document.get_doc`
  - `block.get_children`
  - `block.get_kramdown`
  - `block.get_attrs`
- 写失败：
  - `fs.write`
  - `fs.replace`
  - `fs.mv`
  - `document.create`
  - `block.append`
  - `block.update`
- 删失败：
  - `fs.rm`
  - `document.remove`
  - `block.delete`

通过标准：

- 所有读/写/删动作被拒绝
- 不得把“完全被拒绝”误判为系统异常

### 10.8 权限过滤专项：验证 `permission_filtered`

这是对权限模型的增强检查，建议至少做一次。

#### 推荐做法

构造两个笔记本共享同一唯一关键字：

- 可见笔记本：保持 `rwd`
- 受限笔记本：使用 `$TEST_NB_ID`，切到 `none` 或 `r`

然后在两个笔记本中都创建包含 `$FILTER_KEYWORD` 的测试内容，再执行搜索类动作。

#### 最稳妥的验证顺序

1. 在可见笔记本创建一条包含 `$FILTER_KEYWORD` 的文档或块
2. 在受限笔记本创建一条包含相同 `$FILTER_KEYWORD` 的文档或块
3. 把受限笔记本权限降为 `none`
4. 运行：
   - `search.query_sql`
   - 推荐再运行 `search.fulltext`
5. 观察返回：
   - 可见笔记本中的结果仍能看到
   - 受限笔记本中的结果被过滤掉
   - 返回中出现 `partial: true`
   - 返回中出现 `reason: "permission_filtered"`
   - 返回中出现 `filteredOutCount >= 1`

#### 判定规则

以下都应判为 `PASS`：

- 结果被裁剪，但元数据明确说明是权限过滤
- 仅返回可见笔记本的数据，并标明过滤计数

以下判为 `FAIL`：

- 受限笔记本数据仍泄露
- 所有结果被吞掉但没有说明权限过滤，且上下文显示本应存在可见结果
- 本应被过滤的结果仍被完整返回

注意：`fulltext` 受索引时延影响，如果刚写入内容没被搜到，可以短暂重试一次；若仍不稳定，标记 `BLOCKED` 并说明“索引尚未收敛”。

### 10.9 权限恢复

权限专项结束后，必须恢复：

1. 优先恢复 `$ORIGINAL_PERMISSION`
2. 若原始值无法可靠识别，恢复到 `r`
3. 恢复后再次执行一个读动作和一个写动作，确认权限恢复生效

建议恢复验证：

- 读：`document.get_doc`
- 写：`block.append`

如恢复失败：

- 本轮测试不得宣称 `CLEAN`
- 清理结论必须为 `DIRTY`
- 必须列出当前仍受限且无法清理的对象

---

## 11. 清理要求

测试结束后必须确认：

1. 恢复测试期间修改过的权限
2. 删除本轮创建的测试块
3. 删除本轮创建的测试文档与子文档
4. 删除本轮创建或复制出的测试 AV / 数据库块
5. 删除本轮新增的 AV 行与列
6. 删除本轮测试标签
7. 删除本轮测试笔记本
8. 如果创建了权限过滤对照笔记本，也必须删除

建议清理顺序：

1. 恢复权限到 `$ORIGINAL_PERMISSION` 或 `r`
2. 删除 AV 复制块、测试列、测试行
3. 删除临时测试块
4. 删除子文档、主文档、临时删除文档
5. 删除对照笔记本中的测试对象
6. 删除主测试笔记本和对照笔记本
7. 最后再验证 `notebook.list` 中不再包含测试笔记本

若清理失败，必须明确列出残留对象，不得谎称“清理完成”。

---

## 12. 最终报告格式

最终报告必须包含：

### 12.1 头信息

- `TEST_MODE=CLI` 或 `TEST_MODE=MCP`
- 测试时间
- 目标版本（如能获取）
- 连接环境摘要（如 CLI profile / MCP server）

### 12.2 变量快照

至少列出：

- `$TEST_NB_ID`
- `$ROOT_DOC_ID`
- `$CHILD_DOC_ID`
- `$AV_ID`
- `$AV_BLOCK_ID`
- `$AV_DETACHED_ROW_ID`（如覆盖 detached 行）
- `$ORIGINAL_PERMISSION`
- 如使用：`$FILTER_VISIBLE_NB_ID`、`$FILTER_KEYWORD`

### 12.3 步骤结果表

每一步包含：

- 步骤号
- `tool`
- `action`
- `PASS` / `FAIL` / `BLOCKED`
- 关键返回摘要

### 12.4 覆盖矩阵

对每个 action 标记：

- `PASS`
- `FAIL`
- `BLOCKED`
- `MISS`

### 12.5 权限矩阵结果

至少单列：

- `rwd`：读 / 写 / 删
- `rw`：读 / 写 / 删
- `r`：读 / 写 / 删
- `none`：读 / 写 / 删
- `permission_filtered` 专项：是否验证通过
- 权限恢复：是否验证通过

### 12.6 问题汇总

至少区分：

- 真实缺陷
- 环境限制
- 符合预期的拒绝 / 过滤行为

### 12.7 MCP 提示词缺口与建议修改

必须单列本轮 `$PROMPT_GAP_LOG`。如果没有误调用，也要写“未发现”。

每条记录至少包含：

- 误调用的 `tool/action`
- 首次错误调用摘要
- 报错摘要
- 修正后的调用摘要
- 判断为 MCP 提示不足的原因
- 建议改动位置，例如：
  - `src/core/help.ts` 的 action hint
  - `src/core/types.ts` 的 schema description
  - `src/tools/<tool>/index.ts` 的 variant description
  - `docs/reference/tools/*.md`
  - `server-instructions` 或 tool description 的全局约束

输出建议时要具体到“应新增/改写什么信息”，不要只写“优化提示词”。本报告只记录缺口，不在测试手册中沉淀可复制的调用提示词。

### 12.8 清理结论

- `CLEAN`
- `DIRTY`

如为 `DIRTY`，必须列出残留对象 ID / 路径 / 笔记本。

---

## 13. 一句话执行提示

可以直接给 AI 这样的指令：

- `请按 AI_INTERFACE_TEST.md，用 CLI 模式完整测试，只测 CLI，不要切到 MCP。`
- `请按 AI_INTERFACE_TEST.md，用 MCP 模式完整测试，只测 MCP，不要切到 CLI。`
- `请按 AI_INTERFACE_TEST.md，重点做笔记本权限模型专项，并验证 permission_filtered 元数据。`
