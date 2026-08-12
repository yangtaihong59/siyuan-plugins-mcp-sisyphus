---
name: siyuan-built-cjs-live-test
description: 使用仓库刚构建的 dist/mcp-server.cjs 与 cli/dist/cli.cjs，在真实思源实例的隔离测试笔记本中执行端到端验收。用于验证工具或 action 修改、严格安全写入、短哈希预检租约、幂等重放、状态变化拒绝、HTTP/stdio/CLI 一致性，以及用户要求“实际测试”“真实笔记本测试”“全部 action 测试”或“不要只跑 mock”时。
---

# 使用构建产物进行真实思源验收

直接测试本轮构建出的 CJS，不用 TypeScript 源码、测试替身或陈旧的已安装产物代替。所有写入限定在用户明确指定的测试笔记本和本轮创建的隔离夹具中。

开始前读取 [references/action-coverage.md](references/action-coverage.md)。涉及严格写入时，同时读取仓库的 `docs/zh/reference/write-safety.md` 与 `src/core/write-safety-policy.ts`；后者是当前 action 分类的唯一真相源。

## 安全边界

- 不输出思源 Token、MCP Bearer Token、完整请求头、配置文件正文或无关笔记内容。
- 只修改测试笔记本内带本轮唯一前缀的文档、块、数据库、标签、模板和资源。
- 删除、移动、权限变更前重新解析目标 ID，并证明它属于本轮夹具；禁止用模糊路径、全局搜索结果或未解析变量做破坏性操作。
- 不调用 `/api/repo/*`，不为严格写入创建仓库快照。默认不实测会创建或回滚快照的 timeline action。
- 默认不执行同步、通知、反馈、第三方 extension 写入或 `mascot.buy` 等外部副作用。只有用户单独授权且后果可接受时才执行，并将其标为“外部副作用测试”，不要宣称具备严格状态校验。
- 保留用户原有数据和代码改动。测试夹具清理失败时停止扩大清理范围，报告精确 ID 和路径。

## 1. 建立本轮范围

先查看 `git diff --name-only`、`git status --short` 和相关测试，列出本轮实际改动影响的工具、action、公共协调器与传输入口。

若改动触及以下任一公共文件，将 `src/core/write-safety-policy.ts` 中全部 `mode: 'mutation'` action 纳入覆盖矩阵，而不是只测改动时顺手使用的一个 action：

- `write-safety-*`
- `write-preflight-lease.ts`
- `tool-registry.ts` 或 `server.ts` 的写入路由
- `cli/write-coordinator.ts` 或 CLI 写入分发
- 公共 API 写语义、响应精简、安全字段 schema

逐项记录 `covered / blocked / intentionally excluded`。存在未测试项时不得汇报“全部通过”。

## 2. 构建并锁定待测产物

从仓库根目录执行：

```bash
pnpm build:server
pnpm build:cli
test -s dist/mcp-server.cjs
test -s cli/dist/cli.cjs
shasum -a 256 dist/mcp-server.cjs cli/dist/cli.cjs
```

记录构建时间和 SHA-256，测试期间不要再次构建。生产验收使用 `dist/mcp-server.cjs`；只有用户明确要求开发产物时才改用 `dev/mcp-server.cjs`。

确认 Server bundle 没有浏览器 stdio shim：

```bash
if rg -q "StdioServerTransport is not supported in this environment" dist/mcp-server.cjs; then
  echo "browser stdio shim leaked into server bundle" >&2
  exit 1
fi
```

## 3. 检查真实环境

确认：

1. 思源内核正在运行，并能通过现有 CLI profile 调用 `system get_version`。
2. 严格安全写入已开启。
3. 用户指定的测试笔记本存在，且 Sisyphus 对它具有 `rwd` 权限。
4. 需要测试 CLI/stdio 共享租约时，插件 HTTP MCP 服务已开启。
5. 本轮测试前没有遗留的同名夹具。

只显示 profile 名、URL 主机和状态；不要打印 Token。

## 4. 创建隔离夹具

使用时间戳或 UUID 生成唯一前缀，例如 `CJS-LIVE-20260812-213000`。在测试笔记本中建立一个根测试文档，并按 action 需要创建：

- 两个可移动、重命名和删除的子文档；
- 多个段落、标题和引用块；
- 一个仅供本轮使用的属性视图及测试行列；
- 唯一测试标签；
- 唯一模板与小型测试资源；
- 可创建、复习和删除的测试闪卡；
- 必须验证 notebook 删除或权限时使用的临时测试笔记本。

维护夹具清单，至少包含类型、ID、路径、创建 action、预期清理 action。不要把 Token 或完整私有正文写入清单。

## 5. 直接运行本次构建的 CJS

使用随 Skill 提供的脚本启动单进程交互客户端：

```bash
node .agents/skills/siyuan-built-cjs-live-test/scripts/call-built-mcp.cjs \
  --server dist/mcp-server.cjs \
  --transport direct \
  --interactive
```

`direct` 会 `require()` 指定 CJS，并用 `createSiYuanServer({ transportMode: 'http' })` 建立进程内 MCP 连接。这样预检租约和正式写入留在同一个、确实来自本轮 bundle 的协调器中。每行输入一条 JSON：

```json
{"tool":"system","args":{"action":"get_version"}}
```

不要为预检和正式写入分别启动脚本；重启会按设计清空内存租约。脚本输出一行一个 JSON 结果，适合通过持续的 PTY 会话逐步读取凭据再提交写入。

高危 action 仅在所有目标均已核对为本轮隔离夹具时增加 `--confirm-isolated-dangerous`。该开关会接受 MCP elicitation，不代表可以操作用户数据。

## 6. 逐 action 验证严格写入

对每个有前置条件的 action：

1. 使用完整且不含安全字段的业务参数调用 `validateOnly: true`。
2. 断言 `writeAttempted=false`，读取服务端返回的 `preconditionField`，不要猜字段。
3. 断言凭据为 `sha256:v1:<至少4位十六进制>`，并包含 `hashPrefixLength` 与 `leaseExpiresAt`。
4. 用完全相同的业务参数、新 UUIDv7 `requestId`、返回字段和凭据执行正式写入。
5. 断言 `writeSafetyGuaranteed=true`、`transactionState` 为预期终态，并只读回查目标。
6. 用新 `requestId` 重用已消费凭据，断言 `preflight_lease_invalid` 和 `revalidateRequired=true`。
7. 用原 `requestId` 和相同参数重放，断言不发生第二次写入。

对无前置条件的纯新增 action，直接携带新 `requestId` 写入，随后验证幂等重放和只读回查。

每种前置条件类别至少选择一个无破坏夹具执行并发扰动测试：预检后通过另一条合法调用改变目标，再提交旧凭据；必须得到 `state_changed`，原写函数效果不得出现。覆盖 `state`、`structure`、`manifest`、`source`；无法安全制造的类别明确记录原因。

同时覆盖：裸短值、版本化短值、大小写、4 位与 64 位边界、3 位/65 位/非法字符、重复预检续期、成功消费、写前拒绝保留、未知结果消费以及重启失效。碰撞与可控时钟场景保留在自动化测试中，不要为了制造真实 SHA-256 前缀碰撞污染笔记本。

## 7. 验证三种入口

### 直接 bundle

用 `--transport direct` 完成逐 action 主矩阵。这是证明“刚构建的 CJS 本身可用”的主要证据。

### stdio bundle

另启脚本并使用 `--transport stdio`，至少验证工具发现和只读调用：

```bash
node .agents/skills/siyuan-built-cjs-live-test/scripts/call-built-mcp.cjs \
  --server dist/mcp-server.cjs \
  --transport stdio \
  --tool system \
  --args-json '{"action":"get_version"}'
```

严格修改在 stdio 模式下会转发到插件 HTTP 协调器；因此它验证的是 bundle 启动与跨入口路由，不等同于 `direct` 的本地协调器测试。

### CLI 与插件 HTTP

使用刚构建的 `cli/dist/cli.cjs` 做只读调用，并选择一个可回滚夹具完成跨入口租约测试：一个入口预检，另一个入口正式提交。验证两者共享插件 HTTP Server 的租约池。不要把 `direct` 进程中的租约拿到 CLI 使用；它们本来就属于不同协调器。

若要验证服务重启失效，先签发但不消费一个测试租约，经用户允许重启插件 HTTP 服务，再确认短凭据与 64 位值均返回 `preflight_lease_invalid`。

## 8. 清理和报告

按依赖反序清理本轮创建的闪卡、AV 行列、块、文档、模板、资源、标签和临时笔记本。每次删除前再次核对唯一前缀与 ID。默认保留一份用户可读的测试报告文档；用户要求完全清理时再删除它。

报告表至少包含：

| tool.action | 产物 SHA | 入口 | 夹具 | 预检 | 正式写入 | 重放 | 状态变化 | 读回 | 清理 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

最后汇报：构建产物及摘要、真实思源版本、测试笔记本路径、已覆盖 action、未覆盖 action 及原因、跨入口结果、自动化测试结果、遗留夹具。不要只给总数，也不要把“策略已分类”写成“真实 action 已执行”。

## 9. 最终回归

真实测试完成后运行：

```bash
pnpm test
pnpm build
pnpm build:cli
node scripts/generate-skills.mjs --check
git diff --check
```

任何失败都应保留原始错误摘要，定位后修复并重跑相应层级；不要用删测试、关闭严格模式或改为旧产物来获得绿色结果。
