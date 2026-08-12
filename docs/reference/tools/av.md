# av

This tool covers attribute view and database-style operations.

When to read this page: you need to inspect or mutate a real SiYuan attribute view instead of using Markdown tables.

Related pages:

- [Common Tasks](../common-tasks.md)
- [Permissions](../permissions.md)

## Common Actions

| Group | Actions |
|------|---------|
| Read | `get`, `render`, `get_attribute_view_keys`, `get_attribute_view_filter_sort`, `search`, `get_primary_key_values` |
| Row operations | `add_rows`, `remove_rows`, `duplicate_rows` |
| Column operations | `add_column`, `remove_column`, `set_column_options` |
| Cell updates | `set_cells` |
| View structure and configuration | `duplicate`, `add_view`, `set_filters`, `set_sorts`, `set_group`, `set_column_visibility`, `set_column_order` |

## Parameters and Semantics

- `render` can also create and materialize an AV when `createIfNotExist=true` and `blockID` is provided. In this mode, `blockID` is the target parent/insertion context, and MCP inserts a SiYuan-style spun AV block through a transaction.
- To render an existing AV, pass the AV ID as `id`. For smoother Agent workflows, `render` also accepts `avID` as a compatibility alias, and `av.search` results include reusable `renderArgs`.
- Keep the `blockID` returned by `render(createIfNotExist=true)`. Later AV reads and writes usually only need `avID`; MCP resolves the owning database block from row bindings, mirror database blocks, or the blocks-table AV block record. Pass `blockID` when you need an exact database-block view context, when multiple mirrors are possible, or as an explicit fallback for a brand-new empty AV.
- `set_cells` is typed by `valueType` and accepts either single-cell fields or a `cells` / `items` array.
- `rowID` refers to the row item ID, not the source block ID.
- `set_column_options` accepts the complete desired option list for one `select` or `mSelect` key. It is a replacement, not a patch: names omitted from the list are removed through the native transaction operation. An empty list is valid. SiYuan can retain a temporary append order when new names are introduced; MCP returns `intermediate_option_order` in that case and never sends a second, hidden reorder transaction.
- `duplicate_rows` accepts ordered, canonical **bound** row item IDs that are present in a persistent top-level view. It creates detached text-record copies; it does not accept detached source rows, cell value IDs, or bound source block IDs. Primary-key text and permitted cell values are copied, while rollup/created/updated values follow SiYuan's native copy behavior. A copied two-way relation writes its reverse destination AV values too.
- AV writes follow SiYuan frontend transaction operations where possible, including row/column/cell operations and database block `updated` refresh metadata.
- `duplicate` follows SiYuan's copy-as-mirror flow: it duplicates the AV definition, spins the AV block DOM, and inserts the mirror database block through a transaction. `previousID` controls the insertion position when provided; otherwise `blockID` or an automatically resolved owning database block is used as the default insertion context.
- View-local configuration is deliberately explicit. `add_view`, `set_filters`, `set_sorts`, `set_group`, `set_column_visibility`, and `set_column_order` require all of `avID`, `blockID`, and `viewID`. The `blockID` must be a real `NodeAttributeView` carrier for `avID`, and its current `custom-sy-av-view` must equal `viewID`; MCP rejects a stale carrier instead of accepting the kernel's current-view fallback.
- `add_view` creates a named `table`, `gallery`, or `kanban` view in one native transaction. Kanban is permitted only when an existing select field is available, because the kernel otherwise creates a select field and adds it to every existing view. `add_view` does not curate the carrier-visible-view list; use the existing `block.set_attrs` action deliberately when that is the reviewed objective.
- `set_filters` and `set_sorts` take complete replacements, never patches. `filters: []` clears all filters; raw AV JSON may serialize its persisted empty AND root without the empty `filters` member, and MCP treats only that known normalization as equivalent.
- `set_group` accepts `field: ""` to clear grouping. `set_column_order` requires the complete existing field-ID set exactly once. Column visibility and order apply to the layout-specific fields of the exact carrier-selected view.

## Safety Rules

- AV operations are real database operations, not Markdown table edits.
- Use `av` for structured data instead of faking database behavior in Markdown.
- `set_column_options` and `duplicate_rows` are dangerous W2 mutations: they require explicit confirmation and a strict `validateOnly=true` preflight before execution. `duplicate_rows` also requires `rw` or `rwd` on the source AV carrier and every resolved reverse-relation destination carrier.
- If either action reports `outcome_unknown` or `readback_mismatch`, do not retry automatically. Inspect the exact source and relation destinations first.
- These six view configuration actions are strict writes. Call with `validateOnly: true`, then repeat with the issued `expectedStateHash` and a new UUIDv7 `requestId`. Sisyphus uses one HTTP dispatch, then raw `/api/av/getAttributeView` plus carrier attrs/DOM for readback; it never uses `renderAttributeView` as persistence proof and does not automatically retry an unknown response.

## Examples

MCP:

```json
{
  "action": "get",
  "id": "<attribute-view-id>"
}
```

```json
{
  "action": "add_column",
  "avID": "<attribute-view-id>",
  "keyName": "Status",
  "keyType": "select"
}
```

```json
{
  "action": "set_filters",
  "avID": "<attribute-view-id>",
  "blockID": "<exact-node-attribute-view-carrier>",
  "viewID": "<carrier-selected-view-id>",
  "filters": [
    {
      "combination": "and",
      "filters": [
        {
          "column": "<status-key-id>",
          "operator": "=",
          "value": {"type": "select", "mSelect": [{"content": "In progress"}]}
        }
      ]
    }
  ],
  "validateOnly": true
}
```

CLI:

```bash
siyuan av get --id <attribute-view-id>
siyuan av render --av-id <attribute-view-id>
siyuan av add-column --av-id <attribute-view-id> --key-name Status --key-type select
siyuan av add-rows --av-id <attribute-view-id> --block-ids <block-id>
siyuan av add-rows --av-id <attribute-view-id> --primary-key-texts "Plain text row"
siyuan av set-column-visibility --av-id <attribute-view-id> --block-id <carrier-block-id> --view-id <view-id> --key-id <key-id> --hidden true --validate-only
```

## Action List

- `get`
- `render`
- `get_attribute_view_keys`
- `get_attribute_view_filter_sort`
- `search`
- `add_rows`
- `remove_rows`
- `add_column`
- `remove_column`
- `set_cells`
- `set_column_options`
- `duplicate_rows`
- `duplicate`
- `get_primary_key_values`
- `add_view`
- `set_filters`
- `set_sorts`
- `set_group`
- `set_column_visibility`
- `set_column_order`
