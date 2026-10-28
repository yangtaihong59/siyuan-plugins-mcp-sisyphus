# Live Smoke Tests

This directory contains tests that require a **running SiYuan instance**.

They are **not** part of the Vitest unit/integration suite (`pnpm test`).

## Prerequisites

1. Start SiYuan: `/Applications/SiYuan.app/Contents/MacOS/SiYuan`
2. Build the plugin: `pnpm build`

## Running

The default live check is `tests/live/verify.cjs` (`pnpm test:live`, also `pnpm test:smoke`).
It writes only inside one temporary notebook it creates and removes that notebook,
its permission entry and the attribute-view file it created, so it is safe against
a personal workspace:

```bash
pnpm build
SIYUAN_API_URL=http://127.0.0.1:6806 SIYUAN_TOKEN=<token> pnpm test:live
```

## Specialised scripts in this directory

Run these only when their scope fits; read each header first.

| Script | Scope |
|---|---|
| `built-issue-regressions.cjs`, `kernel-telemetry-failure-live.cjs` | Built bundle against a mock kernel / local receiver; no real workspace |
| `kernel-app-browser-live.cjs`, `kernel-remaining-faults.cjs`, `kernel-remaining-live.cjs` | Isolated Docker container only; never a personal workspace |
| `live-av-v2.cjs`, `live-av-id-contract.cjs`, `live-layout-feedback.cjs`, `live-feedback-regressions.cjs` | Writes fixtures inside the notebook named by `SIYUAN_TEST_NOTEBOOK` |
| `live-timeline-mascot.cjs` | Real workspace; read its header before running |
| `live-write-safety-matrix.cjs` | **Destructive**: exercises every mutation through the CLI and rewrites tool config; test workspace only |
| [`AI_INTERFACE_TEST.md`](../../docs/testing/AI_INTERFACE_TEST.md) | Manual guide for AI-driven regression testing |

## Persona scenarios and pi

For broader user workflows and friction reporting, start with
[`../acceptance/README.md`](../acceptance/README.md) and the
[pi acceptance plan](../../docs/testing/PI_ACCEPTANCE_PLAN.md).
The scenario catalog is a plan, not evidence of completed live testing.
Do not automatically run every legacy smoke script: some change global settings
or clean older fixtures. Review each script's scope before execution.
