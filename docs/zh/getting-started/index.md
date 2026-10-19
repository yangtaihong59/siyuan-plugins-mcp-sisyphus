# 快速开始

这一组页面说明如何安装插件、选择传输方式，以及在连接失败时如何排查。

适用场景：你正在配置插件、连接 MCP 客户端，或者在 HTTP 与 stdio 之间做选择。

相关页面：

- [部署指南](./deployment.md)
- [HTTPS 配置](./https.md)
- [故障排查](./troubleshooting.md)
- [常见任务](../reference/common-tasks.md)

## 建议阅读顺序

1. [部署指南](./deployment.md)
2. 如果需要 TLS，再看 [HTTPS 配置](./https.md)
3. 如果连接失败，再看 [故障排查](./troubleshooting.md)

## 本节覆盖内容

- 从集市或源码安装
- HTTP、stdio 与 `mcp-remote` 桥接的选择
- 环境变量与默认端口
- Docker、WSL、局域网场景
- 工具不可见或调用失败时的快速检查

## 场景 Skill 与 MCP Prompt

连接成功后，MCP 客户端可以通过标准 Resource 发现按场景组织的操作指南：

- `siyuan://skills/index` 用于把任务路由到最匹配、范围最窄的 Skill。
- `siyuan://skills/{name}` 返回选定场景的工作流与安全指南。

这些 Resource 由 MCP Server 直接提供，无需在客户端安装。Server 还会暴露带可选 `task` 参数的对应 Prompt。Prompt 是由用户显式调用的工作流入口，客户端不应假定它会自动运行。

如果 Agent 支持安装 `SKILL.md` 包，可以通过 npm CLI 安装等价的本地套件：

```bash
# 既有默认行为：CLI 命令约定
siyuan-sisyphus skill install

# MCP 工具调用约定
siyuan-sisyphus skill install --bundle mcp

# 同时安装两套
siyuan-sisyphus skill install --bundle all
```

`skill list` 和 `skill read` 同样接受 `--bundle cli|mcp|all`。Skill 描述任务流程、路径语义和安全规则，但不替代 action schema。精确且最新的参数应读取 `siyuan://help/action/{tool}/{action}`，或调用对应工具的 `help` action。

## MCP 2026-07-28 与旧客户端

- `stdio` 自动接受新旧两代协议。
- HTTP 将 2026-07-28 请求路由到逐请求无状态 handler，同时为旧客户端保留带 `mcp-session-id` 的有状态会话。
- modern 高危 action 会先通过 MCP 多轮 elicitation 请求确认；仅在客户端声明表单 elicitation 能力时弹出确认；未声明或仅支持 URL 模式时跳过弹框，仍执行权限、action 开关和严格预检校验。
- 带 `Origin` 的浏览器请求只允许 localhost 及 `SIYUAN_MCP_ALLOWED_ORIGINS` 中用逗号分隔的主机名。
- 内置思源官方 MCP 客户端使用自动版本协商。

SEP-2640 仍是草案扩展，但在 HTTP 与 stdio 传输中均默认开启，并发布全部内置工作流 Skill。插件内置 HTTP 服务可在“连接配置 → HTTP/HTTPS 连接 → Skills over MCP”中开关。独立启动时可设置 `SIYUAN_MCP_SKILLS_EXTENSION=false` 显式关闭。服务端会声明 `io.modelcontextprotocol/skills`，并开放 `skills/list`、`skills/get` 与全部内置 `skill://` 资源。无论是否启用该扩展，既有 `siyuan://skills/*` Resource 都继续工作。

仓库内通过校验的 Codex 包装位于 `agent-plugin/siyuan-sisyphus`。其中 MCP 配置指向 `http://127.0.0.1:36806/mcp`；若服务端要求 `SIYUAN_MCP_TOKEN`，需在客户端侧补充 Bearer 认证。

## 下一步

配置完成后，前往 [常见任务](../reference/common-tasks.md) 页面尝试 MCP/CLI 快速示例。

## DSH（DeepSeek Harness）

在插件设置的 MCP 客户端列表中选择 **DSH**，再选择 HTTP/HTTPS 或 stdio，复制生成的 **Cordis YAML patch**。桌面版配置文件为 `~/.dsh/profiles/desktop/cordis.patch.yml`，其他 profile 可用 `web`、`headless`、`tui`。按条目 `id` 合并到已有补丁，保留其他内容；不要增加 `mcpServers` 外层，也不要重复添加相同 `serverName`。

以下示例无需认证；地址和端口应以设置页生成值为准：

```yaml
- insert:
    - id: mcp-siyuan-sisyphus
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: siyuan-sisyphus
        transport: streamable-http
        url: http://127.0.0.1:36806/mcp
        failOnStartupError: true
```

保存后热加载，无需重启。工具名为 `mcp__siyuan-sisyphus__<tool>`，例如 `mcp__siyuan-sisyphus__fs`。当前片段使用 `failOnStartupError: true`，应先启动思源 MCP 服务。

开启 HTTP 认证后，设置页生成 `Authorization: !!js "'Bearer ' + process.env.MCP_TOKEN"`；stdio 使用 `SIYUAN_TOKEN: !!js process.env.SIYUAN_TOKEN` 引用内核 API Token。需让 DSH 进程实际继承对应环境变量，不要把 Token 明文写入 YAML；仅在终端 export 不一定对已启动的桌面应用生效。
