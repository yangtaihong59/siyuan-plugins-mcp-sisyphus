# 五项验收问题修复与回归记录（2026-10-19）

**F01–F05 已完成修复，定向真实回归 45/45 项通过，隔离夹具清理完成。** 本轮针对 [pi 标准验收报告](./PI_STANDARD_ACCEPTANCE_20261019.md) 中五项功能问题，并同步修正文案 D01。完整自动化测试 **128 个文件、1532 项通过**；插件与 CLI 构建通过。本轮真实内核留下 64 条严格 mutation 验收记录，按 action 去重覆盖 22/69 个 mutation；不能由此宣称全部写入功能或所有参数分支均通过。

## 环境与范围

- 当前仓库版本仍为插件 **0.6.11**、CLI **0.2.12**；本轮修改尚未发布，也未替换用户的 `36808/mcp` 已安装插件进程。
- 原始 pi 验收发生在思源 **3.8.6**；本轮真实修复回归连接的内核为 **3.8.7**。两轮内核不同，报告不将其视作完全相同的运行环境。
- 本轮目标为原授权工作区内的“测试用”笔记本 `20260909184210-4s2cp7v` 及本轮新建临时权限笔记本。文档、模板、AV 等仅使用隔离夹具。
- 运行仓库新构建 CJS，通过临时 HTTP 协调器与 API 代理访问真实思源；权限及幂等账本采用独立工作区文件。没有替换已安装 `kernel.js` 或重写原权限配置。
- 本轮采用固定回归脚本；此前 pi 发现问题和角色体验的结果仍以原报告为准，不把固定脚本称作新增 pi 盲测。
- 本地原始证据目录：`.sisyphus/acceptance/repair-20261019-110231`。运行与清理的最终证据为 `live-v3.json`、`cleanup-v3.json`；本报告 SHA 取自实际测试产物记录。

## 修复内容与验证边界

| 原问题 | 根因与修复 | 已有验证 | 真实最终状态 |
| --- | --- | --- | --- |
| F01：跨本同路径创建后误报未知 | 创建后的探针改为返回 docID + 目标 notebook；通用路径 SQL 探针补 box 限定。读回要求唯一文档 info.box 与目标笔记本相同。缺 ID、文档不存在或归属不符仍报 readback_mismatch/unknown，阻止误报成功与自动重试。 | 单元测试覆盖 create/create_daily_note、同路径只读邻本、失败分支及重放。 | 通过。四个临时本采用相同 hpath；前一个本已为 r 时，仍能在新目标本以 rwd 创建同路径文档并提交。 |
| F02：删除模板已成功却误报未知 | 资源读取允许 HTTP404 到达模板语义层，转为 template_not_found；删除后合法 missing 被视为可读回的后像。 | 模板集成式单元回归使用真实 SiYuanClient；覆盖创建、覆盖、删除、重放及精确文件状态。live-v3 模板检查已记录 passed。 | 通过；见 live-v3.json 对应检查与 calls.jsonl。 |
| F03：另存全新模板预检被404阻断 | 同一404修复允许目的模板缺失作为合法前像，无须先创建占位模板。401/403 仍拒绝，5xx 仍有界重试后失败。 | 新名字保存和重放有单元覆盖，401/403/500 预检失败且零写入；live-v3 模板检查已记录 passed。 | 通过；见 live-v3.json 对应检查与 calls.jsonl。 |
| F04：链接目标成功响应丢映射 | ensure_link_targets 完整绕过通用 success 白名单精简，保留 linkMap、resolved/reused/unresolved、scope 和计数。 | resolve/reuse/create/dryRun 单元覆盖；真实 slimResponses=true 下，live-v3 链接映射检查已记录 passed，含创建与重放。 | 通过；见 live-v3.json 对应检查与 calls.jsonl。 |
| F05：公开可选反链参数实际必填/空结果 | API 包装补完整字符串字段；进一步按 scope 选择原生接口：无 scope 单次 getBacklink2(id,k,mk)，有 scope 保留 getBacklinkDoc/getBackmentionDoc。 | 单元覆盖 modes、合法空数组不 fallback、缺失半边才 SQL fallback、受限 scope 执行前拒绝、全局受限或无归属行过滤。live-v3 已记录省略参数反链/提及主线 passed。 | 通过。全局隐藏 none 来源；受限 scope 拒绝，原生 Doc 请求增量为 0。 |
| D01：SQL schema 文案陈旧 | stmt 描述与已实现行为一致：全本可读时保留所选列；有不可读本时执行前整体拒绝。同步生成 schema、帮助快照和中英文参考文档。 | 自动化及构建通过；live-v3 已记录 SQL HTTP/direct/stdio/CLI 主线 passed。 | 通过。受限 SQL 请求数 143→143；恢复全本可读后 COUNT 返回 n=3。 |

反链没有把原生合法空数组当故障。仅应有 payload 缺失时进入已有 SQL 兼容查询，并保留 fallback 标识；原生网络/权限错误继续正常抛出。无 scope 原生结果必须有可读 box，否则滤除；不返回未经过权限处理的 linkRefsCount/mentionsCount。有 scope 时先验证源 scopeRootId 的读权限，因为原生 Doc 上下文本身没有 box。

## 原始失败与修正过程

原始证据不删除，也不把后续修正后的运行覆盖到原日志。

1. `live.json`：前十项检查通过，省略参数反链检查失败。该失败暴露**第一版产品修复不足**：把 refTreeID 补成空字符串虽然避免必填报错，但内核 Doc 接口明确按来源文档 rootID 强过滤，空 scope 仍返回空。随后才增加无 scope 的 getBacklink2 分支。
2. `live-v2.json`：原生全局反链已能查到来源；提及断言失败。定位为**测试夹具错误**：未命名段落的任意正文不是原生提及索引的定义名称。修正夹具，为定义块设置唯一 name，再在独立来源文档创建同名文本；不因该失败修改产品的原生提及语义。
3. `live-v3.json`：使用上述修正夹具，**45/45 项检查通过**，覆盖反链与提及、模板、链接映射、SQL、AV v2 和四级权限。测试于新加坡时间 2026-10-19 19:13:55 结束；随后独立 `cleanup-v3.json` 于 19:14:06 确认清理完成。

## 自动化与构建

| 检查 | 结果与证据 |
| --- | --- |
| 全套 Vitest | 128 文件、1532 项通过；最终 `final-tests.log` 与 `final-verification.json`。 |
| 插件构建 | 成功；最终 `final-build.log`。 |
| CLI 构建 | 成功；最终 `final-cli-build.log`。 |
| TypeScript 基线比较 | baseline=24、current=24、newDiagnostics=[]；`typecheck-v2.json`。这是无新增诊断，**不等于整个仓库 typecheck 零错误**。 |
| 最终产物 SHA | 取自 live-v3.json 的 artifacts，见下表。 |
| 技能生成、API 映射与 diff 检查 | 全部通过；`final-verification.json` 中 skillsCheck/apiAuditCheck/diffCheck=true。 |

## 全部 mutation action 覆盖矩阵

清单按当前 `src/core/write-safety-policy.ts` 的 ACTION_SAFETY_POLICIES AST 生成，共 **69 个**静态 mutation action。该矩阵对应本轮最终 `live-v3.json`，不把原标准档历史覆盖自动挪入本轮。

- `covered`：仅取最终 `live-v3.json` 中的 mutation 记录，要求 strictReadback=true 且 transactionState 为 committed/no_change；按 action 去重。它说明已执行的分支有真实严格读回，不等于所有参数、权限或传输分支均覆盖。
- `not_run`：本轮没有上述成功记录；不能据此判产品不支持，也不代表它们在此前标准验收中未执行。
- `intentionally_excluded`：明确超出已授权隔离范围的工作区全局清理、快照/回滚及实际购买。

最终矩阵：**covered 22、not_run 41、intentionally_excluded 6，合计 69**。64 条 mutation 验收记录包含同一 action 的不同参数、权限、重放分支及收尾；实际工具请求另见 calls.jsonl，不把记录数当不同 action 数。清理状态另见独立证据。

| 类别 | covered | not_run | intentionally_excluded |
| --- | --- | --- | --- |
| fs | `write`、`replace`、`rm`、`mv` | `reorder` |  |
| notebook | `create`、`remove`、`set_permission` | `set_open_state`、`rename`、`set_conf`、`set_icon` |  |
| document | `create`、`ensure_link_targets`、`remove` | `create_daily_note`、`duplicate`、`rename`、`move`、`reorder`、`set_attr`、`heading_to_doc`、`doc_to_heading` |  |
| block | `append`、`update`、`set_attrs` | `insert`、`prepend`、`add_to_daily_note`、`replace`、`delete`、`move`、`set_fold_state`、`transfer_references` |  |
| av | `create`、`add_rows`、`add_column`、`set_cells`、`add_view`、`update_view` | `remove_rows`、`remove_column`、`set_column_options`、`duplicate_rows`、`duplicate`、`set_new_item_templates`、`create_from_template`、`configure_two_way_relation`、`configure_rollup`、`set_relation` |  |
| file | `create_template`、`delete_template`、`save_doc_as_template` | `upload_asset`、`update_template`、`rename_asset`、`delete_asset` | `remove_unused_assets` |
| search |  | `find_replace` |  |
| tag |  | `rename`、`remove` |  |
| timeline |  |  | `create_node`、`delete_node`、`rollback_document`、`rollback_block` |
| flashcard |  | `review_card`、`create_card`、`remove_card` |  |
| mascot |  |  | `buy` |

排除理由：`file.remove_unused_assets` 是工作区全局清理，可能删除非本轮资产；四个 timeline mutation 会改动真实历史仓库，且此前仓库未初始化密钥；`mascot.buy` 会消耗真实余额。其余 action 原则上可在新建临时笔记本和唯一夹具中隔离，不因“危险”标签笼统排除。

参数分支另计：`fs.write` 和 `file.create_template` 的新增/overwrite 需分别验证；`document.ensure_link_targets` 的 create 为 mutation，resolve/reuse/dryRun 为 read，本轮相应只读分支的成功不计成多次 mutation action。

本表不包含 external 分类。`system.notify`、`system.perform_sync`、`feedback.submit` 和未知动态 extension 写操作仍不执行；`file.export_resources` 与 `file.extract_doc` 可限定为本轮新建本地输出目录，但不是本表 mutation 的分母。

## 真实权限证据与独立清理

`live-v3.json` 的四个临时权限笔记本均已删除，剩余笔记本数为原来的 2 个。r/none 实际提交 append 被拒绝，每个组内核 append 请求增量为 0，正文读回未变；rw 的删除被拒绝且没有进入内核删除请求。不能将 validateOnly 签发 requestId 本身算作写权限已获批准。

- F01：四个临时本使用相同 notebook-local hpath；r 组已降至只读后，none 组文档创建时其目标本仍为 rwd，创建提交成功，没有读取前一个只读本而误报未知。
- 受限反链：none 来源不出现在全局结果中；显式查询该来源 scope 被拒绝，原生 Doc 上下文请求增量为 **0**。
- 受限 SQL：内核 SQL 请求计数 **143→143**，证明在执行前拒绝；将 none 本恢复 r 后，全本可读，COUNT 返回 **n=3**。
- 原工具配置、原笔记本权限和原 HTTP 设置三类配置的摘要前后一致；测试使用独立权限/账本文件，不改原配置。

`cleanup-v3.json` 状态为 `completed`，独立确认：

| 夹具 | 最终状态 |
| --- | --- |
| 测试根文档及其子内容 | 已清理，按精确 ID/归属核对。 |
| 新建 AV `20261019191331-4iq8yk0` | 承载块不存在，SQL 承载数=0，AV 定义已清理。 |
| 两个模板 | `AV-V2-20261019111315-template.md`、`AV-V2-20261019111315-saved.md` 均不存在。 |
| 两个临时状态文件 | 独立 notebookPermissions/writeSafetyLedger 文件均不存在。 |
| 四个临时权限笔记本 | 均清理，原两个笔记本保留。 |
| 验收摘要 | 保留 `20261019191355-8vthuwx`，路径 `/测试用/AV-V2-20261019111315-验收报告`。 |

此外，`earlier-runs-cleanup.json` 已只读核对前两次未完成运行：`live.json`（`AV-V2-20261019110347`）与 `live-v2.json`（`AV-V2-20261019111151`）的根文档、模板及临时状态文件均不存在。保留失败证据文件，没有遗留对应笔记夹具。

## 实际测试产物

以下 SHA-256 来自最终 `live-v3.json`；`final-verification.json` 已确认最终重建后 server/CLI/kernel 的 SHA 与真实验收产物完全相同。它们用于识别本轮验证的构建，不证明 `36808/mcp` 的已安装进程已经加载它们。

| 产物 | SHA-256 |
| --- | --- |
| dist/mcp-server.cjs | `90f2778fbd30d8267dabe910d534c26d0dbec9c2d0402de6a908ef257a11d240` |
| cli/dist/cli.cjs | `821092ba4337080dc6d8be7cf427b4da71c4372f9771fedca79b2ae8383dd801` |
| dist/kernel.js | `9a0042a1606e0f9a5305d39aec59c3a2ecb54f1f9238c6b9684c47e10e567c4b` |

本轮不提交 Git、不发布新包、不自动替换已安装插件。未覆盖的工具分支、客户端、现代协议宿主或平台不因此次定向修复而被宣布验收通过。
