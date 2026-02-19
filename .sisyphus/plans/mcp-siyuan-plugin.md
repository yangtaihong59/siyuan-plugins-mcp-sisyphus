# MCP 思源笔记插件 - 工作规划

## TL;DR

> **目标**: 开发一个思源笔记插件，提供MCP服务器功能，让AI助手可以通过Model Context Protocol协议与思源笔记进行完整交互。
> 
> **交付物**:
> - MCP服务器实现 (stdio模式)
> - 思源笔记API封装层
> - 插件配置面板 (Svelte)
> - 进程管理模块
> - 类型定义和工具
> 
> **估算规模**: Medium
> **执行模式**: 并行化执行，预计4个Wave
> **关键路径**: API封装 → MCP核心 → 配置面板 → 集成测试

---

## Context

### 原始需求
用户希望基于现有的Vite+Svelte思源插件模板，开发一个MCP插件，支持思源笔记的完整API。

### 讨论确认
- ✅ **全部API支持**: 笔记本、文档、块、属性、文件、模板等
- ✅ **独立进程模式**: MCP服务器作为独立进程运行
- ✅ **不使用SQL**: 通过标准API访问
- ✅ **自动Token管理**: 从思源内部获取API Token
- ✅ **可视化配置**: 在插件设置面板中配置
- ✅ **主要场景**: AI知识库管理

### MCP协议要点
- 使用stdio传输模式
- 提供Tools（可执行功能）和Resources（可读数据源）
- 支持参数验证和错误处理
- 与思源内核通过HTTP API通信

---

## Work Objectives

### 核心目标
创建一个完整的MCP服务器，将思源笔记API暴露给AI助手，实现AI驱动的知识库管理。

### 具体交付物
1. **MCP服务器核心** (`src/mcp/server.ts`)
   - 基于@modelcontextprotocol/sdk实现
   - stdio传输模式
   - 请求路由和错误处理
   
2. **思源API封装层** (`src/api/`)
   - 完整的API类型定义
   - HTTP客户端封装
   - Token自动获取
   - 错误处理和重试逻辑

3. **MCP工具实现** (`src/mcp/tools/`)
   - 25+个MCP工具映射
   - 参数验证 (Zod)
   - 结果格式化

4. **配置面板** (`src/setting/`)
   - Svelte组件
   - 进程状态显示
   - 启动/停止控制
   - 配置持久化

5. **进程管理** (`src/mcp/process.ts`)
   - 子进程管理
   - 生命周期控制
   - 日志收集

### 定义完成
- [ ] MCP服务器可通过stdio正常通信
- [ ] 所有核心工具(25+)实现并通过测试
- [ ] 配置面板可正常显示和操作
- [ ] 插件可在思源中正常安装和运行
- [ ] 提供使用示例

### 必须包含
- 笔记本管理 (6个API)
- 文档管理 (5个API)
- 块操作 (11个API)
- 属性管理 (2个API)
- 文件操作 (5个API)
- 资源上传 (1个API)
- 模板渲染 (2个API)
- 系统接口 (3个API)

### 明确排除
- 直接SQL查询 (使用标准API代替)
- HTTP传输模式 (仅stdio)
- 实时WebSocket同步 (后续版本)
- 第三方MCP工具集成

---

## Verification Strategy

### 测试策略
- **单元测试**: API封装层使用bun test
- **集成测试**: MCP工具端到端测试
- **手动验证**: 配置面板交互

### QA策略
每个任务包含Agent-Executed QA场景：
- 类型检查: `tsc --noEmit`
- 构建验证: `vite build`
- 功能验证: 实际调用API并检查结果
- 错误处理: 测试异常情况

---

## Execution Strategy

### 并行执行波次

```
Wave 1 (基础架构 - 5个任务并行):
├── Task 1: MCP SDK集成和基础类型
├── Task 2: 思源HTTP客户端封装
├── Task 3: Token自动获取实现
├── Task 4: 基础API类型定义
└── Task 5: 错误处理工具

Wave 2 (API封装 - 6个任务并行):
├── Task 6: 笔记本管理API封装
├── Task 7: 文档管理API封装
├── Task 8: 块操作API封装
├── Task 9: 属性管理API封装
├── Task 10: 文件操作API封装
└── Task 11: 资源和模板API封装

Wave 3 (MCP工具 - 6个任务并行):
├── Task 12: 笔记本管理MCP工具
├── Task 13: 文档管理MCP工具
├── Task 14: 块操作MCP工具(1/2)
├── Task 15: 块操作MCP工具(2/2)
├── Task 16: 文件和资源MCP工具
└── Task 17: 系统通知MCP工具

Wave 4 (集成和UI - 4个任务):
├── Task 18: MCP服务器组装
├── Task 19: 进程管理模块
├── Task 20: 配置面板UI
└── Task 21: 插件入口集成

Wave 5 (测试和文档 - 3个任务):
├── Task 22: 单元测试
├── Task 23: 集成测试
└── Task 24: 文档和示例
```

### 依赖矩阵

| 任务 | 依赖 | 阻塞 | Wave |
|------|------|------|------|
| 1-5 | - | 6-11 | 1 |
| 6-11 | 1-5 | 12-17 | 2 |
| 12-17 | 6-11 | 18 | 3 |
| 18-21 | 12-17, 3 | 22-24 | 4 |
| 22-24 | 18-21 | - | 5 |

### Agent分配

| Wave | 任务 | Agent类别 | 说明 |
|------|------|-----------|------|
| 1 | 1-5 | `quick` | 基础架构，类型定义 |
| 2 | 6-11 | `unspecified-high` | API封装，需要理解API |
| 3 | 12-17 | `unspecified-high` | MCP工具实现 |
| 4 | 18-21 | `deep` | 系统集成，UI |
| 5 | 22-24 | `unspecified-high` | 测试和文档 |

---

## TODOs

- [x] 1. MCP SDK集成和基础类型

  **What to do**:
  - 安装 @modelcontextprotocol/sdk 依赖
  - 创建基础类型定义文件 (`src/mcp/types.ts`)
  - 实现MCP服务器基础类
  - 定义Tool和Resource的接口

  **Must NOT do**:
  - 不要实现具体的工具逻辑
  - 不要引入思源特定的类型

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: 基础类型定义和SDK集成，主要是配置和接口定义
  - **Skills**: 无需特殊技能

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 12-17 (MCP工具实现)
  - **Blocked By**: None

  **References**:
  - Package: `@modelcontextprotocol/sdk`
  - Pattern: TypeScript interface definitions
  - File: `src/types/api.d.ts` - 参考现有类型定义风格

  **Acceptance Criteria**:
  - [ ] `bun add @modelcontextprotocol/sdk` 成功
  - [ ] `src/mcp/types.ts` 存在且包含基础类型
  - [ ] `tsc --noEmit` 无类型错误

  **QA Scenarios**:
  ```
  Scenario: SDK安装成功
    Tool: Bash
    Steps:
      1. bun add @modelcontextprotocol/sdk
      2. cat package.json | grep sdk
    Expected Result: package.json中包含@modelcontextprotocol/sdk
    Evidence: .sisyphus/evidence/task-1-sdk-installed.txt

  Scenario: 类型检查通过
    Tool: Bash
    Steps:
      1. npx tsc --noEmit
    Expected Result: 无错误输出，exit code 0
    Evidence: .sisyphus/evidence/task-1-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(mcp): add MCP SDK and base types`
  - Files: `package.json`, `src/mcp/types.ts`

- [x] 2. 思源HTTP客户端封装

  **What to do**:
  - 创建HTTP客户端 (`src/api/client.ts`)
  - 实现请求拦截器 (添加Token)
  - 实现响应处理 (统一错误格式)
  - 添加请求超时配置

  **Must NOT do**:
  - 不要硬编码API Token
  - 不要实现具体API方法

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: 基础HTTP客户端封装

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: Task 6-11 (API封装)

  **References**:
  - Pattern: `src/api.ts` - 参考现有API调用方式
  - API规范: `API_zh_CN.md` - 请求格式和认证

  **Acceptance Criteria**:
  - [ ] HTTP客户端支持POST JSON
  - [ ] 支持动态Token注入
  - [ ] 统一的错误处理

  **QA Scenarios**:
  ```
  Scenario: 客户端类型定义完整
    Tool: Bash
    Steps:
      1. npx tsc --noEmit
      2. grep -r "class SiYuanClient" src/
    Expected Result: SiYuanClient类存在且类型完整
    Evidence: .sisyphus/evidence/task-2-client-class.txt
  ```

  **Commit**: YES (与Task 1合并)

- [x] 3. Token自动获取实现

  **What to do**:
  - 研究思源如何获取API Token
  - 实现Token获取函数
  - 添加Token缓存机制
  - 处理Token失效情况

  **Must NOT do**:
  - 不要暴露Token到前端
  - 不要持久化存储Token

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: 需要了解思源内部API

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: Task 6-11

  **References**:
  - Code: `src/index.ts` - 参考插件API使用
  - API: 思源内部设置API

  **Acceptance Criteria**:
  - [ ] 能正确获取当前用户Token
  - [ ] Token缓存有效
  - [ ] 失效时自动刷新

  **QA Scenarios**:
  ```
  Scenario: Token获取函数存在
    Tool: Bash
    Steps:
      1. grep -r "getToken\|getApiToken" src/
    Expected Result: Token获取函数已定义
    Evidence: .sisyphus/evidence/task-3-token-function.txt
  ```

  **Commit**: YES

- [x] 4. 基础API类型定义

  **What to do**:
  - 扩展 `src/types/api.d.ts`
  - 添加所有API的Request/Response类型
  - 添加通用响应类型
  - 添加错误类型

  **Must NOT do**:
  - 不要修改现有类型（除非必要）
  - 不要添加MCP特定的类型

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: 纯类型定义工作

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: Task 6-11

  **References**:
  - API文档: `API_zh_CN.md` - 完整的请求/响应格式
  - Current: `src/types/api.d.ts` - 现有类型

  **Acceptance Criteria**:
  - [ ] 覆盖全部35+ API
  - [ ] 类型命名规范统一
  - [ ] 无类型错误

  **QA Scenarios**:
  ```
  Scenario: 类型定义完整
    Tool: Bash
    Steps:
      1. wc -l src/types/api.d.ts
      2. grep "export interface" src/types/api.d.ts | wc -l
    Expected Result: 类型定义行数 > 100，接口数量 > 30
    Evidence: .sisyphus/evidence/task-4-types-complete.txt
  ```

  **Commit**: YES

- [x] 5. 错误处理工具

  **What to do**:
  - 创建错误处理工具 (`src/libs/error.ts`)
  - 定义API错误类型
  - 实现错误转换函数
  - 添加日志工具

  **Must NOT do**:
  - 不要引入复杂的状态管理
  - 不要依赖特定UI库

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: 工具函数实现

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 1)
  - **Blocks**: Task 6-11

  **References**:
  - Pattern: 标准Error类和自定义错误类型

  **Acceptance Criteria**:
  - [ ] SiYuanError类实现
  - [ ] 错误码映射
  - [ ] 日志工具可用

  **QA Scenarios**:
  ```
  Scenario: 错误处理工具可用
    Tool: Bash
    Steps:
      1. npx tsc --noEmit
      2. grep "class SiYuanError" src/libs/error.ts
    Expected Result: 错误类已定义
    Evidence: .sisyphus/evidence/task-5-error-tools.txt
  ```

  **Commit**: YES

- [x] 6. 笔记本管理API封装

  **What to do**:
  - 实现笔记本列表 (`list_notebooks`)
  - 实现打开/关闭笔记本
  - 实现创建/删除笔记本
  - 实现重命名笔记本
  - 实现获取/设置配置

  **Must NOT do**:
  - 不要添加业务逻辑
  - 只做API透传和类型转换

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: 需要理解思源API语义

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocked By**: Task 2, 3, 4, 5
  - **Blocks**: Task 12

  **References**:
  - API: `/api/notebook/*` 端点
  - Types: `src/types/api.d.ts` - Notebook相关

  **Acceptance Criteria**:
  - [ ] 7个API方法实现
  - [ ] 类型完整
  - [ ] 错误处理正确

  **QA Scenarios**:
  ```
  Scenario: API方法存在
    Tool: Bash
    Steps:
      1. grep "async listNotebooks\|async createNotebook" src/api/notebook.ts
    Expected Result: 方法已定义
    Evidence: .sisyphus/evidence/task-6-notebook-api.txt
  ```

  **Commit**: YES

- [x] 7. 文档管理API封装

- [x] 8. 块操作API封装 (Part 1)

- [x] 9. 块操作API封装 (Part 2)

- [x] 10. 属性管理API封装

- [x] 11. 文件操作和资源API封装

  **What to do**:
  - 实现文件CRUD (`getFile`, `putFile`, `removeFile`, `renameFile`)
  - 实现目录列表 (`readDir`)
  - 实现资源上传 (`uploadAsset`)
  - 实现模板渲染 (`renderTemplate`, `renderSprig`)
  - 实现导出功能 (`exportMdContent`, `exportResources`)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Blocked By**: Task 2-5
  - **Blocks**: Task 16

  **Acceptance Criteria**:
  - [ ] 9个API方法实现
  - [ ] 文件上传支持multipart

  **Commit**: YES

- [x] 12. 笔记本管理MCP工具
- [x] 13. 文档管理MCP工具
- [x] 14. 块操作MCP工具 (Part 1)
- [x] 15. 块操作MCP工具 (Part 2)
- [x] 16. 文件和资源MCP工具
- [x] 17. 系统通知MCP工具
- [x] 18. MCP服务器组装
- [x] 19. 进程管理模块
- [x] 20. 配置面板UI
- [x] 21. 插件入口集成

  **What to do**:
  - 修改 `src/index.ts`
  - 注册设置面板
  - 实现插件启动时自动启动MCP (根据配置)
  - 实现插件卸载时清理资源
  - 添加顶部栏图标和菜单

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Blocked By**: Task 20
  - **Blocks**: Task 22-24

  **Acceptance Criteria**:
  - [ ] 插件可正常加载
  - [ ] 设置面板可从顶部栏打开
  - [ ] 插件卸载时进程已终止

  **QA Scenarios**:
  ```
  Scenario: 插件可构建
    Tool: Bash
    Steps:
      1. pnpm run build
    Expected Result: 构建成功，无错误
    Evidence: .sisyphus/evidence/task-21-build.txt
  ```

  **Commit**: YES

- [ ] 22. 单元测试

  **What to do**:
  - 为API客户端编写测试
  - 为MCP工具编写测试 (mock模式)
  - 为工具函数编写测试
  - 配置测试覆盖率

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Blocked By**: Task 18-21

  **Acceptance Criteria**:
  - [ ] 核心模块测试覆盖率 > 60%
  - [ ] 测试可运行

  **Commit**: YES

- [ ] 23. 集成测试

  **What to do**:
  - 编写端到端测试脚本
  - 测试MCP服务器完整流程
  - 测试实际API调用 (需要思源运行)
  - 记录测试结果

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Blocked By**: Task 18-21

  **Acceptance Criteria**:
  - [ ] MCP服务器可正确响应请求
  - [ ] 至少5个核心流程通过测试

  **Commit**: YES

- [x] 24. 文档和示例

  **What to do**:
  - 编写README文档
  - 添加MCP配置示例 (Claude/Cursor等)
  - 添加使用指南
  - 添加API文档索引
  - 准备发布说明

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Blocked By**: Task 18-21

  **Acceptance Criteria**:
  - [ ] README完整
  - [ ] 配置示例可用
  - [ ] 使用指南清晰

  **Commit**: YES

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| Wave 1 | `feat(mcp): add MCP SDK and infrastructure` | src/mcp/types.ts, src/api/client.ts, src/libs/error.ts | tsc --noEmit |
| Wave 2 | `feat(api): add SiYuan API wrappers` | src/api/*.ts | tsc --noEmit |
| Wave 3 | `feat(tools): implement MCP tools` | src/mcp/tools/*.ts | tsc --noEmit |
| Wave 4 | `feat(integration): add UI and process management` | src/setting/*.svelte, src/index.ts | vite build |
| Wave 5 | `feat(tests): add tests and documentation` | tests/, docs/ | bun test |

---

## Success Criteria

### Verification Commands
```bash
# 类型检查
npx tsc --noEmit

# 构建
pnpm run build

# 单元测试
bun test

# 功能验证 (需要思源运行)
curl -X POST http://127.0.0.1:6806/api/notebook/lsNotebooks \
  -H "Authorization: Token $(cat ~/.config/siyuan/token)" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Final Checklist
- [ ] 所有35+ API封装完成
- [ ] 25+ MCP工具实现
- [ ] 配置面板可正常使用
- [ ] MCP服务器可独立启动
- [ ] 类型检查通过
- [ ] 构建成功
- [ ] 基础测试通过
