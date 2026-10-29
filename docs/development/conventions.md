# Conventions

This page records contributor-facing coding and structure conventions.

When to read this page: you are implementing a change and want to stay aligned with the repo shape.

## Conventions

- Keep plugin-facing and CLI-facing behavior aligned when they reuse the same tool
- Use the existing grouped-tool model instead of inventing one tool per action
- Keep doc facts aligned with `src/core/config.ts`, `src/mcp/tool-registry.ts`, and current build targets
- Prefer SiYuan API access over direct filesystem behavior for remote-safe operations
