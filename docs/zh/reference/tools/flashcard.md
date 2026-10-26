# flashcard 工具

`list_cards` 省略 `filter` 时默认查询 `due`，各 scope 对应的 ID 仍须提供。评分后 `nextSteps` 给出读回调用；提交状态以严格安全回执为准，内核空响应不再显示为容易误解的 `result: null`。

`skip=true` 只跳过本轮会话，不评分、不改变持久化复习计划，因此严格回执可以是 `no_change`。继续复习时原样使用返回的 `reviewSession.nextListArgs`；省略 `reviewedCards` 会让内核开启新会话、清空跳过记录。

严格写入先传 `validateOnly=true`，再原样提交 `preflight.commitArgs`。复习使用 `list_cards` 或 `get_cards` 返回的真实 `cardID`，不要用笔记块的 blockID/id。内核解析后的 `get_cards` 条目同时提供两种 ID。不属于指定牌组、不存在或无笔记本写权限的卡片会在复习前拒绝。回执比较真实复习次数、上次复习时间等调度状态；读回失败时保留原 requestId，先核对卡片，不要自动重复评分。

这个工具覆盖以复习为中心的闪卡操作与卡组管理。

适用场景：你需要列出待复习卡片、查看卡组、复习卡片，或把块转为闪卡。

相关页面：

- [常见任务](../common-tasks.md)

## 动作

| 分组 | 动作 |
|------|---------|
| 读取 | `list_cards`, `get_decks`, `get_cards` |
| 复习流程 | `review_card` |
| 卡组修改 | `create_card`, `remove_card` |

## 安全规则

- `remove_card` 需要显式确认。

## MCP App

对于支持 MCP Apps 的客户端，`flashcard(action="list_cards", scope="all", filter="due")` 会向模型返回不含答案的候选摘要，包括题面与调度元数据；没有可读题面的卡片会在 AI 选卡前被排除。结果还会携带一个不透明的 `candidateToken`，对应一份有效期十分钟的固定候选快照。AI 必须原样复制该 token，只从同一结果的 `cards` 数组中自主选择 1–20 张卡，再调用仅对 MCP Apps 客户端提供的展示工具 `flashcard_review_session`，传入有序的 `{ deckID, cardID }` 与简短的 `selectionReason`；不能把 `get_cards`、牌组库存、旧轮次结果或猜测的 ID 当作候选来源。展示工具会验证这份快照，不再第二次抽取思源到期队列，因此内核抽样或每日限额排序不会在两次调用之间过滤掉已选卡；启动会话时仍会重新检查笔记本权限。

打开后的内联 App 不再重复显示标题栏，直接进入经典流程：看题、显示答案、选择 Again / Hard / Good / Easy。模型仍会在 `structuredContent` 中获得本轮完整题目和参考答案，但成功结果会标记 `presentationMode: "mcp-app-only"`，并要求模型只回复“复习界面已打开，请在卡片中完成本轮。”，不得复述卡片、在聊天中开始 Q1、要求用户在聊天作答、代替用户评分或自行调用 `review_card`。每次评分仍由 App 调用现有的 `flashcard(action="review_card")`，不会绕过 action 开关或服务端权限逻辑。只有用户明确切换为聊天复习，或最后一张完成后主动点击“让 AI 讲解本轮”发送课后教学请求，模型才能重新讨论卡片内容。

`list_cards` 与 `get_cards` 会在笔记本读取权限允许时，根据卡片的 `blockID` 补充 `front` 和 `back`：源块内容作为题面，直接子块按顺序合并为答案。笔记本不可读、权限加载失败或无法确认所属笔记本时，只保留卡片 ID 与调度元数据；内核预先返回的正文、路径和题面也会移除。已确认可读但补充内容读取失败时，保留可读的内核记录。

评分由模型不可见的 `flashcard_review_app_action` 提交，并在独立“App 软件”页控制；普通 `flashcard` Tool 不绑定 UI。未声明 `io.modelcontextprotocol/ui` 的客户端不会看到启动器或 App-only Tool，原有文本、`structuredContent` 和 CLI 行为保持不变。

## 说明

- `review_card` 可传 `rating`，也可用 `skip=true` 跳过当前卡片。
- `list_cards` 可传可选的 `reviewedCards`，与思源复习流程一致，用于过滤本轮已经处理过的卡片。
- `list_cards(scope="all")` 应省略 `deckID`；为兼容调用端自动补值，空字符串会按未传处理。非空 `deckID` 应配合 `scope="deck"` 使用。
- `create_card` 通过思源的 `addRiffCards` 流程把已有块转为闪卡；该流程会在 transaction 中同时写入卡组属性并注册卡片记录。非内置卡组的 `deckID` 必须已存在，`mode` 保留为兼容参数。

## 动作列表

- `list_cards`
- `get_decks`
- `get_cards`
- `review_card`
- `create_card`
- `remove_card`
