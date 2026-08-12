import { acceptedContent, inputRequired, ProtocolError, ProtocolErrorCode, Server, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { startHttpMcpServer, type TlsOptions } from './http-transport';
import { buildServerInstructions } from './server-instructions';

import { SiYuanClient } from '../api/client';
import { buildDefaultToolConfig, isDangerousAction, loadToolConfigFromApiFileWithStatus, type ToolCategory, type ToolConfig, type ToolConfigLoadResult } from './config';
import { WriteSafetyCoordinator } from './write-safety-coordinator';
import { getActionSafetyPolicy } from './write-safety-policy';
import { callCliWriteCoordinator } from '../cli/write-coordinator';
import type { CliWriteCoordinatorSettings } from '../cli/runtime';
import { noopSchemaValidator } from './noops/noop-schema-validator';
import { OfficialMcpBridge, type OfficialMcpRuntime } from './official-mcp-bridge';

import { PermissionManager } from './permissions';
import {
    callFlashcardReviewSessionTool,
    callMascotShopAppTool,
    callTimelineAppTool,
    compactMcpAppToolResult,
    decorateToolsWithMcpApps,
    FLASHCARD_REVIEW_SESSION_TOOL_NAME,
    FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME,
    listMcpAppResources,
    MCP_APPS_EXTENSION_ID,
    MCP_APP_MIME_TYPE,
    MASCOT_SHOP_APP_ACTION_TOOL_NAME,
    MASCOT_SHOP_APP_TOOL_NAME,
    readMcpAppResource,
    supportsMcpApps,
    TIMELINE_APP_ACTION_TOOL_NAME,
    TIMELINE_APP_TOOL_NAME,
} from './mcp-apps';
import { listHelpResources, listHelpResourceTemplates, readHelpResource } from './resources';
import { GENERIC_TOOL_OUTPUT_SCHEMA, listAllTools, prepareAllTools, resolveCategory, TOOL_REGISTRY } from './tool-registry';
import { runToolCall } from './tool-lifecycle';
import { getMcpPrompt, getSepSkill, listMcpPrompts, listSepSkillResources, listSepSkills, readSepSkillResource } from './skills';

export { buildServerInstructions } from './server-instructions';

export function getMcpServerHelpText(): string {
    return [
        'SiYuan MCP Sisyphus server',
        '',
        'Usage:',
        '  node mcp-server.cjs                  Start MCP over stdio (default)',
        '  node mcp-server.cjs --http           Start MCP over HTTP/SSE',
        '  SIYUAN_MCP_TRANSPORT=http node mcp-server.cjs',
        '',
        'SiYuan API environment:',
        '  SIYUAN_API_URL=http://127.0.0.1:6806  SiYuan API base URL',
        '  SIYUAN_TOKEN=...                      SiYuan API token',
        '',
        'HTTP MCP environment:',
        '  SIYUAN_MCP_HOST=127.0.0.1             Bind host, default 127.0.0.1',
        '  SIYUAN_MCP_PORT=36806                 Bind port, default 36806',
        '  SIYUAN_MCP_PATH=/mcp                  HTTP MCP path, default /mcp',
        '  SIYUAN_MCP_TOKEN=...                  Bearer token for MCP HTTP clients',
        '  SIYUAN_MCP_ALLOWED_ORIGINS=host,...   Browser Origin hostname allowlist',
        '  SIYUAN_MCP_SKILLS_EXTENSION=false    Disable draft SEP-2640 Skills extension (enabled by default)',
        '',
        'TLS environment:',
        '  SIYUAN_MCP_TLS_CERT=/path/cert.pem',
        '  SIYUAN_MCP_TLS_KEY=/path/key.pem',
        '  SIYUAN_MCP_TLS_CA=/path/ca.pem        Optional client CA',
        '',
        'Examples:',
        '  node mcp-server.cjs',
        '  SIYUAN_TOKEN=xxx node mcp-server.cjs',
        '  SIYUAN_MCP_TOKEN=secret node mcp-server.cjs --http',
        '  SIYUAN_MCP_HOST=127.0.0.1 SIYUAN_MCP_PORT=36806 node mcp-server.cjs --http',
        '',
    ].join('\n');
}

async function tryReadConfigFromAPI(client: SiYuanClient): Promise<ToolConfig | null> {
    const result = await loadToolConfigFromApiFileWithStatus(client);
    return result.ok && result.rawLength !== 0 ? result.config : null;
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

function createInstructionClient(): SiYuanClient {
    const client = new SiYuanClient({ timeout: 10000 });
    const envToken = process.env.SIYUAN_TOKEN;
    if (envToken) {
        client.setToken(envToken);
    }
    return client;
}

const HTTP_SETTINGS_API_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpHttpSettings';

async function loadRemoteWriteCoordinatorSettings(client: SiYuanClient): Promise<CliWriteCoordinatorSettings | undefined> {
    try {
        const raw = JSON.parse(await client.readFile(HTTP_SETTINGS_API_PATH)) as Record<string, unknown>;
        if (raw.enabled === false) return undefined;
        const hostValue = typeof raw.host === 'string' ? raw.host : '127.0.0.1';
        const host = hostValue === '0.0.0.0' || hostValue === '::' ? '127.0.0.1' : hostValue;
        const port = typeof raw.port === 'number' ? raw.port : 36806;
        const scheme = raw.tlsEnabled === true ? 'https' : 'http';
        const token = raw.authEnabled === true && typeof raw.token === 'string' ? raw.token : undefined;
        return { url: `${scheme}://${host}:${port}/mcp`, token };
    } catch {
        return undefined;
    }
}

export interface CreateSiYuanServerOptions {
    officialMcpFetch?: typeof fetch;
    runtime?: SiYuanServerRuntime;
    transportMode?: 'http' | 'stdio';
}

export interface SiYuanServerRuntime {
    client: SiYuanClient;
    fastClient: SiYuanClient;
    instructionClient: SiYuanClient;
    initialConfigLoad: ToolConfigLoadResult;
    officialMcpBridge: OfficialMcpBridge;
    permMgr: PermissionManager;
    writeSafetyCoordinator: WriteSafetyCoordinator;
    getToolConfig(): Promise<ToolConfig>;
    close(): Promise<void>;
}

export async function createSiYuanServerRuntime(
    options: Pick<CreateSiYuanServerOptions, 'officialMcpFetch'> = {},
): Promise<SiYuanServerRuntime> {
    const client = await initSiYuanClient();
    const fastClient = createFastClient();
    const instructionClient = createInstructionClient();

    async function getToolConfig(): Promise<ToolConfig> {
        try {
            const config = await tryReadConfigFromAPI(fastClient);
            if (config) return config;
        } catch {
            // SiYuan unreachable — fall back to defaults below.
        }
        return buildDefaultToolConfig();
    }

    const initialConfigLoad: ToolConfigLoadResult = await loadToolConfigFromApiFileWithStatus(instructionClient);
    const officialMcpBridge = new OfficialMcpBridge(client, { fetch: options.officialMcpFetch });
    const permMgr = new PermissionManager(fastClient);
    const writeSafetyCoordinator = new WriteSafetyCoordinator(client);
    try {
        await permMgr.load();
    } catch {
        // SiYuan offline — permissions default to rwd (no restrictions).
    }

    return {
        client,
        fastClient,
        instructionClient,
        initialConfigLoad,
        officialMcpBridge,
        permMgr,
        writeSafetyCoordinator,
        getToolConfig,
        close: () => officialMcpBridge.close(),
    };
}

export async function createSiYuanServer(options: CreateSiYuanServerOptions = {}): Promise<Server> {
    const ownsRuntime = !options.runtime;
    const runtime = options.runtime ?? await createSiYuanServerRuntime(options);
    const {
        client,
        initialConfigLoad,
        officialMcpBridge,
        permMgr,
        writeSafetyCoordinator,
        getToolConfig,
    } = runtime;
    const initialConfig = initialConfigLoad.config;
    const skillsExtensionSetting = process.env.SIYUAN_MCP_SKILLS_EXTENSION?.trim().toLowerCase();
    const skillsExtensionEnabled = skillsExtensionSetting === undefined
        || skillsExtensionSetting === ''
        || ['1', 'true', 'yes', 'on'].includes(skillsExtensionSetting);
    const server = new Server(
        { name: 'siyuan-mcp', version: '2.0.0' },
        {
            capabilities: {
                tools: { listChanged: true },
                resources: {},
                prompts: {},
                extensions: {
                    [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] },
                    ...(skillsExtensionEnabled ? {
                        'io.modelcontextprotocol/skills': { directoryRead: false },
                    } : {}),
                },
            },
            instructions: buildServerInstructions({
                userRulesText: initialConfig.userRulesText,
                agentSiyuanMemoryText: initialConfig.agentSiyuanMemoryText,
                agentSiyuanMemoryUpdatedAt: initialConfig.agentSiyuanMemoryUpdatedAt,
                agentSiyuanMemoryConfigSource: initialConfigLoad.source,
                agentSiyuanMemoryConfigOk: initialConfigLoad.ok,
                agentSiyuanMemoryConfigError: initialConfigLoad.errorMessage,
            }).trim(),
            jsonSchemaValidator: noopSchemaValidator,
        },
    );
    const officialMcpRuntime: OfficialMcpRuntime = {
        bridge: officialMcpBridge,
        notifyToolListChanged: () => server.sendToolListChanged(),
        discoveryMode: 'background',
    };
    if (ownsRuntime) {
        server.onclose = () => {
            void runtime.close();
        };
    }

    server.setRequestHandler('tools/list', async (_request, ctx) => {
        const config = await getToolConfig();
        await prepareAllTools(config, officialMcpRuntime);
        // buildAggregatedTool always emits an object-root JSON Schema. Its
        // internal schema helpers intentionally retain Record<string, unknown>
        // so action-specific extensions remain visible to the CLI as well.
        const clientCapabilities = (
            ctx.mcpReq.envelope as { clientCapabilities?: Parameters<typeof supportsMcpApps>[0] } | undefined
        )?.clientCapabilities ?? server.getClientCapabilities();
        const tools = decorateToolsWithMcpApps(
            listAllTools(config, officialMcpRuntime),
            supportsMcpApps(clientCapabilities),
            config.mcpApps,
        );
        return { tools: tools as Tool[] };
    });

    server.setRequestHandler('resources/list', async () => {
        const config = await getToolConfig();
        return {
            resources: [
                ...listMcpAppResources(config.mcpApps),
                ...listHelpResources(),
                ...(skillsExtensionEnabled ? listSepSkillResources() : []),
            ],
        };
    });

    server.setRequestHandler('resources/templates/list', async () => {
        return { resourceTemplates: listHelpResourceTemplates() };
    });

    server.setRequestHandler('resources/read', async (request) => {
        const config = await getToolConfig();
        const resource = readMcpAppResource(request.params.uri, config.mcpApps)
            ?? readHelpResource(request.params.uri, config.userRulesText)
            ?? (skillsExtensionEnabled ? readSepSkillResource(request.params.uri) : undefined);
        if (!resource) {
            throw new ProtocolError(ProtocolErrorCode.InvalidRequest, `Unknown resource: ${request.params.uri}`);
        }
        return { contents: [resource] };
    });

    server.setRequestHandler('prompts/list', async () => {
        return { prompts: listMcpPrompts() };
    });

    server.setRequestHandler('prompts/get', async (request) => {
        const prompt = getMcpPrompt(request.params.name, request.params.arguments?.task);
        if (!prompt) {
            throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
        }
        return prompt;
    });

    if (skillsExtensionEnabled) {
        server.setRequestHandler(
            'skills/list',
            { params: z.object({ cursor: z.string().optional() }) },
            async () => ({
                skills: listSepSkills(),
                ttlMs: 300_000,
                cacheScope: 'public',
            }),
        );
        server.setRequestHandler(
            'skills/get',
            { params: z.object({ uri: z.string().min(1) }) },
            async ({ uri }) => {
                const skill = getSepSkill(uri);
                if (!skill) {
                    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown skill URI: ${uri}`);
                }
                return { skill };
            },
        );
    }

    server.setRequestHandler('tools/call', async (request, ctx) => {
        const { name, arguments: args } = request.params;
        const action = typeof args?.action === 'string' ? args.action : 'unknown';
        const clientCapabilities = (
            ctx.mcpReq.envelope as { clientCapabilities?: Parameters<typeof supportsMcpApps>[0] } | undefined
        )?.clientCapabilities ?? server.getClientCapabilities();
        const appsEnabled = supportsMcpApps(clientCapabilities);
        const appToolNames = new Set([
            TIMELINE_APP_TOOL_NAME,
            TIMELINE_APP_ACTION_TOOL_NAME,
            FLASHCARD_REVIEW_SESSION_TOOL_NAME,
            FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME,
            MASCOT_SHOP_APP_TOOL_NAME,
            MASCOT_SHOP_APP_ACTION_TOOL_NAME,
        ]);
        if (appToolNames.has(name) && !appsEnabled) {
            return {
                content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
                isError: true,
            };
        }
        if ([FLASHCARD_REVIEW_SESSION_TOOL_NAME, TIMELINE_APP_TOOL_NAME, MASCOT_SHOP_APP_TOOL_NAME].includes(name)) {
            const config = await getToolConfig();
            const appEnabled = name === FLASHCARD_REVIEW_SESSION_TOOL_NAME
                ? config.mcpApps.flashcardReview.enabled
                : name === TIMELINE_APP_TOOL_NAME
                    ? config.mcpApps.timeline.enabled
                    : config.mcpApps.mascotShop.enabled;
            if (!appEnabled) {
                return {
                    content: [{ type: 'text' as const, text: `Tool "${name}" is disabled.` }],
                    isError: true,
                };
            }
            if (name === FLASHCARD_REVIEW_SESSION_TOOL_NAME && (!config.flashcard.enabled || config.flashcard.actions.list_cards !== true)) {
                return { content: [{ type: 'text' as const, text: 'flashcard_review_session requires flashcard(action="list_cards") to be enabled for candidate selection.' }], isError: true };
            }
            try {
                const result = name === FLASHCARD_REVIEW_SESSION_TOOL_NAME
                    ? await callFlashcardReviewSessionTool(client, permMgr, args, config.mcpApps.flashcardReview)
                    : name === TIMELINE_APP_TOOL_NAME
                        ? await callTimelineAppTool(client, permMgr, args, config.mcpApps.timeline)
                        : await callMascotShopAppTool(client, permMgr, args, config.mcpApps.mascotShop);
                return server.projectCallToolResult(result, GENERIC_TOOL_OUTPUT_SCHEMA);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return server.projectCallToolResult(withStructuredContent({
                    content: [{ type: 'text' as const, text: JSON.stringify({
                        action: FLASHCARD_REVIEW_SESSION_TOOL_NAME,
                        error: { message },
                    }, null, 2) }],
                    isError: true,
                }), GENERIC_TOOL_OUTPUT_SCHEMA);
            }
        }
        const appActionCategory = name === TIMELINE_APP_ACTION_TOOL_NAME
            ? 'timeline'
            : name === FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME
                ? 'flashcard'
                : name === MASCOT_SHOP_APP_ACTION_TOOL_NAME
                    ? 'mascot'
                    : undefined;
        const category = appActionCategory ?? resolveCategory(name);
        if (!category) {
            return {
                content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
                isError: true,
            };
        }

        const config = await getToolConfig();
        const appActionConfig = name === TIMELINE_APP_ACTION_TOOL_NAME
            ? config.mcpApps.timeline
            : name === FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME
                ? config.mcpApps.flashcardReview
                : name === MASCOT_SHOP_APP_ACTION_TOOL_NAME
                    ? config.mcpApps.mascotShop
                    : undefined;
        if (appActionConfig ? !appActionConfig.enabled : !config[category].enabled) {
            return {
                content: [{ type: 'text' as const, text: `Tool "${name}" is disabled.` }],
                isError: true,
            };
        }

        const module = TOOL_REGISTRY[category];
        const actionEnabled = appActionConfig
            ? (appActionConfig.actions as Record<string, boolean>)[action] === true
            : category === 'extension'
                // Official MCP actions are discovered dynamically and remain
                // governed by bridge discovery/trust. The named diagnostics
                // are Sisyphus-owned actions, so their persisted action
                // switches must still work like every other category.
                ? (Object.prototype.hasOwnProperty.call(config.extension.actions, action)
                    ? config.extension.actions[action as keyof typeof config.extension.actions] === true
                    : true)
                : (config[category].actions as Record<string, boolean>)[action] === true;
        if (action !== 'help' && !actionEnabled) {
            const disabled = {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        error: {
                            type: 'action_disabled',
                            message: `Action "${action}" is disabled for tool "${name}".`,
                            hint: 'Enable the action in Settings -> Plugins -> SiYuan MCP sisyphus, or call listTools() again to inspect the currently enabled actions.',
                        },
                    }, null, 2),
                }],
                isError: true,
            };
            return server.projectCallToolResult(
                withStructuredContent(disabled),
                GENERIC_TOOL_OUTPUT_SCHEMA,
            );
        }
        const extensionTool = category === 'extension'
            ? officialMcpBridge.getTools().find((tool) => tool.name === action)
            : undefined;
        const extensionDynamicAction = category === 'extension'
            && !['list', 'help', 'validate_package', 'diagnose_plugin_mcp'].includes(action);
        const requiresConfirmation = actionEnabled && args?.validateOnly !== true && (
            isDangerousAction(category as ToolCategory, action)
            || (extensionDynamicAction && extensionTool?.readOnlyHint !== true)
        );

        // 2026-07-28 carries confirmation in-band through MRTR. Legacy
        // clients keep the existing instruction-level confirmation contract
        // because many of them do not advertise elicitation support.
        if (requiresConfirmation && ctx.mcpReq.envelope) {
            const confirmationKey = 'dangerous-action-confirmation';
            const hasResponse = Object.prototype.hasOwnProperty.call(
                ctx.mcpReq.inputResponses ?? {},
                confirmationKey,
            );
            const confirmation = acceptedContent<{ confirm?: boolean }>(
                ctx.mcpReq.inputResponses,
                confirmationKey,
            );

            if (!hasResponse) {
                const argumentPreview = JSON.stringify(args ?? {});
                return inputRequired({
                    inputRequests: {
                        [confirmationKey]: inputRequired.elicit({
                            message: [
                                `Confirm high-risk SiYuan action ${name}(action="${action}").`,
                                `Arguments: ${argumentPreview.length > 1800 ? `${argumentPreview.slice(0, 1800)}…` : argumentPreview}`,
                                'The operation has not run yet.',
                            ].join('\n'),
                            requestedSchema: {
                                type: 'object',
                                properties: {
                                    confirm: {
                                        type: 'boolean',
                                        title: 'Confirm execution',
                                        description: 'Set true only after the user explicitly approves this exact action.',
                                    },
                                },
                                required: ['confirm'],
                                additionalProperties: false,
                            },
                        }),
                    },
                });
            }

            if (confirmation?.confirm !== true) {
                const declined = {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: false,
                            cancelled: true,
                            message: `High-risk action ${name}(action="${action}") was not executed because confirmation was declined or cancelled.`,
                        }, null, 2),
                    }],
                    isError: true,
                };
                return server.projectCallToolResult(
                    withStructuredContent(declined),
                    GENERIC_TOOL_OUTPUT_SCHEMA,
                );
            }
        }

        const policy = getActionSafetyPolicy(category, action, args ?? {});
        const transportMode = options.transportMode ?? parseTransportMode();
        const routeToRemoteCoordinator = config.writeSafety.strictMode
            && policy.mode === 'mutation'
            && transportMode !== 'http';
        const result = await runToolCall(
            {
                client,
                category,
                name,
                action,
                args,
                requestText: category === 'extension'
                    ? JSON.stringify({ name, action })
                    : JSON.stringify({ name, arguments: args ?? {} }),
                slimResponses: config.debug.slimResponses,
            },
            async () => {
                if (routeToRemoteCoordinator) {
                    return callCliWriteCoordinator(
                        await loadRemoteWriteCoordinatorSettings(client),
                        name,
                        args ?? {},
                    );
                }
                return writeSafetyCoordinator.run({
                    client,
                    permMgr,
                    category,
                    action,
                    args: args ?? {},
                    strictMode: config.writeSafety.strictMode,
                    execute: (safeArgs) => appActionConfig
                        ? module.callTool(client, safeArgs, appActionConfig, permMgr, officialMcpRuntime)
                        : module.callTool(client, safeArgs, config[category], permMgr, officialMcpRuntime),
                });
            },
        );
        // The low-level v2 Server leaves cross-era result projection to the
        // handler. Our tools currently have text-only output and no advertised
        // outputSchema, but projecting here keeps modern and legacy shapes in
        // sync when structured output is introduced later.
        const projectedResult = withStructuredContent(result);
        return server.projectCallToolResult(
            compactMcpAppToolResult(name, action, projectedResult, appsEnabled, config.mcpApps),
            GENERIC_TOOL_OUTPUT_SCHEMA,
        );
    });

    return server;
}

function withStructuredContent(result: {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
}): CallToolResult {
    if (result.structuredContent) return result as CallToolResult;

    const text = result.content.find((item) => item.type === 'text')?.text ?? '';
    let value: unknown = text;
    try {
        value = JSON.parse(text);
    } catch {
        // Preserve non-JSON tool responses under a stable object key.
    }
    const structuredContent = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : { value };
    return { ...result, structuredContent } as CallToolResult;
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

        const runtime = await createSiYuanServerRuntime();
        try {
            await startHttpMcpServer({
                host: process.env.SIYUAN_MCP_HOST ?? '127.0.0.1',
                port,
                token: process.env.SIYUAN_MCP_TOKEN || undefined,
                path: process.env.SIYUAN_MCP_PATH || '/mcp',
                allowedOriginHostnames: process.env.SIYUAN_MCP_ALLOWED_ORIGINS
                    ?.split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                serverFactory: () => createSiYuanServer({ runtime, transportMode: 'http' }),
                dispose: () => runtime.close(),
                tls,
            });
        } catch (error) {
            await runtime.close();
            throw error;
        }
        return;
    }

    serveStdio(() => createSiYuanServer(), {
        legacy: 'serve',
        onerror: (error) => {
            console.error('[MCP][stdio] transport error:', error.message);
        },
    });
}

if (require.main === module) {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        process.stdout.write(getMcpServerHelpText());
        process.exit(0);
    }
    startMcpServer().catch((error) => {
        console.error('[MCP] Failed to start server:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
