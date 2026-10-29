# 路径语义

这个页面定义了 `document` 工具里使用的两种路径类型。

适用场景：你在调用 `document` 相关 action，但不确定某个字段需要人类可读路径还是存储路径。

相关页面：

- [权限模型](./permissions.md)
- [document 工具](./tools/document.md)

## 人类可读路径

用于：

- `document(action="create")`
- `document(action="lookup", hpath=...)`

格式：

- `/Inbox/Weekly Note`

规则：

- 必须以 `/` 开头
- 缺失的父文档会自动创建为空文档

## 存储路径

用于：

- `document(action="rename")`
- `document(action="remove")`
- `document(action="move")`
- `document(action="lookup", path=...)`
- `document(action="list_tree")`

格式：

- `/20240318112233-abc123.sy`

规则：

- 表示真实文件存储位置
- 通过 `document(action="lookup", id=..., include="path")` 获取
- 如果已有的是人类可读路径，请传 `hpath`；`lookup` 会为了兼容把非存储格式的 `path` 当作 `hpath` 解析，但新调用应使用明确字段。

## 安全工作流

1. 先调用 `document(action="lookup", id=..., include="path")`
2. 在后续操作里复用返回的存储路径
