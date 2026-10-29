---
name: siyuan-mcp-database
description: MCP playbook for SiYuan attribute views. Use to inspect database metadata, query views, add columns or rows, update cells, and keep AV, view, row, column, and block IDs distinct.
---

# Operate SiYuan Databases with MCP

Never guess attribute-view identifiers. Inspect the AV and its views before changing rows or cells.

```text
av(action="get", avID="<av-id>")
```
```text
av(action="query", avID="<av-id>", page=1, pageSize=50)
```
```text
av(action="search", keyword="project")
```

Keep these identifiers distinct: AV ID identifies the database; view ID identifies a table/board view; row ID identifies a key value; column ID identifies a key; block ID identifies note content.

## Mutations

```text
av(action="add_column", avID="<av-id>", keyName="Status", keyType="select")
```
```text
av(action="add_rows", avID="<av-id>", rows=[{"clientKey":"e1","primaryKeyText":"Standup","cells":[{"columnID":"<date-column-id>","valueType":"date","date":"2026-11-05T09:30"}]}])
```
```text
av(action="add_rows", avID="<av-id>", viewID="<view-id>", blockIDs=["<block-id>"])
```
```text
av(action="set_cells", avID="<av-id>", cells=[{"rowID":"<row-id>","columnID":"<column-id>","valueType":"text","text":"Done"}])
```

To create rows together with their values (dates included), pass `rows` with `cells` in one add_rows call (up to 200 rows) instead of adding rows and then calling set_cells per row; set_cells takes many `cells` in one call too.

Before writing cells, query the current view and map column names to column IDs. Preserve the declared value type; do not put a date-shaped string into a number/date/select column without using the action’s expected value shape. Query again after mutation. Read `siyuan://help/action/av/set_cells` for the current cell schema.

Treat a successful mutation response as provisional until the same view and affected rows/cells are read back. Keep the query and readback paginated, continue while more data is advertised, and compare the intended cell values by stable row and column IDs. A raw MCP or CLI success message does not establish that strict-write coordination or complete readback occurred.
