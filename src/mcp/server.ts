import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'path';
import fs from 'fs';

import { SiYuanClient } from '../api/client';
import * as notebookTools from './tools/notebook';
import * as documentTools from './tools/document';
import * as blockTools from './tools/block';
import * as fileTools from './tools/file';

const SERVER_INSTRUCTIONS = `
## 高危操作确认 (High-risk operations)

在调用以下工具**之前**，你必须先向用户明确说明将要执行的操作，并等待用户明确同意后再调用。未经用户确认不得直接调用。

Before calling any of the following tools, you MUST clearly describe the action to the user and wait for explicit confirmation. Do not call them without user confirmation.

**必须确认的高危工具 / Tools that require confirmation:**
- remove_notebook, remove_document, remove_document_by_id（删除笔记本/文档）
- delete_block（删除块）
- move_documents, move_documents_by_id, move_block（移动文档/块，可能影响结构）

流程：先说明「我将执行 X，是否继续？」→ 用户同意后再调用工具。
Flow: State "I will do X. Proceed?" → only call the tool after user confirms.

使用 append_block 工具时，请注意：如果parentID为文档ID，则会在文档开头添加块；如果parentID为块ID，则会在块末尾添加块。
`;

interface ToolConfig {
    [category: string]: boolean | string[];
}

/**
 * 尝试从文件系统读取配置文件
 */
function tryReadConfigFromFileSystem(): Record<string, boolean> | null {
    // 尝试多个可能的路径
    const possiblePaths: string[] = [];
    
    // 1. 环境变量指定的路径（优先）
    // 思源的 /plugins/ 路径映射到 ${SIYUAN_DATA_DIR}/plugins/ 或 ${SIYUAN_DATA_DIR}/data/plugins/
    const envDataDir = process.env.SIYUAN_DATA_DIR;
    if (envDataDir) {
        // 尝试两种可能的路径结构
        possiblePaths.push(path.join(envDataDir, 'plugins', 'siyuan-mcp-sisyphus', 'mcp-tools.json'));
        possiblePaths.push(path.join(envDataDir, 'data', 'plugins', 'siyuan-mcp-sisyphus', 'mcp-tools.json'));
    }
    
    // 2. 常见的数据目录路径（macOS/Linux/Windows）
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (homeDir) {
        // macOS: ~/SiYuan/plugins/siyuan-mcp-sisyphus/mcp-tools.json (自定义数据目录，优先)
        possiblePaths.push(path.join(homeDir, 'SiYuan', 'plugins', 'siyuan-mcp-sisyphus', 'mcp-tools.json'));
        // macOS/Linux: ~/.siyuan/data/plugins/siyuan-mcp-sisyphus/mcp-tools.json
        possiblePaths.push(path.join(homeDir, '.siyuan', 'data', 'plugins', 'siyuan-mcp-sisyphus', 'mcp-tools.json'));
        // macOS/Linux: ~/.siyuan/plugins/siyuan-mcp-sisyphus/mcp-tools.json
        possiblePaths.push(path.join(homeDir, '.siyuan', 'plugins', 'siyuan-mcp-sisyphus', 'mcp-tools.json'));
        // Windows: %APPDATA%/SiYuan/data/plugins/siyuan-mcp-sisyphus/mcp-tools.json
        if (process.platform === 'win32') {
            const appData = process.env.APPDATA || '';
            if (appData) {
                possiblePaths.push(path.join(appData, 'SiYuan', 'data', 'plugins', 'siyuan-mcp-sisyphus', 'mcp-tools.json'));
                possiblePaths.push(path.join(appData, 'SiYuan', 'plugins', 'siyuan-mcp-sisyphus', 'mcp-tools.json'));
            }
        }
    }
    
    console.error('[MCP] Trying to load config from file system. Checking paths:');
    for (const configPath of possiblePaths) {
        console.error(`[MCP]   - ${configPath} (exists: ${fs.existsSync(configPath)})`);
        if (fs.existsSync(configPath)) {
            try {
                const content = fs.readFileSync(configPath, 'utf-8');
                const fileConfig = JSON.parse(content);
                console.error(`[MCP] ✓ Loaded config from: ${configPath}`);
                console.error(`[MCP] Config content: ${JSON.stringify(fileConfig, null, 2)}`);
                return fileConfig;
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error(`[MCP] ✗ Failed to parse config file ${configPath}:`, errorMsg);
            }
        }
    }
    
    console.error('[MCP] ✗ Config file not found in any of the checked paths');
    return null;
}

/**
 * 通过思源 API 读取配置文件
 */
async function tryReadConfigFromAPI(client: SiYuanClient): Promise<Record<string, boolean> | null> {
    try {
        // 思源 API: /api/file/getFile 读取文件内容
        const configPath = '/plugins/siyuan-mcp-sisyphus/mcp-tools.json';
        const content = await client.request<string>('/api/file/getFile', { path: configPath });
        if (content && typeof content === 'string') {
            const fileConfig = JSON.parse(content);
            console.error(`[MCP] Loaded config from API: ${configPath}`);
            return fileConfig;
        }
    } catch (error) {
        // 文件不存在或 API 错误，忽略（这是正常的，如果配置文件不存在）
        // 不输出错误日志，因为这是正常情况
    }
    return null;
}

/**
 * 读取工具配置
 * 配置文件路径: ${SIYUAN_DATA_DIR}/data/plugins/siyuan-mcp-sisyphus/mcp-tools.json
 * （思源的虚拟路径 /plugins/ 映射到文件系统的 ${SIYUAN_DATA_DIR}/data/plugins/）
 * 优先级：
 * 1. 文件系统配置文件（${SIYUAN_DATA_DIR}/data/plugins/siyuan-mcp-sisyphus/mcp-tools.json）
 * 2. 思源 API 读取配置文件（/plugins/siyuan-mcp-sisyphus/mcp-tools.json）
 * 3. 环境变量 SIYUAN_MCP_TOOLS
 * 4. 默认全部启用
 * 配置格式: { "list_notebooks": true, "create_notebook": false, ... }
 */
async function getToolConfig(client?: SiYuanClient): Promise<ToolConfig> {
    // 1. 尝试从文件系统读取
    const fileConfig = tryReadConfigFromFileSystem();
    if (fileConfig) {
        console.error('[MCP] Loaded config from file system:', Object.keys(fileConfig).length, 'tools configured');
        const categoryConfig = convertToCategoryConfig(fileConfig);
        console.error('[MCP] Category config:', JSON.stringify(categoryConfig, null, 2));
        return categoryConfig;
    }
    
    // 2. 尝试通过思源 API 读取（如果提供了 client）
    if (client) {
        const apiConfig = await tryReadConfigFromAPI(client);
        if (apiConfig) {
            console.error('[MCP] Loaded config from API:', Object.keys(apiConfig).length, 'tools configured');
            const categoryConfig = convertToCategoryConfig(apiConfig);
            console.error('[MCP] Category config:', JSON.stringify(categoryConfig, null, 2));
            return categoryConfig;
        }
    }
    
    // 3. 回退到环境变量
    const envConfig = process.env.SIYUAN_MCP_TOOLS;
    if (envConfig) {
        try {
            const parsed = JSON.parse(envConfig);
            // 如果是工具级别配置，转换；如果是类别级别配置，直接返回
            if (parsed.notebook !== undefined || parsed.document !== undefined) {
                console.error('[MCP] Loaded config from env (category format)');
                return parsed as ToolConfig;
            }
            console.error('[MCP] Loaded config from env (tool format)');
            return convertToCategoryConfig(parsed);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[MCP] Failed to parse SIYUAN_MCP_TOOLS:', errorMsg);
        }
    }
    
    // 4. 默认全部启用
    console.error('[MCP] Using default config (all tools enabled)');
    return {
        notebook: true,
        document: true,
        block: true,
        file: true,
    };
}

/**
 * 将工具级别配置转换为类别级别配置
 * 输入: { "list_notebooks": true, "create_notebook": false, ... }
 * 输出: { "notebook": ["list_notebooks"], "document": true, ... }
 */
function convertToCategoryConfig(toolLevelConfig: Record<string, boolean>): ToolConfig {
    const categoryConfig: ToolConfig = {
        notebook: [],
        document: [],
        block: [],
        file: [],
    };

    // 安全地获取工具列表，避免模块未加载时的错误
    const getToolNames = (listFn: (() => Array<{ name: string }>) | undefined): Set<string> => {
        if (!listFn || typeof listFn !== 'function') return new Set();
        try {
            return new Set(listFn().map(t => t.name));
        } catch (e) {
            console.error('Failed to get tool names:', e);
            return new Set();
        }
    };

    const nbToolSet = getToolNames(notebookTools.listNotebookTools);
    const docToolSet = getToolNames(documentTools.listDocumentTools);
    const blkToolSet = getToolNames(blockTools.listBlockTools);
    const fileToolSet = getToolNames(fileTools.listFileTools);

    for (const [toolName, enabled] of Object.entries(toolLevelConfig)) {
        if (!enabled) continue;

        if (nbToolSet.has(toolName)) {
            (categoryConfig.notebook as string[]).push(toolName);
        } else if (docToolSet.has(toolName)) {
            (categoryConfig.document as string[]).push(toolName);
        } else if (blkToolSet.has(toolName)) {
            (categoryConfig.block as string[]).push(toolName);
        } else if (fileToolSet.has(toolName)) {
            (categoryConfig.file as string[]).push(toolName);
        }
    }

    for (const key of Object.keys(categoryConfig) as Array<keyof ToolConfig>) {
        if (Array.isArray(categoryConfig[key]) && (categoryConfig[key] as string[]).length === 0) {
            categoryConfig[key] = false;
        }
    }

    return categoryConfig;
}

/**
 * 根据配置获取工具列表
 */
function getToolsByConfig(config: ToolConfig) {
    const tools: any[] = [];

    const safeGetTools = (listFn: (() => any[]) | undefined): any[] => {
        if (!listFn || typeof listFn !== 'function') {
            console.error('[MCP] Tool list function is not available');
            return [];
        }
        try {
            return listFn();
        } catch (e) {
            console.error('Failed to get tools:', e);
            return [];
        }
    };

    // Notebook 工具
    if (config.notebook !== false) {
        if (config.notebook === true) {
            tools.push(...safeGetTools(notebookTools.listNotebookTools));
        } else if (Array.isArray(config.notebook)) {
            const allNotebookTools = safeGetTools(notebookTools.listNotebookTools);
            const enabledSet = new Set(config.notebook);
            tools.push(...allNotebookTools.filter(t => enabledSet.has(t.name)));
        }
    }

    // Document 工具
    if (config.document !== false) {
        if (config.document === true) {
            tools.push(...safeGetTools(documentTools.listDocumentTools));
        } else if (Array.isArray(config.document)) {
            const allDocTools = safeGetTools(documentTools.listDocumentTools);
            const enabledSet = new Set(config.document);
            tools.push(...allDocTools.filter(t => enabledSet.has(t.name)));
        }
    }

    // Block 工具
    if (config.block !== false) {
        if (config.block === true) {
            tools.push(...safeGetTools(blockTools.listBlockTools));
        } else if (Array.isArray(config.block)) {
            const allBlockTools = safeGetTools(blockTools.listBlockTools);
            const enabledSet = new Set(config.block);
            tools.push(...allBlockTools.filter(t => enabledSet.has(t.name)));
        }
    }

    // File 工具
    if (config.file !== false) {
        if (config.file === true) {
            tools.push(...safeGetTools(fileTools.listFileTools));
        } else if (Array.isArray(config.file)) {
            const allFileTools = safeGetTools(fileTools.listFileTools);
            const enabledSet = new Set(config.file);
            tools.push(...allFileTools.filter(t => enabledSet.has(t.name)));
        }
    }

    return tools;
}

/**
 * 根据配置获取工具调用处理器
 */
function getToolHandlersByConfig(config: ToolConfig) {
    const handlers: Array<{
        check: (name: string) => boolean;
        handler: (client: SiYuanClient, name: string, args: any) => Promise<any>;
    }> = [];

    const safeGetHandler = (handlerFn: ((client: SiYuanClient, name: string, args: any) => Promise<any>) | undefined) => {
        if (!handlerFn || typeof handlerFn !== 'function') {
            console.error('[MCP] Tool handler function is not available');
            return null;
        }
        return handlerFn;
    };

    if (config.notebook !== false) {
        const handler = safeGetHandler(notebookTools.callNotebookTool);
        if (handler) {
            handlers.push({
                check: (name: string) => {
                    if (config.notebook === true) return true;
                    if (Array.isArray(config.notebook)) return config.notebook.includes(name);
                    return false;
                },
                handler,
            });
        }
    }

    if (config.document !== false) {
        const handler = safeGetHandler(documentTools.callDocumentTool);
        if (handler) {
            handlers.push({
                check: (name: string) => {
                    if (config.document === true) return true;
                    if (Array.isArray(config.document)) return config.document.includes(name);
                    return false;
                },
                handler,
            });
        }
    }

    if (config.block !== false) {
        const handler = safeGetHandler(blockTools.callBlockTool);
        if (handler) {
            handlers.push({
                check: (name: string) => {
                    if (config.block === true) return true;
                    if (Array.isArray(config.block)) return config.block.includes(name);
                    return false;
                },
                handler,
            });
        }
    }

    if (config.file !== false) {
        const handler = safeGetHandler(fileTools.callFileTool);
        if (handler) {
            handlers.push({
                check: (name: string) => {
                    if (config.file === true) return true;
                    if (Array.isArray(config.file)) return config.file.includes(name);
                    return false;
                },
                handler,
            });
        }
    }

    return handlers;
}

export async function createSiYuanServer(): Promise<Server> {
    const server = new Server(
        { name: 'siyuan-mcp', version: '1.0.0' },
        { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS.trim() }
    );

    const client = new SiYuanClient();
    const getClient = (): SiYuanClient => client;

    let toolConfig: ToolConfig;
    try {
        toolConfig = await getToolConfig(client);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[MCP] Failed to get tool config, using defaults:', errorMsg);
        toolConfig = {
            notebook: true,
            document: true,
            block: true,
            file: true,
        };
    }

    let toolHandlers;
    try {
        toolHandlers = getToolHandlersByConfig(toolConfig);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[MCP] Failed to get tool handlers, using all tools:', errorMsg);
        toolHandlers = [
            { check: () => true, handler: notebookTools.callNotebookTool },
            { check: () => true, handler: documentTools.callDocumentTool },
            { check: () => true, handler: blockTools.callBlockTool },
            { check: () => true, handler: fileTools.callFileTool },
        ];
    }

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        // 每次 ListTools 时重新读取配置，以便反映最新的设置
        let currentConfig: ToolConfig;
        try {
            currentConfig = await getToolConfig(client);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[MCP] Failed to reload tool config, using cached:', errorMsg);
            currentConfig = toolConfig;
        }
        const tools = getToolsByConfig(currentConfig);
        console.error(`[MCP] ListTools: returning ${tools.length} tools (config: ${JSON.stringify(currentConfig)})`);
        return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const client = getClient();

        // 每次调用工具时重新读取配置，以便反映最新的设置
        let currentConfig: ToolConfig;
        try {
            currentConfig = await getToolConfig(client);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[MCP] Failed to reload tool config, using cached:', errorMsg);
            currentConfig = toolConfig;
        }
        
        // 重新构建 handlers（因为配置可能已更改）
        let currentHandlers;
        try {
            currentHandlers = getToolHandlersByConfig(currentConfig);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[MCP] Failed to rebuild tool handlers, using cached:', errorMsg);
            currentHandlers = toolHandlers;
        }

        for (const { check, handler } of currentHandlers) {
            if (check(name)) {
                const result = await handler(client, name, args);
                if (result !== null) return result;
            }
        }

        return {
            content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
            isError: true,
        };
    });

    return server;
}

async function main() {
    // 捕获所有未处理的异常和拒绝，确保错误输出到 stderr
    process.on('uncaughtException', (error) => {
        console.error('[MCP] Uncaught exception:', error instanceof Error ? error.message : String(error));
    });
    
    process.on('unhandledRejection', (reason) => {
        console.error('[MCP] Unhandled rejection:', reason instanceof Error ? reason.message : String(reason));
    });
    
    const server = await createSiYuanServer();
    const transport = new StdioServerTransport(
        typeof process !== 'undefined' ? process.stdin : undefined,
        typeof process !== 'undefined' ? process.stdout : undefined
    );
    await server.connect(transport);
}

main().catch((error) => {
    console.error('[MCP] Failed to start server:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
