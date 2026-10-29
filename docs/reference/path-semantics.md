# Path Semantics

This page defines the two path types used by document actions.

When to read this page: you are calling `document` actions and are unsure whether a field wants a human-readable path or a storage path.

Related pages:

- [Permissions](./permissions.md)
- [document tool](./tools/document.md)

## Human-Readable Path

Used by:

- `document(action="create")`
- `document(action="lookup", hpath=...)`

Format:

- `/Inbox/Weekly Note`

Rules:

- Must start with `/`
- Missing parent docs are auto-created empty

## Storage Path

Used by:

- `document(action="rename")`
- `document(action="remove")`
- `document(action="move")`
- `document(action="lookup", path=...)`
- `document(action="list_tree")`

Format:

- `/20240318112233-abc123.sy`

Rules:

- Represents the real file storage location
- Obtain it through `document(action="lookup", id=..., include="path")`
- If you already have a human-readable path, pass it as `hpath`; `lookup` may interpret a non-storage `path` as `hpath` for compatibility, but new calls should use the explicit field.

## Safe Workflow

1. Call `document(action="lookup", id=..., include="path")`
2. Reuse the returned storage path in follow-up operations
