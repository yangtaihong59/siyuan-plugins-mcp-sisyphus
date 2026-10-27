# document.query 真实思源现场验收（2026-10-20，修正轮）

## 1. 结论摘要

本轮是**源码辅助功能验收**，不是新手盲测。针对用户已构建的 `dev/mcp-server.cjs` 与 `cli/dist/cli.cjs`，在 SiYuanDev 测试实例上重新执行真实 `document.query` 验收。没有修改产品、没有重建产物、没有提交或发布。

| 项目 | 结果 |
|---|---|
| 检查项 | 21 |
| 通过 | **21** |
| 正向通过 | **14** |
| 正常拒绝通过 | **7** |
| 失败 | **0** |
| 未执行主项 | 0（明确限制见第 9 节） |
| 清理 | 18 条 MCP receipt 全部成功：17 篇文档 + 1 个临时笔记本；结束后 `DQLIVE-*` 文档 0、临时本 0 |

本轮修正了上一轮把“默认 pageSize=50”误判为产品失败的问题：用户示例是显式 `{"action":"query","pageSize":100}`，而产品文档定义的默认值就是 50、最大 100。当前断言已改为默认 50，并新增用户原样传参 `pageSize:100` 的断言，二者均通过。

## 2. 上一轮证据与失败性质

上一轮最终报告和 calls 已原样备份到：

`independent-previous-final/`

- 备份包含 `run-report.json`、`calls.jsonl`、`oracles.json`、`post-run-verification.json`、`progress.md`、`run.log`、`run.cjs` 及上一轮报告。
- 旧失败轨迹文件仍保留在原目录，未覆盖、未改写。
- 旧失败均为验收脚本假设、同步 `spawnSync` 阻塞、隐式父文档/索引延迟等 harness 问题，或把任务卡默认值误当成产品契约；**不是产品失败**。
- 特别说明：上一轮 `run-report.pageSize50-failure.json` 记录了默认 50 与任务卡预期 100 的差异，复核后确认是**测试假设误判**。产品源码、schema、中文文档一致声明默认 50、最大 100。
- 本轮没有修改旧证据内容；新的结论以本轮 `run-report.json` 为准。

## 3. 环境与产物锁定

- 实例：SiYuanDev API `http://127.0.0.1:50789`，版本 `3.8.7`。
- 测试笔记本：`20260909184210-4s2cp7v`（`测试用`，open，源权限 `rwd`）。
- 正式端口 `64068` 未访问；CLI 使用 `SIYUAN_DISCOVER=0`，未自动发现其他实例。
- 未输出 Token、请求头、配置正文或已有笔记正文。

| 产物 | 测试前 SHA-256 | 测试后 SHA-256 |
|---|---|---|
| `dev/mcp-server.cjs` | `eeddffe7b82e8ad402368aaea0d360bb3269f7de29f0110ff258cca2af69eb79` | 相同 |
| `cli/dist/cli.cjs` | `f057a079a00218939e397849ed26778a05de49720687e9f1fb78176079977e82` | 相同 |
| `dev/kernel.js` | `65c985a6fd5a1c0acc68cffa9d72688a2b897bffc7174a332f4c579f289d2501` | 相同 |

两个待测 CJS 均含新 query 标记 `Document query returned an invalid indexed document count`；未使用 `dist/` 旧产物。`dev/kernel.js` 仅记录 SHA，本轮未声称验证已安装旧 kernel。

## 4. 隔离、路由与写入方式

- 使用本轮 Node 临时代理连接真实内核；MCP server 通过代理访问 50789。
- 代理将 `mcpHttpSettings` 影子化为 `enabled=true`、`kernelEndpointEnabled=false`，确保新 CJS 自己执行，而不是转发到已安装旧 kernel。本轮 `/plugin/private/*` 请求数为 **0**。
- `notebookPermissions`、`writeSafetyLedger`、`mcpHttpSettings` 均为**代理内存影子**；原文件只读快照，未写原权限文件。
- **全量 none 验证**：本轮在影子权限中把测试用以外的所有现有笔记本（`20260416140832-akcxrgf`，`MCP排版测试`）设为 `none`，验证默认 scope 不包含它、显式查询返回 `permission_denied` 且 SQL 增量为 0。仅改代理内存，未改原笔记本真实权限。
- 真实写入（文档、笔记本、权限、关闭/打开、删除）全部走 MCP **预检 + `preflight.commitArgs` 正式提交**；共 116 次逐 call 记录，写入均带服务端 `requestId`。
- 内核原生 API 只用于独立只读 oracle（版本、笔记本列表、块数和字符数 SQL、块存在性、文件哈希）和清理核对，未借 API 绕写安全。

## 5. 逐项结果

| # | 检查 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | 默认 `query` `pageSize=50`（产品文档默认） | 通过 | 无参数调用返回 `pageSize=50`、`page=1`，返回行数不超过 50 |
| 2 | 默认 scope 排除 `none` 笔记本并含可读本 | 通过 | `scope.notebooks` 只含可读测试本；临时 `none` 本及其他全量 none 本均不在 scope |
| 3 | 用户原样 `{action:"query",pageSize:100}` | 通过 | `pageSize=100`、`page=1`，返回行数不超过 100，total 与默认查询一致 |
| 4 | 真实内核执行生成的 CTE SQL | 通过 | 代理看到 `WITH scoped_docs AS ... metrics AS ...`，真实 50789 成功执行 |
| 5 | 显式 `none` 笔记本拒绝 | 通过 | `permission_denied`，`current_permission=none`，SQL 增量 0 |
| 6 | 测试用以外所有现有笔记本影子 none 验证 | 通过 | 默认 scope 不泄漏；逐本显式查询全部 `permission_denied`；SQL 增量 0 |
| 7 | `query_sql` 在受限 scope 拒绝且零下游 | 通过 | `raw_sql_unavailable_with_restricted_notebooks`，SQL/fulltext 增量均 0 |
| 8 | `fulltext(method=2)` 在受限 scope 拒绝且零下游 | 通过 | 同 code，SQL/fulltext 增量均 0 |
| 9 | `fulltext(methodName="sql")` 在受限 scope 拒绝且零下游 | 通过 | 同 code，SQL/fulltext 增量均 0 |
| 10 | 普通正文/容器/空白文档统计与原生 SQL 对照 | 通过（有边界） | 16 个测试本夹具文档逐项 `blockCount`/`contentChars` 与原生 SQL 完全一致；空白文档 `blockCount=1`、`contentChars=0` |
| 11 | 同名文档在 readable scope 统计，hidden 不计 | 通过 | 可读本 2 篇同名，`sameTitleCount=2`；hidden `none` 本原生 SQL 确有 1 篇同名，但未计入 |
| 12 | `sameTitleCount` 先计数再应用统计过滤 | 通过 | `title=同名 + maxChars=0` 只返回零字符那篇，`sameTitleCount` 仍为 2 |
| 13 | `fields` 投影 | 通过 | `fields=["id","title"]` 返回对象键严格为 `id,title` |
| 14 | 标题含引号、`%`、`_` 按字面匹配 | 通过 | 只命中目标文档，未命中按通配符会命中的 decoy；原生 `instr` 计数也为 1 |
| 15 | `hpathPrefix` 边界 | 通过 | `/…/hpath/A` 与带尾斜杠只返回 A，不返回 `/…/hpath/AB` |
| 16 | 排序分页不重复 | 通过 | pages scope 共 4 篇，`pageSize=2`，两页各 2 篇，交集为空，并集等于夹具全集 |
| 17 | `min/maxBlocks`、`min/maxChars` | 通过（有边界） | 以 oracle 实际边界核对：`maxBlocks=0` 返回空集且 oracle 也是空集；`maxBlocks=1` 15 篇；`minBlocks=1` 16 篇；`minBlocks=10` 1 篇；`maxChars=0` 6 篇；普通正文精确字符边界包含/排除正确 |
| 18 | 只读 `r` 仍能查询自己的可读 fixture | 通过 | 影子权限切到 `r` 后，显式查询该本同名文档 `total=2`、`sameTitleCount=2`，随后恢复 `rwd` |
| 19 | 查询中撤权整批拒绝 | 通过 | 代理在 count SQL 转发前将测试本影子权限改为 `none`；产品执行 count+data SQL 后最终复核返回 `permission_denied`，无数据返回 |
| 20 | 关闭本默认排除、显式拒绝 | 通过 | 临时本关闭后进入 `scope.excludedClosedNotebooks`，显式查询报“closed”，SQL 增量 0；随后重新打开并清理 |
| 21 | HTTP MCP 与 CLI 结果一致 | 通过 | 同一参数下 HTTP 与 `cli/dist/cli.cjs` 的 `id` 顺序、`total=4`、`pageSize=2` 完全一致；CLI 退出码 0 |

## 6. 零正文/零块的真实边界

真实 SiYuan 3.8.7 创建空白文档后会保留/重建 1 个空段落，所以：

- 空白文档 `blockCount=1` 是**正常口径**，不要求强造 0；
- 本轮真实零正文验证的是 `contentChars=0` 且与原生 SQL oracle 完全一致；
- **没有构造出真实的 zero-block 正向文档**；
- `maxBlocks=0` 本轮只验证了产品与 oracle 在空集上相等，**不等于真实 zero-block 正向通过**。

这一限制已写入 `run-report.json` 的 `zeroContentObservation` 和 `maxBlocks0Limitation`，报告不夸大。

## 7. 正常拒绝与零下游统计

在临时本/其他本影子权限为 `none` 时：

| 调用 | 结果 | SQL 增量 | fulltext 增量 |
|---|---|---|---|
| `document.query notebooks=[none本]` | `permission_denied` | 0 | — |
| `document.query notebooks=[所有非测试本]` | `permission_denied` | 0 | — |
| `search.query_sql` | `raw_sql_unavailable_with_restricted_notebooks` | 0 | 0 |
| `search.fulltext method=2` | 同上 | 0 | 0 |
| `search.fulltext methodName="sql"` | 同上 | 0 | 0 |
| 查询中撤权 | `permission_denied`，整批拒绝 | count+data 已执行，最终拒绝 | — |
| `document.query notebooks=[closed本]` | closed 错误 | 0 | — |

代理总计数：SQL 请求 72 次，fulltext 请求 0 次，kernel private 请求 0 次。影子权限写入 7 次、影子 ledger 写入 126 次，全部被代理截获，未落原文件。

## 8. 清理与原始状态核对

- 本轮夹具通过 18 条 MCP 清理 receipt 删除：17 篇文档（含 `document.create` 自动创建的 5 个隐式父文档）+ 1 个临时笔记本；无失败。
- 8 个旧 failure 前缀重新核对，剩余文档均为 0；本轮未发现需要额外清理的旧遗留。
- `post-run-verification.json` 只读核对：
  - 结束后的 `DQLIVE-*` 文档数：**0**；
  - SQL 中本轮夹具文档数：**0**；
  - 临时隐藏本仍存在：**否**；
  - 笔记本列表与测试前一致：仍为 `MCP排版测试`、`测试用`，sort/sortMode/closed 未变；
  - 原 `notebookPermissions` SHA-256 不变：`160ff649c9441c1ee7676fa56d60a066d36c33946e3dbe277e2aa2b416a61cbf`；
  - 原 `writeSafetyLedger` SHA-256 不变：`a64111f552c6259570900b31579e81d410396b35db33f310b55fa5f7059f5136`；
  - 原 `mcpHttpSettings` SHA-256 不变：`f3d43056eab8305cf68ca052d8bc173d07e1ee2e3c7b1dde9c0626b74633ea36`；
  - 三个产物 SHA 测试前后一致。

## 9. 未测与限制

- 未修改原笔记本真实权限；`r`/`none`/撤权均通过影子权限模拟，`set_permission` 仍走真实 MCP 预检与 receipt。
- “所有非测试本 none”是代理内存影子，不是对原权限文件的持久修改；已核对原权限哈希不变。
- 未测试已安装的插件 kernel endpoint / 旧 `kernel.js`；本轮明确设置 `kernelEndpointEnabled=false`，验证的是新 CJS 自身。
- 传输一致性验证的是 **HTTP MCP 与 CLI**；未另跑 stdio 入口。
- 未重跑全仓 1733 项自动化测试；本轮按任务要求做聚焦真实验收。
- 未访问正式实例 64068；未做同步、通知、反馈、快照、购买等外部副作用操作。
- 真实 zero-block 正向未构造；`maxBlocks=0` 仅验证空集一致性，不代表真实零块文档正向通过。

## 10. 证据位置

目录：`.sisyphus/acceptance/document-query-live-20261020/`

- `run.cjs`：本轮真实驱动与断言（已修正默认 50、显式 100、全量非测试本 none）。
- `run.log`：本轮最终执行日志。
- `run-report.json`：本轮最终逐项检查、夹具、调用、计数、清理与核对。
- `calls.jsonl`：116 次逐 call 响应（默认广域查询中的非夹具行已降级为 ID/notebook 摘要，避免记录已有笔记标题）。
- `oracles.json`：16 个夹具的产品统计与原生 SQL oracle 对照。
- `post-run-verification.json`：结束后只读状态核对。
- `independent-previous-final/`：上一轮最终报告与 calls 的**原样备份**。
- `run-report.*failure*.json`、`run.*failure*.log`：迭代驱动失败原始痕迹，未覆盖；按本轮复核均属 harness/假设问题，不是产品失败。
