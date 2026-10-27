# SiYuan MCP Sisyphus —— AI 编码代理项目指南

> 本文档面向 AI 编码代理。阅读者应对本项目一无所知，所有信息均基于实际代码与配置，不假设、不泛化。

---

## 项目概述

**SiYuan MCP Sisyphus** 是 SiYuan Note（思源笔记）的插件 + 独立 CLI 工具，让 AI Agent 能够通过两种接口安全地操作思源笔记：

1. **MCP Server 插件**：作为 SiYuan 插件运行，对外暴露 MCP（Model Context Protocol）服务。AI 客户端（Claude Desktop、Cursor、Cherry Studio 等）通过 HTTP 或 stdio 连接。
2. **独立 CLI `siyuan-sisyphus`**：发布到 npm 的包名 `siyuan-sisyphus`，安装后提供 `siyuan-sisyphus` / `siyuan` 命令。直接通过思源 HTTP API 执行单次操作后退出，无需 MCP 客户端。

两种接口共享同一套底层能力，覆盖思源绝大部分功能：笔记本管理、文档操作、块级读写、属性视图（数据库）、搜索、标签、文件资源、闪卡、系统接口等。聚合工具类别和静态 action 清单以 `src/core/config.ts` 的 `TOOL_CATEGORIES` 与 `ACTIONS_BY_CATEGORY` 为唯一事实来源；`extension` 还可按官方注册表发现动态 action。

- 仓库地址：`https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus`
- 作者：Taihong Yang
- 许可证：MIT
- 当前版本：以根 `package.json` 为准（与 `plugin.json` 同步；CLI 子包版本独立）

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
│   │   ├── tool-registry.ts     # TOOL_REGISTRY：聚合工具注册表
│   │   ├── tool-call-gate.ts    # planToolCall：三入口共用的 tools/call 决策（别名规范化、开关、确认、写入策略、协调写）
│   │   ├── write-safety-coordinator.ts # 严格写入协调器主流程（锁、租约、账本、提交）
│   │   ├── write-safety-probe.ts / write-safety-av.ts / write-safety-records.ts # 状态探针、AV 校验、共享小工具（依赖链 coordinator→probe→av→records）
│   │   ├── write-coordinator-client.ts # 严格写入委托 kernel 协调器的客户端（CLI 与 server 共用）
│   │   ├── kernel-file-transfer.ts # 委托写入时的文件暂存上传与导出落盘
│   │   ├── tool-lifecycle.ts    # 工具调用生命周期：analytics、telemetry、token 计数、错误包装
│   │   ├── config.ts            # ToolConfig 类型、默认值、配置迁移（扁平 → 嵌套）、危险动作定义
│   │   ├── permissions.ts       # PermissionManager：笔记本级权限（rwd/rw/r/none）
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
│   ├── tools/                   # 聚合工具的实现
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
│   │   ├── notebook/            # notebook 工具（index.ts + handlers.ts + schemas.ts）
│   │   ├── document/            # document 工具
│   │   ├── block/               # block 工具
│   │   ├── av/                  # av（数据库）工具
│   │   ├── search/              # search 工具（含 sql-builder、permission-filter）
│   │   ├── file/                # file 工具
│   │   ├── tag/                 # tag 工具
│   │   ├── system/              # system 工具
│   │   ├── flashcard/           # flashcard 工具
│   │   ├── mascot/              # mascot（吉祥物余额）工具
│   │   ├── fs/                  # fs 工具：基于人类可读路径的文档门面
│   │   ├── timeline/            # timeline 工具：文档历史与版本对比
│   │   ├── extension/           # extension 工具：桥接官方插件注册的 MCP 工具
│   │   └── feedback/            # feedback 工具
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
│   ├── kernel/                  # kernel target：运行在思源内核 goja 沙箱中的 MCP 端点
│   │   ├── index.ts             # 入口：请求分发、会话、调度
│   │   ├── client.ts            # KernelSiYuanClient（内核内直连 API）
│   │   ├── baked-action-schemas.ts # 构建期替换 zod schema 的预烘焙 JSON Schema
│   │   └── node-shims.ts / polyfill.ts # goja 环境下的 Node/Web API 垫片
│   │
│   ├── mcp-apps/                # mcp-app target：MCP Apps 富交互页面（单文件 HTML）
│   │
│   ├── ui/                      # Svelte UI 与设置面板
│   │   ├── components/          # 桌面悬浮宠物组件与行为逻辑
│   │   ├── setting/             # 插件设置面板
│   │   ├── version-control/     # 快照与版本对比面板（Svelte；逻辑在 shared/version-control）
│   │   └── shared/              # UI 共享组件
│   │
│   ├── shared/                  # 跨入口纯函数（版本比较、哈希规范化、token 估算、路径/SQL、AV 载体判定等）
│   │   └── version-control/     # block-diff / timeline 纯逻辑（UI 面板与 timeline 工具共用）
│   │
│   └── types/
│       ├── index.d.ts           # 思源常用数据结构（Block、Notebook 等）
│       └── api.d.ts             # API 请求/响应类型定义
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
│   ├── analyze-description-tokens.mjs # 真实 instructions + tools/list 成本分析
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

`vite.config.ts` 根据环境变量 `BUILD_TARGET` 分五路构建：

| Target | 入口 | 产物 | 说明 |
|--------|------|------|------|
| `renderer` | `src/index.ts` | `dist/index.js` + `dist/index.css` | 插件 UI（SiYuan 加载） |
| `server` | `src/core/server.ts` | `dist/mcp-server.cjs` | MCP Server（Node 进程） |
| `kernel` | `src/kernel/index.ts` | `dist/kernel.js`（IIFE） | 内核托管 MCP 端点（goja 沙箱） |
| `mcp-app` | `src/mcp-apps/index.html` | `.mcp-app-dist/index.html` | MCP Apps 单文件页面，被 server/kernel 内联 |
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
pnpm build              # renderer + kernel + server（含 mcp-app）
pnpm build:cli          # 仅 CLI
pnpm publish:cli        # 构建并发布 siyuan-sisyphus 到 npm

# 质量门禁（CI：.github/workflows/ci.yml 在 push/PR 到 main、dev 时执行 typecheck + test + build）
pnpm typecheck          # tsc --noEmit，须保持 0 错误

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

所有思源能力被收敛为聚合工具，每个工具通过 `action` 字段路由到具体 operation。`src/core/config.ts` 中的 `TOOL_CATEGORIES` 定义类别顺序，`ACTIONS_BY_CATEGORY` 定义每类静态 action；要查看或更新清单，直接以这两个导出为准。`extension` 的官方下游工具仍按运行时注册表动态发现。

静态清单由单元测试从这两个导出计算，避免文档在独立 action PR 合并后保留过期计数。

**约定**：不要拆散这个模型。每个 action 不是独立工具，而是聚合工具的参数分支。这降低了 MCP 的上下文占用，也保持了 CLI 命令的一致性。

### 工具定义模式（`defineTool`）

每个工具目录（如 `src/tools/notebook/`）遵循统一工厂模式：

1. 在 `src/tools/<tool>/index.ts` 使用 `defineTool({ name, description, variants, handlers, actionSchema })` 定义。
2. `variants`：每个 action 的 schema 变体（参数、必填字段、描述）。
3. `handlers`：通常放在 `src/tools/<tool>/handlers.ts`，按 action 分发；`handler` 内部自行用同目录 `schemas.ts` 的 Zod schema 解析 `rawArgs`，保持类型狭窄。
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

1. **Tool Description 层**：给出工具用途、边界和各 action 的紧凑必填字段签名；复杂参数与领域说明通过 help/resources 按需读取。
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

## 已知结构债（2026-10-26 审阅）

以下问题已确认、尚未重构；改动相关代码时优先顺手收敛，不要再新增同类重复：

- **旧客户端的危险动作确认**：不支持 MRTR 确认的旧客户端，server 只靠指令层提示确认、不拦截执行；kernel 要求 `confirm=true` 否则拒绝。收紧 server 会破坏旧客户端，待决定。
- **core 与 tools 互相引用**：工具依赖 `core/config`、`core/permissions` 等基础模块，而 `core` 的注册表与写协调器又依赖工具层。彻底解环需把 core 拆成“基础层”与“装配层”，改动面大，暂缓；工具与协调器共用的业务契约（如 `tools/av/add-rows-plan.ts`、`tools/document/batch-rename-plan.ts`）放在对应工具目录。
- **哈希实现**：`sha256:v1:` 有 3 条实现（`write-safety-hash`、`canonical-state`、`markdown-snapshot`），运行时约束与规范化输入不同，且值会被持久化/比对，暂不合并。

### 已收敛的约定（勿回退）

- tools/call 前置错误统一用 `tools/internal/shared.ts` 的 `createUnknownToolResult` / `createDisabledToolResult` / `createDisabledActionResult`；执行中逃逸的异常用 `createErrorResult` 包成工具错误。server、kernel、CLI 不要再各写一份。
- 依赖方向：`ui` / `cli` 可依赖 `core` / `tools` / `shared`，反之不可；`shared` 只依赖 `api` / `types`。
- 路径与 SQL 小工具统一放在 `src/shared/`：`siyuan-path.ts`（`stripSySuffix` / `normalizeFsPath`）、`sql.ts`（`escapeSqlString`）。不要在模块内再写本地副本。
- `av/handlers.ts` 的写入用 `dispatchAvTransaction`（载体解析 + `updated` 戳 + 派发）与 `avWriteSuccess`（刷新目标 + 成功结果）；仅当操作体本身要引用载体 ID 时才手写 `withUpdatedOperation`。
- AV 载体块判定统一用 `shared/av-carrier-dom.ts` 的 `isExactAvCarrierDom`（要求块自身开标签上同时有 `data-node-id`、`data-type="NodeAttributeView"`、`data-av-id`）；不要用 `dom.includes(...)` 粗判。
- 工具层只依赖 `SiYuanClient` **接口**（`api/client.ts`）；HTTP 实现为 `HttpSiYuanClient`，内核实现为 `KernelSiYuanClient`。不要在生产代码里探测 `request` 等废弃方法，测试替身用 `tests/helpers/mock-client.ts`。
- renderer（UI）不得 import `tool-registry` 或任何工具实现；MCP 初始成本由 server/kernel 在 tools/list 时写入 `mcp-initial-cost.json`，UI 只读取。
- tools/call 的决策只在 `core/tool-call-gate.ts` 的 `planToolCall` 里做（别名规范化、开关、App 隐藏、危险确认、写入策略、是否走协调器）。server/kernel/CLI 只负责确认 UI、调度与渲染，不要在入口里再写判定。

## 给 AI 编码代理的特别提醒

1. **修改工具配置或 action 列表时**，必须同步更新：
   - `src/core/config.ts`（`TOOL_CATEGORIES`、action 常量、`buildDefaultToolConfig()`）
   - `src/core/tool-registry.ts`（注册表导入）
   - `src/tools/<tool>/schemas.ts`（该工具的 Zod schema）
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

## 使用 pi 进行场景测试

用户要求通过 pi 做真实验收、全面场景测试或发现使用卡点时，先读 `docs/testing/PI_ACCEPTANCE_PLAN.md` 与 `tests/acceptance/README.md`。默认模型使用当前 pi 模型目录中的 `deepseek/deepseek-flash`；先核实，不自动换模型。使用 `scripts/acceptance-plan.mjs --check` 核对源码 action 是否都已规划。

区分功能回归与全新会话的角色体验，不把源码辅助结果当作新手盲测；分别统计真实正向、正常拒绝、mock、blocked 与未执行。现有测试范围授权明确且目标一致时不逐 action 重复确认；未知工作区或外部副作用仍需明确范围。计划、help、schema 与模型口述均不是实际执行证据。未经单独要求，不因测试而自动修产品、提交或发布。
