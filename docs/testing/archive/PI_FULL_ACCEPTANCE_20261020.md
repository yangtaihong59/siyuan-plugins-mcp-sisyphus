# pi 完整功能测试与主代理复核（2026-10-20）

**结论：测试轮已完成，存在 P1，未达到发布放行条件。未修产品、未提交、未发布。**

模型为本机 pi 目录中的 `deepseek/deepseek-flash`，不据别名推断独立的“4.1”版本。以当前未发布 Strict Write v2 构建为对象，连接思源 3.8.7 的“测试用”笔记本；临时权限笔记本获本会话授权。所有测试数据均为新建隔离夹具。

## 实际范围

- 全量 137 个静态 action 建立账目。pi 汇总 121 个有成功调用记录、2 failed、14 blocked；137 是清单规模，不是全部功能通过数。
- 基础确定性验收 **57/57** 通过，包含四日期事件两次调用、18 文档批量改名两次调用、重放、旧状态拒绝、四级权限、COUNT 与 box 保留、HTTP/direct/stdio/CLI 路径。
- 扩展驱动最终 **117 个检查点，111 个通过**，涉及 12 类有正向记录的工具。不同分支与 action 会重复，不能把检查数当 action 数。
- 扩展账目需要保守解释：mut() 自动标记 readbackVerified、部分读取仅检查数组/JSON 存在，没有独立全集 oracle；例如 document.list_tree 的路径与弱断言仍有不足。因此 **121 不是主代理逐项确认的强验证覆盖数**，不据其 98.4% 比例放行。
- 九类角色使用新 pi 会话：新手、整理、数据库、归档、管理员、CLI 任务完成；科研、学习、多端任务部分完成。CLI 为 assisted shell，其余为受限工具会话。角色模拟不等于真人研究。
- 科研 SQL、学习复习受角色网关规则影响；初轮有文本化 DSML 而无真实工具调用，已排除。网关问题不能列作产品故障。角色具体计数及重跑轨迹见原始目录。

## 优先问题

### P1：doc_to_heading 以文档为目标会产生损坏的目标文件

主代理独立使用新 CJS 创建一份父文档、Source、Target，确认两个内容标记存在，再通过 `preflight.commitArgs` 提交 `document.doc_to_heading(srcID=Source,targetID=Target,after=false)`。

结果：提交返回 `readback_mismatch` / `transactionState=unknown`；源文档消失。随后 11 次、跨 10 秒只读检查中，目标子块为空，元数据/导出持续出现解析错误。通过思源文件 API 读取该精确目标 `.sy`，文件包含本轮 ID/内容标记，但 JSON 解析失败。常规删除父文档也被该损坏文件阻断。

证据：`.sisyphus/acceptance/pi-full-20261020/parent-conversion-check.json`、`parent-corrupt-file.json` 和保存的测试 `.sy`。不能只把它解释为索引延迟。pi 的直接内核对照也出现类似现象，但本轮不进一步归因具体内核/插件缺陷；产品公开允许文档目标，必须限制或正确适配，并增加内容保留回归后再放行。

未重试未知请求。已保存损坏测试文件，通过 API 精确移除该损坏目标后正常删除父文档，清理核对见 `parent-conversion-cleanup.json`。未访问或恢复已有用户笔记。

### P2：heading_to_doc 缺省路径参数失败

schema 中 targetPath/previousPath 可选，实际省略后提交多次返回 block_not_found 并进入 unknown。显式路径的独立分支可成功，需复核其参数契约并补回归。不能让调用方依赖看源码猜必需参数。

### 使用与测试卡点

- 新手、归档及 CLI 会话仍出现先提交再获 precondition_required 的额外往返；统一 commitArgs 已可用，但发现性需改进。不能在拒绝时无预检直接签发可执行写入参数。
- 文档创建路径、fs 人类路径与测试网关范围判断不一致，角色通过 fs.write 恢复；其中网关影响需与产品路径文档分开评估。
- 上传后即时读回哈希异常、AV search 新建内容发现属于待进一步验证项，不能从弱 oracle 直接定为产品缺陷。
- 闪卡复习的角色失败来自网关对 cardID/牌组的限制；功能驱动的 no_change 断言也有误判。保留能力缺口，不声称该角色完整通过。

## 清理与隔离复核

主代理中途发现宽前缀清理 `UXP-2`，其实际删除清单为空；立即暂停并禁用该脚本。此为测试执行问题，不应声称本轮从未尝试宽前缀清理。随后按精确创建回执清理。

pi 汇总漏掉 11 个孤立 AV 定义。主代理从本轮创建/复制回执提取精确 avID，逐项确认无载体引用后移除并核对，证据 `parent-av-check.json` / `parent-av-cleanup.json`。主代理独立转换探针及 pi 的三个原生对照探针均发现损坏文件；已逐一保存证据并精确移除，随后正常删除父文档。pi 原摘要“无 D2H 残留”不准确，已由主代理收尾，证据 `parent-pi-probes-cleanup.json`。最终 SQL 核对探针文档为 0，见 `parent-final-verify.json`。

原有两本身份及权限摘要保持；保留一篇基础测试报告 `/测试用/AV-V2-20261020014902-验收报告`（ID `20261020095017-vkjxody`）。本地 ZIP、导出件、损坏的合成测试文件保留作证据。产品源码/已有测试/文档快照未被 pi 修改。

## 缺口

数据仓库密钥未初始化，时间线只读受阻；快照、同步、通知、反馈发送、购买、第三方写入、全局未引用资产清理未授权而排除。部分动作被当前配置禁用，语义/资产内容搜索缺索引条件。未实测 Windows/Linux/Docker/远程/移动端、真实 Apps 渲染、其他模型。当前宿主已安装 kernel.js 未替换，主路由为新 Node CJS 协调器，不能声称已安装插件全入口部署验收。

## 证据入口

`.sisyphus/acceptance/pi-full-20261020/`：`run.json`、`functional-actions.json`、`findings.json`、`live-av-v2.json`、`extended.json`、`raw/extended-raw.jsonl`、`ux/`、`cleanup.json`、主代理 `parent-*` 证据。`summary-pi-original.md` 保留代理原始结论，最终结论以本报告为准。

构建 SHA：server `99f1a04c55f9f40e2b8b1dd600440a938f91a49be5b53460b7ecaee9a537ac7f`；CLI `ab0f74daa4b9f2aef72a9ea8798df505c9f116c500c264da662383c6b97bb807`。插件版本仍 0.6.13，CLI 仍 0.2.13。

最终自动化回归：134 个文件、1634 项通过，插件与 CLI 构建、skills 及 diff 检查通过。自动化绿色未覆盖本轮发现的转换缺陷，不能代替该问题的修复验收。

## 后续修复

本报告中的 `document.doc_to_heading` 与 `document.heading_to_doc` 问题已完成修复，并由 pi 和主代理用新构建产物真实复测。详见 [转换修复与复测报告](./DOCUMENT_CONVERSION_REPAIR_20261020.md)。本报告原始失败证据保留，不将旧轮结果追改为成功。
