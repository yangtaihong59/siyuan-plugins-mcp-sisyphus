# document 工具

`create.notebook` 必须使用 `notebook.list` 返回的笔记本 ID，不能传名称。误传可读笔记本名称时，错误会列出匹配的 ID，便于修正参数；不应为此修改权限。

创建文档在所有模式下都必须使用 `notebook + path` 或 `notebook + parentPath + title`；根目录可用 `parentPath="/"`。仅 `notebook + title` 无效，预检会直接拒绝且不签发凭证。修改业务参数后需重新预检取得新 `requestId`；只有同一请求的重试才复用原 ID。

这个工具覆盖文档 CRUD、树结构查询、元数据，以及与日记/转换相关的文档操作。

适用场景：你需要创建、移动、查询或转换文档。

相关页面：

- [路径语义](../path-semantics.md)
- [权限模型](../permissions.md)

## 常见动作

| 分组 | 动作 |
|------|---------|
| 创建与读取 | `create`, `lookup`, `query`, `ensure_link_targets`, `get_doc`, `get_outline` |
| 树结构查询 | `get_child_blocks`, `get_child_docs`, `list_tree`, `search_docs` |
| 元数据与修改 | `rename`, `move`, `reorder`, `remove`, `set_attr`, `duplicate` |
| 日记 / 转换 | `create_daily_note`, `heading_to_doc`, `doc_to_heading` |

## 参数与语义

- `create` 支持人类可读 `path`，也支持 `parentPath` + `title`；省略 `markdown` 即创建空文档。创建子文档时优先使用 `path`。`parentPath` + `title` 可传人类可读父路径，也可传 `lookup` 返回的 `.sy` 结尾 storage path。
- `lookup` 可按 `id`、存储 `path`、人类可读 `hpath` / `hPath` 查找；用 `include` 请求 `id`、`ids`、`path`、`hpath` 或 `docInfo`。
- 严格模式下，`create` / `create_daily_note` 按返回的文档 ID 核对目标笔记本；其他笔记本的同名路径不会混入创建读回。
- `ensure_link_targets` 的 `linkMap`、分类结果和计数在精简响应中也完整保留，包括 `changed=false` 的只读解析与复用；`created` 为空不代表没有解析到目标。
- `ensure_link_targets` 在一个精确范围内建立可复用的导入 link map：范围必须是 `notebook` + 直属父文档 `parentId`。`resolve` 与 `reuse` 只接受明确的直属子文档 ID。`create` 只接受明确的新标题；即使当前范围已有同名子文档，也绝不把标题当身份复用，而是把它以 `same_title_child_requires_explicit_id` 放进 `unresolved`。每个解析或新建结果都带有精确 `id`、笔记本、storage `path` 和 `hPath` 读回。
- `ensure_link_targets(dryRun=true)` 只适用于 `mode="create"`，只检查并返回 `wouldCreate`，不写入。`resolve` 与 `reuse` 都是纯只读发现操作。真正的 `create` 使用普通两段式合同：先 `validateOnly=true` 预检，再用预检返回的 `requestId` 和返回的 `expectedStructureHash` 只提交一次。传输结果未知时不得重发，必须检查或继续使用原 request ID。该 action 不会自动删除自己创建的文档。
- `lookup` 返回的 `idPath` 会包含可用的 `id` / `ids`。当同一 hpath 有多个同名文档时，`include: ["ids"]` 会返回全部匹配 ID；内部已包含 SQL 兜底。
- `rename`、`remove`、`move` 在非 ID 模式下通常需要存储路径。
- `rename(items:[{id,title}])` 用一次有界预检和一份有序回执重命名最多 50 个文档（序列化输入上限 256 KiB），`items` 与单文档参数互斥。预检拒绝重复 ID、目标冲突、已存在的同级名称、不明确的同级结果、改名循环以及存在父子依赖的批次。每项写入前重新核对；首个失败或未知即停止，后续项为 `not_started`，已完成项不自动回滚。重放原 `requestId` 返回原回执且不补跑；只有已证实 `not_started` 的项才能重新预检提交。
- `reorder` 接收笔记本或父文档 `parentID` 与 `orderedIDs`。数组必须把全部可见直属子文档 ID 各包含一次。它会启用笔记本自定义排序（`sortMode: 6`），但不会移动、重命名或修改文档正文。
- `get_child_docs` 必须传文档 `id`，不接受 `notebook + path`。
- `list_tree` 使用 `notebook + path`，其中 `path` 是 `/` 或 `/20240318112233-abc123.sy` 这类存储路径，不是人类可读路径。
- 如果批量 `remove` 遇到思源短暂的 `indexing` 窗口，请改用 `notebook + storage path` 逐个删除并重试。
- `set_attr` 按文档 ID 写入文档元数据属性。
- `get_outline` 调用思源原生大纲接口，不读取正文即可返回标题树、标题块 ID、嵌套关系和 `headingCount`。如果还需要可编辑 Markdown，请使用 `get_doc`。

## 权限范围内的文档查询

`query` 分页列出索引中的文档并计算统计，不接受原始 SQL。服务器生成固定 SQL，在聚合前把每个输入限定为可读笔记本，再通过思源 HTTP API 执行；其他笔记本可以继续保持 `none`。

| 参数 | 含义 |
|---|---|
| `notebooks` | 可选笔记本 ID 数组；默认所有可读且打开的笔记本。显式指定未知、不可读或关闭的笔记本会拒绝。 |
| `fields` | 返回字段，默认全部：`id`、`notebook`、`title`、`path`、`hpath`、`created`、`updated`、`blockCount`、`contentChars`、`sameTitleCount`。 |
| `title`、`hpathPrefix` | 标题的字面子串，区分大小写；笔记本内人类可读路径，匹配该路径本身或后代。 |
| `minBlocks`、`maxBlocks`、`minChars`、`maxChars` | 统计值的闭区间边界，必须为非负整数。 |
| `duplicatesOnly` | 只返回 `sameTitleCount > 1` 的文档。 |
| `sortBy`、`sortOrder` | 支持 `id`、`title`、`created`、`updated`、`blockCount`、`contentChars`、`sameTitleCount`；默认 `updated` / `desc`，也支持 `asc`。 |
| `page`、`pageSize` | 默认 1 / 50，每页最多 100 条。 |

`blockCount` 是非文档（`type != 'd'`）索引行数，包含容器块。`contentChars` 是这些行的 SQLite `length(content)` 之和，不等于思源原生字数、UTF-8 字节数或去重后的可见正文字符数。`sameTitleCount` 在所选笔记本及标题/路径范围内统计精确同名文档，**先计数，再应用块数/字符数边界**。同名或大小相同都不能证明内容重复。

结果使用标准分页，包含 `total`、`hasNextPage` 和 `nextSteps`；有下一页时继续读取。`scope.notebooks` 标明查询的笔记本；`scope.excludedClosedNotebooks` 只列出默认范围中被排除的可读关闭笔记本。索引可能滞后于近期写入；跨页读取不共享冻结快照。

以下示例均传给 `document` 工具：

```json
{"action":"query","sortBy":"blockCount","sortOrder":"desc","pageSize":50}
```

```json
{"action":"query","maxBlocks":0,"fields":["id","notebook","title","hpath","blockCount","contentChars"]}
```

```json
{"action":"query","duplicatesOnly":true,"sortBy":"sameTitleCount"}
```

```json
{"action":"query","notebooks":["<notebook-id>"],"hpathPrefix":"/Project","fields":["id","title","hpath","updated"]}
```

`maxBlocks: 0` 可筛选索引中仅有标题的骨架候选；决定修改前仍需按精确 ID 读取确认。

## Markdown 与标题规则

- `create` 的 `markdown` 不需要写同名 `# 标题`；如果写了，工具会自动剥离，避免双标题。
- `create` 支持直接写 `((id '标题'))`、裸 `((id))` 和 `#标签#`。裸双链会自动补齐锚文本；如果解析失败，会降级为 `((id 'id'))` 并返回 warning。
- `create` 允许 `[^1]` 脚注式引用和 `[text](siyuan://blocks/id)` 写入，但结果会提示它们不会创建思源真实反链。
- `get_doc` 返回与 `fs.read` 一致的可编辑 Markdown，保留 `((id '标题'))` 和 `#标签#`。
- `get_doc mode="markdown"` 默认尝试全文，正文硬上限为 256 KiB（UTF-8），每次最多 2000 个完整块；可显式使用 `blockStart`、`blockLimit`、`tokenBudget`。超限使用 `nextWindow` 继续；`outlineScope="window"`，未读取到文末时 `totalBlocks=null`。单块超限报错。`includeBlockIds=true` 添加独立块引用。
- 字符级 `page/pageSize` 分页已经移除。`mode="html"` 仍返回不分页的当前视图 HTML，并继续使用 `size`。

## 安全规则

- `remove`、`move` 需要显式确认。
- 按路径修改前先确认路径类型。
- 不要把标题搜索结果当链接目标。再次运行 `ensure_link_targets` 时，使用上次成功响应中的精确 ID，并选 `resolve` 或 `reuse`。

## 示例

MCP：

```json
{
  "action": "create",
  "notebook": "<notebook-id>",
  "path": "/Inbox/Weekly Note",
  "markdown": "周报正文"
}
```

```json
{
  "action": "lookup",
  "id": "<doc-id>",
  "include": "path"
}
```

```json
{
  "action": "ensure_link_targets",
  "notebook": "<notebook-id>",
  "parentId": "<parent-document-id>",
  "mode": "resolve",
  "targets": [{ "key": "source-index", "id": "<direct-child-document-id>" }]
}
```

```json
{
  "action": "ensure_link_targets",
  "notebook": "<notebook-id>",
  "parentId": "<parent-document-id>",
  "mode": "reuse",
  "targets": [{ "key": "source-index", "id": "<direct-child-document-id>" }]
}
```

```json
{
  "action": "ensure_link_targets",
  "notebook": "<notebook-id>",
  "parentId": "<parent-document-id>",
  "mode": "create",
  "targets": [{ "key": "source-index", "title": "New Target" }],
  "validateOnly": true
}
```

占位 ID 应替换成工具实际返回的 ID。`resolve`/`reuse` 的 target 使用 `key` + `id`；`create` 使用 `key` + `title`。不能同时传 `id` 和 `title`，也不能只传 `key`。create 示例仅执行预检；随后保持业务参数不变，设置 `validateOnly: false`，带返回的 `expectedStructureHash` 和 `requestId` 只提交一次。遇到同名直属子文档时，结果是 unresolved，不会隐式复用。

CLI：

```bash
siyuan document create --notebook <notebook-id> --path "/Inbox/Weekly Note" --markdown "周报正文"
siyuan document lookup --id <doc-id> --include path
siyuan document query --max-blocks 0 --page-size 100
siyuan document reorder --parent-id <笔记本或父文档ID> --ordered-ids-json '["<文档ID-1>","<文档ID-2>"]'
siyuan document ensure_link_targets --notebook <notebook-id> --parent-id <parent-document-id> --mode resolve --targets-json '[{"key":"source-index","id":"<direct-child-document-id>"}]'
siyuan document ensure_link_targets --notebook <notebook-id> --parent-id <parent-document-id> --mode reuse --targets-json '[{"key":"source-index","id":"<direct-child-document-id>"}]'
siyuan document ensure_link_targets --notebook <notebook-id> --parent-id <parent-document-id> --mode create --targets-json '[{"key":"source-index","title":"New Target"}]' --validate-only
```

## 动作列表

- `create`
- `lookup`
- `query`
- `ensure_link_targets`
- `rename`
- `remove`
- `move`
- `reorder`
- `get_child_blocks`
- `get_child_docs`
- `set_attr`
- `list_tree`
- `search_docs`
- `get_doc`
- `get_outline`
- `create_daily_note`
- `duplicate`
- `heading_to_doc`
- `doc_to_heading`

参见 [读取范围与数据库操作指引](../read-results.md)。

### 文档与标题的安全转换

两个转换 action 都需要严格预检；提交时原样使用 `preflight.commitArgs`。

- `doc_to_heading`：`srcID` 必须是没有子文档的文档根 ID。`targetID` 必须是另一文档里的真实标题块 ID（通过 `get_outline` 获取），不能传文档根 ID。合并到自身或后代文档会在写前拒绝；部分内核版本把文档根作为锚点会损坏文档。`after` 指定插入到目标标题章节之前或之后。
- `heading_to_doc`：`headingID` 必须是真实标题块。省略 `targetPath` 时默认 `/`，即目标笔记本根目录。显式 `targetPath` 必须是现有父文档以 ID 组成、以 `.sy` 结尾的存储路径，不能是标题路径。也可以用 `previousPath` 指定 `targetNotebook` 内已有同级文档之后的位置；不要同时传非根 `targetPath`。返回的 `id` 是转换后的文档 ID，与原标题块 ID 相同。

无效锚点和路径会在预检阶段拒绝，不调用内核转换接口。结果未知时先核对内容，不要换 request ID 重试。
