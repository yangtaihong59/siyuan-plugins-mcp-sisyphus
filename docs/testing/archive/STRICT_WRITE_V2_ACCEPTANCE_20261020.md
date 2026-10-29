# Strict Write v2 实施与验收记录（2026-10-20）

状态：实现与本轮限定场景验收完成；未发布，不代表全部 action 均已实测。

## 实施范围

设计见 [strict-write-v2-design.md](../../architecture/strict-write-v2-design.md)。按用户要求委托 pi 的 `deepseek/deepseek-flash` 实施；模型目录没有独立的“4.1”标识，因此不据此声称具体后端版本。主代理负责源码复核、真实内核验收和清理核对。

- mutation 统一返回 `preflight.commitArgs`，保留现有 10 分钟租约，提交重新核对权限与状态。
- `av.query` 返回单份 `rows`，支持按 columnID 的 `fields` 投影和内核 `formattedContent`。
- `av.add_rows.rows` 支持 detached 行的初始单元格，稳定 rowID、阶段账本、未知结果不自动重试；首期拒绝 relation 等跨 AV 初始写入。
- `document.rename.items` 支持最多 50 项，整批预检、逐项回执、首个失败停止；不自动回滚。
- `remove_rows.rowIDs` 为规范入口；help 与双语文档同步。

未修改版本号、未提交、未发布。插件仍为 0.6.13，CLI 仍为 0.2.13。

## 自动化与复核

pi 回归及主代理真实验收后的最终回归均为 134 个测试文件、1634 项测试通过；插件和 CLI 构建、skills 检查、diff 空白检查通过。pi 的 API 映射检查通过。最终重构建产物 SHA 与真实验收锁定产物一致。增量类型检查：基线 24 项、当前 24 项，新增诊断为 0；不声称全仓库 TypeScript 零错误。

主代理复核中修正：嵌套日期显示值、空 cells 行保留、最早租约截止、部分批次回执防裁剪、初始 relation 限制。真实测试进一步发现并交 pi 修复：

1. `fields` 未接入运行时严格 schema，实际被拒绝。补完整 schema、handler 投影、help 与回归。
2. 批量改名错误依赖 `getBlockInfo.id/type`；真实内核没有这些字段。改用 rootID、box 和存储路径验证文档身份，mock 改为真实形状。
3. 冲突检测按 notebook + hpath 隔离，避免不同笔记本同名路径误拒绝。

## 真实执行证据与边界

使用新构建 dist CJS 和 CLI，通过临时 Node HTTP 协调器连接真实思源 3.8.7。“测试用”笔记本 ID 为 `20260909184210-4s2cp7v`。生产配置不修改，权限与账本采用本轮独立影子文件。未替换已安装插件，故不是已安装 kernel.js 路由验收。

第一轮（修复 fields 前）44 项检查通过、1 项失败。四个带初始日期的 detached 行已写入并返回 verified，但后续 fields 查询被拒绝；18 文档批量改名未到达。覆盖矩阵 69 个 mutation 中 20 covered、43 not_run、6 intentionally excluded；这是旧一轮范围统计，不是修复后全量实测结论。文档、模板、AV 定义、影子文件均已独立核对清理。

修复后第二轮：14 项检查通过；数据库创建后的协调器重启重放检查因思源内核退出而收到代理 502，后续场景未执行。之后进程检查已无内核。不能将此轮认定为产品验收通过，也没有证据将内核退出归因于本次代码。

原始证据保存在仓库忽略目录 `.sisyphus/strict-v2/`：pi 会话、复核记录、构建日志、真实 callTool 记录及逐项结果。第一轮为 `live/live.json`，修复后中断轮为 `live-final2/live.json`。

## 最终验收（恢复实例后）

最终 `live-final4/live.json`：57 / 57 检查通过，无失败。`live-final4/live.json.cleanup.json` 独立确认夹具已清理。中断轮遗留也已清理，证据为 `live-final2/interrupted-cleanup.json`；`live-final3` 的清理索引延迟误判已改用块存在性核对，并独立验证无残留。

- 四条带初始日期的 detached 行：一次预检、一次复制 commitArgs 提交成功；日期时间戳与内核格式化文本一致。
- fields 投影保留 rowID，只返回指定列；7 行、2 列的实际响应 3054 个紧凑 JSON 字符，无 data/view/table/resolvedRows 重复内容。
- 18 个文档批量改名：一次预检、一次提交，逐项核对内核 hpath、稳定 ID；原 requestId 重放后原生改名请求数仍为 18。
- rowIDs 删除纯文本行成功，原生 AV 与查询均核对目标行消失。
- rwd/rw/r/none 临时笔记本验证读写删边界；无权限写入/删除未到达相应内核写接口。
- HTTP/direct/stdio 发现和读取、HTTP 预检到 CLI 提交、协调器重启后的持久回执、陈旧状态拒绝均通过。
- 原笔记本权限未变；临时文档、18 个批量文档、模板、AV 定义、影子文件、四个临时权限笔记本已清理；最终回到原有两个笔记本。

保留报告：`/测试用/AV-V2-20261019192803-验收报告`，文档 ID `20261020032915-p7voa4t`。

测试路由仍为本轮新构建 Node CJS 协调器，未安装替换生产插件。新功能跨入口一致性主要由共享路径自动化测试保障；本轮复合 add_rows 与批量 rename 的实际提交入口为 HTTP，不能声称三入口逐项全部实测。

## 产物与覆盖矩阵

- `dist/mcp-server.cjs` SHA-256：`99f1a04c55f9f40e2b8b1dd600440a938f91a49be5b53460b7ecaee9a537ac7f`
- `cli/dist/cli.cjs` SHA-256：`ab0f74daa4b9f2aef72a9ea8798df505c9f116c500c264da662383c6b97bb807`
- `dist/kernel.js` SHA-256：`5d85c7abe66a539bf426bb228b40f503557097ab5c650a95fcc8a2355af344a0`

全部 69 个 mutation 纳入账目：25 covered、38 not_run、6 intentionally excluded。查询等只读检查不计入 mutation 数。未执行项不能以共享路径测试替代真实执行。

| action | 本轮真实状态 |
| --- | --- |
| `fs.write` | covered |
| `fs.replace` | covered |
| `fs.rm` | covered |
| `fs.mv` | covered |
| `fs.reorder` | not_run |
| `notebook.create` | covered |
| `notebook.set_open_state` | not_run |
| `notebook.remove` | covered |
| `notebook.rename` | not_run |
| `notebook.set_conf` | not_run |
| `notebook.set_icon` | not_run |
| `notebook.set_permission` | covered |
| `document.create` | covered |
| `document.ensure_link_targets` | covered |
| `document.create_daily_note` | not_run |
| `document.duplicate` | not_run |
| `document.rename` | covered |
| `document.remove` | covered |
| `document.move` | not_run |
| `document.reorder` | not_run |
| `document.set_attr` | not_run |
| `document.heading_to_doc` | not_run |
| `document.doc_to_heading` | not_run |
| `block.insert` | not_run |
| `block.prepend` | not_run |
| `block.append` | covered |
| `block.add_to_daily_note` | not_run |
| `block.update` | covered |
| `block.replace` | not_run |
| `block.delete` | not_run |
| `block.move` | not_run |
| `block.set_fold_state` | not_run |
| `block.transfer_references` | not_run |
| `block.set_attrs` | covered |
| `av.create` | covered |
| `av.add_rows` | covered |
| `av.remove_rows` | covered |
| `av.add_column` | covered |
| `av.remove_column` | not_run |
| `av.set_cells` | covered |
| `av.set_column_options` | covered |
| `av.duplicate_rows` | not_run |
| `av.duplicate` | not_run |
| `av.add_view` | covered |
| `av.update_view` | covered |
| `av.set_new_item_templates` | not_run |
| `av.create_from_template` | not_run |
| `av.configure_two_way_relation` | not_run |
| `av.configure_rollup` | not_run |
| `av.set_relation` | not_run |
| `file.upload_asset` | not_run |
| `file.create_template` | covered |
| `file.update_template` | not_run |
| `file.delete_template` | covered |
| `file.save_doc_as_template` | covered |
| `file.remove_unused_assets` | intentionally excluded |
| `file.rename_asset` | not_run |
| `file.delete_asset` | not_run |
| `search.find_replace` | not_run |
| `tag.rename` | not_run |
| `tag.remove` | not_run |
| `timeline.create_node` | intentionally excluded |
| `timeline.delete_node` | intentionally excluded |
| `timeline.rollback_document` | intentionally excluded |
| `timeline.rollback_block` | intentionally excluded |
| `flashcard.review_card` | not_run |
| `flashcard.create_card` | not_run |
| `flashcard.remove_card` | not_run |
| `mascot.buy` | intentionally excluded |

原始回执、参数和本轮夹具清单位于上述忽略目录；未输出凭据。尚未实测的逐项失败/超时注入、时钟边界与碰撞主要由 mock 测试覆盖，不将其称作真实故障验收。
