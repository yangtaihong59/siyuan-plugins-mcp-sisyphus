# SiYuan MCP Sisyphus —— AI 编码代理项目指南

> 本文档面向 AI 编码代理。阅读者应对本项目一无所知，所有信息均基于实际代码与配置，不假设、不泛化。

---

## 项目概述

**SiYuan MCP Sisyphus** 是 SiYuan Note（思源笔记）的插件 + 独立 CLI 工具，让 AI Agent 能够通过两种接口安全地操作思源笔记：

1. **MCP Server 插件**：作为 SiYuan 插件运行，对外暴露 MCP（Model Context Protocol）服务。AI 客户端（Claude Desktop、Cursor、Cherry Studio 等）通过 HTTP 或 stdio 连接。
2. **独立 CLI `siyuan-sisyphus`**：发布到 npm 的包名 `siyuan-sisyphus`，安装后提供 `siyuan-sisyphus` / `siyuan` 命令。直接通过思源 HTTP API 执行单次操作后退出，无需 MCP 客户端。

两种接口共享同一套底层能力（14 个聚合工具、121 个静态声明 action；`extension` 还可按官方注册表发现动态 action），覆盖思源绝大部分功能：笔记本管理、文档操作、块级读写、属性视图（数据库）、搜索、标签、文件资源、闪卡、系统接口等。

- 仓库地址：`https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus`
- 作者：Taihong Yang
- 许可证：MIT
- 当前版本：`0.6.1`（根 `package.json` 与 `plugin.json` 同步）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript 5.1+ |
| 构建工具 | Vite 5.2+（多 target 构建） |
| UI 框架 | Svelte 4（插件设置面板、桌面悬浮宠物组件） |
| 校验 | Zod 4（action 参数校验） |
| MCP SDK | `@modelcontextprotocol/{server,client,core,node}` ^2.0.0 |
| 测试 | Vitest 1.6+（Node 环境） |
| 文档 | VitePress 1.6+（`docs/` 双语站点） |
| 包管理 | pnpm（推荐） |

**关键约束**：
- 所有产物为 **CommonJS (CJS)**。
- 插件在 Electron 渲染进程以 CJS 运行；MCP Server 以 Node 进程运行；CLI 为自包含 CJS bundle。
- **必须兼容远程场景**：任何读写操作都经过思源 HTTP API（`http://127.0.0.1:6806` 或用户配置地址），**禁止直接访问本地文件系统**。特许例外仅有两处：① CLI 自身配置（`~/.siyuan-sisyphus/config.json`）；② 上传/下载/导出类 action（如 `upload_asset`、`export_resources`），因 SiYuan API 不支持流式二进制传输，必须通过本地文件系统中转。

---

## 项目结构

```
siyuan-plugins-mcp-sisyphus/
├── src/
│   ├── index.ts                 # 插件入口（SiYuan Plugin 基类）
│   ├── server-launcher.ts       # HttpServerLauncher：在插件进程内 spawn mcp-server.cjs 子进程
│   ├── index.scss               # 插件全局样式（几乎为空）
│   │
│   ├── api/                     # 思源 HTTP API 封装层
│   │   ├── client.ts            # SiYuanClient：fetch 封装、token 注入、超时控制
│   │   ├── notebook.ts          # /api/notebook/*
│   │   ├── document.ts          # /api/filetree/* 与文档相关
│   │   ├── block.ts             # /api/block/*
│   │   ├── av.ts                # /api/av/*（attribute view / 数据库）
│   │   ├── search.ts            # /api/search/*、/api/query/sql
│   │   ├── file.ts              # /api/file/*、/api/export/*、/api/asset/*
│   │   ├── system.ts            # /api/system/*
│   │   ├── tag.ts               # /api/tag/*
│   │   ├── flashcard.ts         # /api/riff/*
│   │   └── transaction.ts       # /api/transaction 批量操作
│   │
│   ├── core/                    # MCP 服务器核心与工具元数据
│   │   ├── server.ts            # MCP Server 入口：createSiYuanServer()、startMcpServer()
│   │   ├── http-transport.ts    # HTTP MCP 2026 无状态 + legacy 有会话双协议传输
│   │   ├── tool-registry.ts     # TOOL_REGISTRY：14 个聚合工具的注册表
│   │   ├── tool-lifecycle.ts    # 工具调用生命周期：analytics、telemetry、token 计数、错误包装
│   │   ├── config.ts            # ToolConfig 类型、默认值、配置迁移（扁平 → 嵌套）、危险动作定义
│   │   ├── permissions.ts       # PermissionManager：笔记本级权限（rwd/rw/r/none）
│   │   ├── types.ts             # 所有 action 的 Zod schema 定义
│   │   ├── resources.ts         # MCP Resources：help 文档资源路由
│   │   ├── help.ts              # 各工具的帮助文案与提示
│   │   ├── normalize.ts         # 请求参数归一化（类型短码展开、sortBy 别名等）
│   │   ├── analytics.ts         # 调用统计与洞察数据聚合
│   │   ├── telemetry.ts         # 调用事件遥测上报
│   │   ├── token-usage.ts       # 请求/响应近似 token 计算
│   │   ├── puppy-state.ts       # 桌面悬浮宠物（ToolPuppy）状态管理
│   │   ├── server-instructions.ts # 服务端 instructions 文本构建
│   │   └── runtime.ts           # 运行时环境检测（isPluginMode 等）
│   │
│   ├── tools/                   # 14 个聚合工具的实现
│   │   ├── index.ts             # barrel export：统一导出所有工具模块
│   │   ├── internal/            # 工具层共享基础设施（非独立工具）
│   │   │   ├── define-tool.ts   # defineTool() 工厂：统一工具定义模式
│   │   │   ├── shared.ts        # 聚合工具公共函数：schema 构建、结果包装、分页、错误翻译
│   │   │   ├── context.ts       # 工具上下文辅助（权限校验、子文档查询等）
│   │   │   ├── errorTranslation.ts # 思源错误码 → 用户友好文案
│   │   │   ├── ui-refresh.ts    # 触发思源 UI 刷新（所有模式默认开启）
│   │   │   ├── help-render.ts   # help action 输出渲染
│   │   │   ├── schema-analyzer.ts # schema 分析与描述裁剪
│   │   │   └── helpers/         # 跨工具小型 helper，如 notebookName 补全
│   │   ├── notebook/            # notebook 工具（index.ts + handlers.ts）
│   │   ├── document/            # document 工具
│   │   ├── block/               # block 工具
│   │   ├── av/                  # av（数据库）工具
│   │   ├── search/              # search 工具（含 sql-builder、permission-filter）
│   │   ├── file/                # file 工具
│   │   ├── tag/                 # tag 工具
│   │   ├── system/              # system 工具
│   │   ├── flashcard/           # flashcard 工具
│   │   └── mascot/              # mascot（吉祥物余额）工具
│   │
│   ├── cli/                     # 独立 CLI 源码（被 cli Vite target 打包）
│   │   ├── index.ts             # CLI 入口：命令分发（dispatch/list/help/init/config/version）
│   │   ├── dispatch.ts          # 核心转发：调 TOOL_REGISTRY[tool].callTool()
│   │   ├── args.ts              # 顶层参数解析：支持 kebab/camel/snake flag 混用
│   │   ├── flag-mapper.ts       # 基于 inputSchema 做 flag → 参数映射与类型强转
│   │   ├── render.ts            # 人类可读渲染 / --json 紧凑输出 / ANSI 颜色 / 交互式分页
│   │   ├── list-help.ts         # list 与 help 子命令实现
│   │   ├── config.ts            # 配置读写（~/.siyuan-sisyphus/config.json）
│   │   ├── config-command.ts    # config 子命令：多 profile 管理（list/get/set/use）
│   │   ├── init.ts              # 交互式初始化
│   │   ├── plugin-check.ts      # 插件在线检测
│   │   └── runtime.ts           # CLI 运行时环境检测
│   │
│   ├── ui/                      # Svelte UI 与设置面板
│   │   ├── components/          # 桌面悬浮宠物组件与行为逻辑
│   │   ├── setting/             # 插件设置面板
│   │   └── shared/              # UI 共享组件
│   │
│   ├── shared/                  # 跨层通用工具库
│   │   ├── error.ts             # 错误处理辅助
│   │   ├── promise-pool.ts      # 并发池
│   │   └── invocation-format.ts # 调用格式化
│   │
│   ├── types/
│   │   ├── index.d.ts           # 思源常用数据结构（Block、Notebook 等）
│   │   └── api.d.ts             # API 响应类型定义
│   │
│   └── presentation/            # 展示层辅助
│       └── invocation-format.ts # 调用格式化
│
├── cli/                         # 独立 npm 子包（发布为 `siyuan-sisyphus`）
│   ├── package.json             # 子包元数据（version 与根包独立，bin 指向 dist/cli.cjs）
│   ├── README.md / README_zh_CN.md
│   └── dist/                    # CLI 构建产物 cli.cjs（自包含，无外部依赖）
│
├── tests/                       # 测试套件
│   ├── setup.ts                 # Vitest 全局 setup：fetch mock 恢复、vi.restoreAllMocks
│   ├── unit/                    # 单元测试（按 src 目录结构镜像）
│   ├── integration/             # 集成测试（HTTP 并发、端到端 MCP、server 启动）
│   ├── smoke/                   # 冒烟测试（需真实思源实例）
│   ├── mocks/siyuan.ts          # `siyuan` 模块 mock（用于 vitest alias）
│   └── helpers/                 # 测试辅助函数
│
├── docs/                        # VitePress 文档站点（双语：en / zh）
│   ├── .vitepress/config.ts     # VitePress 配置
│   ├── en/                      # 英文文档
│   └── zh/                      # 中文文档
│
├── scripts/                     # 构建与开发辅助脚本
│   ├── make_dev_link.js         # 创建 dev 目录到思源插件目录的符号链接
│   ├── make_install.js          # 构建后安装到思源插件目录
│   ├── update_version.js        # 同步 version 到 plugin.json 与 cli/package.json
│   ├── analyze-description-tokens.ts # 工具描述 token 分析
│   └── repro-index-error*.cjs   # 索引问题复现脚本
│
├── public/i18n/                 # 国际化源文件（JSON 格式，build 时自动复制到 dist）
│   ├── en_US.json
│   └── zh_CN.json
│
├── dist/                        # 生产构建输出（自动生成）
├── dev/                         # 我测试时插件实际上运行的输出，开发模式输出（pnpm dev 时生成）
│
├── package.json                 # 根包（插件本体）
├── plugin.json                  # 思源插件元数据
├── vite.config.ts               # Vite 多入口配置（renderer / server / cli）
├── vitest.config.ts             # Vitest 测试配置
├── tsconfig.json                # TypeScript 配置（strict: false，路径别名 @/*）
├── svelte.config.js             # Svelte 配置（vitePreprocess，压制 a11y 警告）
└── yaml-plugin.js               # 自定义 Vite 插件：YAML i18n → JSON 转换
```

---

## 构建系统详解

### Vite 多 Target 构建

`vite.config.ts` 根据环境变量 `BUILD_TARGET` 分三路构建：

| Target | 入口 | 产物 | 说明 |
|--------|------|------|------|
| `renderer` | `src/index.ts` | `dist/index.js` + `dist/index.css` | 插件 UI（SiYuan 加载） |
| `server` | `src/core/server.ts` | `dist/mcp-server.cjs` | MCP Server（Node 进程） |
| `cli` | `src/cli/index.ts` | `cli/dist/cli.cjs` | 独立 CLI（npm 发布） |

**新增 target 必须在 `vite.config.ts` 的 `validTargets` 数组中登记。**

### 关键构建行为

- **输出格式**：全部为 CJS（`formats: ["cjs"]`），`inlineDynamicImports: true`。
- **路径别名**：`@/*` → `src/*`，在 `vite.config.ts`、`tsconfig.json`、`vitest.config.ts` 中均配置。
- **Server target**：
  - 大量 Node 内置模块标记为 `external`（`child_process`、`fs`、`http`、`crypto` 等）。
  - 直接打包 MCP SDK v2 拆分包；服务端显式注入轻量 no-op schema validator。
  - 生产构建后自动清理 `dist/i18n/*.yaml` 等中间文件，并打包为 `package.zip`。
  - 自定义 rollup 插件 `assertNoLocalRequire` 确保产物不含 `require("./xxx")`（防止运行时找不到依赖）。
- **CLI target**：
  - `publicDir: false`。
  - 额外 external：`os`、`readline`。
  - 输出 banner `#!/usr/bin/env node`，build 后自动 `chmod 755`。
  - 定义全局常量 `__CLI_VERSION__`（读取 `cli/package.json` 的 version）。
  - **自包含 bundle**：`cli/dist/cli.cjs` 无任何 `dependencies`，可直接运行。
- **Renderer target**：
  - `external: ["siyuan"]`（SiYuan 运行时提供）。
  - 集成 Svelte 编译、YAML i18n 转换、静态文件复制。
  - dev 模式下 livereload 代码会被自动剥离（防止注入到 Node 进程产物中）。

### 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式（watch 同时编译 renderer + server）
pnpm dev

# 生产构建
pnpm build              # renderer + server
pnpm build:cli          # 仅 CLI
pnpm publish:cli        # 构建并发布 siyuan-sisyphus 到 npm

# 测试
pnpm test               # 运行全部单元/集成测试（vitest run）
pnpm test:watch         # 测试 watch 模式
pnpm test:coverage      # 覆盖率报告（v8 provider）
pnpm test:smoke         # 冒烟测试（需真实思源实例）

# 开发辅助
pnpm make-link          # 创建 dev/ 到思源插件目录的符号链接
pnpm update-version     # 同步版本号到 plugin.json 与 cli/package.json
```

---

## 代码组织与模块划分

### 聚合工具模型（Aggregated Tools）

所有思源能力被收敛为 **14 个聚合工具**，每个工具通过 `action` 字段路由到具体 operation。以下是 `src/core/config.ts` 中的静态 action 计数；`extension` 的官方下游工具仍按运行时注册表动态发现：

```
fs          → 8 actions（ls, tree, read, write, replace, rm, mv, search）
notebook    → 11 actions（list, create, set_open_state, remove, rename, ...）
document    → 16 actions（create, lookup, rename, remove, move, list_tree, ...）
block       → 21 actions（insert, prepend, append, update, delete, move, ...）
av          → 12 actions（get, render, add_rows, set_cells, ...）
file        → 17 actions（upload_asset, export_md, list_unused_assets, ...）
search      → 8 actions（fulltext, query_sql, get_backlinks, find_replace, ...）
tag         → 3 actions（list, rename, remove）
timeline    → 6 actions（list_nodes, create_node, compare_node, ...）
system      → 8 actions（get_version, notify, workspace_info, ...）
flashcard   → 6 actions（list_cards, get_decks, get_cards, ...）
extension   → 1 static action（`list`）+ dynamic official tools
mascot      → 3 actions（get_balance, shop, buy）
feedback    → 1 action（submit）
```

**约定**：不要拆散这个模型。每个 action 不是独立工具，而是聚合工具的参数分支。这降低了 MCP 的上下文占用，也保持了 CLI 命令的一致性。

### 工具定义模式（`defineTool`）

每个工具目录（如 `src/tools/notebook/`）遵循统一工厂模式：

1. 在 `src/tools/<tool>/index.ts` 使用 `defineTool({ name, description, variants, handlers, actionSchema })` 定义。
2. `variants`：每个 action 的 schema 变体（参数、必填字段、描述）。
3. `handlers`：通常放在 `src/tools/<tool>/handlers.ts`，按 action 分发；`handler` 内部自行用 Zod schema 解析 `rawArgs`，保持类型狭窄。
4. 工厂自动处理：`action="help"` 路由、action 禁用检查、错误包装。

工具层共享基础设施放在 `src/tools/internal/`。新增跨工具 helper 时优先放入 `src/tools/internal/helpers/`，不要再把 helper 文件散放到 `src/tools/` 根目录；根目录只保留 `index.ts` 和各工具目录。

示例结构：

```typescript
export const NOTEBOOK_VARIANTS: ActionVariant<NotebookAction>[] = [
    { action: 'list', schema: createActionSchema('list', {}, [], 'List all notebooks.') },
    { action: 'create', schema: createActionSchema('create', { name: { type: 'string' } }, ['name'], 'Create a notebook.') },
    // ...
];

export const { listTools: listNotebookTools, callTool: callNotebookTool } = defineTool({
    name: 'notebook',
    description: '...',
    variants: NOTEBOOK_VARIANTS,
    handlers: { list: handleList, create: handleCreate, ... },
    actionSchema: NotebookActionSchema,
});
```

### API 层约定

`src/api/` 下的每个模块都是纯函数，签名统一为：

```typescript
export async function xxxApi(client: SiYuanClient, ...args): Promise<ResType>
```

- `client.request<T>(endpoint, data)` 是统一调用方式。
- 类型定义在 `src/types/api.d.ts`。
- API 模块只负责封装 endpoint 和参数，**不包含业务逻辑**（权限、帮助、错误翻译在 `src/tools/` 层处理）。

### CLI 直接操作模式

CLI **不启动 MCP server 进程**，而是直接 import `TOOL_REGISTRY`、`SiYuanClient`、`PermissionManager`，调用 `callTool()` 后渲染结果并退出。

- 配置优先级：CLI flag > 环境变量 > `~/.siyuan-sisyphus/config.json` > 默认值。
- Flag 命名：kebab/camel 都接受（`--parent-id` 与 `--parentID` 等价）；布尔 `--flag` / `--no-flag`；复杂对象用 `--<key>-json '<json>'`。
- 危险动作在 CLI 下**不做二次确认**——用户主动输入命令即是确认。
- PermissionManager 在 CLI 启动时尝试读取权限文件，读失败则视为空 map，未显式配置的 notebook 默认 `r`（只读）。

---

## 开发约定

### 配置与迁移

- 工具配置的唯一优先真相源是思源 API 中的文件：
  `/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig`
- `src/core/config.ts` 中的 `normalizeToolConfig()` 支持从 legacy 扁平/数组格式迁移到当前嵌套格式。
- 服务端和插件 UI 都通过 `SiYuanClient.readFile()` / `writeFile()` 读写配置，确保 standalone / Docker / 远程场景的一致性。

### 权限模型

- 每个 notebook 可配置四级权限：`rwd`（读写删）、`rw`（读写）、`r`（只读）、`none`（无访问）。
- `PermissionManager` 在 `src/core/permissions.ts` 中实现，基于思源 API 读取的权限文件。
- 危险动作（delete、remove、find_replace、upload_asset、set_permission 等）在 MCP 2026-07-28 模式下先经过多轮 elicitation 确认；legacy 客户端通过 instructions/help 明示确认要求。

### 渐进式披露（Progressive Disclosure）

为控制上下文 token 占用，项目采用三层复杂度隔离：

1. **Tool Description 层**：高频 action 给出详细描述和必填字段；低频/高危 action 仅列名称，指向按需文档。
2. **Help 层**：每个 action 的详细文档在 `siyuan://help/action/{tool}/{action}` 资源中；调用 `action: "help"` 可获取内联帮助。
3. **Response 层**：大结果集自动摘要/截断（如 search >20 条、query_sql >50 行、get_doc >8000 字符），并提示翻页或细化查询。

### 远程安全

- **严禁**在 `src/api/` 或 `src/tools/` 中直接读写本地文件系统。
- 所有数据交互必须经过 `SiYuanClient` → 思源 HTTP API。
- 特许例外仅有两处：
  1. **CLI 自身配置**：`~/.siyuan-sisyphus/config.json` 及构建脚本的本地读写。
  2. **上传/下载/导出类 action**：如 `upload_asset`、`export_resources`，因 SiYuan API 不支持流式二进制传输，必须通过本地文件系统中转。新增此类例外必须经过评审并在代码中显式标注。

### UI 刷新

- 修改笔记内容后应调用 `applyUiRefresh()`（`src/tools/internal/ui-refresh.ts`），它会通过思源 `/api/ui/*` API 触发界面刷新。
- UI 刷新**默认在所有模式下开启**（插件、stdio、HTTP、CLI）。思源后端通过 WebSocket 广播刷新指令给所有已连接的前端客户端（包括 Electron 桌面端和浏览器端）。
- 刷新失败不会影响主操作结果，错误会被捕获并记录在响应的 `uiRefresh.partialFailure` 中。

---

## 测试策略

### 测试框架

- **Vitest**（Node 环境，`globals: true`）。
- 配置见 `vitest.config.ts`：
  - `include: ['tests/**/*.test.ts']`
  - `setupFiles: ['./tests/setup.ts']`
  - `alias: { '@': './src', 'siyuan': './tests/mocks/siyuan.ts' }`
- `tests/setup.ts` 在每个测试后恢复 `global.fetch` 和 mock。

### 测试分层

| 层级 | 目录 | 说明 |
|------|------|------|
| 单元测试 | `tests/unit/` | 按 `src/` 结构镜像。覆盖 api、cli、mcp、components、setting 等模块。使用 mock 隔离外部依赖。 |
| 集成测试 | `tests/integration/` | 测试模块间交互：`http-concurrency.test.ts`（HTTP 并发）、`mcp-e2e.test.ts`（端到端 MCP 调用）、`server.test.ts`（server 启动）。 |
| 冒烟测试 | `tests/smoke/` | `live_mcp_smoke.cjs`：需要真实运行的思源实例，验证完整调用链路。 |

### 测试编写规范

- 对 `fetch` 使用 `vi.fn()` mock，在 `afterEach` 中自动恢复（由 `tests/setup.ts` 处理）。
- `tests/mocks/siyuan.ts` 提供 `siyuan` 模块的 mock，避免在 Node 测试中加载真实 SiYuan 前端模块。
- CLI 测试覆盖参数解析、flag 映射、配置读写、dispatch 路由、render 输出。
- MCP 测试覆盖配置迁移、权限校验、telemetry、analytics、token 计算、工具生命周期。

---

## 部署与发布

### 思源插件

1. `pnpm build` 生成 `dist/index.js`、`dist/mcp-server.cjs`、`dist/index.css`、`dist/plugin.json` 等。
2. 生产构建自动打包为 `package.zip`（根目录）。
3. 发布方式：
   - 上传到思源集市（marketplace）。
   - 或通过 `pnpm make-link` / `pnpm make-install` 本地安装。

### CLI 包

1. `pnpm build:cli` 生成 `cli/dist/cli.cjs`（自包含 CJS，无依赖）。
2. `pnpm publish:cli` 进入 `cli/` 目录执行 `npm publish --access public`。
3. 发布到 npm 后，用户可通过 `npm i -g siyuan-sisyphus` 安装，获得 `siyuan-sisyphus` 与 `siyuan` 两个命令。

### 版本同步

- 根 `package.json` 的 version 与 `plugin.json` 的 version 必须保持一致。
- `cli/package.json` 的 version 独立管理（CLI 发布节奏可能不同）。
- `scripts/update_version.js` 用于同步版本号到各配置文件。

---

## 安全考量

1. **Token 与认证**：
   - MCP HTTP 模式支持 Bearer token 认证（`SIYUAN_MCP_TOKEN` 或设置面板配置）。
   - stdio 模式通过环境变量 `SIYUAN_TOKEN` 传递思源 API token。
   - CLI 从 `~/.siyuan-sisyphus/config.json`（权限 `0600`）或环境变量读取 token。

2. **HTTPS 支持**：
   - HTTP Server 支持 TLS（证书 + 私钥），通过设置面板或环境变量 `SIYUAN_MCP_TLS_CERT` / `SIYUAN_MCP_TLS_KEY` 配置。
   - 绑定非回环地址（`0.0.0.0`）时必须启用 token 认证。

3. **危险动作确认**：
   - MCP 2026-07-28 模式下，delete、remove、find_replace、upload_asset、set_permission 等操作在执行前通过协议级多轮 elicitation 要求用户显式确认；拒绝或取消不会进入工具生命周期。
   - legacy MCP 客户端保留 instructions/help 警告路径，避免破坏旧协议兼容性。
   - CLI 模式下不做二次确认（命令行输入即视为确认）。

4. **权限隔离**：
   - 笔记本级权限防止 AI 越权访问敏感笔记本。
   - `workspace_info` 等敏感系统操作也被标记为 dangerous，需要确认。

---

## 给 AI 编码代理的特别提醒

1. **修改工具配置或 action 列表时**，必须同步更新：
   - `src/core/config.ts`（`TOOL_CATEGORIES`、action 常量、`buildDefaultToolConfig()`）
   - `src/core/tool-registry.ts`（注册表导入）
   - `src/core/types.ts`（Zod schema）
   - `src/core/help.ts`（帮助文案）
   - `src/tools/` 下的对应工具目录或文件（`index.ts` 中的 variants + `handlers.ts`）
   - `src/tools/index.ts`（如有新增工具，需 barrel export）
   - 文档（README、docs/、API_MCP_MAPPING.md 等）

2. **新增 Vite build target** 时，必须在 `vite.config.ts` 的 `validTargets` 数组中登记。

3. **开发时使用 `pnpm dev`**（watch 模式），而不是反复运行 `pnpm build`。

4. **关联到 SiYuan 时使用 `pnpm make-link`**，它会在思源插件目录创建指向 `dev/` 的符号链接。

5. **不要假设本地文件系统可访问**：即使是 standalone 模式，配置也应通过 `SiYuanClient.readFile()` / `writeFile()` 走思源 API。特许例外仅有两处：① CLI 自身配置（`~/.siyuan-sisyphus/config.json`）；② 上传/下载/导出类 action（如 `upload_asset`、`export_resources`），因必须通过本地文件系统中转二进制数据。新增例外必须经过评审。

6. **保持 CLI 与插件行为一致**：如果某个能力在插件侧可用，CLI 侧也应通过同一 `callTool()` 路径暴露，避免逻辑分叉。

7. **测试先行**：新增 action 或修改核心路由时，请在 `tests/unit/` 或 `tests/integration/` 补充对应测试。运行 `pnpm test` 确保全绿。

8. **i18n 源文件为 JSON**：`public/i18n/*.json` 是最终产物源文件。如需 YAML，可用 `yaml-plugin.js` 转换，但当前项目直接使用 JSON。

9. **文档站点**：VitePress 文档在 `docs/` 中，支持中英文。修改功能后应同步更新对应语言的文档。
