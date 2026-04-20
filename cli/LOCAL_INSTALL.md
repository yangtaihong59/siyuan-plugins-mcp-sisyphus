# 本地试用 siyuan-sisyphus（不发布到 npm）

本指南教你在本机把这个仓库里的 CLI 安装成像 `obsidian-cli` / `kubectl` 一样的全局命令 `siyuan-sisyphus`，并保留别名 `siyuan`，在终端直接跑命令验证效果，而不用 `npm publish`。

你的环境：Node 18+、pnpm 或 npm 均可、macOS/Linux/WSL。

---

## 一、构建产物

在仓库根目录执行：

```bash
pnpm install          # 首次跑时安装依赖（已装过可跳过）
pnpm build:cli        # 产出 cli/dist/cli.cjs
```

成功后应看到：

```
cli/dist/
└── cli.cjs           # ~286 KB, 可执行（rwxr-xr-x），自包含 CJS bundle
```

> 如果 `cli/dist/` 里还残留老版本的 `mcp-server.cjs`，可以安全删掉 —— 新 CLI 不再用它。

**快速冒烟（不需要思源在跑）：**

```bash
node cli/dist/cli.cjs --help
node cli/dist/cli.cjs --version   # 0.3.1
node cli/dist/cli.cjs list        # 列出所有工具及动作数
node cli/dist/cli.cjs list block  # 列出 block 工具的所有 action
```

---

## 二、选一种方式让 `siyuan-sisyphus` 进 PATH

### 方式 A：`npm link`（推荐，开发期最方便）

```bash
cd cli
npm link
```

这会在 `/opt/homebrew/bin/siyuan-sisyphus` 和 `/opt/homebrew/bin/siyuan`（或你的 npm 全局 bin 目录）建软链指向 `cli/dist/cli.cjs`。之后在任意目录都能执行：

```bash
siyuan-sisyphus --help
siyuan --help
siyuan-sisyphus list
```

重新 `pnpm build:cli` 更新产物后，软链会自动指向新内容，**不需要重新 `npm link`**。

卸载：

```bash
cd cli && npm unlink -g siyuan-sisyphus
```

### 方式 B：`npm pack` + 全局安装（模拟真实发布体验）

```bash
cd cli
npm pack                              # 生成 siyuan-sisyphus-0.3.1.tgz
npm i -g ./siyuan-sisyphus-0.3.1.tgz
```

这种方式最接近用户 `npm i -g siyuan-sisyphus` 后获得 `siyuan-sisyphus` 和 `siyuan` 两个命令的真实场景，能同时验证 `files`、`bin`、shebang 这些发布相关的细节。更新后需要重新 `pack + install`。

卸载：`npm uninstall -g siyuan-sisyphus`。

### 方式 C：不安装，直接跑（最轻量）

```bash
# 在 ~/.zshrc 或 ~/.bashrc 里加一行（绝对路径）
alias siyuan-sisyphus="node /Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/cli/dist/cli.cjs"
alias siyuan="node /Users/skycat/Documents/GitHub/siyuan-plugin-dev/siyuan-plugins-mcp-sisyphus/cli/dist/cli.cjs"
```

重开终端或 `source ~/.zshrc` 后生效。卸载就是删掉那一行。

---

## 三、准备 SiYuan API Token

1. 打开 SiYuan 桌面端
2. 左下角 ⚙️ 设置 → **关于** → **API token**
3. 复制那串 token（形如 `xxxxxxxxxxxxxxxx`）

确认 SiYuan 在监听（默认 `http://127.0.0.1:6806`）：

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:6806/api/notebook/lsNotebooks
# 返回 200 即可
```

---

## 四、生成配置文件

```bash
siyuan-sisyphus init
```

按提示填：

- SiYuan API URL：直接回车用默认 `http://127.0.0.1:6806`
- SiYuan API token：粘贴上一步复制的 token

结果会写到 `~/.siyuan-sisyphus/config.json`（权限 `0600`，只有你自己可读）：

```bash
cat ~/.siyuan-sisyphus/config.json
# {
#   "apiUrl": "http://127.0.0.1:6806",
#   "token": "xxxxxxxxxxxxxxxx"
# }
```

之后所有命令都会自动读这个文件，不需要每次加 `--token`。

> 额外提醒：`siyuan-sisyphus` CLI 依赖已安装并启用的 `siyuan-plugins-mcp-sisyphus` 插件。首次使用前，请先在思源里打开该插件设置面板至少一次，并完成权限配置；否则 CLI 会直接提示缺少插件或插件尚未初始化。

> 也可以完全不用配置文件，每次走环境变量 `SIYUAN_TOKEN=xxx siyuan-sisyphus ...` 或命令行 flag `siyuan-sisyphus --token xxx ...`。优先级：flag > 环境变量 > 配置文件 > 默认值。若旧的 `~/.siyuan-mcp/config.json` 仍在，CLI 也会兼容读取。

---

## 五、冒烟测试（只读操作，零风险）

这些命令都是只读，跑坏了也不会动到你的笔记。

```bash
# 1. 连通性：列所有笔记本
siyuan-sisyphus notebook list

# 2. 系统信息
siyuan-sisyphus system get-version
siyuan-sisyphus system get-current-time

# 3. 列一个笔记本的文档树（替换成你自己的 notebook id）
siyuan-sisyphus notebook list --json | jq '.[0].id'   # 拿第一个 notebook id
siyuan-sisyphus document list-tree --notebook <notebook-id> --path "/" --max-depth 2

# 4. 全文搜索
siyuan-sisyphus search fulltext --query "TODO" --page-size 5

# 5. 管道给 jq 消费
siyuan-sisyphus notebook list --json | jq '.[] | select(.closed==false) | .name'
siyuan-sisyphus search fulltext --query "MCP" --page-size 10 --json | jq '.data[].hPath'

# 6. help 查特定 action 的参数
siyuan-sisyphus help block append
siyuan-sisyphus help document create
```

**人类可读 vs JSON**：默认输出带图标/分页表头/ANSI 颜色方便人读；加 `--json` 变成单行紧凑 JSON，专门给 `jq`、脚本、Python `json.loads()` 用。

---

## 六、试试写操作（可逆，低风险）

先找一个测试用的笔记本和文档 id，然后：

```bash
# 创建一个新文档（human-readable path，自动建中间层）
siyuan-sisyphus document create \
  --notebook <notebook-id> \
  --path "/CLI 测试/Hello" \
  --markdown "# Hello from siyuan CLI"

# 给文档末尾追加一个 markdown 块
siyuan-sisyphus block append \
  --parent-id <doc-id> \
  --data-type markdown \
  --data "- 来自 CLI 的新列表项"

# 查文档信息
siyuan-sisyphus block info --id <doc-id>

# 读回 kramdown 源码
siyuan-sisyphus block get-kramdown --id <doc-id>
```

flag 命名规则：kebab-case、camelCase、snake_case 都接受 —— `--parent-id`、`--parentID`、`--parentId` 指向同一个字段。action 名也是两种都行：`get-kramdown` == `get_kramdown`。以上示例默认用 `siyuan-sisyphus`，但换成别名 `siyuan` 也一样。

---

## 七、错误路径验证

确认出错时返回码和提示都对：

```bash
# 未知工具
siyuan-sisyphus frobnicate foo
echo $?                # 1

# 未知 action
siyuan-sisyphus block frobnicate
echo $?                # 1

# 缺必填字段（人类可读的校验错误）
siyuan-sisyphus document list-tree --notebook <id>   # 会提示 path 必填

# 没 token（去掉配置文件后）
rm ~/.siyuan-sisyphus/config.json
siyuan-sisyphus notebook list                # 401 / api_error
```

---

## 八、常见问题

**`✗ [api_error] fetch failed`**
SiYuan 没启动，或 `SIYUAN_API_URL` 写错。确认上面那条 `curl` 命令返回 200。

**`Unauthorized` / HTTP 401**
token 错误。去 SiYuan 设置页重新拷一次。记住 token 是敏感凭据，别 commit 进代码仓库。

**`Unknown flag --xxx; ignored.` 警告**
flag 名拼错了。加 `--debug` 看具体哪条被忽略，或 `siyuan-sisyphus help <tool> <action>` 看正确的字段名。

**改了源码但 CLI 行为没变**
忘了 `pnpm build:cli`。CLI 当前没有 watch 模式，每次改源码都需要手动构建一次。

**想调试传给 MCP 工具的完整 payload**
加 `--debug`，会把忽略的 flag 警告输出到 stderr。想看实际请求体的话，设 `SIYUAN_MCP_DEBUG_ERRORS=1` 会在错误里带上 stack trace。

**CLI 在一个终端里能跑，但切到别的 shell 就找不到命令**
PATH 没刷新。`which siyuan-sisyphus` 或 `which siyuan` 能定位到哪里；方式 A/B 装完后需要 `hash -r`（zsh）或重开终端。

---

## 九、彻底清理

```bash
# 如果用了 npm link
cd cli && npm unlink -g siyuan-sisyphus

# 如果用了 npm i -g
npm uninstall -g siyuan-sisyphus

# 如果用了方式 C（alias）
# 编辑 ~/.zshrc 删除对应行

# 删掉配置文件
rm -rf ~/.siyuan-sisyphus

# 删掉构建产物
rm -rf cli/dist
```

---

## 附：与 MCP server 的关系

**本 CLI 不是 MCP server。** 它是一个"在 shell 里直接调思源"的命令行工具，一次执行一个操作然后退出，和 `curl`、`gh` 是同类。

如果你想让 AI 客户端（Claude Desktop、Cursor、Zed 等）通过 MCP 协议调思源，装仓库根目录的**插件**（`package.zip` / `pnpm build`），插件会在 SiYuan 进程内起一个 MCP server，由插件设置面板控制。
