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
  "requestId": "b72f",
  "preconditionField": "expectedStateHash",
  "expectedStateHash": "8ac2",
  "hashPrefixLength": 4,
  "leaseExpiresAt": 1786543200000
}
```

凭证字段名与正式写入参数一致，可直接复制该字段和值；正式执行时移除 `validateOnly`（或设为 `false`），并复制预检返回的 `requestId`：

```json
{
  "action": "update",
  "id": "20260812120000-abcdefg",
  "dataType": "markdown",
  "data": "新内容",
  "requestId": "b72f",
  "expectedStateHash": "8ac2"
}
```

`requestId` 由预检签发，从 4 位十六进制开始，遇到已签发 ID 冲突时自动加长。请完整复制，不要自行生成、截短或改名；重试必须沿用同一个 ID。首次执行有效期为 10 分钟（`requestIdExpiresAt`），已执行结果最多保留 7 天。服务器持久保留已用 ID 标记，过期 ID 不会再次签发；标记不含笔记正文，存储量随签发次数增长。纯新增操作也必须先预检领取 ID。

不同 action 可能返回 `expectedStateHash`、`expectedStructureHash`、`expectedManifestHash` 或 `expectedSourceHash`。调用方应读取 `preconditionField`，不要自行猜测字段。纯新增 action 不需要状态哈希，但真实执行仍要求预检返回的 `requestId`。

凭据接受 `sha256:v1:<4～64 位十六进制>` 或裸 `<4～64 位十六进制>`，不区分大小写。4 位只是租约查找键，不是把正确性降低为 16 bit 比较：正式写入会按 `tool + action + 业务参数摘要 + 排序后的目标 ID` 查找唯一活动租约，取出其中的完整 256-bit SHA-256，重新读取实时状态并做完整比较。即使提交 64 位完整值，也必须能解析到活动租约，不能绕过预检。

同一操作作用域出现前缀碰撞时，新预检会自动返回 5 位或更长的最短唯一前缀。若旧的 4 位凭据随后变得歧义，服务端不会猜测候选项，也不会泄露完整哈希，而是要求重新预检。租约仅保存在内存，不保存笔记内容，不写入配置或幂等账本，插件/MCP Server 重启后立即全部失效；成功写入或结果未知后也会被消费。

`block.update` 的 `targetCount` 包含单个 `id` 或批量 `items[].id` 中的去重目标数。11 个不同块的批量更新返回 11；同一个 ID 重复出现仍只算一个目标。块状态同时读取 Kramdown、块属性和 DOM，因此块引用的 `data-subtype`、`strong` / `em` 等行内属性变化会使哈希变化。DOM 属性顺序和创建/更新时间不会被视为内容修改。预检后发生属性修改会返回 `state_changed`；成功修改属性返回 `committed`，只有读回状态一致时才返回 `no_change`。

## 它提高了什么正确性

- `fs` 路径读回先确认文档的实时存在状态，避免删除后尚未更新的路径或 SQL 索引让成功删除被误报为读回失败。存在性查询失败仍按未知结果处理，不把网络错误当成已删除。
- 哈希使用稳定键序、保留数组顺序的规范化 JSON，再以带版本前缀的 SHA-256 计算；同一状态在不同入口得到同一摘要。
- `fs.reorder` 与 `document.reorder` 使用结构前置条件，覆盖父级、笔记本配置，以及每个可见直属子文档的 ID、存储路径、`sort` 值和当前顺序。并发新增、删除、移动或重排都会使租约失效；提交后还必须读回精确目标顺序与自定义排序模式。
- Agent 提交短凭据，但安全判断始终比较两份完整 SHA-256；短前缀绝不直接与实时哈希比较。
- 工作空间选定的协调器（内核入口优先，否则为 Node HTTP）持有唯一租约池、账本和串行写通道；CLI、stdio 与 Node HTTP 统一转交给它。
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
| `write_coordinator_unavailable` | 无法发现或连接选定协调器 | 检查内核入口或 Node HTTP 设置并重试预检 |
| `preflight_unavailable` | action 是无法读回的外部副作用 | 预检不会执行；如确认调用，只能接受非严格保证 |

## 边界

外部操作（包括 `feedback.submit`）在用户授权后使用业务参数直接调用，不传 `validateOnly`、`requestId` 或哈希凭证。工具声明仅对已启用的严格修改操作提供预检字段；混合工具会列出哪些 action 需要预检。误传 `validateOnly` 会返回零执行错误和后续操作提示。

MCP 2026-07-28 高危操作确认会区分 `confirmation_declined`（客户端明确拒绝或 `confirm=false`）、`confirmation_cancelled`（客户端明确取消）和 `confirmation_invalid`（响应格式无效、字段缺失或类型错误）。只有明确取消才返回 `cancelled=true`。无效响应不代表用户撤回授权；应检查客户端的 elicitation 支持，不能跳过确认。确认通过后仍执行原有权限与严格预检校验。

`extension` 转发的第三方或思源原生 Tool 不在 Sisyphus 的控制范围内，因此不会宣称严格写入保证。本地导出、通知、同步和反馈等外部副作用也无法通过思源状态读回验证：`validateOnly` 会拒绝且保证不执行；真实调用仍保持单次传输，但响应会明确给出 `writeSafetyGuaranteed: false`。

严格保证只适用于安全策略标为 `mutation`、并由 Sisyphus 自己拥有的修改型 action。MCP/Agent、stdio 和独立 CLI 的严格修改都会进入当前选定的同一个协调器，不会各自创建租约池、互斥锁或账本。协调器不可用时，调用会返回 `write_coordinator_unavailable`，不会静默退回未协调的写入。只读 action 不需要经过这条写入路径。`extension` 是另一条官方 MCP 桥接路径，因此它转发的插件或原生 Tool 即使恰好修改了笔记，也属于外部副作用，不会获得上述严格保证。

不要为了“更严格”再加一条队列或第二个协调器。现有互斥、进程内租约和幂等元数据账本共同构成唯一协调边界；复制它们会把租约和请求历史拆开，使两条路径都误以为自己可以执行。账本记录 request/action/target 元数据和哈希，租约保存在内存中；两者能防住 Sisyphus 自己的重试和重复请求，但都不是思源内核级 compare-and-swap 事务。

这不是思源内核级 CAS 事务。统一协调器能串行化所有经过 Sisyphus 的写入，但思源界面、其他插件或直接调用内核 API 的写入仍可能在“最后一次状态检查”和实际执行之间插入。提交后读回可以暴露异常最终状态，却不会自动回滚；出现 `outcome_unknown` 或 `readback_mismatch` 时必须先检查目标。

短哈希租约本身不会调用 `/api/repo/*`，不会创建思源仓库快照，也不会为了预检保存完整正文（时间线工具原有的仓库状态读取不属于租约存储）。成功响应中的 `previousHash`、`resultHash` 等完整审计摘要不能直接作为下一次写入凭据；下一次修改仍需重新预检取得活动租约。

关闭“严格安全写入”只用于确实需要旧调用方式的场景。关闭后 Schema 不再暴露安全字段，修改直接执行且不自动重试，但响应会标记 `writeSafetyGuaranteed: false`。

## 内核入口与本地端口共存

启用 `kernelEndpointEnabled` 后，内核是唯一严格写入协调器。CLI、stdio 和 Node HTTP 入口的严格预检与提交都会转交到思源主端口上的 `/plugin/private/siyuan-plugins-mcp-sisyphus/mcp`；即使独立 HTTP 监听关闭，CLI 仍能发现它。未启用内核入口时继续使用 Node HTTP 协调器。

不会在两个入口之间自动重试。连接前失败返回 `write_coordinator_unavailable`；调用已发出但响应丢失返回 `outcome_unknown`，应先核对目标，并使用同一协调器和原 `requestId` 查询/重放结果。不得换入口或换 ID 猜测重试。

切换协调器前，停止新写入并等待进行中的调用结束，随后重启插件运行时与 Node MCP 服务，再重新预检。Node 进程检测到运行期间 owner 改变会返回 `write_coordinator_changed`；这不是分布式锁，也不支持旧租约跨运行时迁移。回滚同样需要排空、重启、重新预检。外部工具、思源 UI 和直接内核 API 的并发修改仍不在协调范围内。

内核同时支持 `2026-07-28` 无会话 MCP 和最高 `2025-11-25` 的 legacy 初始化。现代客户端通过 `server/discover` 发现能力，每个请求在 `params._meta` 携带协议版本和客户端能力；帮助、规则、参数校验、App 工具及 HTML 资源共用 Node 实现。现代 App 能力随请求传入；legacy App 能力按会话保存，闲置 30 分钟失效。

现代危险调用使用多轮 `input_required` / `elicitation/create` 表单确认；单传 `confirm=true` 不能跳过确认。内核签发的 requestState 绑定客户端身份声明、认证上下文及规范化操作参数，5 分钟过期，最多保留 128 项，确认、拒绝或取消后均消费一次。修改参数、伪造、过期或重复使用状态会拒绝执行；重放业务 requestId 也需新一轮确认，之后由原账本去重。确认依赖可信客户端收集用户选择，不是人类批准的密码学证明；端点访问控制仍由思源 private 路由负责。legacy 保留调用方取得确认后传 `confirm=true` 的兼容约定。CLI 主动调用和已经完成确认的 Node 入口，在内部转发时应答内核确认。

模板创建/更新可通过内核 `/api/file/putFile` multipart 写入，正文默认上限为 16 MiB、可配置至 32 MiB，multipart 另预留 64 KiB。内核不直接读取调用者电脑上的 `localFilePath`。CLI/Node 会自动将不超过 10 MiB 的文件传到认证的 `/transfer/upload` 暂存接口，再以 `uploadSource` 进行内核预检/提交，保持唯一协调器。传输使用 `application/octet-stream`，文件名经百分号编码放入 `X-Sisyphus-File-Name`，暂存等待上限为 120 秒；兼容 JSON `{fileName,dataBase64}` 入口。二进制传输减少编码开销，摘要计算仍由内核 JavaScript 执行。哈希按 64 KiB 增量处理并在批次间让出事件循环；暂存接口最多同时接纳 2 个请求，满额返回 HTTP 429。CLI/Node 先向 `/transfer/lookup` 查询相同文件名、完整 SHA-256 和大小对应的已验证暂存项，命中后复用；未命中才传输字节。查询不会依据调用方声明创建新暂存。暂存仅在内存保留 10 分钟，最多 64 项、合计 32 MiB；内容和文件名共同确定标识，修改本地文件后旧 requestId 无法提交新内容。预检会返回 uploadSource，重放可只传该标识，无需再次读取本地文件。超限文件仍需 Node 协调器，切换时遵循上述排空/重启步骤。

启用内核时，CLI/Node 的 export_resources(outputPath) 和 extract_doc 自动请求 delivery=download，通过思源 API 流式下载并落盘，增量计算逐文件 SHA-256。单个 ZIP 或一次文档提取总量上限为 512 MiB，单文件下载超时为 120 秒；下载失败、取消或超限会清理本次未完成输出，不自动从头重试。已有输出文件/文档目录不会被覆盖，提取失败只清理本次新建目录，不删除输出根目录。导出仍属于 external，不宣称严格写入保证；validateOnly 拒绝执行。直接使用内核端点的客户端需自行保存清单中的文件。内核响应大小检查发生在宿主已读取响应之后，不能替代 Go HTTP 客户端的流式内存限制。

## 内核并发与排队取消

内核普通只读 action 最多并发 4 个；修改、外部副作用、第三方 extension 和 App 会话入口在独立通道按到达调度队列的顺序执行，最多 1 个。写入预检、租约与去重仍由同一 WriteSafetyCoordinator 处理。慢查询不会占用修改通道；读写之间不是快照隔离。每个调用使用自己的权限快照，在开始执行时加载。

最多接纳 128 个在途工具请求（包含准备、排队和执行），超过返回 queue_full，尚未执行工具。analytics、余额增减、展示事件分别按存储组串行读改写。这只保护同一运行时 client，不是多个 Node/CLI 进程或外部插件之间的分布式锁。统计落盘仍会等待，因此存储慢时会增加请求延迟。

legacy MCP 客户端可在同一 Mcp-Session-Id 下发送 notifications/cancelled，params.requestId 是原 JSON-RPC ID（数字和字符串区分）。准备/排队请求取消后不进入工具执行；运行中的读取在当前宿主调用结束后停止后续步骤，期间继续占用实际并发槽位。每个调用有独立检查状态，不影响其他请求。已开始工具生命周期的读取仍会记录调用统计。

现代无会话客户端可选用插件扩展 `io.siyuan.sisyphus/task-control`：在 tools/call 的 params._meta 中传入唯一 UUID 字符串 `io.siyuan.sisyphus/taskId`，随后向同一 private 路由的 `/tasks` POST `{taskId,operation:"status"|"cancel"|"result"}`。控制请求须使用相同认证上下文。返回 found、state、cancelRequested、committing，取消还返回 accepted；accepted 只表示接受停止后续步骤，不表示底层请求已终止。扩展 v2 保留已完成任务：10 分钟、最多 128 项、合计 8 MiB、单结果最多 1 MiB；status 不包含正文，result 可取回原工具结果。超大结果只保留终态及 result_too_large。权限或工具配置变化后返回 access_changed，不披露旧正文。确认中的 input_required 不作为终态缓存，避免阻断多轮确认。found=false 可能是未接纳、过期、淘汰或重载，不能判定业务成功与否。缓存仅在内存，不是持久化任务系统；写入仍使用原业务 requestId 核对账本。

CLI 经内核协调器执行时的 Ctrl-C，以及 Node MCP 委托内核调用收到的取消信号，会转发上述控制请求；已发出的业务调用不会因此自动重试。提交前检查取消；进入 executing 账本写入前设置同步提交边界，之后拒绝取消并继续写入、读回和记录终态。外部副作用执行也受该边界保护。下载阶段可以单独停止客户端传输。

该接口是插件扩展。直接现代客户端单纯关闭 HTTP 连接仍无法通知内核 JS handler；已经发给思源的单次请求不能强制中断，也不能撤销已开始的写入。思源 Go 核心保持不变。

认证的 /health 返回 queue 汇总（运行数、排队数、容量、收到取消但尚未结束的读取数），不暴露请求 ID 或内容。回滚调度仍需排空运行中的修改；插件重载会清空待处理队列与内存租约，不能重放未知结果为新写入。

## 工具变更通知与断线恢复

支持 SSE 的思源宿主上，legacy initialize 声明 tools.listChanged。使用相同认证上下文和 Mcp-Session-Id，GET 内核 /mcp，Accept 必须为 text/event-stream。连接建立时发送一次 notifications/tools/list_changed，随后每 5 秒检查配置和已暴露工具清单，仅变化时发送通知。每个认证上下文最多 4 条连接、全局 64 条，每条最多保留 10 分钟；会话过期、端点关闭或读取配置失败时关闭连接。客户端重连后重新获取工具列表。不记录通知历史、不保证逐条重放；共享通知流关闭不会取消工具任务。此通道属于 legacy MCP；现代无会话客户端继续按请求发现能力，不宣称支持其已移除的通知协议。

CLI/Node 每次内核委托均生成传输 taskId。工具响应丢失后，仅对原 /tasks 执行最多 3 次 result 查询（每次超时 2 秒、间隔 100 毫秒），取回已完成结果并继续原有导出保存流程，不自动重发业务请求。仍在执行、缓存失效或不可取回时，返回 outcome_unknown 与 taskId；调用者可继续查询。相同 taskId 在执行中或终态记录仍保留时禁止再次执行 tools/call；正常业务幂等重放应使用新 taskId 和原业务 requestId。

## 读取预算

内核自有普通只读 action 经过 scoped client 的 API 调用合计最多 128 次、已解码返回数据合计 8 MiB（UTF-8 / 二进制计数），覆盖分页及后续读取。超限返回 read_budget_exceeded，要求缩小查询范围或页大小；即使内部 handler 捕获异常，也不会将不完整结果作为成功返回。该预算不作用于修改、external、第三方 extension 和 App 会话入口，不在提交过程中截断写入读回。它限制的是插件后续工作，不能限制 Go 已缓冲的单次响应，也不覆盖独立统计落盘。现有各 action 的分页参数继续有效。

/health 提供 events、taskResults 和 readBudget 汇总，可查看连接数、缓存项数及字节数；不暴露任务 ID、认证值或正文。回滚前排空正在提交的写入，重载后重新发现能力和预检；终态缓存、SSE 连接和上传暂存均不会跨重载保留。

图片/模板预算、只读重试、分页及 Origin 配置见 [内核高级选项](kernel-options.md)。流式、拒绝覆盖保存器仅用于内核委托；Node 自行导出时，ZIP 可覆盖，文档提取清空输出根目录并跳过读取失败附件。
