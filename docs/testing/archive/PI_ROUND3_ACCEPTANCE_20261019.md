# 第三轮五角色与真实回归验收（2026-10-19）

后续状态：F08 已在新构建中修复并完成真实复测，见 [F08 修复验收](F08_FIX_ACCEPTANCE_20261019.md)。以下保留第三轮发现问题时的原始结论。

**本轮整体未通过：固定真实回归 52/52、五个全新 pi 角色任务及独立读回均通过，但额外租约压力测试复现了尚未修复的 F08 / P1 产品问题。** 省略 AV blockID 时，载体发现会误把包含子 AV 的父文档当作载体；候选顺序变化使预检与提交目标不一致，合法提交被 preflight_lease_invalid 拒绝。该次 writeAttempted=false，没有未知写入，也没有把后续成功当作修复证据。

本轮是用户要求的再次测试，没有修改产品或发布。按当前源码重新统计，真实 mutation action 覆盖 **23/69**，其余 **40 未执行、6 明确排除**；五角色使用了 6 类工具的 21 个成功静态 action 分支，不代表完整人群、参数和全部工具均已验收。

## 环境、范围与证据

- 思源真实内核 **3.8.7**，原笔记本为“测试用”与“MCP排版测试”；授权测试本是“测试用” `20260909184210-4s2cp7v`。
- 插件版本 **0.6.11**、CLI **0.2.12** 保持不变。未发布，未替换当前安装的 `36808/mcp` 插件及 kernel.js 宿主。
- 本轮构建和真实调用经临时的新 CJS 协调器到达真实内核；API 观察地址 `http://127.0.0.1:62935`，不是未来可固化的端口。五角色临时 MCP 为 `http://127.0.0.1:59156/mcp`，临时网关现已停止。
- 权限与严格写入状态使用独立测试文件。五角色只开放受控合成工具，关闭 bash/read、其他 MCP、Skills、上下文文件；每个角色是全新会话。任务约束本身不是操作系统沙箱，实际范围还依赖 broker 的 allowlist 与 ID/路径核对。
- pi 模型目录中的模型标识为 **deepseek/deepseek-flash**，不据此推断厂商精确版本；这是 AI 角色模拟，不是真人研究。
- 原始证据目录：`.sisyphus/acceptance/recheck-round3-20261019121719`。`live.json` 是固定真实回归；`pi/ux-*.jsonl` 是角色原始调用；`pi/independent-proof.json` 是独立真实读回；`lease/` 是 F08 的专用复现与根因证据。

| 产物 | 本轮 SHA-256 |
| --- | --- |
| dist/mcp-server.cjs | `e7f3a68551e5475ee3d047e048de339f2796e9b333d4934826b048bee85de469` |
| cli/dist/cli.cjs | `99575cd0c6f362c2e81d902b8425133aa0735b13c93f4392a121a7a66f5c8c1d` |
| dist/kernel.js | `ebc1fcb6209b468aea94bab4f94bfbd1b25709d8b7b2308081d52367ea25885d` |

run.json、live.json 与 pi/broker-context.json 中记录的是同一组产物摘要。新 Node CJS 路径通过不等于已安装插件或真实 kernel.js 宿主已部署并通过。

## 固定真实回归

`live.json` 中 **52 项检查全部通过**，记录 75 条 mutation 验收结果，按 action 去重 22 个。本轮重新执行，没有借用上一轮的绿色记录。

- Markdown 创建、覆盖、替换、移动/删除，块追加/更新/属性，严格重放与旧状态拒绝。
- ensure_link_targets 完整映射和精简响应；新模板创建、覆盖、无占位另存、读取与删除；新帮助通过 HTTP、resource 与 CLI 共享路径核对。
- 全局与 scoped 引用/提及；聚合 COUNT 与显式 box 投影，覆盖固定脚本实际声明的 HTTP/direct/stdio/CLI 分支。
- AV 创建与持久重放、结构/列/raw 读取、增列增行改值、精确载体视图及镜像；省略 select 颜色、显式颜色、mSelect、嵌套 OR、重复 no_change 的原生配置和成员集合核对。
- F07 混合 group/leaf 在写前拒绝，事务请求不增加；正确叶子实际过滤有效。
- rwd/rw/r/none 四级权限：预检不被当成写权限；受限写入和删除在内核写前拒绝。受限 SQL 的代理请求计数 **184→184**，未执行；全部可读后 COUNT 返回 **n=3**，未被权限过滤吞行。

固定脚本对选定分支的成功，不能证明同 action 的所有参数组合；尤其不能覆盖本轮额外发现的无 blockID 载体选择缺陷。

## 五个全新角色的结果

五个进程均 exitCode=0、未超时，但该事实没有被单独当成任务通过。独立核验器 `pi/verify-independent.cjs` 又执行 **21 次只读内核请求、4 次新 MCP 只读查询**，对照原生状态和播种答案，最终 `independent-proof.json` 为 **5/5 passed**。

| 角色 | 工具调用 | help | 进程耗时 | 独立验收结果 |
| --- | ---: | ---: | ---: | --- |
| newcomer | 11 | 1 | 18.564s | 新文档在正确 box 且相同人类路径仅一份；中文、✅、两项待办保留；另一个只读本的同路径 shadow 正文未变。 |
| organizer | 8 | 2 | 36.670s | resolve/reuse 返回 alpha、beta 的完整 key→ID 映射，resolved/reused 各2；gamma 未创建，原生子文档集合未增加。 |
| researcher | 8 | 0 | 16.510s | 全局引用/提及恰为播种来源；source scope 和 empty scope 正确；COUNT=3 与原生 SQL 相等，投影 box 保留。 |
| database | 24 | 6 | 36.098s | 原生 keyValues 三行状态正确；筛选 committed，新 MCP 查询仅“说明整理”；省略 color 原生为空字符串；重复筛选 no_change 且未写。 |
| archivist | 12 | 2 | 19.338s | 另存新模板 committed、实际读取源码含本轮标记、删除 committed；独立原生模板路由返回404。 |
| 合计 | **63** | **11** | **累计127.180s** | 五个任务均有独立真实证据；四个错误响应按下文分类。 |

这些角色并行运行。127.180 秒是进程耗时之和，最长单进程为36.670秒，**不能将累计耗时称作整体 wall time**。未实测的首次成功耗时、token 成本、其它模型/平台/客户端体验保持 unknown，不从调用数估算。

### 新手与同路径笔记本隔离

新手创建文档 `20261019201936-8qy3iv1`，路径 `/测试用/PI-ROUND3-20261019121831/newcomer/第一次会议`；真实 box 为授权测试本，相同 hpath 的本内 ID 唯一。正文包含“小林完成接口检查”“小周整理说明 ✅”及两项未完成待办。

只读 shadow 文档 `20261019201841-boezbm4` 在另一个本中具有相同 hpath。独立原生导出的正文仍精确为 `PI-ROUND3-20261019121831 只读同路径对照夹具。`，没有被新手创建覆盖。exportMdContent 自动附带的标题/frontmatter 在比较正文前单独剥离；原始导出与摘要保留在 proof。

### 链接目标与 gamma 分类

alpha=`20261019201842-eatze7z`、beta=`20261019201842-75xa0dv` 的映射及解析/复用分类完整。模型检查不存在的 gamma 时用了 **mode=create、dryRun=true**，没有实际创建。真实返回为 `wouldCreate:[{key:"gamma",title:"方案丙"}]`、createdCount=0、unresolvedCount=0；不能把这个契约错误描述成 unresolvedCount=1。它在“不会创建缺失文档”的任务目的上通过，但本轮没有借此声称测到了缺失目标的纯 resolve 分支。

### 数据库任务与归档证据

数据库 avID=`20261019201930-2r7941y`，准确载体 blockID=`20261019201930-159sgjx`，当前 viewID=`20261019201930-jtid0in`。原生 keyValues 按 rowID 独立对应：

| rowID | 任务 | 状态 |
| --- | --- | --- |
| 20261019201943-p12ekn3 | 接口检查 | 完成 |
| 20261019201943-2e6xndd | 说明整理 | 待办 |
| 20261019201943-gt7yt37 | 结果复核 | 完成 |

第一次 update_view 请求 a1c5 为 committed，第二次 aad8 为 no_change、writeAttempted=false、writeExecuted=false。两次输入均省略颜色且叶子不带 combination；原生叶子选项 color=""，独立新 MCP 会话的精确视图查询仅返回说明整理，避免只看 committed 就误判筛选有效。

归档模板为 `PI-ROUND3-20261019121831-归档模板.md`。保存请求 a1e6 与删除请求8e86均有严格 committed 凭据；中间成功 read_template 返回实际源码及本轮标记，删除后原生 GET `/templates/<精确编码文件名>` 为404。没有为验证而恢复模板。

## 本轮问题和卡手点

| 编号/分类 | 严重度/状态 | 任务、实际结果与影响 | 证据/处理 |
| --- | --- | --- | --- |
| F08 / functional | **P1，reproduced，未修复** | 无 blockID 的 AV set_column_options 预检与提交之间，镜像候选顺序改变；父文档被错当载体，导致相同业务参数与凭据被 preflight_lease_invalid 拒绝。安全层阻止写入，但正常主操作受阻。 | 专用10轮中9次 committed，第9轮拒绝、writeAttempted=false。lease/root-cause.json 与 carrier-dom.json 已证实原因，详见下节。 |
| U03 / usability | P2，observed | newcomer/document.create 与 archivist/save_doc_as_template 各先直接写一次，被 precondition_required 拒绝；两次均 writeAttempted=false，随后按公开说明预检并成功提交。 | pi/ux-newcomer.jsonl、ux-archivist.jsonl。严格安全行为正确，但第一次写入的发现成本仍存在。未修改产品。 |
| U04 / usability/docs | P2，observed | archivist 用保存结果中的无扩展名名称去读模板，被 invalid_template_path 拒绝；补.md 后成功。save_doc_as_template 接受省略.md，但 read_template 要求.md，切换时有卡点。 | ux-archivist.jsonl 第7–8条。建议消费返回的 template.readArgs 或明确 relativePath；未在本轮修复帮助。 |
| H03 / harness | 已纠正并保留原始失败 | 独立核验初稿错误地把带frontmatter/标题的导出与裸正文比较、误拼属性端点，又把已展开的导出引用当作应含原ID。 | independent-proof-first-pass.json、second-pass.json 保留；修正后用 attr端点、精确正文、限定本轮引用文档的原生存储markdown查询，最终5/5通过。不能计作产品故障。 |

共 **3 次可恢复输入错误**：2次 precondition_required、1次 invalid_template_path；另1次 template_not_found 为删除确认的预期结果。角色轨迹没有其它错误、没有 outcome_unknown/readback_mismatch，未通过修改参数重写来“恢复”未知结果。数据库角色用了6次help，说明 ID、行列及视图写入路径仍有学习成本；不能只因调用较多就另立功能缺陷。

### F08：载体发现顺序改变导致合法租约失效

专用 `lease/lease-rounds.json` 的10轮中，第9轮在省略 blockID 时复现；前置与正式调用使用相同 argsHash、同一协调器 PID、同一份原生 AV SHA，签发凭据2276原样提交，且未过期。因此不能归因于模型改参、服务重启、AV配置变化或租约超时。

原生镜像返回候选顺序由 `[真实载体, 父文档]` 变为 `[父文档, 真实载体]`；SQL候选一直只有真实载体。当前 `src/core/write-safety-coordinator.ts` 的探测保留原生顺序，并以整个 getBlockDOM 字符串包含 NodeAttributeView 与 avID 作为依据。父文档的返回 DOM 含有子 AV，**甚至首个元素就是子 AV**，但该元素的 data-node-id 不等于被请求的父文档候选 ID。于是父文档被误认可，租约目标由真实载体切换到父文档，严格 scopeKey 匹配失败。

根因证据中的两组目标集合由实际 API 请求与源码推导；被拒绝提交没有进入 executing 账本，不能声称直接读取到了该次执行账本目标。没有检查进程私有 alias/lease 内存；相同凭据与目标 scope 的已证实不一致足以解释拒绝。

最小正确修复应检查**同一个 DOM 元素**的 data-node-id 等于 candidateID、data-type=NodeAttributeView、data-av-id 等于目标 AV，并在验证后稳定选择真实载体。只看首标签 type 仍不够。不能删除 targetIDs、放松权限/租约或关闭读回来绕过。应补镜像父子候选顺序翻转、父文档 DOM 包含子 AV、显式父文档 blockID 被拒绝的回归。

第10轮显式提供真实 blockID 后 committed，属于可用的临时路径和对照证据，**不是 F08 已修复**。先前报告中的“租约失效原因未确定”在本轮得到更强证据；旧报告不回写为当时已知。

## 完整 mutation 覆盖矩阵

`coverage.json` 按当前 config/write-safety-policy 与 acceptance-plan 清单重新计算69个 mutation。固定live的22项加 pi 的 set_column_options 得23项；lease压力测试重复同一action，不再增加计数。covered表示存在本轮真实正向分支，不代表该action所有参数稳定——F08所属set_column_options仍保留已执行正向覆盖，同时必须报告已复现失败。

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

合计 covered23、not_run40、intentionally_excluded6。排除理由是工作区全局资产清理可能涉及原用户资产、四个timeline操作会改历史仓库且未获单独授权、购买会消耗余额且无预算授权。其余40项仅是未执行，不能用“危险排除”掩盖覆盖不足。

五角色的21个成功静态action来自本轮原始响应，help和预检不计；不复用上轮109等其它读action分母。CLI受限shell角色、附件/迁移完整流程、学习闪卡人群、移动端、远程/Docker、Apps渲染与其它模型没有本轮角色证据，不能宣称标准档或发布档覆盖目标已经达到。

## 最终检查、清理与交付边界

真实测试后的 `final-verification.json` 记录本轮重新执行的最终检查，完成于 **12:27:01 UTC / 20:27:01 新加坡时间**：

| 检查 | 本轮结果 |
| --- | --- |
| 全套自动化 | final-tests.log：**130文件、1578项通过**。 |
| 插件和CLI构建 | final-build.log、final-cli-build.log 均成功。 |
| 技能生成、API映射、diff检查 | final-skills.log、final-api-audit.log、final-diff.log 均成功。 |
| TypeScript基线比较 | 本轮新执行 typecheck-v2.json：baseline24/current24/newDiagnostics=[]，无新增诊断；不等于仓库零诊断。 |
| 构建与真实测试一致性 | bundleMatchesLiveAndPi=true、bundleMatchesLease=true，三种真实测试与最终构建摘要完全相同。 |
| 整轮状态 | fullRoundStatus=finding_F08_not_fixed，leaseProbe=10轮/9committed/1写前拒绝。自动化全绿没有覆盖掉真实缺陷。 |

产品源码未因本轮测试修改；最终自动化与TypeScript基线均使用本轮新执行记录。

`cleanup-live.json` 与 `final-cleanup.json` 为 completed。独立核对本轮三个命名空间：固定live、五角色pi、专用lease；各自夹具文档、AV定义、模板和影子状态文件均已不存在，临时权限笔记本清理完成。原工具配置/权限/HTTP设置三类摘要不变，剩余笔记本恰为原“测试用”与“MCP排版测试”。只读验收脚本没有执行清理；清理由主控制器在独立验收完成后实施并另留证据。

固定回归有意保留的摘要文档为 `20261019201921-s2fu41j`，路径 `/测试用/AV-V2-20261019121836-验收报告`。`native-report-update.json` 确认已补入整轮非绿、F08未修结论并经原生读回；补写摘要不计功能覆盖。它不是仍可继续操作的测试夹具。

本轮没有自动修复F08、Git提交或发布。最终检查和清理证据已完整；F08修复后仍须以新构建复测相关真实分支，才能重新评估放行。本报告保留当前“整体未通过”的结论。
