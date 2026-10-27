# 扩展点

这个页面说明如何安全地扩展系统，以及需要遵守的边界约束。

适用场景：你要新增工具、修改传输层、扩展 CLI 命令表面，或修改配置行为。

---

## 可扩展区域

### 1. 新增工具类别

如果你想暴露一组全新的 SiYuan API 能力给 MCP 客户端，需要按以下步骤操作：

#### 步骤清单

1. **API 封装**（`src/api/`）
   - 在 `src/api/` 下新建或扩展对应领域的文件
   - 遵循纯函数风格：`export async function newAction(client: SiYuanClient, ...) { ... }`
   - 在 `src/types/api.d.ts` 中补充请求/响应类型

2. **配置定义**（`src/core/config.ts`）
   - 在 `ToolCategory` 联合类型中新增 category 名
   - 在 `ACTIONS_BY_CATEGORY` 中定义该 category 的 action 列表
   - 在 `buildDefaultToolConfig()` 中设置默认值
   - （可选）在 `ACTION_TIERS` 中标注 `basic` / `advanced`
   - （可选）若有高危 action，加入 `DANGEROUS_ACTIONS`

3. **工具实现**（`src/tools/`）
   - 新建 `src/tools/{category}/index.ts` + `src/tools/{category}/handlers.ts`
   - 工具层共享基础设施放在 `src/tools/internal/`；跨工具 helper 放在 `src/tools/internal/helpers/`
   - 使用 `defineTool()` 工厂定义工具：
     ```typescript
     export const { listTools: listXxxTools, callTool: callXxxTool } = defineTool({
         category: 'xxx',
         description: '...',
         variants: [...],
     });
     ```
   - 每个 variant 包含：`action`（动作名）、`description`（描述）、`schema`（Zod schema）、`handler`（业务逻辑）
   - handler 中需要权限检查时，使用 `tools/internal/context.ts` 中的 `ensurePermissionForDocumentId` / `ensurePermissionForNotebook`

4. **注册表注册**（`src/core/tool-registry.ts`）
   - 在 `TOOL_REGISTRY` 中新增条目：
     ```typescript
     xxx: { category: 'xxx', listTools: listXxxTools, callTool: callXxxTool }
     ```

5. **帮助文案**（`src/core/help.ts`）
   - 添加该 category 的 guidance 文本
   - 为每个 action 添加 hint

6. **Resource 注册**（`src/core/resources.ts`，可选）
   - 若需要动态 help 资源，在 `readHelpResource()` 中添加路由

7. **设置面板**（`src/ui/setting/mcp-config.svelte` 及子面板）
   - 在 `ToolCategoriesPanel` 中新增 category 的 checkbox
   - 添加对应的 i18n 文本

8. **测试**
   - `tests/unit/tools/{category}.test.ts`：覆盖每个 action 的 schema 和 handler
   - `tests/integration/server.test.ts`：确保新 tool 出现在 `listTools()` 中
   - `tests/unit/cli/flag-mapper.test.ts`：若 CLI 暴露新 flag，验证映射

9. **文档**
   - `docs/reference/tools/{category}.md` 和 `docs/zh/reference/tools/{category}.md`
   - 更新 `API_MCP_MAPPING.md`

#### 依赖关系

```
api/{category}.ts  →  types/api.d.ts
     ↓
tools/{category}/index.ts → tools/internal/define-tool.ts → tools/internal/shared.ts → config.ts + help.ts + types.ts
     ↓
tool-registry.ts
     ↓
resources.ts (可选)
```

---

### 2. 在现有工具类别中新增动作

如果只是为已有 category 增加新 action，步骤大幅简化：

1. **API 封装**：在对应 `src/api/{category}.ts` 中添加函数
2. **配置定义**：在 `src/core/config.ts` 的 `ACTIONS_BY_CATEGORY[category]` 中新增 action 名
3. **工具实现**：在对应 `src/tools/{category}/index.ts` 的 `variants` 数组中新增 variant
4. **帮助文案**：在 `src/core/help.ts` 中添加 action hint
5. **测试**：在 `tests/unit/tools/{category}.test.ts` 中覆盖新 action
6. **文档**：更新对应参考页和 `API_MCP_MAPPING.md`

**注意**：tool description 和 config action 列表**必须保持一致**。如果 action 在 config 中列出但未在 variants 中实现，或反之，都会导致运行时错误或不一致的用户体验。

---

### 3. 新增帮助资源

MCP 资源是静态或动态的帮助文档，AI 客户端可通过 `ReadResourceRequest` 获取。

#### 新增静态资源

在 `src/core/resources.ts` 中：
1. 在 `listHelpResources()` 中新增资源元数据
2. 在 `readHelpResource()` 中新增 URI 匹配分支
3. 在 `src/core/help.ts` 中定义资源内容文本

#### 新增动态资源模板

动态资源模板遵循 `siyuan://help/action/{tool}/{action}` 模式。如需新增其他模板：
1. 在 `listHelpResourceTemplates()` 中新增模板 URI
2. 在 `readHelpResource()` 中解析新模板的参数并路由到对应生成逻辑

---

### 4. 扩展 CLI 渲染

CLI 的结果渲染在 `src/cli/render.ts` 中。如需支持新的 payload 类型：

1. 在 `renderSuccessPayload()` 的 type-guard 分支中新增识别逻辑
2. 实现对应的渲染函数（参考现有的 `renderArrayPayload()` / `renderPaginatedPayload()` 等）
3. 确保 `--json` 模式下该 payload 能被 `JSON.stringify` 正确处理

**注意**：新增渲染逻辑时，应同时更新 `src/shared/invocation-format.ts`，确保 MCP 和 CLI 模式下的帮助文本保持一致。

---

### 5. 扩展设置面板 UI

设置面板使用 Svelte 组件，与 SiYuan 原生 UI（`b3-tab-bar`、`b3-list`）融合。

#### 新增配置项

1. 在 `src/ui/setting/tool-config.ts` 或相关 schema 文件中定义新字段
2. 在 `src/ui/setting/tool-config-storage.ts` 中添加 `loadXxx()` / `saveXxx()` 函数
3. 在 `src/ui/setting/mcp-config.svelte` 的 `onChanged` 分发器中添加 key 前缀路由
4. 在对应子面板组件中添加 UI 控件
5. 在 `src/index.ts` 的 `onload()` 中加载新配置

#### 新增子面板

1. 在 `src/ui/setting/mcp-config/` 下新建 Svelte 组件
2. 在 `src/ui/setting/mcp-config.svelte` 的 tab-bar 和 content 区域中注册新面板
3. 添加 i18n 文本到 `dev/i18n/` 和 `public/i18n/`

---

### 6. 扩展传输层

当前支持 stdio 和 HTTP/S。如需新增传输方式：

1. 在 `src/core/` 下新建传输实现文件（如 `websocket-transport.ts`）
2. 实现 MCP SDK 的传输接口
3. 在 `src/core/server.ts` 的 `startMcpServer()` 中新增 transport mode 分支
4. 在设置面板 `HttpServerPanel`（或新建面板）中添加配置 UI
5. 更新文档说明新传输方式的使用方法

---

## 边界约束

### 安全边界

| 约束 | 说明 | 违反后果 |
|------|------|----------|
| **必须通过 SiYuan API 访问数据** | 所有数据读写（文件、配置、权限）都经过 `SiYuanClient` | 违反会导致远程场景不安全，插件审核被拒 |
| **笔记本权限必须继续生效** | 任何 notebook-scoped 的 mutation 操作前必须调用 `ensurePermissionForDocumentId` / `ensurePermissionForNotebook` | 违反会导致权限模型形同虚设 |
| **高危操作必须标记** | 新增 destructive action 必须加入 `DANGEROUS_ACTIONS` | 违反会导致 AI 意外执行危险操作 |
| **HTTP 非 loopback 必须启用 token** | 若 HTTP server 绑定到非 127.0.0.1，必须有 token 鉴权 | 违反会导致未授权远程访问 |
| **CLI 不做二次确认** | CLI 的危险动作不弹窗确认（用户主动输入即确认） | 不要试图在 CLI 中添加交互式确认，会破坏脚本化使用 |

### 代码边界

| 约束 | 说明 |
|------|------|
| **不要修改 TOOL_REGISTRY 的静态结构** | 保持 `Record<ToolCategory, ToolModule>` 的编译期确定性，不要引入动态扫描或反射 |
| **不要破坏 Zod Schema 的一致性** | `src/tools/{category}/schemas.ts` 中的 schema 必须与 `config.ts` 中的 action 列表和 `tools/{category}/index.ts` 中的 variant schema 保持一致 |
| **不要引入全局状态** | `SiYuanClient`、`PermissionManager` 等应作为参数传递，不要保存在模块级变量中（CLI 和插件可能同时存在多个实例） |
| **保持 CJS 输出格式** | Vite 配置中所有产物都是 CommonJS，不要引入 ESM-only 依赖 |
| **Node 内置模块保持 external** | server/cli 的 Rollup external 中保留 Node 内置模块，不要打包进 bundle |

### 文档边界

| 约束 | 说明 |
|------|------|
| **工具文档必须与配置动作列表对齐** | `docs/zh|en/reference/tools/{category}.md` 中的动作列表必须与 `src/core/config.ts` 中的 `ACTIONS_BY_CATEGORY` 完全一致 |
| **双语同步** | 所有文档变更必须同时更新 `zh/` 和 `en/` 版本 |
| **API 映射文档必须同步更新** | 新增 action 必须更新 `API_MCP_MAPPING.md` 和 `API_COMPLETE_MAPPING.md` |

---

## 测试策略

### 新增工具/动作的测试要求

| 测试类型 | 必做 | 验证内容 |
|----------|------|----------|
| **动作 Schema 暴露** | ✓ | 新动作出现在 `inputSchema.properties.action.enum` 中 |
| **Handler 逻辑** | ✓ | mock `SiYuanClient` 和 `PermissionManager`，验证 handler 行为 |
| **Zod 校验** | ✓ | 有效/无效参数分别测试 |
| **权限检查** | ✓（若涉及 notebook-scoped mutation） | mock 不同权限级别，验证拦截行为 |
| **Help 输出** | ✓ | `action="help"` 返回正确的帮助内容 |
| **集成测试** | ✓ | 新 tool 出现在 `listTools()` 结果中；端到端调用返回预期结果 |
| **Schema 快照** | 建议 | `tests/unit/tools/help-output.snapshot.test.ts` 锁定 help 输出 |
| **CLI Flag 映射** | 建议（若 CLI 暴露新 flag） | 验证 kebab↔camel 映射和类型强转 |

### 测试运行命令

```bash
pnpm test              # 运行 unit + integration 测试
pnpm test:watch        # watch 模式
pnpm test:coverage     # 覆盖率报告
pnpm test:smoke        # 冒烟测试（需要真实 SiYuan 实例）
```

---

## 发布检查清单

当你完成扩展开发后，按以下顺序验证：

- [ ] `pnpm build` 成功，无 TypeScript 错误
- [ ] `pnpm build:cli` 成功
- [ ] `pnpm test` 全部通过
- [ ] `pnpm test:smoke` 通过（如适用）
- [ ] 文档已更新（zh + en）
- [ ] `API_MCP_MAPPING.md` 已更新
- [ ] 设置面板 UI 已更新（如适用）
- [ ] i18n 文本已补充（如适用）
- [ ] CHANGELOG.md 已记录
