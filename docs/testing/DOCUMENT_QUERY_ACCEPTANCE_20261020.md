# document.query 权限感知查询验收（2026-10-20）

新增只读 `document(action="query")`，在存在 `none` 笔记本时，仍可分页查询可读且打开的笔记本中的文档、索引正文块数、字符数和同名候选。原始 `query_sql` 保留全部笔记本可读的前提；全文搜索的 `method=2` / `methodName="sql"` 现在使用同一检查。

## 调用与口径

```json
{"action":"query","pageSize":50}
```

```json
{"action":"query","maxBlocks":0,"fields":["id","notebook","title","hpath","blockCount","contentChars"]}
```

```json
{"action":"query","duplicatesOnly":true,"sortBy":"sameTitleCount"}
```

- SQL 的每个数据源先限定可读 `box`，随后聚合；不接受用户 SQL 片段。
- `blockCount` 统计非文档索引行，包含容器块；`contentChars` 是这些行的 SQLite `length(content)` 之和，并非原生字数、字节数或去重后的可见字符数。
- `sameTitleCount` 在笔记本、标题和 hpath 范围内统计，再应用块数/字符数条件。同名仅是候选。
- 关闭笔记本默认排除并列入 `scope.excludedClosedNotebooks`；显式指定不可读、未知或关闭笔记本会拒绝。
- 查询后重新校验权限；若作用域中发生撤权，整批拒绝。SQL 索引可能延迟；总数与数据页、跨页读取不构成冻结快照。

完整参数见 [document 工具](../zh/reference/tools/document.md)。

## 已完成验证

| 验证层 | 结果 | 范围 |
|---|---|---|
| 全仓自动化测试 | 138 文件，1733 / 1733 通过 | `pnpm test`，包含 43 项 document.query、22 项 SQL 入口保护回归 |
| 真实内存 SQLite | 27 / 27，通过 55 条生成 SQL | 直接加载真实源码 handler，由 SQLite 执行 SQL，未预造 SQL 结果 |
| 构建后 MCP stdio | 7 / 7 | 开发版 `dev/mcp-server.cjs`，通过 SDK 连接合成 HTTP 内核 |
| 构建后 CLI | 7 / 7 | `cli/dist/cli.cjs`，隔离 HOME，连接同一合成内核 |
| 工具契约与生成物 | 通过 | API audit、帮助快照、kernel schema、skills、i18n、验收计划与原有上下文大小预算 |
| 开发构建与 CLI 构建 | 通过 | renderer；App bundle 就绪后 server/kernel watch 构建；`pnpm build:cli` |
| TypeScript 检查 | 原有 24 项诊断，新增 0 | 修改前后去除行号后诊断完全一致，不能称 typecheck 全绿 |

SQLite 场景包含：空文档为 0、Unicode 字符、三篇同名经块数筛选后仅一篇但频次仍为 3、不可读/关闭笔记本不参与计数、路径 `/A` 不误匹配 `/AB`、emoji 路径、引号与 `%/_` 字面匹配、稳定排序与分页、字段投影、撤权拒绝，以及修改不可读数据后可读结果不变。

构建后两条路径共执行 20 条 SQL。`query_sql`、`fulltext(method=2)` 和 `fulltext(methodName="sql")` 在不可读笔记本存在时均拒绝；每次拒绝期间合成内核的 SQL/fulltext 请求增量均为 0。

## 证据与限制

本机原始证据位于仓库忽略目录 `.sisyphus/query-acceptance/`：

- `sqlite-acceptance.mjs`、`sqlite-report.json`：源码与真实 SQLite 验收。
- `built-smoke.mjs`、`built-smoke-report.json`：构建产物与传输验收，记录逐项结果、执行前后 hash 和进程清理。

上述均使用合成笔记本和内存 SQLite，不代表真实思源内核或用户笔记的现场验收；未运行 pi。验收计划检查结果为 14 工具、138 action、59 场景，`actualExecuted=0`。

初次沙箱测试受本机回环监听 `EPERM` 影响；授权合成回环服务后全量测试通过。合成 HTTP 服务、MCP/CLI 子进程、临时 HOME 与本轮新增构建 watcher 均已清理，保留用户原有 watcher。

锁定的 SHA-256：

| 产物 | SHA-256 |
|---|---|
| `dev/mcp-server.cjs` | `4be707f782b290ec30babcb42f0d712c4ce8d3ba4fe3ef2c301d55c46456c6b0` |
| `dev/kernel.js` | `6f59e6956cabc2fdbddd40150787c9b5b54e05a6bedb7ca781dea95795afee9f` |
| `cli/dist/cli.cjs` | `f057a079a00218939e397849ed26778a05de49720687e9f1fb78176079977e82` |

版本号未调整；本轮未提交、打 tag 或发布。
