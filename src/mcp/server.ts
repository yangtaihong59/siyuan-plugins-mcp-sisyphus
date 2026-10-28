import { supportsFormElicitation } from '../shared/mcp-capabilities';
import { withStructuredContent } from '../core/structured-result';
import { isKernelExport } from '../core/kernel-file-transfer';
import { inputResponse, inputRequired, ProtocolError, ProtocolErrorCode, Server, type Tool } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { startHttpMcpServer, type TlsOptions } from './http-transport';
import { buildServerInstructions } from '../core/server-instructions';
import { measureMcpInitialTokenCost, recordMcpInitialTokenCost } from './mcp-initial-cost';
import { planToolCall } from './tool-call-gate';
import { executeLocalTool, shouldSlimResponse, toolCallRequestText } from './tool-execution';

import { HttpSiYuanClient, type SiYuanClient } from '../api/client';
import { loadToolConfigForExecution, loadToolConfigFromApiFileWithStatus, type ToolConfig, type ToolConfigLoadResult } from '../core/config';
import { WriteSafetyCoordinator } from './write-safety-coordinator';
import { callCliWriteCoordinator } from '../core/write-coordinator-client';
import { loadWriteCoordinatorSettings } from '../core/write-coordinator-settings';
import { noopSchemaValidator } from '../core/noops/noop-schema-validator';
import { OfficialMcpBridge, type OfficialMcpRuntime } from '../core/official-mcp-bridge';

import { PermissionManager } from '../core/permissions';
import {
    decorateToolsWithMcpApps,
    executeAppTool,
    finalizeToolResult,
    listMcpAppResources,
    MCP_APPS_EXTENSION_ID,
    MCP_APP_MIME_TYPE,
    readMcpAppResource,
    supportsMcpApps,
} from './mcp-apps';
import { listHelpResources, listHelpResourceTemplates, readHelpResource } from './resources';
import { GENERIC_TOOL_OUTPUT_SCHEMA, listAllTools, prepareAllTools, resolveCategory } from './tool-registry';
import { runToolCall } from '../core/tool-lifecycle';
import { getMcpPrompt, getSepSkill, listMcpPrompts, listSepSkillResources, listSepSkills, readSepSkillResource } from '../core/skills';
import { createErrorResult, createRelativeLocalPathResult, isAbsoluteLocalPath, type ToolResult } from '../tools/internal/shared';

export { buildServerInstructions } from '../core/server-instructions';

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

async function initSiYuanClient(): Promise<SiYuanClient> {
    const client = new HttpSiYuanClient();

    const envToken = process.env.SIYUAN_TOKEN;
    if (envToken) {
        client.setToken(envToken);
    }

    return client;
}

function createFastClient(): SiYuanClient {
    const client = new HttpSiYuanClient({ timeout: 3000 });
    const envToken = process.env.SIYUAN_TOKEN;
    if (envToken) {
        client.setToken(envToken);
    }
    return client;
}

function createInstructionClient(): SiYuanClient {
    const client = new HttpSiYuanClient({ timeout: 10000 });
    const envToken = process.env.SIYUAN_TOKEN;
    if (envToken) {
        client.setToken(envToken);
    }
    return client;
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
    writeCoordinatorOwner?: 'kernel' | 'node';
    getToolConfig(): Promise<ToolConfig>;
    close(): Promise<void>;
}

export async function createSiYuanServerRuntime(
    options: Pick<CreateSiYuanServerOptions, 'officialMcpFetch'> = {},
): Promise<SiYuanServerRuntime> {
    const client = await initSiYuanClient();
    const fastClient = createFastClient();
    const instructionClient = createInstructionClient();

    let lastToolConfig: ToolConfig | undefined;
    async function getToolConfig(): Promise<ToolConfig> {
        lastToolConfig = await loadToolConfigForExecution(fastClient, lastToolConfig);
        return lastToolConfig;
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
                writeSafety: initialConfig.writeSafety,
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
        void recordMcpInitialTokenCost(client, measureMcpInitialTokenCost(config, tools));
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
        const gateError = (result: ToolResult) => server.projectCallToolResult(withStructuredContent(result), GENERIC_TOOL_OUTPUT_SCHEMA);
        const clientCapabilities = (
            ctx.mcpReq.envelope as { clientCapabilities?: Parameters<typeof supportsMcpApps>[0] } | undefined
        )?.clientCapabilities ?? server.getClientCapabilities();
        const appsEnabled = supportsMcpApps(clientCapabilities);
        let config: ToolConfig;
        try {
            config = await getToolConfig();
        } catch (error) {
            return gateError(createErrorResult(error, { tool: name }));
        }
        const plan = planToolCall(name, args, config, {
            appsEnabled,
            extensionTools: resolveCategory(name) === 'extension' ? officialMcpBridge.getTools() : undefined,
        });
        if (plan.kind === 'rejected') return gateError(plan.result);
        if (plan.kind === 'app') {
            return server.projectCallToolResult(
                await executeAppTool(name, plan, client, permMgr, args),
                GENERIC_TOOL_OUTPUT_SCHEMA,
            );
        }
        const { category, action, args: callArgs } = plan;
        if (category === 'file' && action === 'upload_asset'
            && typeof callArgs.localFilePath === 'string' && !isAbsoluteLocalPath(callArgs.localFilePath)) {
            return gateError(createRelativeLocalPathResult(name, action, callArgs.localFilePath));
        }
        const requiresConfirmation = plan.needsConfirmation;

        // 2026-07-28 carries confirmation in-band through MRTR. Legacy
        // clients and clients without form support keep instruction-level confirmation.
        // Skipping the optional UI does not skip permissions or strict write checks.
        if (requiresConfirmation && ctx.mcpReq.envelope && supportsFormElicitation(clientCapabilities)) {
            const confirmationKey = 'dangerous-action-confirmation';
            const hasResponse = Object.prototype.hasOwnProperty.call(
                ctx.mcpReq.inputResponses ?? {},
                confirmationKey,
            );
            const droppedResponse = ctx.mcpReq.droppedInputResponseKeys?.includes(confirmationKey) === true;
            const response = inputResponse(ctx.mcpReq.inputResponses, confirmationKey);

            if (!hasResponse && !droppedResponse) {
                console.error('[MCP][confirmation]', JSON.stringify({ requestId: ctx.mcpReq.id, tool: name, action, decision: 'requested' }));
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

            const confirmation = response.kind === 'elicit' && response.action === 'accept'
                ? z.object({ confirm: z.boolean() }).strict().safeParse(response.content)
                : undefined;
            const decision = response.kind === 'elicit' && response.action === 'cancel'
                ? 'cancelled'
                : (response.kind === 'elicit' && response.action === 'decline') || (confirmation?.success && confirmation.data.confirm === false)
                    ? 'declined'
                    : confirmation?.success && confirmation.data.confirm === true ? 'accepted' : 'invalid';
            // Log only protocol metadata, never business arguments or response content.
            console.error('[MCP][confirmation]', JSON.stringify({
                requestId: ctx.mcpReq.id, tool: name, action, responseKind: response.kind,
                responseAction: response.kind === 'elicit' ? response.action : undefined,
                confirmType: response.kind === 'elicit' ? typeof response.content?.confirm : undefined,
                droppedResponse, decision,
            }));
            if (decision !== 'accepted') {
                const message = decision === 'invalid'
                    ? 'No valid confirmation response was received. Nothing was executed; this does not indicate user cancellation. Check client elicitation support and retry with a valid response after user approval.'
                    : decision === 'cancelled'
                        ? 'The client returned an explicit cancellation response. Nothing was executed.'
                        : 'The client explicitly declined execution or returned confirm=false. Nothing was executed.';
                const declined = {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            success: false,
                            cancelled: decision === 'cancelled',
                            writeAttempted: false,
                            writeExecuted: false,
                            error: { code: `confirmation_${decision}`, message },
                            message,
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

        const transportMode = options.transportMode ?? parseTransportMode();
        const coordinatedMutation = plan.coordinated;
        const coordinatorSettings = (coordinatedMutation || isKernelExport(name, callArgs))
            ? await loadWriteCoordinatorSettings(client, process.env.SIYUAN_TOKEN)
            : undefined;
        const owner = coordinatorSettings?.owner ?? 'node';
        // A live authority change invalidates memory leases and ledger caches.
        // Require a process restart instead of ever resuming a stale local ledger.
        const ownerChanged = coordinatedMutation && runtime.writeCoordinatorOwner !== undefined
            && runtime.writeCoordinatorOwner !== owner;
        if (coordinatedMutation && coordinatorSettings && !ownerChanged) runtime.writeCoordinatorOwner = owner;
        const routeToRemoteCoordinator = (coordinatedMutation
            && (transportMode !== 'http' || owner === 'kernel'))
            || (owner === 'kernel' && isKernelExport(name, callArgs));
        let result: ToolResult;
        try {
            result = await runToolCall(
                {
                    client,
                    category,
                    name,
                    action,
                    args: callArgs,
                    requestText: toolCallRequestText(category, name, action, args),
                    slimResponses: shouldSlimResponse(config, callArgs),
                },
                async () => {
                    if (coordinatedMutation && !coordinatorSettings) {
                        return callCliWriteCoordinator(undefined, name, callArgs);
                    }
                    if (ownerChanged) {
                        return { isError: true, content: [{ type: 'text', text: JSON.stringify({
                            success: false, writeAttempted: false,
                            error: { code: 'write_coordinator_changed', message: 'Write coordinator settings changed. Drain pending writes, restart the MCP server, and repeat preflight.' },
                        }) }] };
                    }
                    if (routeToRemoteCoordinator) {
                        return callCliWriteCoordinator(
                            coordinatorSettings,
                            name,
                            callArgs,
                            client,
                            ctx.mcpReq.signal,
                        );
                    }
                    return executeLocalTool({
                        plan,
                        client,
                        permMgr,
                        coordinator: writeSafetyCoordinator,
                        config,
                        runtime: officialMcpRuntime,
                    });
                },
            );
        } catch (error) {
            if (error instanceof ProtocolError) throw error;
            // Report escaped failures as tool errors (as the kernel does) so the
            // model sees them instead of a bare JSON-RPC error.
            return gateError(createErrorResult(error, { tool: name, action }));
        }
        // The low-level v2 Server leaves cross-era result projection to the
        // handler. Project the complete mixed-content result here so text,
        // image, and structured metadata stay aligned in both protocol eras.
        return server.projectCallToolResult(
            finalizeToolResult(name, action, result, appsEnabled, config),
            GENERIC_TOOL_OUTPUT_SCHEMA,
        );
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
