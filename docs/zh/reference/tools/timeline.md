# timeline 工具

`timeline` 用于管理命名的文档/全局快照节点、查看文档块级差异，以及选择性恢复历史内容。

如需完整的 Agent 工作流与安全检查清单，加载官方 Skill `siyuan://skills/siyuan-mcp-timeline`，或调用 MCP Prompt `siyuan_timeline`。另见[常见任务](../common-tasks.md#比较并恢复文档时间线)。

## 动作

| 动作 | 必填字段 | 说明 |
|------|----------|------|
| `list_nodes` | `scope` | `document` 和 `all` 还需 `documentId`；按时间倒序分页 |
| `create_node` | `name`, `scope` | 文档节点还需 `documentId`；返回稳定标识 `tag` |
| `compare_node` | `documentId`, `tag` | 创建一次未标记的当前状态快照，分页返回块级差异 |
| `delete_node` | `tag` | 文档 tag 还需 `documentId`；高危且默认关闭 |
| `rollback_document` | `documentId`, `tag` | 只恢复单篇文档文件，不进行整库 checkout；高危且默认关闭 |
| `rollback_block` | `documentId`, `tag`, `changeKey` | 重新计算 Diff，并恢复仍能匹配的单个块变更；高危且默认关闭 |

## 工作流

```text
timeline(action="list_nodes", scope="all", documentId="<文档 ID>")
timeline(action="create_node", name="改写前", scope="document", documentId="<文档 ID>")
timeline(action="compare_node", documentId="<文档 ID>", tag="<tag>", page=1, pageSize=20)
timeline(action="rollback_block", documentId="<文档 ID>", tag="<tag>", changeKey="<changeKey>")
```

`compare_node` 默认只返回发生变化的块；需要上下文时可设置 `includeUnchanged=true`。每个变更包含历史/当前 Markdown、不透明的 `changeKey`，以及是否支持块级回退。

## 目标、副作用与恢复边界

任何比较或恢复前都要先解析文档 ID 和时间线 tag。全局 tag 是工作区元数据；文档级 tag 与 tag 中编码的文档 ID 绑定，调用时必须传入同一个 ID。tag 或文档存在歧义时，不要只按显示名称选节点。

- `create_node` 会创建仓库快照和保护性 tag；文档节点还会写入文档侧索引。tag/索引只是导航依据，不证明以后恢复时所有关联文件都能一起覆盖。
- `compare_node` 会先创建一个未标记的当前状态工作区快照，再计算差异。这个快照是仓库写入，也是比较用的前像，不是历史节点，更不是恢复已完成的证据。因此重复比较会留下额外的仓库快照。
- `delete_node` 只移除保护性 tag 和文档索引记录，底层仓库快照仍然保留。移除 tag 不等于删除快照，也不会恢复内容。
- `rollback_document` 会解析所选文档的历史仓库文件，只恢复这一篇文档文件。它不是整仓库 checkout，也不承诺同时恢复资源、属性视图 JSON、笔记本状态或其他关联文件。
- `rollback_block` 使用最近一次比较返回的 `changeKey`，重新计算差异，只恢复仍能匹配的一个变更。修改块原地更新，新增块删除，已删除块只有在能解析出安全位置时才插回；过期 key 或不安全的结构变化会被拒绝，不会猜测。

保护性快照和内核侧备份快照只能降低误操作的恢复成本，不能说明回退已经成功。动作成功 envelope 只能先解释为“请求已被接受”，直到目标内容完成读回。

### 前后像与有界回退读回

回退前保留精确的 `documentId`、`tag`、选中的历史文件/块，以及 `compare_node` 返回的 `old`/`current` Markdown。先审阅差异，并在破坏性恢复前停止竞争写入者和同步参与方。没有记录这个检查点前，不要把回退和新写入串在一起。

`rollback_document` 后，用 `block(action="get_kramdown", id=...)` 按同一文档 ID 读回（结构保真重要时再检查 `.sy`）。`rollback_block` 后，读回受影响块及其父块/相邻顺序，再与选中的历史 Markdown 比较。只有内容持久化可信后才检查或刷新实时 UI；工具触发的 UI 刷新不是内容证明。如果内容读回通过但尚未检查实时 UI，应报告为“持久化已验证、UI 未验证”。响应丢失时先重新 `compare_node` 或读取精确内容，再决定下一步；绝不要盲目重发破坏性动作。

## MCP App

支持 MCP Apps 的客户端通过专用的 `timeline_app` Tool 打开一次内联时间线界面；普通 `timeline` 查询不再生成 App。`timeline_app` 可接收 `documentId`，并可附带 `tag` 直接打开指定 Diff。节点列表省略重复的应用标题栏，比较页使用紧凑的统一 Diff。

设置页的“App 软件”页面独立管理时间线 App 及其六个操作。App 内的列出、比较、创建、删除与回退全部通过模型不可见的 `timeline_app_action` Tool 执行；因此可以关闭 AI 的回退 action，同时保留由用户点击执行的 App 回退。App-only 隔离由支持 MCP Apps `visibility: ["app"]` 的 Host 执行。服务端的笔记本权限检查与高风险 elicitation/MRTR 确认仍然生效。

在 Diff 页第一次点击整篇或单块回退时，App 会显示不占据布局空间的二次确认浮层；按钮不会位移，可在原位置再次点击。浮层不拦截鼠标事件，但仍会通过无障碍状态区域播报。

当首次调用只列出全局节点、没有提供 `documentId` 时，界面可以浏览和创建全局节点，但会禁用文档比较；让 Agent 使用 `scope="all"` 和 `documentId` 重新调用即可进入完整 Diff 工作流。

## 安全与权限

- 列出、比较文档节点需要笔记本读权限。
- 创建文档节点需要写权限。
- 删除文档节点和所有回退动作统一要求 `rwd`。
- 全局节点只暴露快照元数据，不绑定具体笔记本权限。
- `delete_node` 只删除保护 tag 和文档索引记录，底层仓库快照仍会保留。
- 调用 `delete_node`、`rollback_document` 或 `rollback_block` 前必须获得用户明确确认；CLI 主动调用视为确认。
- AI 权限沿用原默认值；时间线 App 及其六个操作默认开启，并可在“App 软件”页逐项关闭。
- 旧版节点关联、迁移与转换仍只在插件时间线 UI 中提供。

## CLI 示例

```bash
siyuan-sisyphus timeline create-node --name "改写前" --scope document --document-id <文档 ID> --json
siyuan-sisyphus timeline compare-node --document-id <文档 ID> --tag <tag> --page-size 20 --json
```
