---
name: siyuan-mcp-sisyphus
description: Top-level skill for operating SiYuan Note through the Sisyphus MCP server. Use to choose an aggregated tool, discover action resources, route complex tasks to a scenario skill, and apply permissions and safety rules.
---

# SiYuan Sisyphus with MCP

Use the narrowest scenario skill that matches the task. For unfamiliar fields, inspect `siyuan://help/tool-overview` and the relevant `siyuan://help/action/{tool}/{action}` resource before calling an action; live action help is the parameter-level source of truth.

## Scenario routing

| Scenario | Skill |
| --- | --- |
| Browse notebooks, documents, paths, IDs, and blocks | `siyuan-mcp-browse-read` |
| Create documents or edit blocks | `siyuan-mcp-create-edit` |
| Fulltext, SQL, backlinks, references, and replacement | `siyuan-mcp-search-query` |
| Attribute views, columns, rows, and cells | `siyuan-mcp-database` |
| Assets, extraction, and exports | `siyuan-mcp-file-export` |
| Tags, decks, cards, and review | `siyuan-mcp-tag-flashcard` |
| Timeline nodes, snapshot comparison, and rollback | `siyuan-mcp-timeline` |
| Permissions, system information, and dangerous operations | `siyuan-mcp-system-safety` |
| Rich Markdown, math, diagrams, and SiYuan markup | `siyuan-mcp-markup-guide` |

## Tool choice

Prefer `fs` for ordinary human-readable workspace paths. Use `document` or `block` for IDs, storage paths, metadata, or block-granular changes. Use `av` for real databases rather than Markdown tables. Use `timeline` for named snapshots, document diffs, and rollback. Low-complexity `feedback` and `mascot` actions need no separate scenario skill.

The CLI, a raw MCP payload, and an Agent-generated call are invocation forms, not proof that Sisyphus strict-write handling ran. For a protected mutation, follow the selected runtime's current help and returned safety fields. The documented preflight, single-attempt transport, idempotency, and readback guarantees apply only when the call is routed through the active Sisyphus write coordinator with strict mode enabled. Do not infer kernel-level compare-and-swap or parity with native SiYuan and third-party calls.

## Operation risk before routing

Classify the requested operation before choosing a surface: **R** is read or discovery; **W1** is an additive or local write; **W2** changes structure, references, assets, or attribute-view data; **W3** affects notebooks, imports, sync, history, or workspace-wide state. Use the narrowest surface and confirmation appropriate to the tier. Treat an undocumented or uncertain operation as the higher-risk tier until current action help and returned policy fields establish otherwise. This is routing discipline, not a replacement for the current action schema or safety policy.

```text
system(action="get_version")
```
```text
notebook(action="list")
```
```text
fs(action="tree", path="/Notebook", maxDepth=3)
```
```text
fs(action="read", path="/Notebook/Folder/Doc", blockStart=0, blockLimit=50, tokenBudget=2000)
```

## Shared invariants

- Read `/AGENTS.md` through `fs` before workspace-aware tasks when it exists.
- A workspace path such as `/Notebook/Folder/Doc`, an hpath such as `/Folder/Doc`, and a storage path such as `/20260712123000-abc123.sy` are different values.
- Resolve the exact target before mutating: map a human path or search candidate to the returned stable ID and retain its notebook, hpath, and storage path. Never derive an opaque ID or storage path from a title, and never treat a candidate list as the final target.
- Read before writing; after a mutation, read the affected object again.
- Keep reads bounded and prove completeness: use `nextWindow` or explicit `blockStart`/`blockLimit`/`tokenBudget` for documents, and page parameters for lists and searches. Continue while another page/window is advertised, then reread the exact affected ID/path and compare the intended field or status.
- If a write response is lost, or the result is `outcome_unknown` or `readback_mismatch`, stop and inspect the exact target. Do not resend with a new `requestId` merely because the acknowledgement was missing.
- Missing results may be caused by notebook permissions or indexing delay.
- Obtain explicit approval before deletes, moves, bulk replacement, permission changes, local upload/export, or sensitive workspace disclosure.
