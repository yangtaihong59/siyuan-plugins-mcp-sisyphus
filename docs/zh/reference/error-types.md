# 错误类型

这个页面列出 MCP 服务返回的常见高层错误分类。

适用场景：调用失败后，你需要快速判断问题出在参数、权限还是运行时环境。

相关页面：

- [权限模型](./permissions.md)
- [故障排查](../getting-started/troubleshooting.md)

所有入口（Node server、内核端点、CLI）都以 `{ "error": { "type", "message", "tool"?, "action"?, "hint"? } }` 返回这些错误，客户端按 `error.type` 分支。严格写入的结果另用 `success` / `error.code` 契约，见[严格安全写入](./write-safety.md)。

| 错误类型 | 含义 |
|----------|------|
| `validation_error` | 参数无效或缺少必填字段 |
| `permission_denied` | 笔记本权限不允许当前操作 |
| `api_error` | 思源 API 返回错误 |
| `internal_error` | MCP 服务内部失败 |
| `unknown_tool` | 工具名未暴露（含客户端不支持 MCP Apps 时的 App 工具） |
| `tool_disabled` | 工具在配置中被禁用 |
| `action_disabled` | action 在配置中被禁用 |

## 排查顺序

1. 先检查必填字段和路径类型
2. 再检查笔记本权限
3. 再检查思源连通性和 token 配置
4. 最后检查 action 是否被禁用或受限
