# v0.6.11 / CLI v0.2.12 真实验收

日期：2026-10-19（Asia/Singapore）。

## 执行环境与边界

- 用户指定的 MCP：`http://127.0.0.1:36808/mcp`；核对得到同一测试工作区的思源内核为 `3.8.6`。
- 用户指定笔记本：“测试用”（`20260909184210-4s2cp7v`），权限 `rwd`，严格写入开启。
- 使用本轮新构建的 `dist/mcp-server.cjs` 和 `cli/dist/cli.cjs`，通过临时 API 代理与 Node HTTP 协调器访问真实内核；只重定向本轮账本与协调器设置读取，不替换正在运行的插件。
- 测试未使用 mock 笔记数据。全部文档／块／AV 操作实际到达真实思源内核，删除前重新核对 ID、所属笔记本和唯一前缀。

## 核心实际检查

34 项检查通过，包含 27 次有严格回执的修改调用，覆盖以下能力：

| 能力 | 真实检查 |
| --- | --- |
| Markdown 与文档 | 创建、覆盖、替换、读取、列目录、树、范围搜索、移动、删除及幂等重放 |
| 块修改 | 追加、更新、属性修改、读回、重放；预检后发生属性变化时拒绝旧提交 |
| 搜索与 SQL | 文档全文搜索；HTTP、进程内 MCP、stdio、CLI 下 COUNT 聚合返回结果；所选 `box` 列保留 |
| AV v2 读取 | 默认结构不返回全量行；columns/raw/view 范围；分页行查询与主键查询；规范 rowID |
| AV 创建 | 稳定 ID、回执重放、协调器重启后的持久化重放、新请求不能重建已有 AV |
| AV 修改 | 字段、行、单元格写入；HTTP 预检／CLI 提交；stdio 读取真实持久化配置 |
| 视图与保护 | 表格、画廊、看板组合更新；无变化返回 no_change；旧单元格／视图状态提交被拒绝；显式读视图不切换承载块，镜像承载块保持各自选择 |
| 清理 | 本轮根文档及其子文档、块和 AV 承载块已清理；AV 文件的内核垃圾回收未主动执行 |

实际执行的 mutation action：

`fs.write`, `fs.replace`, `fs.rm`, `fs.mv`, `document.create`, `document.remove`, `block.append`, `block.update`, `block.set_attrs`, `av.create`, `av.add_rows`, `av.add_column`, `av.set_cells`, `av.add_view`, `av.update_view`

核心 JSON 证据：`/private/tmp/sisyphus-0611-real-core-34.json`。该文件包含产物摘要、检查、修改回执摘要、夹具清单和完整 mutation 覆盖／排除矩阵。

保留在笔记本中的核心报告：`/测试用/AV-V2-20261019091009-验收报告`（文档 ID `20261019171038-19k0k1v`）。

## 四级权限补充

按用户要求，使用本机 `pi` 的 `deepseek/deepseek-flash` 完成权限专项，8 项检查通过。主代理再次只读核对清理与原权限文件状态。

| 权限 | 读取 | 写入 | 删除 |
| --- | --- | --- | --- |
| rwd | 允许 | 允许 | 允许 |
| rw | 允许 | 允许 | 拒绝 |
| r | 允许 | 拒绝 | 拒绝 |
| none | 拒绝 | 拒绝 | 拒绝 |

- 每级使用实际新建的临时笔记本与真实文档。权限经当前 CJS 的 `notebook.set_permission` 写入单独持久化的 API 权限文件；临时代理重定向权限文件路径，工作区原权限文件没有被改写，摘要核对一致。
- 对 r/none 的纯新增写入，先取得服务端预检 requestId，再使用同一 requestId 实际提交，核对 permission_denied、内核 appendBlock 请求数为 0、真实 Markdown 正文前后相同。预检签发 requestId 本身不代表有写权限。
- 被拒绝的删除没有发送内核 removeDoc 请求，原夹具文档仍存在。
- 有 none 笔记本时，query_sql 返回 raw_sql_unavailable_with_restricted_notebooks；SQL API 请求计数在调用前后均为 15，证明没有执行 SQL。
- 将该临时本改为 r 后，所有笔记本可读；对真实夹具 root_id 的 COUNT 返回 n=2。因索引可见性采用有界只读重试，不重试写入。
- 四个临时笔记本全部删除；主代理再次读取 lsNotebooks 与插件存储目录，确认无本轮笔记本、隔离权限文件或账本残留。CLI 临时配置已删除。
- 权限 JSON 证据：`/private/tmp/sisyphus-0611-permissions-acceptance.json`；pi 执行总结：`/private/tmp/sisyphus-pi-permissions-result.md`。
- 权限验收报告保留在 `/测试用/AV-V2-20261019091757-验收报告`（文档 ID `20261019171816-yd2hpyc`）。

中间失败均为验收脚本对 lookup 参数／返回字段、拒绝响应字段及 SQL 索引可见性的假设不准确；修正脚本后重跑成功，没有通过放宽产品权限或关闭严格写入取得通过结果。所有失败轮次的隔离夹具也已清理。

## 自动化与构建

- 125 个测试文件、1498 项测试通过。第二轮曾因沙箱禁止监听本机端口失败，在允许临时端口的环境重跑后全绿。
- 插件、MCP Server、内核入口、CLI 及 VitePress 文档构建通过；API 审计与 Skills 一致性检查通过。
- 新 CJS 通过进程内 MCP、stdio、现代 HTTP 与 CLI 的模拟内核产物契约检查；这些模拟检查不替代上面的真实验收。
- TypeScript 检查仍未全绿：独立 HEAD 基线为 24 项诊断，当前为 23 项，按文件／错误码／正文比较无新增诊断。

## 覆盖限制

- 本轮真实验收没有替换或重载已安装的 `kernel.js`；内核托管端点的调度与分发由自动测试覆盖，新 kernel 产物完成构建，未宣称该托管入口通过本轮真实宿主验收。
- 未执行快照／时间线回滚、同步、通知、反馈、第三方 extension 写入和购买。
- AV 模板、双向关系、汇总等未在本轮逐项重做真实写入；完整矩阵将其标记为未覆盖，不能据此宣称全部 action 实测通过。

## 本轮待发布产物

| 文件 | SHA-256 | 本轮真实范围 |
| --- | --- | --- |
| `dist/mcp-server.cjs` | `3a2b55100dc77a26ad41bb3a54fc54191e499fcd25a5fccad751ff7b543c304d` | 新 CJS 的真实工作区验收 |
| `cli/dist/cli.cjs` | `3528ba60508c60ec6ecc39c78a12dd8e7a4d5fb099d9c5be711952888d1ceabb` | 新 CJS 的真实工作区验收 |
| `dist/kernel.js` | `39d301b080d1a7ef643534892ba5efb3ae0e316fb8695943777f1621dccaba28` | 构建与自动测试，未替换真实宿主 |
