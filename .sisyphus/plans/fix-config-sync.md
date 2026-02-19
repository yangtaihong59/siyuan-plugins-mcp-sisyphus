# MCP 配置文件同步修复计划

## 问题
设置面板关闭 tool 后，MCP 服务器仍然可以调用该 tool。

## 根本原因
**存储方式不匹配**：
- 插件使用 `plugin.saveData()` 保存到思源内部存储
- MCP 服务器从文件系统读取配置
- 两者没有同步！

## 修复方案

### 方案：统一使用文件系统存储
修改插件将配置写入文件，MCP 服务器读取同一文件。

**配置文件的完整路径**：
```
${SIYUAN_DATA_DIR}/plugins/siyuan-mcp/mcp-tools.json
```

## 实施步骤

### 1. 修改 mcp-config.svelte
- [ ] 添加文件系统写入逻辑
- [ ] 使用 `fs.writeFileSync` 写入配置文件
- [ ] 配置文件路径: `data/plugins/siyuan-mcp/mcp-tools.json`

### 2. 修改 index.ts
- [ ] 在插件加载时创建配置目录
- [ ] 提供保存配置到文件的方法

### 3. 验证 MCP 服务器读取
- [ ] 确认 server.ts 能正确读取配置文件
- [ ] 确认工具注册时检查配置

### 4. 测试
- [ ] 在设置面板关闭 tool
- [ ] 检查配置文件是否正确写入
- [ ] 重启 MCP 服务器，确认 tool 不可用

## 文件变更

### 修改
- `src/setting/mcp-config.svelte`
- `src/index.ts`
- `src/index-full.ts`

## 配置格式

```json
{
  "list_notebooks": true,
  "create_notebook": false,
  "open_notebook": true,
  ...
}
```
