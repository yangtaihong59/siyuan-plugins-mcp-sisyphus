# SiYuan v3.8.0 生产网络 API 完整清单

> 本文档由 `npm run api:audit` 从固定源码基线全量生成，请勿手工编辑。漂移检查使用 `npm run api:audit:check`。

## 基线与统计口径

- 唯一真相源：`sample/siyuan` tag `v3.8.0`，commit `251596fc0de2f9528c00c224252fd073a99973f4`。
- 对照版本：`v3.7.3`，commit `eef10568384e2e7cf547adb029ae46a72e43c287`。
- `kernel/api/router.go`：**593** 条有效注册声明、**589** 个唯一路径、其中 **582** 个 `/api/*`。
- 官方 `docs/API.md` 可静态识别 **70** 个公开路径；其余路由标为内部 API。
- 插件 API wrapper 覆盖口径：**150** 个 API 字面量，**149** 个匹配当前内核，覆盖 `25.6%`；工具层直调另列。
- 同路径不同方法造成 4 条声明差；重复路径为 `/api/system/bootProgress`、`/api/system/version`、`/api/plugin/rpc`、`/api/plugin/rpc/:name`。
- 扫描排除注释、测试文件和文件名含 ` 2.` 的重复文件；动态参数保留 Gin 模板。任何未知 `ginServer.<注册方法>` 会使审计失败。

## 按 API family 汇总

| Family | 声明 | 唯一路径 | 官方公开 | Sisyphus 后端覆盖 |
|---|---:|---:|---:|---:|
| account | 5 | 5 | 0 | 0 |
| ai | 30 | 30 | 0 | 0 |
| archive | 2 | 2 | 0 | 0 |
| asset | 20 | 20 | 1 | 8 |
| attr | 6 | 6 | 2 | 2 |
| av | 45 | 45 | 16 | 18 |
| bazaar | 27 | 27 | 0 | 0 |
| block | 60 | 60 | 11 | 24 |
| bookmark | 3 | 3 | 0 | 0 |
| broadcast | 4 | 4 | 0 | 0 |
| clipboard | 4 | 4 | 0 | 0 |
| cloud | 2 | 2 | 0 | 0 |
| convert | 1 | 1 | 1 | 0 |
| export | 32 | 32 | 2 | 2 |
| extension | 1 | 1 | 0 | 0 |
| file | 9 | 9 | 5 | 2 |
| filetree | 35 | 35 | 12 | 22 |
| format | 3 | 3 | 0 | 0 |
| graph | 5 | 5 | 0 | 0 |
| history | 13 | 13 | 0 | 4 |
| icon | 1 | 1 | 0 | 0 |
| import | 12 | 12 | 0 | 0 |
| inbox | 3 | 3 | 0 | 0 |
| lute | 4 | 4 | 0 | 1 |
| network | 4 | 4 | 2 | 0 |
| notebook | 23 | 23 | 8 | 9 |
| notification | 2 | 2 | 2 | 2 |
| outline | 2 | 2 | 0 | 1 |
| petal | 2 | 2 | 0 | 0 |
| plugin | 7 | 5 | 0 | 0 |
| query | 1 | 1 | 1 | 1 |
| ref | 5 | 5 | 0 | 2 |
| repo | 26 | 26 | 0 | 8 |
| riff | 17 | 17 | 0 | 10 |
| search | 16 | 16 | 0 | 11 |
| setting | 27 | 27 | 0 | 0 |
| snippet | 3 | 3 | 0 | 0 |
| sqlite | 1 | 1 | 1 | 0 |
| storage | 19 | 19 | 0 | 0 |
| sync | 23 | 23 | 0 | 1 |
| system | 63 | 61 | 3 | 8 |
| tag | 3 | 3 | 0 | 3 |
| template | 3 | 3 | 2 | 3 |
| transactions | 5 | 5 | 1 | 1 |
| ui | 7 | 7 | 0 | 6 |

## v3.7.3 → v3.8.0 变化

路由表路径集合新增 **43**、移除 **1**、净增 **42**。这一数字只针对 `kernel/api/router.go`；其他生产网络端点另见后文。

### 新增 43 个路径

| 路径 | 权限 | 处理器 | 请求字段 | 响应概要 | 风险 | 来源 |
|---|---|---|---|---|---|---|
| `/api/ai/agent/browserCapabilityResult` | Auth+Admin+Readonly | `agentChatBrowserCapabilityResult` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:621` |
| `/api/ai/agent/setPermission` | Auth+Admin+Readonly | `setAgentSessionPermission` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:619` |
| `/api/ai/lsCapabilities` | Auth+Admin | `lsCapabilities` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:622` |
| `/api/ai/mcpEnvironmentVariables` | Auth+Admin | `mcpEnvironmentVariables` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:612` |
| `/api/av/createAttributeViewItemDocs` | Auth+Admin+Readonly | `createAttributeViewItemDocs` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:600` |
| `/api/av/getAttributeViewFieldViews` | Auth+Readonly | `getAttributeViewFieldViews` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:564` |
| `/api/av/getAttributeViewItemStatuses` | Auth+Admin+Readonly | `getAttributeViewItemStatuses` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:559` |
| `/api/av/getAttributeViewPasteRows` | Auth+Admin+Readonly | `getAttributeViewPasteRows` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:570` |
| `/api/av/getAttributeViewRelationCandidates` | Auth+Admin+Readonly | `getAttributeViewRelationCandidates` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:584` |
| `/api/av/getAttributeViewSearchTarget` | Auth+Readonly | `getAttributeViewSearchTarget` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:563` |
| `/api/bazaar/getBazaarPackage` | Auth | `getBazaarPackage` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 鉴权读取/计算 | `kernel/api/router.go:500` |
| `/api/bazaar/getInstalledPackageSize` | Auth | `getInstalledPackageSize` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 鉴权读取/计算 | `kernel/api/router.go:499` |
| `/api/bazaar/installLocalBazaarPackage` | Auth+Admin+Readonly | `installLocalBazaarPackage` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:504` |
| `/api/bazaar/updateBazaarPackage` | Auth+Admin+Readonly | `updateBazaarPackage` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:502` |
| `/api/block/getBlockBreadcrumbChildren` | Auth | `getBlockBreadcrumbChildren` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 鉴权读取/计算 | `kernel/api/router.go:253` |
| `/api/block/getDocBlocksOrders` | Auth | `getDocBlocksOrders` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 鉴权读取/计算 | `kernel/api/router.go:256` |
| `/api/block/getHeadingFoldTransaction` | Auth+Admin | `getHeadingFoldTransaction` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:289` |
| `/api/clipboard/cleanupRichText` | Auth+Admin | `cleanupRichText` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:363` |
| `/api/clipboard/prepareRichText` | Auth+Admin | `prepareRichText` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:362` |
| `/api/filetree/setSort` | Auth+Admin+Readonly | `setSort` | `notebookSorts[] {id,sort}`、`docSorts[] {id,sort}` | `{notebookIDs[], docIDs[]}` | 状态变更；受只读保护 | `kernel/api/router.go:160` |
| `/api/graph/setGraphConf` | Auth | `setGraphConf` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 鉴权读取/计算 | `kernel/api/router.go:474` |
| `/api/history/createAssetHistory` | Auth+Admin+Readonly | `createAssetHistory` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:205` |
| `/api/history/diffDocVersions` | Auth+Admin | `diffDocVersions` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:198` |
| `/api/outline/getDocHeadingNumbers` | Auth | `getDocHeadingNumbers` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 鉴权读取/计算 | `kernel/api/router.go:208` |
| `/api/repo/getRepoDocHistory` | Auth+Admin | `getRepoDocHistory` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:517` |
| `/api/setting/getPandocBin` | Auth+Admin | `getPandocBin` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:447` |
| `/api/setting/setEntryVisibility` | Auth+Admin+Readonly | `setEntryVisibility` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:452` |
| `/api/sync/getSyncLANStatus` | Auth+Admin | `getSyncLANStatus` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:334` |
| `/api/sync/setSyncLAN` | Auth+Admin+Readonly | `setSyncLAN` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:333` |
| `/api/system/addCustomEmoji` | Auth+Admin+Readonly | `addCustomEmoji` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:55` |
| `/api/system/getCustomFonts` | Auth | `getCustomFonts` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 鉴权读取/计算 | `kernel/api/router.go:82` |
| `/api/system/importCustomFont` | Auth+Admin+Readonly | `importCustomFont` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:83` |
| `/api/system/oidc/callback` | 公开 | `OIDCCallback` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 未鉴权流程；不得直接暴露给 AI | `kernel/api/router.go:45` |
| `/api/system/oidc/mobileCallback` | 公开 | `OIDCMobileCallback` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 未鉴权流程；不得直接暴露给 AI | `kernel/api/router.go:46` |
| `/api/system/oidc/poll` | 公开 | `OIDCPoll` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 未鉴权流程；不得直接暴露给 AI | `kernel/api/router.go:47` |
| `/api/system/oidc/start` | 公开 | `OIDCStart` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 未鉴权流程；不得直接暴露给 AI | `kernel/api/router.go:44` |
| `/api/system/oidc/validate` | Auth+Admin+Readonly | `OIDCValidateStart` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:59` |
| `/api/system/oidc/validateActivate` | Auth+Admin+Readonly | `OIDCValidateActivate` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:60` |
| `/api/system/oidc/validateCancel` | Auth+Admin | `OIDCValidateCancel` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 管理员级读取/计算或宿主操作 | `kernel/api/router.go:61` |
| `/api/system/oidc/validatePoll` | 公开 | `OIDCValidatePoll` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 未鉴权流程；不得直接暴露给 AI | `kernel/api/router.go:48` |
| `/api/system/removeCustomFont` | Auth+Admin+Readonly | `removeCustomFont` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:84` |
| `/api/system/setOIDC` | Auth+Admin+Readonly | `setOIDC` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:58` |
| `/api/system/setUpdateChannel` | Auth+Admin+Readonly | `setUpdateChannel` | 未知（内部 handler，未猜测） | 未知（内部 handler，未猜测） | 状态变更；受只读保护 | `kernel/api/router.go:70` |

### 移除 1 个路径

| 路径 | v3.7.3 处理器 | 替代/状态 |
|---|---|---|
| `/api/ai/agent/frontendToolResult` | `agentChatFrontendResult` | 由新的 Agent browser capability/permission 回调链替换；不再注册 |

### 既有路径权限变化（11）

| 方法 | 路径 | v3.7.3 | v3.8.0 |
|---|---|---|---|
| POST | `/api/asset/getMissingAssets` | Auth | Auth+Admin |
| POST | `/api/asset/getUnusedAssets` | Auth | Auth+Admin |
| POST | `/api/asset/resolveAssetPath` | Auth | Auth+Admin |
| POST | `/api/av/getAttributeViewKeysByID` | Auth | Auth+Readonly |
| POST | `/api/block/checkBlockRef` | Auth | Auth+Admin+Readonly |
| POST | `/api/file/getUniqueFilename` | Auth | Auth+Admin |
| POST | `/api/lute/spinBlockDOM` | Auth | Auth+Admin |
| POST | `/api/notebook/getEncryptedNotebookStatus` | Auth | Auth+Admin |
| POST | `/api/ref/refreshBacklink` | Auth | Auth+Admin+Readonly |
| POST | `/api/repo/rollbackRepoSnapshotFile` | Auth+Admin | Auth+Admin+Readonly |
| POST | `/api/storage/getOutlineStorage` | Auth | Auth+Admin |

另外，v3.8.0 在 `ServeAPI()` 开头全局加入 `boxLeaseMiddleware`；这是租约作用域变化，不重复计入单路径权限变化。

### 弃用接口（4）

| 路径 | 处理器 | 计划状态 |
|---|---|---|
| `/api/system/reloadUI` | `deprecated` | 源码标注 2026-12-01 后删除 |
| `/api/storage/setLocalStorage` | `deprecated` | 源码标注 2026-12-01 后删除 |
| `/api/attr/resetBlockAttrs` | `deprecated` | 源码标注 2026-12-01 后删除 |
| `/api/av/searchAttributeViewNonRelationKey` | `deprecated` | 源码标注 2026-12-01 后删除 |

## 生产启动链中的其他网络接口

这些接口从 `server.Serve()` 可达，但不计入上面的 593/589/582 内核 API 基线。

| 类型 | 方法 | 路径模板 | 鉴权/条件 | 处理器/说明 |
|---|---|---|---|---|
| MCP | GET, POST, DELETE | `/mcp` | Auth + Admin；POST/DELETE 另有 Readonly | Streamable HTTP；工具由运行时注册表投影 |
| 主 WebSocket | GET | `/ws` | 握手后执行会话鉴权 | 命令注册表当前为 `ping`、`closews` |
| 插件 HTTP/WS/SSE | ANY | `/plugin/private/:name/*path` | Auth + Admin + Readonly | 插件运行时动态 handler；SSE 由 Accept 头选择 |
| 插件 JSON-RPC | GET/POST/WS | `/api/plugin/rpc[/:name]`、`/ws/plugin/rpc[/:name]` | 见全量路由表 | 动态插件名 |
| WebDAV | OPTIONS, HEAD, GET, PROPFIND, REPORT（Cal/Card）, POST, PUT, DELETE, MKCOL, COPY, MOVE, LOCK/UNLOCK（仅 WebDAV）, PROPPATCH | `/webdav/*path` | Auth + Admin；只读模式禁止写方法 | 加密笔记本路径全部拒绝 |
| CalDAV | OPTIONS, HEAD, GET, PROPFIND, REPORT（Cal/Card）, POST, PUT, DELETE, MKCOL, COPY, MOVE, LOCK/UNLOCK（仅 WebDAV）, PROPPATCH | `/.well-known/caldav`、`/caldav/*path` | well-known 无组鉴权；主体 Auth + Admin | 只读模式禁止写方法 |
| CardDAV | OPTIONS, HEAD, GET, PROPFIND, REPORT（Cal/Card）, POST, PUT, DELETE, MKCOL, COPY, MOVE, LOCK/UNLOCK（仅 WebDAV）, PROPPATCH | `/.well-known/carddav`、`/carddav/*path` | well-known 无组鉴权；主体 Auth + Admin | 只读模式禁止写方法 |
| 上传/资产 | POST/GET | `/upload`、`/assets/*path` | Auth；上传另有 Admin + Readonly | 受控上传、缩略图、SVG 与加密资产读取 |
| 导出/历史/仓库差异 | GET | `/export/*filepath`、`/history/*path`、`/repo/diff/*path` | Auth + Admin | 受控临时资源端点 |
| 包资源 | GET, HEAD | `/widgets/*filepath`、`/plugins/*filepath`、`/emojis/*filepath`、`/templates/*filepath` | Auth；模板另有 Admin | 包级 symlink 与发布访问检查 |
| 其他资源 | GET/HEAD | `/public/*`、`/snippets/*filepath`、`/custom-fonts/:id`、`/appearance/*`、`/stage/*` | 各自鉴权/内容限制 | 静态页面和前端资源，不计业务 API |
| 调试 | GET | `/debug/pprof/*`（11 个固定路径） | 仅 `--enable-pprof`；Auth + Admin | 默认不注册 |

### 监听器（不重复计算被转发路由）

- 主监听器：`127.0.0.1:<ServerPort>`；NetworkServe 或 Docker 下为 `0.0.0.0`，可由同一 listener 多路复用 HTTP/HTTPS。
- 固定端口代理：配置端口与主端口不同时启动，反向代理到主 `ServerURL`。
- 发布端口代理：仅 Publish.Enable 时启动，注入 Reader JWT 后转发到主服务。

### 生产 Gin 注册调用点（源码扫描）

| 注册形式 | 路径表达式 | 来源 |
|---|---|---|
| `exportGroup.GET` | `"/*filepath"` | `kernel/server/serve.go:344` |
| `ginServer.Static` | `"/public/"` | `kernel/server/serve.go:473` |
| `ginServer.Handle` | `"/snippets/*filepath"` | `kernel/server/serve.go:477` |
| `group.GET` | `"/*filepath"` | `kernel/server/serve.go:540` |
| `group.HEAD` | `"/*filepath"` | `kernel/server/serve.go:541` |
| `ginServer.GET` | `"/custom-fonts/:id"` | `kernel/server/serve.go:615` |
| `siyuan.Handle` | `"/"` | `kernel/server/serve.go:640` |
| `siyuan.GET` | `"/appearance/*filepath"` | `kernel/server/serve.go:692` |
| `siyuan.Static` | `"/stage"` | `kernel/server/serve.go:755` |
| `ginServer.GET` | `"/check-auth"` | `kernel/server/serve.go:759` |
| `ginServer.POST` | `"/upload"` | `kernel/server/serve.go:924` |
| `ginServer.GET` | `"/assets/*path"` | `kernel/server/serve.go:926` |
| `ginServer.GET` | `"/history/*path"` | `kernel/server/serve.go:994` |
| `ginServer.GET` | `"/repo/diff/*path"` | `kernel/server/serve.go:1241` |
| `ginServer.GET` | `"/debug/pprof/"` | `kernel/server/serve.go:1277` |
| `ginServer.GET` | `"/debug/pprof/allocs"` | `kernel/server/serve.go:1278` |
| `ginServer.GET` | `"/debug/pprof/block"` | `kernel/server/serve.go:1279` |
| `ginServer.GET` | `"/debug/pprof/goroutine"` | `kernel/server/serve.go:1280` |
| `ginServer.GET` | `"/debug/pprof/heap"` | `kernel/server/serve.go:1281` |
| `ginServer.GET` | `"/debug/pprof/mutex"` | `kernel/server/serve.go:1282` |
| `ginServer.GET` | `"/debug/pprof/threadcreate"` | `kernel/server/serve.go:1283` |
| `ginServer.GET` | `"/debug/pprof/cmdline"` | `kernel/server/serve.go:1284` |
| `ginServer.GET` | `"/debug/pprof/profile"` | `kernel/server/serve.go:1285` |
| `ginServer.GET` | `"/debug/pprof/symbol"` | `kernel/server/serve.go:1286` |
| `ginServer.GET` | `"/debug/pprof/trace"` | `kernel/server/serve.go:1287` |
| `ginServer.GET` | `"/ws"` | `kernel/server/serve.go:1298` |
| `ginGroup.Match` | `"/*path"` | `kernel/server/serve.go:1566` |
| `ginServer.Match` | `"/.well-known/caldav"` | `kernel/server/serve.go:1593` |
| `ginGroup.Match` | `"/*path"` | `kernel/server/serve.go:1599` |
| `ginServer.Match` | `"/.well-known/carddav"` | `kernel/server/serve.go:1628` |
| `ginGroup.Match` | `"/*path"` | `kernel/server/serve.go:1634` |
| `ginServer.StaticFile` | `"favicon.ico"` | `kernel/server/serve.go:1736` |
| `ginServer.StaticFile` | `"manifest.json"` | `kernel/server/serve.go:1738` |
| `ginServer.StaticFile` | `"manifest.webmanifest"` | `kernel/server/serve.go:1739` |
| `ginServer.StaticFile` | `"service-worker.js"` | `kernel/server/serve.go:1741` |
| `ginServer.POST` | `"/mcp"` | `kernel/mcp/server.go:56` |
| `ginServer.GET` | `"/mcp"` | `kernel/mcp/server.go:57` |
| `ginServer.DELETE` | `"/mcp"` | `kernel/mcp/server.go:58` |

该表记录 server/MCP 层的原始注册调用点；Group/helper/Static 的路径组合在上方按实际语义归一。未知 receiver 方法会失败关闭。


## 全量路由总表

“发布模式”仅按 middleware 作保守判断：Admin/Readonly 路由不可由发布 Reader 角色调用；仅 Auth 的路由仍可能在 handler 内进行数据级发布访问检查。请求/响应 schema 若未公开则明确为“未知（内部）”。

| # | 方法 | 路径 | Family | 处理器 | Auth | Admin | Readonly | 发布模式 | 公开性 | 前端字面调用 | Sisyphus | 请求/响应概要 | 来源 |
|---:|---|---|---|---|:---:|:---:|:---:|---|---|:---:|---|---|---|
| 1 | GET | `/api/system/bootProgress` | system | `bootProgress` |  |  |  | 公开可达 | 官方公开 |  | api-wrapper:src/api/system.ts:24 | 见官方 API 文档 | `kernel/api/router.go:34` |
| 2 | POST | `/api/system/bootProgress` | system | `bootProgress` |  |  |  | 公开可达 | 官方公开 |  | api-wrapper:src/api/system.ts:24 | 见官方 API 文档 | `kernel/api/router.go:35` |
| 3 | GET | `/api/system/bootProgressSSE` | system | `bootProgressSSE` |  |  |  | 公开可达 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:36` |
| 4 | GET | `/api/system/version` | system | `version` |  |  |  | 公开可达 | 官方公开 |  | api-wrapper:src/api/system.ts:32<br>ui:src/ui/setting/mcp-config/EmbeddingPanel.svelte:74<br>ui:src/ui/setting/official-plugin-tools.ts:30<br>ui:src/ui/setting/official-plugin-tools.ts:42 | 见官方 API 文档 | `kernel/api/router.go:37` |
| 5 | POST | `/api/system/version` | system | `version` |  |  |  | 公开可达 | 官方公开 |  | api-wrapper:src/api/system.ts:32<br>ui:src/ui/setting/mcp-config/EmbeddingPanel.svelte:74<br>ui:src/ui/setting/official-plugin-tools.ts:30<br>ui:src/ui/setting/official-plugin-tools.ts:42 | 见官方 API 文档 | `kernel/api/router.go:38` |
| 6 | POST | `/api/system/currentTime` | system | `currentTime` |  |  |  | 公开可达 | 官方公开 |  | api-wrapper:src/api/system.ts:36 | 见官方 API 文档 | `kernel/api/router.go:39` |
| 7 | POST | `/api/system/uiproc` | system | `addUIProcess` |  |  |  | 公开可达 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:40` |
| 8 | POST | `/api/system/loginAuth` | system | `LoginAuth` |  |  |  | 公开可达 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:41` |
| 9 | POST | `/api/system/logoutAuth` | system | `LogoutAuth` |  |  |  | 公开可达 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:42` |
| 10 | GET | `/api/system/getCaptcha` | system | `GetCaptcha` |  |  |  | 公开可达 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:43` |
| 11 | POST | `/api/system/oidc/start` | system | `OIDCStart` |  |  |  | 公开可达 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:44` |
| 12 | GET | `/api/system/oidc/callback` | system | `OIDCCallback` |  |  |  | 公开可达 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:45` |
| 13 | POST | `/api/system/oidc/mobileCallback` | system | `OIDCMobileCallback` |  |  |  | 公开可达 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:46` |
| 14 | POST | `/api/system/oidc/poll` | system | `OIDCPoll` |  |  |  | 公开可达 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:47` |
| 15 | POST | `/api/system/oidc/validatePoll` | system | `OIDCValidatePoll` |  |  |  | 公开可达 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:48` |
| 16 | GET | `/api/ai/mcp/oauth/callback/:flowID` | ai | `mcpOAuthCallback` |  |  |  | 公开可达 | 动态/内部 |  | — | 未知（内部） | `kernel/api/router.go:49` |
| 17 | GET | `/api/icon/getDynamicIcon` | icon | `getDynamicIcon` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:52` |
| 18 | POST | `/api/system/getEmojiConf` | system | `getEmojiConf` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:54` |
| 19 | POST | `/api/system/addCustomEmoji` | system | `addCustomEmoji` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:55` |
| 20 | POST | `/api/system/setAPIToken` | system | `setAPIToken` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:56` |
| 21 | POST | `/api/system/setAccessAuthCode` | system | `setAccessAuthCode` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:57` |
| 22 | POST | `/api/system/setOIDC` | system | `setOIDC` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:58` |
| 23 | POST | `/api/system/oidc/validate` | system | `OIDCValidateStart` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:59` |
| 24 | POST | `/api/system/oidc/validateActivate` | system | `OIDCValidateActivate` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:60` |
| 25 | POST | `/api/system/oidc/validateCancel` | system | `OIDCValidateCancel` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:61` |
| 26 | POST | `/api/system/setFollowSystemLockScreen` | system | `setFollowSystemLockScreen` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:62` |
| 27 | POST | `/api/system/setNetworkServe` | system | `setNetworkServe` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:63` |
| 28 | POST | `/api/system/setNetworkServeTLS` | system | `setNetworkServeTLS` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:64` |
| 29 | POST | `/api/system/exportTLSCACert` | system | `exportTLSCACert` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:65` |
| 30 | POST | `/api/system/exportTLSCABundle` | system | `exportTLSCABundle` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:66` |
| 31 | POST | `/api/system/importTLSCABundle` | system | `importTLSCABundle` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:67` |
| 32 | POST | `/api/system/setAutoLaunch` | system | `setAutoLaunch` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:68` |
| 33 | POST | `/api/system/setDownloadInstallPkg` | system | `setDownloadInstallPkg` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:69` |
| 34 | POST | `/api/system/setUpdateChannel` | system | `setUpdateChannel` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:70` |
| 35 | POST | `/api/system/setNetworkProxy` | system | `setNetworkProxy` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:71` |
| 36 | POST | `/api/system/setWorkspaceDir` | system | `setWorkspaceDir` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:72` |
| 37 | POST | `/api/system/getWorkspaces` | system | `getWorkspaces` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:73` |
| 38 | POST | `/api/system/getMobileWorkspaces` | system | `getMobileWorkspaces` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:74` |
| 39 | POST | `/api/system/checkWorkspaceDir` | system | `checkWorkspaceDir` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:75` |
| 40 | POST | `/api/system/createWorkspaceDir` | system | `createWorkspaceDir` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:76` |
| 41 | POST | `/api/system/removeWorkspaceDir` | system | `removeWorkspaceDir` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:77` |
| 42 | POST | `/api/system/removeWorkspaceDirPhysically` | system | `removeWorkspaceDirPhysically` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:78` |
| 43 | POST | `/api/system/setAppearanceMode` | system | `setAppearanceMode` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:79` |
| 44 | POST | `/api/system/setUILayout` | system | `setUILayout` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:80` |
| 45 | POST | `/api/system/getSysFonts` | system | `getSysFonts` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/system.ts:20 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:81` |
| 46 | POST | `/api/system/getCustomFonts` | system | `getCustomFonts` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:82` |
| 47 | POST | `/api/system/importCustomFont` | system | `importCustomFont` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:83` |
| 48 | POST | `/api/system/removeCustomFont` | system | `removeCustomFont` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:84` |
| 49 | POST | `/api/system/exit` | system | `exit` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:85` |
| 50 | POST | `/api/system/getConf` | system | `getConf` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/system.ts:16<br>core:src/core/write-safety-coordinator.ts:678<br>ui:src/ui/setting/mcp-config/EmbeddingPanel.svelte:64<br>ui:src/ui/setting/mcp-config/EmbeddingPanel.svelte:110 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:86` |
| 51 | POST | `/api/system/ensureOnboarding` | system | `ensureOnboarding` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:87` |
| 52 | POST | `/api/system/dismissOnboarding` | system | `dismissOnboarding` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:88` |
| 53 | POST | `/api/system/checkUpdate` | system | `checkUpdate` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:89` |
| 54 | POST | `/api/system/exportLog` | system | `exportLog` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:90` |
| 55 | POST | `/api/system/getChangelog` | system | `getChangelog` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/system.ts:12 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:91` |
| 56 | POST | `/api/system/getNetwork` | system | `getNetwork` | ✓ | ✓ |  | 不可用 | 内部 |  | api-wrapper:src/api/system.ts:8 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:92` |
| 57 | POST | `/api/system/exportConf` | system | `exportConf` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:93` |
| 58 | POST | `/api/system/importConf` | system | `importConf` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:94` |
| 59 | POST | `/api/system/getWorkspaceInfo` | system | `getWorkspaceInfo` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/system.ts:4 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:95` |
| 60 | POST | `/api/system/reloadUI` | system | `deprecated` | ✓ | ✓ | ✓ | 不可用 | 内部/弃用 |  | — | 未知（内部） | `kernel/api/router.go:96` |
| 61 | POST | `/api/system/addMicrosoftDefenderExclusion` | system | `addMicrosoftDefenderExclusion` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:97` |
| 62 | POST | `/api/system/ignoreAddMicrosoftDefenderExclusion` | system | `ignoreAddMicrosoftDefenderExclusion` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:98` |
| 63 | POST | `/api/system/vacuumDataIndex` | system | `vacuumDataIndex` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:99` |
| 64 | POST | `/api/system/clearTempFiles` | system | `clearTempFiles` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:100` |
| 65 | POST | `/api/system/rebuildDataIndex` | system | `rebuildDataIndex` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:101` |
| 66 | POST | `/api/storage/getLocalStorage` | storage | `getLocalStorage` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:103` |
| 67 | POST | `/api/storage/getLocalStorageVal` | storage | `getLocalStorageVal` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:104` |
| 68 | POST | `/api/storage/getLocalStorageVals` | storage | `getLocalStorageVals` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:105` |
| 69 | POST | `/api/storage/setLocalStorage` | storage | `deprecated` | ✓ | ✓ | ✓ | 不可用 | 内部/弃用 |  | — | 未知（内部） | `kernel/api/router.go:106` |
| 70 | POST | `/api/storage/setLocalStorageVal` | storage | `setLocalStorageVal` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:107` |
| 71 | POST | `/api/storage/setLocalStorageVals` | storage | `setLocalStorageVals` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:108` |
| 72 | POST | `/api/storage/removeLocalStorageVal` | storage | `removeLocalStorageVal` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:109` |
| 73 | POST | `/api/storage/removeLocalStorageVals` | storage | `removeLocalStorageVals` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:110` |
| 74 | POST | `/api/storage/getCriteria` | storage | `getCriteria` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:111` |
| 75 | POST | `/api/storage/setCriterion` | storage | `setCriterion` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:112` |
| 76 | POST | `/api/storage/removeCriterion` | storage | `removeCriterion` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:113` |
| 77 | POST | `/api/storage/getRecentDocs` | storage | `getRecentDocs` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:114` |
| 78 | POST | `/api/storage/updateRecentDocOpenTime` | storage | `updateRecentDocOpenTime` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:115` |
| 79 | POST | `/api/storage/updateRecentDocViewTime` | storage | `updateRecentDocViewTime` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:116` |
| 80 | POST | `/api/storage/updateRecentDocCloseTime` | storage | `updateRecentDocCloseTime` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:117` |
| 81 | POST | `/api/storage/batchUpdateRecentDocCloseTime` | storage | `batchUpdateRecentDocCloseTime` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:118` |
| 82 | POST | `/api/storage/getOutlineStorage` | storage | `getOutlineStorage` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:119` |
| 83 | POST | `/api/storage/setOutlineStorage` | storage | `setOutlineStorage` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:120` |
| 84 | POST | `/api/storage/removeOutlineStorage` | storage | `removeOutlineStorage` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:121` |
| 85 | POST | `/api/account/login` | account | `login` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:123` |
| 86 | POST | `/api/account/checkActivationcode` | account | `checkActivationcode` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:124` |
| 87 | POST | `/api/account/useActivationcode` | account | `useActivationcode` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:125` |
| 88 | POST | `/api/account/deactivate` | account | `deactivateUser` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:126` |
| 89 | POST | `/api/account/startFreeTrial` | account | `startFreeTrial` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:127` |
| 90 | POST | `/api/notebook/lsNotebooks` | notebook | `lsNotebooks` | ✓ |  |  | 条件可用 | 官方公开 | ✓ | api-wrapper:src/api/notebook.ts:9<br>core:src/core/write-safety-coordinator.ts:453<br>core:src/core/write-safety-coordinator.ts:558<br>core:src/core/write-safety-coordinator.ts:764<br>core:src/core/write-safety-coordinator.ts:854<br>ui:src/ui/setting/mcp-config.svelte:145 | 见官方 API 文档 | `kernel/api/router.go:129` |
| 91 | POST | `/api/notebook/openNotebook` | notebook | `openNotebook` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/notebook.ts:16 | 见官方 API 文档 | `kernel/api/router.go:130` |
| 92 | POST | `/api/notebook/closeNotebook` | notebook | `closeNotebook` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/notebook.ts:23 | 见官方 API 文档 | `kernel/api/router.go:131` |
| 93 | POST | `/api/notebook/getNotebookConf` | notebook | `getNotebookConf` | ✓ |  |  | 条件可用 | 官方公开 | ✓ | api-wrapper:src/api/notebook.ts:51<br>core:src/core/write-safety-coordinator.ts:461<br>core:src/core/write-safety-coordinator.ts:566 | 见官方 API 文档 | `kernel/api/router.go:132` |
| 94 | POST | `/api/notebook/setNotebookConf` | notebook | `setNotebookConf` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/notebook.ts:58 | 见官方 API 文档 | `kernel/api/router.go:133` |
| 95 | POST | `/api/notebook/createNotebook` | notebook | `createNotebook` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/notebook.ts:30 | 见官方 API 文档 | `kernel/api/router.go:134` |
| 96 | POST | `/api/notebook/removeNotebook` | notebook | `removeNotebook` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/notebook.ts:37 | 见官方 API 文档 | `kernel/api/router.go:135` |
| 97 | POST | `/api/notebook/renameNotebook` | notebook | `renameNotebook` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/notebook.ts:44 | 见官方 API 文档 | `kernel/api/router.go:136` |
| 98 | POST | `/api/notebook/changeSortNotebook` | notebook | `changeSortNotebook` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:137` |
| 99 | POST | `/api/notebook/setNotebookIcon` | notebook | `setNotebookIcon` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/notebook.ts:65 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:138` |
| 100 | POST | `/api/notebook/getNotebookInfo` | notebook | `getNotebookInfo` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:139` |
| 101 | POST | `/api/notebook/enableEncryptedNotebooks` | notebook | `enableEncryptedNotebooks` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:140` |
| 102 | POST | `/api/notebook/disableEncryptedNotebooks` | notebook | `disableEncryptedNotebooks` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:141` |
| 103 | POST | `/api/notebook/createEncryptedNotebook` | notebook | `createEncryptedNotebook` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:142` |
| 104 | POST | `/api/notebook/unlockNotebook` | notebook | `unlockNotebook` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:143` |
| 105 | POST | `/api/notebook/lockNotebook` | notebook | `lockNotebook` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:144` |
| 106 | POST | `/api/notebook/unlockAndOpenNotebook` | notebook | `unlockAndOpenNotebook` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:145` |
| 107 | POST | `/api/notebook/changeMasterPassword` | notebook | `changeMasterPassword` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:146` |
| 108 | POST | `/api/notebook/getEncryptedNotebookStatus` | notebook | `getEncryptedNotebookStatus` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:147` |
| 109 | POST | `/api/notebook/exportNotebookCryptoBackup` | notebook | `exportNotebookCryptoBackup` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:148` |
| 110 | POST | `/api/notebook/importNotebookCryptoBackup` | notebook | `importNotebookCryptoBackup` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:149` |
| 111 | POST | `/api/notebook/setNotebookCryptoAutoLock` | notebook | `setNotebookCryptoAutoLock` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:150` |
| 112 | POST | `/api/notebook/touchEncryptedNotebooks` | notebook | `touchEncryptedNotebooks` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:151` |
| 113 | POST | `/api/filetree/searchDocs` | filetree | `searchDocs` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:214 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:153` |
| 114 | POST | `/api/filetree/listDocsByPath` | filetree | `listDocsByPath` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:184 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:154` |
| 115 | POST | `/api/filetree/getDoc` | filetree | `getDoc` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:227 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:155` |
| 116 | POST | `/api/filetree/getDocCreateSavePath` | filetree | `getDocCreateSavePath` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:156` |
| 117 | POST | `/api/filetree/getRefCreateSavePath` | filetree | `getRefCreateSavePath` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:157` |
| 118 | POST | `/api/filetree/getShorthandSavePath` | filetree | `getShorthandSavePath` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:158` |
| 119 | POST | `/api/filetree/changeSort` | filetree | `changeSort` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:197 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:159` |
| 120 | POST | `/api/filetree/setSort` | filetree | `setSort` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | — | 见官方 API 文档 | `kernel/api/router.go:160` |
| 121 | POST | `/api/filetree/createDocWithMd` | filetree | `createDocWithMd` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/document.ts:30 | 见官方 API 文档 | `kernel/api/router.go:161` |
| 122 | POST | `/api/filetree/createDailyNote` | filetree | `createDailyNote` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:252 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:162` |
| 123 | POST | `/api/filetree/createDoc` | filetree | `createDoc` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:280 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:163` |
| 124 | POST | `/api/filetree/renameDoc` | filetree | `renameDoc` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/document.ts:46 | 见官方 API 文档 | `kernel/api/router.go:164` |
| 125 | POST | `/api/filetree/renameDocByID` | filetree | `renameDocByID` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/document.ts:61 | 见官方 API 文档 | `kernel/api/router.go:165` |
| 126 | POST | `/api/filetree/removeDoc` | filetree | `removeDoc` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/document.ts:75 | 见官方 API 文档 | `kernel/api/router.go:166` |
| 127 | POST | `/api/filetree/removeDocByID` | filetree | `removeDocByID` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/document.ts:88 | 见官方 API 文档 | `kernel/api/router.go:167` |
| 128 | POST | `/api/filetree/removeDocs` | filetree | `removeDocs` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:269 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:168` |
| 129 | POST | `/api/filetree/moveDocs` | filetree | `moveDocs` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/document.ts:102 | 见官方 API 文档 | `kernel/api/router.go:169` |
| 130 | POST | `/api/filetree/moveDocsByID` | filetree | `moveDocsByID` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/document.ts:117 | 见官方 API 文档 | `kernel/api/router.go:170` |
| 131 | POST | `/api/filetree/duplicateDoc` | filetree | `duplicateDoc` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:262 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:171` |
| 132 | POST | `/api/filetree/getHPathByPath` | filetree | `getHPathByPath` | ✓ |  |  | 条件可用 | 官方公开 | ✓ | api-wrapper:src/api/document.ts:131 | 见官方 API 文档 | `kernel/api/router.go:172` |
| 133 | POST | `/api/filetree/getHPathsByPaths` | filetree | `getHPathsByPaths` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:173` |
| 134 | POST | `/api/filetree/getHPathByID` | filetree | `getHPathByID` | ✓ |  |  | 条件可用 | 官方公开 | ✓ | api-wrapper:src/api/document.ts:144 | 见官方 API 文档 | `kernel/api/router.go:174` |
| 135 | POST | `/api/filetree/getPathByID` | filetree | `getPathByID` | ✓ |  |  | 条件可用 | 官方公开 | ✓ | api-wrapper:src/api/document.ts:156<br>core:src/core/write-safety-coordinator.ts:772 | 见官方 API 文档 | `kernel/api/router.go:175` |
| 136 | POST | `/api/filetree/getFullHPathByID` | filetree | `getFullHPathByID` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:176` |
| 137 | POST | `/api/filetree/getIDsByHPath` | filetree | `getIDsByHPath` | ✓ |  |  | 条件可用 | 官方公开 | ✓ | api-wrapper:src/api/document.ts:169<br>core:src/core/write-safety-coordinator.ts:868 | 见官方 API 文档 | `kernel/api/router.go:177` |
| 138 | POST | `/api/filetree/doc2Heading` | filetree | `doc2Heading` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:304 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:178` |
| 139 | POST | `/api/filetree/heading2Doc` | filetree | `heading2Doc` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:290 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:179` |
| 140 | POST | `/api/filetree/li2Doc` | filetree | `li2Doc` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:180` |
| 141 | POST | `/api/filetree/upsertIndexes` | filetree | `upsertIndexes` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:181` |
| 142 | POST | `/api/filetree/removeIndexes` | filetree | `removeIndexes` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:182` |
| 143 | POST | `/api/filetree/listDocTree` | filetree | `listDocTree` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/document.ts:205 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:183` |
| 144 | POST | `/api/filetree/moveLocalShorthands` | filetree | `moveLocalShorthands` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:184` |
| 145 | POST | `/api/filetree/setPublishAccess` | filetree | `setPublishAccess` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:185` |
| 146 | POST | `/api/filetree/getPublishAccess` | filetree | `getPublishAccess` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:186` |
| 147 | POST | `/api/filetree/authFilePublishAccess` | filetree | `authFilePublishAccess` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:187` |
| 148 | POST | `/api/format/autoSpace` | format | `autoSpace` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:189` |
| 149 | POST | `/api/format/netImg2LocalAssets` | format | `netImg2LocalAssets` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:190` |
| 150 | POST | `/api/format/netAssets2LocalAssets` | format | `netAssets2LocalAssets` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:191` |
| 151 | POST | `/api/history/rollbackAttributeViewHistory` | history | `rollbackAttributeViewHistory` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:193` |
| 152 | POST | `/api/history/getNotebookHistory` | history | `getNotebookHistory` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:194` |
| 153 | POST | `/api/history/rollbackNotebookHistory` | history | `rollbackNotebookHistory` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:195` |
| 154 | POST | `/api/history/rollbackAssetsHistory` | history | `rollbackAssetsHistory` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:196` |
| 155 | POST | `/api/history/getDocHistoryContent` | history | `getDocHistoryContent` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/history.ts:52 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:197` |
| 156 | POST | `/api/history/diffDocVersions` | history | `diffDocVersions` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:198` |
| 157 | POST | `/api/history/rollbackDocHistory` | history | `rollbackDocHistory` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/history.ts:64 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:199` |
| 158 | POST | `/api/history/clearWorkspaceHistory` | history | `clearWorkspaceHistory` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:200` |
| 159 | POST | `/api/history/reindexHistory` | history | `reindexHistory` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:201` |
| 160 | POST | `/api/history/searchHistory` | history | `searchHistory` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/history.ts:31 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:202` |
| 161 | POST | `/api/history/getHistoryItems` | history | `getHistoryItems` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/history.ts:43 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:203` |
| 162 | POST | `/api/history/createDocHistory` | history | `createDocHistory` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:204` |
| 163 | POST | `/api/history/createAssetHistory` | history | `createAssetHistory` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:205` |
| 164 | POST | `/api/outline/getDocOutline` | outline | `getDocOutline` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/document.ts:240 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:207` |
| 165 | POST | `/api/outline/getDocHeadingNumbers` | outline | `getDocHeadingNumbers` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:208` |
| 166 | POST | `/api/bookmark/getBookmark` | bookmark | `getBookmark` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:210` |
| 167 | POST | `/api/bookmark/renameBookmark` | bookmark | `renameBookmark` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:211` |
| 168 | POST | `/api/bookmark/removeBookmark` | bookmark | `removeBookmark` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:212` |
| 169 | POST | `/api/tag/getTag` | tag | `getTag` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/tag.ts:8 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:214` |
| 170 | POST | `/api/tag/renameTag` | tag | `renameTag` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/tag.ts:12 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:215` |
| 171 | POST | `/api/tag/removeTag` | tag | `removeTag` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/tag.ts:16 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:216` |
| 172 | POST | `/api/lute/spinBlockDOM` | lute | `spinBlockDOM` | ✓ | ✓ |  | 不可用 | 内部 |  | api-wrapper:src/api/av.ts:193 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:218` |
| 173 | POST | `/api/lute/html2BlockDOM` | lute | `html2BlockDOM` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:219` |
| 174 | POST | `/api/lute/copyStdMarkdown` | lute | `copyStdMarkdown` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:220` |
| 175 | POST | `/api/lute/md2html` | lute | `md2HTML` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:221` |
| 176 | POST | `/api/query/sql` | query | `SQL` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/search.ts:31<br>core:src/core/write-safety-coordinator.ts:879<br>core:src/core/write-safety-coordinator.ts:959<br>tool-direct:src/tools/block/handlers.ts:64 | 见官方 API 文档 | `kernel/api/router.go:223` |
| 177 | POST | `/api/sqlite/flushTransaction` | sqlite | `flushTransaction` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | — | 见官方 API 文档 | `kernel/api/router.go:224` |
| 178 | POST | `/api/search/searchTag` | search | `searchTag` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:37 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:226` |
| 179 | POST | `/api/search/searchTemplate` | search | `searchTemplate` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/template.ts:154 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:227` |
| 180 | POST | `/api/search/removeTemplate` | search | `removeTemplate` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/template.ts:245 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:228` |
| 181 | POST | `/api/search/searchWidget` | search | `searchWidget` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:229` |
| 182 | POST | `/api/search/searchRefBlock` | search | `searchRefBlock` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:72 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:230` |
| 183 | POST | `/api/search/searchEmbedBlock` | search | `searchEmbedBlock` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:231` |
| 184 | POST | `/api/search/getEmbedBlock` | search | `getEmbedBlock` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:232` |
| 185 | POST | `/api/search/updateEmbedBlock` | search | `updateEmbedBlock` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:233` |
| 186 | POST | `/api/search/fullTextSearchBlock` | search | `fullTextSearchBlock` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:19 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:234` |
| 187 | POST | `/api/search/searchAsset` | search | `searchAsset` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:105 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:235` |
| 188 | POST | `/api/search/findReplace` | search | `findReplace` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:97 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:236` |
| 189 | POST | `/api/search/fullTextSearchAssetContent` | search | `fullTextSearchAssetContent` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:128 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:237` |
| 190 | POST | `/api/search/getAssetContent` | search | `getAssetContent` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:114 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:238` |
| 191 | POST | `/api/search/getAssetContentByPath` | search | `getAssetContentByPath` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:239` |
| 192 | POST | `/api/search/listInvalidBlockRefs` | search | `listInvalidBlockRefs` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:136 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:240` |
| 193 | POST | `/api/search/semanticSearchBlock` | search | `semanticSearchBlock` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:26 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:241` |
| 194 | POST | `/api/block/getBlockInfo` | block | `getBlockInfo` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/block.ts:194<br>core:src/core/write-safety-coordinator.ts:594<br>core:src/core/write-safety-coordinator.ts:937<br>tool-direct:src/tools/search/handlers.ts:230 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:243` |
| 195 | POST | `/api/block/getBlockDOM` | block | `getBlockDOM` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/block.ts:206<br>core:src/core/write-safety-coordinator.ts:593<br>core:src/core/write-safety-coordinator.ts:1599 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:244` |
| 196 | POST | `/api/block/getBlockDOMs` | block | `getBlockDOMs` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:245` |
| 197 | POST | `/api/block/getBlockDOMWithEmbed` | block | `getBlockDOMWithEmbed` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:246` |
| 198 | POST | `/api/block/getBlockDOMsWithEmbed` | block | `getBlockDOMsWithEmbed` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:247` |
| 199 | POST | `/api/block/getBlockKramdown` | block | `getBlockKramdown` | ✓ |  |  | 条件可用 | 官方公开 |  | api-wrapper:src/api/block.ts:142<br>core:src/core/write-safety-coordinator.ts:939<br>core:src/core/write-safety-coordinator.ts:1054 | 见官方 API 文档 | `kernel/api/router.go:248` |
| 200 | POST | `/api/block/getBlockKramdowns` | block | `getBlockKramdowns` | ✓ |  |  | 条件可用 | 内部 |  | api-wrapper:src/api/block.ts:153 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:249` |
| 201 | POST | `/api/block/getChildBlocks` | block | `getChildBlocks` | ✓ | ✓ |  | 不可用 | 官方公开 |  | api-wrapper:src/api/block.ts:161<br>core:src/core/write-safety-coordinator.ts:940 | 见官方 API 文档 | `kernel/api/router.go:250` |
| 202 | POST | `/api/block/getTailChildBlocks` | block | `getTailChildBlocks` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:251` |
| 203 | POST | `/api/block/getBlockBreadcrumb` | block | `getBlockBreadcrumb` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/block.ts:202 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:252` |
| 204 | POST | `/api/block/getBlockBreadcrumbChildren` | block | `getBlockBreadcrumbChildren` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:253` |
| 205 | POST | `/api/block/getBlockIndex` | block | `getBlockIndex` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:254` |
| 206 | POST | `/api/block/getBlocksIndexes` | block | `getBlocksIndexes` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:255` |
| 207 | POST | `/api/block/getDocBlocksOrders` | block | `getDocBlocksOrders` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:256` |
| 208 | POST | `/api/block/getRefIDs` | block | `getRefIDs` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:257` |
| 209 | POST | `/api/block/getRefIDsByFileAnnotationID` | block | `getRefIDsByFileAnnotationID` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:258` |
| 210 | POST | `/api/block/getBlockDefIDsByRefText` | block | `getBlockDefIDsByRefText` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:259` |
| 211 | POST | `/api/block/getRefText` | block | `getRefText` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:260` |
| 212 | POST | `/api/block/getDOMText` | block | `getDOMText` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:261` |
| 213 | POST | `/api/block/getTreeStat` | block | `getTreeStat` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:262` |
| 214 | POST | `/api/block/getBlocksWordCount` | block | `getBlocksWordCount` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/block.ts:214 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:263` |
| 215 | POST | `/api/block/getContentWordCount` | block | `getContentWordCount` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:264` |
| 216 | POST | `/api/block/getRecentUpdatedBlocks` | block | `getRecentUpdatedBlocks` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/block.ts:210 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:265` |
| 217 | POST | `/api/block/getDocInfo` | block | `getDocInfo` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/block.ts:169<br>ui:src/ui/version-control/SnapshotPanel.svelte:385<br>ui:src/ui/version-control/VersionDiffPanel.svelte:704 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:266` |
| 218 | POST | `/api/block/getDocsInfo` | block | `getDocsInfo` | ✓ |  |  | 条件可用 | 内部 |  | api-wrapper:src/api/block.ts:265 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:267` |
| 219 | POST | `/api/block/checkBlockExist` | block | `checkBlockExist` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/block.ts:190<br>core:src/core/write-safety-coordinator.ts:926 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:268` |
| 220 | POST | `/api/block/checkBlocksExist` | block | `checkBlocksExist` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:269` |
| 221 | POST | `/api/block/getUnfoldedParentID` | block | `getUnfoldedParentID` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:270` |
| 222 | POST | `/api/block/checkBlockFold` | block | `checkBlockFold` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:271` |
| 223 | POST | `/api/block/insertBlock` | block | `insertBlock` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/block.ts:42<br>ui:src/ui/version-control/VersionDiffPanel.svelte:837 | 见官方 API 文档 | `kernel/api/router.go:272` |
| 224 | POST | `/api/block/batchInsertBlock` | block | `batchInsertBlock` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/block.ts:227 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:273` |
| 225 | POST | `/api/block/prependBlock` | block | `prependBlock` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/block.ts:59 | 见官方 API 文档 | `kernel/api/router.go:274` |
| 226 | POST | `/api/block/batchPrependBlock` | block | `batchPrependBlock` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:275` |
| 227 | POST | `/api/block/appendBlock` | block | `appendBlock` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/block.ts:76 | 见官方 API 文档 | `kernel/api/router.go:276` |
| 228 | POST | `/api/block/batchAppendBlock` | block | `batchAppendBlock` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:277` |
| 229 | POST | `/api/block/appendDailyNoteBlock` | block | `appendDailyNoteBlock` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/block.ts:247 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:278` |
| 230 | POST | `/api/block/prependDailyNoteBlock` | block | `prependDailyNoteBlock` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/block.ts:256 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:279` |
| 231 | POST | `/api/block/updateBlock` | block | `updateBlock` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/block.ts:93<br>ui:src/ui/version-control/VersionDiffPanel.svelte:817 | 见官方 API 文档 | `kernel/api/router.go:280` |
| 232 | POST | `/api/block/batchUpdateBlock` | block | `batchUpdateBlock` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/block.ts:238 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:281` |
| 233 | POST | `/api/block/deleteBlock` | block | `deleteBlock` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/block.ts:101<br>ui:src/ui/version-control/VersionDiffPanel.svelte:823 | 见官方 API 文档 | `kernel/api/router.go:282` |
| 234 | POST | `/api/block/moveBlock` | block | `moveBlock` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/block.ts:118 | 见官方 API 文档 | `kernel/api/router.go:283` |
| 235 | POST | `/api/block/moveOutlineHeading` | block | `moveOutlineHeading` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:284` |
| 236 | POST | `/api/block/foldBlock` | block | `foldBlock` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/block.ts:126 | 见官方 API 文档 | `kernel/api/router.go:285` |
| 237 | POST | `/api/block/unfoldBlock` | block | `unfoldBlock` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/block.ts:134 | 见官方 API 文档 | `kernel/api/router.go:286` |
| 238 | POST | `/api/block/setBlockReminder` | block | `setBlockReminder` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:287` |
| 239 | POST | `/api/block/getHeadingLevelTransaction` | block | `getHeadingLevelTransaction` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:288` |
| 240 | POST | `/api/block/getHeadingFoldTransaction` | block | `getHeadingFoldTransaction` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:289` |
| 241 | POST | `/api/block/getHeadingDeleteTransaction` | block | `getHeadingDeleteTransaction` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:290` |
| 242 | POST | `/api/block/getHeadingInsertTransaction` | block | `getHeadingInsertTransaction` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:291` |
| 243 | POST | `/api/block/getHeadingChildrenIDs` | block | `getHeadingChildrenIDs` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:292` |
| 244 | POST | `/api/block/getHeadingChildrenDOM` | block | `getHeadingChildrenDOM` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:293` |
| 245 | POST | `/api/block/swapBlockRef` | block | `swapBlockRef` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:294` |
| 246 | POST | `/api/block/transferBlockRef` | block | `transferBlockRef` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/block.ts:186 | 见官方 API 文档 | `kernel/api/router.go:295` |
| 247 | POST | `/api/block/getBlockSiblingID` | block | `getBlockSiblingID` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:296` |
| 248 | POST | `/api/block/getBlockRelevantIDs` | block | `getBlockRelevantIDs` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:297` |
| 249 | POST | `/api/block/getBlockTreeInfos` | block | `getBlockTreeInfos` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:298` |
| 250 | POST | `/api/block/checkBlockRef` | block | `checkBlockRef` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:299` |
| 251 | POST | `/api/block/appendHeadingChildren` | block | `appendHeadingChildren` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:300` |
| 252 | POST | `/api/block/updateTaskListItemMarker` | block | `updateTaskListItemMarker` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:301` |
| 253 | POST | `/api/block/batchUpdateTaskListItemMarker` | block | `batchUpdateTaskListItemMarker` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:302` |
| 254 | POST | `/api/file/getFile` | file | `getFile` | ✓ |  |  | 条件可用 | 官方公开 | ✓ | api-wrapper:src/api/client.ts:112<br>ui:src/ui/components/ToolPuppy.svelte:24<br>ui:src/ui/setting/mcp-config/TelemetryPanel.svelte:109<br>ui:src/ui/setting/mcp-config/TelemetryPanel.svelte:170<br>ui:src/ui/setting/mcp-config/TelemetryPanel.svelte:205 | 见官方 API 文档 | `kernel/api/router.go:304` |
| 255 | POST | `/api/file/putFile` | file | `putFile` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/client.ts:160<br>core:src/core/help.ts:101<br>ui:src/ui/setting/mcp-config/TelemetryPanel.svelte:153 | 见官方 API 文档 | `kernel/api/router.go:305` |
| 256 | POST | `/api/file/copyFile` | file | `copyFile` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:306` |
| 257 | POST | `/api/file/globalCopyFiles` | file | `globalCopyFiles` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:307` |
| 258 | POST | `/api/file/workspaceCopyFiles` | file | `workspaceCopyFiles` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:308` |
| 259 | POST | `/api/file/removeFile` | file | `removeFile` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | — | 见官方 API 文档 | `kernel/api/router.go:309` |
| 260 | POST | `/api/file/renameFile` | file | `renameFile` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | — | 见官方 API 文档 | `kernel/api/router.go:310` |
| 261 | POST | `/api/file/readDir` | file | `readDir` | ✓ | ✓ |  | 不可用 | 官方公开 |  | — | 见官方 API 文档 | `kernel/api/router.go:311` |
| 262 | POST | `/api/file/getUniqueFilename` | file | `getUniqueFilename` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:312` |
| 263 | POST | `/api/ref/refreshBacklink` | ref | `refreshBacklink` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:314` |
| 264 | POST | `/api/ref/getBacklink` | ref | `getBacklink` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:315` |
| 265 | POST | `/api/ref/getBacklink2` | ref | `getBacklink2` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:316` |
| 266 | POST | `/api/ref/getBacklinkDoc` | ref | `getBacklinkDoc` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:47 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:317` |
| 267 | POST | `/api/ref/getBackmentionDoc` | ref | `getBackmentionDoc` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/search.ts:57 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:318` |
| 268 | POST | `/api/attr/getBookmarkLabels` | attr | `getBookmarkLabels` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:320` |
| 269 | POST | `/api/attr/resetBlockAttrs` | attr | `deprecated` | ✓ | ✓ | ✓ | 不可用 | 内部/弃用 |  | — | 未知（内部） | `kernel/api/router.go:321` |
| 270 | POST | `/api/attr/setBlockAttrs` | attr | `setBlockAttrs` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/block.ts:291<br>ui:src/ui/version-control/SnapshotPanel.svelte:176 | 见官方 API 文档 | `kernel/api/router.go:322` |
| 271 | POST | `/api/attr/batchSetBlockAttrs` | attr | `batchSetBlockAttrs` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:323` |
| 272 | POST | `/api/attr/getBlockAttrs` | attr | `getBlockAttrs` | ✓ |  |  | 条件可用 | 官方公开 | ✓ | api-wrapper:src/api/block.ts:299<br>core:src/core/write-safety-coordinator.ts:592<br>core:src/core/write-safety-coordinator.ts:938<br>ui:src/ui/version-control/SnapshotPanel.svelte:166 | 见官方 API 文档 | `kernel/api/router.go:324` |
| 273 | POST | `/api/attr/batchGetBlockAttrs` | attr | `batchGetBlockAttrs` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:325` |
| 274 | POST | `/api/cloud/getCloudSpace` | cloud | `getCloudSpace` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:327` |
| 275 | POST | `/api/cloud/setCloudReminder` | cloud | `setCloudReminder` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:328` |
| 276 | POST | `/api/sync/setSyncEnable` | sync | `setSyncEnable` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:330` |
| 277 | POST | `/api/sync/setSyncInterval` | sync | `setSyncInterval` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:331` |
| 278 | POST | `/api/sync/setSyncPerception` | sync | `setSyncPerception` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:332` |
| 279 | POST | `/api/sync/setSyncLAN` | sync | `setSyncLAN` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:333` |
| 280 | POST | `/api/sync/getSyncLANStatus` | sync | `getSyncLANStatus` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:334` |
| 281 | POST | `/api/sync/setSyncGenerateConflictDoc` | sync | `setSyncGenerateConflictDoc` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:335` |
| 282 | POST | `/api/sync/setSyncMode` | sync | `setSyncMode` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:336` |
| 283 | POST | `/api/sync/setSyncProvider` | sync | `setSyncProvider` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:337` |
| 284 | POST | `/api/sync/setSyncProviderS3` | sync | `setSyncProviderS3` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:338` |
| 285 | POST | `/api/sync/setSyncProviderWebDAV` | sync | `setSyncProviderWebDAV` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:339` |
| 286 | POST | `/api/sync/setSyncProviderLocal` | sync | `setSyncProviderLocal` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:340` |
| 287 | POST | `/api/sync/setCloudSyncDir` | sync | `setCloudSyncDir` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:341` |
| 288 | POST | `/api/sync/createCloudSyncDir` | sync | `createCloudSyncDir` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:342` |
| 289 | POST | `/api/sync/removeCloudSyncDir` | sync | `removeCloudSyncDir` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:343` |
| 290 | POST | `/api/sync/listCloudSyncDir` | sync | `listCloudSyncDir` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:344` |
| 291 | POST | `/api/sync/performSync` | sync | `performSync` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/system.ts:28<br>core:src/core/help.ts:321 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:345` |
| 292 | POST | `/api/sync/performBootSync` | sync | `performBootSync` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:346` |
| 293 | POST | `/api/sync/getBootSync` | sync | `getBootSync` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:347` |
| 294 | POST | `/api/sync/getSyncInfo` | sync | `getSyncInfo` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:348` |
| 295 | POST | `/api/sync/exportSyncProviderS3` | sync | `exportSyncProviderS3` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:349` |
| 296 | POST | `/api/sync/importSyncProviderS3` | sync | `importSyncProviderS3` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:350` |
| 297 | POST | `/api/sync/exportSyncProviderWebDAV` | sync | `exportSyncProviderWebDAV` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:351` |
| 298 | POST | `/api/sync/importSyncProviderWebDAV` | sync | `importSyncProviderWebDAV` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:352` |
| 299 | POST | `/api/inbox/getShorthands` | inbox | `getShorthands` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:354` |
| 300 | POST | `/api/inbox/getShorthand` | inbox | `getShorthand` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:355` |
| 301 | POST | `/api/inbox/removeShorthands` | inbox | `removeShorthands` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:356` |
| 302 | POST | `/api/extension/copy` | extension | `extensionCopy` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:358` |
| 303 | POST | `/api/clipboard/readFilePaths` | clipboard | `readFilePaths` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:360` |
| 304 | POST | `/api/clipboard/writeFilePath` | clipboard | `writeFilePath` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:361` |
| 305 | POST | `/api/clipboard/prepareRichText` | clipboard | `prepareRichText` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:362` |
| 306 | POST | `/api/clipboard/cleanupRichText` | clipboard | `cleanupRichText` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:363` |
| 307 | POST | `/api/asset/uploadCloud` | asset | `uploadCloud` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:365` |
| 308 | POST | `/api/asset/uploadCloudByAssetsPaths` | asset | `uploadCloudByAssetsPaths` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:366` |
| 309 | POST | `/api/asset/insertLocalAssets` | asset | `insertLocalAssets` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:367` |
| 310 | POST | `/api/asset/insertCover` | asset | `insertCover` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:368` |
| 311 | POST | `/api/asset/resolveAssetPath` | asset | `resolveAssetPath` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:369` |
| 312 | POST | `/api/asset/upload` | asset | `Upload` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/file.ts:22 | 见官方 API 文档 | `kernel/api/router.go:370` |
| 313 | POST | `/api/asset/setFileAnnotation` | asset | `setFileAnnotation` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:371` |
| 314 | POST | `/api/asset/getFileAnnotation` | asset | `getFileAnnotation` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:372` |
| 315 | POST | `/api/asset/getUnusedAssets` | asset | `getUnusedAssets` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/file.ts:54<br>core:src/core/write-safety-coordinator.ts:816 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:373` |
| 316 | POST | `/api/asset/getMissingAssets` | asset | `getMissingAssets` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:374` |
| 317 | POST | `/api/asset/removeUnusedAsset` | asset | `removeUnusedAsset` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/file.ts:85 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:375` |
| 318 | POST | `/api/asset/removeUnusedAssets` | asset | `removeUnusedAssets` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/file.ts:70 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:376` |
| 319 | POST | `/api/asset/getDocImageAssets` | asset | `getDocImageAssets` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/file.ts:62 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:377` |
| 320 | POST | `/api/asset/getDocAssets` | asset | `getDocAssets` | ✓ |  |  | 条件可用 | 内部 |  | api-wrapper:src/api/file.ts:58 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:378` |
| 321 | POST | `/api/asset/renameAsset` | asset | `renameAsset` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/file.ts:78 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:379` |
| 322 | POST | `/api/asset/getImageOCRText` | asset | `getImageOCRText` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/file.ts:66 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:380` |
| 323 | POST | `/api/asset/setImageOCRText` | asset | `setImageOCRText` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:381` |
| 324 | POST | `/api/asset/ocr` | asset | `ocr` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:382` |
| 325 | POST | `/api/asset/fullReindexAssetContent` | asset | `fullReindexAssetContent` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:383` |
| 326 | POST | `/api/asset/statAsset` | asset | `statAsset` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:384` |
| 327 | POST | `/api/export/exportNotebookMd` | export | `exportNotebookMd` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:386` |
| 328 | POST | `/api/export/exportMds` | export | `exportMds` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:387` |
| 329 | POST | `/api/export/exportMd` | export | `exportMd` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:388` |
| 330 | POST | `/api/export/exportSYs` | export | `exportSYs` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:389` |
| 331 | POST | `/api/export/exportSY` | export | `exportSY` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:390` |
| 332 | POST | `/api/export/exportNotebookSY` | export | `exportNotebookSY` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:391` |
| 333 | POST | `/api/export/exportMdContent` | export | `exportMdContent` | ✓ | ✓ |  | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/file.ts:35<br>core:src/core/help.ts:24 | 见官方 API 文档 | `kernel/api/router.go:392` |
| 334 | POST | `/api/export/exportHTML` | export | `exportHTML` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:393` |
| 335 | POST | `/api/export/exportPreviewHTML` | export | `exportPreviewHTML` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:394` |
| 336 | POST | `/api/export/exportMdHTML` | export | `exportMdHTML` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:395` |
| 337 | POST | `/api/export/exportDocx` | export | `exportDocx` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:396` |
| 338 | POST | `/api/export/processPDF` | export | `processPDF` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:397` |
| 339 | POST | `/api/export/preview` | export | `exportPreview` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:398` |
| 340 | POST | `/api/export/exportResources` | export | `exportResources` | ✓ | ✓ |  | 不可用 | 官方公开 |  | api-wrapper:src/api/file.ts:50 | 见官方 API 文档 | `kernel/api/router.go:399` |
| 341 | POST | `/api/export/exportAsFile` | export | `exportAsFile` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:400` |
| 342 | POST | `/api/export/exportData` | export | `exportData` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:401` |
| 343 | POST | `/api/export/exportDataInFolder` | export | `exportDataInFolder` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:402` |
| 344 | POST | `/api/export/exportTempContent` | export | `exportTempContent` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:403` |
| 345 | POST | `/api/export/exportBrowserHTML` | export | `exportBrowserHTML` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:404` |
| 346 | POST | `/api/export/export2Liandi` | export | `export2Liandi` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:405` |
| 347 | POST | `/api/export/exportReStructuredText` | export | `exportReStructuredText` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:406` |
| 348 | POST | `/api/export/exportAsciiDoc` | export | `exportAsciiDoc` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:407` |
| 349 | POST | `/api/export/exportTextile` | export | `exportTextile` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:408` |
| 350 | POST | `/api/export/exportOPML` | export | `exportOPML` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:409` |
| 351 | POST | `/api/export/exportOrgMode` | export | `exportOrgMode` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:410` |
| 352 | POST | `/api/export/exportMediaWiki` | export | `exportMediaWiki` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:411` |
| 353 | POST | `/api/export/exportODT` | export | `exportODT` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:412` |
| 354 | POST | `/api/export/exportRTF` | export | `exportRTF` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:413` |
| 355 | POST | `/api/export/exportEPUB` | export | `exportEPUB` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:414` |
| 356 | POST | `/api/export/exportAttributeView` | export | `exportAttributeView` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:415` |
| 357 | POST | `/api/export/exportCodeBlock` | export | `exportCodeBlock` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:416` |
| 358 | POST | `/api/export/copyExportFile` | export | `copyExportFile` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:417` |
| 359 | POST | `/api/import/importStdMd` | import | `importStdMd` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:419` |
| 360 | POST | `/api/import/importZipMd` | import | `importZipMd` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:420` |
| 361 | POST | `/api/import/importData` | import | `importData` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:421` |
| 362 | POST | `/api/import/importSY` | import | `importSY` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:422` |
| 363 | POST | `/api/import/importSYNotebook` | import | `importSYNotebook` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:423` |
| 364 | POST | `/api/import/importSYAuto` | import | `importSYAuto` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:424` |
| 365 | POST | `/api/import/continueImportSY` | import | `continueImportSY` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:425` |
| 366 | POST | `/api/import/cancelImportSY` | import | `cancelImportSY` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:426` |
| 367 | POST | `/api/import/startObsidianVaultAnalysis` | import | `startObsidianVaultAnalysis` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:427` |
| 368 | POST | `/api/import/getObsidianVaultTask` | import | `getObsidianVaultTask` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:428` |
| 369 | POST | `/api/import/startObsidianVaultImport` | import | `startObsidianVaultImport` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:429` |
| 370 | POST | `/api/import/cancelObsidianVaultTask` | import | `cancelObsidianVaultTask` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:430` |
| 371 | POST | `/api/convert/pandoc` | convert | `pandoc` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | — | 见官方 API 文档 | `kernel/api/router.go:432` |
| 372 | POST | `/api/template/render` | template | `renderTemplate` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/template.ts:198 | 见官方 API 文档 | `kernel/api/router.go:434` |
| 373 | POST | `/api/template/docSaveAsTemplate` | template | `docSaveAsTemplate` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/template.ts:272 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:435` |
| 374 | POST | `/api/template/renderSprig` | template | `renderSprig` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/template.ts:211 | 见官方 API 文档 | `kernel/api/router.go:436` |
| 375 | POST | `/api/transactions` | transactions | `performTransactions` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/transaction.ts:27 | 见官方 API 文档 | `kernel/api/router.go:438` |
| 376 | POST | `/api/transactions/undoState` | transactions | `undoState` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:439` |
| 377 | POST | `/api/transactions/undo` | transactions | `performUndo` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:440` |
| 378 | POST | `/api/transactions/redo` | transactions | `performRedo` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:441` |
| 379 | POST | `/api/transactions/clearHistory` | transactions | `clearHistory` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:442` |
| 380 | POST | `/api/setting/setAccount` | setting | `setAccount` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:444` |
| 381 | POST | `/api/setting/setEditor` | setting | `setEditor` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:445` |
| 382 | POST | `/api/setting/setExport` | setting | `setExport` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:446` |
| 383 | POST | `/api/setting/getPandocBin` | setting | `getPandocBin` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:447` |
| 384 | POST | `/api/setting/setFiletree` | setting | `setFiletree` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:448` |
| 385 | POST | `/api/setting/setSearch` | setting | `setSearch` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:449` |
| 386 | POST | `/api/setting/setKeymap` | setting | `setKeymap` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:450` |
| 387 | POST | `/api/setting/setAppearance` | setting | `setAppearance` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:451` |
| 388 | POST | `/api/setting/setEntryVisibility` | setting | `setEntryVisibility` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:452` |
| 389 | POST | `/api/setting/setIcon` | setting | `setIcon` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:453` |
| 390 | POST | `/api/setting/setTheme` | setting | `setTheme` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:454` |
| 391 | POST | `/api/setting/getCloudUser` | setting | `getCloudUser` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:455` |
| 392 | POST | `/api/setting/logoutCloudUser` | setting | `logoutCloudUser` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:456` |
| 393 | POST | `/api/setting/login2faCloudUser` | setting | `login2faCloudUser` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:457` |
| 394 | POST | `/api/setting/setEmoji` | setting | `setEmoji` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:458` |
| 395 | POST | `/api/setting/setFlashcard` | setting | `setFlashcard` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:459` |
| 396 | POST | `/api/setting/setAI` | setting | `setAI` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:460` |
| 397 | POST | `/api/setting/setSecrets` | setting | `setSecrets` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:461` |
| 398 | POST | `/api/setting/setVariables` | setting | `setVariables` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:462` |
| 399 | POST | `/api/setting/setBazaar` | setting | `setBazaar` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:463` |
| 400 | POST | `/api/setting/setPublish` | setting | `setPublish` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:464` |
| 401 | POST | `/api/setting/getPublish` | setting | `getPublish` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:465` |
| 402 | POST | `/api/setting/refreshVirtualBlockRef` | setting | `refreshVirtualBlockRef` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:466` |
| 403 | POST | `/api/setting/addVirtualBlockRefInclude` | setting | `addVirtualBlockRefInclude` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:467` |
| 404 | POST | `/api/setting/addVirtualBlockRefExclude` | setting | `addVirtualBlockRefExclude` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:468` |
| 405 | POST | `/api/setting/setSnippet` | setting | `setConfSnippet` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:469` |
| 406 | POST | `/api/setting/setEditorReadOnly` | setting | `setEditorReadOnly` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:470` |
| 407 | POST | `/api/graph/resetGraph` | graph | `resetGraph` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:472` |
| 408 | POST | `/api/graph/resetLocalGraph` | graph | `resetLocalGraph` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:473` |
| 409 | POST | `/api/graph/setGraphConf` | graph | `setGraphConf` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:474` |
| 410 | POST | `/api/graph/getGraph` | graph | `getGraph` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:475` |
| 411 | POST | `/api/graph/getLocalGraph` | graph | `getLocalGraph` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:476` |
| 412 | POST | `/api/bazaar/getBazaarPlugin` | bazaar | `getBazaarPlugin` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:478` |
| 413 | POST | `/api/bazaar/getInstalledPlugin` | bazaar | `getInstalledPlugin` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:479` |
| 414 | POST | `/api/bazaar/installBazaarPlugin` | bazaar | `installBazaarPlugin` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:480` |
| 415 | POST | `/api/bazaar/uninstallBazaarPlugin` | bazaar | `uninstallBazaarPlugin` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:481` |
| 416 | POST | `/api/bazaar/getBazaarWidget` | bazaar | `getBazaarWidget` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:482` |
| 417 | POST | `/api/bazaar/getInstalledWidget` | bazaar | `getInstalledWidget` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:483` |
| 418 | POST | `/api/bazaar/installBazaarWidget` | bazaar | `installBazaarWidget` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:484` |
| 419 | POST | `/api/bazaar/uninstallBazaarWidget` | bazaar | `uninstallBazaarWidget` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:485` |
| 420 | POST | `/api/bazaar/getBazaarIcon` | bazaar | `getBazaarIcon` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:486` |
| 421 | POST | `/api/bazaar/getInstalledIcon` | bazaar | `getInstalledIcon` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:487` |
| 422 | POST | `/api/bazaar/installBazaarIcon` | bazaar | `installBazaarIcon` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:488` |
| 423 | POST | `/api/bazaar/uninstallBazaarIcon` | bazaar | `uninstallBazaarIcon` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:489` |
| 424 | POST | `/api/bazaar/getBazaarTemplate` | bazaar | `getBazaarTemplate` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:490` |
| 425 | POST | `/api/bazaar/getInstalledTemplate` | bazaar | `getInstalledTemplate` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:491` |
| 426 | POST | `/api/bazaar/installBazaarTemplate` | bazaar | `installBazaarTemplate` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:492` |
| 427 | POST | `/api/bazaar/uninstallBazaarTemplate` | bazaar | `uninstallBazaarTemplate` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:493` |
| 428 | POST | `/api/bazaar/getBazaarTheme` | bazaar | `getBazaarTheme` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:494` |
| 429 | POST | `/api/bazaar/getInstalledTheme` | bazaar | `getInstalledTheme` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:495` |
| 430 | POST | `/api/bazaar/installBazaarTheme` | bazaar | `installBazaarTheme` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:496` |
| 431 | POST | `/api/bazaar/uninstallBazaarTheme` | bazaar | `uninstallBazaarTheme` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:497` |
| 432 | POST | `/api/bazaar/getBazaarPackageREADME` | bazaar | `getBazaarPackageREADME` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:498` |
| 433 | POST | `/api/bazaar/getInstalledPackageSize` | bazaar | `getInstalledPackageSize` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:499` |
| 434 | POST | `/api/bazaar/getBazaarPackage` | bazaar | `getBazaarPackage` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:500` |
| 435 | POST | `/api/bazaar/getUpdatedPackage` | bazaar | `getUpdatedPackage` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:501` |
| 436 | POST | `/api/bazaar/updateBazaarPackage` | bazaar | `updateBazaarPackage` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:502` |
| 437 | POST | `/api/bazaar/batchUpdatePackage` | bazaar | `batchUpdatePackage` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:503` |
| 438 | POST | `/api/bazaar/installLocalBazaarPackage` | bazaar | `installLocalBazaarPackage` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:504` |
| 439 | POST | `/api/repo/initRepoKey` | repo | `initRepoKey` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:506` |
| 440 | POST | `/api/repo/initRepoKeyFromPassphrase` | repo | `initRepoKeyFromPassphrase` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:507` |
| 441 | POST | `/api/repo/resetRepo` | repo | `resetRepo` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:508` |
| 442 | POST | `/api/repo/purgeRepo` | repo | `purgeRepo` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:509` |
| 443 | POST | `/api/repo/purgeCloudRepo` | repo | `purgeCloudRepo` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:510` |
| 444 | POST | `/api/repo/importRepoKey` | repo | `importRepoKey` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:511` |
| 445 | POST | `/api/repo/createSnapshot` | repo | `createSnapshot` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/repo.ts:52<br>ui:src/ui/version-control/SnapshotPanel.svelte:211<br>ui:src/ui/version-control/VersionDiffPanel.svelte:719 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:512` |
| 446 | POST | `/api/repo/tagSnapshot` | repo | `tagSnapshot` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/repo.ts:56<br>ui:src/ui/version-control/SnapshotPanel.svelte:219<br>ui:src/ui/version-control/SnapshotPanel.svelte:360 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:513` |
| 447 | POST | `/api/repo/checkoutRepo` | repo | `checkoutRepo` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:514` |
| 448 | POST | `/api/repo/getRepoSnapshots` | repo | `getRepoSnapshots` | ✓ | ✓ |  | 不可用 | 内部 |  | api-wrapper:src/api/repo.ts:60<br>ui:src/ui/version-control/SnapshotPanel.svelte:304<br>ui:src/ui/version-control/VersionDiffPanel.svelte:756 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:515` |
| 449 | POST | `/api/repo/searchRepoFile` | repo | `searchRepoFile` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:516` |
| 450 | POST | `/api/repo/getRepoDocHistory` | repo | `getRepoDocHistory` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:517` |
| 451 | POST | `/api/repo/getRepoTagSnapshots` | repo | `getRepoTagSnapshots` | ✓ | ✓ |  | 不可用 | 内部 |  | api-wrapper:src/api/repo.ts:64<br>core:src/core/write-safety-coordinator.ts:667<br>ui:src/ui/version-control/SnapshotPanel.svelte:158<br>ui:src/ui/version-control/SnapshotPanel.svelte:305<br>ui:src/ui/version-control/VersionDiffPanel.svelte:757 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:518` |
| 452 | POST | `/api/repo/removeRepoTagSnapshot` | repo | `removeRepoTagSnapshot` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/repo.ts:68<br>ui:src/ui/version-control/SnapshotPanel.svelte:280<br>ui:src/ui/version-control/SnapshotPanel.svelte:362 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:519` |
| 453 | POST | `/api/repo/getCloudRepoTagSnapshots` | repo | `getCloudRepoTagSnapshots` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:520` |
| 454 | POST | `/api/repo/getCloudRepoSnapshots` | repo | `getCloudRepoSnapshots` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:521` |
| 455 | POST | `/api/repo/removeCloudRepoTagSnapshot` | repo | `removeCloudRepoTagSnapshot` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:522` |
| 456 | POST | `/api/repo/uploadCloudSnapshot` | repo | `uploadCloudSnapshot` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:523` |
| 457 | POST | `/api/repo/downloadCloudSnapshot` | repo | `downloadCloudSnapshot` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:524` |
| 458 | POST | `/api/repo/diffRepoSnapshots` | repo | `diffRepoSnapshots` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/repo.ts:76<br>ui:src/ui/version-control/VersionDiffPanel.svelte:636 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:525` |
| 459 | POST | `/api/repo/openRepoSnapshotFile` | repo | `openRepoSnapshotFile` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/repo.ts:80<br>ui:src/ui/version-control/VersionDiffPanel.svelte:780<br>ui:src/ui/version-control/VersionDiffPanel.svelte:781 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:526` |
| 460 | POST | `/api/repo/rollbackRepoSnapshotFile` | repo | `rollbackRepoSnapshotFile` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/repo.ts:84<br>ui:src/ui/version-control/VersionDiffPanel.svelte:871 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:527` |
| 461 | POST | `/api/repo/exportRepoFile` | repo | `exportRepoFile` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:528` |
| 462 | POST | `/api/repo/getRepoFile` | repo | `getRepoFile` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:529` |
| 463 | POST | `/api/repo/setRepoIndexRetentionDays` | repo | `setRepoIndexRetentionDays` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:530` |
| 464 | POST | `/api/repo/setRetentionIndexesDaily` | repo | `setRetentionIndexesDaily` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:531` |
| 465 | POST | `/api/riff/createRiffDeck` | riff | `createRiffDeck` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:533` |
| 466 | POST | `/api/riff/renameRiffDeck` | riff | `renameRiffDeck` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:534` |
| 467 | POST | `/api/riff/removeRiffDeck` | riff | `removeRiffDeck` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:535` |
| 468 | POST | `/api/riff/getRiffDecks` | riff | `getRiffDecks` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/flashcard.ts:47 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:536` |
| 469 | POST | `/api/riff/addRiffCards` | riff | `addRiffCards` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/flashcard.ts:111 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:537` |
| 470 | POST | `/api/riff/removeRiffCards` | riff | `removeRiffCards` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/flashcard.ts:119 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:538` |
| 471 | POST | `/api/riff/getRiffDueCards` | riff | `getRiffDueCards` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/flashcard.ts:55 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:539` |
| 472 | POST | `/api/riff/getTreeRiffDueCards` | riff | `getTreeRiffDueCards` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/flashcard.ts:77 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:540` |
| 473 | POST | `/api/riff/getNotebookRiffDueCards` | riff | `getNotebookRiffDueCards` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | api-wrapper:src/api/flashcard.ts:66 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:541` |
| 474 | POST | `/api/riff/reviewRiffCard` | riff | `reviewRiffCard` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/flashcard.ts:90 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:542` |
| 475 | POST | `/api/riff/skipReviewRiffCard` | riff | `skipReviewRiffCard` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/flashcard.ts:103 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:543` |
| 476 | POST | `/api/riff/getRiffCards` | riff | `getRiffCards` | ✓ | ✓ |  | 不可用 | 内部 |  | api-wrapper:src/api/flashcard.ts:128<br>core:src/core/write-safety-coordinator.ts:631 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:544` |
| 477 | POST | `/api/riff/getTreeRiffCards` | riff | `getTreeRiffCards` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:545` |
| 478 | POST | `/api/riff/getNotebookRiffCards` | riff | `getNotebookRiffCards` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:546` |
| 479 | POST | `/api/riff/resetRiffCards` | riff | `resetRiffCards` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:547` |
| 480 | POST | `/api/riff/batchSetRiffCardsDueTime` | riff | `batchSetRiffCardsDueTime` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:548` |
| 481 | POST | `/api/riff/getRiffCardsByBlockIDs` | riff | `getRiffCardsByBlockIDs` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/flashcard.ts:139<br>core:src/core/write-safety-coordinator.ts:661 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:549` |
| 482 | POST | `/api/notification/pushMsg` | notification | `pushMsg` | ✓ | ✓ |  | 不可用 | 官方公开 |  | api-wrapper:src/api/notification.ts:20 | 见官方 API 文档 | `kernel/api/router.go:551` |
| 483 | POST | `/api/notification/pushErrMsg` | notification | `pushErrMsg` | ✓ | ✓ |  | 不可用 | 官方公开 |  | api-wrapper:src/api/notification.ts:35 | 见官方 API 文档 | `kernel/api/router.go:552` |
| 484 | POST | `/api/snippet/getSnippet` | snippet | `getSnippet` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:554` |
| 485 | POST | `/api/snippet/setSnippet` | snippet | `setSnippet` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:555` |
| 486 | POST | `/api/snippet/removeSnippet` | snippet | `removeSnippet` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:556` |
| 487 | POST | `/api/av/renderAttributeView` | av | `renderAttributeView` | ✓ |  |  | 条件可用 | 官方公开 | ✓ | api-wrapper:src/api/av.ts:48 | 见官方 API 文档 | `kernel/api/router.go:558` |
| 488 | POST | `/api/av/getAttributeViewItemStatuses` | av | `getAttributeViewItemStatuses` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:559` |
| 489 | POST | `/api/av/renderHistoryAttributeView` | av | `renderHistoryAttributeView` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:560` |
| 490 | POST | `/api/av/renderSnapshotAttributeView` | av | `renderSnapshotAttributeView` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:561` |
| 491 | POST | `/api/av/getAttributeViewKeys` | av | `getAttributeViewKeys` | ✓ |  |  | 条件可用 | 内部 | ✓ | api-wrapper:src/api/av.ts:52 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:562` |
| 492 | POST | `/api/av/getAttributeViewSearchTarget` | av | `getAttributeViewSearchTarget` | ✓ |  | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:563` |
| 493 | POST | `/api/av/getAttributeViewFieldViews` | av | `getAttributeViewFieldViews` | ✓ |  | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:564` |
| 494 | POST | `/api/av/getAttributeViewBacklinks` | av | `getAttributeViewBacklinks` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:565` |
| 495 | POST | `/api/av/setAttributeViewBlockAttr` | av | `setAttributeViewBlockAttr` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/av.ts:171 | 见官方 API 文档 | `kernel/api/router.go:566` |
| 496 | POST | `/api/av/batchSetAttributeViewBlockAttrs` | av | `batchSetAttributeViewBlockAttrs` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/av.ts:179 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:567` |
| 497 | POST | `/api/av/searchAttributeView` | av | `searchAttributeView` | ✓ |  | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/av.ts:94 | 见官方 API 文档 | `kernel/api/router.go:568` |
| 498 | POST | `/api/av/getAttributeView` | av | `getAttributeView` | ✓ |  | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/av.ts:32<br>core:src/core/write-safety-coordinator.ts:570 | 见官方 API 文档 | `kernel/api/router.go:569` |
| 499 | POST | `/api/av/getAttributeViewPasteRows` | av | `getAttributeViewPasteRows` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:570` |
| 500 | POST | `/api/av/searchAttributeViewRelationKey` | av | `searchAttributeViewRelationKey` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:571` |
| 501 | POST | `/api/av/searchAttributeViewNonRelationKey` | av | `deprecated` | ✓ | ✓ | ✓ | 不可用 | 内部/弃用 |  | — | 未知（内部） | `kernel/api/router.go:572` |
| 502 | POST | `/api/av/searchAttributeViewRollupDestKeys` | av | `searchAttributeViewRollupDestKeys` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:573` |
| 503 | POST | `/api/av/getAttributeViewFilterSort` | av | `getAttributeViewFilterSort` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/av.ts:59 | 见官方 API 文档 | `kernel/api/router.go:574` |
| 504 | POST | `/api/av/setAttrViewFilters` | av | `setAttrViewFilters` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/av.ts:70 | 见官方 API 文档 | `kernel/api/router.go:575` |
| 505 | POST | `/api/av/setAttrViewSorts` | av | `setAttrViewSorts` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/av.ts:78 | 见官方 API 文档 | `kernel/api/router.go:576` |
| 506 | POST | `/api/av/addAttributeViewKey` | av | `addAttributeViewKey` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/av.ts:146 | 见官方 API 文档 | `kernel/api/router.go:577` |
| 507 | POST | `/api/av/removeAttributeViewKey` | av | `removeAttributeViewKey` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/av.ts:159 | 见官方 API 文档 | `kernel/api/router.go:578` |
| 508 | POST | `/api/av/sortAttributeViewViewKey` | av | `sortAttributeViewViewKey` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | — | 见官方 API 文档 | `kernel/api/router.go:579` |
| 509 | POST | `/api/av/sortAttributeViewKey` | av | `sortAttributeViewKey` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | — | 见官方 API 文档 | `kernel/api/router.go:580` |
| 510 | POST | `/api/av/addAttributeViewBlocks` | av | `addAttributeViewBlocks` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/av.ts:109 | 见官方 API 文档 | `kernel/api/router.go:581` |
| 511 | POST | `/api/av/removeAttributeViewBlocks` | av | `removeAttributeViewBlocks` | ✓ | ✓ | ✓ | 不可用 | 官方公开 |  | api-wrapper:src/api/av.ts:132 | 见官方 API 文档 | `kernel/api/router.go:582` |
| 512 | POST | `/api/av/getAttributeViewPrimaryKeyValues` | av | `getAttributeViewPrimaryKeyValues` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/av.ts:212 | 见官方 API 文档 | `kernel/api/router.go:583` |
| 513 | POST | `/api/av/getAttributeViewRelationCandidates` | av | `getAttributeViewRelationCandidates` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:584` |
| 514 | POST | `/api/av/setDatabaseBlockView` | av | `setDatabaseBlockView` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:585` |
| 515 | POST | `/api/av/getMirrorDatabaseBlocks` | av | `getMirrorDatabaseBlocks` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/av.ts:200<br>core:src/core/write-safety-coordinator.ts:1609 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:586` |
| 516 | POST | `/api/av/getAttributeViewKeysByAvID` | av | `getAttributeViewKeysByAvID` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:587` |
| 517 | POST | `/api/av/getAttributeViewKeysByID` | av | `getAttributeViewKeysByID` | ✓ |  | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:588` |
| 518 | POST | `/api/av/duplicateAttributeViewBlock` | av | `duplicateAttributeViewBlock` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/av.ts:186 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:589` |
| 519 | POST | `/api/av/appendAttributeViewDetachedBlocksWithValues` | av | `appendAttributeViewDetachedBlocksWithValues` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:590` |
| 520 | POST | `/api/av/getCurrentAttrViewImages` | av | `getCurrentAttrViewImages` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:591` |
| 521 | POST | `/api/av/changeAttrViewLayout` | av | `changeAttrViewLayout` | ✓ | ✓ |  | 不可用 | 官方公开 | ✓ | — | 见官方 API 文档 | `kernel/api/router.go:592` |
| 522 | POST | `/api/av/setAttrViewGroup` | av | `setAttrViewGroup` | ✓ | ✓ | ✓ | 不可用 | 官方公开 | ✓ | api-wrapper:src/api/av.ts:86 | 见官方 API 文档 | `kernel/api/router.go:593` |
| 523 | POST | `/api/av/batchReplaceAttributeViewBlocks` | av | `batchReplaceAttributeViewBlocks` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:594` |
| 524 | POST | `/api/av/getAttributeViewAddingBlockDefaultValues` | av | `getAttributeViewAddingBlockDefaultValues` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:595` |
| 525 | POST | `/api/av/getAttributeViewBoundBlockIDsByItemIDs` | av | `getAttributeViewBoundBlockIDsByItemIDs` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:596` |
| 526 | POST | `/api/av/getAttributeViewItemIDsByBoundIDs` | av | `getAttributeViewItemIDsByBoundIDs` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:597` |
| 527 | POST | `/api/av/getUnusedAttributeViews` | av | `getUnusedAttributeViews` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:598` |
| 528 | POST | `/api/av/createAttributeViewItem` | av | `createAttributeViewItem` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/av.ts:124 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:599` |
| 529 | POST | `/api/av/createAttributeViewItemDocs` | av | `createAttributeViewItemDocs` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:600` |
| 530 | POST | `/api/av/removeUnusedAttributeViews` | av | `removeUnusedAttributeViews` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:601` |
| 531 | POST | `/api/av/removeUnusedAttributeView` | av | `removeUnusedAttributeView` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:602` |
| 532 | POST | `/api/ai/chatGPT` | ai | `chatGPT` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:604` |
| 533 | POST | `/api/ai/chatGPTWithAction` | ai | `chatGPTWithAction` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:605` |
| 534 | POST | `/api/ai/testModel` | ai | `testModel` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:606` |
| 535 | POST | `/api/ai/testEmbeddingModel` | ai | `testEmbeddingModel` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:607` |
| 536 | POST | `/api/ai/testRerankModel` | ai | `testRerankModel` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:608` |
| 537 | POST | `/api/ai/listModels` | ai | `listModels` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:609` |
| 538 | POST | `/api/ai/embeddingStat` | ai | `embeddingStat` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:610` |
| 539 | POST | `/api/ai/mcpStatus` | ai | `mcpStatus` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:611` |
| 540 | POST | `/api/ai/mcpEnvironmentVariables` | ai | `mcpEnvironmentVariables` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:612` |
| 541 | POST | `/api/ai/mcpOAuthAuthorize` | ai | `mcpOAuthAuthorize` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:613` |
| 542 | POST | `/api/ai/mcpOAuthDisconnect` | ai | `mcpOAuthDisconnect` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:614` |
| 543 | POST | `/api/ai/reindexEmbedding` | ai | `reindexEmbedding` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:615` |
| 544 | POST | `/api/ai/retryFailedEmbedding` | ai | `retryFailedEmbedding` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:616` |
| 545 | POST | `/api/ai/agent/chat` | ai | `agentChat` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:617` |
| 546 | POST | `/api/ai/agent/confirm` | ai | `agentChatConfirm` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:618` |
| 547 | POST | `/api/ai/agent/setPermission` | ai | `setAgentSessionPermission` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:619` |
| 548 | POST | `/api/ai/agent/question` | ai | `agentChatQuestion` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:620` |
| 549 | POST | `/api/ai/agent/browserCapabilityResult` | ai | `agentChatBrowserCapabilityResult` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:621` |
| 550 | POST | `/api/ai/lsCapabilities` | ai | `lsCapabilities` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:622` |
| 551 | POST | `/api/ai/agent/title` | ai | `agentChatTitle` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:623` |
| 552 | POST | `/api/ai/agent/lsSessions` | ai | `lsSessions` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:624` |
| 553 | POST | `/api/ai/agent/getSession` | ai | `getSession` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:625` |
| 554 | POST | `/api/ai/agent/saveSession` | ai | `saveSession` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:626` |
| 555 | POST | `/api/ai/agent/removeSession` | ai | `removeSession` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:627` |
| 556 | POST | `/api/ai/agent/lsSkills` | ai | `lsSkills` | ✓ | ✓ |  | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:628` |
| 557 | POST | `/api/ai/agent/getSkill` | ai | `getSkill` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:629` |
| 558 | POST | `/api/ai/agent/saveSkill` | ai | `saveSkill` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:630` |
| 559 | POST | `/api/ai/agent/removeSkill` | ai | `removeSkill` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:631` |
| 560 | POST | `/api/ai/agent/renameSkill` | ai | `renameSkill` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:632` |
| 561 | POST | `/api/petal/loadPetals` | petal | `loadPetals` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:634` |
| 562 | POST | `/api/petal/setPetalEnabled` | petal | `setPetalEnabled` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:635` |
| 563 | GET | `/api/plugin/rpc` | plugin | `getLoadedPlugin` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:637` |
| 564 | GET | `/api/plugin/rpc/:name` | plugin | `getLoadedPlugin` | ✓ |  |  | 条件可用 | 动态/内部 |  | — | 未知（内部） | `kernel/api/router.go:638` |
| 565 | GET | `/api/plugin` | plugin | `listLoadedPlugins` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:639` |
| 566 | POST | `/api/plugin/getLoadedPlugin` | plugin | `getLoadedPlugin` | ✓ |  |  | 条件可用 | 内部 | ✓ | — | 未知（内部） | `kernel/api/router.go:641` |
| 567 | POST | `/api/plugin/listLoadedPlugins` | plugin | `listLoadedPlugins` | ✓ |  |  | 条件可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:642` |
| 568 | POST | `/api/plugin/rpc` | plugin | `pluginJsonRpcHttp` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:644` |
| 569 | POST | `/api/plugin/rpc/:name` | plugin | `pluginJsonRpcHttp` | ✓ | ✓ | ✓ | 不可用 | 动态/内部 |  | — | 未知（内部） | `kernel/api/router.go:645` |
| 570 | GET | `/ws/plugin/rpc` | protocol | `pluginJsonRpcWebSocket` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:647` |
| 571 | GET | `/ws/plugin/rpc/:name` | protocol | `pluginJsonRpcWebSocket` | ✓ | ✓ | ✓ | 不可用 | 动态/内部 |  | — | 未知（内部） | `kernel/api/router.go:648` |
| 572 | ANY | `/plugin/private/:name/*path` | protocol | `pluginPrivateWebServer` | ✓ | ✓ | ✓ | 不可用 | 动态/内部 |  | — | 未知（内部） | `kernel/api/router.go:651` |
| 573 | ANY | `/api/network/echo` | network | `echo` | ✓ | ✓ |  | 不可用 | 动态/内部 |  | — | 未知（内部） | `kernel/api/router.go:653` |
| 574 | ANY | `/api/network/echo/*path` | network | `echo` | ✓ | ✓ |  | 不可用 | 动态/内部 |  | — | 未知（内部） | `kernel/api/router.go:654` |
| 575 | POST | `/api/network/forwardProxy` | network | `forwardProxy` | ✓ | ✓ |  | 不可用 | 官方公开 |  | — | 见官方 API 文档 | `kernel/api/router.go:655` |
| 576 | ANY | `/api/network/proxy` | network | `httpProxy` | ✓ | ✓ |  | 不可用 | 官方公开 |  | — | 见官方 API 文档 | `kernel/api/router.go:657` |
| 577 | GET | `/ws/network/proxy` | protocol | `wsProxy` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:658` |
| 578 | GET | `/es/network/proxy` | protocol | `esProxy` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:659` |
| 579 | GET | `/ws/broadcast` | protocol | `broadcast` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:661` |
| 580 | GET | `/es/broadcast/subscribe` | protocol | `broadcastSubscribe` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:662` |
| 581 | POST | `/api/broadcast/publish` | broadcast | `broadcastPublish` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:664` |
| 582 | POST | `/api/broadcast/postMessage` | broadcast | `postMessage` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:665` |
| 583 | POST | `/api/broadcast/getChannels` | broadcast | `getChannels` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:666` |
| 584 | POST | `/api/broadcast/getChannelInfo` | broadcast | `getChannelInfo` | ✓ | ✓ |  | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:667` |
| 585 | POST | `/api/archive/zip` | archive | `zip` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:669` |
| 586 | POST | `/api/archive/unzip` | archive | `unzip` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:670` |
| 587 | POST | `/api/ui/reloadUI` | ui | `reloadUI` | ✓ | ✓ | ✓ | 不可用 | 内部 | ✓ | api-wrapper:src/api/system.ts:40 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:672` |
| 588 | POST | `/api/ui/reloadIcon` | ui | `reloadIcon` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/system.ts:44 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:673` |
| 589 | POST | `/api/ui/reloadTheme` | ui | `reloadTheme` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | — | 未知（内部） | `kernel/api/router.go:674` |
| 590 | POST | `/api/ui/reloadAttributeView` | ui | `reloadAttributeView` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/system.ts:56 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:675` |
| 591 | POST | `/api/ui/reloadProtyle` | ui | `reloadProtyle` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/system.ts:52 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:676` |
| 592 | POST | `/api/ui/reloadFiletree` | ui | `reloadFiletree` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/system.ts:48 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:677` |
| 593 | POST | `/api/ui/reloadTag` | ui | `reloadTag` | ✓ | ✓ | ✓ | 不可用 | 内部 |  | api-wrapper:src/api/system.ts:60 | 见插件 wrapper 类型；内核未公开稳定 schema | `kernel/api/router.go:678` |

## 思源原生 MCP 与 WebSocket 元数据

原生 MCP 静态注册表当前识别 **31** 个内建工具。插件及外部 MCP 工具还会在运行时加入注册表，因此这里不是运行时上限。

| 原生工具 | Action | Effect scope | Action effects | 来源 |
|---|---|---|---|---|
| `asset` | `upload`、`create_html`、`unused`、`clean`、`stat` | `local` | upload: LocalWrite<br>create_html: LocalWrite<br>unused: LocalRead<br>clean: LocalWrite<br>stat: LocalRead | `kernel/mcp/tools/asset.go:34` |
| `attr` | `get`、`set`、`batch-get` | `unknown` | get: 未声明<br>set: 未声明<br>batch-get: 未声明 | `kernel/mcp/tools/attr.go:29` |
| `block` | `get`、`get_kramdown`、`get_children`、`tree_stat`、`dom`、`insert`、`append`、`prepend`、`update`、`delete`、`move`、`breadcrumb`、`batch_get`、`batch_kramdown` | `unknown` | get: 未声明<br>get_kramdown: 未声明<br>get_children: 未声明<br>tree_stat: 未声明<br>dom: 未声明<br>insert: 未声明<br>append: 未声明<br>prepend: 未声明<br>update: 未声明<br>delete: 未声明<br>move: 未声明<br>breadcrumb: 未声明<br>batch_get: 未声明<br>batch_kramdown: 未声明 | `kernel/mcp/tools/block.go:30` |
| `bookmark` | `list`、`labels`、`remove`、`rename` | `unknown` | list: 未声明<br>labels: 未声明<br>remove: 未声明<br>rename: 未声明 | `kernel/mcp/tools/bookmark.go:27` |
| `dailynote` | `create`、`append`、`prepend` | `unknown` | create: 未声明<br>append: 未声明<br>prepend: 未声明 | `kernel/mcp/tools/dailynote.go:27` |
| `database` | `(single)` | `unknown` | (single): 未声明 | `kernel/mcp/tools/database.go:43` |
| `document` | `get`、`create`、`list`、`delete`、`rename`、`move`、`duplicate`、`search_docs`、`info` | `unknown` | get: 未声明<br>create: 未声明<br>list: 未声明<br>delete: 未声明<br>rename: 未声明<br>move: 未声明<br>duplicate: 未声明<br>search_docs: 未声明<br>info: 未声明 | `kernel/mcp/tools/document.go:30` |
| `export` | `md`、`html`、`preview`、`docx`、`sy`、`md-zip`、`data` | `unknown` | md: 未声明<br>html: 未声明<br>preview: 未声明<br>docx: 未声明<br>sy: 未声明<br>md-zip: 未声明<br>data: 未声明 | `kernel/mcp/tools/export.go:26` |
| `file` | `list`、`read`、`write`、`delete`、`rename`、`copy`、`grep`、`find`、`stat` | `unknown` | list: 未声明<br>read: 未声明<br>write: 未声明<br>delete: 未声明<br>rename: 未声明<br>copy: 未声明<br>grep: 未声明<br>find: 未声明<br>stat: 未声明 | `kernel/mcp/tools/file.go:33` |
| `history` | `list`、`search`、`get`、`rollback`、`clear` | `unknown` | list: 未声明<br>search: 未声明<br>get: 未声明<br>rollback: 未声明<br>clear: 未声明 | `kernel/mcp/tools/history.go:29` |
| `http_request` | `get`、`post`、`put`、`delete`、`patch` | `external` | get: 未声明<br>post: 未声明<br>put: 未声明<br>delete: 未声明<br>patch: 未声明 | `kernel/mcp/tools/http_request.go:33` |
| `image` | `list`、`analyze`、`generate` | `mixed` | list: LocalRead<br>analyze: LocalRead+DataEgress+ExternalCost<br>generate: LocalWrite+DataEgress+ExternalCost | `kernel/mcp/tools/image.go:39` |
| `import` | `md`、`sy`、`data` | `unknown` | md: 未声明<br>sy: 未声明<br>data: 未声明 | `kernel/mcp/tools/import.go:27` |
| `inbox` | `list`、`get`、`convert` | `unknown` | list: 未声明<br>get: 未声明<br>convert: 未声明 | `kernel/mcp/tools/inbox.go:33` |
| `notebook` | `list`、`open`、`close`、`create`、`rename`、`remove`、`set_icon`、`random_icon` | `unknown` | list: 未声明<br>open: 未声明<br>close: 未声明<br>create: 未声明<br>rename: 未声明<br>remove: 未声明<br>set_icon: 未声明<br>random_icon: 未声明 | `kernel/mcp/tools/notebook.go:30` |
| `outline` | `get` | `unknown` | get: 未声明 | `kernel/mcp/tools/outline.go:27` |
| `question` | `(single)` | `unknown` | (single): 未声明 | `kernel/mcp/tools/question.go:20` |
| `ref` | `backlinks`、`mentions`、`refresh` | `unknown` | backlinks: 未声明<br>mentions: 未声明<br>refresh: 未声明 | `kernel/mcp/tools/ref.go:27` |
| `repo` | `list`、`create`、`tag`、`untag`、`checkout`、`diff`、`search`、`purge`、`file_get`、`file_rollback`、`file_open`、`file_export` | `unknown` | list: 未声明<br>create: 未声明<br>tag: 未声明<br>untag: 未声明<br>checkout: 未声明<br>diff: 未声明<br>search: 未声明<br>purge: 未声明<br>file_get: 未声明<br>file_rollback: 未声明<br>file_open: 未声明<br>file_export: 未声明 | `kernel/mcp/tools/repo.go:29` |
| `search` | `fulltext`、`semantic`、`asset`、`getasset` | `local` | fulltext: LocalRead<br>semantic: LocalRead+DataEgress+ExternalCost<br>asset: LocalRead<br>getasset: LocalRead | `kernel/mcp/tools/search.go:27` |
| `skill` | `load`、`save`、`install`、`remove`、`rename`、`list` | `local` | load: LocalRead<br>save: LocalWrite<br>install: LocalWrite<br>remove: LocalWrite<br>rename: LocalWrite<br>list: LocalRead | `kernel/mcp/tools/skill.go:28` |
| `sql` | `query` | `local` | query: LocalRead | `kernel/mcp/tools/sql.go:27` |
| `sync` | `perform`、`upload`、`download`、`status` | `unknown` | perform: 未声明<br>upload: 未声明<br>download: 未声明<br>status: 未声明 | `kernel/mcp/tools/sync.go:26` |
| `system` | `version`、`current_time`、`workspace` | `unknown` | version: 未声明<br>current_time: 未声明<br>workspace: 未声明 | `kernel/mcp/tools/system.go:27` |
| `tag` | `list`、`rename`、`remove` | `unknown` | list: 未声明<br>rename: 未声明<br>remove: 未声明 | `kernel/mcp/tools/tag.go:27` |
| `template` | `search`、`get`、`remove`、`render`、`save_as`、`create` | `unknown` | search: 未声明<br>get: 未声明<br>remove: 未声明<br>render: 未声明<br>save_as: 未声明<br>create: 未声明 | `kernel/mcp/tools/template.go:30` |
| `todo_write` | `(single)` | `unknown` | (single): 未声明 | `kernel/mcp/tools/todo.go:27` |
| `unzip` | `(single)` | `unknown` | (single): 未声明 | `kernel/mcp/tools/unzip.go:29` |
| `web_fetch` | `(single)` | `unknown` | (single): 未声明 | `kernel/mcp/tools/web_fetch.go:24` |
| `web_search` | `(single)` | `unknown` | (single): 未声明 | `kernel/mcp/tools/web_search.go:24` |
| `workspace` | `list`、`info` | `unknown` | list: 未声明<br>info: 未声明 | `kernel/mcp/tools/workspace.go:27` |

- `/mcp` 的 action/effect 真相源在 `kernel/mcp/tools/*.go`；`ActionEffects` 不通过 `tools/list` 输出，审计必须读取 Go 源。
- 主 `/ws` 的命令分发入口是 `kernel/cmd/cmd.go`，当前静态命令为 `ping`、`closews`；其他消息是服务端广播事件，不应伪装成 HTTP API。

## 扫描限制

- 静态分析只把能够从注册源码、官方文档或插件类型可靠确认的字段写成确定值；内部 handler 的请求/响应不会靠命名猜测。
- 前端调用列仅表示在 `app/src` 发现同路径字面量，动态拼接可能导致假阴性。
- `Any` 保留为 ANY 声明，不展开为多个方法，确保 593 条注册声明基线稳定。
