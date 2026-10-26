# pi 标准档真实验收与卡点（2026-10-19）

本轮已执行真实思源测试，正向覆盖 **12/14 类工具、109/137 个静态 action（79.6%）**。发现 **5 个可复现的功能问题**，其中 4 个 P1、1 个 P2；不能放行成“全部通过”。四个独立 pi 角色中 3 项完整完成、科研角色部分完成，产物均由主控制器从真实内核独立读回。

**清理状态：已完成。** 实例曾在测试后退出；用户重开同一工作区后，按两个原笔记本 ID 重新发现 API 为 `http://127.0.0.1:62935`，没有重跑问题写入。已逐 ID 核对并清理 18 个文档条目、6 个无承载块的本轮 AV 定义、模板/资产及 8 个临时状态文件；已移除新建闪卡。原权限摘要和清理前后的工具配置摘要相同。两个原笔记本保留，只留下最终标准验收报告 `20261019185225-dy9eha9`（`/测试用/STD-PI-20261019102632-标准验收报告`）。完整证据见本轮 cleanup.json。清理用原生 HTTP API 操作精确夹具，不计入功能成功覆盖。

## 环境与证据口径

- 仓库 HEAD：`73d22c5f797e9f7313591bd1514c0e40ab31056f`；插件构建 0.6.11，CLI 0.2.12；测试时真实思源内核 **3.8.6**。
- 用户指定 MCP：`http://127.0.0.1:36808/mcp`；本轮重新发现真实 API 为 `http://127.0.0.1:49351`；笔记本“测试用” `20260909184210-4s2cp7v`，rwd。端口是本次观察值，不可固化为后续默认值。
- 模型：本机 pi，`deepseek/deepseek-flash`。本机模型别名不能证明厂商精确版本为“4.1”。
- 受限 pi 会话关闭 bash/read/write、其他 MCP、技能、项目上下文；仅通过自建网关访问本轮合成夹具。未向模型提供已有私人笔记、配置或凭据。
- 主功能矩阵用本轮构建的 CJS 临时协调器，经 API 代理访问**同一真实思源工作区**；权限/账本使用独立工作区文件，没有替换现有插件或重写原权限。
- 36808 当前加载的 CJS SHA 与新构建不同。主矩阵不能证明旧端点已经部署新产物；另对 36808 实测 COUNT 和显式 box 列成功。
- 原始失败保留。临时驱动参数/断言修正另存，未改产品源码、原测试断言、版本或提交发布。

| 产物 | SHA-256 |
| --- | --- |
| dist/mcp-server.cjs | `3a2b55100dc77a26ad41bb3a54fc54191e499fcd25a5fccad751ff7b543c304d` |
| cli/dist/cli.cjs | `3528ba60508c60ec6ecc39c78a12dd8e7a4d5fb099d9c5be711952888d1ceabb` |
| dist/kernel.js | `39d301b080d1a7ef643534892ba5efb3ae0e316fb8695943777f1621dccaba28` |
| 36808 已安装 mcp-server.cjs | `4d2f9db8050cd6f6da5ff1e68cfb42eaf1004876f637be2596aa228ac1784bab` |

## 已确认的功能问题

| 编号 | 级别 | 最短触发与实际结果 | 可用绕法 |
| --- | --- | --- | --- |
| F01 | P1 | A/B 有相同 notebook-local hpath，A=r、B=rwd；在 B 创建后报 readback_mismatch，cause 指向 A。B 的文档实际已经存在且仅一份。两次复现。 | 用跨本唯一 hpath；遇 unknown 先按 B+路径/ID只读核对，不换 ID 重试。 |
| F02 | P1 | create_template 后预检并删除；文件已消失，但404读回被当错误，返回 readback_mismatch/unknown。两次复现。 | 精确核对目标不存在后停止，不自动重删/重建。 |
| F03 | P1 | save_doc_as_template 保存到不存在的新名字，validateOnly 就因404失败、没有尝试写入。两次复现。 | 先 create_template，再 save_doc_as_template(overwrite=true)，已实测。 |
| F04 | P1 | ensure_link_targets(mode=resolve) 对合法已有子目标返回 `{"success":true,"changed":false,"created":[]}`，linkMap/resolved/计数丢失。两次复现。 | 逐个 document.lookup(id)，自行保留 key 到 ID 的映射；空 created 不代表目标不存在。 |
| F05 | P2 | get_backlinks 仅传 id，报 refTreeID 必填；补它后又报 keyword 必填，和公开可选参数不一致。 | 显式 keyword="" 与 refTreeID；本轮已查到预期引用。 |

F01 的状态探针按 hpath 查询时没有 box 限定，混入另一笔记本的同路径块，再被写权限检查拒绝。应按返回的新 docID/目标 notebook 读回，避免影响不相关笔记本。

F02/F03 同源：客户端资源读取层提前抛出 HTTP404，使模板层来不及转换为 template_not_found；删除的合法 missing 后像、新建模板的合法 missing 前像均被错误处理。应统一资源404语义，并分别回归创建/覆盖/删除。

F04 来自通用 success 响应白名单精简。应保留该 action 的 linkMap、resolved/reused/unresolved、scope 和计数，覆盖 resolve/reuse/dryRun 与真实创建分支。具体调用参数、requestId、原始响应及读回序号均在 `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/findings.json` 和它引用的 JSONL 中。

## 使用卡点与测试设施问题

- **移动后旧路径的短暂命中（U01，观察一次）**：pi 整理任务移动后立即 fs.read(旧路径)，返回新 canonical path 的正文。稍后及固定复测均返回未找到。可能是 hpath/SQL 索引滞后，未证实缓存原因，不列为已稳定复现的故障。校验移动时比较响应路径，并用精确 ID/lookup 复核。
- **首次严格写入的理解成本（U02）**：4 个角色第一次都漏 requestId；前三个会话遗漏初始化 instructions，不能归责产品。数据库会话传入公开 instructions 后仍漏一次，随后恢复，并用了 5 次 help。需要完整协议的更多新会话复测，不能由一轮推出所有用户都有问题。
- **SQL schema 文案陈旧（D01）**：query_sql 的 stmt 描述仍说 returned rows are permission-filtered；本轮真实行为是全本可读直返，受限时执行前拒绝。应统一 schema/help/参考文档。
- **首版网关存在误拦截（H01）**：合法 parentPath+title、lookup(id)、list_tree 等被网关挡住。startsWith 异常、scope 拒绝属于测试设施，不能算产品故障。v2 修正部分拦截并加入 unknown 后写入冻结；数据库会话未再遭 scope 拒绝。
- **首版安全恢复不合格（H01）**：整理角色在 mv 返回 unknown 后新建父目录并换 requestId 重试。最终文档已独立核对，但这不能证明恢复过程安全。首版角色卡与网关未机械阻止该行为，今后自动运行前必须补齐冻结规则。
- **临时驱动的初始误判（H02）**：changelog 应读插件而非内核；search_docs 参数名、snapshot 的 page.hasNext、flashcard 必填 filter/原生占位对象、read_image 的 path 参数和资产 HTTP202+非零code 曾被脚本误解。find_replace 的原段落已经替换，剩余旧字样来自独立复制的 AV 行。首轮日志均保留，这些不算产品问题。

## pi 角色结果

“调用跨度”从本轮第一条到最后一条工具轨迹计算，包含模型在两次调用间的等待；不含首调用前的启动和末调用后的答复。完整墙钟、token 及人工用户体验未观测，不作性能承诺。

| 角色 | 任务结果 | 工具总调用 | help | 服务端错误 | 网关拒绝 | 调用跨度 |
| --- | --- | --- | --- | --- | --- | --- |
| newcomer | 产物完成 | 9 | 0 | 1 | 1 | 10.86 s |
| organizer | 产物完成 | 22 | 0 | 3 | 4 | 23.51 s |
| researcher | 部分完成 | 12 | 0 | 1 | 3 | 12.51 s |
| database | 产物完成 | 21 | 5 | 1 | 0 | 24.23 s |

新手记录保留了中文、emoji 与两项待办；整理任务精确替换、归档改名后的正文正确；科研记录保留公式/代码/反斜线并检索出两段结果，但角色 SQL 分支被网关限制，仅由固定脚本另验；数据库三行状态和“只剩说明整理未完成”均从独立连接读回。角色是 AI 模拟，前三个会话是存在适配器缺陷的 assisted 体验，不是完整客户端盲测或真人可用性研究。

## 功能覆盖与验证

COUNT/SUM/GROUP BY/JOIN/CTE、空匹配 COUNT=n0、显式 box 都与真实内核查询结果一致。新 CJS 的 HTTP/direct/stdio 与 CLI 主线已有实际调用；36808 已安装端点另验 COUNT 与 box。纯新增预检签发 requestId 没有被当成写权限。

权限复核使用四个不同唯一 hpath 的临时笔记本，rwd/rw/r/none 读写删除边界通过；r/none 实际提交 append 被拒绝，代理计数证明零内核 append，正文不变；受限 SQL 的内核 SQL 请求计数不变；恢复全部可读后聚合返回。该复核隔离了 F01，不是关闭权限来获得通过。

AV v2 的基础 CRUD/视图、持久化重放、旧状态拒绝、镜像视图独立性，以及本轮补测的复制行/库、模板建行、双向关联、关联赋值、汇总均有真实证据。附件完成小图上传 SHA、读取图片、ZIP/提取目录中图片字节 SHA 一致；闪卡完成新建/获取/复习状态变化/移除。空 OCR 返回被核对，但未验证 OCR 识别能力。

| 工具 | 有正向证据 / 静态 action | 说明 |
| --- | --- | --- |
| fs | 8/9 | 逐分支结果见 functional-actions.json |
| notebook | 11/11 | 逐分支结果见 functional-actions.json |
| document | 14/18 | 逐分支结果见 functional-actions.json |
| block | 18/21 | 逐分支结果见 functional-actions.json |
| av | 19/19 | 逐分支结果见 functional-actions.json |
| file | 17/20 | 逐分支结果见 functional-actions.json |
| search | 5/9 | 逐分支结果见 functional-actions.json |
| tag | 3/3 | 逐分支结果见 functional-actions.json |
| timeline | 0/6 | 时间线缺数据仓库密钥 |
| system | 3/8 | 逐分支结果见 functional-actions.json |
| flashcard | 6/6 | 逐分支结果见 functional-actions.json |
| extension | 3/3 | 逐分支结果见 functional-actions.json |
| mascot | 2/3 | 逐分支结果见 functional-actions.json |
| feedback | 0/1 | 未发送外部反馈 |

统计以 137 个全部静态 action 为分母，未通过移出禁用/危险项提高比例。help、schema、拒绝、mock、已规划场景均不计正向。109 个 action 通过不代表其所有参数、权限、分页及协议分支都通过；同一 action 可以同时有已通过分支和已失败分支。

**28 个没有正向证据的 action：** `fs.reorder`, `document.ensure_link_targets`, `document.reorder`, `document.heading_to_doc`, `document.doc_to_heading`, `block.transfer_references`, `block.recent_updated`, `block.add_to_daily_note`, `file.delete_template`, `file.list_unused_assets`, `file.remove_unused_assets`, `search.semantic`, `search.search_assets`, `search.fulltext_asset_content`, `search.list_invalid_refs`, `timeline.list_nodes`, `timeline.create_node`, `timeline.compare_node`, `timeline.delete_node`, `timeline.rollback_document`, `timeline.rollback_block`, `system.workspace_info`, `system.network`, `system.conf`, `system.notify`, `system.perform_sync`, `mascot.buy`, `feedback.submit`。

时间线只读查询被未初始化的数据仓库密钥阻塞，没有初始化密钥或创建快照。新图片的文件名搜索为空，未证明可用资产索引前提，列 blocked；语义模型/附件正文索引、完整 OCR、Apps 实际渲染、Windows/Linux/Docker、其它模型/客户端、现代协议真实宿主、故障恢复的全部租约边界都没有在本轮补齐。快照/回滚/同步/通知/反馈/购买/第三方写入和全局未引用资源清理没有执行。动态 extension 仅查发现/包校验/诊断，没有调用下游写工具。

自动化测试首次在沙箱因回环监听 EPERM 导致 17 项失败；放开本地监听后，同一套 **126 个文件、1503 项全部通过**。技能生成检查和 git diff --check 通过。自动化绿色不覆盖本轮真实发现的 5 个故障。最终 pnpm build、技能生成检查和 git diff --check 通过；server/CLI/kernel SHA 与测试时相同。

## 收尾与证据

已清理的主要根夹具：`20261019182641-g8ks1gb`（`/STD-PI-20261019102632`）、`20261019183154-dfm7btb`（`/STD-PI-20261019103146`）。清理没有按模糊前缀批量删除历史数据。恢复实例后已按笔记本 ID/名字核对身份，完成精确夹具清理；没有重新执行未知写入。删除文档后的 SQL 索引曾短暂残留，控制器仅对只读检查做有界等待，确认零承载块后才清理 AV 元数据。

本轮没有修改产品、提交 Git、替换运行插件或发布包。已有的测试计划修改、无关重复副本文件保留。

本地原始证据目录：`/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi`。

- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/run.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/artifacts.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/inventory.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/functional-actions.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/coverage-summary.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/findings.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/persona-results.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/ux-independent-proof.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/permissions.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/export-integrity.json`
- `/Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/.sisyphus/acceptance/standard-20261019-102423-pi/cleanup.json`
