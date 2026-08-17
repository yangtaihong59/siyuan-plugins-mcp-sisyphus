# Sisyphus 工具、Action 与 SiYuan API 映射

> 生成区由 `npm run api:audit` 重建；人工候选说明仅允许在文末标记区内编辑。

## 当前基线

- **14** 个聚合工具、**142** 个静态 action（不含隐式 `help`、MCP App 重复 action、`extension` 运行时动态 action）。
- `src/api` wrapper 覆盖口径为 **150** 个唯一 `/api/*` 字面量：**149** 个有效，覆盖当前 **582** 个内核 API 路径的 **25.6%**；工具层直调另列，不混入该基线。
- UI 设置页另有 **5** 个 UI-only 路径，不计入工具/API 覆盖率。
- 唯一失效 wrapper：`/api/asset/setImageAlpha`（`src/api/file.ts:93`）；本轮仅记录，不删除。
- 生成器直接读取当前工作区注册表，因此新增或移除 action 后会同步更新本页基线。

## 工具汇总

| 工具 | Action 数 | 危险 Action | 原生 MCP 重叠候选 |
|---|---:|---|---|
| `fs` | 9 | `rm`、`mv` | `document`、`block` |
| `notebook` | 11 | `remove`、`set_permission` | `notebook` |
| `document` | 18 | `remove`、`move` | `document`、`outline`、`dailynote` |
| `block` | 21 | `delete`、`move` | `block`、`attr` |
| `av` | 25 | `set_column_options`、`duplicate_rows`、`set_new_item_templates`、`create_from_template`、`configure_two_way_relation`、`configure_rollup`、`set_relation` | `database` |
| `file` | 19 | `upload_asset`、`delete_template`、`remove_unused_assets`、`delete_asset` | `file`、`asset`、`export`、`template` |
| `search` | 9 | `find_replace` | `search`、`sql`、`ref` |
| `tag` | 3 | `remove` | `tag` |
| `timeline` | 6 | `delete_node`、`rollback_document`、`rollback_block` | `repo`、`history` |
| `system` | 8 | `workspace_info`、`perform_sync` | `system`、`sync`、`workspace` |
| `flashcard` | 6 | `remove_card` | — |
| `extension` | 3 | — | `动态官方 MCP 工具` |
| `mascot` | 3 | — | — |
| `feedback` | 1 | — | — |

## 全量 Action 映射

端点角色采用保守静态分析：“直接”是 handler 可绑定的 wrapper/协议调用；“间接”是工具级可见但无法安全绑定到单一分支的调用；“回退”来自显式人工 overlay。权限解析、UI refresh、严格写预检和 lifecycle 属于横切链路，不冒充业务直接端点。

| 工具.Action | 直接端点 | 间接调用 | 回退接口 | 危险/安全级别 | 原生 MCP 重叠 | 备注 |
|---|---|---|---|---|---|---|
| `fs.ls` | `/api/filetree/listDocsByPath` | — | — | `read` | `document`、`block` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `fs.tree` | `/api/filetree/listDocsByPath` | — | — | `read` | `document`、`block` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `fs.read` | `/api/block/getBlockKramdown` | — | — | `read` | `document`、`block` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `fs.write` | `/api/filetree/createDocWithMd`<br>`/api/block/getBlockKramdown`<br>`/api/block/updateBlock` | — | — | `mutation(state)` | `document`、`block` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `fs.replace` | `/api/block/getBlockKramdown`<br>`/api/block/updateBlock` | — | — | `mutation(manifest)` | `document`、`block` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `fs.rm` | `/api/filetree/removeDocByID` | — | — | `mutation(state)`；危险：协议确认 | `document`、`block` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `fs.mv` | `/api/filetree/moveDocsByID`<br>`/api/filetree/renameDocByID` | — | — | `mutation(structure)`；危险：协议确认 | `document`、`block` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `fs.reorder` | `/api/filetree/changeSort` | — | — | `mutation(structure)` | `document`、`block` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `fs.search` | `/api/export/exportMdContent` | — | — | `read` | `document`、`block` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.list` | `/api/notebook/lsNotebooks` | — | — | `read` | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.create` | `/api/notebook/createNotebook` | — | — | `mutation(none)` | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.set_open_state` | `/api/notebook/openNotebook`<br>`/api/notebook/closeNotebook` | — | — | `mutation(state)` | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.remove` | `/api/notebook/removeNotebook` | — | — | `mutation(state)`；危险：协议确认 | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.rename` | `/api/notebook/renameNotebook` | — | — | `mutation(state)` | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.get_conf` | `/api/notebook/getNotebookConf` | — | — | `read` | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.set_conf` | `/api/notebook/setNotebookConf` | — | — | `mutation(state)` | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.set_icon` | `/api/notebook/setNotebookIcon` | — | — | `mutation(state)` | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.get_permissions` | `/api/file/getFile`<br>`/api/notebook/lsNotebooks` | — | — | `read` | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.set_permission` | `/api/file/getFile`<br>`/api/file/putFile` | — | — | `mutation(state)`；危险：协议确认 | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `notebook.get_child_docs` | `/api/filetree/listDocsByPath` | — | — | `read` | `notebook` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.create` | `/api/filetree/createDocWithMd`<br>`/api/filetree/createDoc` | — | — | `mutation(none)` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.lookup` | `/api/filetree/getPathByID` | — | `/api/query/sql` | `read` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.ensure_link_targets` | `/api/filetree/listDocsByPath` | — | — | `mutation(structure)` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.rename` | `/api/filetree/renameDocByID`<br>`/api/filetree/renameDoc` | — | — | `mutation(state)` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.remove` | `/api/filetree/removeDocByID`<br>`/api/filetree/removeDoc` | — | — | `mutation(state)`；危险：协议确认 | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.move` | `/api/filetree/moveDocsByID`<br>`/api/filetree/moveDocs` | — | — | `mutation(structure)`；危险：协议确认 | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.reorder` | `/api/filetree/changeSort` | — | — | `mutation(structure)` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.get_child_blocks` | `/api/block/getChildBlocks` | — | — | `read` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.get_child_docs` | `/api/filetree/listDocsByPath` | — | — | `read` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.set_attr` | `/api/transactions` | — | — | `mutation(state)` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.list_tree` | `/api/filetree/listDocsByPath` | — | — | `read` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.search_docs` | `/api/filetree/searchDocs` | — | — | `read` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.get_doc` | `/api/filetree/getDoc` | — | — | `read` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.get_outline` | `/api/outline/getDocOutline` | — | — | `read` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.create_daily_note` | `/api/filetree/createDailyNote` | — | — | `mutation(none)` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.duplicate` | `/api/filetree/duplicateDoc` | — | — | `mutation(state)` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.heading_to_doc` | `/api/filetree/heading2Doc` | — | — | `mutation(structure)` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `document.doc_to_heading` | `/api/filetree/doc2Heading` | — | — | `mutation(structure)` | `document`、`outline`、`dailynote` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.insert` | `/api/block/insertBlock` | — | — | `mutation(none)` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.prepend` | `/api/block/prependBlock` | — | — | `mutation(none)` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.append` | `/api/block/appendBlock` | — | — | `mutation(none)` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.update` | `/api/block/updateBlock` | — | — | `mutation(state)` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.replace` | `/api/block/getBlockKramdown` | — | — | `mutation(state)` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.delete` | `/api/block/deleteBlock` | — | — | `mutation(state)`；危险：协议确认 | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.move` | `/api/block/moveBlock` | — | — | `mutation(structure)`；危险：协议确认 | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.set_fold_state` | `/api/block/foldBlock`<br>`/api/block/unfoldBlock` | — | — | `mutation(state)` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.get_kramdown` | `/api/block/getBlockKramdown` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.batch_kramdown` | `/api/block/getBlockKramdowns` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.get_children` | `/api/block/getChildBlocks` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.transfer_references` | `/api/block/transferBlockRef` | — | — | `mutation(manifest)` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.set_attrs` | `/api/transactions` | — | — | `mutation(state)` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.get_attrs` | `/api/attr/getBlockAttrs` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.info` | `/api/block/getBlockInfo` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.breadcrumb` | `/api/block/getBlockBreadcrumb` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.dom` | `/api/block/getBlockDOM` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.recent_updated` | `/api/block/getRecentUpdatedBlocks` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.word_count` | `/api/block/getBlocksWordCount` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.add_to_daily_note` | `/api/block/appendDailyNoteBlock`<br>`/api/block/prependDailyNoteBlock` | — | — | `mutation(none)` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `block.docs_info` | `/api/block/getDocsInfo` | — | — | `read` | `block`、`attr` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.get` | `/api/av/getAttributeView` | — | — | `read` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.render` | `/api/av/renderAttributeView` | — | — | `mutation(none)` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.get_attribute_view_keys` | `/api/av/getAttributeViewKeys` | — | — | `read` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.get_attribute_view_filter_sort` | `/api/av/getAttributeViewFilterSort` | — | — | `read` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.search` | `/api/av/searchAttributeView` | — | `/api/file/readDir` | `read` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.add_rows` | `/api/av/addAttributeViewBlocks` | — | — | `mutation(none)` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.remove_rows` | `/api/av/removeAttributeViewBlocks` | — | — | `mutation(manifest)` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.add_column` | `/api/av/addAttributeViewKey` | — | — | `mutation(state)` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.remove_column` | `/api/av/removeAttributeViewKey` | — | — | `mutation(state)` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.set_cells` | `/api/av/setAttributeViewBlockAttr`<br>`/api/av/batchSetAttributeViewBlockAttrs` | — | — | `mutation(manifest)` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.set_column_options` | — | — | — | `mutation(state)`；危险：协议确认 | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.duplicate_rows` | — | — | — | `mutation(manifest)`；危险：协议确认 | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.duplicate` | `/api/av/duplicateAttributeViewBlock` | — | — | `mutation(state)` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.get_primary_key_values` | `/api/av/getAttributeViewPrimaryKeyValues` | — | — | `read` | `database` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `av.add_view` | — | — | — | `mutation(state)` | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.set_filters` | — | — | — | `mutation(state)` | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.set_sorts` | — | — | — | `mutation(state)` | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.set_group` | — | — | — | `mutation(state)` | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.set_column_visibility` | — | — | — | `mutation(state)` | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.set_column_order` | — | — | — | `mutation(state)` | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.set_new_item_templates` | — | — | — | `mutation(state)`；危险：协议确认 | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.create_from_template` | — | — | — | `mutation(state)`；危险：协议确认 | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.configure_two_way_relation` | — | — | — | `mutation(state)`；危险：协议确认 | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.configure_rollup` | — | — | — | `mutation(state)`；危险：协议确认 | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `av.set_relation` | — | — | — | `mutation(state)`；危险：协议确认 | `database` | 本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint |
| `file.upload_asset` | `/api/asset/upload` | — | — | `mutation(source)`；危险：协议确认 | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.list_templates` | `/api/search/searchTemplate` | — | — | `read` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.read_template` | `/templates/*filepath` | — | — | `read` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.create_template` | `/api/file/putFile` | — | — | `mutation(state)` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.update_template` | `/api/file/putFile` | — | — | `mutation(state)` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.delete_template` | `/api/search/removeTemplate` | — | — | `mutation(state)`；危险：协议确认 | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.save_doc_as_template` | `/api/template/docSaveAsTemplate` | — | — | `mutation(state)` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.render` | `/api/template/render`<br>`/api/template/renderSprig` | — | — | `read` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.export_md` | `/api/export/exportMdContent` | — | — | `read` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.export_markdown_snapshot` | `/api/export/exportMdContent` | — | — | `read` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.export_resources` | `/api/export/exportResources` | — | — | `external` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.list_unused_assets` | `/api/asset/getUnusedAssets` | — | — | `read` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.get_doc_assets` | `/api/asset/getDocAssets` | — | — | `read` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.audit_image_refs` | `/api/asset/getDocImageAssets` | — | — | `read` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.get_image_ocr_text` | `/api/asset/getImageOCRText` | — | — | `read` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.remove_unused_assets` | `/api/asset/removeUnusedAssets` | — | — | `mutation(manifest)`；危险：协议确认 | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.rename_asset` | `/api/asset/renameAsset` | — | — | `mutation(state)` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.delete_asset` | `/api/asset/removeUnusedAsset` | — | — | `mutation(state)`；危险：协议确认 | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `file.extract_doc` | `/api/export/exportMdContent` | — | — | `external` | `file`、`asset`、`export`、`template` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `search.fulltext` | `/api/search/fullTextSearchBlock` | — | — | `read` | `search`、`sql`、`ref` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `search.semantic` | `/api/search/semanticSearchBlock` | — | — | `read` | `search`、`sql`、`ref` | 数据外传/外部费用风险；最低 SiYuan v3.8.0 |
| `search.query_sql` | `/api/query/sql` | — | — | `read` | `search`、`sql`、`ref` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `search.get_backlinks` | `/api/ref/getBacklinkDoc`<br>`/api/ref/getBackmentionDoc` | — | `/api/query/sql` | `read` | `search`、`sql`、`ref` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `search.search_refs` | `/api/search/searchRefBlock` | — | — | `read` | `search`、`sql`、`ref` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `search.find_replace` | `/api/search/findReplace` | — | — | `mutation(manifest)`；危险：协议确认 | `search`、`sql`、`ref` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `search.search_assets` | `/api/search/searchAsset` | — | — | `read` | `search`、`sql`、`ref` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `search.fulltext_asset_content` | `/api/search/getAssetContent`<br>`/api/search/fullTextSearchAssetContent` | — | — | `read` | `search`、`sql`、`ref` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `search.list_invalid_refs` | `/api/search/listInvalidBlockRefs` | — | — | `read` | `search`、`sql`、`ref` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `tag.list` | `/api/tag/getTag`<br>`/api/search/searchTag` | — | — | `read` | `tag` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `tag.rename` | `/api/tag/renameTag` | — | — | `mutation(manifest)` | `tag` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `tag.remove` | `/api/tag/removeTag` | — | — | `mutation(manifest)`；危险：协议确认 | `tag` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `timeline.list_nodes` | `/api/repo/getRepoTagSnapshots`<br>`/api/attr/getBlockAttrs` | — | — | `read` | `repo`、`history` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `timeline.create_node` | `/api/repo/getRepoSnapshots`<br>`/api/repo/createSnapshot`<br>`/api/repo/getRepoTagSnapshots`<br>`/api/repo/tagSnapshot`<br>`/api/attr/getBlockAttrs`<br>`/api/attr/setBlockAttrs` | — | — | `mutation(none)` | `repo`、`history` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `timeline.compare_node` | `/api/repo/getRepoTagSnapshots`<br>`/api/repo/getRepoSnapshots`<br>`/api/repo/createSnapshot`<br>`/api/repo/diffRepoSnapshots`<br>`/api/repo/openRepoSnapshotFile` | — | — | `read` | `repo`、`history` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `timeline.delete_node` | `/api/repo/getRepoTagSnapshots`<br>`/api/repo/removeRepoTagSnapshot`<br>`/api/attr/getBlockAttrs`<br>`/api/attr/setBlockAttrs` | — | — | `mutation(state)`；危险：协议确认 | `repo`、`history` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `timeline.rollback_document` | `/api/repo/getRepoTagSnapshots`<br>`/api/repo/getRepoSnapshots`<br>`/api/repo/createSnapshot`<br>`/api/repo/diffRepoSnapshots`<br>`/api/repo/openRepoSnapshotFile`<br>`/api/repo/rollbackRepoSnapshotFile` | — | — | `mutation(state)`；危险：协议确认 | `repo`、`history` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `timeline.rollback_block` | `/api/repo/getRepoTagSnapshots`<br>`/api/repo/getRepoSnapshots`<br>`/api/repo/createSnapshot`<br>`/api/repo/diffRepoSnapshots`<br>`/api/repo/openRepoSnapshotFile`<br>`/api/block/updateBlock`<br>`/api/block/deleteBlock`<br>`/api/block/insertBlock` | — | — | `mutation(state)`；危险：协议确认 | `repo`、`history` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `system.workspace_info` | `/api/system/getWorkspaceInfo` | — | — | `read`；危险：协议确认 | `system`、`sync`、`workspace` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `system.network` | `/api/system/getNetwork` | — | — | `read` | `system`、`sync`、`workspace` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `system.conf` | `/api/system/getConf` | — | — | `read` | `system`、`sync`、`workspace` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `system.notify` | `/api/notification/pushMsg`<br>`/api/notification/pushErrMsg` | — | — | `external` | `system`、`sync`、`workspace` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `system.changelog` | `local:bundled changelog` | — | — | `read` | `system`、`sync`、`workspace` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `system.perform_sync` | `/api/sync/performSync` | — | — | `external`；危险：协议确认 | `system`、`sync`、`workspace` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `system.get_version` | `/api/system/version` | — | — | `read` | `system`、`sync`、`workspace` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `system.get_current_time` | `/api/system/currentTime` | — | — | `read` | `system`、`sync`、`workspace` | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `flashcard.list_cards` | `/api/riff/getRiffDueCards`<br>`/api/riff/getNotebookRiffDueCards`<br>`/api/riff/getTreeRiffDueCards` | — | — | `read` | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `flashcard.get_decks` | `/api/riff/getRiffDecks` | — | — | `read` | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `flashcard.get_cards` | `/api/riff/getRiffCards` | — | — | `read` | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `flashcard.review_card` | `/api/riff/reviewRiffCard`<br>`/api/riff/skipReviewRiffCard` | — | — | `mutation(state)` | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `flashcard.create_card` | `/api/riff/addRiffCards` | — | — | `mutation(none)` | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `flashcard.remove_card` | `/api/riff/removeRiffCards` | — | — | `mutation(state)`；危险：协议确认 | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `extension.list` | `/mcp` | — | — | `read` | `动态官方 MCP 工具` | 动态读取思源原生 MCP tools/list；运行时动态 action 不计入静态 142 |
| `extension.validate_package` | — | — | — | `read` | `动态官方 MCP 工具` | 动态读取思源原生 MCP tools/list；运行时动态 action 不计入静态 142 |
| `extension.diagnose_plugin_mcp` | — | — | — | `read` | `动态官方 MCP 工具` | 动态读取思源原生 MCP tools/list；运行时动态 action 不计入静态 142 |
| `mascot.get_balance` | `external:Sisyphus service` | — | — | `read` | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `mascot.shop` | `external:Sisyphus service` | — | — | `read` | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `mascot.buy` | `external:Sisyphus service` | — | — | `mutation(state)` | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |
| `feedback.submit` | `external:GitHub Issues` | — | — | `external` | — | 业务端点；另经过权限/刷新/写安全/lifecycle 横切链 |

## 插件后端 API 字面量分类

| API 路径 | 分类 | 位置 | 映射状态 |
|---|---|---|---|
| `/api/asset/getDocAssets` | api-wrapper | `src/api/file.ts:58` | 有效内核路由 |
| `/api/asset/getDocImageAssets` | api-wrapper | `src/api/file.ts:62` | 有效内核路由 |
| `/api/asset/getImageOCRText` | api-wrapper | `src/api/file.ts:66` | 有效内核路由 |
| `/api/asset/getUnusedAssets` | api-wrapper+core | `src/api/file.ts:54`<br>`src/core/write-safety-coordinator.ts:816` | 有效内核路由 |
| `/api/asset/removeUnusedAsset` | api-wrapper | `src/api/file.ts:85` | 有效内核路由 |
| `/api/asset/removeUnusedAssets` | api-wrapper | `src/api/file.ts:70` | 有效内核路由 |
| `/api/asset/renameAsset` | api-wrapper | `src/api/file.ts:78` | 有效内核路由 |
| `/api/asset/setImageAlpha` | api-wrapper | `src/api/file.ts:93` | 失效 wrapper（保留审计） |
| `/api/asset/upload` | api-wrapper | `src/api/file.ts:22` | 有效内核路由 |
| `/api/attr/getBlockAttrs` | api-wrapper+core | `src/api/block.ts:299`<br>`src/core/write-safety-coordinator.ts:592`<br>`src/core/write-safety-coordinator.ts:938` | 有效内核路由 |
| `/api/attr/setBlockAttrs` | api-wrapper | `src/api/block.ts:291` | 有效内核路由 |
| `/api/av/addAttributeViewBlocks` | api-wrapper | `src/api/av.ts:109` | 有效内核路由 |
| `/api/av/addAttributeViewKey` | api-wrapper | `src/api/av.ts:146` | 有效内核路由 |
| `/api/av/batchSetAttributeViewBlockAttrs` | api-wrapper | `src/api/av.ts:179` | 有效内核路由 |
| `/api/av/createAttributeViewItem` | api-wrapper | `src/api/av.ts:124` | 有效内核路由 |
| `/api/av/duplicateAttributeViewBlock` | api-wrapper | `src/api/av.ts:186` | 有效内核路由 |
| `/api/av/getAttributeView` | api-wrapper+core | `src/api/av.ts:32`<br>`src/core/write-safety-coordinator.ts:570` | 有效内核路由 |
| `/api/av/getAttributeViewFilterSort` | api-wrapper | `src/api/av.ts:59` | 有效内核路由 |
| `/api/av/getAttributeViewKeys` | api-wrapper | `src/api/av.ts:52` | 有效内核路由 |
| `/api/av/getAttributeViewPrimaryKeyValues` | api-wrapper | `src/api/av.ts:212` | 有效内核路由 |
| `/api/av/getMirrorDatabaseBlocks` | api-wrapper+core | `src/api/av.ts:200`<br>`src/core/write-safety-coordinator.ts:1609` | 有效内核路由 |
| `/api/av/removeAttributeViewBlocks` | api-wrapper | `src/api/av.ts:132` | 有效内核路由 |
| `/api/av/removeAttributeViewKey` | api-wrapper | `src/api/av.ts:159` | 有效内核路由 |
| `/api/av/renderAttributeView` | api-wrapper | `src/api/av.ts:48` | 有效内核路由 |
| `/api/av/searchAttributeView` | api-wrapper | `src/api/av.ts:94` | 有效内核路由 |
| `/api/av/setAttributeViewBlockAttr` | api-wrapper | `src/api/av.ts:171` | 有效内核路由 |
| `/api/av/setAttrViewFilters` | api-wrapper | `src/api/av.ts:70` | 有效内核路由 |
| `/api/av/setAttrViewGroup` | api-wrapper | `src/api/av.ts:86` | 有效内核路由 |
| `/api/av/setAttrViewSorts` | api-wrapper | `src/api/av.ts:78` | 有效内核路由 |
| `/api/block/appendBlock` | api-wrapper | `src/api/block.ts:76` | 有效内核路由 |
| `/api/block/appendDailyNoteBlock` | api-wrapper | `src/api/block.ts:247` | 有效内核路由 |
| `/api/block/batchInsertBlock` | api-wrapper | `src/api/block.ts:227` | 有效内核路由 |
| `/api/block/batchUpdateBlock` | api-wrapper | `src/api/block.ts:238` | 有效内核路由 |
| `/api/block/checkBlockExist` | api-wrapper+core | `src/api/block.ts:190`<br>`src/core/write-safety-coordinator.ts:926` | 有效内核路由 |
| `/api/block/deleteBlock` | api-wrapper | `src/api/block.ts:101` | 有效内核路由 |
| `/api/block/foldBlock` | api-wrapper | `src/api/block.ts:126` | 有效内核路由 |
| `/api/block/getBlockBreadcrumb` | api-wrapper | `src/api/block.ts:202` | 有效内核路由 |
| `/api/block/getBlockDOM` | api-wrapper+core | `src/api/block.ts:206`<br>`src/core/write-safety-coordinator.ts:593`<br>`src/core/write-safety-coordinator.ts:1599` | 有效内核路由 |
| `/api/block/getBlockInfo` | api-wrapper+core+tool-direct | `src/api/block.ts:194`<br>`src/core/write-safety-coordinator.ts:594`<br>`src/core/write-safety-coordinator.ts:937`<br>`src/tools/search/handlers.ts:230` | 有效内核路由 |
| `/api/block/getBlockKramdown` | api-wrapper+core | `src/api/block.ts:142`<br>`src/core/write-safety-coordinator.ts:939`<br>`src/core/write-safety-coordinator.ts:1054` | 有效内核路由 |
| `/api/block/getBlockKramdowns` | api-wrapper | `src/api/block.ts:153` | 有效内核路由 |
| `/api/block/getBlocksWordCount` | api-wrapper | `src/api/block.ts:214` | 有效内核路由 |
| `/api/block/getChildBlocks` | api-wrapper+core | `src/api/block.ts:161`<br>`src/core/write-safety-coordinator.ts:940` | 有效内核路由 |
| `/api/block/getDocInfo` | api-wrapper | `src/api/block.ts:169` | 有效内核路由 |
| `/api/block/getDocsInfo` | api-wrapper | `src/api/block.ts:265` | 有效内核路由 |
| `/api/block/getRecentUpdatedBlocks` | api-wrapper | `src/api/block.ts:210` | 有效内核路由 |
| `/api/block/insertBlock` | api-wrapper | `src/api/block.ts:42` | 有效内核路由 |
| `/api/block/moveBlock` | api-wrapper | `src/api/block.ts:118` | 有效内核路由 |
| `/api/block/prependBlock` | api-wrapper | `src/api/block.ts:59` | 有效内核路由 |
| `/api/block/prependDailyNoteBlock` | api-wrapper | `src/api/block.ts:256` | 有效内核路由 |
| `/api/block/transferBlockRef` | api-wrapper | `src/api/block.ts:186` | 有效内核路由 |
| `/api/block/unfoldBlock` | api-wrapper | `src/api/block.ts:134` | 有效内核路由 |
| `/api/block/updateBlock` | api-wrapper | `src/api/block.ts:93` | 有效内核路由 |
| `/api/export/exportMdContent` | api-wrapper+core | `src/api/file.ts:35`<br>`src/core/help.ts:24` | 有效内核路由 |
| `/api/export/exportResources` | api-wrapper | `src/api/file.ts:50` | 有效内核路由 |
| `/api/file/getFile` | api-wrapper | `src/api/client.ts:112` | 有效内核路由 |
| `/api/file/putFile` | api-wrapper+core | `src/api/client.ts:160`<br>`src/core/help.ts:101` | 有效内核路由 |
| `/api/filetree/changeSort` | api-wrapper | `src/api/document.ts:197` | 有效内核路由 |
| `/api/filetree/createDailyNote` | api-wrapper | `src/api/document.ts:252` | 有效内核路由 |
| `/api/filetree/createDoc` | api-wrapper | `src/api/document.ts:280` | 有效内核路由 |
| `/api/filetree/createDocWithMd` | api-wrapper | `src/api/document.ts:30` | 有效内核路由 |
| `/api/filetree/doc2Heading` | api-wrapper | `src/api/document.ts:304` | 有效内核路由 |
| `/api/filetree/duplicateDoc` | api-wrapper | `src/api/document.ts:262` | 有效内核路由 |
| `/api/filetree/getDoc` | api-wrapper | `src/api/document.ts:227` | 有效内核路由 |
| `/api/filetree/getHPathByID` | api-wrapper | `src/api/document.ts:144` | 有效内核路由 |
| `/api/filetree/getHPathByPath` | api-wrapper | `src/api/document.ts:131` | 有效内核路由 |
| `/api/filetree/getIDsByHPath` | api-wrapper+core | `src/api/document.ts:169`<br>`src/core/write-safety-coordinator.ts:868` | 有效内核路由 |
| `/api/filetree/getPathByID` | api-wrapper+core | `src/api/document.ts:156`<br>`src/core/write-safety-coordinator.ts:772` | 有效内核路由 |
| `/api/filetree/heading2Doc` | api-wrapper | `src/api/document.ts:290` | 有效内核路由 |
| `/api/filetree/listDocsByPath` | api-wrapper | `src/api/document.ts:184` | 有效内核路由 |
| `/api/filetree/listDocTree` | api-wrapper | `src/api/document.ts:205` | 有效内核路由 |
| `/api/filetree/moveDocs` | api-wrapper | `src/api/document.ts:102` | 有效内核路由 |
| `/api/filetree/moveDocsByID` | api-wrapper | `src/api/document.ts:117` | 有效内核路由 |
| `/api/filetree/removeDoc` | api-wrapper | `src/api/document.ts:75` | 有效内核路由 |
| `/api/filetree/removeDocByID` | api-wrapper | `src/api/document.ts:88` | 有效内核路由 |
| `/api/filetree/removeDocs` | api-wrapper | `src/api/document.ts:269` | 有效内核路由 |
| `/api/filetree/renameDoc` | api-wrapper | `src/api/document.ts:46` | 有效内核路由 |
| `/api/filetree/renameDocByID` | api-wrapper | `src/api/document.ts:61` | 有效内核路由 |
| `/api/filetree/searchDocs` | api-wrapper | `src/api/document.ts:214` | 有效内核路由 |
| `/api/history/getDocHistoryContent` | api-wrapper | `src/api/history.ts:52` | 有效内核路由 |
| `/api/history/getHistoryItems` | api-wrapper | `src/api/history.ts:43` | 有效内核路由 |
| `/api/history/rollbackDocHistory` | api-wrapper | `src/api/history.ts:64` | 有效内核路由 |
| `/api/history/searchHistory` | api-wrapper | `src/api/history.ts:31` | 有效内核路由 |
| `/api/lute/spinBlockDOM` | api-wrapper | `src/api/av.ts:193` | 有效内核路由 |
| `/api/notebook/closeNotebook` | api-wrapper | `src/api/notebook.ts:23` | 有效内核路由 |
| `/api/notebook/createNotebook` | api-wrapper | `src/api/notebook.ts:30` | 有效内核路由 |
| `/api/notebook/getNotebookConf` | api-wrapper+core | `src/api/notebook.ts:51`<br>`src/core/write-safety-coordinator.ts:461`<br>`src/core/write-safety-coordinator.ts:566` | 有效内核路由 |
| `/api/notebook/lsNotebooks` | api-wrapper+core | `src/api/notebook.ts:9`<br>`src/core/write-safety-coordinator.ts:453`<br>`src/core/write-safety-coordinator.ts:558`<br>`src/core/write-safety-coordinator.ts:764`<br>`src/core/write-safety-coordinator.ts:854` | 有效内核路由 |
| `/api/notebook/openNotebook` | api-wrapper | `src/api/notebook.ts:16` | 有效内核路由 |
| `/api/notebook/removeNotebook` | api-wrapper | `src/api/notebook.ts:37` | 有效内核路由 |
| `/api/notebook/renameNotebook` | api-wrapper | `src/api/notebook.ts:44` | 有效内核路由 |
| `/api/notebook/setNotebookConf` | api-wrapper | `src/api/notebook.ts:58` | 有效内核路由 |
| `/api/notebook/setNotebookIcon` | api-wrapper | `src/api/notebook.ts:65` | 有效内核路由 |
| `/api/notification/pushErrMsg` | api-wrapper | `src/api/notification.ts:35` | 有效内核路由 |
| `/api/notification/pushMsg` | api-wrapper | `src/api/notification.ts:20` | 有效内核路由 |
| `/api/outline/getDocOutline` | api-wrapper | `src/api/document.ts:240` | 有效内核路由 |
| `/api/query/sql` | api-wrapper+core+tool-direct | `src/api/search.ts:31`<br>`src/core/write-safety-coordinator.ts:879`<br>`src/core/write-safety-coordinator.ts:959`<br>`src/tools/block/handlers.ts:64` | 有效内核路由 |
| `/api/ref/getBacklinkDoc` | api-wrapper | `src/api/search.ts:47` | 有效内核路由 |
| `/api/ref/getBackmentionDoc` | api-wrapper | `src/api/search.ts:57` | 有效内核路由 |
| `/api/repo/createSnapshot` | api-wrapper | `src/api/repo.ts:52` | 有效内核路由 |
| `/api/repo/diffRepoSnapshots` | api-wrapper | `src/api/repo.ts:76` | 有效内核路由 |
| `/api/repo/getRepoSnapshots` | api-wrapper | `src/api/repo.ts:60` | 有效内核路由 |
| `/api/repo/getRepoTagSnapshots` | api-wrapper+core | `src/api/repo.ts:64`<br>`src/core/write-safety-coordinator.ts:667` | 有效内核路由 |
| `/api/repo/openRepoSnapshotFile` | api-wrapper | `src/api/repo.ts:80` | 有效内核路由 |
| `/api/repo/removeRepoTagSnapshot` | api-wrapper | `src/api/repo.ts:68` | 有效内核路由 |
| `/api/repo/rollbackRepoSnapshotFile` | api-wrapper | `src/api/repo.ts:84` | 有效内核路由 |
| `/api/repo/tagSnapshot` | api-wrapper | `src/api/repo.ts:56` | 有效内核路由 |
| `/api/riff/addRiffCards` | api-wrapper | `src/api/flashcard.ts:111` | 有效内核路由 |
| `/api/riff/getNotebookRiffDueCards` | api-wrapper | `src/api/flashcard.ts:66` | 有效内核路由 |
| `/api/riff/getRiffCards` | api-wrapper+core | `src/api/flashcard.ts:128`<br>`src/core/write-safety-coordinator.ts:631` | 有效内核路由 |
| `/api/riff/getRiffCardsByBlockIDs` | api-wrapper+core | `src/api/flashcard.ts:139`<br>`src/core/write-safety-coordinator.ts:661` | 有效内核路由 |
| `/api/riff/getRiffDecks` | api-wrapper | `src/api/flashcard.ts:47` | 有效内核路由 |
| `/api/riff/getRiffDueCards` | api-wrapper | `src/api/flashcard.ts:55` | 有效内核路由 |
| `/api/riff/getTreeRiffDueCards` | api-wrapper | `src/api/flashcard.ts:77` | 有效内核路由 |
| `/api/riff/removeRiffCards` | api-wrapper | `src/api/flashcard.ts:119` | 有效内核路由 |
| `/api/riff/reviewRiffCard` | api-wrapper | `src/api/flashcard.ts:90` | 有效内核路由 |
| `/api/riff/skipReviewRiffCard` | api-wrapper | `src/api/flashcard.ts:103` | 有效内核路由 |
| `/api/search/findReplace` | api-wrapper | `src/api/search.ts:97` | 有效内核路由 |
| `/api/search/fullTextSearchAssetContent` | api-wrapper | `src/api/search.ts:128` | 有效内核路由 |
| `/api/search/fullTextSearchBlock` | api-wrapper | `src/api/search.ts:19` | 有效内核路由 |
| `/api/search/getAssetContent` | api-wrapper | `src/api/search.ts:114` | 有效内核路由 |
| `/api/search/listInvalidBlockRefs` | api-wrapper | `src/api/search.ts:136` | 有效内核路由 |
| `/api/search/removeTemplate` | api-wrapper | `src/api/template.ts:245` | 有效内核路由 |
| `/api/search/searchAsset` | api-wrapper | `src/api/search.ts:105` | 有效内核路由 |
| `/api/search/searchRefBlock` | api-wrapper | `src/api/search.ts:72` | 有效内核路由 |
| `/api/search/searchTag` | api-wrapper | `src/api/search.ts:37` | 有效内核路由 |
| `/api/search/searchTemplate` | api-wrapper | `src/api/template.ts:154` | 有效内核路由 |
| `/api/search/semanticSearchBlock` | api-wrapper | `src/api/search.ts:26` | 有效内核路由 |
| `/api/sync/performSync` | api-wrapper+core | `src/api/system.ts:28`<br>`src/core/help.ts:321` | 有效内核路由 |
| `/api/system/bootProgress` | api-wrapper | `src/api/system.ts:24` | 有效内核路由 |
| `/api/system/currentTime` | api-wrapper | `src/api/system.ts:36` | 有效内核路由 |
| `/api/system/getChangelog` | api-wrapper | `src/api/system.ts:12` | 有效内核路由 |
| `/api/system/getConf` | api-wrapper+core | `src/api/system.ts:16`<br>`src/core/write-safety-coordinator.ts:678` | 有效内核路由 |
| `/api/system/getNetwork` | api-wrapper | `src/api/system.ts:8` | 有效内核路由 |
| `/api/system/getSysFonts` | api-wrapper | `src/api/system.ts:20` | 有效内核路由 |
| `/api/system/getWorkspaceInfo` | api-wrapper | `src/api/system.ts:4` | 有效内核路由 |
| `/api/system/version` | api-wrapper | `src/api/system.ts:32` | 有效内核路由 |
| `/api/tag/getTag` | api-wrapper | `src/api/tag.ts:8` | 有效内核路由 |
| `/api/tag/removeTag` | api-wrapper | `src/api/tag.ts:16` | 有效内核路由 |
| `/api/tag/renameTag` | api-wrapper | `src/api/tag.ts:12` | 有效内核路由 |
| `/api/template/docSaveAsTemplate` | api-wrapper | `src/api/template.ts:272` | 有效内核路由 |
| `/api/template/render` | api-wrapper | `src/api/template.ts:198` | 有效内核路由 |
| `/api/template/renderSprig` | api-wrapper | `src/api/template.ts:211` | 有效内核路由 |
| `/api/transactions` | api-wrapper | `src/api/transaction.ts:27` | 有效内核路由 |
| `/api/ui/reloadAttributeView` | api-wrapper | `src/api/system.ts:56` | 有效内核路由 |
| `/api/ui/reloadFiletree` | api-wrapper | `src/api/system.ts:48` | 有效内核路由 |
| `/api/ui/reloadIcon` | api-wrapper | `src/api/system.ts:44` | 有效内核路由 |
| `/api/ui/reloadProtyle` | api-wrapper | `src/api/system.ts:52` | 有效内核路由 |
| `/api/ui/reloadTag` | api-wrapper | `src/api/system.ts:60` | 有效内核路由 |
| `/api/ui/reloadUI` | api-wrapper | `src/api/system.ts:40` | 有效内核路由 |

### API wrapper 层外的工具直调（不计 150 wrapper 覆盖口径）

| API 路径 | 位置 | 状态 |
|---|---|---|
| `/api/file/readDir` | `src/tools/av/handlers.ts:1388` | 有效 |

### UI-only（不计覆盖率）

| API 路径 | 位置 | 状态 |
|---|---|---|
| `/api/ai/embeddingStat` | `src/ui/setting/mcp-config/EmbeddingPanel.svelte:169` | 有效 |
| `/api/ai/reindexEmbedding` | `src/ui/setting/mcp-config/EmbeddingPanel.svelte:184` | 有效 |
| `/api/ai/retryFailedEmbedding` | `src/ui/setting/mcp-config/EmbeddingPanel.svelte:199` | 有效 |
| `/api/ai/testEmbeddingModel` | `src/ui/setting/mcp-config/EmbeddingPanel.svelte:146` | 有效 |
| `/api/setting/setAI` | `src/ui/setting/mcp-config/EmbeddingPanel.svelte:114` | 有效 |

## 覆盖层级解释

- **插件直接覆盖**：后端 API wrapper 或工具层直调，列于上表 150 项。
- **由 extension 暴露原生工具**：运行时通过思源 `/mcp` 发现；动态 action 不纳入静态 142。
- **仅内核内部使用**：当前内核路由存在，但没有插件后端字面量；不等同于适合暴露给 AI。
- **不建议引入**：宿主管理、认证回调、任意文件/网络代理等能力，见人工候选区。

## 风险模型说明

- `DANGEROUS_ACTIONS` 表示 MCP 协议级确认，不等价于“是否写入”。
- `ACTION_SAFETY_POLICIES` 区分 read/mutation/external 与 precondition；`ACTION_TIERS` 只表示披露层级。三者不得合并成一个布尔值。
- 原生 MCP 的 action effect 需从 Go 源读取，因为 `ActionEffects` 不通过 `/mcp tools/list` 返回。例如 `semantic` 在上游标注 DataEgress 与 ExternalCost。

<!-- API_AUDIT_MANUAL_START -->
## 功能候选与人工决策

### 高优先级

| 能力 | 内核接口 | 请求/响应可靠度 | 风险与最低版本 | 建议 |
|---|---|---|---|---|
| 语义搜索与嵌入模型管理 | `semanticSearchBlock`、`testEmbeddingModel`、`embeddingStat`、`reindexEmbedding`、`retryFailedEmbedding` 及 AI 设置 | 搜索 wrapper 已有类型；模型管理 schema 未公开，标记未知 | 数据可能传给外部模型、可能产生费用；最低 v3.8.0 | semantic 已映射；其余先做版本/费用/外传确认设计 |
| 文档排序 | `/api/filetree/setSort` | 官方文档已公开 | 写操作；最低 v3.8.0 | 优先替换/补强现有 changeSort 语义 |
| 结构导航 | `getBlockBreadcrumbChildren`、`getDocBlocksOrders`、`getDocHeadingNumbers` | 内部 schema，未知 | 只读；最低 v3.8.0 | 适合作为 block/document 高优先候选 |
| 历史差异 | `diffDocVersions`、`getRepoDocHistory` | 内部 schema，未知 | 读取历史内容；最低 v3.8.0 | 优先判断 timeline 与原生 history/repo MCP 重叠 |
| 数据库增强 | `createAttributeViewItemDocs`、关系候选、字段视图、搜索目标、条目状态 | 内部 schema，未知 | 部分写操作；最低 v3.8.0 | 在 av 工具内聚合，补充行/列权限校验 |

### 中优先级

- 资源历史、Pandoc 环境诊断、集市包检查与更新。先检查思源原生 MCP 是否已通过 `extension` 提供，避免复制同一能力。

### 默认不引入

- OIDC 流程、Agent 会话回调、浏览器 capability 回传、原生 MCP 环境变量。
- 字体、更新通道、UI 可见性、图谱配置、LAN 同步等宿主管理接口。
- 网络代理、归档、任意文件及其他高权限内部接口；除非出现明确场景并另做安全设计。
<!-- API_AUDIT_MANUAL_END -->
