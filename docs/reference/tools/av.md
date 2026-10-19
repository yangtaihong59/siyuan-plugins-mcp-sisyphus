# av tool

Operate real SiYuan databases through **search → get → query → add_rows / set_cells**. Databases are not Markdown tables.

## Reading and creation

| Action | Contract |
| --- | --- |
| `search` | Find databases by `keyword`, including name and primary-key matches; results remain databases. |
| `get` | Requires `avID`; `scope` is `structure` (default), `columns`, `view`, or `raw`. |
| `query` | Requires `avID`; `mode` is `rows` (default) or `primary_keys`. Supports `keyword`, `page`, and `pageSize`. |
| `create` | Requires `parentID`; optionally accepts a new `avID`. Preflight first to obtain `requestId`. |

Structure returns database identity, columns with canonical `columnID`, view summaries, and query guidance. It excludes all row IDs and cell values. Columns reads field definitions; view reads the actual `viewID`, filters, sorts, grouping, visibility, and order. Raw preserves the complete native AV. Paginated query results provide canonical `rowID`; never substitute source block IDs or cell value IDs.

Get and row queries accept an optional verified carrier `blockID`. Selection precedence is explicit `viewID`, the carrier selection, then the kernel default. Responses report `selectionSource` and `selectionFallback`. Invalid explicit IDs fail. **Reading B never switches a carrier currently selecting A**; updating B through that carrier is still rejected.

Row queries support `viewID` and `groupPaging`. Primary-key mode defaults to 16 rows and rejects `viewID`, `groupPaging`, and negative page sizes. Queries always send `createIfNotExist=false`. Guidance references actual IDs and enabled actions only. Completed pages have no continuation suggestion; permission filtering and unknown totals stay explicit.

Creation persists stable `avID` and `blockID` before dispatch, with stages `ids_reserved`, `av_created`, `carrier_inserted`, and `verified`. A reserved block ID does not prove a carrier exists. Partial or unknown results retain IDs, the last confirmed stage, and current step. Never automatically recreate, resume, or clean up a partial creation. Replay checks the ledger before existence and returns the saved business result; restart cannot cause redispatch. A new request targeting an existing AV fails.

## Updating a view

`update_view` requires `avID`, `blockID`, and `viewID`. The verified carrier must currently select that exact view.

| Parameter | Behavior |
| --- | --- |
| `filters`, `sorts` | Complete replacements; `[]` clears. Filters permit four nested groups followed by leaves. |
| `group` | Complete replacement; `{ "field": "" }` clears. Nonempty grouping requires `method`, `order`, and `hideEmpty`; numeric-range grouping also requires `range`. |
| `columnVisibility` | `[{columnID, hidden}]`; changes only listed fields. |
| `columnOrder` | Every current view field exactly once, including hidden fields; not the database-wide key set. |

Omitted settings remain unchanged. Null, unknown properties, duplicate IDs, and incomplete order lists fail. An empty visibility list contributes no change and is rejected on its own; it is allowed alongside another valid setting. Semantically unchanged requests return `no_change` without a transaction.

Preflight and commit validate the whole request and layout field set. Unsupported layouts or configurations fail before submission. Native operations share one transaction request; this is not a guarantee of kernel atomicity. Readback verifies requested values and protects unrequested configuration: visibility exempts only the specified fields' hidden flags, ordering exempts positions but preserves other field attributes, and grouping uses native derived-state normalization. An unexpected difference means complete verification failed, not proof that this operation caused it.

## Independent write boundaries

- `add_rows`, `remove_rows`, and `duplicate_rows` manage records. `create_from_template` stays separate because it can create documents.
- `add_column`, `remove_column`, and `set_column_options` create, remove, and configure fields respectively. Select options are a complete replacement; omitted options are removed.
- `set_cells` edits ordinary cells. Relations require `set_relation`, which may update another database's reverse relation. `itemID` and `relatedItemIDs` are AV row IDs, not bound block IDs.
- `set_new_item_templates`, `configure_two_way_relation`, and `configure_rollup` remain separate. Document templates require explicit `saveLocation`; rollups use native `RollupCalc`.
- `add_view` creates views; kanban requires an existing select field. `duplicate` retains SiYuan copy-as-mirror behavior.
- Existing permissions, user confirmation, and strict preflight apply. For `update_view`, preflight with `validateOnly:true`, then submit the same arguments with the returned `requestId` and `expectedStateHash`. Creation requires a durable ledger and preflight ID even when general strict mode is disabled.

## Configuration migration

Normalized settings include `avActionsVersion:2`. Missing markers and version 1 use the legacy mapping:

| New action | Legacy sources |
| --- | --- |
| `create` | `render` |
| `get` | `get`, `get_attribute_view_keys`, `get_attribute_view_filter_sort` |
| `query` | `render`, `get_primary_key_values` |
| `update_view` | The five former view-configuration actions |

Merge explicit raw flags before defaults. Any explicit false disables the merged action; legacy get:true cannot override disabled key access. Only version 2 interprets new flags directly. Unknown versions report an error and disable AV access. Reads never rewrite configuration; saving persists the marker and removes old keys. Old actions and the top-level id alias are removed.

## Examples

```json
{"action":"get","avID":"<av-id>"}
{"action":"query","avID":"<av-id>","viewID":"<view-id>","page":1,"pageSize":20}
{"action":"query","avID":"<av-id>","mode":"primary_keys","keyword":"project"}
{"action":"update_view","avID":"<av-id>","blockID":"<carrier-id>","viewID":"<view-id>","filters":[],"columnVisibility":[{"columnID":"<column-id>","hidden":true}],"validateOnly":true}
```

```bash
siyuan av get --av-id <av-id>
siyuan av get --av-id <av-id> --scope view --block-id <carrier-id>
siyuan av query --av-id <av-id> --page 1 --page-size 20
siyuan av create --parent-id <parent-id> --validate-only
```

See [read results](../read-results.md) and [strict writes](../write-safety.md).
