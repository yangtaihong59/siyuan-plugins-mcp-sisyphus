# Read scope and database guidance

Primary document, block, search and database reads expose `readInfo`. Coverage and representation are independent: `truncated=false` alone does not prove that a whole document or database was returned.

| Field | Meaning |
| --- | --- |
| `scope` | Document, block(s), database, columns, view query, search query, SQL query or primary-key query |
| `coverage` | `complete`: this response covers that scope; `partial`: a known subset; `unknown`: insufficient kernel evidence |
| `representation` | `markdown`, `kramdown`, `textmark`, `html`, `database_raw`, `database_columns`, `database_rows`, `view`, `search_snippets`, `sql_rows`, `primary_key_values` |
| `limitations` | Known limits such as pagination, a nonzero window offset, permission filtering, unknown totals or database placeholders |

A complete view query still reflects its filters and hidden columns. Search snippets are not document bodies. A Markdown database placeholder does not include database rows or cells. Reaching the last page does not make that response include earlier pages.

## Follow-up calls

Each `nextSteps` entry contains `purpose`, `tool` and executable `arguments`. Pass those arguments to the named tool. Suggestions retain query, view, filter and window settings; they only read data or help and never supply speculative write values or bypass permissions.

- `continue_read`: continue a document window, search, primary-key query or database view. Grouped views retain independent group offsets.
- `read_database`: use a real `avID`, plus a verified carrier `blockID` when available.
- `read_view`: read an existing view with `createIfNotExist=false`.
- `read_match`: read one matching block.
- `edit_cells_help`: obtain the full `av.set_cells` contract.

Disabled tools/actions are omitted using current configuration. Configuration failures omit suggestions. An absent or empty `nextSteps` does not prove completeness: inspect `readInfo` and existing pagination fields. Missing group totals or IDs do not produce guessed continuation calls. Arbitrary SQL is never rewritten automatically; narrow a truncated query or use explicit ordering and LIMIT/OFFSET.

## Database identities

`databaseContext` identifies the AV, any exact carrier/view, locations of existing column/row fields, and `idUsage`. Column types and options remain in `columns` (`get`) or `av.keyValues[].key` (`get(scope="raw")`) rather than being duplicated.

- `avID` identifies the database; `blockID` identifies a carrier. Mirrors may share the same AV; an unspecified carrier is not guessed.
- `rows[].rowID` identifies an AV row in the canonical `query(mode="rows")` projection. Cells map stable `columnID` to `{value, formatted}`. Optional `fields` projects requested columnIDs and always keeps `rowID`. A cell value ID is neither a column ID nor a row ID. The complete native payload remains under `get(scope="raw")`.
- `resolvedRows[].rowID` in `query(mode="primary_keys")` identifies an AV row; `sourceBlockID` identifies its bound note block. Detached rows have no source block.
- Column `key.id` is passed as `columnID` to `set_cells`; column operations use `keyID` as documented by their action help.
- `query(mode="primary_keys")` returns `{key, values}` in `rows`. Its `blockIDs` are database carriers and must not be zipped with rows. The default page size is 16. `resolvedRows` supplies identities; bound rows are filtered by source-block permissions.

## Coverage

Implemented for `fs.read`, `document.get_doc`, `block.get_kramdown/batch_kramdown`, `search.fulltext/semantic/query_sql`, and `av.get/query`. MCP and CLI share these contracts. Other reads do not yet promise this metadata.

Full-text search retains the complete kernel page. After permission, parent or tag filtering, `total=null` means the filtered total is unknown; `pageCount` and `hasNextPage` still allow scanning subsequent kernel pages.
