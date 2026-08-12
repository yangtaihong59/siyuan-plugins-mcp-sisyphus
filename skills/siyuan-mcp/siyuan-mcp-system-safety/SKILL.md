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
```text
extension(action="list", refresh=false)
```

## Extension trust and lifecycle verification

Treat an extension package as executable third-party code. Keep these checks separate; passing one does not prove the next one:

1. **Static package check**: inspect the package metadata and required files, exact `minAppVersion`, `backends`, `kernels`, and `frontends` values, then review the source, entrypoint, handlers, and cleanup paths. A package validator can catch malformed or incompatible files, but it cannot prove that SiYuan loaded the package.
2. **Actual loading**: inspect the current runtime inventory and the user-visible enabled state. A package being present, discoverable, or statically valid is not evidence that its `onload` or kernel entrypoint ran.
3. **Registration and unregistration**: for an approved live check, verify the lifecycle-owned surface after enablement (for example a frontend Agent action or plugin MCP tool), then disable/unload it and verify the same name is gone. Confirm that DOM nodes, listeners, timers, RPC methods, and MCP tools are cleaned up; the official `siyuan://help/action/extension/list` bridge only reports tools exposed by SiYuan's `/mcp` registry and is not a substitute for frontend UI evidence.
4. **Reload and functional readback**: use the supported reload path, then repeat discovery and one harmless surface-specific interaction. Check that the new behavior works once, old registrations are absent, and no duplicate handlers remain. Do not treat a refreshed tool list as proof that a plugin UI or desktop-only code path works.

Browser-desktop verification covers browser-compatible surfaces and ordinary web UI only. SiYuan desktop-app verification is required for desktop-only surfaces such as Electron/desktop-window or backend/kernel behavior; a desktop pass does not prove browser compatibility. Use the exact manifest frontend values (`desktop`, `desktop-window`, `browser-desktop`, or `browser-mobile`) and validate each declared surface separately. Enabling, disabling, reloading, or invoking an untrusted package is a live side effect and requires explicit user approval; this scenario guidance does not authorize it.

If an action or field is rejected, inspect `siyuan://help/tool-overview` and the relevant `siyuan://help/action/{tool}/{action}` resource instead of guessing. Search results can lag recent writes; direct ID/path reads do not depend on indexing.

## Runtime and write guarantees

CLI execution is an explicit command, but that consent does not prove strict safe writes. Raw MCP payloads and Agent-generated calls likewise do not establish which coordinator or confirmation path handled them. Check the active runtime help and returned fields such as `writeSafetyGuaranteed` before relying on preflight, idempotency, or readback guarantees. If execution may have started and the response is lost, do not blindly resend; reread the exact target. Direct kernel, native, third-party, notification, sync, feedback, and local export effects remain outside Sisyphus strict-write guarantees.

## MCP safety

Respect server permission errors and dangerous-action confirmation responses. Never bypass them with another action. The MCP server must not write skill files or configuration into the client machine.
