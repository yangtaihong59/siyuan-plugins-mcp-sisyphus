# 第五轮真实变体测试与 pi 验收（2026-10-19）

本轮未发现新的产品 P0/P1。固定真实回归54/54通过，F08十轮租约提交和原生读回全部成功；五个全新pi角色任务经独立读回5/5通过。角色共76次调用尝试：72次进入MCP工具，4次被测试网关拦截。本轮新增局部编辑保留内容、改名、单条分页全集与SQL零匹配场景，不能等同全部工具或发布验收。

## 环境与证据

- 真实思源3.8.7，核实 API 为127.0.0.1:49502；测试本“测试用” `20260909184210-4s2cp7v`，rwd。只操作本轮带前缀夹具，临时本权限与账本走独立API文件。
- 先核对 pi 模型目录，使用 `deepseek/deepseek-flash`。第一次环境核对遇到自动审批超时，重试成功；不是模型或思源功能失败。
- 五个全新会话串行执行；每个上限60次调用/6分钟，只开放受控合成笔记工具，关闭shell、本地读写、其它MCP、Skills及上下文文件。任务中给出已授权位置和公开工具说明，不是首次接入配置的完全盲测。
- 新构建通过临时Node HTTP协调器调用真实内核。未替换已安装36808插件或kernel.js宿主；新CJS验收不能推断已安装版本已更新。
- 证据目录：`.sisyphus/acceptance/pi-round5-20261019`。`run.json`、`inventory.json`记录边界，`live.json`为固定回归，`pi/ux-*.jsonl`为实际工具响应，`pi/guard.jsonl`为未下发请求，`pi/independent-proof.json`为原生独立核验，`coverage.json`与`findings.json`汇总口径。

## 角色结果

| 角色 | 尝试/进入工具 | help | 进程耗时 | 独立结果 |
| --- | ---: | ---: | ---: | --- |
| newcomer | 5/5 | 0 | 8.473s | 正确测试本唯一创建会议文档；中文与emoji保留，两条普通列表待办准确，同路径只读对照未改。复选框格式未测。 |
| organizer | 17/16 | 2 | 22.375s | 只替换负责人/状态段，公式和URL保留；编辑草稿改名为编辑定稿，旧路径不存在，原方案文档保留。 |
| researcher | 17/14 | 0 | 25.391s | 引用/提及及限定范围正确；COUNT=3与原生一致，box保留；type=av零匹配返回[{av_count:0}]且与原生SQL一致。 |
| database | 26/26 | 6 | 33.607s | 四条任务状态正确；筛选后说明整理/边界检查两条待办，各页1条，全集无重复无遗漏；重复保存筛选no_change。 |
| archivist | 11/11 | 2 | 16.516s | 新模板保存/读取/删除成功，原生404确认删除；没有占位模板，也无缺.md路径错误。 |

角色进程串行合计106.362秒，不包含构建、播种、独立核验与清理。help共10次；成功分支涉及5类工具、24个静态action；help、预检及拒绝不算正向action覆盖。没有超时、未知写入或模型参数人工纠正。token成本未统计。

## 卡点与首次失败记录

| 分类 | 观察 | 判断 |
| --- | --- | --- |
| U03 / usability P2 | 整理第5次、归档第4次工具调用漏预检requestId；两次均precondition_required、writeAttempted=false，随后预检并成功。 | 既有学习成本再次复现，严格安全行为正确。 |
| U05 / usability + 测试范围 | 网关拦截4次：创建漏notebook；全文检索漏parentId；尝试读取笔记本根树；把含笔记本名的路径传入本地hpath。 | 全部dispatched=false。前两类参数/范围、路径切换有理解成本；根树读取受本轮隔离范围禁止，不代表产品不支持。不能将网关错误当作内核错误或越权泄漏。 |
| H04 / harness | 初次独立核验将“两项待办”强制要求为两个复选框，实际模型创建了两条普通列表。 | 任务未要求复选框。保留independent-proof-first-pass.json；按原任务重新核对两个负责人/事项和完整内容，未修改笔记，最终通过。不能声称本轮验证了复选框。 |
| 预期不存在 | 归档创建前及删除后各一次template_not_found。 | 正常存在性检查，不能计为产品缺陷。 |

F08未复现；固定脚本五轮原生候选顺序、五轮仅翻转真实候选顺序均committed并精确读回。父文档显式blockID仍在写前拒绝，正确载体跨HTTP预检/CLI提交及原请求重放通过。此次是用户要求的测试，没有因卡点自动修改产品。

## mutation覆盖矩阵

共69项：24 covered、39 not_run、6明确排除。相比上轮，本轮pi新增document.rename正向证据。covered只是存在成功分支，不代表全部参数均验证。

| 工具 | covered | not_run | intentionally excluded |
| --- | --- | --- | --- |
| fs | `write`、`replace`、`rm`、`mv` | `reorder` | — |
| notebook | `create`、`remove`、`set_permission` | `set_open_state`、`rename`、`set_conf`、`set_icon` | — |
| document | `create`、`ensure_link_targets`、`rename`、`remove` | `create_daily_note`、`duplicate`、`move`、`reorder`、`set_attr`、`heading_to_doc`、`doc_to_heading` | — |
| block | `append`、`update`、`set_attrs` | `insert`、`prepend`、`add_to_daily_note`、`replace`、`delete`、`move`、`set_fold_state`、`transfer_references` | — |
| av | `create`、`add_rows`、`add_column`、`set_cells`、`set_column_options`、`add_view`、`update_view` | `remove_rows`、`remove_column`、`duplicate_rows`、`duplicate`、`set_new_item_templates`、`create_from_template`、`configure_two_way_relation`、`configure_rollup`、`set_relation` | — |
| file | `create_template`、`delete_template`、`save_doc_as_template` | `upload_asset`、`update_template`、`rename_asset`、`delete_asset` | `remove_unused_assets` |
| search | — | `find_replace` | — |
| tag | — | `rename`、`remove` | — |
| timeline | — | — | `create_node`、`delete_node`、`rollback_document`、`rollback_block` |
| flashcard | — | `review_card`、`create_card`、`remove_card` | — |
| mascot | — | — | `buy` |

明确排除全局资产清理、历史仓库写入和购买；同步/通知/反馈/第三方写入未执行。附件迁移、闪卡、独立CLI角色、多平台/远程、Apps、其他模型与已安装kernel宿主仍未验收。14工具/137action/58场景的计划检查不算实际执行证据。

## 最终验证和清理

真实测试后重新执行：131文件、1587自动化测试通过；插件/CLI构建、技能生成检查、API映射检查和diff检查通过。TypeScript baseline24/current24，无新增诊断。最终产物与本轮实际使用摘要相同：

| 产物 | SHA-256 |
| --- | --- |
| `dist/mcp-server.cjs` | `bc7faad98de00cb844b2b353eb6fcfd67349843ec87bb9dd859aedadc88395d3` |
| `cli/dist/cli.cjs` | `7c4a3c3d9554b504da1ef768296117bc8935f8b45e79167c6f1ca6752e5e3c25` |
| `dist/kernel.js` | `fabcb432da288d234514bbd4337d839ed3644c039acfe914594e4781a0ed182e` |

固定回归与pi两组夹具均清理并原生核对：文档、AV载体/定义、模板、临时权限本、影子权限/账本均已不存在。原配置三类摘要未变，原笔记本仍为2。仅保留本轮摘要并补入pi结果：

- `20261019222453-mhoeixv`
- `/测试用/AV-V2-20261019142353-验收报告`

插件仍0.6.11、CLI仍0.2.12。没有Git提交、发布或替换当前运行插件。
