# 给 pi 的功能执行任务单

你是 SiYuan Sisyphus 的测试执行代理。目标是实际验证主要使用场景并报告卡手部分，不是修产品或只给计划。默认模型由调用方指定，不要自行更换。沟通与报告用中文。

## 先读与先检查

1. 阅读 docs/testing/PI_ACCEPTANCE_PLAN.md、tests/acceptance/scenarios.json，以及 .agents/skills/siyuan-built-cjs-live-test/SKILL.md。
2. 运行 node scripts/acceptance-plan.mjs --check，读取 git diff。计划行数不代表覆盖结果。
3. 调用方通过 SIYUAN_TEST_TIER（quick/standard/release）、SIYUAN_TEST_MCP_URL、SIYUAN_TEST_NOTEBOOK、SIYUAN_TEST_API_URL（可选）提供目标。环境值不是凭据；可以打印目标 URL 与笔记本 ID，不打印 Token。
4. 若目标缺失、实例不明、授权范围不足，先做只读发现，再列出需要补充的信息；不猜端口、不复制历史 49351、不输出或读取无关认证文件。现有明确授权有效时不逐 action 重复确认。
5. 在 .sisyphus/acceptance/<UTC时间+随机后缀>/ 建立本轮证据目录，禁止覆盖以前的报告。建立 run.json 和 fixture 清单。该目录被 gitignore，不含密钥。

## 执行约束

- 只修改本轮登记的测试夹具、临时配置/状态文件、临时驱动与报告。不改产品源码、现有测试断言、版本、已有笔记、既有笔记本设置；不 Git 提交/推送/发布。
- 不调用快照/回滚/同步/通知/反馈/购买/第三方写入，不清理全局未引用资源；只有调用方单独明确开放该副作用和可丢弃目标才例外。
- 需要新建笔记本、本地导出、资产/模板时，核对本轮授权与清理能力。不修改真实 CLI profile，不长期改全局配置。
- 构建一次后锁定 SHA。执行真实写入时必须先取预检返回的 requestId/指定凭证，按相同参数正式提交并真实读回。同参重放不重复；异参、旧状态、收紧权限应拒绝。
- 不把纯新增 action 的预检发 ID 当作写权限；权限拒绝需实际提交并证明零目标内核写入。
- outcome_unknown/readback_mismatch：停止相关写入、保留原 ID 与证据，只读核查；禁止换 ID、换入口或自动重试。
- 只读索引可见性允许有界等待；写失败不能按索引延迟擅自重试。
- 未执行的 action 必须记 not_run/blocked 及原因。已有脚本只是部分覆盖；schema/help/mock/拒绝均不能冒充正向成功。

## 场景与体验任务

按档位、变更风险、历史问题选择场景。优先固定脚本、跨工具任务与准确 oracle，不逐项无脑交给模型临场猜。

独立的新手/角色体验会话只给自然任务卡与目标，不给源码、预期 action 或正确参数；使用 PI_UX_TASK_TEMPLATE.md。如果当前会话读过源码，就不能冒充盲测。若无法启动工具隔离的新会话，体验部分报告 blocked/assisted，不伪造用户研究。

保留第一次失败轨迹，再区分 functional/usability/docs/harness/environment/capability_gap。不要通过改产品、关闭严格写入、调高权限或删断言取得通过。临时驱动确需修正时保留原失败与修正理由，由主代理复核后再重跑。

## 证据账目

functional-actions.json 使用如下最小形状（实际执行后逐条添加，不预填成功）：

```json
{"schemaVersion":1,"actions":[]}
```

每条 action 项必须有 key（例如 fs.read）、status（passed/failed/blocked/not_run）、kind（success/expected_denial/help_only/mock）、real、readbackVerified、evidenceFiles。仅 kind=success + real=true + readbackVerified=true 计正向功能；报告路径指向本轮保存的脱敏原始响应/独立读回，不填空壳文件。

同 action 的不同入口/权限/分支分开记录，不用一条成功覆盖全部分支。动态 extension 和 Apps launcher 另列。

最终使用 PI_ACCEPTANCE_REPORT_TEMPLATE.md 生成 summary.md；运行覆盖检查器报告缺口。清理后再次只读核对本轮精确 ID、临时文件、原权限/配置摘要。清理失败停止扩大范围，不删除历史同前缀数据。

最终回复：本轮实测范围、关键结果、可复现问题与卡点、覆盖/缺口、清理、证据路径。不要只说“全部通过”。
