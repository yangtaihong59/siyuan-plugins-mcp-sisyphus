# 权限模型

这个页面说明笔记本级访问控制，以及哪些操作必须显式确认。

适用场景：你遇到了权限错误，或者需要判断写入、删除的边界。

相关页面：

- [路径语义](./path-semantics.md)
- [工具索引](./tools/index.md)

## 权限级别

| 级别 | 读取 | 写入 | 删除 |
|------|------|------|------|
| `rwd` | 是 | 是 | 是 |
| `rw` | 是 | 是 | 否 |
| `r` | 是 | 否 | 否 |
| `none` | 否 | 否 | 否 |

说明：

- 未显式配置的笔记本默认是 `r`（只读）
- 安装插件后新建的笔记本会被写入显式的 `rwd`，无论通过 `notebook(action="create")`、CLI 还是思源界面创建；已有的显式配置不会被覆盖，重新打开已存在的笔记本目录也保持默认值
- 通过 `notebook(action="set_permission")` 管理权限
- 修改后会立即影响后续调用

## 文件树状态显示

插件可以在思源文件树的笔记本根节点旁显示 `R`、`RW`、`RWD` 或 `NONE` 徽标。该徽标只展示当前 MCP 权限，不会修改笔记内容或思源自身的访问控制；子文档继承所属笔记本的权限，因此不会逐项重复显示。

点击徽标可以按 `NONE → R → RW → RWD → NONE` 的顺序循环切换并立即保存。成功时不会弹出通知；保存失败时会恢复原权限。可以在插件设置的“权限”页关闭“在文件树显示 MCP 权限”。未显式配置的笔记本以虚线 `R` 显示，表示采用默认只读权限。

## 高危操作

以下操作必须获得用户明确确认：

- `notebook.remove`
- `notebook.set_permission`
- `document.remove`
- `document.move`
- `block.delete`
- `block.move`
- `file.upload_asset`
- `file.remove_unused_assets`
- `file.delete_asset`
- `search.find_replace`
- `system.workspace_info`
- `system.perform_sync`
- `tag.remove`
- `flashcard.remove_card`

补充说明：

- `file.upload_asset` 对大文件还需要额外确认
- `file.export_resources` 如果带本地 `outputPath`，在操作上也应按高风险处理
