---
name: siyuan-mcp-sisyphus
description: 使用 mcporter 连接 SiYuan MCP server (siyuan-mcp-sisyphus)。用于操作 SiYuan 笔记：列出笔记本、读写文档、块操作等。
---

# SiYuan MCP Sisyphus

通过 mcporter 调用 SiYuan 笔记的 MCP 工具。

## MCP 自我介绍

```
SiYuan MCP Sisyphus(version 0.1.3)

高危操作确认：
在调用以下工具之前，必须先向用户明确说明操作并等待确认。

必须确认的工具：
- remove_notebook, remove_document, remove_document_by_id（删除）
- delete_block（删除块）
- move_documents, move_documents_by_id, move_block（移动）

append_block 行为：
- parentID 为文档ID → 在文档开头添加块
- parentID 为块ID → 在块末尾添加块
```

## 添加 MCP Server

```bash
# 自动检测思源路径 ($HOME/SiYuan/data/)
mcporter config add siyuan-mcp-sisyphus --command "node" --arg "$HOME/SiYuan/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs"

# 验证配置
mcporter list siyuan-mcp-sisyphus --schema
```

## 工具列表 (41个)

### Notebook 操作
| 工具 | 描述 | 危险 |
|------|------|------|
| `list_notebooks` | 列出所有笔记本 | |
| `create_notebook name="名称"` | 创建笔记本 | |
| `open_notebook notebook="ID"` | 打开笔记本 | |
| `close_notebook notebook="ID"` | 关闭笔记本 | |
| `rename_notebook notebook="ID" name="新名称"` | 重命名笔记本 | |
| `get_notebook_conf notebook="ID"` | 获取配置 | |
| `set_notebook_conf notebook="ID" conf='{}'` | 设置配置 | |
| `remove_notebook notebook="ID"` | 删除笔记本 | ⚠️ |

### Document 操作
| 工具 | 描述 | 危险 |
|------|------|------|
| `create_document notebook="ID" path="/路径" markdown="内容"` | 创建文档 | |
| `rename_document notebook="ID" path="/路径" title="标题"` | 重命名文档 | |
| `rename_document_by_id id="ID" title="标题"` | 通过ID重命名 | |
| `get_document_path id="ID"` | 获取文档路径 | |
| `get_hpath_by_id id="ID"` | 获取层级路径 | |
| `get_hpath_by_path notebook="ID" path="/路径"` | 路径转层级 | |
| `get_ids_by_hpath path="/路径" notebook="ID"` | 层级转ID | |
| `move_documents fromPaths='["/a","/b"]' toNotebook="ID" toPath="/c"` | 移动文档 | ⚠️ |
| `move_documents_by_id fromIDs='["ID1","ID2"]' toID="目标ID"` | 通过ID移动 | ⚠️ |
| `remove_document notebook="ID" path="/路径"` | 删除文档 | ⚠️ |
| `remove_document_by_id id="ID"` | 通过ID删除 | ⚠️ |

### Block 操作
| 工具 | 描述 | 危险 |
|------|------|------|
| `append_block dataType="markdown" data="内容" parentID="父块ID"` | 追加块 | |
| `prepend_block dataType="markdown" data="内容" parentID="父块ID"` | 开头插入 | |
| `insert_block dataType="markdown" data="内容" parentID="父块ID" nextID="后块ID"` | 定位插入 | |
| `update_block dataType="markdown" data="内容" id="块ID"` | 更新块 | |
| `delete_block id="块ID"` | 删除块 | ⚠️ |
| `move_block id="块ID" previousID="前块ID" parentID="新父块ID"` | 移动块 | ⚠️ |
| `get_block_kramdown id="块ID"` | 获取块内容 | |
| `get_child_blocks id="块ID"` | 获取子块 | |
| `fold_block id="块ID"` | 折叠块 | |
| `unfold_block id="块ID"` | 展开块 | |
| `set_block_attrs id="块ID" attrs='{"自定义":"值"}'` | 设置属性 | |
| `get_block_attrs id="块ID"` | 获取属性 | |
| `transfer_block_ref fromID="源ID" toID="目标ID"` | 转移引用 | |

### 实用工具
| 工具 | 描述 |
|------|------|
| `get_version` | 获取 SiYuan 版本 |
| `get_current_time` | 获取当前时间 |
| `push_msg msg="消息" timeout=3000` | 推送通知 |
| `push_err_msg msg="错误消息" timeout=3000` | 推送错误 |
| `render_template id="文档ID" path="/模板路径"` | 渲染模板 |
| `render_sprig template="Sprig模板"` | 渲染 Sprig |
| `export_md_content id="文档ID"` | 导出 Markdown |
| `export_resources paths='["/path1"]' name="文件名"` | 导出资源 |

## 使用示例

```bash
# 列出笔记本
mcporter call siyuan-mcp-sisyphus.list_notebooks

# 获取文档内容
mcporter call siyuan-mcp-sisyphus.get_block_kramdown id="20260216145857-bytcd77"

# 在文档开头添加内容
mcporter call siyuan-mcp-sisyphus.append_block dataType="markdown" data="# 新标题" parentID="文档ID"
```

## 禁用高危工具

如果需要禁用高危工具，前往设置编辑思源插件配置
