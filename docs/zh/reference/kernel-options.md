# 内核插件能力与高级选项

内核端点复用思源服务，所有更改均在插件内实现。附件上传硬上限为 **10 MiB**。

## 配置

在思源 API 文件 `/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpHttpSettings` 内合并以下字段。必须保留已有认证、端口和开关字段；不要用示例覆盖整个文件。当前高级预算与 Origin 选项通过配置文件管理，设置面板会保留它们。

```json
{
  "skillsExtensionEnabled": true,
  "kernelOptions": {
    "readMaxRequests": 128,
    "readMaxMiB": 8,
    "readTimeoutMs": 30000,
    "readRetries": 3,
    "templateMaxMiB": 16,
    "allowedOrigins": []
  }
}
```

| 选项 | 范围 | 行为 |
|---|---|---|
| `readMaxRequests` | 16–512 | 单次普通只读调用的 API/存储读取次数，重试也计数 |
| `readMaxMiB` | 1–64 | 累计解码读取预算；图片 action 另加 20 MiB 二进制额度，图片自身仍限制 20 MiB |
| `readTimeoutMs` | 1,000–120,000 | 读取开始执行后的协作式期限，排队时间不计；宿主 I/O 返回后才检查，不能强制中止原生请求 |
| `readRetries` | 0–3 | 明确只读接口对网络故障、HTTP 429/5xx 的额外重试次数，退避 100/200/400ms；写接口及外部提交不重试 |
| `templateMaxMiB` | 1–32 | 模板 UTF-8 正文额度，默认 16 MiB；multipart 另预留 64 KiB，其他工作区写入使用 8 MiB multipart 预算 |
| `allowedOrigins` | 最多 32 项 | 精确 HTTP(S) Origin，例如 `https://client.example`，不能带路径、认证信息或通配符；默认仍允许同 Host 请求 |

变更在后续请求读取，不修改正在执行请求的预算。Skills 开关同时控制能力声明、SEP Skills 方法及对应文件资源；通用帮助资源仍保留。客户端应重新连接以更新协商结果。Origin 白名单仅控制插件自身校验，不绕过思源认证、宿主跨站校验或反向代理 CORS 配置。

## 大范围读取与取消

- `block.docs_info` 保持既有 `id/ids` 契约。超出内核预算时按输入顺序拆分 ID 列表，再逐批读取；参数和返回格式保持一致。
- Markdown 快照继续使用 `file.export_markdown_snapshot` 的 `limit/cursor`；数据库按对应 action 的 `page/pageSize` 读取。
- 超预算或超期返回 `complete=false` 与 `recovery`：能够安全给出的重试参数保持当前页或游标，不跳过失败页；无分页 action 返回缩小范围提示。不会自动改写 SQL，也不会把丢失结果标为完整。
- 取消和期限在每次读取及重试边界检查；原生 I/O 未返回时继续占用原槽位。进入提交阶段后的写入及读回不被中断，不因超时自动重做业务写入。
- `requestResource.text/json/arrayBuffer` 消费计入任务读取预算。预算仍发生在 Go 缓冲之后，无法保证宿主常量内存。

## 反馈、遥测与 App

内核通过思源已有 `/api/network/forwardProxy` 发送反馈和已启用的遥测，支持正文、请求头、状态码与超时，无需全局 `fetch` 或 `AbortController`。外部提交不自动重试，不跟随重定向；受思源代理权限、目标地址策略和响应上限约束。遥测默认关闭，失败不会阻止笔记调用；`/health.telemetry` 提供无正文、无目标 URL 的发送状态。

现代 discovery 和 legacy initialize 均声明 MCP App UI 扩展和 HTML MIME。跨客户端实际显示仍取决于客户端支持，声明成功不等于所有宿主已验收。

## 文件交付

CLI/Node 委托内核导出时使用独占流式保存器。ZIP/一次提取总量最多 512 MiB，单文件 120 秒，逐文件返回字节数和 SHA-256。目标文件或文档子目录已存在时拒绝；提取失败清理本次新建子目录，保留同级文件，附件读取失败会使导出失败。需要重复导出时请使用新的目标路径。失败不会自动续传；返回成功的文件摘要用于验证完整交付。未委托内核时，Node 自行执行：ZIP 可以覆盖目标，文档提取会清空输出根目录并跳过读取失败附件。

直连内核推荐 `delivery=download`：返回 Markdown/附件或 ZIP 下载清单，客户端通过认证的 `/api/file/getFile` 保存。内联附件累计最多 8 MiB，超出后返回下载指引。内核无法写用户电脑路径；stdio、独立 TLS 或连接另一实例仍需 Node 桥接/代理或分别连接目标实例。

## 验证与回退

验收环境、产物和覆盖范围见[内核端点说明](../../development/kernel-endpoint.md#验证结果)。可将 `readRetries` 设为 0、恢复默认预算、清空 `allowedOrigins`，或关闭内核入口回到既有 Node 部署；切换 owner 前先排空任务，结果未知的写入必须先核对原 requestId，不能换 owner 自动重发。重载会清空内存会话和结果缓存。

大模板仍需 JS SHA-256 严格校验，耗时可能超过客户端默认超时；应配置足够的客户端等待时间。若响应超时，先按原 requestId 查询/重放核对，不能当成未写入重新提交。UTF-8 编码复用宿主原生 Buffer，未跳过哈希或幂等校验。
