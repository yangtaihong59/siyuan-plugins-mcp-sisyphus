# SiYuan Sisyphus MCP & CLI

[English](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README.md) | [中文](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README_zh_CN.md)

> **最新版本：**`v0.3.1` — CLI 工具 `siyuan-sisyphus` 已上线 npm，全部 10 个聚合工具、115+ action 均可在终端直接调用。详见 [CHANGELOG.md](./CHANGELOG.md)。

> 如果你想把 OpenClaw、OpenCode、kimi Code 等有 Web 端的工具直接嵌进思源侧边栏使用，推荐搭配：[AI CLI Bridge for SiYuan](https://github.com/yangtaihong59/siyuan-plugins-ai-cli-bridge)。

本插件提供一套让 Agent 安全查看、修改思源的方式。具备易用的前端设置界面，提供安全、细粒度的权限模型，确保无论是 CLI 还是 MCP，都只能在你允许的范围内操作笔记。

本项目为思源笔记提供**两种外部连接方式**，共享同一套前端设置及能力（权限管理、读笔记、搜索、改内容、操作数据库、导出资源等）：

- **CLI 工具 `siyuan-sisyphus`**：无需 MCP 客户端，直接在终端或脚本里操作思源。
- **MCP 服务器插件**：运行在思源内部，让支持 MCP 的 Agent 把笔记当成一组可调用工具。

如果你不熟悉这些概念，简单理解：
- **SiYuan**：你的笔记和数据
- **这个插件**：把思源能力包装成 CLI / MCP Server，让外部能安全调用
- **MCP**：Agent 和外部工具之间的通用连接协议
- **CLI**：命令行界面工具，Agent 在终端里直接调用
- **Agent 客户端**：OpenClaw、Claude Desktop、Codex、Cherry Studio、Cursor 等

---

## 权限与安全

本插件提供**按笔记本控制访问范围**的权限模型，让 AI 操作你的笔记时始终处于可控边界内。

### 权限模型

每个笔记本可独立设置四态权限：

| 权限 | 说明 |
|------|------|
| `rwd` | 读、写、删除 |
| `rw` | 读写，不可删除 |
| `r` | 只读 |
| `none` | 禁止所有访问 |

---

## 安装思源插件

使用 CLI 或 MCP 前，都需要先在思源里安装本插件。

### 从思源集市安装

1. 打开思源笔记
2. 进入 `设置 -> 集市`
3. 搜索 `SiYuan Sisyphus`，点击安装
4. 安装并启用插件

### 从源码安装

```bash
git clone https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus.git
cd siyuan-plugins-mcp-sisyphus
pnpm install
pnpm run build
pnpm run make-link
```

---

## CLI 工具

独立命令行工具 [`siyuan-sisyphus`](./cli/README_zh_CN.md)，通过 HTTP API 连接思源，执行完即退出，无需常驻进程。

### 安装 CLI

```bash
# 安装cli
npm i -g siyuan-sisyphus
# 填写api及token
siyuan-sisyphus init 
```

### 用法示例

```bash
# 列出笔记本
siyuan notebook list

# 创建文档
siyuan document create --notebook <id> --path "/Inbox/Note" --markdown "# Hello"

# 全文搜索
siyuan search fulltext --query "TODO" --json | jq '.data[].hPath'
```

---

## MCP 服务器插件

插件运行在思源内部，将思源能力暴露为 MCP Server，供外部 Agent 调用。

### 支持的连接方式

| 场景 | 推荐方式 |
|------|---------|
| 桌面端（Windows / macOS / Linux） | HTTP 或 stdio |
| Docker / 远程部署 | stdio（必须） |

插件设置页底部提供三段可直接复制的配置：HTTP 连接方式、mcp-remote 桥接、stdio 连接方式。

打开「`插件` → `siyuan-plugins-mcp-sisyphus` → `设置` → `🌐 连接配置`」即可查看。

### HTTP 模式

插件在思源内托管 HTTP MCP Server，客户端直接访问。

**插件端配置：**

1. Host 默认 `127.0.0.1`，Port `36806`（WSL/远程改为 `0.0.0.0`）
2. 保持「Require Bearer token」开启
3. 点「Start」启动，勾选「随思源自动启动」

**客户端配置**（Cline、Cherry Studio、Cursor、Claude Code 等）：

```json
{
  "mcpServers": {
    "siyuan": {
      "type": "http",
      "url": "http://127.0.0.1:36806/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

> Claude Code 必须加 `"type": "http"`，配置写入 `~/.claude.json` 的 `mcpServers` 字段。  
> WSL/跨机器：Host 改为 `0.0.0.0`，客户端 URL 替换为宿主机 IP。绑定非回环地址时**务必**保持 token 鉴权。

### stdio 模式

客户端通过子进程运行 `mcp-server.cjs`，由后者通过 `SIYUAN_API_URL` 连接思源 API。

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "node",
      "args": ["{SIYUAN_PATH}/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs"],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806",
        "SIYUAN_TOKEN": "xxxxxx"
      }
    }
  }
}
```

- 设置页示例会自动填入当前工作区路径与 token
- Docker / 局域网：`SIYUAN_API_URL` 改为 Docker 宿主机 IP，客户端需能访问到 `mcp-server.cjs`
- 思源未开启 API 鉴权时，`SIYUAN_TOKEN` 可省略
- `stdio` 每次只能对应一个客户端连接

> Docker 场景无法在前端启动插件内置 HTTP 服务，请使用 stdio 方式：暴露容器的 6806 端口，**务必**开启思源 API token 并限制防火墙。

### mcp-remote 桥接

客户端只支持 stdio，但想桥接到 HTTP 服务：

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://127.0.0.1:36806/mcp",
        "--header",
        "Authorization: Bearer <token>"
      ]
    }
  }
}
```

### 连接后验证

配置完成后，先试几个只读动作确认链路：

- “帮我查看当前思源版本” → `system(action="get_version")`
- “列出我的笔记本” → `notebook(action="list")`
- “搜索标题里包含 project 的文档” → `document(action="search_docs", ...)`

---

## 工具一览

所有能力被收敛为 **10 个聚合工具**，通过 `action` 字段分派具体操作。

### 工具速览

| 工具 | 能力范围 |
|------|---------|
| `notebook` | 笔记本的增删改查、打开/关闭、图标、权限管理 |
| `document` | 文档创建、移动、删除、查询、树结构、日记、图标/头图 |
| `block` | 块级读写、属性、折叠、移动、批量操作、字数统计 |
| `av` | 属性视图（数据库）的读写、行列操作、单元格更新、搜索 |
| `file` | 资源上传、导出、模板渲染、未引用资源清理、OCR |
| `search` | 全文搜索、SQL 查询、反链、标签搜索、查找替换 |
| `tag` | 标签的列出、重命名、删除 |
| `system` | 版本、时间、通知、配置摘要、系统字体 |
| `flashcard` | 闪卡列出、复习、制卡、移卡 |
| `mascot` | 猫猫余额、商店、购买 |

### 详细 Action 列表

#### `notebook`

| Action | 说明 |
|--------|------|
| `list` | 列出所有笔记本 |
| `create` | 创建笔记本（支持 `icon`，推荐 Unicode 十六进制如 `1f4d4`） |
| `set_open_state` | 打开或关闭笔记本 |
| `remove` | 删除笔记本（需确认） |
| `rename` | 重命名笔记本 |
| `get_conf` / `set_conf` | 获取或设置笔记本配置 |
| `set_icon` | 设置笔记本图标 |
| `get_permissions` | 查看所有笔记本的 MCP 权限 |
| `set_permission` | 修改笔记本权限（`none` / `r` / `rw` / `rwd`） |
| `get_child_docs` | 获取笔记本根目录下的直属子文档 |

#### `document`

| Action | 说明 |
|--------|------|
| `create` | 创建文档，支持 Markdown 内容 |
| `rename` | 重命名文档 |
| `remove` | 删除文档 |
| `move` | 移动文档 |
| `set_icon` | 设置文档/文件夹图标 |
| `set_cover` | 设置或清除文档头图 |
| `get_path` | 按文档 ID 获取存储路径 |
| `get_hpath` | 按 ID 或存储路径获取人类可读路径 |
| `get_ids` | 按人类可读路径获取文档 ID |
| `get_child_blocks` | 获取文档的直属子块 |
| `get_child_docs` | 获取文档的直属子文档 |
| `list_tree` | 列出指定笔记本路径下的文档树 |
| `search_docs` | 按标题关键词搜索文档 |
| `get_doc` | 按 ID 获取文档内容与元数据 |
| `create_daily_note` | 为笔记本创建或返回今日日记 |
| `duplicate` | 复制已有文档 |
| `remove_batch` | 按存储路径批量删除文档（需确认） |
| `create_empty` | 创建空文档 |
| `heading_to_doc` | 将标题块转换为文档 |
| `doc_to_heading` | 将文档转换为目标文档下的标题 |

#### `block`

| Action | 说明 |
|--------|------|
| `insert` / `prepend` / `append` | 插入块到指定位置/开头/末尾 |
| `update` | 更新块内容 |
| `delete` | 删除块 |
| `move` | 移动块到新位置 |
| `set_fold_state` | 折叠/展开可折叠块 |
| `get_kramdown` | 获取块的 kramdown 格式内容 |
| `get_children` | 获取直属子块 |
| `transfer_ref` | 转移块引用 |
| `set_attrs` / `get_attrs` | 设置或获取块属性（含闪卡自定义属性） |
| `exists` | 检查块是否存在 |
| `info` | 获取块所在根文档元数据 |
| `breadcrumb` | 获取块的面包屑路径 |
| `dom` | 获取块的渲染 DOM |
| `recent_updated` | 列出最近更新内容 |
| `word_count` | 获取块的字数统计 |
| `batch_insert` | 批量插入块 |
| `batch_update` | 批量更新块 |
| `append_daily_note` | 创建或打开今日日记后追加块 |
| `prepend_daily_note` | 创建或打开今日日记后前插块 |
| `doc_info` | 获取块或文档所在文档信息 |
| `docs_info` | 批量获取文档信息 |

#### `av`

| Action | 说明 |
|--------|------|
| `get` | 按 `id` 读取属性视图（数据库） |
| `render_attribute_view` | 渲染数据库视图，支持 `createIfNotExist` |
| `get_attribute_view_keys` | 返回属性视图的列信息 |
| `get_attribute_view_filter_sort` | 返回视图的筛选与排序配置 |
| `search` | 按关键词搜索属性视图 |
| `add_rows` | 将已有块绑定为数据库行 |
| `remove_rows` | 从属性视图中移除已绑定的行 |
| `add_column` | 新增数据库列 |
| `remove_column` | 删除属性视图中的一列 |
| `set_cell` | 更新单个单元格 |
| `batch_set_cells` | 批量更新多个单元格 |
| `duplicate_block` | 复制底层数据库块 |
| `get_primary_key_values` | 获取主键列对应的行数据 |

#### `file`

| Action | 说明 |
|--------|------|
| `upload_asset` | 上传本地资源文件（需确认；超过 10MB 需额外确认） |
| `render_template` | 使用文档上下文渲染模板 |
| `render_sprig` | 渲染 Sprig 模板 |
| `export_md` | 导出文档为 Markdown |
| `export_resources` | 导出资源为 ZIP（写本地需确认） |
| `list_unused_assets` | 列出未被引用的资源文件 |
| `get_doc_assets` | 列出文档引用的资源 |
| `get_image_ocr_text` | 读取图片资源的 OCR 文本 |
| `remove_unused_assets` | 删除全部未被引用的资源文件 |
| `rename_asset` | 重命名资源文件 |
| `delete_asset` | 删除资源文件 |
| `set_image_alpha` | 更新图片资源透明度 |

#### `search`

| Action | 说明 |
|--------|------|
| `fulltext` | 全文搜索 |
| `query_sql` | 执行只读 SQL（仅 SELECT / WITH） |
| `search_tag` | 按关键词搜索标签 |
| `get_backlinks` | 查找引用指定块的文档/块 |
| `get_backmentions` | 查找提及指定块名称的文档/块 |
| `search_refs` | 搜索引用指定块或文档的块 |
| `find_replace` | 查找替换文本（需确认） |
| `search_assets` | 按文件名搜索资源文件 |
| `get_asset_content` | 获取单个资源内容索引记录 |
| `fulltext_asset_content` | 全文搜索已索引的资源内容 |
| `list_invalid_refs` | 列出无效块引用 |

#### `tag`

| Action | 说明 |
|--------|------|
| `list` | 列出工作区标签 |
| `rename` | 重命名标签 |
| `remove` | 删除标签 |

#### `system`

| Action | 说明 |
|--------|------|
| `push_msg` / `push_err_msg` | 推送普通/错误通知 |
| `get_version` / `get_current_time` | 获取版本号或当前时间 |
| `workspace_info` | 获取工作区元数据（默认关闭） |
| `network` | 获取脱敏后的网络代理信息 |
| `changelog` | 获取当前版本更新日志 |
| `conf` | 获取脱敏后的系统配置 |
| `sys_fonts` | 列出系统字体 |
| `boot_progress` | 获取启动进度详情 |

#### `flashcard`

| Action | 说明 |
|--------|------|
| `list_cards` | 列出待复习闪卡，支持按范围/状态过滤 |
| `get_decks` | 列出可用闪卡卡包 |
| `get_cards` | 分页列出卡包中的全部卡片 |
| `review_card` | 提交复习结果 |
| `skip_review_card` | 跳过当前闪卡 |
| `create_card` | 将已有块转成闪卡 |
| `add_card` | 对绑定卡包的块执行 riff 加卡注册 |
| `remove_card` | 将块从卡包中移除（需确认） |

#### `mascot`

| Action | 说明 |
|--------|------|
| `get_balance` | 获取猫猫当前可用余额 |
| `shop` | 列出猫猫商店商品 |
| `buy` | 购买商品 |

每次成功调用任意 MCP tool，猫猫都会赚到 1 米。`get_balance` 会返回累计赚米次数。

---

## 设计思想：渐进式披露

只在需要时暴露复杂性，避免初次交互就把所有信息堆给 AI。

**① Tool Description 层**：只详述高频 common actions 及必填字段，低频/高风险 advanced actions 仅列名称，附指向按需文档的链接。

**② Help 层**：每个 action 的详细说明存放在 `siyuan://help/action/{tool}/{action}` resource 中；调用 `action: "help"` 可内联获取完整帮助。

**③ Response 层**：大结果集自动收敛：

| 场景 | 行为 |
|------|------|
| `search.fulltext` 结果 > 20 条 | 截断，提示 `page`/`pageSize` |
| `search.query_sql` 结果 > 50 行 | 截断，提示 `LIMIT`/`OFFSET` |
| `block.get_children` 子块 > 50 | 截断，提示用 `query_sql` 过滤 |
| `document.list_tree` 深层节点 | 默认折叠到 depth=3，通过 `maxDepth` 展开 |
| `document.get_doc` 内容 > 8000 字符 | 截断，提示用 `get_child_blocks` 逐块读取 |

---

## 常见问题

### Agent 看不到工具

- HTTP 模式：确认设置面板状态为「Running」，token 和 URL 是否正确
- stdio 模式：确认路径指向 `mcp-server.cjs`，修改配置后重启客户端

### 能连上，但调用失败

- HTTP 模式：思源 API token 由插件自动透传；检查思源是否正常运行
- stdio 模式：检查 `SIYUAN_API_URL` 和 `SIYUAN_TOKEN`
- 检查目标笔记本权限是否被设为了 `r` 或 `none`

### 为什么某些操作前会让我确认

这是安全设计。删除、移动、上传本地文件、修改权限等高风险动作，默认都需要用户确认。

---

## 开发

连接本机 SiYuan 做 live smoke：

```bash
pnpm run build
node scripts/live_mcp_smoke.cjs
```

项目结构：

```text
siyuan-plugins-mcp-sisyphus/
├── src/
│   ├── api/           # 思源 API 封装
│   ├── cli/           # CLI 源码
│   ├── mcp/           # MCP 服务器实现
│   │   ├── tools/     # 聚合 tool 处理器
│   │   ├── config.ts  # 配置与迁移辅助
│   │   ├── server.ts  # 主服务器
│   │   └── types.ts   # action 级校验
│   └── index.ts       # 插件入口
├── cli/               # 独立 CLI npm 子包
├── public/i18n/       # 国际化
└── package.json
```

OpenClaw / mcporter 用户可参考 [SKILL.md](./skills/siyuan-mcp-sisyphus/SKILL.md)。

详细 API ↔ MCP 映射文档见：[API_MCP_MAPPING.md](./API_MCP_MAPPING.md)

## 许可证

MIT
