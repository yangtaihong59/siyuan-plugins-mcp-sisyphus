# 严格安全写入

严格安全写入解决的不是“写接口是否返回成功”，而是三个更具体的问题：目标在读取后是否被别人改过、网络失败时是否会重复写、以及重复请求能否被识别。该功能默认开启，且不创建思源数据快照。

## 调用流程

对于需要前置条件的修改型 action，先用完全相同的业务参数执行预检：

```json
{
  "action": "update",
  "id": "20260812120000-abcdefg",
  "dataType": "markdown",
  "data": "新内容",
  "validateOnly": true
}
```

预检只读取目标，不执行修改。服务端计算完整 SHA-256，并在当前 MCP Server 进程内创建一条 10 分钟有效的预检租约。响应会给出 `preconditionField` 和最短唯一短凭据，例如：

```json
{
  "validateOnly": true,
  "writeAttempted": false,
  "preconditionField": "expectedStateHash",
  "stateHash": "sha256:v1:8ac2",
  "hashPrefixLength": 4,
  "leaseExpiresAt": 1786543200000
}
```

随后生成一个新的 UUIDv7，并提交一次真实写入：

```json
{
  "action": "update",
  "id": "20260812120000-abcdefg",
  "dataType": "markdown",
  "data": "新内容",
  "requestId": "019c1234-5678-7abc-8def-0123456789ab",
  "expectedStateHash": "sha256:v1:8ac2"
}
```

不同 action 可能返回 `expectedStateHash`、`expectedStructureHash`、`expectedManifestHash` 或 `expectedSourceHash`。调用方应读取 `preconditionField`，不要自行猜测字段。纯新增 action 不需要状态哈希，但真实执行仍要求新的 UUIDv7 `requestId`。

凭据接受 `sha256:v1:<4～64 位十六进制>` 或裸 `<4～64 位十六进制>`，不区分大小写。4 位只是租约查找键，不是把正确性降低为 16 bit 比较：正式写入会按 `tool + action + 业务参数摘要 + 排序后的目标 ID` 查找唯一活动租约，取出其中的完整 256-bit SHA-256，重新读取实时状态并做完整比较。即使提交 64 位完整值，也必须能解析到活动租约，不能绕过预检。

同一操作作用域出现前缀碰撞时，新预检会自动返回 5 位或更长的最短唯一前缀。若旧的 4 位凭据随后变得歧义，服务端不会猜测候选项，也不会泄露完整哈希，而是要求重新预检。租约仅保存在内存，不保存笔记内容，不写入配置或幂等账本，插件/MCP Server 重启后立即全部失效；成功写入或结果未知后也会被消费。

## 它提高了什么正确性

- 哈希使用稳定键序、保留数组顺序的规范化 JSON，再以带版本前缀的 SHA-256 计算；同一状态在不同入口得到同一摘要。
- Agent 提交短凭据，但安全判断始终比较两份完整 SHA-256；短前缀绝不直接与实时哈希比较。
- 插件 HTTP 服务持有进程级唯一写协调器，所有严格修改串行通过该入口。CLI 与 stdio 不在本地另开写通道。
- 写 HTTP 请求最多发送一次；读取请求仍可针对瞬时故障重试。
- 执行前先把 `requestId` 记为 `executing`，提交后读回目标并记为 `committed`。账本只保存 request ID、action、目标 ID 和哈希，不保存笔记正文或二进制内容。
- 相同 `requestId` 和相同参数再次到达时不会再写；若 ID 被另一组参数复用，则返回 `idempotency_conflict`。

## 失败语义

| 错误码 | 含义 | 调用方行为 |
| --- | --- | --- |
| `precondition_required` | 缺少预检哈希或 request ID | 重新预检；不要直接猜哈希 |
| `preflight_lease_invalid` | 租约缺失、过期、被淘汰或服务已重启 | 使用相同业务参数重新 `validateOnly` |
| `ambiguous_hash_prefix` | 短前缀在当前作用域匹配多条活动租约 | 重新预检，使用服务端签发的更长前缀 |
| `state_changed` | 预检后目标已变化 | 停止，重新读取并决定是否仍要修改 |
| `outcome_unknown` | 写入开始后连接中断，结果无法确定 | 不要换新 ID 自动重试；先检查目标 |
| `readback_mismatch` | 接口返回后无法确认最终状态 | 视为未知结果，人工或只读检查 |
| `idempotency_conflict` | request ID 被用于另一组参数 | 这是调用方错误，必须生成新 ID |
| `write_coordinator_unavailable` | CLI/stdio 找不到插件 HTTP 协调器 | 开启插件 HTTP 服务并重试预检 |
| `preflight_unavailable` | action 是无法读回的外部副作用 | 预检不会执行；如确认调用，只能接受非严格保证 |

## 边界

`extension` 转发的第三方或思源原生 Tool 不在 Sisyphus 的控制范围内，因此不会宣称严格写入保证。本地导出、通知、同步和反馈等外部副作用也无法通过思源状态读回验证：`validateOnly` 会拒绝且保证不执行；真实调用仍保持单次传输，但响应会明确给出 `writeSafetyGuaranteed: false`。

这不是思源内核级 CAS 事务。统一协调器能串行化所有经过 Sisyphus 的写入，但思源界面、其他插件或直接调用内核 API 的写入仍可能在“最后一次状态检查”和实际执行之间插入。提交后读回可以暴露异常最终状态，却不会自动回滚；出现 `outcome_unknown` 或 `readback_mismatch` 时必须先检查目标。

短哈希租约本身不会调用 `/api/repo/*`，不会创建思源仓库快照，也不会为了预检保存完整正文（时间线工具原有的仓库状态读取不属于租约存储）。成功响应中的 `previousHash`、`resultHash` 等完整审计摘要不能直接作为下一次写入凭据；下一次修改仍需重新预检取得活动租约。

关闭“严格安全写入”只用于确实需要旧调用方式的场景。关闭后 Schema 不再暴露安全字段，修改直接执行且不自动重试，但响应会标记 `writeSafetyGuaranteed: false`。
