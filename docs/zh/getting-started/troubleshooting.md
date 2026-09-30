# 故障排查

这个页面汇总了 MCP 连接和调用的常见问题，以及最快的检查路径。

适用场景：服务起不来、工具不显示，或者连接成功后调用失败。

相关页面：

- [部署指南](./deployment.md)
- [HTTPS 配置](./https.md)

## 连接失败

先检查：

- 思源是否正在运行，`6806` API 是否可访问
- 插件是否已启用
- 如果使用 HTTP，MCP 服务是否已在 `36806` 启动
- 如果使用 stdio，`mcp-server.cjs` 路径是否正确，并且是否能被 MCP 客户端所在机器读取
- Docker 场景下，不要直接使用 `/siyuan/workspace/data/plugins/.../mcp-server.cjs` 这类仅容器内可见的路径，除非该路径也挂载到了客户端机器。请把 `mcp-server.cjs` 复制到客户端侧路径，或从 release package 中解压

## 关闭文档快照与 Diff 后，HTTP 启动按钮变灰

在思源 3.8.1、插件 0.6.7 中，如果启动日志包含 `removeDockFromPosition`、`toggleModel` 和 `Cannot read properties of null (reading 'getAttribute')`，说明插件在清理不存在的 dock 按钮时抛错，导致后续 HTTP 启动器未完成初始化。

临时恢复：启用「文档快照与 Diff」，再重新加载插件。包含此修复的版本会先检查按钮和 model 是否存在，再调用思源的 dock 接口；关闭该功能也能正常初始化 HTTP 服务。

## 工具不可见

- 确认客户端真的连上了 MCP 端点
- 确认插件侧工具配置没有禁用对应工具
- 如果刚改过设置，重启一次 MCP 服务

## 连接成功但调用失败

- 检查 bearer token 或 `SIYUAN_TOKEN`
- 检查目标笔记本的权限配置
- 检查文档相关 action 是否使用了正确的路径类型

## 权限被拒绝

权限级别：

- `rwd`：读写删
- `rw`：读写
- `r`：只读
- `none`：无权限

调用失败时同时检查：

- 笔记本级权限设置
- 该 action 是否属于高危操作或已被禁用

## 日志与快速参考

默认端口：

- 思源 API：`6806`
- MCP HTTP：`36806`

常见路径：

- 插件目录：`{workspace}/data/plugins/siyuan-plugins-mcp-sisyphus/`
- `mcp-server.cjs`：与插件 bundle 同目录

常见 stdio 错误：

- `Failed to reconnect ... -32000`：通常表示 MCP 客户端无法启动 `mcp-server.cjs`，或 server 无法访问 `SIYUAN_API_URL`。Docker 场景下先检查 `args` 是否指向客户端侧文件路径，以及 `SIYUAN_API_URL` 是否指向可访问的思源 API 地址，通常是 `http://<docker-host-ip>:6806`。

桌面 HTTP MCP 使用当前工作区窗口的实际 API origin，包括随机端口；无法确定 origin 时拒绝启动。401 表示认证失败，403 表示 HTTP 访问被拒绝，429 表示限流；这些响应不再提示“启动思源”。独立部署仍使用 `SIYUAN_API_URL`。复制给 AI 的配置说明会要求先明确全局或项目／工作区范围，再修改对应配置。

## 启用数据库筛选后整个 MCP 报 Schema 错误

如果错误包含 `unresolvable $ref`、`$defs` 或 `filters/items`，客户端可能在加载工具列表时失败，尚未发起笔记操作。旧版聚合 Schema 会丢失递归筛选器的定义。更新到包含此修复的版本后，重启实际使用的 MCP Server（stdio 客户端也需重启子进程），再刷新客户端工具列表。暂时无法更新时，可关闭“数据库 → 设置视图筛选”并重新连接，作为临时绕过。

若 Schema 已正常加载，但 `set_filters` 预检后仍偶发返回 `state_changed`，旧代码也可能把思源输出 DOM 属性的顺序变化当作内容变化。修复后的视图配置预检会规范化数据库载体的属性顺序，同时保留属性值与数据库绑定校验；真正的状态变化仍会拒绝写入。

若 provider 报 `recursive $ref cannot be inlined`，这是递归 schema 兼容性问题，与上面的引用丢失不同。包含修复的版本统一公开 Schema 和运行时校验，最多允许四层筛选组后接叶子节点，与内核限制一致。更新实际 MCP Server 并刷新工具列表；暂时无法更新时，可禁用 `av.set_filters` 后重新连接。

## 桌面内核正常但 MCP 返回 kernel_unreachable

桌面工作空间可能使用 `https://127.0.0.1:<动态端口>`。Electron 能接受本地证书，但 MCP 的 Node 子进程可能不信任它，从而返回 `fetch failed`。插件对回环地址使用同一端口的 HTTP 内核接口，保留当前工作空间端口；远程 HTTPS 地址仍保留 TLS 校验。更新 dev 产物后，在插件设置中关闭再开启 Sisyphus，使启动器重新获取地址。

多工作空间同时运行时，连接面板生成的 stdio 配置与“复制给 AI”使用各自窗口的内核地址，并与该工作空间的脚本路径及 Token 配对，不再固定为 6806。已有客户端配置不会自动更新，需重新复制；内核动态端口变化后也需更新配置。若同时启用两套 MCP HTTP 服务，请为它们选择不同的 MCP 监听端口。CLI 的 `siyuan-sisyphus instances` 会列出每个正在运行的内核 `--port`。已保存的回环 profile 会跟着工作空间 API token 匹配到的内核；发布服务端口不是内核 API。
