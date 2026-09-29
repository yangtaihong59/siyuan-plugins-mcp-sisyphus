# feedback 工具

`feedback` 工具用于向插件开发者提交纯文本产品反馈。

## 严格模式下的提交

用户确认发送内容后，直接调用 `submit`，不传 `validateOnly`、`requestId` 或哈希凭证。反馈发送到外部 WPS 表单，不适用笔记状态预检与幂等重放保证，响应中的 `safety.writeSafetyGuaranteed` 为 `false`。

误传 `validateOnly: true` 时不会发送任何反馈，返回 `preflight_unavailable` 和 `error.hint`，说明如何继续提交。若正式提交超时或响应丢失，不能确定是否已发送，请勿自动重试。

## 动作

| 动作 | 用途 |
|------|------|
| `submit` | 通过配置好的 WPS 表单渠道发送问题反馈、改进建议或使用体验。 |

## 推荐格式

当 AI 客户端反馈中途遇到的 bug、容易造成困惑的行为、不够清晰的帮助说明、不够流畅的工作流，或其他影响体验的问题时，建议把 `description` 写成简洁的 GitHub Issue 风格正文：

```markdown
## Summary
一句话概括问题。

## What happened
发生了什么、哪里让 Agent 或用户困惑、哪里体验不顺。

## Expected behavior
原本期望发生什么。

## Steps or context
相关工具调用、action、页面、参数或工作流上下文。

## Impact
为什么这会影响 AI Agent 或用户。

## Suggested fix
如果已知，写出最直接的改进建议。
```

`impact` 字段用于填写一到两句话的影响摘要。`suggestion` 字段用于填写直接改进建议，避免重复整段 `description`。

## 示例

```json
{
  "action": "submit",
  "description": "## Summary\n文档创建帮助容易让路径格式被误读。\n\n## What happened\n尝试创建子文档时，Agent 不能快速判断 `path` 是否应该包含笔记本名称。\n\n## Expected behavior\n帮助说明应在描述 `path` 的位置直接讲清楚人类可读路径的格式。\n\n## Steps or context\n在选择 create 参数前调用了 document(action=\"help\", topic=\"create\")。\n\n## Impact\nAgent 可能选择错误的文档路径格式，需要额外纠正。\n\n## Suggested fix\n在必填字段附近增加一个简短的有效 create 示例。",
  "impact": "Agent 可能选择错误的文档路径格式，需要额外纠正。",
  "suggestion": "在必填字段附近增加一个简短的有效 create 示例。",
  "agent": "Claude Desktop / Claude Sonnet 4.5"
}
```

来源和插件版本字段会自动填写。

请避免发送密钥、API token、私密笔记内容或敏感本地路径。
