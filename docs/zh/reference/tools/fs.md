# fs 工具

普通的纯 Markdown 文档文件操作优先使用 `fs`。它接收人类可读的工作空间路径，并隐藏 notebook ID、block ID 和存储路径。

路径形态：

- `/<笔记本名>` 表示笔记本根目录
- `/<笔记本名>/<文件夹>/<文档>` 表示文档
- `/` 表示所有可读笔记本根目录

## 常用动作

| 动作 | 用途 |
|--------|------|
| `ls` | 以 `{ name, path, children }` 列出直接子文档 |
| `tree` | 列出精简递归文档树 |
| `read` | 读取文档 Markdown |
| `write` | 创建文档，或用 `overwrite=true` 替换正文 |
| `reorder` | 完整重排全部可见直属子文档 |
| `search` | 在文档或目录路径下搜索 Markdown 行 |

## AI 可编辑 Markdown 视图

- `read` 默认尝试读取全文；按 UTF-8 字节累计，正文最多 256 KiB、每次最多 2000 个完整展示块。可用 `blockStart`、`blockLimit`、`tokenBudget` 主动缩小窗口。达到上限后停止读取正文并返回 `nextWindow`，表格、列表及代码等块不会被截成半块。显式 token 预算是软上限，字节上限始终不可突破。
- 这个视图从块 kramdown 构建：双链保留为 `((id '标题'))`，标签保留为 `#标签#`，并清理思源 DOM 中用于标签定位的零宽字符。
- 普通块和列表项的 IAL 元数据会隐藏，例如 `{: id="..." updated="..."}` 不会出现在列表文本里；因此可以直接把 `fs.read` 里复制出的 `- 列表项` 用作 `fs.replace` 的 `old`。
- 代码块、数学块和普通文本中的 literal 内容不会为了清理元数据而全局删改。
- 引用块、表格、超级块等容器块按容器读取，避免把内部子块重复输出。`fs.read` 会过滤思源生成的容器内部 IAL，但包含复杂块时仍会返回 non-fidelity warning，写回应改用高级工具。
- `outlineScope="window"` 表示目录只覆盖已返回窗口；未遍历到末尾时 `totalBlocks=null`，不能当成总数为零。`includeBlockIds=true` 会返回独立的 `blockRefs`。数据库及复杂块提示也仅针对当前窗口。
- 旧 `page/pageSize` 字符分页已移除。单块超过 256 KiB 会明确报错；不会为保持块完整而突破安全上限。
- `tree` 和 `search` 通过 `listDocsByPath` 递归枚举笔记本根目录，因此在拒绝 `listDocTree("/")` 的思源版本上，`/` 与 `/<笔记本名>` 仍可正常使用。

## Markdown 安全语义

- `write` 支持直接写 `((id '标题'))`、裸 `((id))` 和 `#标签#`。裸双链会自动解析目标块标题并补齐锚文本；如果解析失败，会降级为 `((id 'id'))` 并返回 warning。
- `write` 会移除与文档名相同的开头 `# 标题`，避免正文和思源自动标题重复。
- `write overwrite=true` 会拒绝覆盖包含 AV / 数据库块、超级块、嵌入块、挂件、HTML、媒体等复杂思源原生块的文档。此类结构请使用高级工具。
- `replace` 按块处理非复杂 Markdown 块。如果文档包含复杂思源原生块，这些块会被跳过并在结果中返回 `skippedComplexBlocks`；如果匹配只存在于被跳过的复杂块里，或跨越块边界，则拒绝写入。
- `replace` 使用和 `read` 相同的 AI 可编辑视图做精确匹配，可以直接替换包含双链或标签的普通 Markdown 块，也可以把整个 `#标签#` 替换为普通文本。它仍然是 Markdown 文本操作，不是复杂块编辑器。
- 替换行内样式文字时，`old` 应使用样式内部的纯文本，不包含 Markdown 样式标记。例如替换 `**hello**` 或 `` `hello` `` 中的内容时，`old` 写 `hello`，不要写 `**hello**` 或 `` `hello` ``；DOM 写回会保留原有粗体、行内代码等样式。
- `replace` 允许脚注式引用和 `siyuan://blocks` Markdown 链接写入，但结果会提示它们不会创建思源真实反链。

## 高风险动作

- `rm` 删除文档，需要明确确认。
- `mv` 移动或重命名文档，需要明确确认。

## 示例

```json
{ "action": "ls", "path": "/Inbox/会议记录" }
```

```json
{ "action": "read", "path": "/Inbox/会议记录/2024 总结" }
```

```json
{ "action": "read", "path": "/Inbox/会议记录/2024 总结", "blockStart": 50, "blockLimit": 50, "tokenBudget": 2000, "includeBlockIds": true }
```

```json
{ "action": "write", "path": "/Inbox/会议记录/新文档", "markdown": "正文" }
```

```json
{ "action": "search", "path": "/Inbox/会议记录", "query": "预算", "caseSensitive": false }
```

手动排序采用完整排列，不是局部移动。请先列出父级，再把每个可见直属子文档路径各传一次。该动作会将笔记本切换为自定义排序（`sortMode: 6`）；隐藏文档无需传入，也不会被重排。

```json
{
  "action": "reorder",
  "path": "/思想沉淀",
  "orderedPaths": [
    "/思想沉淀/认识自己",
    "/思想沉淀/理解世界",
    "/思想沉淀/行动原则"
  ]
}
```

CLI：`siyuan fs reorder --path "/思想沉淀" --ordered-paths-json '["/思想沉淀/认识自己","/思想沉淀/理解世界","/思想沉淀/行动原则"]'`

当 `fs.read` 提示存在复杂块，或任务需要块级排版、元数据、SQL、反链、资源文件或数据库操作时，切换到 `document`、`block`、`search`、`file` 或 `av` 等高级工具。

读取保护：块列表与单块 HTTP 响应最多 1 MiB；累计枚举元数据最多 4 MiB、50000 个块、128 层。超限明确报错，不回退为全量读取。保护作用于 MCP/CLI 侧，不能限制思源内核自身生成响应时的内存。

参见 [读取范围与数据库操作指引](../read-results.md)。
