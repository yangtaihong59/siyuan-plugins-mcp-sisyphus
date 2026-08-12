---
name: siyuan-mcp-system-safety
description: MCP guide for SiYuan system information, notebook permissions, action help, dangerous-operation confirmation, sensitive disclosures, and troubleshooting.
---

# SiYuan System and Safety with MCP

Start with a connectivity check and inspect live help before unfamiliar actions.

```text
system(action="get_version")
```
```text
system(action="get_current_time")
```
```text
notebook(action="get_permissions")
```

Notebook permissions are `rwd`, `rw`, `r`, and `none`. Missing content can mean permission filtering rather than absence. Record the current value before proposing a permission change.

## Confirmation boundary

Obtain explicit approval before notebook/document/block deletion or move, bulk replacement, asset upload or deletion, local-path export, tag/card removal, permission changes, and workspace path disclosure. State the exact target and consequence. A prior request to inspect or diagnose is not approval to mutate.

```text
system(action="conf", mode="summary")
```
```text
system(action="network")
```
```text
system(action="notify", msg="Task complete", level="info", timeout=5000)
```

If an action or field is rejected, inspect `siyuan://help/tool-overview` and the relevant `siyuan://help/action/{tool}/{action}` resource instead of guessing. Search results can lag recent writes; direct ID/path reads do not depend on indexing.

## Runtime and write guarantees

CLI execution is an explicit command, but that consent does not prove strict safe writes. Raw MCP payloads and Agent-generated calls likewise do not establish which coordinator or confirmation path handled them. Check the active runtime help and returned fields such as `writeSafetyGuaranteed` before relying on preflight, idempotency, or readback guarantees. If execution may have started and the response is lost, do not blindly resend; reread the exact target. Direct kernel, native, third-party, notification, sync, feedback, and local export effects remain outside Sisyphus strict-write guarantees.

## MCP safety

Respect server permission errors and dangerous-action confirmation responses. Never bypass them with another action. The MCP server must not write skill files or configuration into the client machine.
