# SiYuan API 与 MCP 映射说明

本文档用于记录：本插件如何把思源的 HTTP API 映射为 MCP 的聚合 tool / action，包括默认端口、认证方式、权限规则、确认规则，以及每个 action 对应的实际接口。

## 总览

### 思源 HTTP API

- 默认地址：`http://127.0.0.1:6806`
- 默认端口：`6806`
- 常见接口形式：`POST /api/<模块>/<方法>`
- 存在 token 时的认证头：
  - `Authorization: Token <token>`

### 本插件暴露的 MCP 工具

- `notebook`
- `document`
- `block`
- `file`
- `search`
- `tag`
- `system`
- `flashcard`
- `av` (数据库/属性视图)
- `mascot`

### 关键源码位置

- 思源 HTTP 客户端：`src/api/client.ts`
- MCP 服务入口：`src/core/server.ts`
- tool / action 配置：`src/core/config.ts`
- action 参数校验：`src/core/types.ts`
- MCP tool 处理器：`src/tools/`
- HTTP wrapper：`src/api/`

## 运行时入口

### 思源侧接口入口

- 基础 URL：`http://127.0.0.1:6806`
- token 获取：
  - `POST /api/system/getApiToken`
- 插件配置读写：
  - `POST /api/file/getFile`
  - `POST /api/file/putFile`

### 插件自身持久化位置

- MCP 工具配置：
  - `/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig`
- 笔记本权限存储：
  - plugin storage key：`notebookPermissions`

## 权限与确认规则

### 笔记本权限模型

- `rwd`：允许读写删
- `rw`：允许读写，不允许删除
- `r`：只允许读
- `none`：禁止读写删

### 需要用户显式确认的高危 action

- `notebook(action="remove")`
- `notebook(action="set_permission")`
- `document(action="remove")`
- `document(action="move")`
- `block(action="delete")`
- `block(action="move")`
- `tag(action="remove")`
- `flashcard(action="remove_card")`
- `file(action="upload_asset")`
- `file(action="remove_unused_assets")`
- `file(action="delete_asset")`
- `system(action="workspace_info")`
- `search(action="find_replace")`

### 只读工具

- `system` 设计为只读工具

## 映射表

## `notebook`

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `list` | `POST /api/notebook/lsNotebooks` | `src/api/notebook.ts` | 列出所有笔记本 |
| `create` | `POST /api/notebook/createNotebook` | `src/api/notebook.ts` | 支持额外传 `icon`，图标通过第二次调用设置 |
| `set_open_state` | `POST /api/notebook/openNotebook` / `POST /api/notebook/closeNotebook` | `src/api/notebook.ts` | 需要笔记本读权限；`opened: true` 打开，`opened: false` 关闭 |
| `remove` | `POST /api/notebook/removeNotebook` | `src/api/notebook.ts` | 需要确认，且需要删除权限（`rwd`） |
| `rename` | `POST /api/notebook/renameNotebook` | `src/api/notebook.ts` | 需要写权限（`rw` / `rwd`） |
| `get_conf` | `POST /api/notebook/getNotebookConf` | `src/api/notebook.ts` | 需要读权限 |
| `set_conf` | `POST /api/notebook/setNotebookConf` | `src/api/notebook.ts` | 需要写权限（`rw` / `rwd`） |
| `set_icon` | `POST /api/notebook/setNotebookIcon` | `src/api/notebook.ts` | 需要写权限（`rw` / `rwd`） |
| `get_permissions` | 插件本地逻辑 | `src/tools/notebook/index.ts` | 读取插件维护的权限状态 |
| `set_permission` | 插件本地逻辑 | `src/tools/notebook/index.ts` | 写入插件维护的权限状态 |
| `get_child_docs` | `POST /api/filetree/listDocsByPath` | `src/api/document.ts` | 固定读取笔记本根目录 `/`，并先校验笔记本存在性以返回更明确错误 |

## `document`

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `create` | `POST /api/filetree/createDocWithMd` | `src/api/document.ts` | 使用人类可读路径 |
| `rename` | `POST /api/filetree/renameDoc` / `POST /api/filetree/renameDocByID` | `src/api/document.ts` | 支持路径模式和 ID 模式 |
| `remove` | `POST /api/filetree/removeDoc` / `POST /api/filetree/removeDocByID` | `src/api/document.ts` | 需要确认 |
| `move` | `POST /api/filetree/moveDocs` / `POST /api/filetree/moveDocsByID` | `src/api/document.ts` | 需要确认 |
| `reorder` | `POST /api/filetree/listDocsByPath` + `POST /api/filetree/changeSort` + `POST /api/notebook/setNotebookConf` | `src/api/document.ts` | 完整重排可见直属子文档，并将 `sortMode` 设为 `6`；`fs.reorder` 共用该实现 |
| `lookup` | `POST /api/filetree/getPathByID` / `POST /api/filetree/getHPathByID` / `POST /api/filetree/getHPathByPath` / `POST /api/filetree/getIDsByHPath` | `src/api/document.ts` | 解析 ID、存储路径、人类可读路径和文档信息 |
| `get_child_blocks` | `POST /api/block/getChildBlocks` | `src/api/block.ts` | 使用解析后的根文档 ID |
| `get_child_docs` | `POST /api/filetree/listDocsByPath` | `src/api/document.ts` | 使用解析后的笔记本 + 存储路径 |
| `set_attr` | `POST /api/attr/setBlockAttrs` | `src/api/block.ts` | 给文档块写入元数据属性 |
| `list_tree` | `POST /api/filetree/listDocTree` | `src/api/document.ts` | 获取嵌套文档树 |
| `search_docs` | `POST /api/filetree/searchDocs` | `src/api/document.ts` | 思源原生是全局标题搜索 |
| `get_doc` | `POST /api/filetree/getDoc` | `src/api/document.ts` | 获取文档内容和元数据 |
| `get_outline` | `POST /api/outline/getDocOutline` | `src/api/document.ts` | 获取原生标题树，不读取正文 |
| `create_daily_note` | `POST /api/filetree/createDailyNote` | `src/api/document.ts` | 创建或返回今日日记 |
| `duplicate` | `POST /api/filetree/duplicateDoc` | `src/api/document.ts` | 复制已有文档 |
| `heading_to_doc` | `POST /api/filetree/heading2Doc` | `src/api/document.ts` | 将标题块转换为文档 |
| `doc_to_heading` | `POST /api/filetree/doc2Heading` | `src/api/document.ts` | 将文档转换为目标文档下的标题 |

### 路径语义

- 人类可读路径示例：
  - `/Inbox/Weekly Note`
- 存储路径示例：
  - `/20240318112233-abc123.sy`

### 使用人类可读路径的 action

- `document(action="create")`
- `document(action="lookup", hpath=...)`

### 使用存储路径的 action

- `document(action="rename", notebook + path)`
- `document(action="remove", notebook + path)`
- `document(action="move", fromPaths + toNotebook + toPath)`
- `document(action="reorder", parentID + orderedIDs)`（ID 入口，内部解析直属子文档存储路径）
- `document(action="lookup", notebook + path)`
- `document(action="list_tree", notebook + path)`

## `block`

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `insert` | `POST /api/block/insertBlock` | `src/api/block.ts` | 按位置插入；MCP 层返回精简块结果 |
| `prepend` | `POST /api/block/prependBlock` | `src/api/block.ts` | 在父块/文档头部插入；MCP 层返回精简块结果 |
| `append` | `POST /api/block/appendBlock` | `src/api/block.ts` | 在父块/文档尾部插入；MCP 层返回精简块结果 |
| `update` | `POST /api/block/updateBlock` | `src/api/block.ts` | 更新块内容 |
| `delete` | `POST /api/block/deleteBlock` | `src/api/block.ts` | 需要确认 |
| `move` | `POST /api/block/moveBlock` | `src/api/block.ts` | 需要确认 |
| `set_fold_state` | `POST /api/block/foldBlock` / `POST /api/block/unfoldBlock` | `src/api/block.ts` | `folded: true` 折叠，`folded: false` 展开；仅适用于可折叠块 |
| `get_kramdown` | `POST /api/block/getBlockKramdown` | `src/api/block.ts` | 只读 |
| `batch_kramdown` | `POST /api/block/getBlockKramdowns` | `src/api/block.ts` | 最多 20 个 ID；逐项解析权限并按输入顺序返回内容或错误 |
| `get_children` | `POST /api/block/getChildBlocks` | `src/api/block.ts` | 只读 |
| `transfer_references` | `POST /api/block/transferBlockRef` | `src/api/block.ts` | 写操作 |
| `set_attrs` | `POST /api/attr/setBlockAttrs` | `src/api/block.ts` | 设置块属性 |
| `get_attrs` | `POST /api/attr/getBlockAttrs` | `src/api/block.ts` | 读取块属性 |
| `info` | `POST /api/block/getBlockInfo` | `src/api/block.ts` | 获取块所在根文档信息 |
| `breadcrumb` | `POST /api/block/getBlockBreadcrumb` | `src/api/block.ts` | 获取面包屑路径 |
| `dom` | `POST /api/block/getBlockDOM` | `src/api/block.ts` | 获取渲染后的 DOM |
| `recent_updated` | `POST /api/block/getRecentUpdatedBlocks` | `src/api/block.ts` | 工作区级最近更新 |
| `word_count` | `POST /api/block/getBlocksWordCount` | `src/api/block.ts` | 返回字数统计结构 |
| `add_to_daily_note` | `POST /api/block/appendDailyNoteBlock` / `POST /api/block/prependDailyNoteBlock` | `src/api/block.ts` | 创建或打开今日日记后追加或前插块 |
| `docs_info` | `POST /api/block/getDocsInfo` | `src/api/block.ts` | 批量获取文档信息，可选 `refCount` / `av` |

## `file`

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `upload_asset` | `POST /api/asset/upload` | `src/api/file.ts` | 读取本地文件路径后以 multipart 上传（高危，需先确认；若文件超过配置阈值，默认 `10 MB`，必须先中止并获得用户确认，再携带 `confirmLargeFile=true` 重试） |
| `list_templates` | `POST /api/search/searchTemplate` | `src/api/template.ts` | 搜索/列出 `data/templates` 下的 Markdown 模板，并返回可复用读取/渲染参数 |
| `read_template` | `GET /templates/...` | `src/api/template.ts` | 通过思源认证静态路由只读模板 Markdown 源码，不走 `/api/file/getFile` |
| `create_template` | `POST /api/file/putFile` | `src/api/template.ts` + `src/api/client.ts` | 通过工作区文件 API 创建 Markdown 模板；默认不覆盖已存在模板 |
| `update_template` | `POST /api/search/searchTemplate` + `POST /api/file/putFile` | `src/api/template.ts` + `src/api/client.ts` | 先确认模板存在，再完整替换 Markdown 源码 |
| `delete_template` | `POST /api/search/searchTemplate` + `POST /api/search/removeTemplate` | `src/api/template.ts` | 先解析为思源模板选择器返回的路径，再删除；危险 action，默认关闭 |
| `save_doc_as_template` | `POST /api/template/docSaveAsTemplate` | `src/api/template.ts` | 将已有文档另存为根模板，调用前检查文档读权限 |
| `render` | `POST /api/template/render` / `POST /api/template/renderSprig` | `src/api/template.ts` | 通过 `engine` 选择模板文件或 Sprig 内联渲染；模板模式支持 `preview` |
| `export_md` | `POST /api/export/exportMdContent` | `src/api/file.ts` | 需要可读文档 ID |
| `export_resources` | `POST /api/export/exportResources` | `src/api/file.ts` | 将 `assets/...` 规范化为 `data/assets/...` 后导出；若传 `outputPath`，再把 ZIP 复制到本地文件系统（高危，需先确认） |
| `list_unused_assets` | `POST /api/asset/getUnusedAssets` | `src/api/file.ts` | 列出未使用资源 |
| `get_doc_assets` | `POST /api/asset/getDocAssets` / `POST /api/asset/getDocImageAssets` | `src/api/file.ts` | 列出文档引用的资源；`assetType: "all"`（默认）或 `"image"` |
| `get_image_ocr_text` | `POST /api/asset/getImageOCRText` | `src/api/file.ts` | 获取图片资源的 OCR 文本 |
| `remove_unused_assets` | `POST /api/asset/removeUnusedAssets` | `src/api/file.ts` | 删除所有未使用资源，需要确认 |
| `rename_asset` | `POST /api/asset/renameAsset` | `src/api/file.ts` | 重命名资源 |
| `delete_asset` | `POST /api/asset/deleteAsset` | `src/api/file.ts` | 删除指定资源，需要确认；兼容性 action，是否可用取决于目标 SiYuan 内核版本 |
| `extract_doc` | `POST /api/export/exportMdContent` + `POST /api/file/getFile` | `src/api/file.ts` + `src/api/client.ts` | 导出文档 markdown 和所有引用资源到自包含的未压缩文件夹，保留原始文件名，AI 可直接读取 |

## `search`

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `fulltext` | `POST /api/search/fullTextSearchBlock` | `src/api/search.ts` | 全文块搜索 |
| `query_sql` | `POST /api/query/sql` | `src/api/search.ts` | MCP 侧限制为 `SELECT` |
| `get_backlinks` | `POST /api/ref/getBacklinkDoc` | `src/api/search.ts` | 只读 |
| `search_refs` | `POST /api/search/searchRefBlock` | `src/api/search.ts` | 搜索引用指定块/文档的块 |
| `find_replace` | `POST /api/search/findReplace` | `src/api/search.ts` | 查找替换，需要确认 |
| `search_assets` | `POST /api/search/searchAsset` | `src/api/search.ts` | 按文件名搜索资源 |
| `fulltext_asset_content` | `POST /api/search/fullTextSearchAssetContent` | `src/api/search.ts` | 全文搜索资源内容索引 |
| `list_invalid_refs` | `POST /api/search/listInvalidBlockRefs` | `src/api/search.ts` | 列出无效块引用 |

## `tag`

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `list` | `POST /api/tag/getTag` | `src/api/tag.ts` | 工作区范围标签列表 |
| `rename` | `POST /api/tag/renameTag` | `src/api/tag.ts` | 全局重命名标签 |
| `remove` | `POST /api/tag/removeTag` | `src/api/tag.ts` | 需要确认 |

## `system`

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `workspace_info` | `POST /api/system/getWorkspaceInfo` | `src/api/system.ts` | 只读 |
| `network` | `POST /api/system/getNetwork` | `src/api/system.ts` | 返回脱敏代理信息 |
| `conf` | `POST /api/system/getConf` | `src/api/system.ts` | 返回脱敏配置 |
| `notify` | `POST /api/notification/pushMsg` / `POST /api/notification/pushErrMsg` | `src/api/notification.ts` / `src/tools/system/index.ts` | 根据 `level` 推送普通或错误通知 |
| `changelog` | 内置 `CHANGELOG.md` | `src/core/changelog.ts` / `src/tools/system/index.ts` | 读取插件更新日志，并返回可能影响个性化设置的结构化提示 |
| `get_version` | `POST /api/system/version` | `src/api/system.ts` / `src/tools/system/index.ts` | 只读 |
| `get_current_time` | `POST /api/system/currentTime` | `src/api/system.ts` / `src/tools/system/index.ts` | 只读 |

## `flashcard`

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `list_cards` | `POST /api/riff/getRiffDueCards` / `POST /api/riff/getNotebookRiffDueCards` / `POST /api/riff/getTreeRiffDueCards` | `src/api/riff.ts` | 列出待复习闪卡，支持工作区/笔记本/文档树范围 |
| `get_decks` | `POST /api/riff/getRiffDecks` | `src/api/riff.ts` | 获取所有闪卡 deck |
| `get_cards` | `POST /api/riff/getRiffCards` | `src/api/riff.ts` | 获取闪卡列表 |
| `review_card` | `POST /api/riff/reviewRiffCard` | `src/api/riff.ts` | 复习闪卡，需传评分(rating) |
| `create_card` | `POST /api/attr/setBlockAttrs` + `POST /api/riff/addRiffCards` | `src/api/block.ts` + `src/api/flashcard.ts` | 将块正式转为闪卡：先写 `custom-riff-decks`，再注册 riff 卡片 |
| `remove_card` | `POST /api/riff/removeRiffCards` | `src/api/riff.ts` | 移除闪卡，需要确认 |

## `av` (Attribute View / 数据库)

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `get` | `POST /api/av/getAttributeView` | `src/api/av.ts` | 获取属性视图详情 |
| `render` | `POST /api/av/renderAttributeView` | `src/api/av.ts` | 渲染属性视图 |
| `get_attribute_view_keys` | `POST /api/av/getAttributeViewKeys` | `src/api/av.ts` | 获取属性视图键列表 |
| `get_attribute_view_filter_sort` | `POST /api/av/getAttributeViewFilterSort` | `src/api/av.ts` | 获取属性视图过滤排序条件 |
| `search` | `POST /api/av/searchAttributeView` | `src/api/av.ts` | 搜索属性视图 |
| `add_rows` | `POST /api/av/addAttributeViewBlocks` | `src/api/av.ts` | 添加行（绑定已有块或纯文本 detached 主键） |
| `remove_rows` | `POST /api/av/removeAttributeViewBlocks` | `src/api/av.ts` | 移除行 |
| `add_column` | `POST /api/av/addAttributeViewKey` | `src/api/av.ts` | 添加列/字段 |
| `remove_column` | `POST /api/av/removeAttributeViewKey` | `src/api/av.ts` | 移除列/字段 |
| `set_cells` | `POST /api/av/setAttributeViewBlockAttr` / `POST /api/av/batchSetAttributeViewBlockAttrs` | `src/api/av.ts` | 设置一个或多个单元格值 |
| `duplicate` | `POST /api/av/duplicateAttributeView` / `POST /api/av/duplicateAttributeViewBlock` | `src/api/av.ts` | 复制属性视图定义，可按上下文实体化数据库块 |
| `get_primary_key_values` | `POST /api/av/getAttributeViewPrimaryKeyValues` | `src/api/av.ts` | 获取主键值列表(用于relation字段) |

## `mascot`

| MCP action | 思源 HTTP API | Wrapper | 说明 |
|---|---|---|---|
| `get_balance` | 本地状态 (`puppy_stats`) | `src/core/puppy-state.ts` | 获取吉祥物金币余额和统计 |
| `shop` | 本地常量 | `src/tools/mascot/index.ts` | 获取商店物品列表 |
| `buy` | 本地状态更新 | `src/core/puppy-state.ts` | 购买商店物品 |

**说明**: mascot tool 使用本地状态管理，不直接调用思源 HTTP API。每次 MCP 工具调用会自动获得 1 个金币奖励。

## MCP 参数形态

### 通用规则

- 每个 tool 都必须带 `action`
- 当前设计是"聚合 tool + action 分发"，不是"一条 HTTP API 对应一个 MCP tool"
- 参数校验定义在 `src/core/types.ts`

### 重要形态示例

#### `document(action="rename")`

- ID 模式：
  - `id`
  - `title`
- 路径模式：
  - `notebook`
  - `path`
  - `title`

#### `document(action="move")`

- ID 模式：
  - `fromIDs`
  - `toID`
- 路径模式：
  - `fromPaths`
  - `toNotebook`
  - `toPath`

说明：

- `fromPaths` / `toPath` 都是存储路径
- `toPath` 必须指向一个已存在的目标文档
- 不支持把 `toPath` 写成不存在的 `.sy` 路径或纯目录路径

#### `block(action="move")`

- 必填：
  - `id`
- 目标位置：
  - `previousID`，或
  - `parentID`，或
  - 两者同时提供

返回：

- MCP 成功时返回结构化对象，不再透传底层思源 API 的 `null`

## 覆盖范围说明

- 本文档记录的是"当前已经接入 MCP 的思源 API"
- 并未枚举思源 `kernel/api/` 下全部接口
- 未接入接口可参考上游源码：
  - `https://github.com/siyuan-note/siyuan/tree/master/kernel/api`

---

## 未覆盖 API 清单

> **更新时间**: 2026-07-28
> **扫描范围**: SiYuan Kernel API (459个端点) 与 MCP Tools (117个actions) 对比
> **整体覆盖率**: 25.9% (119/459)

### 覆盖率统计概览

| 模块 | 总数 | 已覆盖 | 未覆盖 | 覆盖率 |
|------|------|--------|--------|--------|
| notebook | 11 | 9 | 2 | ████████░░ 81.8% |
| filetree | 34 | 21 | 13 | ██████░░░░ 61.8% |
| block | 54 | 24 | 30 | ████░░░░░░ 44.4% |
| av | 35 | 13 | 22 | █████░░░░░ 37.1% |
| system | 46 | 10 | 36 | ██░░░░░░░░ 21.7% |
| search | 14 | 8 | 6 | ██████░░░░ 57.1% |
| asset | 19 | 7 | 12 | ██████░░░░ 36.8% |
| export | 31 | 2 | 29 | ░░░░░░░░░░ 6.5% |
| riff | 17 | 9 | 8 | █████░░░░░ 52.9% |
| history | 10 | 0 | 10 | ░░░░░░░░░░ 0.0% |
| setting | 23 | 0 | 23 | ░░░░░░░░░░ 0.0% |
| bazaar | 23 | 0 | 23 | ░░░░░░░░░░ 0.0% |
| repo | 23 | 0 | 23 | ░░░░░░░░░░ 0.0% |
| sync | 21 | 0 | 21 | ░░░░░░░░░░ 0.0% |
| storage | 15 | 0 | 15 | ░░░░░░░░░░ 0.0% |
| file | 8 | 0 | 8 | ░░░░░░░░░░ 0.0% |
| attr | 6 | 2 | 4 | ███░░░░░░░ 33.3% |
| ref | 5 | 2 | 3 | ████░░░░░░ 40.0% |
| outline | 1 | 1 | 0 | ██████████ 100.0% |
| tag | 3 | 3 | 0 | ██████████ 100.0% |
| notification | 2 | 2 | 0 | ██████████ 100.0% |
| **总计** | **459** | **119** | **340** | █████░░░░░ 25.9% |

### 已补齐的高优先级 API (核心功能)

#### 1. Search 模块 (当前57.1%覆盖)

| API 路径 | MCP action | 说明 | 状态 |
|----------|------------|------|------|
| `POST /api/search/searchRefBlock` | `search_refs` | 搜索引用块 | 已接入 |
| `POST /api/search/findReplace` | `find_replace` | 查找替换，需要确认 | 已接入 |
| `POST /api/search/searchAsset` | `search_assets` | 搜索资源文件 | 已接入 |
| `POST /api/search/getAssetContent` | - | 获取单个资源内容 | 未作为当前 action 暴露 |
| `POST /api/search/fullTextSearchAssetContent` | `fulltext_asset_content` | 全文搜索资源内容 | 已接入 |
| `POST /api/search/listInvalidBlockRefs` | `list_invalid_refs` | 列出无效块引用 | 已接入 |

#### 2. Block 批量操作 (当前42.6%覆盖)

| API 路径 | MCP action | 说明 | 状态 |
|----------|------------|------|------|
| `POST /api/block/batchInsertBlock` | - | 批量插入块 | 未作为当前 action 暴露 |
| `POST /api/block/batchUpdateBlock` | - | 批量更新块 | 未作为当前 action 暴露 |
| `POST /api/block/appendDailyNoteBlock` | `add_to_daily_note` | 追加到日记 | 已接入 |
| `POST /api/block/prependDailyNoteBlock` | `add_to_daily_note` | 前置插入日记 | 已接入 |
| `POST /api/block/getDocInfo` | - | 获取单个文档信息 | 未作为当前 action 暴露 |
| `POST /api/block/getDocsInfo` | `docs_info` | 批量获取文档信息 | 已接入 |

#### 3. Document/文件树增强 (当前61.8%覆盖)

| API 路径 | MCP action | 说明 | 状态 |
|----------|------------|------|------|
| `POST /api/filetree/duplicateDoc` | `duplicate` | 复制文档 | 已接入 |
| `POST /api/filetree/removeDocs` | - | 批量删除文档 | 未作为当前 action 暴露 |
| `POST /api/filetree/createDoc` | `create` | 创建空文档（parentPath + title 模式） | 已接入 |
| `POST /api/filetree/heading2Doc` | `heading_to_doc` | 标题转为文档 | 已接入 |
| `POST /api/filetree/doc2Heading` | `doc_to_heading` | 文档转为标题 | 已接入 |

#### 4. Asset 资源管理 (当前36.8%覆盖，映射到 `file` tool)

| API 路径 | MCP action | 说明 | 状态 |
|----------|------------|------|------|
| `POST /api/asset/getUnusedAssets` | `list_unused_assets` | 获取未使用资源 | 已接入 |
| `POST /api/asset/removeUnusedAssets` | `remove_unused_assets` | 删除未使用资源，需要确认 | 已接入 |
| `POST /api/asset/renameAsset` | `rename_asset` | 重命名资源 | 已接入 |
| `POST /api/asset/getImageOCRText` | `get_image_ocr_text` | 获取图片 OCR 文本 | 已接入 |

补充：

- `delete_asset`

说明：

- `delete_asset` 已在插件中实现为兼容性扩展，但未出现在本次上游 Kernel 459 个端点扫描结果中，因此未纳入本节覆盖率统计

### 中优先级 (扩展功能)

#### History 历史版本 (当前0%覆盖)

建议新增 `history` tool：

| API 路径 | 说明 |
|----------|------|
| `POST /api/history/getDocHistoryContent` | 获取文档历史内容 |
| `POST /api/history/rollbackDocHistory` | 回滚文档历史 |
| `POST /api/history/getNotebookHistory` | 获取笔记本历史 |
| `POST /api/history/rollbackNotebookHistory` | 回滚笔记本历史 |
| `POST /api/history/searchHistory` | 搜索历史 |
| `POST /api/history/getHistoryItems` | 获取历史条目 |

#### Export 导出增强 (当前6.5%覆盖)

建议扩展现有 `file` tool：

| API 路径 | 说明 |
|----------|------|
| `POST /api/export/exportDocx` | 导出 Word |
| `POST /api/export/exportPDF` | 导出 PDF |
| `POST /api/export/exportHTML` | 导出 HTML |
| `POST /api/export/exportNotebook` | 导出笔记本 |
| `POST /api/export/preview` | 导出预览 |

#### AV 数据库高级功能 (当前37.1%覆盖)

当前已覆盖基础CRUD，以下功能待扩展：

- **视图操作**: 创建/删除/切换视图
- **过滤器**: 设置/修改过滤器
- **排序**: 多列排序设置
- **分组**: 分组设置
- **Rollup**: 计算列配置
- **模板列**: 模板配置

### 低优先级/暂不覆盖

#### System 管理类 (安全敏感)

| API 路径 | 不覆盖原因 |
|----------|------------|
| `POST /api/system/setAPIToken` | 安全敏感 |
| `POST /api/system/setAccessAuthCode` | 安全敏感 |
| `POST /api/system/setNetworkServe` | 安全敏感 |
| `POST /api/system/setWorkspaceDir` | 安全敏感 |
| `POST /api/system/createWorkspaceDir` | 管理功能 |
| `POST /api/system/removeWorkspaceDir` | 安全敏感 |
| `POST /api/system/exit` | 安全敏感 |
| `POST /api/system/rebuildDataIndex` | 维护功能 |
| `POST /api/system/vacuumDataIndex` | 维护功能 |

#### Bazaar 集市 (当前0%覆盖)

暂不覆盖原因：插件管理通常通过UI操作

#### Sync/Repo 同步 (部分覆盖)

已覆盖：

- `POST /api/sync/performSync` → `system.perform_sync`

其余同步配置类 API 暂不覆盖：数据同步配置通常通过 UI 操作，且涉及敏感配置。

### 已完全覆盖的模块

| 模块 | 覆盖率 | 说明 |
|------|--------|------|
| tag | 100% (3/3) | 完整支持 |
| notification | 100% (2/2) | 完整支持 (合并到 system) |
| query | 100% (1/1) | 完整支持 (SQL查询) |

### 建议新增 MCP Tools

基于未覆盖API分析：

| 建议Tool名称 | 包含Actions | 优先级 | 预估工作量 |
|-------------|-------------|--------|-----------|
| `history` | get_doc_history, rollback_doc, search_history | 中 | 2-3天 |
| `bookmark` | list, rename, remove | 低 | 0.5天 |
| `inbox` | get, add | 低 | 0.5天 |
| `export` | export_pdf, export_docx, export_html | 中 | 1-2天 |

---

**注**: 本文档基于 SiYuan Kernel 源码自动扫描生成，统计信息：
- 扫描时间: 2026-04-18
- SiYuan API总数: 459个端点
- 已覆盖API: 117个端点
- MCP Tools: 10个
- MCP Actions: 115个
