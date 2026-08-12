---
name: siyuan-sisyphus-system-cli
description: CLI-only guide for SiYuan Sisyphus setup, profiles, permissions, system actions, help discovery, JSON output, dangerous operations, and troubleshooting.
---

# SiYuan System and Safety with the CLI

Start with a connectivity check and inspect live help before unfamiliar actions.

```bash
siyuan-sisyphus system get-version --json
```
```bash
siyuan-sisyphus system get-current-time --json
```
```bash
siyuan-sisyphus notebook get-permissions --json
```

Notebook permissions are `rwd`, `rw`, `r`, and `none`. Missing content can mean permission filtering rather than absence. Record the current value before proposing a permission change.

## Confirmation boundary

Obtain explicit approval before notebook/document/block deletion or move, bulk replacement, asset upload or deletion, local-path export, tag/card removal, permission changes, and workspace path disclosure. State the exact target and consequence. A prior request to inspect or diagnose is not approval to mutate.

```bash
siyuan-sisyphus system conf --mode 'summary' --json
```
```bash
siyuan-sisyphus system network --json
```
```bash
siyuan-sisyphus system notify --msg 'Task complete' --level 'info' --timeout '5000' --json
```

If an action or field is rejected, inspect `siyuan-sisyphus list` and `siyuan-sisyphus help <tool> <action>` instead of guessing. Search results can lag recent writes; direct ID/path reads do not depend on indexing.

## Runtime and write guarantees

CLI execution is an explicit command, but that consent does not prove strict safe writes. Raw MCP payloads and Agent-generated calls likewise do not establish which coordinator or confirmation path handled them. Check the active runtime help and returned fields such as `writeSafetyGuaranteed` before relying on preflight, idempotency, or readback guarantees. If execution may have started and the response is lost, do not blindly resend; reread the exact target. Direct kernel, native, third-party, notification, sync, feedback, and local export effects remain outside Sisyphus strict-write guarantees.

## CLI setup

Use `siyuan-sisyphus init` and `siyuan-sisyphus config list|get|set|use` to manage profiles. Configuration precedence is command flags, environment variables, active profile, then defaults. Use `--json` for scripts. The CLI treats execution as confirmation, so the agent must still ask the user before risky commands.
