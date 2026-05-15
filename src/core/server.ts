import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, McpError, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startHttpMcpServer, type TlsOptions } from './http-transport';
import { buildServerInstructions } from './server-instructions';

import { SiYuanClient } from '../api/client';
import { MCP_TOOLS_CONFIG_API_PATH, buildDefaultToolConfig, normalizeToolConfig, warnLegacyToolConfigOnce, type ToolConfig } from './config';
import { noopSchemaValidator } from './noops/noop-schema-validator';

import { PermissionManager } from './permissions';
import { listHelpResources, listHelpResourceTemplates, readHelpResource } from './resources';
import { listAllTools, resolveCategory, TOOL_REGISTRY } from './tool-registry';
import { runToolCall } from './tool-lifecycle';

export { buildServerInstructions } from './server-instructions';

async function tryReadConfigFromAPI(client: SiYuanClient): Promise<ToolConfig | null> {
    try {
        const content = await client.readFile(MCP_TOOLS_CONFIG_API_PATH);
        if (content) {
            const raw = JSON.parse(content);
            warnLegacyToolConfigOnce(raw, { source: `SiYuan API file "${MCP_TOOLS_CONFIG_API_PATH}"` });
            return normalizeToolConfig(raw);
        }
    } catch {
        // Ignore missing or invalid config files.
    }
    return null;
}

async function initSiYuanClient(): Promise<SiYuanClient> {
    const client = new SiYuanClient();

    const envToken = process.env.SIYUAN_TOKEN;
    if (envToken) {
        client.setToken(envToken);
    }

    return client;
}

function createFastClient(): SiYuanClient {
    const client = new SiYuanClient({ timeout: 3000 });
    const envToken = process.env.SIYUAN_TOKEN;
    if (envToken) {
        client.setToken(envToken);
    }
    return client;
}

export async function createSiYuanServer(): Promise<Server> {
    const client = await initSiYuanClient();
    const fastClient = createFastClient();

    async function getToolConfig(): Promise<ToolConfig> {
        try {
            const config = await tryReadConfigFromAPI(fastClient);
            if (config) return config;
        } catch {
            // SiYuan unreachable — fall back to defaults below.
        }
        return buildDefaultToolConfig();
    }

    const initialConfig = await getToolConfig();
    const server = new Server(
        { name: 'siyuan-mcp', version: '2.0.0' },
        {
            capabilities: { tools: {}, resources: {} },
            instructions: buildServerInstructions(initialConfig.userRulesText).trim(),
            jsonSchemaValidator: noopSchemaValidator,
        },
    );
    const permMgr = new PermissionManager(fastClient);
    try {
        await permMgr.load();
    } catch {
        // SiYuan offline — permissions default to rwd (no restrictions).
    }

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const config = await getToolConfig();
        return { tools: listAllTools(config) };
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        return { resources: listHelpResources() };
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
        return { resourceTemplates: listHelpResourceTemplates() };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const config = await getToolConfig();
        const resource = readHelpResource(request.params.uri, config.userRulesText);
        if (!resource) {
            throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${request.params.uri}`);
        }
        return { contents: [resource] };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const action = typeof args?.action === 'string' ? args.action : 'unknown';
        const category = resolveCategory(name);
        if (!category) {
            return {
                content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
                isError: true,
            };
        }

        const config = await getToolConfig();
        if (!config[category].enabled) {
            return {
                content: [{ type: 'text' as const, text: `Tool "${name}" is disabled.` }],
                isError: true,
            };
        }

        const module = TOOL_REGISTRY[category];
        const result = await runToolCall(
            {
                client,
                category,
                name,
                action,
                args,
                requestText: JSON.stringify({ name, arguments: args ?? {} }),
                slimResponses: config.debug.slimResponses,
            },
            () => module.callTool(client, args, config[category], permMgr),
        );
        // The MCP SDK CallToolResult uses a wider ContentBlock union; our
        // ToolResult always emits text-only content, which is a valid subset.
        return result as { content: { type: 'text'; text: string }[]; isError?: boolean };
    });

    return server;
}

function parseTransportMode(): 'stdio' | 'http' {
    if (typeof process === 'undefined') return 'stdio';
    if (Array.isArray(process.argv) && process.argv.includes('--http')) return 'http';
    const env = (process.env.SIYUAN_MCP_TRANSPORT ?? '').toLowerCase();
    if (env === 'http') return 'http';
    return 'stdio';
}

export async function startMcpServer() {
    process.on('uncaughtException', (error) => {
        console.error('[MCP] Uncaught exception:', error instanceof Error ? error.message : String(error));
    });

    process.on('unhandledRejection', (reason) => {
        console.error('[MCP] Unhandled rejection:', reason instanceof Error ? reason.message : String(reason));
    });

    const mode = parseTransportMode();

    if (mode === 'http') {
        const portRaw = process.env.SIYUAN_MCP_PORT ?? '36806';
        const port = parseInt(portRaw, 10);
        if (!Number.isFinite(port) || port <= 0 || port > 65535) {
            throw new Error(`[MCP] invalid SIYUAN_MCP_PORT: ${portRaw}`);
        }
        const certFile = process.env.SIYUAN_MCP_TLS_CERT;
        const keyFile = process.env.SIYUAN_MCP_TLS_KEY;
        let tls: TlsOptions | undefined;
        if (certFile && keyFile) {
            tls = {
                certFile,
                keyFile,
                caFile: process.env.SIYUAN_MCP_TLS_CA || undefined,
            };
        } else if (certFile || keyFile) {
            throw new Error('[MCP] HTTPS requires both SIYUAN_MCP_TLS_CERT and SIYUAN_MCP_TLS_KEY to be set.');
        }

        await startHttpMcpServer({
            host: process.env.SIYUAN_MCP_HOST ?? '127.0.0.1',
            port,
            token: process.env.SIYUAN_MCP_TOKEN || undefined,
            path: process.env.SIYUAN_MCP_PATH || '/mcp',
            serverFactory: createSiYuanServer,
            tls,
        });
        return;
    }

    const server = await createSiYuanServer();
    const transport = new StdioServerTransport(
        typeof process !== 'undefined' ? process.stdin : undefined,
        typeof process !== 'undefined' ? process.stdout : undefined,
    );
    await server.connect(transport);
}

if (require.main === module) {
    startMcpServer().catch((error) => {
        console.error('[MCP] Failed to start server:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
