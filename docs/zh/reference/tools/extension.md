# `extension`

`extension` 用于桥接思源 3.7.0 起通过官方 MCP 端点暴露的工具。

## 发现工具

```json
{
  "action": "list",
  "refresh": true
}
```

当 `extension.includeNativeTools=false` 时，响应会刻意保持紧凑：只返回连接状态、plugin/native 来源数量、暴露数量、schema 体积以及 `detailsIncluded=false`，不会返回完整 `tools` 数组，避免已关闭的原生工具发现结果占用 Agent 上下文。

启用原生工具后，响应中的 `detailsIncluded=true`，并额外返回各工具的名称、描述、只读声明、影响范围、降级 schema，以及在 Sisyphus 设置中被屏蔽的状态。`extension` 总览帮助遵循相同规则；仍可通过 `help(topic="<tool>")` 按需查看一个明确指定的工具。

默认接收 `source="plugin"` 的工具。在插件设置中启用 `extension.includeNativeTools=true` 后，也会包含 `source="native"` 的思源原生工具；缺失 source 时按官方兼容规则视为 native。从外部 MCP Server 导入的 `source="mcp"` 工具和本插件自身命名空间仍会被排除。

原生工具默认关闭，因为其中多项能力与 Sisyphus 聚合 action 重叠，并会明显增加 `extension` Schema 体积。
若官方工具名为 `help` 或 `list`，发现结果会标记保留 action 冲突，但不会暴露该工具。

## 调用官方工具

官方完整工具名直接成为 action，下游参数统一放在 `arguments` 中：

```json
{
  "action": "plugin__example_plugin__search",
  "arguments": {
    "action": "query",
    "keyword": "MCP"
  }
}
```

嵌套结构可以避免下游插件工具自身也有 `action` 参数时发生冲突。对应 CLI 调用为：

```bash
siyuan extension plugin__example_plugin__search \
  --arguments-json '{"action":"query","keyword":"MCP"}'
```

启用原生工具后，直接使用其不带前缀的官方名称：

```json
{
  "action": "document",
  "arguments": {
    "action": "read",
    "id": "20240318112233-abc123"
  }
}
```

```bash
siyuan extension document \
  --arguments-json '{"action":"read","id":"20240318112233-abc123"}'
```

## 安全与生命周期

- 连接 `/mcp` 前会先通过 `/api/system/version` 检查思源版本；低于 3.7.0 时直接标记不支持，不访问官方端点。
- 只有启用 `extension`、查看扩展工具设置或主动刷新时才建立连接。
- 未声明 `readOnlyHint=true` 的工具，调用前必须取得用户明确确认。
- 官方 MCP 工具调用只发送一次，绝不自动重试；发送后发生传输错误时会报告“执行状态未知”。
- 工具发现属于只读操作，会话失效时允许重连并重试一次。
- 首次发现由外层 MCP Server 在后台执行，不阻塞其余工具列表；发现成功后缓存结果并发送工具列表变更通知。
- 后续外层 `tools/list` 直接复用缓存，不会强制访问 `/mcp`；`extension(action="list", refresh=true)` 可显式刷新。
- `/mcp` 不可用或显式刷新失败时只隐藏动态扩展 action，不影响其他 Sisyphus 工具或外层 MCP Server。
- 设置页提供总开关、原生工具来源开关和按工具屏蔽。

`extension` 是官方 MCP 桥接，不是 Sisyphus 自有的修改路径。它转发的调用不会经过 Sisyphus 笔记本权限、action 禁用检查、严格预检租约或提交后读回。下游 Tool 可能只读、修改笔记，或触发其他副作用；注册表提供的只有工具级 `readOnlyHint`，原生聚合工具也不会暴露内层 action 级风险。所有未声明只读的转发调用都应视为外部副作用，不能说它们受“严格安全写入”保护。

官方 Tool 已经开始执行后发生传输失败，桥接只发送过这一次调用，执行状态会变成未知；在决定下一步前，应先检查下游目标或插件。工具发现不同：它是只读操作，允许重连并重试一次。正因为两者不同，不能在 `extension` 外面再加一条队列或重放层，把它假装成严格写入。

官方发现需要思源 3.7.0 或更高版本、管理员会话和有效 API Token。该要求只属于 `extension`；Sisyphus 插件的 `minAppVersion` 仍为 2.9.0。

> [!WARNING]
> 原生工具桥接不经过 Sisyphus 的笔记本权限、action 禁用和危险操作确认，而是直接按当前思源管理员会话或 API Token 的权限执行。官方原生聚合工具目前也没有通过 `tools/list` 暴露内层 action 级风险信息，因此工具级 `readOnlyHint` 无法区分只读与写入 action。请将所有原生转发调用视为可能产生副作用，仅对本机或完全可信的客户端启用，不要向不可信远程客户端开放。

## 官方 MCP 与 Sisyphus 的关系

Sisyphus 自带的 `fs`、时间线、权限管理、CLI、文档工具和其他聚合能力始终只走 `/api/*`。官方 `/mcp` 是 `extension` 的独立旁路，不作为任何自带能力的底层实现。

| 关注点 | 思源官方 MCP | Sisyphus |
|---|---|---|
| 注册方式 | 原生工具和插件分别注册独立工具 | 按工具类别和 action 聚合 |
| 命名空间 | 原生名称或 `plugin__<plugin>__<tool>` | 官方名称成为 `extension` action |
| 元数据 | `source`、`readOnlyHint`、`effectScope` | 保留到发现结果、帮助和安全提示 |
| 变更通知 | 官方注册表声明 `listChanged=false` | 在刷新点比较缓存，并通知外层客户端 |
| CLI | 官方注册表不提供 | 通过 `siyuan extension ...` 使用同一桥接层 |
| 调用 | 直接执行官方 `tools/call` | 单次转发且不重放 |
