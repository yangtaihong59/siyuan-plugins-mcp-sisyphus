# Permissions

This page explains notebook-level access control and confirmation rules.

When to read this page: you see permission errors or need to reason about write and delete boundaries.

Related pages:

- [Path Semantics](./path-semantics.md)
- [Tools Index](./tools/index.md)

## Permission Levels

| Level | Read | Write | Delete |
|-------|------|-------|--------|
| `rwd` | Yes | Yes | Yes |
| `rw` | Yes | Yes | No |
| `r` | Yes | No | No |
| `none` | No | No | No |

Notes:

- Notebooks without an explicit entry default to `r` (read-only)
- Notebooks created after the plugin is installed get an explicit `rwd` entry, whether created with `notebook(action="create")`, the CLI, or the SiYuan UI. Existing explicit entries are never overridden, and reopening an existing notebook folder keeps the default
- Permissions are managed through `notebook(action="set_permission")`
- Changes apply to subsequent calls immediately

## File-Tree Status Display

The plugin can show an `R`, `RW`, `RWD`, or `NONE` badge beside each notebook root in SiYuan's file tree. The badge only reflects the current MCP permission; it does not change note content or SiYuan's own access control. Child documents inherit their notebook permission, so they are not decorated individually.

Click a badge to cycle through `NONE → R → RW → RWD → NONE` and save immediately. Successful changes do not show a notification; a failed save restores the previous permission. Use **Show MCP permissions in the file tree** on the plugin's Permissions settings page to turn this display off. A dashed `R` means that the notebook has no explicit entry and is using the default read-only permission.

## High-Risk Actions

These actions require explicit user confirmation:

- `notebook.remove`
- `notebook.set_permission`
- `document.remove`
- `document.move`
- `block.delete`
- `block.move`
- `file.upload_asset`
- `file.remove_unused_assets`
- `file.delete_asset`
- `search.find_replace`
- `system.workspace_info`
- `system.perform_sync`
- `tag.remove`
- `flashcard.remove_card`

Additional notes:

- `file.upload_asset` also requires special confirmation for large files
- `file.export_resources` with a local `outputPath` should be treated as high-risk operationally
