# SiYuan API 完整映射表

## 统计信息
- **SiYuan API 总数**: 459 个端点
- **MCP Tools**: 10 个
- **已覆盖 API**: 117 个端点
- **已覆盖 MCP Actions**: 115 个
- **未覆盖 API**: 342 个端点
- **整体覆盖率**: 25.5%

---

## block 模块

**统计**: 共 54 个 API，已覆盖 23 个，覆盖率 42.6%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/block/getBlockInfo` | getBlockInfo | 块获取信息 | block.info | ✅ 已覆盖 |
| 2 | POST | `/api/block/getBlockDOM` | getBlockDOM | 块获取DOM | block.dom | ✅ 已覆盖 |
| 3 | POST | `/api/block/getBlockDOMs` | getBlockDOMs | 块获取DOMs | - | ❌ 未覆盖 |
| 4 | POST | `/api/block/getBlockDOMWithEmbed` | getBlockDOMWithEmbed | 块获取DOMWithEmbed | - | ❌ 未覆盖 |
| 5 | POST | `/api/block/getBlockDOMsWithEmbed` | getBlockDOMsWithEmbed | 块获取DOMsWithEmbed | - | ❌ 未覆盖 |
| 6 | POST | `/api/block/getBlockKramdown` | getBlockKramdown | 块获取Kramdown | block.get_kramdown | ✅ 已覆盖 |
| 7 | POST | `/api/block/getBlockKramdowns` | getBlockKramdowns | 块获取Kramdowns | - | ❌ 未覆盖 |
| 8 | POST | `/api/block/getChildBlocks` | getChildBlocks | 块获取子块Blocks | document.get_child_blocks<br>block.get_children | ✅ 已覆盖 |
| 9 | POST | `/api/block/getTailChildBlocks` | getTailChildBlocks | 块获取Tail子块Blocks | - | ❌ 未覆盖 |
| 10 | POST | `/api/block/getBlockBreadcrumb` | getBlockBreadcrumb | 块获取面包屑 | block.breadcrumb | ✅ 已覆盖 |
| 11 | POST | `/api/block/getBlockIndex` | getBlockIndex | 块获取索引 | - | ❌ 未覆盖 |
| 12 | POST | `/api/block/getBlocksIndexes` | getBlocksIndexes | 块获取s索引es | - | ❌ 未覆盖 |
| 13 | POST | `/api/block/getRefIDs` | getRefIDs | 块获取引用ID列表 | - | ❌ 未覆盖 |
| 14 | POST | `/api/block/getRefIDsByFileAnnotationID` | getRefIDsByFileAnnotationID | 块获取引用ID列表ByFileAnnotationID | - | ❌ 未覆盖 |
| 15 | POST | `/api/block/getBlockDefIDsByRefText` | getBlockDefIDsByRefText | 块获取DefID列表By引用Text | - | ❌ 未覆盖 |
| 16 | POST | `/api/block/getRefText` | getRefText | 块获取引用Text | - | ❌ 未覆盖 |
| 17 | POST | `/api/block/getDOMText` | getDOMText | 块获取DOMText | - | ❌ 未覆盖 |
| 18 | POST | `/api/block/getTreeStat` | getTreeStat | 块获取树Stat | - | ❌ 未覆盖 |
| 19 | POST | `/api/block/getBlocksWordCount` | getBlocksWordCount | 块获取s字数统计 | block.word_count | ✅ 已覆盖 |
| 20 | POST | `/api/block/getContentWordCount` | getContentWordCount | 块获取Content字数统计 | - | ❌ 未覆盖 |
| 21 | POST | `/api/block/getRecentUpdatedBlocks` | getRecentUpdatedBlocks | 块获取RecentUpdatedBlocks | block.recent_updated | ✅ 已覆盖 |
| 22 | POST | `/api/block/getDocInfo` | getDocInfo | 块获取Doc信息 | block.doc_info | ✅ 已覆盖 |
| 23 | POST | `/api/block/getDocsInfo` | getDocsInfo | 块获取Docs信息 | block.docs_info | ✅ 已覆盖 |
| 24 | POST | `/api/block/checkBlockExist` | checkBlockExist | 块检查Exist | block.exists | ✅ 已覆盖 |
| 25 | POST | `/api/block/getUnfoldedParentID` | getUnfoldedParentID | 块获取UnfoldedParentID | - | ❌ 未覆盖 |
| 26 | POST | `/api/block/checkBlockFold` | checkBlockFold | 块检查Fold | - | ❌ 未覆盖 |
| 27 | POST | `/api/block/insertBlock` | insertBlock | 块插入 | block.insert | ✅ 已覆盖 |
| 28 | POST | `/api/block/batchInsertBlock` | batchInsertBlock | 块批量InsertBlock | block.batch_insert | ✅ 已覆盖 |
| 29 | POST | `/api/block/prependBlock` | prependBlock | 块前置插入 | block.prepend | ✅ 已覆盖 |
| 30 | POST | `/api/block/batchPrependBlock` | batchPrependBlock | 块批量PrependBlock | - | ❌ 未覆盖 |
| 31 | POST | `/api/block/appendBlock` | appendBlock | 块追加 | block.append | ✅ 已覆盖 |
| 32 | POST | `/api/block/batchAppendBlock` | batchAppendBlock | 块批量AppendBlock | - | ❌ 未覆盖 |
| 33 | POST | `/api/block/appendDailyNoteBlock` | appendDailyNoteBlock | 块追加DailyNoteBlock | block.append_daily_note | ✅ 已覆盖 |
| 34 | POST | `/api/block/prependDailyNoteBlock` | prependDailyNoteBlock | 块前置插入DailyNoteBlock | block.prepend_daily_note | ✅ 已覆盖 |
| 35 | POST | `/api/block/updateBlock` | updateBlock | 块更新 | block.update | ✅ 已覆盖 |
| 36 | POST | `/api/block/batchUpdateBlock` | batchUpdateBlock | 块批量UpdateBlock | block.batch_update | ✅ 已覆盖 |
| 37 | POST | `/api/block/deleteBlock` | deleteBlock | 块删除 | block.delete | ✅ 已覆盖 |
| 38 | POST | `/api/block/moveBlock` | moveBlock | 块移动 | block.move | ✅ 已覆盖 |
| 39 | POST | `/api/block/moveOutlineHeading` | moveOutlineHeading | 块移动OutlineHeading | - | ❌ 未覆盖 |
| 40 | POST | `/api/block/foldBlock` | foldBlock | 块折叠 | block.set_fold_state | ✅ 已覆盖 |
| 41 | POST | `/api/block/unfoldBlock` | unfoldBlock | 块展开 | block.set_fold_state | ✅ 已覆盖 |
| 42 | POST | `/api/block/setBlockReminder` | setBlockReminder | 块设置Reminder | - | ❌ 未覆盖 |
| 43 | POST | `/api/block/getHeadingLevelTransaction` | getHeadingLevelTransaction | 块获取HeadingLevelTransaction | - | ❌ 未覆盖 |
| 44 | POST | `/api/block/getHeadingDeleteTransaction` | getHeadingDeleteTransaction | 块获取HeadingDeleteTransaction | - | ❌ 未覆盖 |
| 45 | POST | `/api/block/getHeadingInsertTransaction` | getHeadingInsertTransaction | 块获取HeadingInsertTransaction | - | ❌ 未覆盖 |
| 46 | POST | `/api/block/getHeadingChildrenIDs` | getHeadingChildrenIDs | 块获取Heading子块ID列表 | - | ❌ 未覆盖 |
| 47 | POST | `/api/block/getHeadingChildrenDOM` | getHeadingChildrenDOM | 块获取Heading子块DOM | - | ❌ 未覆盖 |
| 48 | POST | `/api/block/swapBlockRef` | swapBlockRef | 块swapBlock引用 | - | ❌ 未覆盖 |
| 49 | POST | `/api/block/transferBlockRef` | transferBlockRef | 块transferBlock引用 | block.transfer_ref | ✅ 已覆盖 |
| 50 | POST | `/api/block/getBlockSiblingID` | getBlockSiblingID | 块获取SiblingID | - | ❌ 未覆盖 |
| 51 | POST | `/api/block/getBlockRelevantIDs` | getBlockRelevantIDs | 块获取RelevantID列表 | - | ❌ 未覆盖 |
| 52 | POST | `/api/block/getBlockTreeInfos` | getBlockTreeInfos | 块获取树信息s | - | ❌ 未覆盖 |
| 53 | POST | `/api/block/checkBlockRef` | checkBlockRef | 块检查引用 | - | ❌ 未覆盖 |
| 54 | POST | `/api/block/appendHeadingChildren` | appendHeadingChildren | 块追加Heading子块 | - | ❌ 未覆盖 |

---

## system 模块

**统计**: 共 46 个 API，已覆盖 10 个，覆盖率 21.7%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | GET | `/api/system/bootProgress` | bootProgress | 系统boot进度 | system.boot_progress | ✅ 已覆盖 |
| 2 | POST | `/api/system/bootProgress` | bootProgress | 系统boot进度 | system.boot_progress | ✅ 已覆盖 |
| 3 | GET | `/api/system/version` | version | 系统version | system.get_version | ✅ 已覆盖 |
| 4 | POST | `/api/system/version` | version | 系统version | system.get_version | ✅ 已覆盖 |
| 5 | POST | `/api/system/currentTime` | currentTime | 系统current时间 | system.get_current_time | ✅ 已覆盖 |
| 6 | POST | `/api/system/uiproc` | addUIProcess | 系统添加UIProcess | - | ❌ 未覆盖 |
| 7 | POST | `/api/system/loginAuth` | LoginAuth | 系统登录Auth | - | ❌ 未覆盖 |
| 8 | POST | `/api/system/logoutAuth` | LogoutAuth | 系统登出Auth | - | ❌ 未覆盖 |
| 9 | GET | `/api/system/getCaptcha` | GetCaptcha | 系统获取Captcha | - | ❌ 未覆盖 |
| 10 | POST | `/api/system/getEmojiConf` | getEmojiConf | 系统获取Emoji配置 | - | ❌ 未覆盖 |
| 11 | POST | `/api/system/setAPIToken` | setAPIToken | 系统设置APIToken | - | ❌ 未覆盖 |
| 12 | POST | `/api/system/setAccessAuthCode` | setAccessAuthCode | 系统设置AccessAuthCode | - | ❌ 未覆盖 |
| 13 | POST | `/api/system/setFollowSystemLockScreen` | setFollowSystemLockScreen | 系统设置FollowSystemLockScreen | - | ❌ 未覆盖 |
| 14 | POST | `/api/system/setNetworkServe` | setNetworkServe | 系统设置网络Serve | - | ❌ 未覆盖 |
| 15 | POST | `/api/system/setNetworkServeTLS` | setNetworkServeTLS | 系统设置网络ServeTLS | - | ❌ 未覆盖 |
| 16 | POST | `/api/system/exportTLSCACert` | exportTLSCACert | 系统导出TLSCACert | - | ❌ 未覆盖 |
| 17 | POST | `/api/system/exportTLSCABundle` | exportTLSCABundle | 系统导出TLSCABundle | - | ❌ 未覆盖 |
| 18 | POST | `/api/system/importTLSCABundle` | importTLSCABundle | 系统导入TLSCABundle | - | ❌ 未覆盖 |
| 19 | POST | `/api/system/setAutoLaunch` | setAutoLaunch | 系统设置AutoLaunch | - | ❌ 未覆盖 |
| 20 | POST | `/api/system/setDownloadInstallPkg` | setDownloadInstallPkg | 系统设置DownloadInstallPkg | - | ❌ 未覆盖 |
| 21 | POST | `/api/system/setNetworkProxy` | setNetworkProxy | 系统设置网络Proxy | - | ❌ 未覆盖 |
| 22 | POST | `/api/system/setWorkspaceDir` | setWorkspaceDir | 系统设置工作区Dir | - | ❌ 未覆盖 |
| 23 | POST | `/api/system/getWorkspaces` | getWorkspaces | 系统获取工作区s | - | ❌ 未覆盖 |
| 24 | POST | `/api/system/getMobileWorkspaces` | getMobileWorkspaces | 系统获取Mobile工作区s | - | ❌ 未覆盖 |
| 25 | POST | `/api/system/checkWorkspaceDir` | checkWorkspaceDir | 系统检查工作区Dir | - | ❌ 未覆盖 |
| 26 | POST | `/api/system/createWorkspaceDir` | createWorkspaceDir | 系统创建工作区Dir | - | ❌ 未覆盖 |
| 27 | POST | `/api/system/removeWorkspaceDir` | removeWorkspaceDir | 系统删除工作区Dir | - | ❌ 未覆盖 |
| 28 | POST | `/api/system/removeWorkspaceDirPhysically` | removeWorkspaceDirPhysically | 系统删除工作区DirPhysically | - | ❌ 未覆盖 |
| 29 | POST | `/api/system/setAppearanceMode` | setAppearanceMode | 系统设置AppearanceMode | - | ❌ 未覆盖 |
| 30 | POST | `/api/system/setUILayout` | setUILayout | 系统设置UILayout | - | ❌ 未覆盖 |
| 31 | POST | `/api/system/getSysFonts` | getSysFonts | 系统获取Sys字体 | system.sys_fonts | ✅ 已覆盖 |
| 32 | POST | `/api/system/exit` | exit | 系统exit | - | ❌ 未覆盖 |
| 33 | POST | `/api/system/getConf` | getConf | 系统获取配置 | system.conf | ✅ 已覆盖 |
| 34 | POST | `/api/system/checkUpdate` | checkUpdate | 系统检查Update | - | ❌ 未覆盖 |
| 35 | POST | `/api/system/exportLog` | exportLog | 系统导出Log | - | ❌ 未覆盖 |
| 36 | POST | `/api/system/getChangelog` | getChangelog | 系统获取更新日志 | system.changelog | ✅ 已覆盖 |
| 37 | POST | `/api/system/getNetwork` | getNetwork | 系统获取网络 | system.network | ✅ 已覆盖 |
| 38 | POST | `/api/system/exportConf` | exportConf | 系统导出配置 | - | ❌ 未覆盖 |
| 39 | POST | `/api/system/importConf` | importConf | 系统导入配置 | - | ❌ 未覆盖 |
| 40 | POST | `/api/system/getWorkspaceInfo` | getWorkspaceInfo | 系统获取工作区信息 | system.workspace_info | ✅ 已覆盖 |
| 41 | POST | `/api/system/reloadUI` | reloadUI | 系统reloadUI | - | ❌ 未覆盖 |
| 42 | POST | `/api/system/addMicrosoftDefenderExclusion` | addMicrosoftDefenderExclusion | 系统添加MicrosoftDefenderExclusion | - | ❌ 未覆盖 |
| 43 | POST | `/api/system/ignoreAddMicrosoftDefenderExclusion` | ignoreAddMicrosoftDefenderExclusion | 系统ignoreAddMicrosoftDefenderExclusion | - | ❌ 未覆盖 |
| 44 | POST | `/api/system/vacuumDataIndex` | vacuumDataIndex | 系统清理Data索引 | - | ❌ 未覆盖 |
| 45 | POST | `/api/system/clearTempFiles` | clearTempFiles | 系统清空TempFiles | - | ❌ 未覆盖 |
| 46 | POST | `/api/system/rebuildDataIndex` | rebuildDataIndex | 系统重建Data索引 | - | ❌ 未覆盖 |

---

## av 模块

**统计**: 共 35 个 API，已覆盖 13 个，覆盖率 37.1%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/av/renderAttributeView` | renderAttributeView | 属性视图/数据库渲染 | av.render_attribute_view | ✅ 已覆盖 |
| 2 | POST | `/api/av/renderHistoryAttributeView` | renderHistoryAttributeView | 属性视图/数据库渲染历史属性ibuteView | - | ❌ 未覆盖 |
| 3 | POST | `/api/av/renderSnapshotAttributeView` | renderSnapshotAttributeView | 在数据快照中渲染属性视图/数据库 | - | ❌ 未覆盖 |
| 4 | POST | `/api/av/getAttributeViewKeys` | getAttributeViewKeys | 属性视图/数据库获取Keys | av.get_attribute_view_keys | ✅ 已覆盖 |
| 5 | POST | `/api/av/setAttributeViewBlockAttr` | setAttributeViewBlockAttr | 属性视图/数据库设置Block属性 | av.set_cells | ✅ 已覆盖 |
| 6 | POST | `/api/av/batchSetAttributeViewBlockAttrs` | batchSetAttributeViewBlockAttrs | 属性视图/数据库批量Set属性ibuteViewBlock属性 | av.set_cells | ✅ 已覆盖 |
| 7 | POST | `/api/av/searchAttributeView` | searchAttributeView | 属性视图/数据库搜索 | av.search | ✅ 已覆盖 |
| 8 | POST | `/api/av/getAttributeView` | getAttributeView | 属性视图/数据库获取 | av.get | ✅ 已覆盖 |
| 9 | POST | `/api/av/searchAttributeViewRelationKey` | searchAttributeViewRelationKey | 属性视图/数据库搜索RelationKey | - | ❌ 未覆盖 |
| 10 | POST | `/api/av/searchAttributeViewNonRelationKey` | searchAttributeViewNonRelationKey | 属性视图/数据库搜索NonRelationKey | - | ❌ 未覆盖 |
| 11 | POST | `/api/av/searchAttributeViewRollupDestKeys` | searchAttributeViewRollupDestKeys | 属性视图/数据库搜索RollupDestKeys | - | ❌ 未覆盖 |
| 12 | POST | `/api/av/getAttributeViewFilterSort` | getAttributeViewFilterSort | 属性视图/数据库获取FilterSort | av.get_attribute_view_filter_sort | ✅ 已覆盖 |
| 13 | POST | `/api/av/addAttributeViewKey` | addAttributeViewKey | 属性视图/数据库添加Key | av.add_column | ✅ 已覆盖 |
| 14 | POST | `/api/av/removeAttributeViewKey` | removeAttributeViewKey | 属性视图/数据库删除Key | av.remove_column | ✅ 已覆盖 |
| 15 | POST | `/api/av/sortAttributeViewViewKey` | sortAttributeViewViewKey | 属性视图/数据库排序ViewKey | - | ❌ 未覆盖 |
| 16 | POST | `/api/av/sortAttributeViewKey` | sortAttributeViewKey | 属性视图/数据库排序Key | - | ❌ 未覆盖 |
| 17 | POST | `/api/av/addAttributeViewBlocks` | addAttributeViewBlocks | 属性视图/数据库添加Blocks | av.add_rows | ✅ 已覆盖 |
| 18 | POST | `/api/av/removeAttributeViewBlocks` | removeAttributeViewBlocks | 属性视图/数据库删除Blocks | av.remove_rows | ✅ 已覆盖 |
| 19 | POST | `/api/av/getAttributeViewPrimaryKeyValues` | getAttributeViewPrimaryKeyValues | 属性视图/数据库获取PrimaryKeyValues | av.get_primary_key_values | ✅ 已覆盖 |
| 20 | POST | `/api/av/setDatabaseBlockView` | setDatabaseBlockView | 属性视图/数据库设置DatabaseBlockView | - | ❌ 未覆盖 |
| 21 | POST | `/api/av/getMirrorDatabaseBlocks` | getMirrorDatabaseBlocks | 属性视图/数据库获取MirrorDatabaseBlocks | - | ❌ 未覆盖 |
| 22 | POST | `/api/av/getAttributeViewKeysByAvID` | getAttributeViewKeysByAvID | 属性视图/数据库获取KeysByAvID | - | ❌ 未覆盖 |
| 23 | POST | `/api/av/getAttributeViewKeysByID` | getAttributeViewKeysByID | 属性视图/数据库获取KeysByID | - | ❌ 未覆盖 |
| 24 | POST | `/api/av/duplicateAttributeViewBlock` | duplicateAttributeViewBlock | 属性视图/数据库复制Block | av.duplicate_block | ✅ 已覆盖 |
| 25 | POST | `/api/av/appendAttributeViewDetachedBlocksWithValues` | appendAttributeViewDetachedBlocksWithValues | 属性视图/数据库追加DetachedBlocksWithValues | - | ❌ 未覆盖 |
| 26 | POST | `/api/av/getCurrentAttrViewImages` | getCurrentAttrViewImages | 属性视图/数据库获取Current属性ViewImages | - | ❌ 未覆盖 |
| 27 | POST | `/api/av/changeAttrViewLayout` | changeAttrViewLayout | 属性视图/数据库change属性ViewLayout | - | ❌ 未覆盖 |
| 28 | POST | `/api/av/setAttrViewGroup` | setAttrViewGroup | 属性视图/数据库设置属性ViewGroup | - | ❌ 未覆盖 |
| 29 | POST | `/api/av/batchReplaceAttributeViewBlocks` | batchReplaceAttributeViewBlocks | 属性视图/数据库批量Replace属性ibuteViewBlocks | - | ❌ 未覆盖 |
| 30 | POST | `/api/av/getAttributeViewAddingBlockDefaultValues` | getAttributeViewAddingBlockDefaultValues | 属性视图/数据库获取AddingBlockDefaultValues | - | ❌ 未覆盖 |
| 31 | POST | `/api/av/getAttributeViewBoundBlockIDsByItemIDs` | getAttributeViewBoundBlockIDsByItemIDs | 属性视图/数据库获取BoundBlockID列表ByItemID列表 | - | ❌ 未覆盖 |
| 32 | POST | `/api/av/getAttributeViewItemIDsByBoundIDs` | getAttributeViewItemIDsByBoundIDs | 属性视图/数据库获取ItemID列表ByBoundID列表 | - | ❌ 未覆盖 |
| 33 | POST | `/api/av/getUnusedAttributeViews` | getUnusedAttributeViews | 属性视图/数据库获取Unused属性ibuteViews | - | ❌ 未覆盖 |
| 34 | POST | `/api/av/removeUnusedAttributeViews` | removeUnusedAttributeViews | 属性视图/数据库删除Unused属性ibuteViews | - | ❌ 未覆盖 |
| 35 | POST | `/api/av/removeUnusedAttributeView` | removeUnusedAttributeView | 属性视图/数据库删除Unused属性ibuteView | - | ❌ 未覆盖 |

---

## filetree 模块

**统计**: 共 34 个 API，已覆盖 21 个，覆盖率 61.8%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/filetree/searchDocs` | searchDocs | 文档树搜索s | document.search_docs | ✅ 已覆盖 |
| 2 | POST | `/api/filetree/listDocsByPath` | listDocsByPath | 文档树列出sBy路径 | notebook.get_child_docs<br>document.get_child_docs | ✅ 已覆盖 |
| 3 | POST | `/api/filetree/getDoc` | getDoc | 文档树获取 | document.get_doc | ✅ 已覆盖 |
| 4 | POST | `/api/filetree/getDocCreateSavePath` | getDocCreateSavePath | 文档树获取CreateSave路径 | - | ❌ 未覆盖 |
| 5 | POST | `/api/filetree/getRefCreateSavePath` | getRefCreateSavePath | 文档树获取引用CreateSave路径 | - | ❌ 未覆盖 |
| 6 | POST | `/api/filetree/changeSort` | changeSort | 文档树changeSort | - | ❌ 未覆盖 |
| 7 | POST | `/api/filetree/createDocWithMd` | createDocWithMd | 文档树创建WithMd | document.create | ✅ 已覆盖 |
| 8 | POST | `/api/filetree/createDailyNote` | createDailyNote | 文档树创建DailyNote | document.create_daily_note | ✅ 已覆盖 |
| 9 | POST | `/api/filetree/createDoc` | createDoc | 文档树创建 | document.create | ✅ 已覆盖 |
| 10 | POST | `/api/filetree/renameDoc` | renameDoc | 文档树重命名 | document.rename | ✅ 已覆盖 |
| 11 | POST | `/api/filetree/renameDocByID` | renameDocByID | 文档树重命名ByID | document.rename | ✅ 已覆盖 |
| 12 | POST | `/api/filetree/removeDoc` | removeDoc | 文档树删除 | document.remove | ✅ 已覆盖 |
| 13 | POST | `/api/filetree/removeDocByID` | removeDocByID | 文档树删除ByID | document.remove | ✅ 已覆盖 |
| 14 | POST | `/api/filetree/removeDocs` | removeDocs | 文档树删除s | document.remove_batch | ✅ 已覆盖 |
| 15 | POST | `/api/filetree/moveDocs` | moveDocs | 文档树移动s | document.move | ✅ 已覆盖 |
| 16 | POST | `/api/filetree/moveDocsByID` | moveDocsByID | 文档树移动sByID | document.move | ✅ 已覆盖 |
| 17 | POST | `/api/filetree/duplicateDoc` | duplicateDoc | 文档树复制 | document.duplicate | ✅ 已覆盖 |
| 18 | POST | `/api/filetree/getHPathByPath` | getHPathByPath | 文档树获取H路径By路径 | document.resolve | ✅ 已覆盖 |
| 19 | POST | `/api/filetree/getHPathsByPaths` | getHPathsByPaths | 文档树获取H路径sBy路径s | - | ❌ 未覆盖 |
| 20 | POST | `/api/filetree/getHPathByID` | getHPathByID | 文档树获取H路径ByID | document.resolve | ✅ 已覆盖 |
| 21 | POST | `/api/filetree/getPathByID` | getPathByID | 文档树获取路径ByID | document.resolve | ✅ 已覆盖 |
| 22 | POST | `/api/filetree/getFullHPathByID` | getFullHPathByID | 文档树获取FullH路径ByID | - | ❌ 未覆盖 |
| 23 | POST | `/api/filetree/getIDsByHPath` | getIDsByHPath | 文档树获取ID列表ByH路径 | document.resolve | ✅ 已覆盖 |
| 24 | POST | `/api/filetree/doc2Heading` | doc2Heading | 文档树doc2Heading | document.doc_to_heading | ✅ 已覆盖 |
| 25 | POST | `/api/filetree/heading2Doc` | heading2Doc | 文档树heading2Doc | document.heading_to_doc | ✅ 已覆盖 |
| 26 | POST | `/api/filetree/li2Doc` | li2Doc | 文档树li2Doc | - | ❌ 未覆盖 |
| 27 | POST | `/api/filetree/upsertIndexes` | upsertIndexes | 文档树upsert索引es | - | ❌ 未覆盖 |
| 28 | POST | `/api/filetree/removeIndexes` | removeIndexes | 文档树删除索引es | - | ❌ 未覆盖 |
| 29 | POST | `/api/filetree/listDocTree` | listDocTree | 文档树列出树 | document.list_tree | ✅ 已覆盖 |
| 30 | POST | `/api/filetree/moveLocalShorthands` | moveLocalShorthands | 文档树移动LocalShorthands | - | ❌ 未覆盖 |
| 31 | POST | `/api/filetree/refreshFiletree ` | rebuildDataIndex | 文档树重建Data索引 | - | ❌ 未覆盖 |
| 32 | POST | `/api/filetree/setPublishAccess` | setPublishAccess | 文档树设置PublishAccess | - | ❌ 未覆盖 |
| 33 | POST | `/api/filetree/getPublishAccess` | getPublishAccess | 文档树获取PublishAccess | - | ❌ 未覆盖 |
| 34 | POST | `/api/filetree/authFilePublishAccess` | authFilePublishAccess | 文档树authFilePublishAccess | - | ❌ 未覆盖 |

---

## export 模块

**统计**: 共 31 个 API，已覆盖 2 个，覆盖率 6.5%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/export/exportNotebookMd` | exportNotebookMd | 导出导出NotebookMd | - | ❌ 未覆盖 |
| 2 | POST | `/api/export/exportMds` | exportMds | 导出导出Mds | - | ❌ 未覆盖 |
| 3 | POST | `/api/export/exportMd` | exportMd | 导出导出Md | - | ❌ 未覆盖 |
| 4 | POST | `/api/export/exportSYs` | exportSYs | 导出导出SYs | - | ❌ 未覆盖 |
| 5 | POST | `/api/export/exportSY` | exportSY | 导出导出SY | - | ❌ 未覆盖 |
| 6 | POST | `/api/export/exportNotebookSY` | exportNotebookSY | 导出导出NotebookSY | - | ❌ 未覆盖 |
| 7 | POST | `/api/export/exportMdContent` | exportMdContent | 导出导出MdContent | file.export_md | ✅ 已覆盖 |
| 8 | POST | `/api/export/exportHTML` | exportHTML | 导出导出HTML | - | ❌ 未覆盖 |
| 9 | POST | `/api/export/exportPreviewHTML` | exportPreviewHTML | 导出导出PreviewHTML | - | ❌ 未覆盖 |
| 10 | POST | `/api/export/exportMdHTML` | exportMdHTML | 导出导出MdHTML | - | ❌ 未覆盖 |
| 11 | POST | `/api/export/exportDocx` | exportDocx | 导出导出Docx | - | ❌ 未覆盖 |
| 12 | POST | `/api/export/processPDF` | processPDF | 导出processPDF | - | ❌ 未覆盖 |
| 13 | POST | `/api/export/preview` | exportPreview | 导出导出Preview | - | ❌ 未覆盖 |
| 14 | POST | `/api/export/exportResources` | exportResources | 导出导出Resources | file.export_resources | ✅ 已覆盖 |
| 15 | POST | `/api/export/exportAsFile` | exportAsFile | 导出导出AsFile | - | ❌ 未覆盖 |
| 16 | POST | `/api/export/exportData` | exportData | 导出导出Data | - | ❌ 未覆盖 |
| 17 | POST | `/api/export/exportDataInFolder` | exportDataInFolder | 导出导出DataInFolder | - | ❌ 未覆盖 |
| 18 | POST | `/api/export/exportTempContent` | exportTempContent | 导出导出TempContent | - | ❌ 未覆盖 |
| 19 | POST | `/api/export/exportBrowserHTML` | exportBrowserHTML | 导出导出BrowserHTML | - | ❌ 未覆盖 |
| 20 | POST | `/api/export/export2Liandi` | export2Liandi | 导出导出2Liandi | - | ❌ 未覆盖 |
| 21 | POST | `/api/export/exportReStructuredText` | exportReStructuredText | 导出导出ReStructuredText | - | ❌ 未覆盖 |
| 22 | POST | `/api/export/exportAsciiDoc` | exportAsciiDoc | 导出导出AsciiDoc | - | ❌ 未覆盖 |
| 23 | POST | `/api/export/exportTextile` | exportTextile | 导出导出Textile | - | ❌ 未覆盖 |
| 24 | POST | `/api/export/exportOPML` | exportOPML | 导出导出OPML | - | ❌ 未覆盖 |
| 25 | POST | `/api/export/exportOrgMode` | exportOrgMode | 导出导出OrgMode | - | ❌ 未覆盖 |
| 26 | POST | `/api/export/exportMediaWiki` | exportMediaWiki | 导出导出MediaWiki | - | ❌ 未覆盖 |
| 27 | POST | `/api/export/exportODT` | exportODT | 导出导出ODT | - | ❌ 未覆盖 |
| 28 | POST | `/api/export/exportRTF` | exportRTF | 导出导出RTF | - | ❌ 未覆盖 |
| 29 | POST | `/api/export/exportEPUB` | exportEPUB | 导出导出EPUB | - | ❌ 未覆盖 |
| 30 | POST | `/api/export/exportAttributeView` | exportAttributeView | 导出导出 | - | ❌ 未覆盖 |
| 31 | POST | `/api/export/exportCodeBlock` | exportCodeBlock | 导出导出CodeBlock | - | ❌ 未覆盖 |

---

## setting 模块

**统计**: 共 23 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/setting/setAccount` | setAccount | 设置设置Account | - | ❌ 未覆盖 |
| 2 | POST | `/api/setting/setEditor` | setEditor | 设置设置Editor | - | ❌ 未覆盖 |
| 3 | POST | `/api/setting/setExport` | setExport | 设置设置Export | - | ❌ 未覆盖 |
| 4 | POST | `/api/setting/setFiletree` | setFiletree | 设置设置Filetree | - | ❌ 未覆盖 |
| 5 | POST | `/api/setting/setSearch` | setSearch | 设置设置Search | - | ❌ 未覆盖 |
| 6 | POST | `/api/setting/setKeymap` | setKeymap | 设置设置Keymap | - | ❌ 未覆盖 |
| 7 | POST | `/api/setting/setAppearance` | setAppearance | 设置设置Appearance | - | ❌ 未覆盖 |
| 8 | POST | `/api/setting/setIcon` | setIcon | 设置设置图标 | - | ❌ 未覆盖 |
| 9 | POST | `/api/setting/setTheme` | setTheme | 设置设置Theme | - | ❌ 未覆盖 |
| 10 | POST | `/api/setting/getCloudUser` | getCloudUser | 设置获取CloudUser | - | ❌ 未覆盖 |
| 11 | POST | `/api/setting/logoutCloudUser` | logoutCloudUser | 设置登出CloudUser | - | ❌ 未覆盖 |
| 12 | POST | `/api/setting/login2faCloudUser` | login2faCloudUser | 设置登录2faCloudUser | - | ❌ 未覆盖 |
| 13 | POST | `/api/setting/setEmoji` | setEmoji | 设置设置Emoji | - | ❌ 未覆盖 |
| 14 | POST | `/api/setting/setFlashcard` | setFlashcard | 设置设置Flashcard | - | ❌ 未覆盖 |
| 15 | POST | `/api/setting/setAI` | setAI | 设置设置AI | - | ❌ 未覆盖 |
| 16 | POST | `/api/setting/setBazaar` | setBazaar | 设置设置Bazaar | - | ❌ 未覆盖 |
| 17 | POST | `/api/setting/setPublish` | setPublish | 设置设置Publish | - | ❌ 未覆盖 |
| 18 | POST | `/api/setting/getPublish` | getPublish | 设置获取Publish | - | ❌ 未覆盖 |
| 19 | POST | `/api/setting/refreshVirtualBlockRef` | refreshVirtualBlockRef | 设置refreshVirtualBlock引用 | - | ❌ 未覆盖 |
| 20 | POST | `/api/setting/addVirtualBlockRefInclude` | addVirtualBlockRefInclude | 设置添加VirtualBlock引用Include | - | ❌ 未覆盖 |
| 21 | POST | `/api/setting/addVirtualBlockRefExclude` | addVirtualBlockRefExclude | 设置添加VirtualBlock引用Exclude | - | ❌ 未覆盖 |
| 22 | POST | `/api/setting/setSnippet` | setConfSnippet | 设置设置配置Snippet | - | ❌ 未覆盖 |
| 23 | POST | `/api/setting/setEditorReadOnly` | setEditorReadOnly | 设置设置EditorReadOnly | - | ❌ 未覆盖 |

---

## bazaar 模块

**统计**: 共 23 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/bazaar/getBazaarPlugin` | getBazaarPlugin | 集市获取BazaarPlugin | - | ❌ 未覆盖 |
| 2 | POST | `/api/bazaar/getInstalledPlugin` | getInstalledPlugin | 集市获取InstalledPlugin | - | ❌ 未覆盖 |
| 3 | POST | `/api/bazaar/installBazaarPlugin` | installBazaarPlugin | 集市installBazaarPlugin | - | ❌ 未覆盖 |
| 4 | POST | `/api/bazaar/uninstallBazaarPlugin` | uninstallBazaarPlugin | 集市uninstallBazaarPlugin | - | ❌ 未覆盖 |
| 5 | POST | `/api/bazaar/getBazaarWidget` | getBazaarWidget | 集市获取BazaarWidget | - | ❌ 未覆盖 |
| 6 | POST | `/api/bazaar/getInstalledWidget` | getInstalledWidget | 集市获取InstalledWidget | - | ❌ 未覆盖 |
| 7 | POST | `/api/bazaar/installBazaarWidget` | installBazaarWidget | 集市installBazaarWidget | - | ❌ 未覆盖 |
| 8 | POST | `/api/bazaar/uninstallBazaarWidget` | uninstallBazaarWidget | 集市uninstallBazaarWidget | - | ❌ 未覆盖 |
| 9 | POST | `/api/bazaar/getBazaarIcon` | getBazaarIcon | 集市获取Bazaar图标 | - | ❌ 未覆盖 |
| 10 | POST | `/api/bazaar/getInstalledIcon` | getInstalledIcon | 集市获取Installed图标 | - | ❌ 未覆盖 |
| 11 | POST | `/api/bazaar/installBazaarIcon` | installBazaarIcon | 集市installBazaar图标 | - | ❌ 未覆盖 |
| 12 | POST | `/api/bazaar/uninstallBazaarIcon` | uninstallBazaarIcon | 集市uninstallBazaar图标 | - | ❌ 未覆盖 |
| 13 | POST | `/api/bazaar/getBazaarTemplate` | getBazaarTemplate | 集市获取Bazaar模板 | - | ❌ 未覆盖 |
| 14 | POST | `/api/bazaar/getInstalledTemplate` | getInstalledTemplate | 集市获取Installed模板 | - | ❌ 未覆盖 |
| 15 | POST | `/api/bazaar/installBazaarTemplate` | installBazaarTemplate | 集市installBazaar模板 | - | ❌ 未覆盖 |
| 16 | POST | `/api/bazaar/uninstallBazaarTemplate` | uninstallBazaarTemplate | 集市uninstallBazaar模板 | - | ❌ 未覆盖 |
| 17 | POST | `/api/bazaar/getBazaarTheme` | getBazaarTheme | 集市获取BazaarTheme | - | ❌ 未覆盖 |
| 18 | POST | `/api/bazaar/getInstalledTheme` | getInstalledTheme | 集市获取InstalledTheme | - | ❌ 未覆盖 |
| 19 | POST | `/api/bazaar/installBazaarTheme` | installBazaarTheme | 集市installBazaarTheme | - | ❌ 未覆盖 |
| 20 | POST | `/api/bazaar/uninstallBazaarTheme` | uninstallBazaarTheme | 集市uninstallBazaarTheme | - | ❌ 未覆盖 |
| 21 | POST | `/api/bazaar/getBazaarPackageREADME` | getBazaarPackageREADME | 集市获取BazaarPackageREADME | - | ❌ 未覆盖 |
| 22 | POST | `/api/bazaar/getUpdatedPackage` | getUpdatedPackage | 集市获取UpdatedPackage | - | ❌ 未覆盖 |
| 23 | POST | `/api/bazaar/batchUpdatePackage` | batchUpdatePackage | 集市批量UpdatePackage | - | ❌ 未覆盖 |

---

## repo 模块

**统计**: 共 23 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/repo/initRepoKey` | initRepoKey | 仓库初始化RepoKey | - | ❌ 未覆盖 |
| 2 | POST | `/api/repo/initRepoKeyFromPassphrase` | initRepoKeyFromPassphrase | 仓库初始化RepoKeyFromPassphrase | - | ❌ 未覆盖 |
| 3 | POST | `/api/repo/resetRepo` | resetRepo | 仓库重置Repo | - | ❌ 未覆盖 |
| 4 | POST | `/api/repo/purgeRepo` | purgeRepo | 仓库清除Repo | - | ❌ 未覆盖 |
| 5 | POST | `/api/repo/purgeCloudRepo` | purgeCloudRepo | 仓库清除CloudRepo | - | ❌ 未覆盖 |
| 6 | POST | `/api/repo/importRepoKey` | importRepoKey | 仓库导入RepoKey | - | ❌ 未覆盖 |
| 7 | POST | `/api/repo/createSnapshot` | createSnapshot | 创建本地数据快照 | - | ❌ 未覆盖 |
| 8 | POST | `/api/repo/tagSnapshot` | tagSnapshot | 为本地数据快照创建标签引用 | - | ❌ 未覆盖 |
| 9 | POST | `/api/repo/checkoutRepo` | checkoutRepo | 仓库检查outRepo | - | ❌ 未覆盖 |
| 10 | POST | `/api/repo/getRepoSnapshots` | getRepoSnapshots | 分页获取本地数据快照列表 | - | ❌ 未覆盖 |
| 11 | POST | `/api/repo/getRepoTagSnapshots` | getRepoTagSnapshots | 获取本地已标记数据快照列表 | - | ❌ 未覆盖 |
| 12 | POST | `/api/repo/removeRepoTagSnapshot` | removeRepoTagSnapshot | 删除本地数据快照标签引用 | - | ❌ 未覆盖 |
| 13 | POST | `/api/repo/getCloudRepoTagSnapshots` | getCloudRepoTagSnapshots | 获取云端已标记数据快照列表 | - | ❌ 未覆盖 |
| 14 | POST | `/api/repo/getCloudRepoSnapshots` | getCloudRepoSnapshots | 分页获取云端数据快照列表 | - | ❌ 未覆盖 |
| 15 | POST | `/api/repo/removeCloudRepoTagSnapshot` | removeCloudRepoTagSnapshot | 删除云端数据快照标签引用 | - | ❌ 未覆盖 |
| 16 | POST | `/api/repo/uploadCloudSnapshot` | uploadCloudSnapshot | 上传本地已标记数据快照到云端 | - | ❌ 未覆盖 |
| 17 | POST | `/api/repo/downloadCloudSnapshot` | downloadCloudSnapshot | 下载云端数据快照到本地 | - | ❌ 未覆盖 |
| 18 | POST | `/api/repo/diffRepoSnapshots` | diffRepoSnapshots | 对比两个数据快照的文件差异 | - | ❌ 未覆盖 |
| 19 | POST | `/api/repo/openRepoSnapshotFile` | openRepoSnapshotFile | 打开数据快照中的单个文件 | - | ❌ 未覆盖 |
| 20 | POST | `/api/repo/rollbackRepoSnapshotFile` | rollbackRepoSnapshotFile | 回滚数据快照中的单个文件 | - | ❌ 未覆盖 |
| 21 | POST | `/api/repo/getRepoFile` | getRepoFile | 仓库获取RepoFile | - | ❌ 未覆盖 |
| 22 | POST | `/api/repo/setRepoIndexRetentionDays` | setRepoIndexRetentionDays | 仓库设置Repo索引RetentionDays | - | ❌ 未覆盖 |
| 23 | POST | `/api/repo/setRetentionIndexesDaily` | setRetentionIndexesDaily | 仓库设置Retention索引esDaily | - | ❌ 未覆盖 |

---

## sync 模块

**统计**: 共 21 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/sync/setSyncEnable` | setSyncEnable | 同步设置SyncEnable | - | ❌ 未覆盖 |
| 2 | POST | `/api/sync/setSyncInterval` | setSyncInterval | 同步设置SyncInterval | - | ❌ 未覆盖 |
| 3 | POST | `/api/sync/setSyncPerception` | setSyncPerception | 同步设置SyncPerception | - | ❌ 未覆盖 |
| 4 | POST | `/api/sync/setSyncGenerateConflictDoc` | setSyncGenerateConflictDoc | 同步设置SyncGenerate配置lictDoc | - | ❌ 未覆盖 |
| 5 | POST | `/api/sync/setSyncMode` | setSyncMode | 同步设置SyncMode | - | ❌ 未覆盖 |
| 6 | POST | `/api/sync/setSyncProvider` | setSyncProvider | 同步设置SyncProvider | - | ❌ 未覆盖 |
| 7 | POST | `/api/sync/setSyncProviderS3` | setSyncProviderS3 | 同步设置SyncProviderS3 | - | ❌ 未覆盖 |
| 8 | POST | `/api/sync/setSyncProviderWebDAV` | setSyncProviderWebDAV | 同步设置SyncProviderWebDAV | - | ❌ 未覆盖 |
| 9 | POST | `/api/sync/setSyncProviderLocal` | setSyncProviderLocal | 同步设置SyncProviderLocal | - | ❌ 未覆盖 |
| 10 | POST | `/api/sync/setCloudSyncDir` | setCloudSyncDir | 同步设置CloudSyncDir | - | ❌ 未覆盖 |
| 11 | POST | `/api/sync/createCloudSyncDir` | createCloudSyncDir | 同步创建CloudSyncDir | - | ❌ 未覆盖 |
| 12 | POST | `/api/sync/removeCloudSyncDir` | removeCloudSyncDir | 同步删除CloudSyncDir | - | ❌ 未覆盖 |
| 13 | POST | `/api/sync/listCloudSyncDir` | listCloudSyncDir | 同步列出CloudSyncDir | - | ❌ 未覆盖 |
| 14 | POST | `/api/sync/performSync` | performSync | 同步performSync | - | ❌ 未覆盖 |
| 15 | POST | `/api/sync/performBootSync` | performBootSync | 同步performBootSync | - | ❌ 未覆盖 |
| 16 | POST | `/api/sync/getBootSync` | getBootSync | 同步获取BootSync | - | ❌ 未覆盖 |
| 17 | POST | `/api/sync/getSyncInfo` | getSyncInfo | 同步获取Sync信息 | - | ❌ 未覆盖 |
| 18 | POST | `/api/sync/exportSyncProviderS3` | exportSyncProviderS3 | 同步导出SyncProviderS3 | - | ❌ 未覆盖 |
| 19 | POST | `/api/sync/importSyncProviderS3` | importSyncProviderS3 | 同步导入SyncProviderS3 | - | ❌ 未覆盖 |
| 20 | POST | `/api/sync/exportSyncProviderWebDAV` | exportSyncProviderWebDAV | 同步导出SyncProviderWebDAV | - | ❌ 未覆盖 |
| 21 | POST | `/api/sync/importSyncProviderWebDAV` | importSyncProviderWebDAV | 同步导入SyncProviderWebDAV | - | ❌ 未覆盖 |

---

## asset 模块

**统计**: 共 19 个 API，已覆盖 7 个，覆盖率 36.8%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/asset/uploadCloud` | uploadCloud | 资源上传Cloud | - | ❌ 未覆盖 |
| 2 | POST | `/api/asset/uploadCloudByAssetsPaths` | uploadCloudByAssetsPaths | 资源上传CloudBy资源路径s | - | ❌ 未覆盖 |
| 3 | POST | `/api/asset/insertLocalAssets` | insertLocalAssets | 资源插入Local资源 | - | ❌ 未覆盖 |
| 4 | POST | `/api/asset/resolveAssetPath` | resolveAssetPath | 资源resolve资源路径 | - | ❌ 未覆盖 |
| 5 | POST | `/api/asset/upload` | Upload | 资源上传 | file.upload_asset | ✅ 已覆盖 |
| 6 | POST | `/api/asset/setFileAnnotation` | setFileAnnotation | 资源设置FileAnnotation | - | ❌ 未覆盖 |
| 7 | POST | `/api/asset/getFileAnnotation` | getFileAnnotation | 资源获取FileAnnotation | - | ❌ 未覆盖 |
| 8 | POST | `/api/asset/getUnusedAssets` | getUnusedAssets | 资源获取Unused资源 | file.list_unused_assets | ✅ 已覆盖 |
| 9 | POST | `/api/asset/getMissingAssets` | getMissingAssets | 资源获取Missing资源 | - | ❌ 未覆盖 |
| 10 | POST | `/api/asset/removeUnusedAsset` | removeUnusedAsset | 资源删除Unused资源 | - | ❌ 未覆盖 |
| 11 | POST | `/api/asset/removeUnusedAssets` | removeUnusedAssets | 资源删除Unused资源 | file.remove_unused_assets | ✅ 已覆盖 |
| 12 | POST | `/api/asset/getDocImageAssets` | getDocImageAssets | 资源获取DocImage资源 | file.get_doc_assets | ✅ 已覆盖 |
| 13 | POST | `/api/asset/getDocAssets` | getDocAssets | 资源获取Doc资源 | file.get_doc_assets | ✅ 已覆盖 |
| 14 | POST | `/api/asset/renameAsset` | renameAsset | 资源重命名资源 | file.rename_asset | ✅ 已覆盖 |

> 注：`file.delete_asset` 与 `file.set_image_alpha` 已在插件中实现兼容性 action，但未出现在本次 459 个上游 Kernel API 端点扫描结果中，因此不计入本表覆盖率统计。
| 15 | POST | `/api/asset/getImageOCRText` | getImageOCRText | 资源获取ImageOCRText | file.get_image_ocr_text | ✅ 已覆盖 |
| 16 | POST | `/api/asset/setImageOCRText` | setImageOCRText | 资源设置ImageOCRText | - | ❌ 未覆盖 |
| 17 | POST | `/api/asset/ocr` | ocr | 资源ocr | - | ❌ 未覆盖 |
| 18 | POST | `/api/asset/fullReindexAssetContent` | fullReindexAssetContent | 资源fullReindex资源Content | - | ❌ 未覆盖 |
| 19 | POST | `/api/asset/statAsset` | statAsset | 资源stat资源 | - | ❌ 未覆盖 |

---

## riff 模块

**统计**: 共 17 个 API，已覆盖 9 个，覆盖率 52.9%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/riff/createRiffDeck` | createRiffDeck | 闪卡创建RiffDeck | - | ❌ 未覆盖 |
| 2 | POST | `/api/riff/renameRiffDeck` | renameRiffDeck | 闪卡重命名RiffDeck | - | ❌ 未覆盖 |
| 3 | POST | `/api/riff/removeRiffDeck` | removeRiffDeck | 闪卡删除RiffDeck | - | ❌ 未覆盖 |
| 4 | POST | `/api/riff/getRiffDecks` | getRiffDecks | 闪卡获取RiffDecks | flashcard.get_decks | ✅ 已覆盖 |
| 5 | POST | `/api/riff/addRiffCards` | addRiffCards | 闪卡添加RiffCards | flashcard.add_card | ✅ 已覆盖 |
| 6 | POST | `/api/riff/removeRiffCards` | removeRiffCards | 闪卡删除RiffCards | flashcard.remove_card | ✅ 已覆盖 |
| 7 | POST | `/api/riff/getRiffDueCards` | getRiffDueCards | 闪卡获取RiffDueCards | flashcard.list_cards | ✅ 已覆盖 |
| 8 | POST | `/api/riff/getTreeRiffDueCards` | getTreeRiffDueCards | 闪卡获取树RiffDueCards | flashcard.list_cards | ✅ 已覆盖 |
| 9 | POST | `/api/riff/getNotebookRiffDueCards` | getNotebookRiffDueCards | 闪卡获取NotebookRiffDueCards | flashcard.list_cards | ✅ 已覆盖 |
| 10 | POST | `/api/riff/reviewRiffCard` | reviewRiffCard | 闪卡复习RiffCard | flashcard.review_card | ✅ 已覆盖 |
| 11 | POST | `/api/riff/skipReviewRiffCard` | skipReviewRiffCard | 闪卡跳过ReviewRiffCard | flashcard.skip_review_card | ✅ 已覆盖 |
| 12 | POST | `/api/riff/getRiffCards` | getRiffCards | 闪卡获取RiffCards | flashcard.get_cards | ✅ 已覆盖 |
| 13 | POST | `/api/riff/getTreeRiffCards` | getTreeRiffCards | 闪卡获取树RiffCards | - | ❌ 未覆盖 |
| 14 | POST | `/api/riff/getNotebookRiffCards` | getNotebookRiffCards | 闪卡获取NotebookRiffCards | - | ❌ 未覆盖 |
| 15 | POST | `/api/riff/resetRiffCards` | resetRiffCards | 闪卡重置RiffCards | - | ❌ 未覆盖 |
| 16 | POST | `/api/riff/batchSetRiffCardsDueTime` | batchSetRiffCardsDueTime | 闪卡批量SetRiffCardsDue时间 | - | ❌ 未覆盖 |
| 17 | POST | `/api/riff/getRiffCardsByBlockIDs` | getRiffCardsByBlockIDs | 闪卡获取RiffCardsByBlockID列表 | - | ❌ 未覆盖 |

---

## storage 模块

**统计**: 共 15 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/storage/setLocalStorage` | setLocalStorage | 存储设置LocalStorage | - | ❌ 未覆盖 |
| 2 | POST | `/api/storage/getLocalStorage` | getLocalStorage | 存储获取LocalStorage | - | ❌ 未覆盖 |
| 3 | POST | `/api/storage/setLocalStorageVal` | setLocalStorageVal | 存储设置LocalStorageVal | - | ❌ 未覆盖 |
| 4 | POST | `/api/storage/removeLocalStorageVals` | removeLocalStorageVals | 存储删除LocalStorageVals | - | ❌ 未覆盖 |
| 5 | POST | `/api/storage/setCriterion` | setCriterion | 存储设置Criterion | - | ❌ 未覆盖 |
| 6 | POST | `/api/storage/getCriteria` | getCriteria | 存储获取Criteria | - | ❌ 未覆盖 |
| 7 | POST | `/api/storage/removeCriterion` | removeCriterion | 存储删除Criterion | - | ❌ 未覆盖 |
| 8 | POST | `/api/storage/getRecentDocs` | getRecentDocs | 存储获取RecentDocs | - | ❌ 未覆盖 |
| 9 | POST | `/api/storage/updateRecentDocViewTime` | updateRecentDocViewTime | 存储更新RecentDocView时间 | - | ❌ 未覆盖 |
| 10 | POST | `/api/storage/updateRecentDocCloseTime` | updateRecentDocCloseTime | 存储更新RecentDocClose时间 | - | ❌ 未覆盖 |
| 11 | POST | `/api/storage/batchUpdateRecentDocCloseTime` | batchUpdateRecentDocCloseTime | 存储批量UpdateRecentDocClose时间 | - | ❌ 未覆盖 |
| 12 | POST | `/api/storage/updateRecentDocOpenTime` | updateRecentDocOpenTime | 存储更新RecentDocOpen时间 | - | ❌ 未覆盖 |
| 13 | POST | `/api/storage/getOutlineStorage` | getOutlineStorage | 存储获取OutlineStorage | - | ❌ 未覆盖 |
| 14 | POST | `/api/storage/setOutlineStorage` | setOutlineStorage | 存储设置OutlineStorage | - | ❌ 未覆盖 |
| 15 | POST | `/api/storage/removeOutlineStorage` | removeOutlineStorage | 存储删除OutlineStorage | - | ❌ 未覆盖 |

---

## search 模块

**统计**: 共 14 个 API，已覆盖 8 个，覆盖率 57.1%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/search/searchTag` | searchTag | 搜索搜索Tag | search.search_tag | ✅ 已覆盖 |
| 2 | POST | `/api/search/searchTemplate` | searchTemplate | 搜索搜索模板 | - | ❌ 未覆盖 |
| 3 | POST | `/api/search/removeTemplate` | removeTemplate | 搜索删除模板 | - | ❌ 未覆盖 |
| 4 | POST | `/api/search/searchWidget` | searchWidget | 搜索搜索Widget | - | ❌ 未覆盖 |
| 5 | POST | `/api/search/searchRefBlock` | searchRefBlock | 搜索搜索引用Block | search.search_refs | ✅ 已覆盖 |
| 6 | POST | `/api/search/searchEmbedBlock` | searchEmbedBlock | 搜索搜索EmbedBlock | - | ❌ 未覆盖 |
| 7 | POST | `/api/search/getEmbedBlock` | getEmbedBlock | 搜索获取EmbedBlock | - | ❌ 未覆盖 |
| 8 | POST | `/api/search/updateEmbedBlock` | updateEmbedBlock | 搜索更新EmbedBlock | - | ❌ 未覆盖 |
| 9 | POST | `/api/search/fullTextSearchBlock` | fullTextSearchBlock | 搜索fullTextSearchBlock | search.fulltext | ✅ 已覆盖 |
| 10 | POST | `/api/search/searchAsset` | searchAsset | 搜索搜索资源 | search.search_assets | ✅ 已覆盖 |
| 11 | POST | `/api/search/findReplace` | findReplace | 搜索findReplace | search.find_replace | ✅ 已覆盖 |
| 12 | POST | `/api/search/fullTextSearchAssetContent` | fullTextSearchAssetContent | 搜索fullTextSearch资源Content | search.fulltext_asset_content | ✅ 已覆盖 |
| 13 | POST | `/api/search/getAssetContent` | getAssetContent | 搜索获取资源Content | search.get_asset_content | ✅ 已覆盖 |
| 14 | POST | `/api/search/listInvalidBlockRefs` | listInvalidBlockRefs | 搜索列出InvalidBlock引用s | search.list_invalid_refs | ✅ 已覆盖 |

---

## notebook 模块

**统计**: 共 11 个 API，已覆盖 9 个，覆盖率 81.8%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/notebook/lsNotebooks` | lsNotebooks | 笔记本lsNotebooks | notebook.list | ✅ 已覆盖 |
| 2 | POST | `/api/notebook/openNotebook` | openNotebook | 笔记本打开 | notebook.set_open_state | ✅ 已覆盖 |
| 3 | POST | `/api/notebook/closeNotebook` | closeNotebook | 笔记本关闭 | notebook.set_open_state | ✅ 已覆盖 |
| 4 | POST | `/api/notebook/getNotebookConf` | getNotebookConf | 笔记本获取配置 | notebook.get_conf | ✅ 已覆盖 |
| 5 | POST | `/api/notebook/setNotebookConf` | setNotebookConf | 笔记本设置配置 | notebook.set_conf | ✅ 已覆盖 |
| 6 | POST | `/api/notebook/createNotebook` | createNotebook | 笔记本创建 | notebook.create | ✅ 已覆盖 |
| 7 | POST | `/api/notebook/removeNotebook` | removeNotebook | 笔记本删除 | notebook.remove | ✅ 已覆盖 |
| 8 | POST | `/api/notebook/renameNotebook` | renameNotebook | 笔记本重命名 | notebook.rename | ✅ 已覆盖 |
| 9 | POST | `/api/notebook/changeSortNotebook` | changeSortNotebook | 笔记本changeSortNotebook | - | ❌ 未覆盖 |
| 10 | POST | `/api/notebook/setNotebookIcon` | setNotebookIcon | 笔记本设置图标 | notebook.set_icon | ✅ 已覆盖 |
| 11 | POST | `/api/notebook/getNotebookInfo` | getNotebookInfo | 笔记本获取信息 | - | ❌ 未覆盖 |

---

## history 模块

**统计**: 共 10 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/history/rollbackAttributeViewHistory` | rollbackAttributeViewHistory | 历史回滚历史 | - | ❌ 未覆盖 |
| 2 | POST | `/api/history/getNotebookHistory` | getNotebookHistory | 历史获取Notebook历史 | - | ❌ 未覆盖 |
| 3 | POST | `/api/history/rollbackNotebookHistory` | rollbackNotebookHistory | 历史回滚Notebook历史 | - | ❌ 未覆盖 |
| 4 | POST | `/api/history/rollbackAssetsHistory` | rollbackAssetsHistory | 历史回滚资源历史 | - | ❌ 未覆盖 |
| 5 | POST | `/api/history/getDocHistoryContent` | getDocHistoryContent | 历史获取Doc历史Content | - | ❌ 未覆盖 |
| 6 | POST | `/api/history/rollbackDocHistory` | rollbackDocHistory | 历史回滚Doc历史 | - | ❌ 未覆盖 |
| 7 | POST | `/api/history/clearWorkspaceHistory` | clearWorkspaceHistory | 历史清空工作区历史 | - | ❌ 未覆盖 |
| 8 | POST | `/api/history/reindexHistory` | reindexHistory | 历史reindex历史 | - | ❌ 未覆盖 |
| 9 | POST | `/api/history/searchHistory` | searchHistory | 历史搜索历史 | - | ❌ 未覆盖 |
| 10 | POST | `/api/history/getHistoryItems` | getHistoryItems | 历史获取历史Items | - | ❌ 未覆盖 |

---

## file 模块

**统计**: 共 8 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/file/getFile` | getFile | 文件获取File | - | ❌ 未覆盖 |
| 2 | POST | `/api/file/putFile` | putFile | 文件写入File | - | ❌ 未覆盖 |
| 3 | POST | `/api/file/copyFile` | copyFile | 文件复制File | - | ❌ 未覆盖 |
| 4 | POST | `/api/file/globalCopyFiles` | globalCopyFiles | 文件globalCopyFiles | - | ❌ 未覆盖 |
| 5 | POST | `/api/file/removeFile` | removeFile | 文件删除File | - | ❌ 未覆盖 |
| 6 | POST | `/api/file/renameFile` | renameFile | 文件重命名File | - | ❌ 未覆盖 |
| 7 | POST | `/api/file/readDir` | readDir | 文件readDir | - | ❌ 未覆盖 |
| 8 | POST | `/api/file/getUniqueFilename` | getUniqueFilename | 文件获取UniqueFilename | - | ❌ 未覆盖 |

---

## ui 模块

**统计**: 共 7 个 API，已覆盖 5 个，覆盖率 71.4%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/ui/reloadUI` | reloadUI | uireloadUI | - | ❌ 未覆盖 |
| 2 | POST | `/api/ui/reloadIcon` | reloadIcon | uireload图标 | document.create(icon)<br>document.set_icon<br>notebook.create(icon)<br>notebook.set_icon | ✅ 已覆盖 |
| 3 | POST | `/api/ui/reloadTheme` | reloadTheme | uireloadTheme | - | ❌ 未覆盖 |
| 4 | POST | `/api/ui/reloadAttributeView` | reloadAttributeView | uireload属性ibuteView | av.add_rows<br>av.remove_rows<br>av.add_column<br>av.remove_column<br>av.set_cells<br>av.duplicate_block | ✅ 已覆盖 |
| 5 | POST | `/api/ui/reloadProtyle` | reloadProtyle | uireloadProtyle | block 写操作<br>document 写操作<br>av.duplicate_block | ✅ 已覆盖 |
| 6 | POST | `/api/ui/reloadFiletree` | reloadFiletree | uireloadFiletree | notebook 写操作<br>document 树写操作<br>block heading_to_doc/doc_to_heading | ✅ 已覆盖 |
| 7 | POST | `/api/ui/reloadTag` | reloadTag | uireloadTag | tag.rename<br>tag.remove | ✅ 已覆盖 |

---

## attr 模块

**统计**: 共 6 个 API，已覆盖 2 个，覆盖率 33.3%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/attr/getBookmarkLabels` | getBookmarkLabels | 属性获取BookmarkLabels | - | ❌ 未覆盖 |
| 2 | POST | `/api/attr/resetBlockAttrs` | resetBlockAttrs | 属性重置Block属性 | - | ❌ 未覆盖 |
| 3 | POST | `/api/attr/setBlockAttrs` | setBlockAttrs | 属性设置Block属性 | document.set_icon<br>document.set_cover<br>block.set_attrs | ✅ 已覆盖 |
| 4 | POST | `/api/attr/batchSetBlockAttrs` | batchSetBlockAttrs | 属性批量SetBlock属性 | - | ❌ 未覆盖 |
| 5 | POST | `/api/attr/getBlockAttrs` | getBlockAttrs | 属性获取Block属性 | block.get_attrs | ✅ 已覆盖 |
| 6 | POST | `/api/attr/batchGetBlockAttrs` | batchGetBlockAttrs | 属性批量GetBlock属性 | - | ❌ 未覆盖 |

---

## account 模块

**统计**: 共 5 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/account/login` | login | account登录 | - | ❌ 未覆盖 |
| 2 | POST | `/api/account/checkActivationcode` | checkActivationcode | account检查Activationcode | - | ❌ 未覆盖 |
| 3 | POST | `/api/account/useActivationcode` | useActivationcode | accountuseActivationcode | - | ❌ 未覆盖 |
| 4 | POST | `/api/account/deactivate` | deactivateUser | accountdeactivateUser | - | ❌ 未覆盖 |
| 5 | POST | `/api/account/startFreeTrial` | startFreeTrial | accountstartFreeTrial | - | ❌ 未覆盖 |

---

## ref 模块

**统计**: 共 5 个 API，已覆盖 2 个，覆盖率 40.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/ref/refreshBacklink` | refreshBacklink | 引用refreshBacklink | - | ❌ 未覆盖 |
| 2 | POST | `/api/ref/getBacklink` | getBacklink | 引用获取Backlink | - | ❌ 未覆盖 |
| 3 | POST | `/api/ref/getBacklink2` | getBacklink2 | 引用获取Backlink2 | - | ❌ 未覆盖 |
| 4 | POST | `/api/ref/getBacklinkDoc` | getBacklinkDoc | 引用获取BacklinkDoc | search.get_backlinks | ✅ 已覆盖 |
| 5 | POST | `/api/ref/getBackmentionDoc` | getBackmentionDoc | 引用获取BackmentionDoc | search.get_backmentions | ✅ 已覆盖 |

---

## import 模块

**统计**: 共 4 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/import/importStdMd` | importStdMd | 导入导入StdMd | - | ❌ 未覆盖 |
| 2 | POST | `/api/import/importZipMd` | importZipMd | 导入导入ZipMd | - | ❌ 未覆盖 |
| 3 | POST | `/api/import/importData` | importData | 导入导入Data | - | ❌ 未覆盖 |
| 4 | POST | `/api/import/importSY` | importSY | 导入导入SY | - | ❌ 未覆盖 |

---

## graph 模块

**统计**: 共 4 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/graph/resetGraph` | resetGraph | 关系图重置Graph | - | ❌ 未覆盖 |
| 2 | POST | `/api/graph/resetLocalGraph` | resetLocalGraph | 关系图重置LocalGraph | - | ❌ 未覆盖 |
| 3 | POST | `/api/graph/getGraph` | getGraph | 关系图获取Graph | - | ❌ 未覆盖 |
| 4 | POST | `/api/graph/getLocalGraph` | getLocalGraph | 关系图获取LocalGraph | - | ❌ 未覆盖 |

---

## broadcast 模块

**统计**: 共 4 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/broadcast/publish` | broadcastPublish | broadcastbroadcastPublish | - | ❌ 未覆盖 |
| 2 | POST | `/api/broadcast/postMessage` | postMessage | broadcastpostMessage | - | ❌ 未覆盖 |
| 3 | POST | `/api/broadcast/getChannels` | getChannels | broadcast获取Channels | - | ❌ 未覆盖 |
| 4 | POST | `/api/broadcast/getChannelInfo` | getChannelInfo | broadcast获取Channel信息 | - | ❌ 未覆盖 |

---

## format 模块

**统计**: 共 3 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/format/autoSpace` | autoSpace | formatautoSpace | - | ❌ 未覆盖 |
| 2 | POST | `/api/format/netImg2LocalAssets` | netImg2LocalAssets | formatnetImg2Local资源 | - | ❌ 未覆盖 |
| 3 | POST | `/api/format/netAssets2LocalAssets` | netAssets2LocalAssets | formatnet资源2Local资源 | - | ❌ 未覆盖 |

---

## bookmark 模块

**统计**: 共 3 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/bookmark/getBookmark` | getBookmark | 书签获取Bookmark | - | ❌ 未覆盖 |
| 2 | POST | `/api/bookmark/renameBookmark` | renameBookmark | 书签重命名Bookmark | - | ❌ 未覆盖 |
| 3 | POST | `/api/bookmark/removeBookmark` | removeBookmark | 书签删除Bookmark | - | ❌ 未覆盖 |

---

## tag 模块

**统计**: 共 3 个 API，已覆盖 3 个，覆盖率 100.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/tag/getTag` | getTag | 标签获取Tag | tag.list | ✅ 已覆盖 |
| 2 | POST | `/api/tag/renameTag` | renameTag | 标签重命名Tag | tag.rename | ✅ 已覆盖 |
| 3 | POST | `/api/tag/removeTag` | removeTag | 标签删除Tag | tag.remove | ✅ 已覆盖 |

---

## lute 模块

**统计**: 共 3 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/lute/spinBlockDOM` | spinBlockDOM | lutespinBlockDOM | - | ❌ 未覆盖 |
| 2 | POST | `/api/lute/html2BlockDOM` | html2BlockDOM | lutehtml2BlockDOM | - | ❌ 未覆盖 |
| 3 | POST | `/api/lute/copyStdMarkdown` | copyStdMarkdown | lute复制StdMarkdown | - | ❌ 未覆盖 |

---

## inbox 模块

**统计**: 共 3 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/inbox/getShorthands` | getShorthands | 收件箱获取Shorthands | - | ❌ 未覆盖 |
| 2 | POST | `/api/inbox/getShorthand` | getShorthand | 收件箱获取Shorthand | - | ❌ 未覆盖 |
| 3 | POST | `/api/inbox/removeShorthands` | removeShorthands | 收件箱删除Shorthands | - | ❌ 未覆盖 |

---

## template 模块

**统计**: 共 3 个 API，已覆盖 2 个，覆盖率 66.7%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/template/render` | renderTemplate | 模板渲染模板 | file.render_template | ✅ 已覆盖 |
| 2 | POST | `/api/template/docSaveAsTemplate` | docSaveAsTemplate | 模板docSaveAs模板 | - | ❌ 未覆盖 |
| 3 | POST | `/api/template/renderSprig` | renderSprig | 模板渲染Sprig | file.render_sprig | ✅ 已覆盖 |

---

## snippet 模块

**统计**: 共 3 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/snippet/getSnippet` | getSnippet | 代码片段获取Snippet | - | ❌ 未覆盖 |
| 2 | POST | `/api/snippet/setSnippet` | setSnippet | 代码片段设置Snippet | - | ❌ 未覆盖 |
| 3 | POST | `/api/snippet/removeSnippet` | removeSnippet | 代码片段删除Snippet | - | ❌ 未覆盖 |

---

## clipboard 模块

**统计**: 共 2 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/clipboard/readFilePaths` | readFilePaths | clipboardreadFile路径s | - | ❌ 未覆盖 |
| 2 | POST | `/api/clipboard/writeFilePath` | writeFilePath | clipboardwriteFile路径 | - | ❌ 未覆盖 |

---

## notification 模块

**统计**: 共 2 个 API，已覆盖 2 个，覆盖率 100.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/notification/pushMsg` | pushMsg | notificationpushMsg | system.push_msg | ✅ 已覆盖 |
| 2 | POST | `/api/notification/pushErrMsg` | pushErrMsg | notificationpushErrMsg | system.push_err_msg | ✅ 已覆盖 |

---

## ai 模块

**统计**: 共 2 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/ai/chatGPT` | chatGPT | aichatGPT | - | ❌ 未覆盖 |
| 2 | POST | `/api/ai/chatGPTWithAction` | chatGPTWithAction | aichatGPTWithAction | - | ❌ 未覆盖 |

---

## petal 模块

**统计**: 共 2 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/petal/loadPetals` | loadPetals | petalloadPetals | - | ❌ 未覆盖 |
| 2 | POST | `/api/petal/setPetalEnabled` | setPetalEnabled | petal设置PetalEnabled | - | ❌ 未覆盖 |

---

## archive 模块

**统计**: 共 2 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/archive/zip` | zip | archivezip | - | ❌ 未覆盖 |
| 2 | POST | `/api/archive/unzip` | unzip | archiveunzip | - | ❌ 未覆盖 |

---

## icon 模块

**统计**: 共 1 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | GET | `/api/icon/getDynamicIcon` | getDynamicIcon | icon获取Dynamic图标 | - | ❌ 未覆盖 |

---

## outline 模块

**统计**: 共 1 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/outline/getDocOutline` | getDocOutline | 大纲获取DocOutline | - | ❌ 未覆盖 |

---

## query 模块

**统计**: 共 1 个 API，已覆盖 1 个，覆盖率 100.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/query/sql` | SQL | querySQL | search.query_sql | ✅ 已覆盖 |

---

## sqlite 模块

**统计**: 共 1 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/sqlite/flushTransaction` | flushTransaction | sqlite刷新Transaction | - | ❌ 未覆盖 |

---

## cloud 模块

**统计**: 共 1 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/cloud/getCloudSpace` | getCloudSpace | cloud获取CloudSpace | - | ❌ 未覆盖 |

---

## extension 模块

**统计**: 共 1 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/extension/copy` | extensionCopy | extensionextensionCopy | - | ❌ 未覆盖 |

---

## convert 模块

**统计**: 共 1 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/convert/pandoc` | pandoc | convertpandoc | - | ❌ 未覆盖 |

---

## transactions 模块

**统计**: 共 1 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/transactions` | performTransactions | transactionsperformTransactions | - | ❌ 未覆盖 |

---

## network 模块

**统计**: 共 1 个 API，已覆盖 0 个，覆盖率 0.0%

| 序号 | 方法 | API 路径 | 处理函数 | 功能描述 | MCP 映射 | 状态 |
|------|------|----------|----------|----------|----------|------|
| 1 | POST | `/api/network/forwardProxy` | forwardProxy | networkforwardProxy | - | ❌ 未覆盖 |

---

## Snapshot 接口明细

来源：本节按本仓库内 `siyuan/kernel/api/router.go`、`siyuan/kernel/api/repo.go`、`siyuan/kernel/api/av.go` 与前端 `siyuan/app/src/history/*.ts` 调用点整理。这里的 Snapshot 指思源数据仓库快照，不同于 `/api/history/*` 的文档/资源历史。

### Snapshot API 总览

| 模块 | API 路径 | 请求参数 | 返回数据 | 权限/只读限制 | MCP 覆盖建议 |
|------|----------|----------|----------|---------------|--------------|
| av | `POST /api/av/renderSnapshotAttributeView` | `id` 必填；`snapshot` 必填 | `name`、`id`、`viewType`、`viewID`、`views`、`view`、`isMirror` | 需认证 + 管理员角色；只读可调用 | 可扩展 `av.render`，增加 `snapshot` 参数 |
| repo | `POST /api/repo/createSnapshot` | `memo` 可选 | 标准 Ret；失败时可能带 `data.closeTimeout` | 需认证 + 管理员角色；只读禁止 | 建议新增 `repo.create_snapshot`，危险写操作 |
| repo | `POST /api/repo/tagSnapshot` | `id` 必填；`name` 可选但服务端会拒绝空标签 | 标准 Ret；失败时可能带 `data.closeTimeout` | 需认证 + 管理员角色；只读禁止 | 建议新增 `repo.tag_snapshot`，写操作 |
| repo | `POST /api/repo/checkoutRepo` | `id` 必填 | 标准 Ret；实际恢复异步触发 | 需认证 + 管理员角色；只读禁止 | 建议新增 `repo.checkout_snapshot`，高危整库回滚 |
| repo | `POST /api/repo/getRepoSnapshots` | `page` 可选，前端从 1 开始 | `snapshots`、`pageCount`、`totalCount` | 需认证 + 管理员角色；只读可调用 | 建议新增 `repo.list_snapshots` |
| repo | `POST /api/repo/getRepoTagSnapshots` | 无 | `snapshots` | 需认证 + 管理员角色；只读可调用 | 建议新增 `repo.list_tag_snapshots` |
| repo | `POST /api/repo/removeRepoTagSnapshot` | `tag` 必填 | 标准 Ret | 需认证 + 管理员角色；只读禁止 | 建议新增 `repo.remove_tag_snapshot`，写操作 |
| repo | `POST /api/repo/getCloudRepoSnapshots` | `page` 可选，前端从 1 开始 | `snapshots`、`pageCount`、`totalCount` | 需认证 + 管理员角色；只读可调用；依赖同步提供商与订阅/付费状态 | 建议新增 `repo.list_cloud_snapshots` |
| repo | `POST /api/repo/getCloudRepoTagSnapshots` | 无 | `snapshots` | 需认证 + 管理员角色；只读可调用；依赖同步提供商与订阅/付费状态 | 建议新增 `repo.list_cloud_tag_snapshots` |
| repo | `POST /api/repo/removeCloudRepoTagSnapshot` | `tag` 必填 | 标准 Ret | 需认证 + 管理员角色；只读禁止；依赖同步提供商与订阅/付费状态 | 建议新增 `repo.remove_cloud_tag_snapshot`，写操作 |
| repo | `POST /api/repo/uploadCloudSnapshot` | `id` 必填；`tag` 可选 | 标准 Ret；通过状态栏/进度推送上传进度 | 需认证 + 管理员角色；只读禁止；依赖同步提供商与订阅/付费状态 | 建议新增 `repo.upload_cloud_snapshot`，写操作 |
| repo | `POST /api/repo/downloadCloudSnapshot` | `id` 必填；`tag` 可选 | 标准 Ret；通过状态栏/进度推送下载进度 | 需认证 + 管理员角色；只读禁止；依赖同步提供商与订阅/付费状态 | 建议新增 `repo.download_cloud_snapshot`，写操作 |
| repo | `POST /api/repo/diffRepoSnapshots` | `left` 必填；`right` 必填 | `addsLeft`、`updatesLeft`、`updatesRight`、`removesRight`、`left`、`right` | 需认证 + 管理员角色；只读可调用 | 建议新增 `repo.diff_snapshots` |
| repo | `POST /api/repo/openRepoSnapshotFile` | `id` 必填，值为 diff 返回的 `fileID` | `title`、`content`、`displayInText`、`updated` | 需认证 + 管理员角色；只读可调用 | 建议新增 `repo.open_snapshot_file` |
| repo | `POST /api/repo/rollbackRepoSnapshotFile` | `id` 必填，值为 diff 返回的 `fileID` | 标准 Ret | 需认证 + 管理员角色；路由未加 `CheckReadonly`，但会实际写回文件 | 建议新增 `repo.rollback_snapshot_file`，高危单文件回滚 |

### 数据结构备注

| 名称 | 字段 | 说明 |
|------|------|------|
| 本地快照条目 | `id`、`memo`、`hCreated`、`count`、`hSize`、`systemID`、`systemName`、`systemOS`、`tag`、`typesCount` 等 | `getRepoSnapshots` 与 `getRepoTagSnapshots` 返回 `model.Snapshot`，内嵌 dejavu log；服务端会清空大体积 `files` 字段，并额外统计 `typesCount` |
| 云端快照条目 | dejavu log 字段，如 `id`、`created`、`memo`、`tag` 等 | `getCloudRepoSnapshots` 与 `getCloudRepoTagSnapshots` 直接返回云端 log；字段形态由 dejavu/cloud 实现决定 |
| 快照 diff 文件 | `fileID`、`title`、`path`、`hSize`、`updated` | `fileID` 用于继续调用 `openRepoSnapshotFile` 或 `rollbackRepoSnapshotFile` |
| 快照 diff 索引 | `id`、`created` | `diffRepoSnapshots` 返回的 `left` / `right` 为对比两侧快照索引摘要 |
| 快照文件内容 | `title`、`content`、`displayInText`、`updated` | `.sy` 文档会渲染为块 DOM 或格式化文本；普通文本直接返回内容；可显示资源可能返回临时 `repo/diff/...` 路径 |
| Snapshot AV 渲染结果 | `name`、`id`、`viewType`、`viewID`、`views`、`view`、`isMirror` | 只读取快照里的数据库视图；服务端当前只显式读取 `id` 和 `snapshot`，前端仍会传 `pageSize`、`groupPaging`、`viewID`、`query` 等普通渲染参数 |

### 前端工作流对应关系

| 场景 | 调用顺序 |
|------|----------|
| 创建本地快照 | `createSnapshot({ memo })` 后刷新 `getRepoSnapshots({ page: 1 })` |
| 标记本地快照 | `tagSnapshot({ id, name })`，可选继续 `uploadCloudSnapshot({ id, tag: name })` |
| 上传已标记快照 | `uploadCloudSnapshot({ id, tag })` |
| 下载云端快照 | `downloadCloudSnapshot({ id, tag })`；云端普通快照 `tag` 为空 |
| 下载并整库回滚 | `downloadCloudSnapshot({ id, tag })` 成功后调用 `checkoutRepo({ id })` |
| 对比本地快照 | `diffRepoSnapshots({ left, right })`，再用 diff 文件的 `fileID` 调 `openRepoSnapshotFile({ id: fileID })` |
| 回滚快照单文件 | 从 `diffRepoSnapshots` 取得 `fileID` 后调用 `rollbackRepoSnapshotFile({ id: fileID })` |
| 渲染快照中的数据库 | 文档历史/快照浏览时，数据库块调用 `renderSnapshotAttributeView({ id: avID, snapshot })` |

### 实现注意事项

- 数据快照功能依赖仓库密钥 `Conf.Repo.Key`，未初始化时多数接口返回错误。
- 云端快照接口依赖当前同步提供商；官方云需要订阅，WebDAV/S3/本地提供商需要付费用户状态。
- `checkoutRepo` 是整库恢复，`rollbackRepoSnapshotFile` 是单文件恢复，二者都应在 MCP 层标记为危险动作并要求显式确认。
- `rollbackRepoSnapshotFile` 的路由当前没有 `CheckReadonly`，但其模型层会写回工作区文件；MCP 封装时应按写操作处理。
- `renderSnapshotAttributeView` 目前在服务端只消费 `id` 与 `snapshot`，不像普通 `renderAttributeView` 那样处理分页、筛选和视图参数；如果要暴露给 MCP，应在帮助文档中说明该限制。
