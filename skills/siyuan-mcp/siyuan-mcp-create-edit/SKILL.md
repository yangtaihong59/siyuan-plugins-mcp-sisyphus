---
name: siyuan-mcp-create-edit
description: MCP playbook for creating and editing SiYuan documents and blocks. Use for path-based document creation, block append/insert/update, metadata, daily notes, and verified edits.
---

# Create and Edit SiYuan Content with MCP

Read the target first, choose the highest-level action that preserves intent, perform one bounded change, then read it again.

## Protected writes and readback

For a mutation covered by strict safe writes, call the same action and business arguments with `validateOnly=true`, use the returned precondition field, and submit one fresh UUIDv7 `requestId`. Never invent or recycle a hash credential. After the write, reread the exact stable ID or resolved path with enough bounded fields to prove the intended change and continue until the response is complete.

If the connection fails after execution may have started, or the result says `outcome_unknown` or `readback_mismatch`, do not retry with a new request ID. Inspect the target and resolve the outcome first. A CLI command, raw MCP payload, or Agent-generated call is not by itself evidence that this coordinator path or its guarantees applied; use the current safety response and runtime help.

## Create documents

Use a workspace path for convenient path-based creation:

```text
fs(action="write", path="/Notebook/Project/Notes", markdown="# Notes\n\nInitial content.")
```

Use a notebook ID plus notebook-local hpath when low-level control is needed:

```text
document(action="create", notebook="<notebook-id>", path="/Project/Notes", markdown="# Notes")
```

Do not include the notebook name in the low-level hpath.

## Edit blocks

```text
block(action="append", parentID="<doc-id>", dataType="markdown", data="## New section\n\nParagraph.")
```
```text
block(action="insert", previousID="<block-id>", dataType="markdown", data="Inserted paragraph.")
```
```text
block(action="update", id="<block-id>", dataType="markdown", data="Replacement block content.")
```

Use block `update` only when replacing the whole block is intended. Prefer a scoped replacement for a small textual change:

```text
block(action="replace", id="<block-id>", edit={"old":"draft","new":"final"})
```

## Metadata and daily notes

```text
block(action="set_attrs", id="<block-id>", attrs={"custom-source":"agent"})
```
```text
document(action="create_daily_note", notebook="<notebook-id>")
```

Before rename, move, delete, or broad replacement, resolve the exact target, show the affected scope, and obtain approval. After every mutation, read by stable ID when possible. Use `siyuan://help/action/block/append` when any parameter is uncertain.
