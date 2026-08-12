# Action Test Coverage

本文档记录当前源码中聚合工具 action 的自动化测试覆盖口径。它补充 `AI_INTERFACE_TEST.md` 的人工/真实思源回归流程，重点回答一个问题：

> 每个已声明 action 是否至少有一条自动化测试能跑到运行时调用路径？

## 覆盖结论

静态 action 总数和每个工具的 action 清单从 `src/core/config.ts` 的 `ACTIONS_BY_CATEGORY` 计算；`extension` 还会按官方注册表生成动态 action。`tests/unit/core/action-inventory-docs.test.ts` 会确认类别和静态 action 均由该注册表导出，因此新增 action 不需要手工改写本页的计数。

| 工具 | action 清单来源 | 覆盖方式 |
| --- | ---: | --- |
| `fs` | `ACTIONS_BY_CATEGORY.fs` | `tests/unit/tools/action-contract.test.ts` 对每个 action 做最小运行时契约调用 |
| `notebook` | `ACTIONS_BY_CATEGORY.notebook` | `tests/unit/tools/action-contract.test.ts` 对每个 action 做最小运行时契约调用 |
| `document` | `ACTIONS_BY_CATEGORY.document` | `tests/unit/tools/action-contract.test.ts` 对每个 action 做最小运行时契约调用 |
| `block` | `ACTIONS_BY_CATEGORY.block` | `tests/unit/tools/action-contract.test.ts` 对每个 action 做最小运行时契约调用 |
| `av` | `ACTIONS_BY_CATEGORY.av` | `tests/unit/tools/av.test.ts` 对每个 action 有直接调用覆盖 |
| `search` | `ACTIONS_BY_CATEGORY.search` | `tests/unit/tools/action-contract.test.ts` 对每个 action 做最小运行时契约调用 |
| `file` | `ACTIONS_BY_CATEGORY.file` | `tests/unit/tools/action-contract.test.ts` 对每个 action 做最小运行时契约调用 |
| `system` | `ACTIONS_BY_CATEGORY.system` | `tests/unit/tools/action-contract.test.ts` 对每个 action 做最小运行时契约调用 |
| `flashcard` | `ACTIONS_BY_CATEGORY.flashcard` | `tests/unit/tools/flashcard.test.ts` 对每个 action 有直接调用覆盖 |
| `extension` | `ACTIONS_BY_CATEGORY.extension` + 动态官方注册表 | `tests/unit/core/official-mcp-bridge.test.ts` 与 `tests/unit/tools/extension.test.ts` 覆盖发现、schema、屏蔽和转发 |
| `tag` | `ACTIONS_BY_CATEGORY.tag` | `tests/unit/tools/action-contract.test.ts` 对每个 action 做最小运行时契约调用 |
| `timeline` | `ACTIONS_BY_CATEGORY.timeline` | `tests/unit/tools/timeline.test.ts` 覆盖默认开关、节点创建/删除、diff、块回档与 `rwd` 权限 |
| `mascot` | `ACTIONS_BY_CATEGORY.mascot` | `tests/unit/tools/mascot.test.ts` 对每个 action 有直接调用覆盖 |
| `feedback` | `ACTIONS_BY_CATEGORY.feedback` | `tests/unit/core/feedback.test.ts` 和 `tests/unit/tools/feedback.test.ts` 覆盖 WPS payload 与工具路由 |

## 契约测试规则

`tests/unit/tools/action-contract.test.ts` 对覆盖的工具执行以下检查：

1. 测试用例列表必须和源码 `*_VARIANTS` 中声明的 action 完全一致。
2. 每个 action 使用最小合法参数调用真实 `call*Tool()` 路由。
3. 调用结果不得返回工具错误。
4. 每个 action 必须触达预期的 SiYuan API endpoint 或 `requestFormData()` endpoint。

这类测试用于防止 action 已出现在 schema/help 中，但实际 handler 路由、参数形状或底层 API endpoint 不可用的问题。`document.move` / `block.move` 这类高风险动作应始终保留在契约测试中。

## 运行命令

```bash
pnpm vitest run tests/unit/tools/action-contract.test.ts
pnpm vitest run tests/unit/core/action-inventory-docs.test.ts
pnpm vitest run tests/unit/tools
```

## 仍需真实环境验证的内容

自动化契约测试使用 mock SiYuan API，只保证 action 的本地路由、参数校验、权限检查和 endpoint 调用形状。以下内容仍应通过 `AI_INTERFACE_TEST.md` 或 smoke 测试在真实思源实例中验证：

- SiYuan 内核实际接受 endpoint payload。
- 文档移动、块移动、删除、批量替换、上传/导出等高风险动作的真实副作用。
- 索引延迟相关行为，例如搜索、标签、AV row 查询。
- 仓库快照创建、标签索引、文档级 diff 和回档在真实仓库数据上的行为。
- 权限过滤在多笔记本真实数据中的表现。
