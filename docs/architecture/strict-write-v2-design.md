# Strict Write v2：按任务批量提交

状态：已实施，本轮限定场景验收完成，未发布。2026-10-20。验收范围见 [实施与验收记录](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/docs/testing/archive/STRICT_WRITE_V2_ACCEPTANCE_20261020.md)。

## 目标与边界

保留权限、action 开关、完整状态哈希、持久化幂等账本、写后读回及未知状态停止；把客户端的字段猜测和重复往返收敛到“一次任务预检 + 一次任务提交”。预检不是授权，凭证也不是权限。沿用聚合工具，不新增通用任意代码/SQL/任意 action 执行器。

当前代码预检租约与首次提交有效期已为 10 分钟（write-preflight-lease.ts），保留此值，统一显式返回 expiresAt 与 ttlMs。执行结果账本最多保留七天且受容量限制，不声称永久保存。过期、进程重启、队列等待、MCP 超时必须分别报告，不能混称租约过期。

## 1. 统一预检与可复制提交

继续以同一 tool/action + validateOnly=true 预检。新增规范化 preflight 对象：

```json
{
  "preflight": {
    "version": 2,
    "requestId": "server-issued",
    "expiresAt": 0,
    "ttlMs": 600000,
    "counts": { "operationCount": 1, "rowCount": 4, "cellCount": 4, "guardTargetCount": 3 },
    "commitArgs": {
      "action": "set_cells",
      "avID": "database-id",
      "cells": [],
      "validateOnly": false,
      "requestId": "server-issued",
      "expectedManifestHash": "server-issued"
    }
  }
}
```

示例时间、ID、cells 为占位，真实响应必须给出完整可直接调用的参数。客户端原样提交 commitArgs，无需判断 expectedStateHash/expectedManifestHash 等字段。摘要按 action 返回有意义的计数；不能计算的指标不伪造为 0。cellCount 为显式单元格操作数，rowCount 为不同目标行数，guardTargetCount 是参与校验的对象数，不能按值去重单元格。

第一阶段保留现有顶层 requestId/hash 作为已发布协议的短期迁移出口，不另建重复执行路径；help 和新调用统一展示 preflight.commitArgs。在未来明确的协议版本切换中才移除旧响应字段，不静默破坏 0.6.13 客户端。内部完整哈希仍由协调器持有。commitArgs 不包含预检返回的状态快照；响应上限不足时明确拒绝过大批次，不截断可执行参数。

所有 mutation 的 help 自动附加同一段：用户授权范围 → validateOnly 预检 → 复制 commitArgs 提交 → 读回或检查回执。外部副作用 action 不冒充严格写入。

## 2. 日历/数据库一次创建并赋值

扩展 av.add_rows，新增 rows 数组；与现有 primaryKeyTexts/blockIDs 输入互斥，不猜测优先级。

```json
{
  "action": "add_rows",
  "avID": "database-id",
  "validateOnly": true,
  "rows": [
    { "clientKey": "event-1", "primaryKeyText": "会议", "cells": [
      { "columnID": "date-column", "valueType": "date", "date": "2026-10-21", "includeTime": false }
    ] }
  ]
}
```

日期值复用仓库现有 cell schema（ISO 字符串或毫秒时间戳），不另设日期格式。首期仅实现 detached 行；绑定行继续现有 blockIDs 路径。clientKey 在批次内唯一，用于返回映射，不是凭证。以 rows[].rowID 返回稳定身份，预留 ID 或已创建 ID 在后续填值前持久化，不用文本/SQL 模糊匹配来重认领行。

预检一次校验全部行、列存在性、列类型、载体权限、目标视图以及会参与默认填值的配置。参数或结构不合法时整批零写入。执行前重新检查对应状态，不能沿用旧 add_rows 的“无状态前置条件”来跳过复合写入的结构校验。

如果内核不能原子建行+赋值，必须显式提供阶段账本：reserved → rows_created → cells_written → verified。已建行但填值失败时保留精确 rowID 与阶段；不得报告全部成功、不得自动删除补偿，也不得重新 add_rows。超时后原 requestId 只恢复原回执；未知阶段先人工核对，不自动重发写请求。

首期不做 upsert：缺少可靠唯一键语义时，按主键文本合并会误伤同名事件。

## 3. 批量改名

扩展 document.rename，新增 items:[{id,title}]，与单文档参数互斥。一次预检和提交覆盖整批，而不是批量取得可任意消费的小 token。首期最多 50 项，限制序列化输入 256 KiB，先以配置常量实现并在帮助公开。

预检解析每个文档与目标名字，拒绝重复 ID、目标冲突、循环改名和不明确的同级重名；建立有序操作清单与全部目标状态。首期拒绝存在父子依赖的批次，避免自己的路径变化使后续校验失效。跨本每项独立校验权限。提交开始前整批校验，任何失效均零写入。

执行持有现有协调器串行入口，禁止递归获取同一锁。逐项写前仍核对当前目标；记录即将执行项，再调用内核、读回和持久化结果。首个失败或未知即停，后续标为 not_started。不是数据库事务，不保证原子性；外部客户端并发修改仍可能发生。

回执含 requestId、overallState、items，每项有 index/id/state，区分 committed、no_change、failed_before_execute、unknown、not_started。保留已完成项，不自动回滚。重放原 requestId 返回原回执不补跑剩余项；用户决定继续时，仅针对已证实未开始项创建新预检。未知项必须核对清楚后再安排。

## 4. 紧凑读回与身份语义

av.query 默认只返回一份规范 rows，以及必要列信息和分页信息；fields 使用稳定 columnID 投影，rowID 必须保留。去掉 data/view.rows/table.rows 三份重复，完整原生 payload 留给现有 get(scope=raw)。明确输出结构版本/迁移说明，更新所有依赖旧 query 格式的测试和消费者。

每个规范 cell 提供原始 value 与可读 formatted；复用内核 formattedContent，不自行猜测时区。日期仅有日历日语义时保留原始存储，并在文档说明时区边界，不在本轮静默改变 epoch 编码。

remove_rows 规范入口新增 rowIDs，服务端按已校验 AV 映射原生删除身份；拒绝混用 rowIDs/srcIDs，无法唯一解析时零写入。现有 srcIDs 明确标为原生接口入口，不能把它称为与 rowID 任意互换的别名。不要因本轮设计移除仍发布中的旧参数。

## 5. 不变的边界

- 10 分钟是最长首次提交窗口，不是十分钟任意写入许可；提交仍完整比对状态、权限和 action 开关。
- 幂等身份绑定工具、action、归一化参数、目标和协调器上下文；不能把失败请求换 requestId 自动重试。
- 无 elicitation 客户端沿用 0.6.13 跳过表单的行为，客户端仍遵守用户授权；有能力客户端保留拒绝与取消。
- 复合操作在持久化 executing 前失败是零写入；之后超时或崩溃不能猜测未执行。
- 首期仅原生批量 add_rows/set_cells 与 rename，不做跨工具通用事务、并行修改同一 AV 或自动补偿。

## 6. 实施顺序与验收

A：统一 preflight/commitArgs/help/计数与 TTL；保持旧执行验证入口。
B：规范 query 投影、formatted 与 rowIDs 身份映射，更新消费方和双语文档。
C：带初始 cells 的 add_rows、持久化阶段与精确行映射。
D：有界批量 rename 与逐项回执。

每阶段必须有针对性测试，不将 mock 当真实验收。必测：无预检拒绝、完整 commitArgs 可执行、篡改参数拒绝、9 分钟内可提交/超过10分钟拒绝、状态变化拒绝、权限撤销、action 关闭、同值多个单元格计数、重复请求不写第二次、部分成功、写后超时、进程中断、回执恢复与响应尺寸。

真实验收使用新构建 MCP/CLI，限定用户已授权测试本和本轮隔离夹具；核对当前实例/权限再写。4个日期事件两次调用完成且读回准确，18文档改名两次调用完成且逐项核验。覆盖未执行、blocked、外部副作用排除单列。所有共享 mutation 纳入覆盖账目；不声称本轮已全量实测。

发布前检查全部测试、构建、skills/schema/API映射、双语文档和迁移说明。实现或验收未闭环的阶段必须留在进度表，不能假称已经完成。不自动提交或发布。

## 实施修订记录（2026-10-20）

本节记录实现时对设计的保守修订，不改变目标与边界。

1. **复合 add_rows 的两阶段执行**：当前仓库只封装 `insertAttrViewBlock` 与 `updateAttrViewCell`，没有可证明的内核原子“建行并赋值”操作。因此 `rows` 复合输入采用显式阶段账本：协调器在插入前生成并持久化稳定 `rowID`（`reserved`），插入后记录 `rows_created`，单元格事务成功后记录 `cells_written`，读回全部单元格后记录 `verified`。中途失败只返回精确 `rowID` 与最后阶段，不自动删除、不重新 `add_rows`。这满足设计要求的“若内核不能原子建行+赋值，必须显式提供阶段账本”。
2. **批量 rename 的目标冲突判定**：SiYuan 文档存储路径由 ID 决定，改名改变 hpath 而非 `.sy` 路径。预检因此按目标 hpath 检查同级冲突，并拒绝目标等于其他批次项当前 hpath、重复目标及父子依赖批次。首期继续限制 50 项与 256 KiB 序列化输入。
3. **规范 query 投影**：为保留分组分页语义，规范 `rows` 在分组结果上额外携带每行 `groupID` 与紧凑 `groups` 摘要；单元格 `formatted` 仅采用内核 `formattedContent` 或安全标量字符串，不自行推导日期时区。
4. **remove_rows 身份映射**：`rowIDs` 在派发前按当前 AV 原始定义校验，并直接作为原生 `srcIDs` 使用；`srcIDs` 保留为明确的原生入口，二者混用零写入拒绝。
5. **复核修正：日期 formatted 的真实嵌套**：内核返回的日期展示文本位于 `value.date.formattedContent`。投影同时检查渲染 cell 包装层、`value` 层和类型子对象，不再只读顶层；没有内核格式时不猜测时区或日期格式。
6. **复核修正：行投影先取 rowID**：`rows[]` 先解析 `rowID`，再投影 cells。视图未选择列或 cells 为空时仍保留有 rowID 的有效行，避免与 `total` 和分页计数矛盾。
7. **复核修正：preflight 截止取最早值**：requestId 先于哈希租约签发。响应中的 `expiresAt` 与 `preflight.expiresAt` 取 `requestIdExpiresAt` 和 `leaseExpiresAt` 的较小值，不宣称晚于任一实际截止。
8. **复核修正：初始 cells 明确拒绝 relation/跨 AV 字段**：首期只允许标量、单 AV 内生效的 cell 类型。relation 以及 rollup/template 等依赖其他 AV 的类型在插入前拒绝，避免只验证源 AV 却写入目的 AV。重复列与未知列同样在任何原生写入前失败。
9. **复核修正：保守未知与完整回执**：`add_rows` 重放即使仍处于 `reserved` 也报告 `writeAttempted: true` 与 `transactionState: unknown`，绝不报告零写入。批量 rename 的 `overallState`、逐项 `items` 与 `counts` 是恢复契约，slim 响应必须原样保留，不因通用裁剪丢失部分回执。
