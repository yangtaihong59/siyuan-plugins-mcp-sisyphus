# Tools Index

This page summarizes the 14 aggregated tools exposed by the project.

When to read this page: you know the general domain but need the right tool page.

Related pages:

- [Reference Home](../index.md)
- [Common Tasks](../common-tasks.md)

| Tool | Actions | Page |
|------|---------|------|
| `fs` | 8 | [fs](./fs.md) |
| `notebook` | 11 | [notebook](./notebook.md) |
| `document` | 17 | [document](./document.md) |
| `block` | 21 | [block](./block.md) |
| `av` | 12 | [av](./av.md) |
| `file` | 19 | [file](./file.md) |
| `search` | 8 | [search](./search.md) |
| `tag` | 3 | [tag](./tag.md) |
| `timeline` | 6 | [timeline](./timeline.md) |
| `system` | 8 | [system](./system.md) |
| `flashcard` | 6 | [flashcard](./flashcard.md) |
| `extension` | dynamic | [extension](./extension.md) |
| `mascot` | 3 | [mascot](./mascot.md) |
| `feedback` | 1 | [feedback](./feedback.md) |

## Action Summary

- `fs`: ls, tree, read, write, replace, rm, mv, reorder, search
- `notebook`: list, create, set_open_state, remove, rename, get_conf, set_conf, set_icon, get_permissions, set_permission, get_child_docs
- `document`: create, lookup, ensure_link_targets, rename, remove, move, reorder, get_child_blocks, get_child_docs, set_attr, list_tree, search_docs, get_doc, get_outline, create_daily_note, duplicate, heading_to_doc, doc_to_heading
- `block`: insert, prepend, append, update, replace, delete, move, set_fold_state, get_kramdown, batch_kramdown, get_children, transfer_references, set_attrs, get_attrs, info, breadcrumb, dom, recent_updated, word_count, add_to_daily_note, docs_info
- `av`: get, render, get_attribute_view_keys, get_attribute_view_filter_sort, search, add_rows, remove_rows, add_column, remove_column, set_cells, set_new_item_templates, create_from_template, configure_two_way_relation, configure_rollup, set_relation, duplicate, get_primary_key_values
- `file`: upload_asset, list_templates, read_template, create_template, update_template, delete_template, save_doc_as_template, render, export_md, export_markdown_snapshot, export_resources, list_unused_assets, get_doc_assets, audit_image_refs, read_image, get_image_ocr_text, remove_unused_assets, rename_asset, delete_asset, extract_doc
- `search`: fulltext, semantic, query_sql, get_backlinks, search_refs, find_replace, search_assets, fulltext_asset_content, list_invalid_refs
- `tag`: list, rename, remove
- `timeline`: list_nodes, create_node, compare_node, delete_node, rollback_document, rollback_block
- `system`: workspace_info, network, conf, notify, changelog, perform_sync, get_version, get_current_time
- `flashcard`: list_cards, get_decks, get_cards, review_card, create_card, remove_card
- `extension`: list, plus dynamic actions for enabled official plugin tools and optionally native SiYuan MCP tools
- `mascot`: get_balance, shop, buy
- `feedback`: submit
