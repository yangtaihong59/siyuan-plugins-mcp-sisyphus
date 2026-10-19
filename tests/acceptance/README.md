# pi 场景验收入口

先读 [完整计划](../../docs/testing/PI_ACCEPTANCE_PLAN.md)。本目录提供规划矩阵，不代表“全场景实测通过”。

## 1. 不接触笔记，先检查计划

```bash
node scripts/acceptance-plan.mjs --check --output /private/tmp/sisyphus-acceptance-inventory.json
```

这会从真实 config/policy 提取工具与 action，并检查场景清单是否遗漏新增 action。不会运行 pi、调用思源或修改笔记。

## 2. 启动功能执行代理

从仓库根目录执行。以下端点与笔记本来自本次用户已选择的测试工作区；以后使用前必须重新核实，不构成对其他实例的授权。`standard` 可换为 `quick` 或 `release`。

```bash
SIYUAN_TEST_TIER=standard \
SIYUAN_TEST_MCP_URL=http://127.0.0.1:36808/mcp \
SIYUAN_TEST_NOTEBOOK=20260909184210-4s2cp7v \
pi --provider deepseek --model deepseek-flash --thinking low \
  --offline --no-extensions --no-mcp --no-skills --no-prompt-templates \
  --no-context-files --no-approve --no-session \
  --tools read,bash,write -p @docs/testing/PI_ACCEPTANCE_PROMPT.md
```

这里是**可读源码的功能执行代理**，通过受审阅的 Node/CLI 临时驱动连接给定端点；`--no-mcp` 防止加载 pi 原有的其他私人 MCP。bash 可以写文件，工具 allowlist 并非安全沙箱；仍需宿主权限、测试代理、目标核对和证据审阅。计划中的副作用限制不因这条命令自动放开。

已知真实 API URL 时可额外设置 `SIYUAN_TEST_API_URL`；给现有脚本使用时只在本轮子进程中映射成 `SIYUAN_API_URL`。不要修改 HOME、真实 CLI profile 或长期工作区设置，不固化历史动态端口。没有 API URL 或认证条件时先发现/核对，缺条件就 blocked。

## 3. 角色体验单独运行

使用 [角色任务模板](../../docs/testing/PI_UX_TASK_TEMPLATE.md)。控制器为每张卡启动全新 pi，会话只开放经核实的目标 MCP 工具，禁止 bash/read 和其他 MCP。工具前缀从实际 pi 工具清单确认，不能假定与 Codex 前缀相同。

当前仓库尚未提供一键启动这些隔离角色会话的 broker。入口/工具隔离未配置好时如实记 blocked，或做 assisted 体验并明确标记；不得把上述功能代理当成新手盲测。CLI 角色的受限 shell 环境也需单独准备。

## 4. 检查实际覆盖账目

执行后，由 pi 保存实际逐 action 证据清单，再计算统计：

```bash
node scripts/acceptance-plan.mjs --report /实际本轮目录/functional-actions.json
```

输出包含正向覆盖与缺口；拒绝、help、mock 不会计为正向功能。检查器不能证明原始证据为真，不能替代真实读回与主代理复核。全局危险场景和缺客户端/平台的场景必须单列。
