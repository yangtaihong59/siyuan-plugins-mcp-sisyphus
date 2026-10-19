# AV v2 入口重构验收

验收时间：2026-10-08（Asia/Singapore）。本次仅修改与验收，未发布。

## 自动测试与构建

- `pnpm test`：125 个文件、1498 项测试通过。
- `pnpm build`、`pnpm build:cli`：通过，包含插件、MCP Server、内核入口与 CLI 构建。
- `pnpm skills:check`、`pnpm api:audit:check`、`git diff --check`：通过。
- `pnpm exec tsc --noEmit`：未通过。对当前 HEAD 的独立临时副本运行同一检查，基线 24 项诊断，修改后 23 项；按文件、错误码、诊断正文比较无新增诊断。剩余问题包括模板类型导出、部分既有异步函数签名、文档辅助函数和测试类型。

新增回归覆盖版本化配置迁移及保存重载、未知版本拒绝、万行数据库的结构响应规模、分页规范 ID、视图读取选择、参数边界、三种布局、组合保护范围、无变化请求及预检后状态变化。

创建故障注入覆盖 AV 请求响应丢失、AV 回读失败、承载块插入及回读失败、阶段账本保存失败、首次 ID 预留保存失败、进程中断上下文、已完成结果重放、参数冲突及过期请求。故障注入由自动测试完成，未在真实用户内核中制造网络/存储故障。

## 真实内核验收

- 内核：思源 `3.8.6`；使用现有“测试专用”笔记本中的本轮唯一前缀文档。
- 路径：新 `dist/mcp-server.cjs` 的临时 Node HTTP 协调器，通过临时 API 代理访问真实思源内核；代理只替换测试进程看到的协调器地址与账本路径。
- 新 HTTP、进程内 MCP、stdio 与 CLI 共同验证；HTTP 预检凭据由 CLI 提交并回读。
- 未替换正在运行的插件或已安装的 `kernel.js`，未持久化修改生产协调器配置。内核入口的分发与未知配置版本拒绝由自动测试覆盖，其构建产物成功生成。
- 本轮文档、承载块、行随夹具文档清理，独立测试账本移除。清理前核验文档 ID、所属笔记本和本轮路径前缀。AV 文件的内核垃圾回收不在本测试中主动执行。
- 可复用脚本：`tests/smoke/live-av-v2.cjs`；完整 JSON 证据由 `SIYUAN_TEST_REPORT` 指定，本轮保存于 `/tmp/av-v2-live-report.json`。

| 检查 | 结果 |
| --- | --- |
| fresh CJS discovery via HTTP/direct/stdio | 通过 |
| create isolated parent document | 通过 |
| create database, stable IDs and replay | 通过 |
| creation replay survives HTTP coordinator restart | 通过 |
| structure excludes rows and exposes actual view | 通过 |
| select test carrier view explicitly | 通过 |
| add select column | 通过 |
| add isolated detached rows | 通过 |
| query canonical row IDs and complete pagination | 通过 |
| primary-key paging and keyword via direct CJS | 通过 |
| set cell with query row ID | 通过 |
| combined update and HTTP-preflight/CLI-commit lease sharing | 通过 |
| read exact persisted configuration through stdio | 通过 |
| add gallery view | 通过 |
| combined gallery configuration | 通过 |
| add kanban view | 通过 |
| combined kanban configuration | 通过 |
| explicit read does not switch the selected carrier view | 通过 |
| mirror carriers keep independent selected views | 通过 |
| new request cannot recreate existing AV | 通过 |
| search points to get with real IDs | 通过 |
| cleanup isolated document | 通过 |

## 覆盖边界

本轮实际提交了 AV 创建、新增行、普通单元格、字段创建、视图创建和三种布局的组合视图配置；额外使用文档创建/清理、块追加和块属性操作建立镜像夹具。五类视图配置均在表格、画廊、看板上有实际回读。

其余 AV 模板、双向关系、汇总和删除入口保留原独立契约，执行自动回归，未重复开展真实写入验收。未运行思源快照、同步、外部插件写入、反馈或购买操作。报告不宣称跨步骤创建或原生 transaction 具有内核原子性。

## 验收产物摘要

整个真实验收期间摘要保持一致。

| 文件 | SHA-256 |
| --- | --- |
| `dist/mcp-server.cjs` | `2be56bfbf3e4747c6e6971138c9751638800a81a16fba1c31dafbef50a8a1f9e` |
| `cli/dist/cli.cjs` | `e36849a34032f8fe41e6d283c0adf44ef0b0e6dde06442923c591cc6771bc756` |
| `dist/kernel.js` | `548314f4dd2d9c679e382478c5c202fe8c3f8c71015621cc5ec11403fd3ac638` |
