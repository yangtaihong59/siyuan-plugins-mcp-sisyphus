# AV 筛选与共享帮助修复验收（2026-10-19）

后续[第三轮复测](./PI_ROUND3_ACCEPTANCE_20261019.md)已复现并定位本文保留的租约拒绝观察，登记为待修 F08。本文保留当轮修复及验收边界。

**最终定向真实回归 52/52 项通过；全新 pi 数据库任务完成，23 次工具调用、零工具错误、零未知写入。** 这次修复包括 F06：原生空颜色造成严格读回误判；F07：组合与叶子混合筛选被接受却忽略条件；D02：链接目标默认帮助示例缺少必需 ID。固定回归与最终 pi 使用同一组新构建 CJS SHA。

覆盖是定向的：从源码清单重新计算，最终有真实严格成功证据的 mutation action 为 **23/69**，其余 **40 未执行、6 明确排除**。不能把该结果称作全部写入 action 验收完成，也不能照搬旧脚本把所有未执行项都归为排除。

## 环境和交付边界

- 真实内核：**3.8.7**；已核对工作区及“测试用”笔记本 `20260909184210-4s2cp7v`。本轮 API 观察值为 `http://127.0.0.1:62935`，后续应重新发现端口。
- 版本保持插件 **0.6.11**、CLI **0.2.12**。未发布新包，未替换 `36808/mcp` 已安装插件进程。
- 真实操作经新构建 CJS 的临时协调器访问同一思源内核；权限与账本使用独立状态文件。pi 的内置 bash/read 和其它 MCP、Skills、上下文文件关闭，仅使用本轮隔离工具及当前公开说明。
- pi 模型为 `deepseek/deepseek-flash`；这是本机模型别名，不推断厂商精确版本。最终 pi-v2 是全新会话与新夹具，没有把中间失败的会话“续改成通过”。
- 原始证据根目录：`.sisyphus/acceptance/filter-fix-20261019-115201`。本报告基于源码、工具轨迹和主控制器独立原生读回，不以模型自述替代实际结果。

## 修复内容

| 问题 | 修复与保持的限制 | 证据 |
| --- | --- | --- |
| F06 / P1：缺省 select 颜色导致有效写入后 unknown | normalizeAvFilters 只对 select/mSelect 的嵌套选项补原生默认 color=空字符串；保留显式颜色、选项顺序、类型及其它字段。相同语义可返回 committed/no_change，真正颜色或内容变化仍可被严格比较发现，没有整体跳过读回。 | view-config、write-safety-av-filters 及 av 工具回归；最终 live-v2 的缺省/空/显式颜色、select/mSelect、嵌套 OR 和成员集合检查；pi-v2 独立核验。 |
| F07 / P1：group+leaf 混合节点静默失效 | AvFilterSchema 拒绝在同一组合节点混入 column/operator/value/quantifier/relativeDate 等叶子字段，真实预检在任何事务前拒绝。分组只有 combination 与 filters；叶子给 column/operator/value。空 filters 且无 combination 在允许层级仍视为叶子，必须验证列名，避免绕过列检查。 | mixed-node-red.log 保留先失败的回归；av-filter-depth/schema 单测；live-v2 混合节点拒绝与零事务检查，最终 pi-v2 用正确叶子筛选仅返回目标任务。 |
| D02 / P2：公开帮助的 resolve 示例只有 key | 沿现有 curated 示例配置提供 resolve/reuse 的 key+id、create 的 key+title 预检例；共享帮助默认采用首条 curated 示例，MCP、CLI 与 help resource 使用一致内容。全部现有首条 curated 示例按真实 action validator 验证，手写 extension schema 使用 Zod 转换校验。 | help-output、CLI 与 resource 回归；live-v2 真实 HTTP/help resource/CLI 示例检查。 |

AV update_view 公开帮助同步增加正确叶子默认例和嵌套组合例，含 avID、准确 carrier blockID、当前 viewID 与 validateOnly=true。组合例每层只含 combination/filters，不再诱导模型把 combination 当作叶子的附加字段。

## 中间失败与未解释观察

保留前后两轮证据，不覆盖原失败：

1. `pi/` 中间 pi：35 次调用、67.397 秒，颜色读回已修复，unknown=0，重复请求也能 no_change；但任务仍为 **partial_due_to_mixed_group_leaf**。模型提交同一节点同时包含 combination=and 和 column/operator/value，内核把它当组合节点，条件未参与实际过滤；即使写入凭据显示 committed，查询仍返回三行。这个真实任务失败促成 F07，不能只看 committed 就判过滤功能成功。
2. 同一中间运行的 `pi/ux-database.jsonl:14`：首次 set_column_options 执行被 preflight_lease_invalid 拒绝，writeAttempted=false；第15条重新预检、第16条提交后成功。**租约为何失效尚未确定**，不猜测为网络、权限或超时；正确安全拒绝与成功恢复不等于根因已经修复。最终新会话未重现，保留为未解释观察。
3. `pi-v2/` 为 F07 修复后的全新角色会话，零错误完成。使用修正后的公开帮助与真实叶子筛选形状，不读取产品源码或前一会话答案。

对租约拒绝的只读追查确认：首次预检与提交业务参数一致，间隔约 1.55 秒，未超过 10 分钟租约有效期。普通同目标状态变化应返回 `state_changed`；当前租约匹配还绑定重新探测的目标 ID，动态载体发现变化是一条可能路径，但现有证据没有两次目标列表，无法确认。本次不将该观察计入已修复项，也不归因于模型改参。

F06 原始 unknown 的风险仍按严格写入规则处理：未知结果不能因为后续查询“看起来对”就改写为成功，也不能换 requestId 重新写。本轮由新夹具验证修复后的成功凭据，未复发该未知结果。

## 最终真实结果

### 固定新构建 CJS 回归

`live-v2.json` 记录 **52/52** 检查通过、75 条 mutation 验收记录，按 mutation action 去重 22 个。涵盖：

- select 省略 color 的筛选提交成功、同参重放、原生空色读回；缺省与显式空色语义等价时 no_change 且不发事务。
- 显式颜色仍被核验；mSelect 和嵌套 OR 既检查原生 JSON，也检查正确成员集合。
- 混合 group/leaf 预检拒绝，代理事务计数不增加；普通叶子的可选空 children 保持原生语义，并继续验证目标列。
- 既有 Markdown/块、SQL 聚合与显式 box、模板/链接映射、反链、AV 视图/布局/镜像、持久重放/旧状态拒绝、四级 notebook 权限复核仍通过。HTTP/direct/stdio 与 CLI 的实际覆盖以对应检查为准，不扩大成全部入口/全部参数组合通过。

### 最终全新 pi 数据库任务

`pi-v2/pi-process-results.json`：进程 exitCode=0、未超时，**35.983 秒**；`pi-v2/independent-proof.json` 证明 **23 次调用、零工具错误、零 unknown**。进程退出码本身没有被当作验收结果。

- 三行任务独立读回：接口检查=完成、说明整理=待办、结果复核=完成。
- 省略 color 的叶子筛选实际提交为 committed；原生保存 color=空字符串。
- 独立查询只返回一条“说明整理”，rowID 为 `20261019200737-p5axku9`，没有把正确 JSON 结构当作实际过滤有效的充分条件。
- 再提交同一业务筛选，得到 **no_change、writeAttempted=false**；原参数仍省略 color，未靠人工补空色绕过问题。
- 主要 ID：avID `20261019200731-9wu55x2`、blockID `20261019200731-n3pr4yy`、viewID `20261019200731-93rwrsg`。这些是本轮夹具，不是可继续编辑的用户数据库。

轨迹定位：`pi-v2/ux-database.jsonl:18–20` 为预检、提交和实际筛选查询；`:21–22` 为重复预检与 no_change；`native-after.json` 与 independent-proof 是主控制器独立读回。

## 原生读回与写入形状边界

原生读回可能给组合节点加 `column:""`、`operator:""`、`value:null` 等默认字段。**完整原生 JSON 是读回证据，不承诺可以直接复制为 update_view 写入参数。** 写入组合节点仅传 combination/filters，叶子不传 combination；默认字段不要原样混回组合节点。

过滤树最大为 **5 层节点**：前四层可以分组，第五层只能叶子。最深叶子不携带 combination 或 filters，包括 filters=[]；不能从浅层允许空 filters 的叶子例子推广到最深层。超过深度、无必需列/操作符、同层混合字段均由真实参数校验约束；本轮不是任意深度 JSON 树兼容承诺。

## 自动化、构建与一致性

| 检查 | 当前证据 |
| --- | --- |
| 全套自动化 | 前置 automated-tests-v2.log 与真实测试后 final-tests.log 均为 **130 文件、1578 项通过**。 |
| 最终插件与 CLI 构建 | final-build.log、final-cli-build.log 成功；最终 SHA 与 live-v2/pi-v2 记录完全一致。 |
| 技能生成、API 映射、diff 检查 | final-verification.json 中三项均成功。 |
| 真实测试后验证 | final-verification.json 完整成功，bundleMatchesLiveAndPi=true，完成于新加坡时间 20:12:21。 |
| 最终 TypeScript 基线比较 | typecheck-v2.json：baseline24/current24/newDiagnostics=[]，无新增诊断；不等于整个仓库零诊断。 |

首次最终测试在受限沙箱因本地 listen EPERM 失败，原日志保留为 `final-tests-sandbox-restricted.log`；允许本地监听后同一套测试全通过。该次环境拒绝没有算作产品回归，也没有删去失败证据。

以下 SHA-256 同时记录于 `live-v2.json`、`pi-v2/broker-context.json` 和最终 `final-verification.json`：

| 产物 | SHA-256 |
| --- | --- |
| dist/mcp-server.cjs | `e7f3a68551e5475ee3d047e048de339f2796e9b333d4934826b048bee85de469` |
| cli/dist/cli.cjs | `99575cd0c6f362c2e81d902b8425133aa0735b13c93f4392a121a7a66f5c8c1d` |
| dist/kernel.js | `ebc1fcb6209b468aea94bab4f94bfbd1b25709d8b7b2308081d52367ea25885d` |

## 全部 mutation action 矩阵

通过 `scripts/acceptance-plan.mjs` 的 collectPlan 从当前 config 与 write-safety-policy 重新读取 **14 类工具、137 个静态 action，其中 69 个 mutation**。covered 只计本轮真实严格成功/无变化且读回已核验的 action；help、预检、正常拒绝、mock 及模型口述均不增加正向覆盖。

固定 live-v2 的 22 项，加上最终 pi-v2 的 `av.set_column_options`，得到 **covered 23、not_run 40、intentionally_excluded 6**；重新生成的逐项证据见 `coverage.json`。没有沿用 live-v2.coverage 中将其余47项统一写成 excluded 的粗略分类。表内按 action 去重；75条固定 mutation 记录和23次 pi 工具调用不是覆盖 action 的分母。

| 类别 | covered | not_run | intentionally_excluded |
| --- | --- | --- | --- |
| fs | `write`、`replace`、`rm`、`mv` | `reorder` | — |
| notebook | `create`、`remove`、`set_permission` | `set_open_state`、`rename`、`set_conf`、`set_icon` | — |
| document | `create`、`ensure_link_targets`、`remove` | `rename`、`move`、`reorder`、`set_attr`、`create_daily_note`、`duplicate`、`heading_to_doc`、`doc_to_heading` | — |
| block | `append`、`update`、`set_attrs` | `insert`、`prepend`、`replace`、`delete`、`move`、`set_fold_state`、`transfer_references`、`add_to_daily_note` | — |
| av | `create`、`add_rows`、`add_column`、`set_cells`、`set_column_options`、`add_view`、`update_view` | `remove_rows`、`remove_column`、`duplicate_rows`、`duplicate`、`set_new_item_templates`、`create_from_template`、`configure_two_way_relation`、`configure_rollup`、`set_relation` | — |
| file | `create_template`、`delete_template`、`save_doc_as_template` | `upload_asset`、`update_template`、`rename_asset`、`delete_asset` | `remove_unused_assets` |
| search | — | `find_replace` | — |
| tag | — | `rename`、`remove` | — |
| timeline | — | — | `create_node`、`delete_node`、`rollback_document`、`rollback_block` |
| flashcard | — | `review_card`、`create_card`、`remove_card` | — |
| mascot | — | — | `buy` |

六项排除的原因：file.remove_unused_assets 涉及工作区全局资产清理，可能触及原用户资产；四个 timeline mutation 会改动历史仓库，未获快照/回滚授权且此前缺仓库密钥；mascot.buy 消耗真实余额，未获购买预算。其余40项未执行只是本轮定向范围不足，不能泛化称作危险排除或产品不支持。

运行时分支仍需分开理解：fs.write/create_template 的新增与 overwrite、ensure_link_targets 的只读 resolve/reuse/dryRun 和真实 create，都不能由一个 action 计数覆盖全部。external 类的 notify/sync/feedback/未知动态扩展写操作不执行；受控本地导出属于另一种证据，亦不混入69 mutation 分母。

## 清理和保留内容

`cleanup-v2.json` 为 completed：固定回归根文档、临时 AV 承载/定义、两个模板、两个影子状态文件及四个权限笔记本均完成精确清理；原三类配置摘要一致，剩余原笔记本数为2。

`final-cleanup.json` 再次独立核对 **4 轮命名空间**（live.json、live-v2.json、pi/broker-report.json、pi-v2/broker-report.json）：各轮夹具文档、AV 定义、模板、临时状态文件均已清理，原工具配置/权限/HTTP 设置三类摘要一致。保留原来的“测试用”和“MCP排版测试”两个笔记本。

实际保留两篇验收摘要，均为本轮固定回归报告：

- 最新最终报告 `20261019200709-wm08rbi`，路径 `/测试用/AV-V2-20261019120626-验收报告`。
- 前一轮中间回归报告 `20261019195835-3vxzcm3`，路径 `/测试用/AV-V2-20261019115745-验收报告`。

两篇摘要属于有意保留的验收记录；其余夹具不存在的结论来自独立 API 核对，不从模型答复或脚本退出码推断。

最新摘要已补入 F06/F07/D02 与最终 pi 结果，并通过原生 Markdown 导出读回确认，见 `native-report-update.json`。该报告补写不计入 MCP 功能覆盖。

本轮未提交 Git、未发布包、未替换当前运行插件。新 Node CJS 验收不等于已安装插件或真实 kernel.js 宿主已部署本轮代码；其它客户端、平台和全量写入分支仍按实际证据范围说明。
