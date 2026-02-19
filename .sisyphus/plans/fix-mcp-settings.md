# MCP 设置面板修复计划

## 问题
设置面板没有正确显示 MCP 配置选项。

## 根本原因
1. `src/index.ts` 第35行仍在导入旧的 `mcp-setting.svelte`
2. `openSetting()` 方法使用的是 `SettingExample` 组件，而不是新的 `mcp-config.svelte`

## 修复任务

### 1. 修复导入语句
- [ ] 文件: `src/index.ts`
- [ ] 修改第35行: 将 `import MCPSetting from "@/setting/mcp-setting.svelte";` 改为 `import McpConfig from "@/setting/mcp-config.svelte";`
- [ ] 文件: `src/index-full.ts`
- [ ] 同样修改导入语句

### 2. 修复 openSetting 方法
- [ ] 文件: `src/index.ts`
- [ ] 修改 `openSetting()` 方法 (line 382-396)
- [ ] 将 `SettingExample` 替换为 `McpConfig`
- [ ] 或者添加新的标签页来显示 MCP 配置
- [ ] 文件: `src/index-full.ts`
- [ ] 同样修改 openSetting 方法

### 3. 构建验证
- [ ] 运行 `pnpm run build`
- [ ] 确认无错误

## 预期结果
打开插件设置后，应该能看到包含41个工具开关的 MCP 配置面板。
