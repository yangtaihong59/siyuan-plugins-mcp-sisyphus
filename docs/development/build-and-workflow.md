# Build and Workflow

This page explains the build targets and the normal development loop.

When to read this page: you need to build the plugin, build the CLI, or link the plugin into SiYuan.

## Build Targets

- `renderer` -> `src/index.ts`
- `server` -> `src/mcp/server.ts`
- `cli` -> `src/cli/index.ts`

## Common Commands

```bash
pnpm dev
pnpm build
pnpm build:cli
pnpm make-link
pnpm make-install
```

## Workflow

- Use `pnpm dev` for day-to-day plugin development
- Use `pnpm build` for release validation and packaging
- Use `pnpm build:cli` when you are changing CLI behavior
- CLI runtime code lives in `src/cli/*`, while npm package metadata lives in `cli/`
