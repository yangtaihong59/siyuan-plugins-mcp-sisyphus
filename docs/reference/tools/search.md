# search

This tool covers full-text and semantic search, backlinks, SQL reads, asset search, and controlled find-replace operations.

When to read this page: you need to find content across the workspace or query indexed content.

Related pages:

- [Permissions](../permissions.md)
- [Error Types](../error-types.md)

## Common Actions

| Group | Actions |
|------|---------|
| Text search | `fulltext`, `semantic`, `search_refs` |
| Graph / relation | `get_backlinks`, `list_invalid_refs` |
| SQL / asset | `query_sql`, `search_assets`, `fulltext_asset_content` |
| Mutating | `find_replace` |

## Safety Rules

- `find_replace` is the mutating exception in this tool and requires explicit confirmation.
- `query_sql` is read-only and only accepts `SELECT` statements; add `LIMIT` yourself. It preserves every selected column and is available only when every notebook is readable. If any notebook is unreadable, raw SQL is rejected before execution because aggregates, joins, CTEs, and subqueries cannot be safely post-filtered by notebook.
- Search results are filtered by notebook permissions where applicable.
- Full-text search can lag briefly behind recent writes because indexing is eventually consistent.
- `semantic` requires SiYuan 3.7.0+, an enabled embedding model, and a completed native embedding index. Encrypted notebooks are not included in that index.
- The plugin's **Embedding Model** settings page can edit the native configuration on SiYuan 3.7.0–3.7.1. Connection testing, index statistics, rebuild, and failed-item retry require SiYuan 3.7.2+.

## Examples

MCP:

```json
{
  "action": "fulltext",
  "query": "meeting notes",
  "methodName": "keyword",
  "sortBy": "relevance"
}
```

```json
{
  "action": "semantic",
  "query": "ideas related to resilient distributed systems",
  "typeShortcodes": ["h", "p"]
}
```

```json
{
  "action": "query_sql",
  "sql": "SELECT id, content, type FROM blocks LIMIT 10"
}
```

CLI:

```bash
siyuan search fulltext --query "meeting notes" --method-name keyword --sort-by relevance
siyuan search semantic --query "ideas related to resilient distributed systems" --type-shortcodes-json '["h","p"]'
siyuan search query-sql --sql "SELECT id, content, type FROM blocks LIMIT 10"
```

Notes for AI callers:

- Prefer semantic aliases such as `methodName`, `sortBy`, `query`, and `sql` over numeric `method` / `orderBy` or short legacy fields like `k`.
- `fulltext` returns `plainContent` and `excerpt` by default, so you do not need `stripHtml=true` just to get plain text.
- When `parentId`, `hasTags`, or permission filtering are involved, `kernel*` metadata describes the raw SiYuan search page and `returned*` metadata describes the post-filtered data in the current response.

## Action List

- `fulltext`
- `semantic`
- `query_sql`
- `get_backlinks`
- `search_refs`
- `find_replace`
- `search_assets`
- `fulltext_asset_content`
- `list_invalid_refs`
