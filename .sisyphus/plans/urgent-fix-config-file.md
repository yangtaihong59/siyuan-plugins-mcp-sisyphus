# 紧急修复：配置文件同步

## 问题
设置面板关闭 tool 后，MCP 服务器仍然可以调用该 tool。

## 修复任务

### 1. 修改 mcp-config.svelte 添加文件写入
**位置**: `src/setting/mcp-config.svelte`

**修改 onMount 函数** (line 72-80):
```typescript
// 改为：
onMount(async () => {
    if (plugin) {
        // Try to load from file system first
        const fileConfig = await loadConfigFromFile();
        if (fileConfig) {
            config = { ...defaultConfig, ...fileConfig };
        } else {
            const saved = await plugin.loadData('mcpToolsConfig');
            if (saved) {
                config = { ...defaultConfig, ...saved };
            }
        }
        updateCheckboxValues();
    }
});
```

**添加 saveConfigToFile 函数**:
```typescript
async function saveConfigToFile(configData: Record<string, boolean>) {
    try {
        const response = await fetch('/api/file/putFile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: 'plugins/siyuan-mcp/mcp-tools.json',
                content: btoa(unescape(encodeURIComponent(JSON.stringify(configData, null, 2)))),
                isDir: false
            })
        });
        if (response.ok) {
            console.debug('Config saved to file system');
        }
    } catch (error) {
        console.error('Error saving config:', error);
    }
}
```

**添加 loadConfigFromFile 函数**:
```typescript
async function loadConfigFromFile(): Promise<Record<string, boolean> | null> {
    try {
        const response = await fetch('/api/file/getFile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: 'plugins/siyuan-mcp/mcp-tools.json' })
        });
        if (response.ok) {
            const data = await response.json();
            if (data.content) {
                const decoded = decodeURIComponent(escape(atob(data.content)));
                return JSON.parse(decoded);
            }
        }
    } catch (error) {
        console.debug('No config file found');
    }
    return null;
}
```

**修改 onChanged** (line 166-180):
在 `await plugin.saveData('mcpToolsConfig', config);` 后添加：
```typescript
await saveConfigToFile(config);
```

**修改 saveSettings** (line 183-188):
在 `plugin.saveData(...)` 后添加：
```typescript
await saveConfigToFile(config);
```

**修改 resetDefaults** (line 191-198):
在 `plugin.saveData(...)` 后添加：
```typescript
await saveConfigToFile(config);
```

### 2. 构建验证
- [x] pnpm run build (已完成)

## 关键代码
配置文件路径: `plugins/siyuan-mcp/mcp-tools.json`
