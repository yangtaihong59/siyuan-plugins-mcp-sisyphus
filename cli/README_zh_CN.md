# siyuan-sisyphus

[English](./README.md) | [中文](./README_zh_CN.md)

> ⚠️ **前置要求：本 CLI 需要配合本仓库的 `siyuan-plugins-mcp-sisyphus` 插件使用。** 请先在 SiYuan 中安装并启用该插件，然后打开插件设置面板完成权限配置后再执行 CLI 工具命令。CLI 现在会主动检查这一前置条件；如果插件未安装或尚未初始化，会直接提示并退出。

这是一个用于直接通过命令行操作 [SiYuan Note](https://b3log.org/siyuan) 的 CLI。你可以把它理解成思源版的 `obsidian-cli`：每个 MCP 工具（`fs`、`block`、`document`、`notebook`、`av`、`search`、`tag`、`file`、`timeline`、`system`、`flashcard`、`extension`、`mascot`、`feedback`）都会暴露成可在 shell 中直接调用的子命令。

> **最新版本：**`v0.2.4` 将严格写入转交插件内置 HTTP 协调器。Agent 可提交最少 4 位的短期哈希租约凭据，但协调器在正式写入前始终比较完整 SHA-256，并在 CLI、stdio 与 HTTP 之间维持统一的请求幂等语义。

> **给 AI 模型和编码 Agent 的要求：** 在使用本 CLI 继续处理任何思源任务前，请先运行 `siyuan-sisyphus skill install`。随包 skills 会提供安全搜索、阅读、编辑、导出、数据库、标签、闪卡、时间线和系统操作等任务的专用规则。

发布到 npm 的包名是 `siyuan-sisyphus`。安装后主命令为 `siyuan-sisyphus`，同时也提供更短的别名 `sisyphus`，避免与思源官方 CLI 冲突。

```bash
siyuan-sisyphus notebook list
siyuan-sisyphus document create --notebook 20240318... --path "/Inbox/Test" --markdown "正文从这里开始"
siyuan-sisyphus block append --parent-id 20240318abc --data-type markdown --data "- item"
siyuan-sisyphus search fulltext --query "keyword" --page-size 10 --json | jq '.data[].hPath'
```

## 要求

- Node.js 18+
- 一个可通过 HTTP 访问的 SiYuan 实例（本地或远程均可）
- SiYuan API Token（`SiYuan > 设置 > 关于 > API token`）

## 严格安全写入

插件默认在“设置 → MCP → 设置与调试”开启严格安全写入。变更命令需要先以 `validateOnly=true` 调用对应 action，再提交新的 UUIDv7 `requestId` 和预检返回的 `expected*Hash`。返回值是仅存在于内存中的临时租约凭据，通常从 4 位十六进制开始；它不会被当作 16 bit 状态值直接比较，HTTP 协调器会先解析租约中的完整 SHA-256，再与写入前重新读取的完整状态哈希比较。

执行严格 CLI 写入时必须保持插件内置 MCP HTTP 服务开启。CLI 会把写入转交同一个协调器，避免 CLI、stdio 与 HTTP 各自产生独立租约池。租约过期、已消费或插件重启后必须重新预检。关闭严格写入会恢复旧版直接调用协议，不再提供哈希并发校验、请求幂等和写后验证。

## 安装

```bash
# 全局安装；会同时安装 `siyuan-sisyphus` 和 `sisyphus`
npm i -g siyuan-sisyphus

# 或者不安装，直接执行一次
npx -p siyuan-sisyphus siyuan-sisyphus --help
```

## 快速开始

```bash
siyuan-sisyphus init
# 按提示输入 profile 名、API URL 和 token。这会写入 ~/.siyuan-sisyphus/config.json（权限 0600）。

siyuan-sisyphus skill install # Agent / 模型继续工作前应先安装 skills
siyuan-sisyphus notebook list  # 验证连通性
siyuan-sisyphus config list    # 查看已保存的 profile
siyuan-sisyphus list           # 查看所有可用工具
siyuan-sisyphus list block     # 查看某个工具下的所有 action
siyuan-sisyphus help block append
```

## Agent Skill 套件

npm 包携带两套相关的 Skill：

- `cli` 使用终端命令示例，并且仍是 `skill list`、`skill read` 和 `skill install` 的默认套件。
- `mcp` 使用 MCP 工具调用示例，适合通过插件 Server 连接的 Agent。

```bash
siyuan-sisyphus skill list --bundle mcp
siyuan-sisyphus skill read siyuan-mcp-browse-read --bundle mcp
siyuan-sisyphus skill install --bundle mcp
siyuan-sisyphus skill install --bundle all
```

使用 `--bundle all` 可同时安装两套。普通 MCP 客户端无需在本地安装：它们可以直接从 Server 读取 `siyuan://skills/index` 和 `siyuan://skills/{name}`，也可以显式调用对应的 MCP Prompt；Prompt 不会自动激活。精确且最新的 action 参数请以 `siyuan://help/action/{tool}/{action}` 为准，Skill 主要负责工作流与安全规则。

## 命令格式

```
siyuan-sisyphus <tool> <action> [--flag value ...]   执行任意 MCP 工具 action
siyuan-sisyphus list [tool]                          列出所有工具，或某个工具的 action
siyuan-sisyphus help <tool> [action]                 查看某个工具或 action 的详细帮助
siyuan-sisyphus init                                 交互式初始化配置
siyuan-sisyphus config list|get|set|use ...          管理已保存的 SiYuan profile
siyuan-sisyphus skill list|read|install [--bundle cli|mcp|all]
                                                     查看或安装 Agent Skill
siyuan-sisyphus --help | -h                          显示顶层帮助
siyuan-sisyphus --version | -v                       显示版本号
```

### Flag 约定

- **Kebab / camel / snake 都支持**：`--parent-id`、`--parentID`、`--parentId`、`--item_id` 都会映射到对应 schema 字段。
- **Action 名称**：`set_open_state` 和 `set-open-state` 两种写法都可用。
- **布尔值**：可写成 `--opened`（true）、`--opened=false` 或 `--no-opened`（false）。
- **数组**：可以重复传参（`--ids a --ids b`）、用逗号分隔（`--ids a,b`），或通过精确 JSON 传入（`--<key>-json '["a","b"]'`）。
- **复杂对象**：使用 JSON 形式的附加 flag，例如 `--assets-json '[{...}]'`。
- **`-json` 优先级**：如果普通 flag 和 `--<key>-json` 同时存在，以 JSON 附加 flag 为准。

### 全局参数

| 参数 | 作用 |
|---|---|
| `--config <file>` | 从 `<file>` 加载配置，而不是 `~/.siyuan-sisyphus/config.json` |
| `--profile <name>` | 本次调用使用指定的已保存 profile |
| `--url <url>` | 覆盖 SiYuan API URL |
| `--token <token>` | 覆盖 SiYuan API token |
| `--json` | 输出紧凑的单行 JSON，便于和 `jq` 等脚本工具配合 |
| `--debug` | 输出堆栈信息和被忽略 flag 的警告 |

### 翻页

分页结果沿用 MCP 工具的 `page` / `pageSize` 约定。在交互式终端中，人类可读输出会完整显示当前 MCP 页，并允许不切换到 JSON 也能翻页浏览：

- 按 `Enter` 或 `n` 查看下一页。
- 按 `p` 查看上一页。
- 按 `q`、`Esc` 或 `Ctrl+C` 退出翻页。

在管道和脚本场景中，请继续显式使用 `--page`、`--page-size` 和 `--json`。

`fs read`、`document get-doc` 等长 Markdown 读取使用完整显示块窗口，不再按字符切片。可根据返回的 `nextWindow` 通过 `--block-start` 继续读取，并按需使用 `--block-limit` 或 `--token-budget` 控制窗口：

```bash
siyuan-sisyphus fs read --path "/笔记本/长文档" --block-start 0 --block-limit 24
siyuan-sisyphus document get-doc --id 20240318xyz --block-start 24 --token-budget 6000
```

## 示例

```bash
# 笔记本
siyuan-sisyphus notebook list
siyuan-sisyphus --profile work notebook list
siyuan-sisyphus notebook create --name "Work" --icon 1f4d4

# 文档
siyuan-sisyphus document create --notebook 20240318... --path "/Inbox/Daily" --markdown "# Today"
siyuan-sisyphus document list-tree --notebook 20240318... --max-depth 2
siyuan-sisyphus document get-doc --id 20240318xyz --mode markdown

# 块
siyuan-sisyphus block info --id 20240318xyz
siyuan-sisyphus block append --parent-id 20240318abc --data-type markdown --data "- new item"
siyuan-sisyphus block get-kramdown --id 20240318xyz
siyuan-sisyphus block word-count --id 20240318xyz

# 搜索
siyuan-sisyphus search fulltext --query "TODO" --page-size 20
siyuan-sisyphus search fulltext --query "TODO" --page 2 --page-size 20
siyuan-sisyphus search query-sql --stmt "SELECT id, content FROM blocks WHERE type='h' LIMIT 5"

# 时间线 diff（请保留返回的 tag 与最新 changeKey）
siyuan-sisyphus timeline list-nodes --scope document --document-id 20240318xyz
siyuan-sisyphus timeline create-node --name "修改前" --scope document --document-id 20240318xyz
siyuan-sisyphus timeline compare-node --document-id 20240318xyz --tag <timeline-tag> --page-size 20

# 常用友好别名
siyuan-sisyphus fs replace --path "/Notebook/Doc" --old A --new B
siyuan-sisyphus av render --av-id <attribute-view-id>
siyuan-sisyphus file upload-asset --file /private/tmp/demo.txt

# 配合 jq 管道处理
siyuan-sisyphus notebook list --json | jq '.[] | select(.closed==false) | .name'
siyuan-sisyphus document search-docs --notebook <id> --query "proposal" --json | jq '.data[].hPath'
```

## 配置

优先级：**`--url`/`--token` > `--profile` > 环境变量 > 当前配置 profile > 默认值**。

### 环境变量

| 变量 | 作用 |
|---|---|
| `SIYUAN_API_URL` | SiYuan 基础 URL（默认 `http://127.0.0.1:6806`） |
| `SIYUAN_TOKEN` | SiYuan API token |

### Profile 管理命令

```bash
siyuan-sisyphus config list
siyuan-sisyphus config set work --url http://127.0.0.1:6807 --token <siyuan-token>
siyuan-sisyphus config use work
siyuan-sisyphus config get work
siyuan-sisyphus --profile default notebook list
```

### 配置文件格式（`~/.siyuan-sisyphus/config.json`）

```json
{
  "currentProfile": "default",
  "profiles": {
    "default": {
      "apiUrl": "http://127.0.0.1:6806",
      "token": "<siyuan-token>"
    },
    "work": {
      "apiUrl": "http://127.0.0.1:6807",
      "token": "<siyuan-token>"
    }
  }
}
```

旧版顶层 `apiUrl` / `token` 单接口配置仍会被读取为 `default` profile。

## 与 SiYuan 插件的关系

CLI 和 SiYuan 插件（`siyuan-plugins-mcp-sisyphus`）底层共用同一套 tool-handler 代码，但两者是独立入口：

- **插件** 在 SiYuan 内部启动一个 MCP server，通过 stdio / HTTP 与 AI 客户端通信（在插件设置面板中配置）。
- **CLI** 直接通过 HTTP API 连接 SiYuan，每次调用执行一个操作后退出；它不是 server，也不是常驻进程。

如果你之前使用的是旧配置路径 `~/.siyuan-mcp/config.json`，CLI 仍会把它作为兜底配置读取，直到你在 `~/.siyuan-sisyphus/config.json` 下创建新配置。

CLI 会遵守与 MCP 客户端相同的插件 UI 配置：被禁用的 tool/action 不会出现在 `list`/`help` 中，也不能被执行。笔记本级权限同样通过 API 读取同一份 `/data/storage/petal/...` 配置并强制执行。

## 许可证

MIT © Taihong Yang
