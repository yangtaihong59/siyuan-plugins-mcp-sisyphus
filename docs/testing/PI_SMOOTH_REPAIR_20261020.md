# PI Smooth Repair — 2026-10-20 四轮修复与真实验收

## 最终复核（主代理，2026-10-20）

本轮完成四轮修复/验收。最终构建的四个新 pi / DeepSeek Flash 会话均完成任务，无观察到的阻断性产品问题；仍有一次漏预检、参数名误用或不完整路径后的正常恢复，**不是零错误调用，也不是全部 action 覆盖**。

本轮产品修复：闪卡真实 cardID/调度状态与写回执一致；保留闪卡身份与复习材料；明确跳过后的会话续读参数；不可读闪卡清除内核附带正文；通用写入实时刷新权限；列表默认 due、评分提供读回指引；扩展发现提示按实际暴露数量；文档创建误传笔记本名称在严格预检阶段明确拒绝并只提示可读 ID。

- 最终自动化：**136 个文件，1666/1666 通过**，证据 `/tmp/sisyphus-smooth-round4-all-tests.log`。
- 第三轮：闪卡 13、权限切换 3、基线 56、转换 13 项通过；第四轮最终 SHA：定向功能 5/5、四个全新角色全部完成。两轮构建不同，不合并冒充同一构建广覆盖。
- 主代理独立审计：所有轮次的临时文档、牌组、模板、资产、影子文件为空，创建回执对应 AV 定义均已不存在；原两个笔记本和权限 SHA 不变。证据 `.sisyphus/acceptance/pi-smooth-20261020/parent-final-audit.json` 与 `parent-verification.json`。
- TypeScript 仍有 24 条既有诊断，归一化行号后与本轮开始记录一致，无新增；不宣称类型检查全绿。
- 尚未提交、发布或更新已安装宿主插件。验收使用 fresh CJS + Node 协调器；时间线密钥未初始化，CLI 体验为 assisted。完整限制及每轮证据见下文。
- 已纠正 pi 汇总中手写的 server SHA 漏字，以下 R4 SHA 与实际产物和锁定文件逐字一致。

## 1. Verdict

本轮修复的关键闪卡功能、parentPath+title 创建门、严格写入重放/冲突/状态变化、权限边界、57 项基线脚本（实际 56 个命名检查）、13 项转换、9 个全新 pi 角色会话与第二个独立 learner 均已在真实测试实例完成。**没有未知写入结果，没有本轮残留文档/牌组/模板/资产/AV JSON，原权限与笔记本列表未变。**

但这不是“所有产品问题都已消失”：仍有若干非阻断的可用性问题（`review_card` 成功回执的 `result` 为 null、`get_cards` 未暴露 deckID、`list_cards` 缺 filter 时的校验体验、`document.get_doc` 不接受 hpath、模板绝对路径体验），以及一处只能在影子权限快速切换场景复现、尚不能归因产品的 `document.remove` 拒绝。详见第 6 节。

结论：**关键功能验收通过；可用性有遗留 P3；无 P0/P1 产品失败证据。** 安装宿主里的旧 `kernel.js` 没有被执行或冒充通过。

## 2. 环境与产物

| 项 | 值 |
| --- | --- |
| API | `http://127.0.0.1:50789`，SiYuan **3.8.7** |
| 测试笔记本 | `20260909184210-4s2cp7v`，名称「测试用」，权限 `rwd` |
| 模型 | `deepseek/deepseek-flash`（已核实本机 pi 别名） |
| 产物 | server `5b37108a…` / cli `8dbb269f…` / kernel `0100efb5…` |
| 路由 | 新构建 CJS 启动的新 Node HTTP 协调器；代理把 `mcpHttpSettings` 影子为 `kernelEndpointEnabled=false`，ledger/permissions 均为本轮影子文件 |
| 生产/其他实例 | 未访问；未读取配置凭据；空 token |
| 本轮目录 | `.sisyphus/acceptance/pi-smooth-20261020/round2/` |

`dist/kernel.js` 是宿主旧 SHA，只作为锁定产物登记，**未声称本轮修复内核已生效**。所有功能与角色路由都记录为新 CJS + 新 Node 协调器；不是“只改入口连接旧 kernel”。

## 3. 功能证据

### 3.1 闪卡关键回归 — 10/10

证据：`round2/fc/report.json`、`round2/fc/raw/calls.jsonl`、`round2/fc/run2.log`。

通过项：

1. 原生 API 建隔离牌组；MCP 创建本轮卡；`get_cards` 与 `list_cards` 的 `cardID`/`blockID` 与原生 `getRiffCards blocks[].riffCardID` 一致。
2. `rating=3` 后原生 `reps/state/lastReview` 从 `getRiffCards` 读回，与 receipt `committed`、requestId 对照一致；due 队列移除。
3. 旧 blockID 当 cardID、不存在 ID、其他牌组 cardID 均在预检拒绝，原生 review 请求计数增量为 0。
4. 同 requestId 重放不产生第二次 review；改参数返回 `idempotency_conflict`；预检后另一合法 review 使旧 lease 返回 `state_changed` 且无额外评分。
5. `skip=true`：使用 handler 返回的 `reviewSession.nextListArgs`（含 `reviewedCards`）继续复习会话，跳过卡不再出现；同时原生 `riffCard.reps/state/lastReview` 保持不变，`no_change` 符合持久化计划语义。未再用会被清空 cache 的裸 due 请求推断 skip 失败。
6. 已不在 due 队列的卡仍可 `get_cards` 读到真实 cardID/状态；预检后移除卡再提交被拒绝且零 review。
7. r/rw/rwd/none 影子权限边界均在评分前拒绝或允许，原权限文件 SHA 不变。
8. `extension.list`：`exposedCount=0` 与实际暴露数组和提示一致，未再出现“0 却说已暴露”。

`get_cards` 已暴露 `cardID/blockID/reps/lapses/state/lastReview/front/review`；`list_cards` 同时有 `deckID`。`get_cards` 本身未带 `deckID`，见遗留项。

### 3.2 parentPath+title 产品门 — 1/1

证据：`round2/functional/parentpath-report.json`。

合法 `document.create { notebook, parentPath:'/PISMOOTH-R2-PP-…', title:'ChildByParentTitle' }` 预检后提交成功，解析出的真实 child `hpath=/PISMOOTH-R2-PP-…/ChildByParentTitle`，正文 `exportMdContent` 读回一致；清理按精确 ID 完成。证明该产品门不是只允许 `path`。

### 3.3 基线脚本 — 56/56

证据：`round2/baseline/report.json`、`run.log`、`report.json.calls.jsonl`、`report.json.cli.json`。

覆盖 HTTP/direct/stdio、fs/document/block、模板、SQL 聚合、AV 创建/重放/结构/行列/视图/镜像/日期/分页/删除、批改名、四级真实权限与清理。**脚本当前共有 56 个命名检查，不是任务文字里的 57；所有 56 个通过。** 这是测试器计数说明，不是跳过检查。

### 3.4 转换 — 13/13

证据：`round2/conversion/run.json`、`mcp-calls.jsonl`、`cleanup.json`。

doc↔heading、显式 targetPath、previousPath、非法目标/跨本拒绝、state_changed 零转换、stdio 预检 + CLI 提交共享协调器、原权限与产物 SHA 不变均通过。

## 4. 全新 pi 角色体验

证据：`round2/ux/broker-report.json`、`ux-*.jsonl`、`pi-*.jsonl`、`runner.log`、`task-*.md`、`attempt1/2/3/`。

| 角色 | 结果 | 工具调用 | 说明 |
| --- | --- | ---: | --- |
| newcomer | 完成 | 8 | 创建/读回会议记录，中文与 emoji 保留 |
| organizer | 完成 | 19 | 三段精确编辑、改名、旧标题不存在 |
| researcher | 完成 | 6 | 引用/提及、SQL n=5、av=0、box 归属 |
| database | 完成 | 21 | AV、四条任务、状态列、筛选分页、重复保存 no_change |
| archivist | 完成 | 11 | 模板另存、读取、删除、再确认不存在 |
| learner | 完成 | 16 | 真实 cardID 创建/复习/删除；读回 reps/state/lastReview |
| learner2 | **完成** | 12 | 独立第二牌组新卡；真实 cardID review 后 reps 0→1、state 0→1 |
| multiend | 部分 | 8 | 仅 timeline 因数据仓库密钥未初始化不可读；环境限制 |
| admin | 完成（只读） | 10 | 笔记本/权限/config/extension/diagnose/只读文档 |
| CLI | 完成（assisted） | 15 shell | 受限 wrapper 强制影子 config/proxy；替换 marker 并读回，错误调用退出码 1 |

`learner2` 第一次、第二次 broker 运行时被测试器自己的通用 ID 门误拒；修正“learner2 也要放行本轮真实 cardID”后，第三次角色运行完成复习且无 guard 误拒。这个前两次失败归为 **tester/harness**，不是产品失败。最终当前 `broker-report.json` 的 `guardRejections=[]`。

CLI 仍有 shell，明确标为 **assisted**，不冒充工具隔离盲测。wrapper 固定 `--config <shadow> --url <proxy>`，运行环境设置 `SIYUAN_DISCOVER=0`。

## 5. 严格写入与安全

- 所有功能写入走预检 → 原 requestId/hash → 提交 → 原生读回。
- `unknown`/`outcome_unknown` 计数为 0；没有换 ID 自动重试。
- broker 在未知写结果时会冻结；本轮未触发冻结。
- 原 `notebookPermissions` SHA 保持 `160ff649…`；原 notebook 列表保持两项。
- 影子的 `notebookPermissions-*`、ledger、`mcpHttpSettings` 未写入原配置。

## 6. 遗留问题与限制

### 产品可用性（非阻断）

1. **P3 — review 成功回执 `result: null`**：`learner` 与 `learner2` 都观察到 `review_card` 提交 `transactionState=committed`，但 `result` 为 `null`；必须靠后续 `get_cards`/原生读回才能确认。功能正确，回执表达不够可解释。建议返回与 receipt 对齐的评分结果。
2. **P3 — `get_cards` 不带 `deckID`**：`cardID/blockID/state` 已正确暴露，但同一条卡在 `get_cards` 无 `deckID`，`list_cards` 有。若调用方只有 `get_cards`，仍需另查牌组。任务未强制，但建议补齐。
3. **P3 — `list_cards` 省略 `filter` 的校验体验**：多个角色首次调用被 `filter` 校验拒绝后补 `filter` 才成功；help 已能恢复。建议默认 `due` 或在错误里直接给出可用默认值。
4. **P3 — `document.get_doc` 只接受 ID**：有角色先传 hpath，得到“document id required”后改用 block/doc ID。公开描述可更显眼地说明。
5. **P3 — 模板绝对路径**：archivist 第一次读模板用工作区绝对路径被拒，改相对模板名成功。若产品有意只接受相对路径，错误提示可更直接。

### 测试器/环境问题

6. **基线命名检查 56 vs 任务文字 57**：脚本实际 56 个命名检查，全部通过；不是产品少测一项，但账目应对齐。
7. **代理 SQL 索引滞后**：broker 结束时的 `residualBlocks` 可能仍返回已删除文档；独立复查 SQL 为 0。`cleanup=incomplete` 是索引滞后造成的假阳性，最终清理已按精确 ID 复核。
8. **影子权限快速切换后的 `document.remove`**：fc 在 r→none→rw→rwd 后，`document.remove` 预检仍 `permission_denied`，而同一影子文件为 rwd；改用原生精确删除完成清理。基线真实权限测试通过，暂归为 **harness/影子权限缓存待查**，不能据此宣称产品写权限失败。
9. **环境限制**：`timeline.list_nodes` 需要数据仓库密钥，本轮未初始化，故多端角色仅该项 partial；官方原生工具 `nativeToolsEnabled=false`，`exposedCount=0` 与提示一致。
10. **宿主旧 kernel**：本轮没有替换安装宿主 `kernel.js`，因此不声称宿主内核路径通过；只验证新构建 CJS + 新 Node 协调器。

## 7. 覆盖登记

- 计划 inventory：**14 工具 / 137 action / 69 mutation**（`round2/inventory.json`）。
- 本轮实际登记的 action：**44**；其中 policy mutation **29**（`round2/functional-actions.json`）。
- 未重跑上轮 117 项广覆盖；上轮证据只能标 **prior-build**，没有冒充本轮。
- 本轮重点完成：闪卡全链、parentPath+title、57/56 基线、13 转换、9 角色 + 第二 learner、CLI assisted。

## 8. 清理

证据：`round2/cleanup.json`。

- 文档残留：0；牌组残留：0；模板：0；资产：0。
- 删除 1 个 AV JSON：`/data/storage/av/20261020113507-ghz8vv8.json`。删除前核对 `definition.id` 与文件名一致、carrier `20261020113507-s0z5vj7` 不存在、4 个 row block 全部不存在、SQL 无 carrier 引用。
- 删除 2 个失败尝试遗留的影子权限文件。
- 原权限 SHA 不变；原 notebook 列表不变。
- 没有在测试本留报告文档；证据只保存在本地本轮目录。

## 9. 下一轮是否需要修复

- **不阻断发布的关键功能修复已完成**，没有发现需要立即回滚或重做的 P0/P1。
- 建议下一轮（可排期）处理：review 回执结果、`get_cards.deckID`、`list_cards` 默认 filter/错误提示、`document.get_doc` hpath 说明、模板路径错误提示。
- 另需单独复现“影子权限快速切换后 document.remove 仍拒绝”是否真实产品缓存问题；在未复现前不要写成产品已通过/已失败。

---

# Round 3 验收附录（2026-10-20，PISMOOTH-R3）

> 本附录追加在 Round 2 报告之后，不覆盖前轮记录。结论不是“137 个 action 全覆盖”，也不是“宿主旧 kernel 已验证”。

## R3.1 结论

本轮在 **真实实例 `http://127.0.0.1:50789` / SiYuanDev 3.8.7 / 测试本 `20260909184210-4s2cp7v`** 完成关键功能、既有基线、转换、权限缓存长会话和 9 个 MCP 角色 + 1 个 assisted CLI 验收。空 token，未访问生产 64068，未读取凭据。

- 功能：闪卡 13/13、基线 **56/56（实际 56 个命名检查，不是 57）**、转换 13/13、长会话权限缓存 3/3、人类路径 parentPath 1/1。
- 角色：attempt1 的 9 个 MCP 角色 + CLI 共 10 会话均退出 0；其中 archivist/admin 受到 tester guard 误拒，修正后在 attempt2 重跑成功；organizer 在 attempt6 完成；learner 在 attempt4 完成“评分后读回”；CLI 在 attempt3 完成（assisted）。
- 清理：bounded re-read 后文档残留 0、牌组 0、模板 0、影子文件 0、AV JSON 残留 0；原权限仍为 `rwd`；笔记本列表仍为原两项。
- 未知写入结果 0。宿主安装的旧 `dist/kernel.js` **未升级、未执行、未冒充通过**；所有结果来自本轮 fresh `dist/mcp-server.cjs` + fresh Node 协调器（`kernelEndpointEnabled=false`，影子 permissions/ledger）。

## R3.2 产物与环境

| 项 | 值 |
| --- | --- |
| API | `http://127.0.0.1:50789`，SiYuan **3.8.7** |
| 笔记本 | `20260909184210-4s2cp7v`「测试用」，权限 `rwd` |
| 模型 | `deepseek/deepseek-flash` |
| server | `e698dc0f3796e850a5c00dee4a0fc0d10077e49dcd9f1a85130300dd8546dd28` |
| cli | `5152d8cc955e4ac16fe894644252a15acb9eb58a394ac3a4bf1aed0d3be91667` |
| kernel（仅登记） | `74e3df1967651e3ecaf440ea12f6f9442848666af123976c49831f6709a72290` |
| 结果目录 | `.sisyphus/acceptance/pi-smooth-20261020/round3/` |

开头与结尾 SHA 一致；基线、转换和闪卡脚本均锁定并复核了本轮 SHA。

## R3.3 修复与验证

### 闪卡与读权限

`round3/fc/report.json`、`raw/calls.jsonl`：13/13 通过。除原 9 项外，追加：

1. `rating` 成功回执省略空 `result`，并提供可直接调用的 `nextSteps`；按 `nextSteps` 读回 `reps/state` 与原生 `getRiffCards` 一致。
2. `list_cards` 省略 `filter` 成功，返回 `filter=due`。
3. 本轮新建卡正文写入唯一 secret marker；影子 `none` 后 `get_cards`/`list_cards` 不返回 marker/content/markdown/front/back/review/hPath/path，只保留 cardID/blockID 与调度字段；影子 `r/rw/rwd` 均恢复可读内容；原权限文件 hash 不变。

### 长会话权限缓存

`round3/functional/permission-cache-report.json`：同一 server 会话内：

- 影子 `rw` 时 `document.remove` 预检被观察为 `permission_denied`（证明缓存已观察 rw）；切换 `rwd` 后同一动作预检成功。
- 再切 `rwd → r`，旧 lease 提交返回 `permission_denied`，`writeAttempted=false`，原生 `removeDocByID` 增量 **0**，文档仍存在。
- 恢复 `rwd` 后通过 MCP 实际删除两个本轮文档，原生删除计数 2，均 `checkBlockExist=false`。
- 影子文件实际内容记录为 `rwd`；原权限未改。

### parentPath 人类路径

`round3/functional/parentpath-human-report.json`：`document.create` 使用人类路径 `parentPath=/测试用/<prefix>` + `title` 成功预检/提交，真实子文档 hpath 为 `/测试用/<prefix>/ChildByParentTitle`，正文读回一致，父子文档均按精确 ID 清理。第一次运行因 tester 只接受本地 hpath 而误判失败，修正断言后重跑通过；失败产出的两个隐式父文档已按本轮 root ancestry 清理。

### 基线与转换

- `round3/baseline/report.json`：**56/56** 命名检查通过（脚本实际 56 项；不写 57）。覆盖 HTTP/direct/stdio/CLI、模板、SQL、AV 创建/重放/视图/行列/日期/分页、18 文档批量 rename、四级真实权限、清理。
- `round3/conversion/run.json`：13/13 通过；stdout/CLI 共享协调器、旧 lease `state_changed` 零转换、原权限 hash 与笔记本列表不变。
- 基线策略 mutation 盘点 69 项：本轮覆盖 25 项、未跑 38 项、明确排除 6 项。**不宣称 137 action 全覆盖。**

## R3.4 角色会话

逐角色证据：`round3/ux/attempt*/ux-*.jsonl`、`role-evidence.json`、各 `broker-report.json`。所有 attempts 的 `guardRejections` 为空；tester scope 误拒单独保留在 attempt1/5 的 `guard.jsonl`，未隐瞒。

| 角色 | 最终有效 attempt | 结果 | 关键证据 / 卡点 |
| --- | --- | --- | --- |
| newcomer | 1 | 完成 | 创建中文+emoji 会议记录并读回 |
| organizer | 6 | 完成 | 三段精确编辑、改名、旧标题不存在；前两次因 tester guard 与 notebook 名称权限误拒重跑 |
| researcher | 1 | 完成 | 引用/提及、SQL n=5、av=0、box 归属 |
| database | 1 | 完成 | 一次 `add_rows` 写入 4 cells，rows-only `query` 分页 1 条、重复保存 `no_change` |
| archivist | 2 | 完成 | 绝对模板路径 read/delete 与创建回执完全一致；attempt1 tester 误拒 |
| learner | 4 | 完成 | 真实 cardID 评分 committed；评分后 `get_cards` 读回 `reps=1,state=1`；随后删卡读回 0 |
| learner2 | 1 | 完成 | 独立牌组真实 cardID；评分后读回 `reps=1,state=1,lastReview` 更新 |
| multiend | 1 | 部分（环境） | 时间线因数据仓库密钥未初始化不可读；未初始化/未修改 |
| admin | 2 | 完成（只读） | 读取受限文档成功；attempt1 lookup-by-id guard 已修 |
| CLI | 3 | 完成（assisted） | 版本/权限/marker 替换/读回/退出码；wrapper 与 `SIYUAN_DISCOVER=0`；不是隔离盲测 |

attempt1 十会话全部退出 0；后续 attempt2-6 为修正 tester 后的独立重跑，均保留原 attempt 证据，不覆盖。

## R3.5 独立审计与清理

`round3/cleanup-residuals.json`、`cleanup-residuals.log`：

- 扫描所有 attempt 的 AV create 回执和基线 AV fixture，发现 2 个本轮 AV JSON；确认 `definition.id` 一致且**无活跃 carrier** 后删除：`20261020115820-ho9y16h`、`20261020115534-20nseam`。
- 删除 audit 发现的精确隐式父文档：`/测试用/PISMOOTH-R3-PP-…` 两项、`/PISMOOTH-R3-PERM-…` 一项；均核对 box、rootID、hpath 属于本轮前缀。
- 多轮 broker 的即时 SQL residual 会受索引延迟影响出现假阳性；bounded re-read 后为 0。未因假阳性重复写入。
- 最终：文档残留 0、牌组 0、模板 0、影子配置/权限/ledger 0、AV JSON 中无 PISMOOTH-R3；原 `notebookPermissions` 仍 `rwd`，笔记本列表不变。

## R3.6 尚存问题（未宣称全绿）

| ID | 分类/严重度 | 状态 | 问题 |
| --- | --- | --- | --- |
| R3-F1 | harness/P2 | fixed_verified | tester 模板 guard 一度拒绝内核返回的绝对路径；改为只允许本角色本轮创建回执的精确路径 |
| R3-F2 | harness/P2 | fixed_verified | tester guard 一度误拒 get_doc hpath、rename items、storage parentPath、lookup id；修正后 organizer/admin 重跑成功 |
| R3-F3 | usability/P3 | fixed_verified (R4) | R3 曾记录 `document.create` 传 notebook 名称时返回 `permission_denied`；R4 已改为 `invalid_arguments`，提示可读匹配 ID，且错误路径零原生创建请求。详见 R4 附录 |
| R3-F4 | review correction | retracted_record_error | R3 只检查了 `cards[]` 单项；实际 `get_cards` 顶层响应已有来自请求的 `deckID`。不要写成必须另查牌组 |
| R3-F5 | review correction | documented_not_failure | `review.gradable=false` 来自普通段落缺少可独立评分的问答材料，不等于内核评分失败；review 已 committed 且 reps/state 读回更新。未为显示 true 改变语义 |
| R3-F6 | environment/P2 | observed | multiend 时间线因数据仓库密钥未初始化 blocked；不是产品失败 |
| R3-F7 | harness/P3 | fixed_verified | broker 即时 SQL residual 假阳性；以 bounded re-read 与精确 ID 审计收尾 |
| R3-F8 | harness/P2 | fixed_verified | CLI 角色曾绕过 wrapper 使用旧配置；wrapper 已强制影子 config/proxy 与 `SIYUAN_DISCOVER=0`，最终 attempt3 成功，但仍是 assisted |

## R3.7 放行口径

关键变更与高风险路径有真实证据；无未知写入结果；无未交代清理残留；P0/P1 产品失败证据未发现。仍存在 P3 可用性问题、environment blocked 项和未覆盖 action。结论为：**关键功能通过，整体有条件通过，不能报告“137 action 全覆盖”或“宿主旧 kernel 已验证”。**

---

# Round 4 定向验收与四轮整体结论（2026-10-20，PISMOOTH-R4）

> 本附录追加在 Round 2/3 之后，不覆盖前轮记录。Round 4 是**定向修复验收**，不是又跑一遍 56 项基线和 13 项转换；第三轮广覆盖与第四轮定向使用**不同产物 SHA**，不能合并成同一构建的成绩。

## R4.1 结论

本轮只针对 `document.create` 的 notebook 名称误用诊断，以及四个全新 pi 角色（newcomer、organizer、archivist、learner2）。功能回归与新角色体验分开记录。

- 功能：名称误用预检返回 `invalid_arguments`，提示包含实际可读 notebook ID，不误导去改权限；错误路径原生 `createDocWithMd` 请求数 **0**。改成真实 ID 后重新预检、提交、原生读回成功。
- 影子权限：`r` 时同名影子本可读，提示可合法列出；`none` 时同名影子本不可读，响应任何位置都不出现其 ID，且错误路径零原生创建请求。
- 角色：四个全新 pi 会话均完成自然任务；没有要求角色必须说“顺畅”，保留了首次错误与恢复记录。
- 清理：文档/牌组/模板/影子文件残留 0，functional 产生的隐式父文档已按 ownership 精确 MCP 删除；bounded SQL re-read 后 `clean=true`；原权限 hash 与笔记本列表不变。
- **仍然不能声称 137 action 全覆盖，也不能声称宿主旧 kernel 已部署或验证。**

## R4.2 产物与环境

| 项 | 值 |
| --- | --- |
| API | `http://127.0.0.1:50789`，SiYuan **3.8.7** |
| 笔记本 | `20260909184210-4s2cp7v`「测试用」，原权限 `rwd` |
| server | `2d717c8dcbcf62a8138acd1557d6845ae1585fab79b8e3b17c99fee4905600ea` |
| cli | `3c237adc58cd0f33fda28f44cc767b6442a257f6d195cc7e4f15f35d3ddf818a` |
| kernel（仅登记，未部署） | `d23b2ab54c9e9ae9cdde92a8bb0dcf729780496e458a6f2455212104ee35924c` |
| 结果目录 | `.sisyphus/acceptance/pi-smooth-20261020/round4/` |

产物 SHA 与 R3 不同（R3 server `e698dc0f…`、cli `5152d8cc…`、kernel `74e3df19…`），因此 R4 结果只属于 R4 构建。空 token，未读凭据，未访问 64068，未修改产品/构建/提交/发布。

## R4.3 document.create 名称误用功能回归

证据：`round4/functional/create-name-report.json`、`create-name-calls.jsonl`、`create-name-native-writes.jsonl`、`create-name.log`。

5/5 检查通过：

1. **预检**：`notebook="测试用"` + `validateOnly=true` 返回 `invalid_arguments`，错误文本含真实可读 ID `20260909184210-4s2cp7v`，并明确“不要通过改权限解决”；没有签发 `requestId`/lease，`writeAttempted=false`，原生 `createDocWithMd` 增量 0。
2. **提交前拒绝**：伪造 requestId 直接提交被严格写入拒绝为 `request_id_expired`（未进入 handler），不是权限不足，原生创建请求仍为 0。名称诊断的正式入口是 `validateOnly` 预检。
3. **shadow r**：新建同名影子本并设为 `r`。因 `r` 可读，提示可合法列出原测试本与新影子本两个 ID；该调用仍不写文档，原生创建请求 0。
4. **shadow none**：影子本改为 `none` 后，预检仍返回 `invalid_arguments` 并只列可读的原测试本 ID；影子 ID 在整个响应中不出现，原生创建请求 0。
5. **真实 ID**：用 `20260909184210-4s2cp7v` 重新预检，提交成功；原生 `/api/filetree/getHPathByID` 读回 `/PISMOOTH-R4-CREATE-261020041302/valid`，`exportMdContent` 读回 marker。错误路径 0 次、成功路径 1 次 `createDocWithMd`。

清理：成功文档通过 MCP 精确删除（requestId `a570`），同名影子本恢复 `rwd` 后通过 MCP 精确删除（requestId `cf07`）。最初审计发现 functional 创建留下的隐式父文档 `/PISMOOTH-R4-CREATE-261020041302`；核对 box、rootID、hpath 后通过 fresh CJS MCP 预检/提交删除根文档 `20261020121303-0rtz8nw`（requestId `f2ca`），随后 bounded re-read 为 0。

## R4.4 四个全新 pi 角色

证据：`round4/ux/attempt1/`、`role-evidence.json`、`ux-*.jsonl`、`guard.jsonl`、`broker-report.json`。只创建并运行四个被选角色；未选角色没有工具文件、请求或夹具。每角色预算 25 调用/3 分钟，全部未超。

| 角色 | 调用 | 首次错误 | 恢复 | 结果 |
| --- | ---: | --- | ---: | --- |
| newcomer | 6 | `fs.write precondition_required` | 1 | 完成：开会记录、中文/emoji、读回两项待办 |
| organizer | 14 | `document.rename` 用错 `newTitle` 返回 validation_error | 1 | 完成：先用只读 `notebook.list` 选真实 ID；新建三段、只改第二段、改名、读回旧标题不存在；报告原目录路径仍可操作 |
| archivist | 12 | `save_doc_as_template` 直接提交 `precondition_required` | 1 | 完成：另存新模板，用创建回执返回的绝对模板路径读取成功，确认 marker 后删除并再确认不存在 |
| learner2 | 11（broker 计数 12，含 1 次 guard 拒绝） | tester guard 拒绝不完整 hpath `/learner2` | 1 | 完成：独立牌组、真实 cardID 复习、读回 `reps=1/state=1/lastReview` |

关键测试器行为：

- organizer 已公开暴露只读 `notebook.list`，真实客户端可用；organizer 自行选择 `20260909184210-4s2cp7v`，未由网关隐藏。
- archivist 的绝对模板路径只在“本轮精确创建回执”范围内允许；`lookup` 的 id 与 hpath 都是合法产品调用。
- learner2 的 review 先校验本轮牌组真实 cardID，再走普通 block/document ID 判断；真实 cardID 未被通用 ID guard 误拒。
- learner2 的 guard 拒绝是其自己传入不完整 hpath `/learner2`，不是产品 `document.get_doc` 失败；随后按 help/块 ID 完成，不重跑整个角色集。
- 所有写请求串行；未做全局 sync、快照、通知、反馈或购买。

## R4.5 对第三轮记录的两项修正

- **R3-F4 修正**：第三轮只检查了 `get_cards.cards[]` 单项，误写成“`get_cards` 没有 deckID”。实际顶层响应已有 `deckID`，且来自请求；不应要求调用方必须另查牌组。
- **R3-F5 修正**：`review.gradable=false` 来自普通段落缺少可独立评分的问答材料，并不等于内核评分失败。实际 review 已 `committed`，`reps/state/lastReview` 读回更新；没有为了显示 `true` 改变语义。
- **R3-F3 已由 R4 修复验证**：notebook 名称误用现在在 `validateOnly` 预检阶段返回 `invalid_arguments` 和可读 ID 提示，不再误导为权限不足，且零写入。

## R4.6 清理与独立审计

证据：`round4/cleanup-audit.json`、`cleanup-audit.log`、`cleanup-implicit-parent.json`。

- 扫描所有 attempt 的 ux 回执和 broker report，文档/牌组/模板引用逐项 `checkBlockExist` 或文件读取核对。
- 文档残留 0；牌组残留 0；`/data/templates`、`/data/assets`、`/data/storage/petal/siyuan-plugins-mcp-sisyphus` 中 PISMOOTH-R4 残留 0。
- 隐式父文档 `20261020121303-0rtz8nw` 通过 MCP 精确删除；即时 SQL 曾短暂返回旧行，bounded re-read 后为 0，未把瞬时残留写成 clean。
- 原 `notebookPermissions` hash 仍为 `160ff649c9441c1ee7676fa56d60a066d36c33946e3dbe277e2aa2b416a61cbf`；原两个笔记本列表与 sort/sortMode 不变。
- 影子 permissions/ledger/mcpHttpSettings 文件已删除/未进入原配置；未创建 AV JSON 或未授权模板。

## R4.7 四轮整体结论

1. **功能回归与新角色体验分开**：R2/R3 的固定基线、转换、闪卡、权限缓存等属于功能证据；四个 pi 角色属于体验/可恢复性证据，不能用角色成功替代功能断言，也不能用功能绿替代新手体验。
2. **第三轮广覆盖与第四轮定向不同 SHA**：R3 的 56 基线、13 转换、闪卡与 9+1 角色只对应 R3 SHA；R4 的名称误用功能与四个角色只对应 R4 SHA `2d717c8d…`。不把两轮结果混成同一构建。
3. **时间线缺密钥是环境限制**：R3 multiend 的 `timeline.list_nodes` 因数据仓库密钥未初始化不可读，归类 environment，不写成产品失败；R4 未重复该项。
4. **CLI 始终是 assisted**：R3 CLI 有 shell、受限 wrapper 和 `SIYUAN_DISCOVER=0`，只能算辅助体验，不是隔离盲测；R4 未运行 CLI。
5. **宿主旧 kernel 未部署**：安装宿主的 `kernel.js` 仍是旧 bundle，未升级、未执行、未冒充验证。所有新结果来自本轮 fresh `dist/mcp-server.cjs` + fresh Node proxy/coordinator，`kernelEndpointEnabled=false`。
6. **不能声称 137 action 全覆盖**：R3 已登记覆盖 25/69 policy mutation，仍有 38 未跑、6 明确排除；R4 只定向验证一个错误路径和四个角色。四轮合计也不是 137 action 全覆盖。
7. **自动化与类型检查**：父代理自动化最终预期 **1666 项**（以父代理实际日志为准；本报告不伪造本代理未运行的结果）。本轮运行 `pnpm exec tsc --noEmit` 得到 **24 条既有诊断**，退出码 2；诊断类别与既有记录一致，未观察到本轮新增诊断。
8. **未知写入结果 0**：四轮记录中没有未交代的 unknown/outcome_unknown；本轮所有错误路径在原生请求层计数为 0。

## R4.8 放行口径与剩余边界

R4 的定向高风险项有真实证据，四个角色均完成，清理审计 clean，原权限与笔记本列表不变，无 P0/P1 产品失败证据。仍存在 P3 可用性恢复成本（严格写入首次 `precondition_required`、rename 字段提示、get_doc hpath 帮助）、环境限制（timeline 密钥）和未覆盖 action。

最终口径：**关键功能与定向修复通过，整体有条件通过；不能报告“137 action 全覆盖”“全部人群盲测通过”或“宿主旧 kernel 已验证”。**
