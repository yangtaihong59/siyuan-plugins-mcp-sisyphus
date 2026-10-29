# 第四轮 pi 场景与真实回归验收（2026-10-19）

本轮未发现新的 P0/P1；F08 未复现，修复后的隐式载体路径获得固定脚本和全新 pi 会话两类真实证据。固定回归54/54通过，五个全新角色62次工具调用，独立读回5/5通过。仍有两次漏预检造成的可恢复卡点。本轮属于聚焦回归与五角色抽样，不代表标准档或发布档全覆盖。

## 环境与执行方式

- 内核3.8.7，重新发现 API 端口49502，并核对原“测试用”“MCP排版测试”两个笔记本。授权测试本为 `20260909184210-4s2cp7v`。
- 运行前核实 pi 模型目录：`deepseek/deepseek-flash`；不据别名推断供应商精确版本。
- 新构建 CJS 经临时 Node HTTP 协调器访问真实内核。权限和账本使用独立 API 文件，未改原配置。实际安装的36808插件及其 kernel.js没有被替换。
- 五个会话串行执行，每个最多60次工具调用/6分钟，仅开放六类受控合成工具，关闭本地读写/bash、其他 MCP、Skills及上下文文件。角色没有读取源码或上一轮轨迹；提供了场景位置与公开工具说明，所以不声称覆盖首次连接配置的完全盲测。
- 任务提示不是操作系统沙箱；实际边界由网关 action allowlist、ID/路径归属、角色写入范围、未知结果冻结共同执行。
- 初次在受限沙箱查询模型目录遇到 pi 状态锁 EPERM；允许本机状态访问后成功，没有换模型。该环境问题发生在正式角色任务之前。

证据目录：`.sisyphus/acceptance/pi-round4-20261019`。`run.json`、`inventory.json`记录范围/清单，`live.json`记录固定回归，`pi/ux-*.jsonl`记录真实工具响应，`pi/independent-proof.json`记录独立读回，`coverage.json`与`findings.json`记录覆盖/卡点。

## 五角色结果

| 角色 | 调用 | help | 进程耗时 | 独立核验 |
| --- | ---: | ---: | ---: | --- |
| newcomer | 8 | 0 | 12.755s | 正确测试本创建唯一会议文档；中文、emoji和两项待办保留；只读同路径对照未改。 |
| organizer | 7 | 1 | 12.022s | alpha/beta解析与复用映射完整；子文档集合未变，gamma未创建。 |
| researcher | 12 | 1 | 13.582s | 引用/提及来源及限定范围正确；空范围为空；COUNT=3与原生一致，box列保留。 |
| database | 25 | 6 | 32.384s | 三条任务状态正确；保存筛选后仅说明整理；重复保存no_change且零写入。 |
| archivist | 10 | 1 | 12.558s | 新模板保存、读取、删除成功，原生模板路由404确认删除。 |

五个进程合计83.301秒，串行执行；此数不含构建、播种、独立核验与清理，不是整轮总耗时。均未超时，无人工参数修正。角色使用六类工具、21个成功静态action，help共9次；这些计数不是完整工具覆盖率。token成本未统计。

整理角色仍用 `mode=create, dryRun=true` 检查不存在的gamma，返回wouldCreate、createdCount=0、unresolvedCount=0。原生子文档集合证明没有创建；不将此记作缺失目标的纯resolve分支。

## 重点与卡点

| 项目 | 本轮观察 | 结论 |
| --- | --- | --- |
| F08载体租约 | 固定脚本10轮省略blockID均committed并精确原生读回；其中5轮仅翻转真实候选顺序。显式父文档被写前拒绝，正确显式载体HTTP预检/CLI提交及重放成功。pi数据库角色自行省略blockID的set_column_options也成功。 | 本轮未复现，修复保持有效。 |
| U03首次写入预检 | newcomer第3次、archivist第4次调用漏requestId，precondition_required且writeAttempted=false；随后各自预检并成功提交。 | P2 usability再次复现；严格安全正确，学习成本仍在。建议后续评估工具描述/调用指引，不自动弱化预检。 |
| U04模板扩展名 | 归档角色读取时一直使用.md，未出现invalid_template_path。 | 本轮未复现；模型本轮选择正确不能证明文档改动已消除所有用户卡点。 |
| 模板不存在 | 创建前及删除后各一次template_not_found。 | 两次正常存在性检查，不计功能失败。 |

没有outcome_unknown/readback_mismatch，没有通过换requestId恢复未知写入。数据库角色6次help仍反映领域学习成本，单凭调用数量不新增功能缺陷。此次仅测试和记录，没有自动修产品。

## 实际覆盖边界

固定真实回归54项含文档/块/路径往返、模板、引用、COUNT与选中列、AV创建/行列/视图/镜像、四级权限、重放及状态变化拒绝。HTTP/direct/stdio/CLI验证的是脚本声明的选定分支；不是每个action均经所有传输。

69个mutation逐项矩阵：23covered、40not_run、6明确排除。五角色没有新增超出这23项的mutation。

| 工具 | covered | not_run | intentionally excluded |
| --- | --- | --- | --- |
| fs | `write`、`replace`、`rm`、`mv` | `reorder` | — |
| notebook | `create`、`remove`、`set_permission` | `set_open_state`、`rename`、`set_conf`、`set_icon` | — |
| document | `create`、`ensure_link_targets`、`remove` | `create_daily_note`、`duplicate`、`rename`、`move`、`reorder`、`set_attr`、`heading_to_doc`、`doc_to_heading` | — |
| block | `append`、`update`、`set_attrs` | `insert`、`prepend`、`add_to_daily_note`、`replace`、`delete`、`move`、`set_fold_state`、`transfer_references` | — |
| av | `create`、`add_rows`、`add_column`、`set_cells`、`set_column_options`、`add_view`、`update_view` | `remove_rows`、`remove_column`、`duplicate_rows`、`duplicate`、`set_new_item_templates`、`create_from_template`、`configure_two_way_relation`、`configure_rollup`、`set_relation` | — |
| file | `create_template`、`delete_template`、`save_doc_as_template` | `upload_asset`、`update_template`、`rename_asset`、`delete_asset` | `remove_unused_assets` |
| search | — | `find_replace` | — |
| tag | — | `rename`、`remove` | — |
| timeline | — | — | `create_node`、`delete_node`、`rollback_document`、`rollback_block` |
| flashcard | — | `review_card`、`create_card`、`remove_card` | — |
| mascot | — | — | `buy` |

全局资产清理、历史仓库写入、购买明确排除。通知/同步/反馈/第三方写入未执行。附件迁移、闪卡、独立CLI角色、远程/Docker、移动端、Apps及其他模型没有本轮体验证据。计划检查的14工具/137action/58场景只是规划覆盖，不是完成测试数量。

## 最终检查、产物与清理

真实测试后全套自动化131文件、1587项通过；插件/CLI构建、技能生成、API映射及diff检查通过。TypeScript仍有既存24项诊断，无新增。最终构建摘要与本轮固定脚本及pi实际使用的产物一致：

| 产物 | SHA-256 |
| --- | --- |
| `dist/mcp-server.cjs` | `bc7faad98de00cb844b2b353eb6fcfd67349843ec87bb9dd859aedadc88395d3` |
| `cli/dist/cli.cjs` | `7c4a3c3d9554b504da1ef768296117bc8935f8b45e79167c6f1ca6752e5e3c25` |
| `dist/kernel.js` | `fabcb432da288d234514bbd4337d839ed3644c039acfe914594e4781a0ed182e` |

两组命名空间均已清理：夹具文档、AV载体和定义、模板、临时笔记本及影子状态文件均不存在。原配置三类摘要不变，剩余原笔记本仍为2。只保留本轮验收摘要并追加pi结论、原生读回确认：

- `20261019210600-363m59x`
- `/测试用/AV-V2-20261019130457-验收报告`

版本保持插件0.6.11、CLI0.2.12；本轮没有Git提交、发布或替换运行中的插件。
