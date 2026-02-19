# MCP Plugin Refactoring Plan

## 目标
重构 MCP 插件，移除顶栏图标，使用思源内置设置面板，并添加41个工具的独立开关功能。

## 需求变更

### 1. 移除顶栏 MCP 设置图标
- [x] 删除 `src/index.ts` 中的顶栏图标代码 (line 326-331)
- [x] 删除 `src/index-full.ts` 中的对应代码

### 2. 使用思源标准设置面板
- [x] 删除 `openMCPSettings()` 私有方法
- [x] 删除 `mcpDialog` 和 `mcpComponent` 相关代码
- [x] 修改设置入口使用 SettingUtils

### 3. 创建新的设置组件
- [x] 创建 `src/setting/mcp-config.svelte`
- [x] 基于 `setting-example.svelte` 模板
- [x] 实现4个分组标签页

### 4. 添加工具开关配置
- [x] Notebook Tools (8个): checkbox 开关
- [x] Document Tools (11个): checkbox 开关
- [x] Block Tools (13个): checkbox 开关
- [x] File Tools (9个): checkbox 开关

### 5. 数据持久化
- [x] 使用 SettingUtils 保存工具开关配置
- [x] 默认所有工具启用

### 6. MCP Server 集成
- [x] 修改 `src/mcp/server.ts` 读取配置
- [x] 根据配置启用/禁用工具注册

### 7. 更新 i18n
- [x] 添加41个工具的中英文名称

## 文件变更

### 修改
- `src/index.ts`
- `src/index-full.ts`
- `src/mcp/server.ts`
- `public/i18n/en_US.json`
- `public/i18n/zh_CN.json`

### 删除
- `src/setting/mcp-setting.svelte`

### 新建
- `src/setting/mcp-config.svelte`
