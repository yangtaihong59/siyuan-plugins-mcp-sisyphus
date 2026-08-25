# 工具索引

这个页面汇总项目暴露的 14 个聚合工具。

适用场景：你已经知道大致领域，但还需要定位到具体工具页面。

相关页面：

- [参考首页](../index.md)
- [常见任务](../common-tasks.md)

| 工具 | 动作数量 | 页面 |
|------|-------------|------|
| `fs` | 8 | [fs 工具](./fs.md) |
| `notebook` | 11 | [notebook 工具](./notebook.md) |
| `document` | 17 | [document 工具](./document.md) |
| `block` | 21 | [block 工具](./block.md) |
| `av` | 12 | [av 工具](./av.md) |
| `file` | 19 | [file 工具](./file.md) |
| `search` | 8 | [search 工具](./search.md) |
| `tag` | 3 | [tag 工具](./tag.md) |
| `timeline` | 6 | [timeline 工具](./timeline.md) |
| `system` | 8 | [system 工具](./system.md) |
| `flashcard` | 6 | [flashcard 工具](./flashcard.md) |
| `extension` | 动态 | [extension 工具](./extension.md) |
| `mascot` | 3 | [mascot 工具](./mascot.md) |
| `feedback` | 1 | [feedback 工具](./feedback.md) |

## 动作汇总

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
- `extension`: list，以及已启用官方插件工具和可选思源原生 MCP 工具对应的动态 action
- `mascot`: get_balance, shop, buy
- `feedback`: submit
