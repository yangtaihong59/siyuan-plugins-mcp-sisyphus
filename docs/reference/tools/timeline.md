# timeline

Use `timeline` to manage named document/global snapshot nodes, inspect block-level document differences, and selectively restore historical content.

For the complete agent workflow and safety checklist, load the official `siyuan://skills/siyuan-mcp-timeline` skill or invoke the `siyuan_timeline` MCP prompt. See also [Common Tasks](../common-tasks.md#compare-and-restore-a-document-timeline).

## Actions

| Action | Required fields | Notes |
|--------|-----------------|-------|
| `list_nodes` | `scope` | `document` and `all` also require `documentId`; paginated, newest first |
| `create_node` | `name`, `scope` | `document` also requires `documentId`; returns the stable `tag` |
| `compare_node` | `documentId`, `tag` | Creates an untagged current-state snapshot and returns paginated block changes |
| `delete_node` | `tag` | Document tags also require `documentId`; dangerous and disabled by default |
| `rollback_document` | `documentId`, `tag` | Restores one document file, not the whole repository; dangerous and disabled by default |
| `rollback_block` | `documentId`, `tag`, `changeKey` | Recalculates the diff and restores one still-matching block change; dangerous and disabled by default |

## Workflow

```text
timeline(action="list_nodes", scope="all", documentId="<doc-id>")
timeline(action="create_node", name="Before revision", scope="document", documentId="<doc-id>")
timeline(action="compare_node", documentId="<doc-id>", tag="<tag>", page=1, pageSize=20)
timeline(action="rollback_block", documentId="<doc-id>", tag="<tag>", changeKey="<change-key>")
```

`compare_node` returns changed blocks by default. Set `includeUnchanged=true` when unchanged context is needed. Each change includes historical/current Markdown, an opaque `changeKey`, and whether block rollback is supported.

## Target, side effects, and recovery boundaries

Resolve the document ID and timeline tag before any comparison or restore. A global tag is workspace metadata; a document-scoped tag is tied to the document ID encoded in the tag and must be called with that same ID. Do not select a node by display name alone when tags or documents are ambiguous.

- `create_node` creates a repository snapshot and a protective tag. For a document node it also records a document-side index entry. The tag/index is a navigation aid, not proof that a later restore will cover every related file.
- `compare_node` creates an untagged current-state workspace snapshot before calculating the diff. That snapshot is an external repository write and a comparison pre-image, not the historical node and not evidence that recovery has completed. Repeated comparisons therefore leave additional repository snapshots.
- `delete_node` removes the protective tag and document index entry only; the underlying repository snapshot remains. Removing a tag is not deletion of the snapshot and does not restore anything.
- `rollback_document` resolves the selected document's historical repository file and restores that one document file. It is not a whole-repository checkout and does not promise to restore assets, attribute-view JSON, notebook state, or other files that are related to the document.
- `rollback_block` uses the `changeKey` from a recent comparison, recalculates the diff, and restores one still-matching change. Modified blocks are updated in place, added blocks are deleted, and removed blocks are reinserted only when a safe position can be resolved. A stale key or unsafe structural change is rejected rather than guessed.

Protective snapshots and kernel-side backup snapshots reduce the cost of a mistake; they do not mean that rollback succeeded. Treat a successful action envelope as “the requested operation was accepted” until the target content is read back.

### Before/after images and bounded rollback readback

Before a rollback, retain the exact `documentId`, `tag`, selected historical file/block, and the `old`/`current` Markdown from `compare_node`. Review the diff and stop competing writers or sync actors before a destructive restore. Do not chain a rollback with new writes before this checkpoint is recorded.

After `rollback_document`, read the same document by ID with `block(action="get_kramdown", id=...)` (and inspect the `.sy` structure when structural fidelity matters). After `rollback_block`, read the affected block and its parent/neighbor order, then compare the result with the selected historical Markdown. Only after content persistence is credible should you reload or inspect the live UI; the UI refresh performed by the tool is not a content proof. If the content readback passes but the live UI has not been checked, report recovery as persistence-verified but UI-unverified. If a rollback response is lost, re-run `compare_node`/exact content reads first; never blindly repeat the destructive action.

## MCP App

MCP Apps clients open exactly one inline timeline through the dedicated `timeline_app` Tool; ordinary `timeline` queries no longer render Apps. Pass `documentId` for a document timeline and optionally `tag` to open a specific diff directly.

The separate MCP Apps settings page controls the Timeline App and all six human operations. Listing, comparing, creating, deleting, and rollback clicks use the model-hidden `timeline_app_action` Tool, so AI rollback can remain disabled while a user performs rollback inside the App. Notebook permission checks and high-risk elicitation/MRTR confirmation still apply.

On the Diff screen, the first document or block rollback click opens a non-layout confirmation overlay. The control stays under the pointer for the second click; the overlay does not intercept pointer events and remains available to assistive technology as a live status message.

## Safety and permissions

- Listing and comparing document nodes require notebook read permission.
- Creating a document node requires write permission.
- Deleting a document node and every rollback action require `rwd`.
- Global nodes expose snapshot metadata only and are not attached to a notebook permission.
- `delete_node` removes the protective tag and document index entry only. The underlying repository snapshot remains available.
- Explicit user confirmation is required before `delete_node`, `rollback_document`, or `rollback_block`. CLI invocation is treated as confirmation.
- AI permissions retain their existing defaults. The Timeline App and all six App actions are enabled by default and can be disabled independently.
- Legacy node association and migration remain available only in the plugin timeline UI.

## CLI examples

```bash
siyuan-sisyphus timeline create-node --name "Before rewrite" --scope document --document-id <doc-id> --json
siyuan-sisyphus timeline compare-node --document-id <doc-id> --tag <tag> --page-size 20 --json
```
