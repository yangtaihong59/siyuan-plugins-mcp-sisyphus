# Adding Tools

This page outlines the current workflow for introducing a new aggregated tool.

When to read this page: you are adding a new tool category.

## Workflow

1. Add or extend API wrappers in `src/api/*` if needed
2. Define tool/action types in `src/core/config.ts` and related schemas
3. Implement the tool module under `src/tools/<tool>/` as `index.ts` + `handlers.ts`
4. Register it in `src/mcp/tool-registry.ts`
5. Add default config and help text
6. Add tests

## Gotchas

- Tool docs and config action lists must stay aligned
- Permission checks need to be explicit for notebook-scoped mutations
- Shared tool-layer infrastructure belongs in `src/tools/internal/`; cross-tool helpers belong in `src/tools/internal/helpers/`
