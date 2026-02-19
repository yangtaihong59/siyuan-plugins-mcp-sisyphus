# SiYuan MCP 使用指南

## 快速开始

### 1. 安装插件

**方式一：从源码构建**
```bash
# 克隆仓库
git clone https://github.com/your-repo/siyuan-mcp.git
cd siyuan-mcp

# 安装依赖
pnpm install

# 构建
pnpm run build

# 将 dist 文件夹打包为 plugin-siyuan-mcp.zip
# 在思源笔记的「设置-集市-本地」中上传安装
```

**方式二：从集市安装**
- 打开思源笔记
- 设置 → 集市 → 插件
- 搜索「SiYuan MCP」
- 点击下载并启用

### 2. 配置插件

1. 打开思源笔记设置
2. 点击顶部工具栏的 MCP 图标
3. 在设置面板中配置：
   - **API URL**: `http://127.0.0.1:6806`（默认）
   - **自动启动**: 勾选以在插件加载时自动启动 MCP 服务器

### 3. 配置 MCP 客户端

#### Claude Desktop

编辑 `claude_desktop_config.json`（位置因系统而异）：

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "node",
      "args": [
        "/path/to/siyuan-mcp/dist/mcp-server.js"
      ],
      "env": {
        "SIYUAN_API_URL": "http://127.0.0.1:6806"
      }
    }
  }
}
```

#### Cursor

在 Cursor 设置中：
1. 打开 Settings → Features → MCP
2. 点击「Add MCP Server」
3. 配置：
   - Name: `siyuan`
   - Command: `node /path/to/siyuan-mcp/dist/mcp-server.js`

#### 其他 MCP 客户端

通用的 stdio 配置方式：
```bash
# 启动 MCP 服务器
node dist/mcp-server.js
```

环境变量：
- `SIYUAN_API_URL`: 思源 API 地址（默认：http://127.0.0.1:6806）

---

## 工具功能详解

### 笔记本管理

#### `list_notebooks`
列出所有笔记本
```json
{
  "name": "list_notebooks",
  "arguments": {}
}
```

返回：
```json
{
  "notebooks": [
    {
      "id": "20210808180117-czj9bvb",
      "name": "笔记本名称",
      "icon": "",
      "sort": 0,
      "closed": false
    }
  ]
}
```

#### `create_notebook`
创建新笔记本
```json
{
  "name": "新笔记本名称"
}
```

#### `open_notebook` / `close_notebook`
打开/关闭笔记本
```json
{
  "notebook": "笔记本ID"
}
```

---

### 文档管理

#### `create_document`
通过 Markdown 创建文档
```json
{
  "notebook": "笔记本ID",
  "path": "/文件夹/文档名",
  "markdown": "# 标题\n\n内容"
}
```

#### `rename_document`
重命名文档
```json
{
  "notebook": "笔记本ID",
  "path": "/旧路径",
  "title": "新标题"
}
```

#### `remove_document`
删除文档
```json
{
  "notebook": "笔记本ID",
  "path": "/文档路径"
}
```

#### `move_documents`
移动文档
```json
{
  "fromPaths": ["/源路径1", "/源路径2"],
  "toNotebook": "目标笔记本ID",
  "toPath": "/目标路径"
}
```

---

### 块操作

#### `insert_block`
插入块到指定位置
```json
{
  "dataType": "markdown",
  "data": "## 二级标题",
  "parentID": "父块ID",
  "nextID": "后一个块ID"
}
```

#### `append_block`
在父块末尾追加子块
```json
{
  "dataType": "markdown",
  "data": "- 列表项",
  "parentID": "父块ID"
}
```

#### `update_block`
更新块内容
```json
{
  "dataType": "markdown",
  "data": "更新后的内容",
  "id": "块ID"
}
```

#### `delete_block`
删除块
```json
{
  "id": "块ID"
}
```

#### `fold_block` / `unfold_block`
折叠/展开块
```json
{
  "id": "块ID"
}
```

#### `get_block_kramdown`
获取块的 Kramdown 源码
```json
{
  "id": "块ID"
}
```

#### `get_child_blocks`
获取子块列表
```json
{
  "id": "父块ID"
}
```

---

### 属性管理

#### `set_block_attrs`
设置块属性
```json
{
  "id": "块ID",
  "attrs": {
    "custom-type": "note",
    "custom-priority": "high"
  }
}
```

#### `get_block_attrs`
获取块属性
```json
{
  "id": "块ID"
}
```

---

### 资源与导出

#### `upload_asset`
上传资源文件
```json
{
  "assetsDirPath": "/assets/",
  "file": "base64编码的文件内容",
  "fileName": "image.png"
}
```

#### `export_md_content`
导出文档为 Markdown
```json
{
  "id": "文档ID"
}
```

#### `render_sprig`
渲染 Sprig 模板
```json
{
  "template": "{{now | date_modify \"+1d\" | date \"2006-01-02\"}}"
}
```

---

### 系统通知

#### `push_msg`
推送消息通知
```json
{
  "msg": "操作成功",
  "timeout": 3000
}
```

#### `push_err_msg`
推送错误通知
```json
{
  "msg": "操作失败",
  "timeout": 5000
}
```

#### `get_version`
获取思源版本
```json
{}
```

---

## 使用示例

### 示例 1：创建学习笔记

```
用户：帮我创建一个关于 TypeScript 的学习笔记

AI：
1. 列出所有笔记本
   → list_notebooks

2. 创建新文档
   → create_document
   {
     "notebook": "笔记本ID",
     "path": "/学习笔记/TypeScript入门",
     "markdown": "# TypeScript 入门\n\n## 什么是 TypeScript\n\nTypeScript 是 JavaScript 的超集..."
   }

3. 追加内容
   → append_block
   {
     "dataType": "markdown",
     "data": "## 基础类型\n\n- string\n- number\n- boolean\n- array",
     "parentID": "文档ID"
   }
```

### 示例 2：整理笔记结构

```
用户：把「项目A」相关的笔记都移到「工作」笔记本下

AI：
1. 搜索相关文档
   → 通过 SQL 或遍历查找

2. 移动文档
   → move_docs_by_id
   {
     "fromIDs": ["doc1", "doc2", "doc3"],
     "toID": "工作笔记本ID"
   }
```

### 示例 3：批量处理

```
用户：给所有带 #重要 标签的块添加红色高亮

AI：
1. 查询带标签的块
   → 使用思源 SQL API

2. 设置属性
   → set_block_attrs
   {
     "id": "块ID",
     "attrs": {
       "custom-background": "#ffcccc"
     }
   }
```

---

## 故障排除

### 问题 1：MCP 服务器无法启动

**检查清单：**
1. 思源笔记是否已启动？
2. API URL 是否正确？（默认 http://127.0.0.1:6806）
3. 是否获取了 API Token？

**解决方案：**
```bash
# 检查思源 API 是否正常
curl http://127.0.0.1:6806/api/system/version
```

### 问题 2：工具调用失败

**常见原因：**
- 参数类型错误（检查 Zod schema）
- 块/文档 ID 不存在
- 权限不足

**调试方法：**
1. 检查思源内核日志
2. 验证 ID 是否存在：
   ```json
   {
     "name": "get_block_kramdown",
     "arguments": {
       "id": "块ID"
     }
   }
   ```

### 问题 3：中文路径问题

如果路径包含中文，确保：
1. 使用正确的编码
2. 思源 API 能正确解析

---

## 最佳实践

### 1. 批量操作
- 使用 `move_docs_by_id` 而不是多次调用 `move_document`
- 合并多次 `append_block` 为一次调用（如果可能）

### 2. 错误处理
- 始终检查 API 返回的 code
- code 为 0 表示成功，非 0 表示错误

### 3. ID 管理
- 使用 `get_path_by_id` 将 ID 转换为可读路径
- 使用 `get_ids_by_hpath` 将路径转换为 ID

### 4. 性能优化
- 缓存笔记本和文档列表
- 避免频繁的状态查询

---

## 高级用法

### 自定义工作流

结合思源模板和 MCP 工具，可以创建自动化工作流：

```typescript
// 每日笔记自动化
1. 检查今日笔记是否存在
2. 如果不存在，使用 render_template 创建
3. 使用 push_msg 通知用户
```

### 与其他工具集成

- **与日历集成**：读取日历事件，创建待办事项
- **与浏览器集成**：保存网页内容到思源
- **与代码编辑器集成**：同步代码笔记

---

## 参考资源

- [思源笔记 API 文档](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)
- [MCP 协议规范](https://modelcontextprotocol.io/)
- [项目 GitHub](https://github.com/your-repo/siyuan-mcp)

---

## 更新日志

### v1.0.0 (2026-02-19)
- ✨ 初始版本
- 🚀 支持 41 个 MCP 工具
- 📚 完整的 API 封装
- 🎨 配置面板 UI
