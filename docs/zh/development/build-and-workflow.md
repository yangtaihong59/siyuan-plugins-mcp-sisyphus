# 构建与工作流

这个页面解释构建目标和日常开发工作流。

适用场景：你需要构建插件、构建 CLI，或者把插件链接进思源。

## 构建目标

- `renderer` -> `src/index.ts`
- `server` -> `src/mcp/server.ts`
- `cli` -> `src/cli/index.ts`

## 常用命令

```bash
pnpm dev
pnpm build
pnpm build:cli
pnpm make-link
pnpm make-install
```

## 工作流

- 日常插件开发使用 `pnpm dev`
- 发布前验证和打包使用 `pnpm build`
- 修改 CLI 行为时使用 `pnpm build:cli`
- CLI 运行时代码在 `src/cli/*`，npm 包元数据在 `cli/`
