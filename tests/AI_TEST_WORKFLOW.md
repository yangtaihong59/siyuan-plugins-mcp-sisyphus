# SiYuan MCP Sisyphus — AI 功能测试流程

> **本文件供 AI 自动执行。** 按照编号顺序逐步调用 MCP 工具，验证所有功能是否正常。
> 每一步包含：目标、精确调用参数、预期响应、通过/失败判定、需要记录的变量。

---

## 前置条件检查

在开始之前确认：
- SiYuan 笔记本正在运行
- MCP 服务已连接（能调用工具）
- 至少有一个已打开的笔记本

**如任何前置条件不满足，停止测试并报告失败原因。**

---

## 状态追踪表

在执行过程中，将以下变量记录在内存中，后续步骤会引用它们：

| 变量名 | 说明 | 由哪步赋值 |
|--------|------|-----------|
| `$TEST_NB_ID` | 测试笔记本 ID | 步骤 2.1 |
| `$TEST_NB_NAME` | 测试笔记本名称 | 步骤 2.1 |
| `$DOC_ID_1` | 主测试文档 ID | 步骤 3.1 |
| `$DOC_ID_2` | 子文档 ID | 步骤 3.2 |
| `$BLOCK_ID_1` | 第一个测试块 ID | 步骤 4.1 |
| `$BLOCK_ID_2` | 第二个测试块 ID | 步骤 4.2 |
| `$HEADING_BLOCK_ID` | 标题块 ID | 步骤 4.3 |
| `$TAGGED_BLOCK_ID` | 有标签的块 ID | 步骤 4.4 |
| `$AV_BLOCK_ID` | 数据库块 ID | 步骤 9.1 |
| `$AV_ID` | 属性视图 ID | 步骤 9.1 |
| `$AV_PRIMARY_KEY_ID` | 主键列 ID | 步骤 9.3 |
| `$AV_DUPLICATE_BLOCK_ID` | 复制的数据库块 ID | 步骤 9.13 |
| `$CARD_BLOCK_ID` | 闪卡块 ID | 步骤 8.1 |
| `$REVIEW_CARD_ID` | 用于复习的闪卡 ID | 步骤 8.8 |
| `$DOC_ID_EMPTY` | 空测试文档 ID | 步骤 3.18 |

---

## 第 1 节：System（系统信息）

目标：验证 MCP 与 SiYuan 的基础连接和系统接口。

### 步骤 1.1 — 获取版本

**调用：**
```json
{
  "tool": "system",
  "action": "get_version"
}
```

**通过条件：** 响应包含 `version` 字段，值类似 `"3.x.x"`。

---

### 步骤 1.2 — 获取工作空间信息

**调用：**
```json
{
  "tool": "system",
  "action": "workspace_info"
}
```

**通过条件：** 响应包含 `workspaceDir`（非空字符串）。

---

### 步骤 1.3 — 获取当前时间

**调用：**
```json
{
  "tool": "system",
  "action": "get_current_time"
}
```

**通过条件：** 响应包含时间戳或时间字符串。

---

### 步骤 1.4 — 获取启动进度

**调用：**
```json
{
  "tool": "system",
  "action": "boot_progress"
}
```

**通过条件：** 响应包含 `progress` 字段，值为 100（完全启动）。

---

### 步骤 1.5 — 推送测试通知

**调用：**
```json
{
  "tool": "system",
  "action": "push_msg",
  "msg": "MCP 测试流程已开始 🚀",
  "timeout": 3000
}
```

**通过条件：** 调用成功（无错误），SiYuan 界面应短暂显示通知。

---

### 步骤 1.6 — 查询系统配置摘要

**调用：**
```json
{
  "tool": "system",
  "action": "conf",
  "mode": "summary"
}
```

**通过条件：** 响应包含配置树的摘要，含已知顶层键（如 `appearance`、`editor` 等）。

---

### 步骤 1.7 — 按路径读取配置项

**调用：**
```json
{
  "tool": "system",
  "action": "conf",
  "mode": "get",
  "keyPath": "conf.appearance.mode"
}
```

**通过条件：** 响应返回 `0`（浅色）或 `1`（深色）等数字值，无报错。

---

### 步骤 1.8 — 获取系统字体列表

**调用：**
```json
{
  "tool": "system",
  "action": "sys_fonts"
}
```

**通过条件：** 响应包含字体列表（数组或对象），无报错。

---

### 步骤 1.9 — 获取网络信息

**调用：**
```json
{
  "tool": "system",
  "action": "network"
}
```

**通过条件：** 响应包含网络配置摘要（可以为空对象），无报错。

---

### 步骤 1.10 — 获取更新日志

**调用：**
```json
{
  "tool": "system",
  "action": "changelog"
}
```

**通过条件：** 响应包含 `html` 或 `show` 字段。

---

### 步骤 1.11 — 推送错误通知

**调用：**
```json
{
  "tool": "system",
  "action": "push_err_msg",
  "msg": "MCP 测试错误通知",
  "timeout": 3000
}
```

**通过条件：** 调用成功（无错误），SiYuan 界面应短暂显示错误通知。

---

## 第 2 节：Notebook（笔记本）

目标：测试笔记本的完整生命周期：创建 → 配置 → 操作 → 关闭。

### 步骤 2.1 — 创建测试笔记本

**调用：**
```json
{
  "tool": "notebook",
  "action": "create",
  "name": "mcp-test-notebook"
}
```

**通过条件：** 响应包含 `notebook.id` 字段（非空字符串）。
**记录：** `$TEST_NB_ID = response.notebook.id`，`$TEST_NB_NAME = "mcp-test-notebook"`

---

### 步骤 2.2 — 列出所有笔记本

**调用：**
```json
{
  "tool": "notebook",
  "action": "list"
}
```

**通过条件：** 响应中的笔记本列表包含 `$TEST_NB_ID`。

---

### 步骤 2.3 — 设置笔记本图标

**调用：**
```json
{
  "tool": "notebook",
  "action": "set_icon",
  "notebook": "$TEST_NB_ID",
  "icon": "1f9ea"
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 2.4 — 获取笔记本配置

**调用：**
```json
{
  "tool": "notebook",
  "action": "get_conf",
  "notebook": "$TEST_NB_ID"
}
```

**通过条件：** 响应包含 `conf` 对象，含 `closed` 字段。

---

### 步骤 2.5 — 设置笔记本配置

**调用：**
```json
{
  "tool": "notebook",
  "action": "set_conf",
  "notebook": "$TEST_NB_ID",
  "conf": {
    "closed": false,
    "refCreateSavePath": "/mcp-test-refs",
    "createDocNameTemplate": "{{now | date \"2006-01-02\"}}",
    "dailyNoteSavePath": "/mcp-test-daily/{{now | date \"2006/01\"}}",
    "dailyNoteTemplatePath": ""
  }
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 2.6 — 重命名笔记本

**调用：**
```json
{
  "tool": "notebook",
  "action": "rename",
  "notebook": "$TEST_NB_ID",
  "name": "mcp-test-notebook-renamed"
}
```

**通过条件：** 调用成功，再次调用 `list` 时该笔记本名称已更新。
**记录：** `$TEST_NB_NAME = "mcp-test-notebook-renamed"`

---

### 步骤 2.7 — 获取笔记本权限

**调用：**
```json
{
  "tool": "notebook",
  "action": "get_permissions"
}
```

**通过条件：** 响应包含权限映射（可以为空对象，说明无特殊限制）。

---

### 步骤 2.8 — 获取笔记本子文档

**调用：**
```json
{
  "tool": "notebook",
  "action": "get_child_docs",
  "notebook": "$TEST_NB_ID"
}
```

**通过条件：** 调用成功，返回空列表（笔记本刚创建，无子文档）。

---

### 步骤 2.9 — 关闭笔记本

**调用：**
```json
{
  "tool": "notebook",
  "action": "set_open_state",
  "notebook": "$TEST_NB_ID",
  "opened": false
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 2.10 — 重新打开笔记本

**调用：**
```json
{
  "tool": "notebook",
  "action": "set_open_state",
  "notebook": "$TEST_NB_ID",
  "opened": true
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 2.11 — 设置笔记本权限

**调用：**
```json
{
  "tool": "notebook",
  "action": "set_permission",
  "notebook": "$TEST_NB_ID",
  "permission": "rwd"
}
```

**通过条件：** 调用成功，无错误。再次调用 `get_permissions` 时 `$TEST_NB_ID` 的权限为 `rwd`。

---

## 第 3 节：Document（文档）

目标：在测试笔记本中测试文档的创建、读取、移动等操作。

### 步骤 3.1 — 创建主测试文档

**调用：**
```json
{
  "tool": "document",
  "action": "create",
  "notebook": "$TEST_NB_ID",
  "path": "/mcp-test-doc-main",
  "markdown": "# MCP 测试主文档\n\n这是由 MCP 测试流程创建的文档。\n\n## 第一节\n\n测试内容段落。\n\n## 第二节\n\n另一个段落，包含 **加粗** 和 *斜体* 文本。\n\n#mcp-test-tag#"
}
```

**通过条件：** 响应包含 `id` 字段（文档 ID）。
**记录：** `$DOC_ID_1 = response.id`

---

### 步骤 3.2 — 创建子文档

**调用：**
```json
{
  "tool": "document",
  "action": "create",
  "notebook": "$TEST_NB_ID",
  "path": "/mcp-test-doc-main/mcp-test-sub-doc",
  "markdown": "# 子文档\n\n这是主文档的子文档。"
}
```

**通过条件：** 响应包含 `id` 字段。
**记录：** `$DOC_ID_2 = response.id`

---

### 步骤 3.3 — 获取文档人类可读路径

**调用：**
```json
{
  "tool": "document",
  "action": "get_hpath",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 响应包含路径，格式类似 `/mcp-test-notebook-renamed/mcp-test-doc-main`。

---

### 步骤 3.4 — 获取文档存储路径

**调用：**
```json
{
  "tool": "document",
  "action": "get_path",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 响应包含存储路径（以 `.sy` 结尾的格式，如 `/20240101120000-xxxxxxx.sy`）。

---

### 步骤 3.5 — 获取文档内容

**调用：**
```json
{
  "tool": "document",
  "action": "get_doc",
  "id": "$DOC_ID_1",
  "mode": "markdown"
}
```

**通过条件：** 响应包含 markdown 内容，含步骤 3.1 写入的 `# MCP 测试主文档` 标题。

---

### 步骤 3.6 — 搜索文档（按标题前缀）

**调用：**
```json
{
  "tool": "document",
  "action": "search_docs",
  "notebook": "$TEST_NB_ID",
  "query": "mcp-test"
}
```

**通过条件：** 响应列表包含 `$DOC_ID_1` 对应的文档。

---

### 步骤 3.7 — 获取子文档列表

**调用：**
```json
{
  "tool": "document",
  "action": "get_child_docs",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 响应包含 `$DOC_ID_2`。

---

### 步骤 3.8 — 获取子块列表

**调用：**
```json
{
  "tool": "document",
  "action": "get_child_blocks",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 响应包含块列表（至少有 1 个块，对应文档创建时写入的内容）。

---

### 步骤 3.9 — 重命名文档

**调用：**
```json
{
  "tool": "document",
  "action": "rename",
  "id": "$DOC_ID_2",
  "title": "mcp-test-sub-doc-renamed"
}
```

**通过条件：** 调用成功，再次获取文档路径时显示新名称。

---

### 步骤 3.10 — 复制文档

**调用：**
```json
{
  "tool": "document",
  "action": "duplicate",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 响应包含新文档 `id`（不同于 `$DOC_ID_1`）。
**注意：** 记录此 ID 以便在清理步骤中删除。记录为 `$DOC_ID_COPY`

---

### 步骤 3.11 — 设置文档图标

**调用：**
```json
{
  "tool": "document",
  "action": "set_icon",
  "id": "$DOC_ID_1",
  "icon": "1f4dd"
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 3.12 — 创建今日日记

**调用：**
```json
{
  "tool": "document",
  "action": "create_daily_note",
  "notebook": "$TEST_NB_ID"
}
```

**通过条件：** 响应包含 `id`（日记文档 ID）。
**记录：** `$DAILY_NOTE_ID = response.id`

---

### 步骤 3.13 — 列出文档树

**调用：**
```json
{
  "tool": "document",
  "action": "list_tree",
  "notebook": "$TEST_NB_ID",
  "path": "/"
}
```

**通过条件：** 响应包含树结构，至少包含步骤 3.1 和 3.2 创建的文档。

---

### 步骤 3.14 — 上传测试封面素材

**调用：**
```json
{
  "tool": "file",
  "action": "upload_asset",
  "assetsDirPath": "/assets/",
  "localFilePath": "icon.png"
}
```

**通过条件：** 响应包含上传成功映射 `succMap`，且其中至少一个值为以 `/assets/` 开头的路径。
**记录：** `$COVER_ASSET_PATH = Object.values(response.succMap)[0]`

---

### 步骤 3.15 — 设置文档封面

**调用：**
```json
{
  "tool": "document",
  "action": "set_cover",
  "id": "$DOC_ID_1",
  "source": "$COVER_ASSET_PATH"
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 3.16 — 清除文档封面

**调用：**
```json
{
  "tool": "document",
  "action": "set_cover",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 调用成功，响应包含 `cleared: true`。

---

### 步骤 3.17 — 通过路径获取文档 ID

**调用：**
```json
{
  "tool": "document",
  "action": "get_ids",
  "notebook": "$TEST_NB_ID",
  "path": "/mcp-test-doc-main"
}
```

**通过条件：** 响应包含 `$DOC_ID_1`。

---

### 步骤 3.18 — 创建空文档

**调用：**
```json
{
  "tool": "document",
  "action": "create_empty",
  "notebook": "$TEST_NB_ID",
  "path": "/mcp-test-empty-doc"
}
```

**通过条件：** 响应包含 `id` 字段。
**记录：** `$DOC_ID_EMPTY = response.id`

---

### 步骤 3.19 — 移动文档

**调用：**
```json
{
  "tool": "document",
  "action": "move",
  "fromIDs": ["$DOC_ID_EMPTY"],
  "toID": "$DOC_ID_1"
}
```

**通过条件：** 调用成功，无错误。

---

## 第 4 节：Block（块操作）

目标：测试块的增删改查、属性设置、折叠/展开等操作。

### 步骤 4.1 — 向文档追加新块

**调用：**
```json
{
  "tool": "block",
  "action": "append",
  "parentID": "$DOC_ID_1",
  "dataType": "markdown",
  "data": "这是通过 MCP `block/append` 追加的段落。"
}
```

**通过条件：** 响应包含新块的 `id`。
**记录：** `$BLOCK_ID_1 = response[0].doOperations[0].id`（或响应中的第一个块 ID）

---

### 步骤 4.2 — 向文档前置新块

**调用：**
```json
{
  "tool": "block",
  "action": "prepend",
  "parentID": "$DOC_ID_1",
  "dataType": "markdown",
  "data": "这是通过 MCP `block/prepend` 前置的段落。"
}
```

**通过条件：** 响应包含新块的 `id`。
**记录：** `$BLOCK_ID_2 = response[0].doOperations[0].id`

---

### 步骤 4.3 — 插入标题块（在 BLOCK_ID_1 之后）

**调用：**
```json
{
  "tool": "block",
  "action": "insert",
  "dataType": "markdown",
  "data": "## MCP 插入的标题",
  "previousID": "$BLOCK_ID_1"
}
```

**通过条件：** 响应包含新块 `id`。
**记录：** `$HEADING_BLOCK_ID = response[0].doOperations[0].id`

---

### 步骤 4.4 — 插入带标签的块

**调用：**
```json
{
  "tool": "block",
  "action": "insert",
  "dataType": "markdown",
  "data": "包含标签的段落 #mcp-test-tag# #mcp-another-tag#",
  "previousID": "$HEADING_BLOCK_ID"
}
```

**通过条件：** 响应包含新块 `id`。
**记录：** `$TAGGED_BLOCK_ID = response[0].doOperations[0].id`

---

### 步骤 4.5 — 获取块的 Kramdown 内容

**调用：**
```json
{
  "tool": "block",
  "action": "get_kramdown",
  "id": "$BLOCK_ID_1"
}
```

**通过条件：** 响应包含 `kramdown` 字段，内容含步骤 4.1 写入的文本。

---

### 步骤 4.6 — 获取块属性

**调用：**
```json
{
  "tool": "block",
  "action": "get_attrs",
  "id": "$BLOCK_ID_1"
}
```

**通过条件：** 响应包含属性对象（可以为空，但不应报错）。

---

### 步骤 4.7 — 设置块自定义属性

**调用：**
```json
{
  "tool": "block",
  "action": "set_attrs",
  "id": "$BLOCK_ID_1",
  "attrs": {
    "custom-mcp-test": "true",
    "custom-mcp-label": "step-4.7"
  }
}
```

**通过条件：** 调用成功，再次调用 `get_attrs` 时可见 `custom-mcp-test` 属性。

---

### 步骤 4.8 — 验证属性已写入（get_attrs 二次确认）

**调用：**
```json
{
  "tool": "block",
  "action": "get_attrs",
  "id": "$BLOCK_ID_1"
}
```

**通过条件：** 响应中 `custom-mcp-test` 值为 `"true"`，`custom-mcp-label` 值为 `"step-4.7"`。

---

### 步骤 4.9 — 更新块内容

**调用：**
```json
{
  "tool": "block",
  "action": "update",
  "id": "$BLOCK_ID_1",
  "dataType": "markdown",
  "data": "这是通过 MCP `block/update` **更新后**的内容。"
}
```

**通过条件：** 调用成功，再次获取 kramdown 时内容已变更。

---

### 步骤 4.10 — 获取块的面包屑路径

**调用：**
```json
{
  "tool": "block",
  "action": "breadcrumb",
  "id": "$BLOCK_ID_1"
}
```

**通过条件：** 响应包含路径数组，含 `$DOC_ID_1` 对应的文档名称。

---

### 步骤 4.11 — 获取块的子块

**调用：**
```json
{
  "tool": "block",
  "action": "get_children",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 响应包含块列表，数量 ≥ 4（步骤 4.1~4.4 插入的块）。

---

### 步骤 4.12 — 检查块是否存在

**调用：**
```json
{
  "tool": "block",
  "action": "exists",
  "id": "$BLOCK_ID_1"
}
```

**通过条件：** 响应返回 `true` 或类似"块存在"的确认。

---

### 步骤 4.13 — 获取块详情

**调用：**
```json
{
  "tool": "block",
  "action": "info",
  "id": "$BLOCK_ID_1"
}
```

**通过条件：** 响应包含块的类型、内容、所属文档 ID 等信息。

---

### 步骤 4.14 — 统计文档字数

**调用：**
```json
{
  "tool": "block",
  "action": "word_count",
  "ids": ["$DOC_ID_1"]
}
```

**通过条件：** 响应包含字数信息（`wordCount` 或类似字段），值 > 0。

---

### 步骤 4.15 — 获取最近更新的块

**调用：**
```json
{
  "tool": "block",
  "action": "recent_updated",
  "page": 1,
  "pageSize": 5
}
```

**通过条件：** 响应包含块列表，`$BLOCK_ID_1` 或 `$BLOCK_ID_2` 应出现其中（刚刚编辑过）。

---

### 步骤 4.16 — 批量插入块

**调用：**
```json
{
  "tool": "block",
  "action": "batch_insert",
  "parentID": "$DOC_ID_1",
  "dataType": "markdown",
  "datas": [
    "批量块 1：MCP 批量插入测试",
    "批量块 2：继续批量插入",
    "批量块 3：批量插入完成"
  ]
}
```

**通过条件：** 响应包含 3 个新块的 ID。
**记录：** `$BATCH_BLOCK_IDS = [id1, id2, id3]`

---

### 步骤 4.17 — 折叠标题块

**调用：**
```json
{
  "tool": "block",
  "action": "set_fold_state",
  "id": "$HEADING_BLOCK_ID",
  "folded": true
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 4.18 — 展开标题块

**调用：**
```json
{
  "tool": "block",
  "action": "set_fold_state",
  "id": "$HEADING_BLOCK_ID",
  "folded": false
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 4.19 — 获取块所在文档信息

**调用：**
```json
{
  "tool": "block",
  "action": "doc_info",
  "id": "$BLOCK_ID_1"
}
```

**通过条件：** 响应包含文档信息，其中 `id` 或 `rootID` 对应 `$DOC_ID_1`。

---

### 步骤 4.20 — 批量获取文档信息

**调用：**
```json
{
  "tool": "block",
  "action": "docs_info",
  "ids": ["$DOC_ID_1", "$DOC_ID_2"],
  "refCount": true
}
```

**通过条件：** 响应包含两个文档的信息，每个都有 `id` 字段。

---

### 步骤 4.21 — 获取块渲染 DOM

**调用：**
```json
{
  "tool": "block",
  "action": "dom",
  "id": "$BLOCK_ID_1"
}
```

**通过条件：** 响应包含 `dom` 字段（HTML 字符串），内容非空。

---

### 步骤 4.22 — 批量更新块

**调用：**
```json
{
  "tool": "block",
  "action": "batch_update",
  "blocks": [
    {
      "id": "$BATCH_BLOCK_IDS[0]",
      "dataType": "markdown",
      "data": "批量块 1：已更新内容"
    },
    {
      "id": "$BATCH_BLOCK_IDS[1]",
      "dataType": "markdown",
      "data": "批量块 2：已更新内容"
    }
  ]
}
```

**通过条件：** 调用成功，无错误。再次获取子块时内容已更新。

---

### 步骤 4.23 — 追加块到日记

**调用：**
```json
{
  "tool": "block",
  "action": "append_daily_note",
  "notebook": "$TEST_NB_ID",
  "dataType": "markdown",
  "data": "追加到日记的测试段落。"
}
```

**通过条件：** 响应包含新块 ID，无错误。

---

### 步骤 4.24 — 前置块到日记

**调用：**
```json
{
  "tool": "block",
  "action": "prepend_daily_note",
  "notebook": "$TEST_NB_ID",
  "dataType": "markdown",
  "data": "前置到日记的测试段落。"
}
```

**通过条件：** 响应包含新块 ID，无错误。

---

### 步骤 4.25 — 移动块

**调用：**
```json
{
  "tool": "block",
  "action": "move",
  "id": "$BATCH_BLOCK_IDS[0]",
  "previousID": "$BATCH_BLOCK_IDS[1]"
}
```

**通过条件：** 调用成功，无错误。块的位置已改变。

---

### 步骤 4.26 — 删除块

> **注意：** 此步骤删除测试过程中创建的批量块之一，属于清理操作。

**调用：**
```json
{
  "tool": "block",
  "action": "delete",
  "id": "$BATCH_BLOCK_IDS[2]"
}
```

**通过条件：** 调用成功，再次检查 `exists` 时返回 false 或不存在。

---

## 第 5 节：Search（搜索）

目标：测试全文搜索、SQL 查询、标签搜索、反向链接等。

### 步骤 5.1 — 全文搜索（关键词模式）

**调用：**
```json
{
  "tool": "search",
  "action": "fulltext",
  "query": "MCP 测试主文档",
  "method": 0,
  "page": 1,
  "pageSize": 10
}
```

**通过条件：** 响应包含 `$DOC_ID_1` 对应的文档。

---

### 步骤 5.2 — 全文搜索（限定块类型）

**调用：**
```json
{
  "tool": "search",
  "action": "fulltext",
  "query": "MCP 插入的标题",
  "method": 0,
  "typeShortcodes": ["h"],
  "page": 1,
  "pageSize": 10
}
```

**通过条件：** 响应中的块类型均为 `heading`，且包含 `$HEADING_BLOCK_ID`。

---

### 步骤 5.3 — 全文搜索（限定在文档范围内）

**调用：**
```json
{
  "tool": "search",
  "action": "fulltext",
  "query": "批量",
  "method": 0,
  "parentId": "$DOC_ID_1",
  "page": 1,
  "pageSize": 10
}
```

**通过条件：** 响应包含步骤 4.16 创建的批量块，且结果都在 `$DOC_ID_1` 文档内。
**重试规则：** 若首次 `matchedBlockCount` 为 `0`，等待 1 秒后重试，最多重试 3 次；若仍为空，记录为“索引延迟导致的可重试失败”，不要判定为 MCP 参数错误或 CLI 参数映射回归。

---

### 步骤 5.4 — SQL 查询（查询测试文档）

**调用：**
```json
{
  "tool": "search",
  "action": "query_sql",
  "stmt": "SELECT id, content, type FROM blocks WHERE root_id = '$DOC_ID_1' LIMIT 10"
}
```

> **注意：** 将 `$DOC_ID_1` 替换为实际 ID 值后再执行。

**通过条件：** 响应包含至少 1 行，`type` 字段为合法的块类型（如 `p`、`h`）。

---

### 步骤 5.5 — SQL 查询（验证测试块存在）

**调用：**
```json
{
  "tool": "search",
  "action": "query_sql",
  "stmt": "SELECT id, content, type FROM blocks WHERE id = '$BLOCK_ID_1' LIMIT 1"
}
```

> **注意：** 不要再假设 `custom-*` 属性一定会同步写入 `attributes` 表；属性写入能力已由步骤 4.7 / 4.8 的 `set_attrs` + `get_attrs` 覆盖验证。

**通过条件：** 响应包含 `$BLOCK_ID_1`，且 `type` 为合法块类型。

---

### 步骤 5.6 — 按标签搜索

**调用：**
```json
{
  "tool": "search",
  "action": "search_tag",
  "k": "mcp-test-tag"
}
```

**通过条件：** 响应返回的标签结果包含 `mcp-test-tag`。
**重试规则：** 若首次返回空列表，等待 1 秒后重试，最多重试 3 次；若仍为空，记录为“标签索引延迟导致的可重试失败”。

---

### 步骤 5.7 — 获取文档反向链接

**调用：**
```json
{
  "tool": "search",
  "action": "get_backlinks",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 调用成功，返回反向链接列表（可以为空，因为测试文档是新建的）。

---

### 步骤 5.8 — 搜索块引用

**调用：**
```json
{
  "tool": "search",
  "action": "search_refs",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 5.9 — 列出失效引用

**调用：**
```json
{
  "tool": "search",
  "action": "list_invalid_refs"
}
```

**通过条件：** 调用成功，返回失效引用列表（可以为空）。

---

### 步骤 5.10 — 获取文档反向提及

**调用：**
```json
{
  "tool": "search",
  "action": "get_backmentions",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 调用成功，返回反向提及列表（可以为空，因为测试文档是新建的）。

---

### 步骤 5.11 — 查找替换

> **注意：** 此步骤修改文档内容，需确认后执行。

**调用：**
```json
{
  "tool": "search",
  "action": "find_replace",
  "k": "MCP 测试",
  "r": "MCP 自动化测试",
  "ids": ["$DOC_ID_1"],
  "method": 0
}
```

**通过条件：** 调用成功，返回替换结果，替换数量 > 0。

---

### 步骤 5.12 — 搜索资源文件

**调用：**
```json
{
  "tool": "search",
  "action": "search_assets",
  "k": "mcp-test"
}
```

**通过条件：** 调用成功，返回资源文件列表（可能包含步骤 3.14 上传的资源）。

---

## 第 6 节：File（文件操作）

目标：测试文档导出、资源文件管理等功能。

### 步骤 6.1 — 列出未使用资源

**调用：**
```json
{
  "tool": "file",
  "action": "list_unused_assets"
}
```

**通过条件：** 调用成功，返回未使用资源列表（可以为空）。

---

### 步骤 6.2 — 获取文档所有资源

**调用：**
```json
{
  "tool": "file",
  "action": "get_doc_assets",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 调用成功，返回资源列表（测试文档无附件，预期为空）。

---

### 步骤 6.3 — 获取文档图片资源

**调用：**
```json
{
  "tool": "file",
  "action": "get_doc_assets",
  "id": "$DOC_ID_1",
  "assetType": "image"
}
```

**通过条件：** 调用成功，返回资源列表（测试文档无图片附件，预期为空）。

---

### 步骤 6.4 — 导出文档为 Markdown

**调用：**
```json
{
  "tool": "file",
  "action": "export_md",
  "id": "$DOC_ID_1"
}
```

**通过条件：** 响应包含 `content` 或下载路径，内容不为空。

---

### 步骤 6.5 — 渲染 Sprig 模板

**调用：**
```json
{
  "tool": "file",
  "action": "render_sprig",
  "template": "{{ now | date \"2006-01-02\" }}"
}
```

**通过条件：** 响应包含渲染后的字符串，日期格式合法。

---

### 步骤 6.6 — 渲染文档模板（如存在）

> **前置判断：** 如果工作空间内无可用模板文件，跳过此步骤并标记为"跳过（无可用模板）"。

**调用：**
```json
{
  "tool": "file",
  "action": "render_template",
  "id": "$DOC_ID_1",
  "path": "/data/templates/example.md"
}
```

**通过条件：** 调用成功返回渲染内容；若模板路径不存在，响应应提示 `path_not_in_workspace` 或类似信息，不视为 MCP 回归。

---

### 步骤 6.7 — 导出资源文件为 ZIP

**调用：**
```json
{
  "tool": "file",
  "action": "export_resources",
  "paths": ["$COVER_ASSET_PATH"]
}
```

**通过条件：** 响应包含 ZIP 下载路径或导出结果，`paths` 非空。

---

### 步骤 6.8 — 重命名资源文件

**调用：**
```json
{
  "tool": "file",
  "action": "rename_asset",
  "oldPath": "$COVER_ASSET_PATH",
  "newName": "mcp-test-renamed.png"
}
```

**通过条件：** 调用成功，无错误。
**记录：** `$RENAMED_ASSET_PATH = "/assets/mcp-test-renamed.png"`（或响应中返回的新路径）

---

### 步骤 6.9 — 获取图片 OCR 文本

**调用：**
```json
{
  "tool": "file",
  "action": "get_image_ocr_text",
  "path": "$RENAMED_ASSET_PATH"
}
```

**通过条件：** 调用成功，返回 `ocrText` 字段（可以为空字符串，说明无 OCR 数据）。

---

### 步骤 6.10 — 设置图片透明度

> **前置判断：** 仅当 `$RENAMED_ASSET_PATH` 指向的图片格式支持透明度时执行；否则跳过。

**调用：**
```json
{
  "tool": "file",
  "action": "set_image_alpha",
  "path": "$RENAMED_ASSET_PATH",
  "alpha": 0.5
}
```

**通过条件：** 调用成功，无错误；若内核版本不支持，响应应提示兼容性原因，不视为 MCP 回归。

---

### 步骤 6.11 — 删除资源文件

**调用：**
```json
{
  "tool": "file",
  "action": "delete_asset",
  "path": "$RENAMED_ASSET_PATH"
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 6.12 — 清理未使用资源（可选高危）

> **注意：** 此为高危操作，需要用户确认。自动执行时可先调用确认，或在测试环境中允许直接执行。

**调用：**
```json
{
  "tool": "file",
  "action": "remove_unused_assets"
}
```

**通过条件：** 调用成功，返回清理结果。若因确认规则被拒绝，记录为"确认拦截（预期行为）"。

---

## 第 7 节：Tag（标签）

目标：测试标签列表、重命名、删除操作。

### 步骤 7.1 — 列出所有标签

**调用：**
```json
{
  "tool": "tag",
  "action": "list"
}
```

**通过条件：** 响应包含标签列表，其中包含 `mcp-test-tag`（由步骤 3.1 和 4.4 创建）。
**重试规则：** 若首次缺失该标签，等待 1 秒后重试，最多重试 3 次；若仍缺失，记录为“标签索引延迟导致的可重试失败”。

---

### 步骤 7.2 — 重命名标签

**调用：**
```json
{
  "tool": "tag",
  "action": "rename",
  "oldLabel": "mcp-another-tag",
  "newLabel": "mcp-renamed-tag"
}
```

**通过条件：** 调用成功，再次列出标签时 `mcp-another-tag` 消失，`mcp-renamed-tag` 出现。

---

### 步骤 7.3 — 验证标签重命名

**调用：**
```json
{
  "tool": "tag",
  "action": "list"
}
```

**通过条件：** 列表中存在 `mcp-renamed-tag`，不存在 `mcp-another-tag`。
**重试规则：** 若首次未观察到重命名结果，等待 1 秒后重试，最多重试 3 次；若仍未出现，记录为“标签索引延迟导致的可重试失败”。

---

### 步骤 7.4 — 删除测试标签

**调用：**
```json
{
  "tool": "tag",
  "action": "remove",
  "label": "mcp-renamed-tag"
}
```

**通过条件：** 调用成功，再次列出时 `mcp-renamed-tag` 不存在。

---

## 第 8 节：Flashcard（闪卡）

目标：测试闪卡卡组获取、添加、复习、删除等操作。

### 步骤 8.1 — 为测试块添加闪卡标记

> 闪卡通过块属性 `custom-riff-decks` 实现。先获取默认卡组 ID，再添加卡片。

**调用 — 获取卡组列表：**
```json
{
  "tool": "flashcard",
  "action": "get_decks"
}
```

**通过条件：** 调用成功，返回卡组列表（可以为空）。
**记录：** 如果存在卡组，记录第一个为 `$DECK_ID`；如果为空，步骤 8.2 仍可传 `""`，但 MCP 应将其归一化到思源内置默认卡组。

---

### 步骤 8.2 — 添加块到闪卡

**调用：**
```json
{
  "tool": "flashcard",
  "action": "add_card",
  "blockIDs": ["$BLOCK_ID_2"],
  "deckID": ""
}
```

> **注意：** 请使用段落、标题等内容块 ID，避免传文档块。`deckID` 为 `""` 时，MCP 应归一化到思源默认卡组，而不是写入空卡组。

**通过条件：** 调用成功，`$BLOCK_ID_2` 被标记为闪卡，且其 `custom-riff-decks` 包含有效 deck ID。
**记录：** `$CARD_BLOCK_ID = "$BLOCK_ID_2"`

---

### 步骤 8.3 — 列出所有待复习闪卡

**调用：**
```json
{
  "tool": "flashcard",
  "action": "list_cards",
  "scope": "all",
  "filter": "new",
  "page": 1,
  "pageSize": 10
}
```

**通过条件：** 响应中包含 `$CARD_BLOCK_ID` 对应的闪卡（刚添加，为"新卡"状态）。

---

### 步骤 8.4 — 获取卡组中的卡片

**调用：**
```json
{
  "tool": "flashcard",
  "action": "get_cards",
  "deckID": "",
  "page": 1,
  "pageSize": 10
}
```

**通过条件：** 调用成功，返回卡片列表，包含 `$CARD_BLOCK_ID`。
**记录：** 从响应中获取卡片对象，记录 `$CARD_ID`（如果响应中有独立的卡片 ID）。

---

### 步骤 8.5 — 跳过复习（skip）

**调用：**
```json
{
  "tool": "flashcard",
  "action": "skip_review_card",
  "deckID": "",
  "cardID": "$CARD_ID"
}
```

**通过条件：** 调用成功，无错误。

---

### 步骤 8.6 — 从闪卡中移除块

**调用：**
```json
{
  "tool": "flashcard",
  "action": "remove_card",
  "blockIDs": ["$CARD_BLOCK_ID"],
  "deckID": ""
}
```

**通过条件：** 调用成功，再次列出 `list_cards` 时 `$CARD_BLOCK_ID` 不再出现。

---

### 步骤 8.7 — 创建闪卡（完整制卡）

> `create_card` 与 `add_card` 的区别：前者会同时写入块属性并注册 riff 卡片，后者仅做底层注册。

**调用：**
```json
{
  "tool": "flashcard",
  "action": "create_card",
  "blockIDs": ["$BLOCK_ID_1"],
  "deckID": ""
}
```

**通过条件：** 调用成功，`$BLOCK_ID_1` 的 `custom-riff-decks` 属性包含有效 deck ID，且 riff 卡片记录已生成。
**记录：** `$REVIEW_CARD_BLOCK_ID = "$BLOCK_ID_1"`

---

### 步骤 8.8 — 获取闪卡列表以提取卡片 ID

**调用：**
```json
{
  "tool": "flashcard",
  "action": "get_cards",
  "deckID": "",
  "page": 1,
  "pageSize": 10
}
```

**通过条件：** 响应包含 `$REVIEW_CARD_BLOCK_ID` 对应的卡片。
**记录：** `$REVIEW_CARD_ID = 对应卡片的 cardID`

---

### 步骤 8.9 — 复习闪卡

**调用：**
```json
{
  "tool": "flashcard",
  "action": "review_card",
  "deckID": "",
  "cardID": "$REVIEW_CARD_ID",
  "rating": 3
}
```

**通过条件：** 调用成功，无错误。

---

## 第 9 节：AV（属性视图 / 数据库）

目标：基于现有真实数据库块测试行列操作、单元格设置等。

> **前置：** 本流程要求测试者预先提供一个真实可访问的 `$AV_ID`，以及其对应数据库块 `$AV_BLOCK_ID`。不要使用 Markdown 表格或伪造 DOM 片段冒充真实 AV。

### 步骤 9.1 — 验证现有属性视图可访问

**调用：**
```json
{
  "tool": "av",
  "action": "get",
  "id": "$AV_ID"
}
```

**通过条件：** 响应成功，返回现有 AV 结构。

---

### 步骤 9.2 — 获取属性视图（渲染）

**调用：**
```json
{
  "tool": "av",
  "action": "render_attribute_view",
  "id": "$AV_ID",
  "blockID": "$AV_BLOCK_ID",
  "page": 1,
  "pageSize": 10
}
```

**通过条件：** 响应包含 `view` 或 `av` 字段，含列定义和行列表。

---

### 步骤 9.3 — 获取属性视图的列定义

**调用：**
```json
{
  "tool": "av",
  "action": "get_attribute_view_keys",
  "id": "$AV_ID"
}
```

**通过条件：** 响应包含列（keys）列表，至少有 1 列（默认主键列）。
**记录：** 记录主键列 ID 为 `$AV_PRIMARY_KEY_ID`

---

### 步骤 9.4 — 向数据库添加列

**调用：**
```json
{
  "tool": "av",
  "action": "add_column",
  "avID": "$AV_ID",
  "keyType": "text",
  "keyName": "备注"
}
```

**通过条件：** 调用成功，再次 `get_attribute_view_keys` 时出现新列。
**记录：** 新列 ID 为 `$AV_TEXT_COL_ID`

---

### 步骤 9.5 — 向数据库添加行

> **前置：** 先在当前测试文档中创建两个普通段落块，记录其 ID 为 `$AV_SRC_BLOCK_ID_1` 和 `$AV_SRC_BLOCK_ID_2`，再把它们绑定为数据库行。

**调用：**
```json
{
  "tool": "av",
  "action": "add_rows",
  "avID": "$AV_ID",
  "blockIDs": ["$AV_SRC_BLOCK_ID_1", "$AV_SRC_BLOCK_ID_2"],
  "blockID": "$AV_BLOCK_ID"
}
```

**通过条件：** 调用成功，响应 `rows` 中能解析出与两个 `blockIDs` 对应的 `rowID`。
**记录：** `$AV_ROW_ID_1` 和 `$AV_ROW_ID_2` 取自响应 `rows[].rowID`

---

### 步骤 9.6 — 设置单元格内容

> **前置：** 先通过 `render_attribute_view` 获取真实的 rowID 和 columnID。

**调用：**
```json
{
  "tool": "av",
  "action": "set_cell",
  "avID": "$AV_ID",
  "columnID": "$AV_TEXT_COL_ID",
  "rowID": "$AV_ROW_ID_1",
  "valueType": "text",
  "text": "MCP 测试内容第一行"
}
```

**通过条件：** 调用成功，再次渲染时第一行"备注"列显示该文本。

---

### 步骤 9.7 — 获取过滤和排序条件

**调用：**
```json
{
  "tool": "av",
  "action": "get_attribute_view_filter_sort",
  "id": "$AV_ID",
  "blockID": "$AV_BLOCK_ID"
}
```

**通过条件：** 调用成功，返回过滤/排序配置（可以为空）。

---

### 步骤 9.8 — 搜索属性视图

**调用：**
```json
{
  "tool": "av",
  "action": "search",
  "keyword": "备注"
}
```

**通过条件：** 调用成功，返回结果中包含当前测试数据库，或在 `unresolvedResults` 中可见候选项。
**说明：** `av/search` 主要搜索数据库名称和主键值回退结果，不保证覆盖普通文本列内容。
**重试规则：** 若刚完成列/行写入后未命中，等待 1 秒后重试，最多重试 3 次；若仍未命中，记录为“AV 搜索索引/范围限制导致的可重试失败”。

---

### 步骤 9.9 — 删除数据库行

**调用：**
```json
{
  "tool": "av",
  "action": "remove_rows",
  "avID": "$AV_ID",
  "srcIDs": ["$AV_ROW_ID_2"]
}
```

**通过条件：** 调用成功，再次渲染时 `$AV_ROW_ID_2` 不再存在。

---

### 步骤 9.10 — 批量设置单元格

**调用：**
```json
{
  "tool": "av",
  "action": "batch_set_cells",
  "avID": "$AV_ID",
  "items": [
    {
      "rowID": "$AV_ROW_ID_1",
      "columnID": "$AV_TEXT_COL_ID",
      "valueType": "text",
      "text": "MCP 批量设置测试"
    }
  ]
}
```

**通过条件：** 调用成功，再次渲染时第一行"备注"列显示更新后的文本。

---

### 步骤 9.11 — 获取主键值列表

**调用：**
```json
{
  "tool": "av",
  "action": "get_primary_key_values",
  "avID": "$AV_ID",
  "page": 1,
  "pageSize": 10
}
```

**通过条件：** 响应包含 `values` 或 `primaryKeys` 列表，至少有 1 项（包含 `$AV_ROW_ID_1` 对应的主键值）。

---

### 步骤 9.12 — 删除数据库列

**调用：**
```json
{
  "tool": "av",
  "action": "remove_column",
  "avID": "$AV_ID",
  "keyID": "$AV_TEXT_COL_ID"
}
```

**通过条件：** 调用成功，再次 `get_attribute_view_keys` 时"备注"列已消失。

---

### 步骤 9.13 — 复制数据库块

**调用：**
```json
{
  "tool": "av",
  "action": "duplicate_block",
  "avID": "$AV_ID"
}
```

**通过条件：** 调用成功，响应包含新块 ID（不同于 `$AV_BLOCK_ID`）。
**记录：** `$AV_DUPLICATE_BLOCK_ID = response.id`

---

## 第 10 节：Mascot（吉祥物）

目标：测试吉祥物余额查询、商店浏览、购买物品等功能。

### 步骤 10.1 — 查看当前余额

**调用：**
```json
{
  "tool": "mascot",
  "action": "get_balance"
}
```

**通过条件：** 响应包含 `balance` 字段（整数，≥ 0）。
**记录：** `$INITIAL_BALANCE = response.balance`

---

### 步骤 10.2 — 浏览商店

**调用：**
```json
{
  "tool": "mascot",
  "action": "shop"
}
```

**通过条件：** 响应包含商品列表，每个商品有 `id`、`name`、`price` 字段。
**已知商品：** `cat-food`(5)、`milk`(3)、`dried-fish`(4)、`can-food`(6)、`catnip`(5)、`chicken-leg`(7)、`cheese`(4)

---

### 步骤 10.3 — 购买商品（如余额充足）

> **前置判断：** 如果 `$INITIAL_BALANCE >= 3`，执行购买；否则跳过此步骤并标记为"跳过（余额不足）"。

**调用：**
```json
{
  "tool": "mascot",
  "action": "buy",
  "item_id": "milk"
}
```

**通过条件：** 调用成功，再次查询余额时 `balance = $INITIAL_BALANCE - 3`。

---

## 第 11 节：Help 动作验证

目标：验证每个工具的 `help` 动作均可正常调用并返回文档。

### 步骤 11.1 — 逐工具调用 help

依次调用以下，每个都应返回非空的帮助文本：

```json
{ "tool": "notebook", "action": "help" }
{ "tool": "document", "action": "help" }
{ "tool": "block", "action": "help" }
{ "tool": "av", "action": "help" }
{ "tool": "file", "action": "help" }
{ "tool": "search", "action": "help" }
{ "tool": "tag", "action": "help" }
{ "tool": "system", "action": "help" }
{ "tool": "flashcard", "action": "help" }
{ "tool": "mascot", "action": "help" }
```

**通过条件：** 所有 10 次调用均返回包含工具描述的帮助文本，无错误。

---

## 第 12 节：清理

> **重要：** 此节必须执行，无论前述步骤是否全部通过，以避免污染工作空间。

### 步骤 12.1 — 删除复制的文档

**调用：**
```json
{
  "tool": "document",
  "action": "remove",
  "id": "$DOC_ID_COPY"
}
```

**通过条件：** 调用成功。

---

### 步骤 12.2 — 删除日记文档

**调用：**
```json
{
  "tool": "document",
  "action": "remove",
  "id": "$DAILY_NOTE_ID"
}
```

**通过条件：** 调用成功。

---

### 步骤 12.3 — 删除测试笔记本

> **警告：** 这将删除测试笔记本中的所有内容，包括 `$DOC_ID_1`、`$DOC_ID_2` 及其中所有块。

**调用：**
```json
{
  "tool": "notebook",
  "action": "remove",
  "notebook": "$TEST_NB_ID"
}
```

**通过条件：** 调用成功，再次列出笔记本时 `$TEST_NB_ID` 不再存在。

---

### 步骤 12.4 — 推送完成通知

**调用：**
```json
{
  "tool": "system",
  "action": "push_msg",
  "msg": "MCP 测试流程已完成，测试数据已清理 ✅",
  "timeout": 5000
}
```

---

## 测试结果汇总模板

执行完成后，按以下格式输出结果：

```
## MCP 测试结果

执行时间：[日期时间]
SiYuan 版本：[版本号]

| 节 | 名称 | 步骤数 | 通过 | 失败 | 跳过 |
|----|------|--------|------|------|------|
| 1  | System | 11 | | | |
| 2  | Notebook | 11 | | | |
| 3  | Document | 19 | | | |
| 4  | Block | 24 | | | |
| 5  | Search | 12 | | | |
| 6  | File | 12 | | | |
| 7  | Tag | 4 | | | |
| 8  | Flashcard | 9 | | | |
| 9  | AV | 13 | | | |
| 10 | Mascot | 3 | | | |
| 11 | Help | 1 | | | |
| 12 | Cleanup | 4 | | | |
| **总计** | | **123** | | | |

### 失败步骤详情

[列出所有失败步骤、调用参数、实际响应、预期响应]

### 总体结论

[PASS / FAIL / PARTIAL]
```

---

## 附录：常见错误处理

| 错误类型 | 可能原因 | 处理方式 |
|----------|----------|----------|
| `ECONNREFUSED` | SiYuan 未运行 | 停止测试，要求启动 SiYuan |
| `permission denied` | 笔记本权限不足 | 检查权限设置，或跳过该步骤 |
| `block not found` | ID 变量未正确记录 | 检查前置步骤是否成功，重新执行 |
| `rate limit` | 请求过快 | 每步之间稍作等待（~200ms）|
| `av block not found` | 数据库块创建失败 | 跳过第 9 节，标记为"环境不支持" |
| SQL 查询失败 | 语法错误或字段不存在 | 检查 SQL 语句，确认 schema |
