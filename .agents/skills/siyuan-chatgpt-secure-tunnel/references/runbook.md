# macOS 思源 Secure MCP Tunnel 执行手册

## 目录

1. 执行原则
2. 下载、安装并启用 SiYuan Sisyphus
3. 本地只读检查
4. Platform 与 ChatGPT 检查
5. 钥匙串录入
6. tunnel-client 安装
7. 启动脚本与 LaunchAgent
8. Profile、诊断与启动
9. ChatGPT 与端到端验证
10. 故障定位
11. 最终交付
12. 原提示词覆盖检查

## 1. 执行原则

先逐项对照用户给出的任务提示词，再读取当前 OpenAI 官方文档与 `tunnel-client help quickstart`。用户目标与安全约束必须完整保留；具体页面、权限名、CLI 参数和健康端点若已变化，以执行时的官方文档与当前 CLI 为准。下面的命令是结构模板；在真正写入脚本、profile 或 plist 前解析所有路径和参数，禁止保留 `<...>`、`__...__` 等占位符。

所有检查避免输出 Token。不要把 Token 放入聊天、工具调用参数、普通命令行参数、脚本正文、plist、Git、日志、截图、剪贴板历史或临时明文文件。不要使用 `set -x`、`env`、`printenv`、带密钥的 `echo` 或会记录请求头的详细 HTTP 日志。

浏览器操作优先复用已登录会话。创建 tunnel、API Key 或 ChatGPT 插件后立即记录非敏感状态，避免重复创建。遇到登录、验证码、密钥一次性显示或权限授予时，让用户只完成该动作，然后继续。

不要在缺少 Sisyphus 的情况下只配置 tunnel。OpenAI Secure MCP Tunnel 负责私有传输，SiYuan Sisyphus 才是把思源能力暴露为 MCP Tool 的本地 Server，两者缺一不可。

本手册只配置私有开发者模式连接。不要发布思源插件或 npm 包，不要创建 tag、GitHub Release、集市发布或临时公网隧道。

## 2. 下载、安装并启用 SiYuan Sisyphus

### 首选：从思源集市安装

1. 打开思源桌面端。
2. 进入 `设置 → 集市`。
3. 搜索 `SiYuan Sisyphus`。
4. 安装并启用插件 `siyuan-plugins-mcp-sisyphus`。
5. 打开 `插件 → SiYuan Sisyphus MCP & CLI → 设置`。
6. 配置并保存笔记本权限；端到端验证涉及的笔记本至少设为只读 `r`。

若用户需要在集市完成登录、确认安装或授权，只暂停在该动作；完成后继续检查，不要改成从未知来源下载。

### 回退：从项目官方 Release 下载

集市确实不可用时，打开项目官方 Release：

```text
https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/releases/latest
```

下载最新正式版 `package.zip`，并在安装前检查压缩包至少包含：

- `plugin.json`，其中 `name` 必须是 `siyuan-plugins-mcp-sisyphus`；
- `mcp-server.cjs`；
- 插件前端入口和其余发布文件。

把完整发布包安装到实际工作空间的：

```text
<工作空间>/data/plugins/siyuan-plugins-mcp-sisyphus/
```

确保最终 `plugin.json` 直接位于上述目录，不要多套一层解压目录。升级已有安装时先创建可恢复备份，不要混用两个 release 的文件；随后重启思源或重载插件，并打开设置面板保存权限。

只有用户明确要求开发版时，才从源码执行 `pnpm install`、`pnpm build` 和 `pnpm make-link`。长期使用优先集市正式版，其次官方 Release 正式包。

### 就绪检查

全部满足才继续：

- 思源插件列表显示 Sisyphus 已启用；
- `/data/plugins/siyuan-plugins-mcp-sisyphus/plugin.json` 可通过思源 API 读取且名称正确；
- 权限配置文件可通过思源 API 读取；
- 本机可访问同一安装或同一 release 的 `mcp-server.cjs`；
- `mcp-server.cjs` 所在路径对 `tunnel-client` 启动的本地进程可见。

## 3. 本地只读检查

### 基础环境

```zsh
/usr/bin/uname -m
/usr/bin/id -u
/usr/bin/id -un
command -v node
/usr/bin/pgrep -fl 'SiYuan|siyuan' || true
/usr/sbin/lsof -nP -iTCP:6806 -sTCP:LISTEN || true
```

必须把 `command -v node` 的结果解析成绝对路径。LaunchAgent 的 PATH 很窄，不依赖 `/usr/bin/env node`。

### 思源内核与工作空间

从运行中思源进程、应用设置或已知工作空间位置解析真实工作空间。检查但不要输出 `.api.token`：

```zsh
/bin/test -f "${SIYUAN_WORKSPACE}/conf/conf.json"
(
  SIYUAN_TOKEN_CHECK="$(/usr/bin/plutil -extract api.token raw -o - \
    "${SIYUAN_WORKSPACE}/conf/conf.json")"
  /bin/test -n "$SIYUAN_TOKEN_CHECK"
  unset SIYUAN_TOKEN_CHECK
)
```

上述命令只使用退出码确认 `.api.token` 存在且非空，不要打印提取结果。这里的 Token 是思源内核 API Token，不是 Sisyphus 插件设置中的 MCP HTTP Bearer Token。

寻找实际插件产物，优先检查：

```text
<工作空间>/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs
```

若插件使用开发链接，也检查符号链接解析后的真实文件。不要假设工作空间一定是 `~/SiYuan`。

### 已有隧道服务

```zsh
/bin/test -x "$HOME/.local/bin/tunnel-client"
/bin/launchctl print "gui/$(/usr/bin/id -u)/com.local.siyuan-gpt-tunnel"
/usr/bin/pgrep -fl 'tunnel-client|mcp-server.cjs' || true
```

如果 binary 已存在，先运行：

```zsh
"$HOME/.local/bin/tunnel-client" --help
"$HOME/.local/bin/tunnel-client" help quickstart
```

从帮助、profile 或运行日志确认本地管理端口；常见地址是 `127.0.0.1:8080`，不要在 CLI 已改变时盲用旧端口。

### 出站网络前置检查

Secure MCP Tunnel 不要求任何入站端口，但本机必须能够通过 HTTPS 出站连接 OpenAI control plane：

```zsh
/usr/bin/nc -G 5 -z api.openai.com 443
```

如果组织启用了 control-plane mTLS，再检查 `mtls.api.openai.com:443`。失败时先诊断 DNS、代理、防火墙或企业网络策略；不要降级为 ngrok、Cloudflare Quick Tunnel 或其他临时公网隧道。

## 4. Platform 与 ChatGPT 检查

打开当前官方入口：

- Secure MCP Tunnel 文档：`https://developers.openai.com/api/docs/guides/secure-mcp-tunnels`
- Tunnel 设置：`https://platform.openai.com/settings/organization/tunnels`
- API Keys：`https://platform.openai.com/settings/organization/api-keys`
- ChatGPT 插件：`https://chatgpt.com/plugins`

在 Tunnel 设置中查找名称包含 `SiYuan` 或 `思源` 的 tunnel。复用时确认：

- `tunnel_id` 与本机 profile 一致；
- 当前 Personal/目标 Platform Organization 已关联；
- 目标 ChatGPT workspace 已关联；
- 当前操作者具有所需权限。

不存在时创建：

- 名称：`SiYuan Local MCP`
- 描述：`Secure access to the local SiYuan MCP server on this Mac.`

创建/编辑需要 `Tunnels Read + Manage`；运行和选择需要 `Tunnels Read + Use`。权限刚分配时可能需要等待传播，以官方文档当时说明为准。

创建专用 Runtime API Key：

- 名称：`SiYuan MCP Tunnel Auto`
- 项目：当前默认项目
- 用途：仅供本机 `tunnel-client`
- 权限主体：至少 `Tunnels Read + Use`

## 5. 钥匙串录入

不要把密钥放进命令行参数。macOS `security` 明确支持把 `-w` 放在最后以交互提示密码：

```zsh
/usr/bin/security add-generic-password \
  -U \
  -a "$USER" \
  -s "openai-siyuan-tunnel-control-plane" \
  -w
```

让用户在无回显提示中直接粘贴刚创建的 Runtime API Key，不要把它发到聊天或普通终端命令中。

用同样方式录入工作空间 `conf/conf.json` 的 `.api.token`：

```zsh
/usr/bin/security add-generic-password \
  -U \
  -a "$USER" \
  -s "siyuan-mcp-api-token" \
  -w
```

如果当前自动化界面能把密钥直接送入钥匙串的隐藏输入框，可在不经过聊天、工具参数、shell 历史、剪贴板历史或临时文件的前提下完成；否则暂停在无回显提示，只让用户完成一次粘贴并回车，然后从当前步骤继续。不要为追求全自动而降低密钥保护。

只通过退出码验证存在，不加 `-w` 读取值：

```zsh
/usr/bin/security find-generic-password \
  -a "$USER" \
  -s "openai-siyuan-tunnel-control-plane" \
  >/dev/null

/usr/bin/security find-generic-password \
  -a "$USER" \
  -s "siyuan-mcp-api-token" \
  >/dev/null
```

## 6. tunnel-client 安装

从 Platform Tunnel 设置中的下载链接，或 OpenAI 官方 `tunnel-client` 最新正式发布页下载：

```text
https://github.com/openai/tunnel-client/releases/latest
```

按 `uname -m` 选择 macOS 架构：`arm64` 对应 release 名称中的 `darwin-arm64`，`x86_64` 对应 `darwin-amd64`。同时下载同一 release 的 `SHA256SUMS.txt`。不要硬编码版本号或资产文件名，也不要从第三方镜像下载。

在 `mktemp -d` 生成的临时目录中确认 `SHA256SUMS.txt` 包含下载资产的精确文件名，并校验 SHA-256，例如：

```zsh
/usr/bin/shasum -a 256 "<DOWNLOADED_ARCHIVE>"
```

把输出与 `SHA256SUMS.txt` 中该文件名对应的值逐字符比较。只有文件名与校验和均匹配才解压并安装到：

```text
~/.local/bin/tunnel-client
```

设置可执行权限，运行 `--help` 和 `help quickstart`。实际执行命令时将 `<DOWNLOADED_ARCHIVE>` 替换成已解析的临时文件绝对路径；不要使用来源不明的二进制。

如果官方 release 没有提供可验证的校验和，停止安装并明确报告，不要跳过校验或自行信任下载结果。

## 7. 启动脚本与 LaunchAgent

创建目录并限制权限：

```zsh
/bin/mkdir -p "$HOME/.local/share/siyuan-gpt-tunnel"
/bin/chmod 700 "$HOME/.local/share/siyuan-gpt-tunnel"
/bin/mkdir -p "$HOME/Library/Logs/siyuan-gpt-tunnel"
```

### run-siyuan-mcp.sh

把已解析的 Node.js 与插件绝对路径写入脚本。使用如下结构，但执行时不得保留占位符：

```zsh
#!/bin/zsh
set -euo pipefail

SIYUAN_KEY="$('/usr/bin/security' find-generic-password \
  -a "$USER" \
  -s "siyuan-mcp-api-token" \
  -w)"

for attempt in {1..120}; do
  if /usr/bin/curl -fsS \
    -H "Authorization: Token ${SIYUAN_KEY}" \
    -H "Content-Type: application/json" \
    -d '{}' \
    "http://127.0.0.1:6806/api/system/version" \
    >/dev/null 2>&1; then
    export SIYUAN_API_URL="http://127.0.0.1:6806"
    export SIYUAN_TOKEN="${SIYUAN_KEY}"
    export SIYUAN_MCP_TRANSPORT="stdio"
    unset SIYUAN_KEY
    exec "<NODE_ABSOLUTE_PATH>" \
      "<SIYUAN_PLUGIN_PATH>/mcp-server.cjs"
  fi
  /bin/sleep 2
done

print -u2 "SiYuan did not become ready within 4 minutes."
exit 1
```

说明：MCP stdio 的 stdout 只能承载协议消息；普通日志只能写 stderr。脚本权限设为 `700`。

### run-tunnel.sh

```zsh
#!/bin/zsh
set -euo pipefail

export CONTROL_PLANE_API_KEY="$('/usr/bin/security' find-generic-password \
  -a "$USER" \
  -s "openai-siyuan-tunnel-control-plane" \
  -w)"

exec "$HOME/.local/bin/tunnel-client" \
  run \
  --profile siyuan-web
```

脚本权限设为 `700`。不要输出环境变量或启用 shell trace。

### LaunchAgent

创建 `~/Library/LaunchAgents/com.local.siyuan-gpt-tunnel.plist`。以下是完整结构模板：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.local.siyuan-gpt-tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>__RUN_TUNNEL_ABSOLUTE_PATH__</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>__LOG_DIRECTORY_ABSOLUTE_PATH__/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>__LOG_DIRECTORY_ABSOLUTE_PATH__/stderr.log</string>
</dict>
</plist>
```

写入前把两个占位符替换为当前用户的真实绝对路径，并进行 XML 转义；最终文件中不得残留 `__...__`。如果目标文件已存在且内容不同，先创建带时间戳的可恢复备份，再只修改必要字段。

不要在 plist 中写入 Token 或整个环境快照。写入后执行：

```zsh
/usr/bin/plutil -lint "$HOME/Library/LaunchAgents/com.local.siyuan-gpt-tunnel.plist"
```

## 8. Profile、诊断与启动

先按当前帮助确认参数，再初始化：

```zsh
"$HOME/.local/bin/tunnel-client" init \
  --sample sample_mcp_stdio_local \
  --profile siyuan-web \
  --tunnel-id "<TUNNEL_ID>" \
  --mcp-command "$HOME/.local/share/siyuan-gpt-tunnel/run-siyuan-mcp.sh" \
  --force
```

检查生成的 profile 使用 `env:CONTROL_PLANE_API_KEY`，禁止把 Key 写入 YAML。然后在不会打印变量、且执行结束后自动销毁环境的子 shell 中从钥匙串注入并执行：

```zsh
(
  export CONTROL_PLANE_API_KEY="$('/usr/bin/security' find-generic-password \
    -a "$USER" \
    -s "openai-siyuan-tunnel-control-plane" \
    -w)"
  exec "$HOME/.local/bin/tunnel-client" doctor \
    --profile siyuan-web \
    --explain
)
```

只有 `RESULT ok` 后才加载 LaunchAgent：

```zsh
SERVICE_TARGET="gui/$(/usr/bin/id -u)/com.local.siyuan-gpt-tunnel"

if /bin/launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
  /bin/launchctl bootout "$SERVICE_TARGET"
fi

/bin/launchctl bootstrap \
  "gui/$(/usr/bin/id -u)" \
  "$HOME/Library/LaunchAgents/com.local.siyuan-gpt-tunnel.plist"

/bin/launchctl kickstart -k \
  "gui/$(/usr/bin/id -u)/com.local.siyuan-gpt-tunnel"
```

先用 `launchctl print` 判断服务是否存在，因此不需要用 `|| true` 吞掉错误；`bootout` 的任何真实失败都必须停止并诊断。

从实际配置确认管理端口后检查：

```zsh
/usr/bin/curl -fsS http://127.0.0.1:8080/healthz
/usr/bin/curl -fsS http://127.0.0.1:8080/readyz
/bin/launchctl print \
  "gui/$(/usr/bin/id -u)/com.local.siyuan-gpt-tunnel"
/usr/bin/pgrep -fl 'tunnel-client|mcp-server.cjs'
```

期望 health/ready 分别返回类似 `live` 与 `ready`。本地 `/ui` 默认只保留 loopback 访问，不要远程暴露。

## 9. ChatGPT 与端到端验证

在 `https://chatgpt.com/plugins` 中：

1. 确认目标 workspace 已启用开发者模式；
2. 新建或管理现有个人思源插件；
3. Connection 选择 `Tunnel`；
4. 选择与本机 profile 相同的固定 tunnel；
5. 若现有插件已经绑定，使用管理/刷新，不要卸载重建；
6. 确认界面显示类似“已连接到 思源笔记”的成功状态；产品文案可能变化，因此仍以真实工具调用为最终判据。

连接成功后实际执行只读调用：

- `system(action="get_version")`
- `notebook(action="list")`
- 只读访问 `/AGENTS.md`
- 只读访问 `/USER_RULES.md`

只报告版本调用和笔记本列表调用是否成功；不要复述笔记本名称或笔记正文。

只有以下条件全部成立，才宣布端到端完成：

- ChatGPT 不再出现 `MCP SSE probe returned 404`；
- ChatGPT 或本地链路不再出现 `401 Unauthorized`；
- `system(action="get_version")` 返回真实思源版本；
- `notebook(action="list")` 返回真实笔记本列表；
- `/healthz` 为 live，`/readyz` 为 ready；
- LaunchAgent 状态为 running；
- `tunnel-client` 与 Sisyphus `mcp-server.cjs` 两个进程都存在。

## 10. 故障定位

### Sisyphus 缺失或未就绪

确认插件清单名、启用状态、设置初始化和笔记本权限。若只存在 `mcp-server.cjs` 而思源内没有安装并启用对应 Sisyphus 插件，返回安装阶段；不要把单个 Server 文件当成完整安装。

若插件刚升级，确认本地启动的 `mcp-server.cjs` 来自同一版本发布包，再重启 LaunchAgent。

### 404 或 SSE probe 失败

依次确认：

1. `tunnel-client` 仍在运行；
2. `/readyz` 为 ready；
3. ChatGPT 插件选择的 tunnel 与 profile 的 `tunnel_id` 一致；
4. tunnel 已关联目标 ChatGPT workspace；
5. 当前用户具有 `Tunnels Read + Use`。

不要用反复卸载插件代替诊断。

### 401 Unauthorized

重点确认 `SIYUAN_TOKEN` 来自工作空间 `conf/conf.json` 的 `.api.token`，不是插件 MCP HTTP Bearer Token。Token 变更后以无回显方式更新 `siyuan-mcp-api-token` 钥匙串项目，再 kickstart LaunchAgent。

### LaunchAgent 找不到 node

检查脚本是否写入 `command -v node` 得到的绝对路径，以及该路径在当前用户登录会话中可执行。不要改回 `/usr/bin/env node`。

### 思源未启动或未就绪

确认脚本确实循环等待约四分钟，错误写入 stderr，退出后由 `KeepAlive` 重新拉起。不要把一次未就绪误判为永久配置失败。

### doctor 失败

保留 `--explain` 输出中的非敏感诊断，核对 profile、运行时权限、组织/workspace 关联、出站 HTTPS 与本地 MCP 启动。不要启用包含请求头或环境变量的详细日志。

## 11. 最终交付

最终回复必须明确说明：

- Sisyphus 的安装来源、版本、启用状态、设置和只读权限是否就绪；
- `tunnel-client` 是否来自官方最新正式 release，以及 SHA-256 是否校验通过；
- 固定 tunnel、`siyuan-web` profile 和 ChatGPT 插件是否复用或创建；
- LaunchAgent 是否已加载并可自动启动；
- doctor、health、ready、进程和 ChatGPT 真实只读调用各自是否通过；
- `run-siyuan-mcp.sh`、`run-tunnel.sh`、plist 的实际路径，以及仅限 loopback 的本地 `/ui` 地址；
- 仍缺少的权限或用户必须完成的唯一动作，以及完成后应从哪个步骤继续。

最终回复不得包含 Runtime API Key、思源 Token、完整请求头、钥匙串内容、`tunnel_id`、笔记本名称或私有笔记正文。不得声称已经发布插件、npm 包、tag、Release 或公开连接；本流程不执行这些发布动作。

## 12. 原提示词覆盖检查

执行前和最终汇报前各检查一次，15 项均有事实结果，不能用“已连接”替代未完成的验证：

| 原提示词章节 | 本手册对应位置 | 必须留下的非敏感证据 |
| --- | --- | --- |
| 一、基本要求 | 第 1 节 | 官方 Tunnel、固定地址、钥匙串、只读、不降级公网暴露 |
| 二、检查本地环境 | 第 3 节 | 思源进程/端口、工作空间、Node 绝对路径、Sisyphus、现有 client/tunnel |
| 三、准备固定隧道 | 第 4 节 | 复用或创建、Organization 与 ChatGPT workspace 关联 |
| 四、Runtime API Key | 第 4、5 节 | 专用主体具备 Read + Use，钥匙串项目存在 |
| 五、思源 API Token | 第 3、5 节 | `.api.token` 非空且已入钥匙串，未误用 HTTP Bearer Token |
| 六、安装 tunnel-client | 第 6 节 | 最新官方正式版、架构匹配、`SHA256SUMS.txt` 校验通过 |
| 七、思源 MCP 脚本 | 第 7 节 | zsh、四分钟等待、绝对路径、stdio、stderr、权限 700 |
| 八、创建 Profile | 第 8 节 | 固定 tunnel、`siyuan-web`、环境变量引用、doctor ok |
| 九、隧道启动脚本 | 第 7 节 | Runtime Key 仅从钥匙串读取、权限 700 |
| 十、macOS 自动启动 | 第 7、8 节 | plist lint、RunAtLoad/KeepAlive/Throttle、bootstrap/kickstart |
| 十一、隧道状态 | 第 8 节 | live、ready、running、两个进程、本地 `/ui` |
| 十二、连接 ChatGPT | 第 9 节 | 开发者模式、Tunnel 连接、固定 tunnel、优先刷新已有插件 |
| 十三、端到端验证 | 第 9 节 | 版本、笔记本列表、`/AGENTS.md`、`/USER_RULES.md` 的真实只读调用 |
| 十四、故障处理 | 第 10 节 | 404、401、Node、思源未启动、Token 轮换均有诊断路径 |
| 十五、最终交付 | 第 11 节 | 状态、路径、`/ui`、剩余用户动作，且无任何敏感值 |
