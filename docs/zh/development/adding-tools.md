# 添加工具

这个页面描述新增一个聚合工具类别时的当前工作流。

适用场景：你要添加新的 tool category。

## 工作流

1. 如有需要，先在 `src/api/*` 扩展 API 封装
2. 在 `src/core/config.ts` 和相关 schema 中定义工具 / action 类型
3. 在 `src/tools/<tool>/` 下实现工具模块，通常为 `index.ts` + `handlers.ts`
4. 在 `src/mcp/tool-registry.ts` 中注册
5. 添加默认配置和帮助文本
6. 补测试

## 注意点

- 工具文档和 config 中的 action 列表必须保持一致
- 涉及 notebook-scoped 修改时，权限检查需要显式实现
- 工具层共享基础设施放在 `src/tools/internal/`；跨工具 helper 放在 `src/tools/internal/helpers/`
