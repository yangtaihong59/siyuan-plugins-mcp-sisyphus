# MCP 设置保存修复计划

## 问题
设置面板中关闭工具后，退出再打开设置，开关仍然是开着的，且 MCP 服务器没有关闭对应工具。

## 根本原因

### 1. mcp-config.svelte 缺少保存逻辑
- `onChanged` 事件只打印日志，没有调用 SettingUtils.save()
- 组件初始化时没有从 SettingUtils 加载配置

### 2. MCP 服务器配置传递问题
- MCP 服务器通过环境变量 `SIYUAN_MCP_TOOLS` 读取配置
- 但插件没有将用户设置导出到环境变量
- 需要改为读取配置文件方式

## 修复方案

### 方案 A: 使用思源存储系统
1. 在 `mcp-config.svelte` 中使用 `plugin.saveStorage()` 保存配置
2. MCP 服务器通过思源 API 读取配置

### 方案 B: 使用配置文件（推荐）
1. 插件将配置保存到 `data/mcp-tools.json`
2. MCP 服务器读取该配置文件

### 方案 C: 启动时传递配置
1. 用户在 Cursor MCP 配置中手动指定要启用的工具
2. 不通过插件 UI 控制

## 实施步骤（采用方案 B）

### 1. 修改 mcp-config.svelte
- [ ] 添加 props 接收 plugin 实例
- [ ] 在 onChanged 中保存配置到 plugin.storage
- [ ] 在 onMount 中加载已保存的配置
- [ ] 动态更新 checkbox 状态

### 2. 修改 index.ts 的 openSetting
- [ ] 传递 plugin 实例给 McpConfig

### 3. 修改 MCP 服务器
- [ ] 改为读取配置文件 `data/mcp-tools.json`
- [ ] 如果文件不存在，默认启用所有工具

### 4. 添加配置文件写入
- [ ] 在 index.ts 中添加保存配置的方法
- [ ] 将配置写入插件数据目录

### 5. 构建验证
- [x] 运行 pnpm run build
- [x] 构建成功（有一个 vite 警告但不影响功能）

## 文件变更

### 修改
- `src/setting/mcp-config.svelte`
- `src/index.ts`
- `src/index-full.ts`
- `src/mcp/server.ts`

## 配置格式

```json
{
  "list_notebooks": true,
  "create_notebook": false,
  ...
}
```
