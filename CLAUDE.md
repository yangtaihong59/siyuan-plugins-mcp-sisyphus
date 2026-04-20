# SiYuan MCP Sisyphus 项目编码记忆

## 项目配置（2026-04-01）

### 环境初始化已完成
按照 `plugin-sample-vite-svelte` 的配置标准，对本项目进行了配置。

#### 项目信息
- ✓ 项目名称为：`siyuan-plugins-mcp-sisyphus`
- ✓ 作者改为：`Taihong Yang`
- ✓ 仓库链接已更新：`https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus`

#### 依赖安装
```bash
pnpm install
# 所有依赖已安装，包括：
# - @modelcontextprotocol/sdk ^1.26.0
# - zod ^4.3.6
# - 及所有 devDependencies
```

#### 构建验证
```bash
pnpm build  # 生产构建成功
# 生成文件：
# - dist/index.js (30.56 kB) - 插件UI
# - dist/mcp-server.cjs (283.98 kB) - MCP服务器
# - dist/index.css (0.57 kB)
# - package.zip (302 kB) - 完整包
# - cli/dist/cli.cjs - CLI 自包含 CJS bundle
```

### 实测验证
```bash
/Applications/SiYuan.app/Contents/MacOS/SiYuan --remote-debugging-port=9222 # 启动思源

```
### 项目结构（基于 Vite + Svelte）
```
src/
├── index.ts          # 插件入口
├── mcp/
│   └── server.ts     # MCP服务器入口
├── cli/              # CLI 源码
│   ├── index.ts      # CLI 入口
│   ├── dispatch.ts   # 命令派发
│   ├── args.ts       # 参数解析
│   ├── flag-mapper.ts
│   ├── render.ts
│   ├── list-help.ts
│   ├── config.ts
│   └── init.ts
├── components/       # Svelte 组件
├── libs/            # 工具库
├── api/             # API 封装
├── setting/         # 设置面板
├── types/           # 类型定义
└── ...

cli/                # 独立 npm 子包（siyuan-sisyphus）
dist/               # 构建输出（自动生成）
dev/                # 开发模式输出（运行 pnpm dev 时）
tests/              # 测试套件（unit / integration / smoke）
docs/               # VitePress 文档站点
skills/             # Kimi CLI skills
```

### 常用开发命令
```bash
pnpm dev              # 开发模式：watch 模式实时编译
pnpm build            # 生产模式：优化打包插件
pnpm build:cli        # 构建 CLI：产出 cli/dist/cli.cjs
pnpm publish:cli      # 构建并发布 siyuan-sisyphus 包到 npm
pnpm test             # 运行全部单元/集成测试
pnpm test:watch       # 测试 watch 模式
pnpm test:coverage    # 测试覆盖率报告
pnpm test:smoke       # 冒烟测试
pnpm make-link        # 创建开发链接到 SiYuan 插件目录
```

### 构建配置文件
- `vite.config.ts` - Vite 配置（支持多入口）
- `tsconfig.json` - TypeScript 配置（已配置路径别名）
- `svelte.config.js` - Svelte 配置
- `plugin.json` - SiYuan 插件元数据

### 重要配置项
- **输出格式**：CommonJS (CJS)
- **多入口编译**：
  - `src/index.ts` → `dist/index.js`
  - `src/mcp/server.ts` → `dist/mcp-server.cjs`
- **路径别名**：`@/*` 映射到 `src/*`
- **自动打包**：每次生产构建自动生成 `package.zip`

### 提醒
1. 开发时使用 `pnpm dev` 而不是 `pnpm build`
2. 关联到 SiYuan 时使用 `pnpm make-link`
3. MCP 服务器代码在 `src/mcp/` 下，编译产物为 `dist/mcp-server.cjs`
4. 注意需要兼容远程场景，任何读写操作都必须经过 SiYuan API，不能直接访问本地文件系统

## 独立 CLI 子包（2026-04-18 首次发布，2026-04-18 重构为直接操作模式）

仓库现在同时发布两种产物：SiYuan 插件（根 `package.json` + `package.zip`）和独立 CLI（`cli/` 子目录，发布到 npm 包 `siyuan-sisyphus`，安装后提供 `siyuan-sisyphus` 命令，别名 `siyuan`）。

**CLI 定位**：类 `obsidian-cli` 的直接操作工具 —— `siyuan-sisyphus <tool> <action> [--flag value ...]`，比如：
```bash
siyuan-sisyphus notebook list
siyuan-sisyphus block append --parent-id <id> --data-type markdown --data "..."
siyuan-sisyphus document list-tree --notebook <id> --json | jq '.data[].hPath'
```
CLI 不再启动 MCP server 进程 —— 它直接通过思源 HTTP API 执行一次操作然后退出。AI 客户端仍然通过插件内部的 MCP server 接入。

### 目录
- `src/cli/` —— CLI 源码：
  - `index.ts` 入口 / 命令派发
  - `args.ts` 顶层参数解析（`dispatch` / `list` / `help` / `init` / `show-help` / `version`）
  - `dispatch.ts` 核心转发：调 `TOOL_REGISTRY[tool].callTool()`
  - `flag-mapper.ts` 基于 inputSchema 做 kebab↔camel 映射与类型强转
  - `render.ts` 人类可读渲染 / `--json` 紧凑输出 / ANSI 颜色
  - `list-help.ts` `list` 与 `help` 子命令
  - `config.ts` 读写 `~/.siyuan-sisyphus/config.json`（只有 `apiUrl` + `token`）
  - `init.ts` 精简版交互初始化
- `cli/` —— 独立 npm 子包（`package.json`、`README.md`、自包含产物 `dist/cli.cjs`）
- `~/.siyuan-sisyphus/config.json` —— 用户侧默认配置路径（`init` 命令生成，权限 `0600`）

### 构建 & 发布
```bash
pnpm build:cli     # 产出 cli/dist/cli.cjs（自包含 CJS bundle）
pnpm publish:cli   # 先构建再发布 siyuan-sisyphus 包（提供 siyuan-sisyphus / siyuan 命令）
```
CLI 直接 import `TOOL_REGISTRY`、`SiYuanClient`、`PermissionManager`，**不再**依赖 `mcp-server.cjs` 这个中间产物（`cli-server` Vite target 已删除）。

### 注意事项
- CLI bundle 是自包含 CJS，不依赖 `node_modules`；`cli/package.json` 的 `dependencies` 为空。
- CLI target 设了 `publicDir: false` 并在 `rollupOptions.external` 里保留 Node 内置模块。
- 新增 Vite target 必须在 `vite.config.ts` 的 `validTargets` 列表里登记。
- 配置优先级：CLI flag > 环境变量 > `~/.siyuan-sisyphus/config.json` > 默认值。
- Flag 命名：kebab/camel 都接受（`--parent-id` 与 `--parentID` 等价）；布尔 `--flag`/`--no-flag`；复杂对象用 `--<key>-json '<json>'`。
- PermissionManager 在 CLI 启动时试读权限文件，读失败就当空 map —— 未显式配置的 notebook 默认 `rwd`。
- 危险动作（delete、remove、find_replace 等）在 CLI 下**不**做二次确认 —— 用户主动输入命令即是确认。
