# Live Smoke Tests

This directory contains tests that require a **running SiYuan instance**.

They are **not** part of the Vitest unit/integration suite (`pnpm test`).

## Prerequisites

1. Start SiYuan: `/Applications/SiYuan.app/Contents/MacOS/SiYuan`
2. Build the plugin: `pnpm build`

## Running

```bash
pnpm test:smoke
```

## Files

- `live-av-v2.cjs` — Fresh built-CJS regression in an explicitly selected test notebook (`SIYUAN_TEST_NOTEBOOK`). Covers SQL, templates, AV views, permissions and strict writes. F08 runs five native-order and five reordered-candidate leases; the proxy only reorders real mirror candidates. It rejects parent-document carriers and checks HTTP-preflight / CLI-commit / replay. Uses isolated permission and ledger files; retains a report document.
- `live_mcp_smoke.cjs` — End-to-end smoke tests against a live SiYuan instance (27+ test cases covering permissions, navigation, search, block operations, etc.)
- `AI_INTERFACE_TEST.md` — Manual test guide for AI-driven regression testing of MCP interfaces

## Persona scenarios and pi

For broader user workflows and friction reporting, start with
[`../acceptance/README.md`](../acceptance/README.md) and the
[pi acceptance plan](../../docs/testing/PI_ACCEPTANCE_PLAN.md).
The scenario catalog is a plan, not evidence of completed live testing.
Do not automatically run every legacy smoke script: some change global settings
or clean older fixtures. Review each script's scope before execution.
