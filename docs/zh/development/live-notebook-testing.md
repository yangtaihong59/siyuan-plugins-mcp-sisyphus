# 使用构建产物进行真实笔记本测试

仓库提供开发 Skill [`siyuan-built-cjs-live-test`](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/tree/main/.agents/skills/siyuan-built-cjs-live-test)，用于把“刚构建的 CJS”作为待测对象，在真实思源测试笔记本中执行隔离的端到端验收。本地文件位于 `.agents/skills/siyuan-built-cjs-live-test/SKILL.md`。

适用于以下场景：

- 修改工具或 action 后，需要确认真实思源 API 行为；
- 修改严格安全写入、短哈希租约或幂等账本后，需要逐 action 验证；
- 需要区分直接 bundle、stdio、插件 HTTP 和 CLI 四条入口；
- 自动化测试通过，但仍需真实笔记本证据。

## 使用方式

在支持仓库 Skill 的 Agent 中明确调用：

```text
使用 $siyuan-built-cjs-live-test，以仓库刚构建的 CJS 在“测试专用”笔记本完成本轮受影响 action 的真实验收。
```

Skill 会要求重新构建并记录：

- `dist/mcp-server.cjs`
- `cli/dist/cli.cjs`

随后使用单进程交互脚本直接加载 Server bundle：

```bash
node .agents/skills/siyuan-built-cjs-live-test/scripts/call-built-mcp.cjs \
  --server dist/mcp-server.cjs \
  --transport direct \
  --interactive
```

单进程非常重要：预检租约只存在内存中；若预检和正式提交分别启动 CJS，租约会按设计失效。

## 验收边界

真实写入必须限定在用户指定的测试笔记本和本轮唯一夹具中。Skill 默认不创建思源仓库快照，也不执行同步、通知、反馈、第三方写入、猫猫购买等外部副作用。

最终报告必须逐项列出已覆盖、阻塞和主动排除的 action，不能用“安全策略完整”“单元测试通过”代替真实执行结果。详细工作流与当前覆盖基线以 Skill 本身及其 `references/action-coverage.md` 为准。
