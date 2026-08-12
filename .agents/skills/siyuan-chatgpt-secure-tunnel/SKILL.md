---
name: siyuan-chatgpt-secure-tunnel
description: 在 macOS 上下载、安装或升级 SiYuan Sisyphus 插件，并配置、修复和验证 ChatGPT 网页端通过 OpenAI 官方 Secure MCP Tunnel 安全访问本地思源笔记。用于确认 Sisyphus 已启用且 mcp-server.cjs 与笔记本权限就绪、复用或创建固定 tunnel、安装并诊断 tunnel-client、将 OpenAI Runtime API Key 与思源内核 API Token 安全保存到 macOS 钥匙串、创建 stdio MCP 启动脚本和 LaunchAgent、连接 ChatGPT 开发者模式插件，以及排查 401、404、未就绪、插件缺失或自动启动失败等问题。仅适用于私有开发者模式连接，不用于公开插件发布或临时公网隧道。
---

# 配置思源 ChatGPT 安全隧道

先下载、安装并启用 **SiYuan Sisyphus**，再把以下链路配置为可恢复、可诊断、开机自动运行的长期连接：

`ChatGPT 网页端 → OpenAI Secure MCP Tunnel → 本机 tunnel-client → 思源 MCP stdio Server → 本地思源内核`

直接执行配置、诊断和只读验证。不要只给操作说明。开始前完整读取 [references/runbook.md](references/runbook.md)，并以执行时获取的 OpenAI 官方文档和本机实际状态为准。

## 把 Sisyphus 视为强制前置依赖

- 不要把 tunnel 直接指向裸思源内核。Tunnel 的本地 MCP Server 必须是 SiYuan Sisyphus 提供的 `mcp-server.cjs`。
- 先确认插件清单名为 `siyuan-plugins-mcp-sisyphus`，插件已启用，且插件目录同时存在有效的 `plugin.json` 与 `mcp-server.cjs`。
- 插件缺失时，优先在思源集市搜索 `SiYuan Sisyphus` 并安装；集市不可用时，才从项目官方 GitHub Release 下载最新正式版 `package.zip`。不要从第三方镜像下载。
- 安装或升级后，打开 `插件 → SiYuan Sisyphus MCP & CLI → 设置`，至少为端到端验证所需笔记本配置只读权限并保存。插件未启用、设置未初始化或权限文件未就绪时，不要继续创建 tunnel profile。
- 若单独复制或解压 `mcp-server.cjs`，确保它与当前安装的 Sisyphus 插件来自同一 release；插件升级后同步更新，避免客户端 Server 与插件版本漂移。

## 严守安全边界

- 只使用 OpenAI 官方 Secure MCP Tunnel。不要改用 ngrok、Cloudflare Quick Tunnel、端口转发或其他公网暴露方案。
- 这条链路只用于 ChatGPT 开发者模式下的私有连接。配置过程中不要发布思源插件、npm 包或公开连接，也不要创建 tag、GitHub Release 或集市发布产物。
- 不在回复、工具参数、命令行参数、脚本、plist、Git、日志、截图、剪贴板历史或临时明文文件中展示或保存任何密钥。
- 把 OpenAI Runtime API Key 和思源内核 API Token 分别保存到 macOS 钥匙串。需要录入密钥时，让用户直接在隐藏输入提示或钥匙串界面中完成；不要让用户把密钥发到聊天里。
- 区分两种思源 Token：stdio MCP 的 `SIYUAN_TOKEN` 必须来自工作空间 `conf/conf.json` 的 `.api.token`；不要使用插件 `mcpHttpSettings` 中的 MCP HTTP Bearer Token。
- 不创建、更新、移动、删除或覆盖任何思源文档、块、数据库、资源、标签、闪卡或笔记本。验证只调用只读 action。
- 不删除现有 tunnel、ChatGPT 插件、钥匙串项目或用户配置。优先复用并修复；覆盖脚本、profile 或 plist 前先读取、比对并保留可恢复备份。
- 如果缺少 Platform Tunnel 权限、目标 ChatGPT workspace 关联、开发者模式、登录、验证码或系统授权，停在对应页面，只说明用户需要完成的单一动作；完成后从当前步骤继续。
- 写入 `~/.local`、`~/Library/LaunchAgents`、钥匙串或 Platform/ChatGPT 账号属于预期配置动作，但仍须遵守当前执行环境的审批机制。

## 按阶段执行

### 1. 下载、安装并启用 SiYuan Sisyphus

检查思源集市或工作空间插件目录。已安装时复用并核对版本、启用状态、设置和权限；未安装时完成下载、安装和启用。只有以下条件全部满足才继续：

- `/data/plugins/siyuan-plugins-mcp-sisyphus/plugin.json` 可读，且 `name` 正确；
- 本机可执行路径下存在同版本 `mcp-server.cjs`；
- 插件设置面板已至少打开并保存一次；
- 端到端只读测试所需的笔记本权限已配置；
- 重启或重载插件后，思源内核仍可访问。

### 2. 建立事实基线

先做只读检查，记录但不要泄露敏感值：

- macOS 架构、当前用户、Node.js 绝对路径；
- 思源桌面端、`127.0.0.1:6806`、真实工作空间路径；
- Sisyphus 的安装来源、版本、启用状态、权限就绪状态，以及 `mcp-server.cjs` 的真实路径；
- `tunnel-client`、`siyuan-web` profile、LaunchAgent 和健康端点是否已经存在；
- 本机能否出站访问 `api.openai.com:443`（启用 control-plane mTLS 时还要检查 `mtls.api.openai.com:443`），以及本地 Sisyphus stdio MCP 是否可启动；
- Platform 是否已有名称包含 `SiYuan` 或 `思源` 的 tunnel；
- ChatGPT 是否已有绑定同一 tunnel 的思源插件。

把每项判定为“复用、修复或创建”。不要因局部失败重建整条链路。

### 3. 核对当前官方要求

在任何 Platform 或 ChatGPT 账号变更前，打开当前 [OpenAI Secure MCP Tunnel 官方文档](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)，核对最新权限、下载入口、profile 参数、健康端点和 ChatGPT 连接入口。只信任 OpenAI 官方文档与官方发布页，不硬编码未来版本。

明确区分权限：

- 查看 tunnel：`Tunnels Read`；
- 创建或编辑 tunnel：`Tunnels Read + Manage`；
- 运行 `tunnel-client` 或在 ChatGPT 中选择 tunnel：`Tunnels Read + Use`；
- ChatGPT 开发者模式是独立的 workspace 权限。

### 4. 复用或创建固定 tunnel

通过已登录浏览器检查 Platform Tunnel 设置。优先复用已有思源 tunnel，并确认它同时关联正确的 Platform Organization 和目标 ChatGPT workspace。只有确实不存在时才创建固定 tunnel，名称使用 `SiYuan Local MCP`，描述使用 `Secure access to the local SiYuan MCP server on this Mac.`。

记录 `tunnel_id` 供本机 profile 使用，但不要在最终回复中无意义地公开。

### 5. 安全准备凭据

为本机 `tunnel-client` 创建专用 Runtime API Key，确保主体具有 `Tunnels Read + Use`。将它保存为钥匙串服务 `openai-siyuan-tunnel-control-plane`。

验证工作空间 `conf/conf.json` 存在非空 `.api.token`，不要打印它。将它保存为钥匙串服务 `siyuan-mcp-api-token`。用无回显交互方式录入两项密钥，并用只检查退出码的方式确认钥匙串项目存在。

### 6. 安装并配置本机服务

从官方最新正式发布安装匹配 `uname -m` 的 `tunnel-client`，校验官方 SHA-256 后放到 `~/.local/bin/tunnel-client`。先运行 `--help` 和 `help quickstart`，再按当前 CLI 实际参数初始化固定 profile。

创建并校验：

- `~/.local/share/siyuan-gpt-tunnel/run-siyuan-mcp.sh`
- `~/.local/share/siyuan-gpt-tunnel/run-tunnel.sh`
- `~/Library/LaunchAgents/com.local.siyuan-gpt-tunnel.plist`

启动脚本只从钥匙串取密钥；plist 不含密钥。思源 MCP 脚本必须使用 Node.js 和 `mcp-server.cjs` 的绝对路径，显式使用 stdio，等待内核约四分钟，且不得向 stdout 写普通日志。

### 7. 分层验证

按顺序验证，前一层失败时先修复，不要跳过：

1. Sisyphus 插件已安装、启用、设置完成，且 `mcp-server.cjs` 与插件版本一致；
2. 思源内核版本 API 可访问，认证成功；
3. Sisyphus MCP stdio 进程能启动且 stdout 未被日志污染；
4. `tunnel-client doctor --profile siyuan-web --explain` 返回 `RESULT ok`；
5. LaunchAgent 为 running，`tunnel-client` 与 Sisyphus MCP 子进程均存在；
6. 实际健康端点返回 live/ready，本地 `/ui` 可访问；
7. ChatGPT 插件显示连接成功；
8. 通过 ChatGPT 实际调用 `system(action="get_version")`、`notebook(action="list")`，并只读访问 `/AGENTS.md` 与 `/USER_RULES.md`。

只有以下条件同时成立才算成功：doctor 为 `RESULT ok`，health/ready 分别为 live/ready，LaunchAgent 与两个本地进程持续运行，ChatGPT 不再出现 `MCP SSE probe returned 404` 或 `401 Unauthorized`，并且实际返回真实的思源版本与笔记本列表。不要把“页面显示已连接”当成端到端成功。不要在报告中列出笔记本名称或私有笔记正文。

## 保持幂等并支持续做

- 已正确存在的 Sisyphus 插件、binary、tunnel、profile、脚本、plist、钥匙串项目或 ChatGPT 插件直接复用。
- 配置内容不一致时只修改必要字段；保留无关设置。
- 用户完成登录、验证码、密钥录入或授权后，从暂停点继续，不重新执行已通过的阶段。
- Token 轮换后只更新对应钥匙串项目并重启 LaunchAgent，不重建 tunnel。

## 最终汇报

只汇报：Sisyphus 的安装来源、版本与启用状态，tunnel-client 是否安装成功，是否已配置自动启动，health/ready 状态，是否成功读取思源版本和笔记本列表，脚本与 plist 的路径，本地状态面板地址，以及仍缺失的权限或用户动作。

不要包含 API Key、思源 Token、完整请求头、钥匙串内容、`tunnel_id`、私有笔记内容或笔记本名称。
