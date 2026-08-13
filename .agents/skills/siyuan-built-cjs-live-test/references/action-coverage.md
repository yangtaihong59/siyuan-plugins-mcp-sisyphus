# 真实写入 action 覆盖基线

本表用于规划夹具和验收顺序。执行前必须与 `src/core/write-safety-policy.ts` 比较；源码新增、删除或重新分类 action 时，以源码为准并更新本表。

## 需要严格协调器的修改

### 无哈希前置条件

- `fs.write`（新建且 `overwrite !== true`）
- `notebook.create`
- `document.create`、`document.create_daily_note`
- `block.insert`、`block.prepend`、`block.append`、`block.add_to_daily_note`
- `av.render`（`createIfNotExist=true`）、`av.add_rows`
- `file.create_template`（新建且 `overwrite !== true`）
- `timeline.create_node`
- `flashcard.create_card`

这些 action 仍要求 `requestId`，并验证幂等账本和提交后读回。

### `state` 前置条件

- `fs.write`（`overwrite=true`）、`fs.rm`
- `notebook.set_open_state`、`notebook.remove`、`notebook.rename`、`notebook.set_conf`、`notebook.set_icon`、`notebook.set_permission`
- `document.duplicate`、`document.rename`、`document.remove`、`document.set_attr`
- `block.update`、`block.replace`、`block.delete`、`block.set_fold_state`、`block.set_attrs`
- `av.add_column`、`av.remove_column`、`av.duplicate`
- `file.create_template`（`overwrite=true`）、`file.update_template`、`file.delete_template`、`file.save_doc_as_template`、`file.rename_asset`、`file.delete_asset`
- `timeline.delete_node`、`timeline.rollback_document`、`timeline.rollback_block`
- `flashcard.review_card`、`flashcard.remove_card`
- `mascot.buy`

### `structure` 前置条件

- `fs.mv`、`fs.reorder`
- `document.move`、`document.reorder`、`document.heading_to_doc`、`document.doc_to_heading`
- `block.move`

### `manifest` 前置条件

- `fs.replace`
- `block.transfer_references`
- `av.remove_rows`、`av.set_cells`
- `file.remove_unused_assets`
- `search.find_replace`
- `tag.rename`、`tag.remove`

### `source` 前置条件

- `file.upload_asset`

## 条件修改与排除项

- `av.render` 只有 `createIfNotExist=true` 才是修改；否则按只读验证。
- `fs.write` 和 `file.create_template` 的新建与覆盖走不同策略，两个分支都要测试。
- `extension` 的非只读第三方 action，以及 `file.export_resources`、`file.extract_doc`、`system.notify`、`system.perform_sync`、`feedback.submit` 属于外部副作用，不进入严格状态校验。
- timeline action 会使用思源仓库时间线能力。默认只做自动化覆盖，不在“无快照”的真实笔记本验收中执行。
- `mascot.buy` 会消耗余额；默认不执行。
- `file.remove_unused_assets` 可能影响测试本之外的工作空间资源。只有能证明候选集合全部属于本轮夹具时才执行，否则标为安全阻塞。
- `search.find_replace` 与 `tag.rename/remove` 可能跨文档命中。必须使用本轮唯一随机标记，并在执行前只读核对命中集合。
- `notebook.set_permission` 必须使用临时笔记本，并保证测试客户端不会在恢复权限前失去清理能力。

## 每个 action 的最低通过标准

1. 使用本轮 CJS 和真实思源成功调用。
2. 预检型 action 返回正确的 `preconditionField` 和活动短租约。
3. 正式写入返回严格安全元数据，且只读回查与预期相符。
4. 成功后租约被消费；同 request ID 重放不产生第二次修改。
5. 对应夹具已清理或明确保留。

“schema 存在”“单元测试通过”“同类 action 已通过”均不能替代该 action 的真实执行记录。
