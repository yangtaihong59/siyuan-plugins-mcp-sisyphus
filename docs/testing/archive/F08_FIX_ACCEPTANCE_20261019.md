# F08 载体识别修复与真实验收（2026-10-19）

本轮修复第三轮报告中的 F08：父文档包含子 AV 时，错误的载体识别与不稳定候选顺序使合法预检租约失效。修复后的构建产物通过 54 项真实回归，其中 10 轮省略 blockID 的修改全部 committed 并经原生读回确认。此次为针对已定位缺陷的确定性复测，没有重新运行 pi 五角色，不能替代完整人群验收。

## 修复

- `src/core/write-safety-coordinator.ts` 仅接受首个块元素自身的三项身份属性：data-node-id 等于请求块 ID、data-type 为 NodeAttributeView、data-av-id 等于目标数据库。三个属性须在同一元素且各出现一次，拒绝父文档、跨元素拼凑或重复身份属性。
- 显式与自动发现共用校验，候选按块 ID 排序；载体状态读回再次验证身份。没有放宽权限、目标范围、完整哈希或租约校验，没有增加失败后自动重试。
- 单元回归覆盖父文档首子块即 AV、包装子 AV、伪造属性文本、错误 AV、重复属性、双真实镜像及 SQL 顺序翻转、单引号/属性顺序、发现后身份变化。旧测试夹具补齐真实 DOM 必备的 data-node-id。
- U04 模板路径卡点补充中英文文档：保存后使用 `template.readArgs` 或含 `.md` 的 `template.relativePath`，不能直接把展示名称当读取路径。本轮未改变工具参数契约，也未声称文档改动已经通过新 pi 轨迹验证。
- U03 初次直接写入缺少预检仍会被正确拒绝；本轮未消除该学习成本。

## 实际验收

真实内核 3.8.7；已授权笔记本“测试用” `20260909184210-4s2cp7v`。前后原始权限、工具配置及 HTTP 设置摘要相同。通过临时 API 代理使用新 Node CJS 协调器，原始笔记数据均由真实思源 API 读写。

| 检查 | 结果 |
| --- | --- |
| 真实回归 | 54/54：SQL COUNT/box 保留、模板、文档/块、AV 筛选与视图、镜像、四级权限、严格重放与旧状态拒绝。 |
| F08 原生候选顺序 | 5/5 次省略 blockID 的预检→提交 committed；每次间隔1.5秒、原生 options 精确读回。 |
| F08 扰动候选顺序 | 5/5 次省略 blockID 的提交 committed。代理仅将真实候选先升序后降序，没有制造候选或改写 DOM；30份候选响应留证，包含真实父文档与真实载体。 |
| 错误显式父文档 | permission_denied，writeAttempted=false；事务计数未增加。 |
| 正确显式载体 | HTTP 预检→CLI 提交、原 requestId 重放成功；并非用显式参数替代隐式分支修复证据。 |
| 传输 | 新 HTTP/direct/stdio 发现；SQL 跨 HTTP/direct/stdio/CLI；AV 跨入口选定分支，未宣称每个 action 均经全部传输。 |
| 全套自动化 | 131 文件、1587 测试通过，含新增9项载体测试。 |
| 构建与生成检查 | pnpm build、build:cli、技能生成检查、API 映射检查、git diff --check 通过。最终三个产物摘要与实际验收相同。 |
| TypeScript | baseline24/current24，无新增诊断；仓库仍有既存24项诊断。 |

首次全套自动化在受限沙箱中因本地监听 EPERM 失败，并发现 API 映射生成结果漂移。更新映射后，在允许本地监听的环境重新执行全套得到上述绿色结果；首次日志保留，未删除测试或放宽断言。

证据：`.sisyphus/acceptance/f08-fix-20261019/` 中 `live.json`、`live.json.calls.jsonl`、`cleanup-live.json`、`final-tests-elevated.log`、`final-verification.json` 及构建/类型检查日志。

| 产物 | SHA-256 |
| --- | --- |
| `dist/mcp-server.cjs` | `bc7faad98de00cb844b2b353eb6fcfd67349843ec87bb9dd859aedadc88395d3` |
| `cli/dist/cli.cjs` | `7c4a3c3d9554b504da1ef768296117bc8935f8b45e79167c6f1ca6752e5e3c25` |
| `dist/kernel.js` | `fabcb432da288d234514bbd4337d839ed3644c039acfe914594e4781a0ed182e` |

## 全部 mutation 覆盖矩阵

当前策略共69个 mutation，逐项统计23 covered、40 not_run、6 intentionally excluded。covered 仅代表本轮执行过正向分支。共享协调器的其他 AV 高风险动作有自动化回归，但下列未执行的真实分支仍列为未覆盖。

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

排除项涉及全局未用资产、历史仓库和购买。通知、同步、反馈及第三方写入未测试。未覆盖远程/Docker、移动端、已安装内核宿主及所有参数组合。

## 清理与交付

本轮根夹具、AV载体与定义、两个模板、临时权限笔记本和影子权限/账本均已清理并用原生 API 核对。原笔记本数量仍为2，原配置摘要未变。仅保留验收摘要：

- 文档 `20261019203901-bdcas8x`
- 路径 `/测试用/AV-V2-20261019123754-验收报告`

插件版本仍为0.6.11、CLI为0.2.12。修复存在于当前源码和新构建；没有替换正在运行的36808插件或其 kernel.js，没有提交或发布。新构建的 Node 路径通过不等于已安装插件已经修好。
