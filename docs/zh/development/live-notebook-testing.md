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

## 扩展包生命周期边界

扩展验收分为四个不同阶段，一个阶段的证据不能替代下一个阶段：

1. **包静态校验**：检查元数据、必需文件、声明的兼容性、入口、处理器和清理路径。静态校验可以发现包形态错误或兼容性不符，不能证明思源已经加载或执行它。
2. **真实加载**：检查当前扩展清册和用户可见的启用状态。包存在于磁盘或出现在发现结果中，不等于 `onload` 或 `kernel.js` 已运行。
3. **注册与注销**：只有在单独获准的 live 检查中，才在加载后验证扩展实际拥有的动作面，再禁用或卸载并确认同名注册已消失。检查 DOM 节点、监听器、定时器、RPC 方法、Agent 动作和插件 MCP 工具是否清理；Sisyphus 的 `extension` bridge 只报告思源官方 `/mcp` 注册表中的工具，不能证明前端 UI 行为。
4. **重载与功能读回**：使用受支持的重载路径，重新发现并完成一次无害的、针对该 surface 的交互。确认新行为只生效一次、旧注册已消失且没有重复处理器。工具列表刷新不等于插件面板或桌面专属路径可用。

浏览器桌面验收只覆盖浏览器兼容面和普通 Web UI。`desktop-window`、Electron、后端或 kernel 专属行为必须在思源桌面应用中单独验收；桌面结果不能推出浏览器兼容。对 manifest 中声明的每个精确 frontend（`desktop`、`desktop-window`、`browser-desktop` 或 `browser-mobile`）分别检查。启用、禁用、重载或调用不受信任的包都属于 live 副作用，本次仅文档变更不执行；如需执行，必须另行取得用户批准。
