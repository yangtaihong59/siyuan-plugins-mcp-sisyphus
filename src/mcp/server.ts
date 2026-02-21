import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'path';
import fs from 'fs';

import { SiYuanClient } from '../api/client';

/** 插件数据路径：思源 saveData('mcpToolsConfig') 持久化位置 */
const PLUGIN_CONFIG_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig';
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
 * 从思源 API 读取插件数据（getFile 读 saveData 持久化路径）
 */
async function tryReadConfigFromAPI(client: SiYuanClient): Promise<Record<string, boolean> | null> {
    try {
        const content = await client.request<string>('/api/file/getFile', { path: PLUGIN_CONFIG_PATH });
        if (content && typeof content === 'string') {
            const data = JSON.parse(content);
            return data;
        }
    } catch {
        // 文件不存在或未连接
    }
    return null;
}

/**
 * 从文件系统读取插件数据（兼容 MCP 与思源同机时的本地路径）
 */
function tryReadConfigFromFileSystem(): Record<string, boolean> | null {
    const possiblePaths: string[] = [];
    const envDataDir = process.env.SIYUAN_DATA_DIR;
    if (envDataDir) {
        possiblePaths.push(path.join(envDataDir, 'data', 'storage', 'petal', 'siyuan-plugins-mcp-sisyphus', 'mcpToolsConfig'));
        possiblePaths.push(path.join(envDataDir, 'storage', 'petal', 'siyuan-plugins-mcp-sisyphus', 'mcpToolsConfig'));
    }
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (homeDir) {
        possiblePaths.push(path.join(homeDir, 'SiYuan', 'data', 'storage', 'petal', 'siyuan-plugins-mcp-sisyphus', 'mcpToolsConfig'));
        possiblePaths.push(path.join(homeDir, '.siyuan', 'data', 'storage', 'petal', 'siyuan-plugins-mcp-sisyphus', 'mcpToolsConfig'));
        if (process.platform === 'win32') {
            const appData = process.env.APPDATA || '';
            if (appData) possiblePaths.push(path.join(appData, 'SiYuan', 'data', 'storage', 'petal', 'siyuan-plugins-mcp-sisyphus', 'mcpToolsConfig'));
        }
    }
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            try {
                const content = fs.readFileSync(p, 'utf-8');
                return JSON.parse(content);
            } catch {
                // parse error
            }
        }
    }
    return null;
}

/**
 * 读取工具配置：优先插件数据（API → 文件系统），其次环境变量，最后默认全部启用
 */
async function getToolConfig(client?: SiYuanClient): Promise<ToolConfig> {
    if (client) {
        const apiConfig = await tryReadConfigFromAPI(client);
        if (apiConfig) return convertToCategoryConfig(apiConfig);
    }
    const fileConfig = tryReadConfigFromFileSystem();
    if (fileConfig) return convertToCategoryConfig(fileConfig);

    const envConfig = process.env.SIYUAN_MCP_TOOLS;
    if (envConfig) {
        try {
            const parsed = JSON.parse(envConfig);
            if (parsed.notebook !== undefined || parsed.document !== undefined) return parsed as ToolConfig;
            return convertToCategoryConfig(parsed);
        } catch {
            // ignore
        }
    }
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
        } catch {
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
        if (!listFn || typeof listFn !== 'function') return [];
        try {
            return listFn();
        } catch {
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
        if (!handlerFn || typeof handlerFn !== 'function') return null;
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
    } catch {
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
    } catch {
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
        } catch {
            currentConfig = toolConfig;
        }
        const tools = getToolsByConfig(currentConfig);
        return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const client = getClient();

        // 每次调用工具时重新读取配置，以便反映最新的设置
        let currentConfig: ToolConfig;
        try {
            currentConfig = await getToolConfig(client);
        } catch {
            currentConfig = toolConfig;
        }
        let currentHandlers;
        try {
            currentHandlers = getToolHandlersByConfig(currentConfig);
        } catch {
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
