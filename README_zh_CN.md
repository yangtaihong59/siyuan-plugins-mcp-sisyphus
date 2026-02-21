# SiYuan MCP Sisyphus

[English](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README.md) | [中文](https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus/blob/main/README_zh_CN.md)

思源笔记西西弗斯 MCP 服务器。通过 Model Context Protocol 提供 41 个工具，支持 AI 与思源笔记的深度集成。

## 功能特性

- **完整的思源笔记 API 支持**: 通过 MCP 访问所有主要思源 API （除 SQL 外所有）
- **41 工具可用**: 全面覆盖笔记本、文档、块和文件操作

## ⚠️ 注意事项

### 高危操作与确认

MCP 服务端会通过 **Server Instructions** 向 AI 发送使用说明，要求在执行以下操作**前必须先向用户说明并等待确认**，未经确认不得直接调用（但需要注意这取决于 AI，本工具不对危险操作产生的后果负责）：

- **删除类**: `remove_notebook`、`remove_document`、`remove_document_by_id`、`delete_block`
- **移动类**: `move_documents`、`move_documents_by_id`、`move_block`

若使用的客户端支持并展示 MCP 的 instructions，AI 会先提问「我将执行 X，是否继续？」再在用户同意后调用工具。你也可在项目或 Cursor 的规则中再次强调上述约定。

**❕同时我们在设置中提供了所有tools的关闭按钮，如果介意可以在设置中关闭。**

## 安装

### 从思源集市安装

1. 打开思源笔记
2. 进入设置 > 集市
3. 搜索 "SiYuan MCP"
4. 安装并启用插件

### 从源码安装

```bash
# 克隆仓库
git clone https://github.com/your-repo/siyuan-plugins-mcp-sisyphus.git

# 安装依赖
pnpm install

# 构建
pnpm run build

# 创建开发链接
pnpm run make-link
```

## 使用方法

### MCP 客户端配置

在你喜欢的客户端中配置 MCP 服务器,任何支持 MCP stdio 协议的客户端都可以通过以下方式连接:

```json
{
  "mcpServers": {
    "siyuan": {
      "command": "node",
      "args": ["/绝对路径/SiYuan/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs"]
    }
  }
}
```

**注意**：路径中的文件夹名必须与 plugin.json 的 `name` 一致，为 `siyuan-plugins-mcp-sisyphus`。若报错 `Cannot find module '.../mcp-server.cjs'`，请检查：① 该路径下是否存在 `mcp-server.cjs`；② 文件夹名是否写错（例如误写为 `siyuan-mcp-sisyphus`）。

## 可用工具

### 笔记本操作 (8 个工具)

| 工具                  | 描述                       |
| --------------------- | -------------------------- |
| `list_notebooks`    | 列出工作空间中的所有笔记本 |
| `create_notebook`   | 创建新笔记本               |
| `open_notebook`     | 打开笔记本                 |
| `close_notebook`    | 关闭笔记本                 |
| `remove_notebook`   | 删除笔记本                 |
| `rename_notebook`   | 重命名笔记本               |
| `get_notebook_conf` | 获取笔记本配置             |
| `set_notebook_conf` | 设置笔记本配置             |

### 文档操作 (11 个工具)

| 工具                      | 描述                         |
| ------------------------- | ---------------------------- |
| `create_document`       | 创建带 Markdown 内容的新文档 |
| `rename_document`       | 通过路径重命名文档           |
| `rename_document_by_id` | 通过 ID 重命名文档           |
| `remove_document`       | 通过路径删除文档             |
| `remove_document_by_id` | 通过 ID 删除文档             |
| `move_documents`        | 移动多个文档到新位置         |
| `move_documents_by_id`  | 通过 ID 移动多个文档         |
| `get_document_path`     | 通过文档 ID 获取文件路径     |
| `get_hpath_by_path`     | 通过文件路径获取层级路径     |
| `get_hpath_by_id`       | 通过文档 ID 获取层级路径     |
| `get_ids_by_hpath`      | 通过层级路径获取文档 ID      |

### 块操作 (13 个工具)

| 工具                   | 描述                       |
| ---------------------- | -------------------------- |
| `insert_block`       | 在指定位置插入新块         |
| `prepend_block`      | 在父块开头插入块           |
| `append_block`       | 在父块末尾插入块           |
| `update_block`       | 更新块内容                 |
| `delete_block`       | 删除块                     |
| `move_block`         | 移动块到新位置             |
| `fold_block`         | 折叠块（收起子块）         |
| `unfold_block`       | 展开块（显示子块）         |
| `get_block_kramdown` | 获取块的 kramdown 格式内容 |
| `get_child_blocks`   | 获取父块的所有子块         |
| `transfer_block_ref` | 转移块引用                 |
| `set_block_attrs`    | 设置块属性                 |
| `get_block_attrs`    | 获取块属性                 |

### 文件操作 (9 个工具)

| 工具                  | 描述                   |
| --------------------- | ---------------------- |
| `upload_asset`      | 上传文件到资源目录     |
| `render_template`   | 使用文档上下文渲染模板 |
| `render_sprig`      | 渲染 Sprig 模板        |
| `export_md_content` | 导出文档为 Markdown    |
| `export_resources`  | 导出资源为 ZIP         |
| `push_msg`          | 推送通知消息           |
| `push_err_msg`      | 推送错误消息           |
| `get_version`       | 获取思源版本           |
| `get_current_time`  | 获取当前系统时间       |

## 开发

### 项目结构

```
siyuan-plugins-mcp-sisyphus/
├── src/
│   ├── api/           # 思源 API 封装
│   ├── mcp/           # MCP 服务器实现
│   │   ├── tools/     # 工具实现
│   │   ├── server.ts  # 主服务器
│   │   └── types.ts   # 类型定义
│   └── index.ts       # 插件入口
├── public/i18n/       # 国际化
└── package.json
```

## 许可证

MIT
