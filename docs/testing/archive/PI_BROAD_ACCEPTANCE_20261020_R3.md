# PI Broad 验收 2026-10-20 R3

> 本报告只记录本轮真实执行与独立读回。结论不是“全量通过”，也不宣称已安装宿主通过。

## 结论

- 静态 action 账目：**137/137** 已逐项登记。
- 强正向覆盖：**99/137**。每项须同时满足 `status=passed`、`kind=success`、`real=true`、`readbackVerified=true`，并有一项独立 native/content/role oracle；逐项审计见 `positive-audit.json`。
- 弱/仅契约观察，不计正向：**21**。
- 失败：**1**；阻塞/排除：**13**；未执行：**2**；正常拒绝：**1**（feedback 空描述，零发送）。
- 9 类角色：**8 完成，1 部分完成，0 blocked**。其中 learner 经一次修正后重跑；CLI 为 assisted shell，首次失败无写入，重跑成功。
- 产品问题：`flashcard.review_card` 的 `no_change` 与真实复习状态变化矛盾；`timeline.list_nodes` 因数据仓库密钥未初始化不可用；admin 观察到的扩展 hint 与统计字段不一致。
- 本轮验收对象是 fresh dist（fe307e043bb8…）经临时 Node 协调器；已安装宿主 SHA 不同，**不宣称已安装宿主验收**，未替换、未重启、未提交。

## 环境与真实性

- 恢复轮 API：`http://127.0.0.1:50789`，显式 workspace `/Users/skycat/SiYuanDev`，SiYuan **3.8.7**；测试本 `20260909184210-4s2cp7v`（测试用）权限 **rwd**。
- 生产 64068 未用于测试。必须透明记录：首次失败的 CLI 会话有一条命令漏加 `--config`，CLI 自动发现 64068 并只列出工具目录；没有读取/写入笔记内容，没有改权限/设置。之后所有成功 CLI 调用均走本轮 broker 代理。详见 `findings.json#F-CLI-PROD-DISCOVERY`。
- 构建 SHA 保持：server `fe307e043bb89e3f916be9943e5bf688ce7b8d36073540248258a29b8a341802`；CLI `bf0d55371ef51578d4db2282e588d4ab062e6c68003753ecb5edc8bee0d92827`；kernel `5377e93938b7e859eacf3eadd917a55a5f0e5ed9015a6acae363073bcd9b8aa4`。
- 除精确清理外，产品写操作走 MCP/CLI 预检提交；修正后的 mut 只复制 `preflight.commitArgs`。旧 breadth 原始报告未改写，最终账目另做逐项降级/审计。
- 原始 JSONL 保留请求/响应；未输出 token 或生产配置正文。

## 恢复轮：旧夹具精确清理

旧 broker PID 34676 已不存在。依据 `ux/broker-context.json`、`cleanup.json`、AB 报告和创建回执，逐项核对 box+hpath 后清理：

- breadth 自动中间文档：`20261020104643-tw440b3`（/PIFULL3-20261020104420-BREADTH）、`20261020104643-m7ncukg`（…/ext）。
- 旧 UX 根 `20261020105220-nk2mkja` 及其角色子树；shadow notebook `20261020105224-uhyy35b`；隔离 deck `20261020105224-ysvcvk2`。
- 两个孤儿 AV JSON：`20261020105034-d68m8js`、`20261020105034-d1ghtho`。删除前核对 definition.id 与 SQL/工作区无 carrier。
- 旧影子 ledger/permissions：`writeSafetyLedger-PIFULL3-261020025210-UX`、`notebookPermissions-PIFULL3-261020025210-UX`。

清理后只读 prefix 查询为空，笔记本列表回到原两项，权限文件哈希/内容恢复，deck 为空。证据：`ux-resumed/old-cleanup.json`、`ux-resumed/old-cleanup-post.json`。

## 9 个全新 pi 角色

模型：deepseek/deepseek-flash，pi 1.3.0；每角色 3 分钟/25 调用；8 个 MCP 角色通过 per-role 工具白名单 broker，broker 写队列串行；最多并行 3 个会话。CLI 有 shell，明确标 assisted。

| 角色 | 模式 | 最终状态 | 实际工具调用 | help | 错误调用 | 结果摘要 |
|---|---|---|---:|---:|---:|---|
| newcomer | mcp-broker | completed | 15 | 0 | 6 | 创建会议记录并读回中文/emoji/两项待办；首次 parentPath+title 被代理路径格式拒绝，未写入，改用 notebook+path 成功。 |
| organizer | mcp-broker | completed | 17 | 0 | 3 | 三段精确写入，只替换第二段，改名“编辑定稿”，旧标题不存在；读回三段完整。 |
| researcher | mcp-broker | completed | 25 | 0 | 13 | get_backlinks 区分引用与文字提及；SQL 返回根文档 n=5、box 归属、type=av=0。 |
| database | mcp-broker | completed | 24 | 0 | 1 | 创建原生 AV、四行任务、状态单选、完成两项、保存待办筛选、每页1条无重复无遗漏、重复保存无修改。 |
| archivist | mcp-broker | completed | 12 | 0 | 3 | 另存新模板、读取含标记、删除、再次确认不存在；未创建占位模板。 |
| learner | mcp-broker | completed-after-retry | 19 | 0 | 2 | 隔离牌组真实 cardID 创建/复习/删除；review_card 返回 no_change，但 list_cards unreviewedNewCardCount 1→0，实际状态已变化。 |
| multiend | mcp-broker | partial | 9 | 0 | 1 | 版本、时间、笔记本/权限、扩展发现可读；timeline.list_nodes 因数据仓库密钥未初始化不可用。 |
| admin | mcp-broker | completed-readonly | 8 | 0 | 0 | 只读检查笔记本/权限/config/扩展诊断/只读笔记本受限文档；未改设置。扩展 hint 与 plugin=0/exposedCount=0 数据自相矛盾，作为观察记录。 |
| cli | assisted-shell | completed-assisted | 19 | 0 | 0 | 成功会话通过 broker 代理完成版本/时间/笔记本/权限/读取/fs replace/读回 marker-CLI-NEW，退出码正常。 |

关键说明：

- `calls` 来自 pi `tool_execution_end` 与 broker dispatch 账本，不采用模型口述当执行证据；会话 JSONL 与 broker 的 `ux-*.jsonl` 均保留。
- 代理 scope 拒绝（SQL 形状、绝对模板路径、human path、猜 avID、初始 cardID gate）**不计产品错误**；已分别在结果里说明，需要时用公开 help 或参数修正完成。
- learner 首次被 broker 的真实 cardID gate 误拒（测试代理缺陷），修正 gate 后用真实 cardID `20261020110818-f0j7gh2` 重跑：list_cards `unreviewedNewCardCount` 1→0，review_card 仍返回 `no_change`；角色没有换 ID 或重复写。card 已删除，deck 已清理。
- multiend 4 项可读；`timeline.list_nodes` 返回“请先初始化数据仓库密钥”，未尝试初始化。
- CLI 重跑成功：读取、fs replace、读回 `marker-CLI-NEW`，正常退出码 0。首次失败是配置/协调器问题，无写入。

## 正向计数审计

审计策略：`positive-audit.json` 对每个正向 action 要求至少一个独立 oracle，来源包括 breadth 带 seq 的读回、live-av strictReadback mutation、live-av 具体检查、supplement/retest 强读回、conversion 检查或本轮隔离角色真实调用。空数组、仅 JSON 形状、仅 `committed`、仅 help/契约均不计。

- 正向：**99**；oracle 分布（可重叠）：live-av-check=6、live-av=24、breadth=77、conversion=16、retest=3、supplement=1、role-oracle=2。
- 本轮把 `flashcard.list_cards` 与 `flashcard.get_cards` 从旧 weak/blocked 提升为正向，依据是隔离 deck 的真实 cardID 与删除前后 total 1→0；不是长度断言。
- `flashcard.review_card` 仍为 failed，不因角色“完成流程”而改为正向。
- 仍为 weak/契约的 21 项未计入；排除的同步/通知/购买/快照回滚/全局未引用清理等未执行。

## Findings

### F-REVIEW-NOCHANGE — flashcard.review_card reports no_change while native review state changes

- 严重性/状态：product / confirmed
- 说明：Using an isolated deck, real cardID 20261020105138-a5m1xsm (block 20261020105138-cpr0cb8), preflight/commit via commitArgs rating=3 returned transactionState=no_change and result=null. Native /api/riff/getRiffDueCards before showed reps=0,state=0,lastReview=-62135596800000,due=1; after showed the card removed from due, due=0. This directly contradicts no_change. Learner confirmation method: list_cards/getRiffDueCards before and after, using cardID returned by list_cards (not blockID); do not trust transactionState alone.
- 证据：.sisyphus/acceptance/pi-broad-20261020-r3/supplement-retest/report.json、.sisyphus/acceptance/pi-broad-20261020-r3/supplement-retest/raw/calls.jsonl

### F-HOST-SHA — Installed host artifacts differ from the tested fresh bundles

- 严重性/状态：environment / confirmed
- 说明：run.json records installedHostArtifacts.matchesExpected=false. Acceptance only covers fresh dist bundles through a temporary Node coordinator; it does not claim the installed host was validated. No replacement/restart was performed.
- 证据：.sisyphus/acceptance/pi-broad-20261020-r3/run.json

### F-HOST-LOST — Test SiYuan instance at 127.0.0.1:57560 exited during role scheduling

- 严重性/状态：environment / resolved-after-resume
- 说明：The test workspace was reopened at 127.0.0.1:50789 with explicit workspace /Users/skycat/SiYuanDev. The old broker PID 34676 no longer existed. Nine fresh role sessions were run; this finding remains as history only.
- 证据：.sisyphus/acceptance/pi-broad-20261020-r3/logs/ux-run.log、.sisyphus/acceptance/pi-broad-20261020-r3/ux/broker.log、.sisyphus/acceptance/pi-broad-20261020-r3/ux-resumed/role-analysis.json、.sisyphus/acceptance/pi-broad-20261020-r3/ux-resumed/post-clean-initial.json

### F-RESIDUAL-AUTODOCS — Two auto-created intermediate documents from the earlier breadth batch remain

- 严重性/状态：cleanup / resolved
- 说明：Exact IDs 20261020104643-tw440b3 and 20261020104643-m7ncukg were verified by box+hpath, removed via exact API, and the prefix query returned empty. Evidence ux-resumed/old-cleanup.json and old-cleanup-post.json.
- 证据：.sisyphus/acceptance/pi-broad-20261020-r3/breadth/extended.json、.sisyphus/acceptance/pi-broad-20261020-r3/ux-resumed/old-cleanup.json

### F-WEAK-ASSERTIONS — Old breadth pass() defaulted readbackVerified=true

- 严重性/状态：test-quality / mitigated
- 说明：Final account does not edit the original breadth report. It downgrades length-only, empty-shape and committed-only assertions to kind=help_only/readbackVerified=false, so they are excluded from positive coverage. Mutations in the corrected retest used preflight.commitArgs exactly.
- 证据：.sisyphus/acceptance/pi-broad-20261020-r3/breadth/extended.json、.sisyphus/acceptance/pi-broad-20261020-r3/functional-actions.json

### F-UX-RESIDUAL — Role fixture documents/notebook/deck remain in the offline test workspace

- 严重性/状态：cleanup / resolved
- 说明：Old UX root 20261020105220-nk2mkja, role subtree, shadow notebook 20261020105224-uhyy35b, deck 20261020105224-ysvcvk2, two orphan AV JSONs and old shadow ledger/permission files were verified and removed by exact ID/path. Post query empty; original permissions restored.
- 证据：.sisyphus/acceptance/pi-broad-20261020-r3/ux/broker-context.json、.sisyphus/acceptance/pi-broad-20261020-r3/ux-results.json、.sisyphus/acceptance/pi-broad-20261020-r3/ux-resumed/old-cleanup.json

### F-RESUME-REVIEW-NOCHANGE — Resumed learner confirms review_card no_change while new-card count changes

- 严重性/状态：product / confirmed
- 说明：Isolated deck 20261020110812-85fu57z, real cardID 20261020110818-f0j7gh2. review_card commitArgs rating=3 returned transactionState=no_change/previousHash=resultHash. Before: list_cards filter=new unreviewedNewCardCount=1; after: same filter count=0, old/due empty. This is the same mismatch as F-REVIEW-NOCHANGE. The role did not retry or change IDs; the card was removed and deck cleaned.
- 证据：.sisyphus/acceptance/pi-broad-20261020-r3/ux-resumed/retry/ux-learner.jsonl、.sisyphus/acceptance/pi-broad-20261020-r3/ux-resumed/retry/pi-learner.jsonl、.sisyphus/acceptance/pi-broad-20261020-r3/positive-audit.json

### F-CLI-PROD-DISCOVERY — First failed CLI attempt auto-discovered production port 64068 read-only after omitting --config

- 严重性/状态：safety / recorded
- 说明：The first CLI session used the wrong config path and one command omitted --config; CLI discovery connected to 127.0.0.1:64068 and listed the tool directory. It did not read or write note content and did not change permissions/settings. All later successful CLI calls used the broker proxy. No production data is included in evidence.
- 证据：.sisyphus/acceptance/pi-broad-20261020-r3/ux-resumed/retry/pi-cli.jsonl、.sisyphus/acceptance/pi-broad-20261020-r3/ux-resumed/retry/broker-report.json

### F-LEARNER-GATE — Initial resumed broker rejected a real deck cardID (proxy bug, not product)

- 严重性/状态：test-quality / mitigated
- 说明：The first learner session used a real cardID but the generic foreign-ID gate rejected it before the deck-specific check. The gate was corrected to allow real cardIDs from getRiffCards/getRiffDueCards, then a fresh learner session completed with zero guard rejections. This is not counted as a product error.
- 证据：.sisyphus/acceptance/pi-broad-20261020-r3/ux-resumed/guard.jsonl


## 父代理最终复核

- 原始调用证据复核后，`document.list_tree` 和 `document.get_child_docs` 只有空结果结构断言，均降级；最终强正向为 **99/137**，不是 pi 初报的 101。
- 产品源码及三个构建哈希均未变化。只更新本轮报告与临时验收材料。
- `flashcard.review_card` 另有 ID 校验卡点：传入本轮 `blockID` 作为 `cardID` 时未明确拒绝，返回 `no_change`；真实 `cardID` 的复习状态变化也返回 `no_change`。前者为错误输入反馈，后者为已确认回执问题。
- breadth 曾在内置牌组添加并删除本轮测试卡；随后补测和角色测试改用新建隔离牌组。不能宣称整轮从未操作内置牌组。
- 父代理发现并删除了本轮模板留下的空目录，删除前已通过 API 核对目录确为空。另清理了数据库角色留下的一个孤立 AV 定义（先核对创建回执、承载块消失、无引用及 definition.id）。最终 `parent-final-audit.json` 确认：本轮文档/牌组/附件/模板/影子配置均无残留，7 个创建回执对应 AV 定义均返回业务 404，原两本笔记本及权限哈希不变。

## 清理审计

- 旧 breadth 两个自动中间文档：已按精确 ID 清理并读回为空。
- 旧 UX 根/角色文档/shadow notebook/deck/AV JSON/影子文件：已精确清理；无宽前缀删除。
- ux-resumed 三个前缀（initial、learner retry、CLI retry）：broker 精确删除后，等待索引刷新再读回，`allPrefixBlocks=[]`、decks=[]、无 shadow notebook；原笔记本列表与原权限文件未变。
- 所有 AV JSON 删除前核对 definition.id，并检查实际 carrier 不存在；没有扫全局 unused。
- 清理证据：`cleanup.json`、`ux-resumed/post-clean-initial.json`、`ux-resumed/retry/post-clean.json`、`ux-resumed/cli2/post-clean.json`。

## 137 action 账目

| # | action | status | kind | verified | 说明 |
|---:|---|---|---|---|---|
| 1 | `fs.ls` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 2 | `fs.tree` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 3 | `fs.read` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 4 | `fs.write` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 5 | `fs.replace` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 6 | `fs.rm` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 7 | `fs.mv` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 8 | `fs.reorder` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 9 | `fs.search` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 10 | `notebook.list` | not_run | success | false | No independent positive evidence in this round. |
| 11 | `notebook.create` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 12 | `notebook.set_open_state` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 13 | `notebook.remove` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 14 | `notebook.rename` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 15 | `notebook.get_conf` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 16 | `notebook.set_conf` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 17 | `notebook.set_icon` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 18 | `notebook.get_permissions` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 19 | `notebook.set_permission` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 20 | `notebook.get_child_docs` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 21 | `document.create` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 22 | `document.lookup` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 23 | `document.ensure_link_targets` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 24 | `document.rename` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 25 | `document.remove` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 26 | `document.move` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 27 | `document.reorder` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 28 | `document.get_child_blocks` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 29 | `document.get_child_docs` | passed | help_only | false | 父代理复核：本轮仅返回空 tree/children；breadth 断言仅检查数组或 JSON 长度，conversion 驱动没有实际调用本 action，故不算强正向覆盖。 |
| 30 | `document.set_attr` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 31 | `document.list_tree` | passed | help_only | false | 父代理复核：本轮仅返回空 tree/children；breadth 断言仅检查数组或 JSON 长度，conversion 驱动没有实际调用本 action，故不算强正向覆盖。 |
| 32 | `document.search_docs` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 33 | `document.get_doc` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 34 | `document.get_outline` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 35 | `document.create_daily_note` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 36 | `document.duplicate` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 37 | `document.heading_to_doc` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 38 | `document.doc_to_heading` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 39 | `block.insert` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 40 | `block.prepend` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 41 | `block.append` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 42 | `block.update` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 43 | `block.replace` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 44 | `block.delete` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 45 | `block.move` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 46 | `block.set_fold_state` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 47 | `block.get_kramdown` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 48 | `block.batch_kramdown` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 49 | `block.get_children` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 50 | `block.transfer_references` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 51 | `block.set_attrs` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 52 | `block.get_attrs` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 53 | `block.info` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 54 | `block.breadcrumb` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 55 | `block.dom` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 56 | `block.recent_updated` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 57 | `block.word_count` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 58 | `block.add_to_daily_note` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 59 | `block.docs_info` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 60 | `av.search` | blocked | success | false | 隔离 AV 未返回可检索的独立名称；旧 breadth 尝试为 blocked，未计正向 |
| 61 | `av.get` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 62 | `av.query` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 63 | `av.create` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 64 | `av.add_rows` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 65 | `av.remove_rows` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 66 | `av.add_column` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 67 | `av.remove_column` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 68 | `av.set_cells` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 69 | `av.set_column_options` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 70 | `av.duplicate_rows` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 71 | `av.duplicate` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 72 | `av.add_view` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 73 | `av.update_view` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 74 | `av.set_new_item_templates` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 75 | `av.create_from_template` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 76 | `av.configure_two_way_relation` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 77 | `av.configure_rollup` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 78 | `av.set_relation` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 79 | `file.upload_asset` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 80 | `file.list_templates` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 81 | `file.read_template` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 82 | `file.create_template` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 83 | `file.update_template` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 84 | `file.delete_template` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 85 | `file.save_doc_as_template` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 86 | `file.render` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 87 | `file.export_md` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 88 | `file.export_markdown_snapshot` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 89 | `file.export_resources` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 90 | `file.list_unused_assets` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 91 | `file.get_doc_assets` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 92 | `file.audit_image_refs` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 93 | `file.read_image` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 94 | `file.get_image_ocr_text` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 95 | `file.remove_unused_assets` | blocked | success | false | Intentionally excluded: 全局未引用资源清理明确排除，避免误删用户资产 |
| 96 | `file.rename_asset` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 97 | `file.delete_asset` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 98 | `file.extract_doc` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 99 | `search.fulltext` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 100 | `search.semantic` | blocked | success | false | 语义索引未建立，旧脚本返回空/不可用，未计正向 |
| 101 | `search.query_sql` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 102 | `search.get_backlinks` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 103 | `search.search_refs` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 104 | `search.find_replace` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 105 | `search.search_assets` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 106 | `search.fulltext_asset_content` | blocked | success | false | 附件内容索引不存在，未计正向 |
| 107 | `search.list_invalid_refs` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 108 | `tag.list` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 109 | `tag.rename` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 110 | `tag.remove` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 111 | `timeline.list_nodes` | blocked | success | false | 数据仓库密钥未初始化，真实 API 返回 -1；非产品写入失败 |
| 112 | `timeline.create_node` | blocked | success | false | Intentionally excluded: 时间线写动作需数据仓库密钥；排除且未执行 |
| 113 | `timeline.compare_node` | not_run | success | false | Environment unavailable; not executed. |
| 114 | `timeline.delete_node` | blocked | success | false | Intentionally excluded: 时间线写动作需数据仓库密钥；排除且未执行 |
| 115 | `timeline.rollback_document` | blocked | success | false | Intentionally excluded: 快照回滚明确排除 |
| 116 | `timeline.rollback_block` | blocked | success | false | Intentionally excluded: 快照回滚明确排除 |
| 117 | `system.workspace_info` | blocked | success | false | 宿主动作开关禁用，返回 action_disabled；未改开关 |
| 118 | `system.network` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 119 | `system.conf` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 120 | `system.notify` | blocked | success | false | Intentionally excluded: 外部通知明确排除 |
| 121 | `system.changelog` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 122 | `system.perform_sync` | blocked | success | false | Intentionally excluded: 同步明确排除 |
| 123 | `system.get_version` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 124 | `system.get_current_time` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 125 | `flashcard.list_cards` | passed | success | true | Resumed isolated deck: list_cards returned real cardID 20261020110818-f0j7gh2 and unreviewedNewCardCount 1→0 after review; not a length-only check. |
| 126 | `flashcard.get_decks` | passed | success | true | Independent native/content readback; weak length-only checks excluded. |
| 127 | `flashcard.get_cards` | passed | success | true | Resumed isolated deck: get_cards returned total=1 before remove_card and total=0 after; no built-in deck and no existing user cards. |
| 128 | `flashcard.review_card` | failed | success | false | 隔离牌组复习返回 transactionState=no_change，但原生 getRiffDueCards 前后显示卡片已移出 due 队列、状态发生变化；详见 findings.json / supplement-retest/report.json flashcardReview |
| 129 | `flashcard.create_card` | passed | success | true | Isolated round-local deck; real cardID distinct from blockID; built-in deck untouched. |
| 130 | `flashcard.remove_card` | passed | success | true | Isolated round-local deck; real cardID distinct from blockID; built-in deck untouched. |
| 131 | `extension.list` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 132 | `extension.validate_package` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 133 | `extension.diagnose_plugin_mcp` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 134 | `mascot.get_balance` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 135 | `mascot.shop` | passed | help_only | false | Observed/contract-only or assertion was length/empty-shape/committed-state only; downgraded, not counted as positive functional coverage. |
| 136 | `mascot.buy` | blocked | success | false | Intentionally excluded: 真实购买明确排除 |
| 137 | `feedback.submit` | passed | expected_denial | false | Empty description rejected before any send; zero external send, recorded as denial only. |

## 复核入口

```bash
node scripts/acceptance-plan.mjs --report .sisyphus/acceptance/pi-broad-20261020-r3/functional-actions.json
node .sisyphus/acceptance/pi-broad-20261020-r3/scripts/audit-resumed-accounts.cjs
```

当前账目：positive **99/137**，denial 1，failed 1，blocked 13，not_run 2，weak 21。结论明确不是“全量通过”。
