import { normalizeKernelOptions, isKernelOriginAllowed } from '../core/kernel-options';
import { getTelemetryStatus } from '../core/telemetry';
import { KernelTaskResults } from './task-results';
import { KernelEvents } from './events';
import { KernelReadBudget } from './read-budget';
import { hashWriteState } from '../core/write-safety-hash';
import { taskClient } from './task-client';
import { withStructuredContent } from '../core/structured-result';
import { MODERN_VERSION, modernContext, modernResult, KernelConfirmations, type ModernContext, header, isObject } from './modern-protocol';
import { MAX_TRANSFER_FILE_BYTES } from '../core/upload-source';
import { KernelScheduler, KernelQueueError, type KernelTask } from './scheduler';
import { getActionSafetyPolicy } from '../core/write-safety-policy';
import { randomUUID } from './node-shims';
/* Kernel transport: shared dispatcher and validators, build-time action schemas. */
import './polyfill';
declare const siyuan: any;

// Runs inside the kernel goja sandbox; mark the transport so the shared
// lifecycle (analytics/puppy/token) tags these calls and awaits storage writes.
process.env.SIYUAN_MCP_TRANSPORT = 'kernel';

import { KernelSiYuanClient } from './client';
import { PermissionManager } from '../core/permissions';
import { WriteSafetyCoordinator } from '../core/write-safety-coordinator';
import { buildDefaultToolConfig, normalizeToolConfig, isDangerousAction } from '../core/config';
import { runToolCall } from '../core/tool-lifecycle';
import { translateError } from '../tools/internal/errorTranslation';
import type { ToolResult } from '../tools/internal/shared';
import { TOOL_REGISTRY, listAllTools, resolveCategory } from '../core/tool-registry';
import { validateRegisteredToolArguments } from '../tools/internal/define-tool';
import { normalizeActionAlias } from '../core/action-aliases';
import { normalizeToolArguments } from '../core/argument-aliases';
import { buildServerInstructions } from '../core/server-instructions';
import { kernelOfficialRuntime } from './official-mcp';
import { getExposedExtensionTools } from '../tools/extension';
import {
    MCP_APPS_EXTENSION_ID, MCP_APP_MIME_TYPE, supportsMcpApps, decorateToolsWithMcpApps, listMcpAppResources, readMcpAppResource,
    compactMcpAppToolResult, callFlashcardReviewSessionTool, callTimelineAppTool, callMascotShopAppTool,
    FLASHCARD_REVIEW_SESSION_TOOL_NAME, TIMELINE_APP_TOOL_NAME, MASCOT_SHOP_APP_TOOL_NAME,
    FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME, TIMELINE_APP_ACTION_TOOL_NAME, MASCOT_SHOP_APP_ACTION_TOOL_NAME,
} from '../core/mcp-apps';
import {
    kernelGetPrompt,
    kernelListPrompts,
    kernelListResources,
    kernelListResourceTemplates,
    kernelReadResource,
} from './resources';
import {
    getSepSkill,
    listSepSkillResources,
    listSepSkills,
    readSepSkillResource,
} from '../core/skills';

const CONFIG_PATH = 'mcpHttpSettings';
const PLUGIN_NAME = 'siyuan-plugins-mcp-sisyphus';
// Legacy initialization remains available alongside stateless modern discovery.
const PROTOCOL_VERSION = '2025-11-25';
const TASK_META = 'io.siyuan.sisyphus/taskId';
const TASK_EXTENSION = 'io.siyuan.sisyphus/task-control';
function taskOwner(request: any) { return 'task:' + hashWriteState({ auth: header(request, 'authorization'), cookie: header(request, 'cookie') }); }
const SKILLS_EXTENSION_ID = 'io.modelcontextprotocol/skills';

/* ---------- runtime ---------- */

let client: KernelSiYuanClient | null = null;
let permMgr: PermissionManager | null = null;
let coordinator: WriteSafetyCoordinator | null = null;
let config: any = null;
let uploadsInFlight = 0;


async function ensureRuntime(refreshConfig = false) {
    if (!client) {
        client = new KernelSiYuanClient();
        permMgr = new PermissionManager(client as any);
        coordinator = new WriteSafetyCoordinator(client as any);
        try { await permMgr.load(); } catch { /* Calls reload permissions before executing. */ }
    }
    // Re-read the tool config on every call so that tools/list and callTool
    // reflect per-category / per-action enable toggles immediately, even when
    // a client does not subscribe to the optional legacy SSE invalidations.
    if (refreshConfig || config === null) {
        try {
            const raw = await client.readFile('/data/storage/petal/' + PLUGIN_NAME + '/mcpToolsConfig');
            config = normalizeToolConfig(raw ? JSON.parse(raw) : null);
        } catch {
            config = config ?? buildDefaultToolConfig();
        }
    }
    return { client, permMgr: permMgr!, coordinator: coordinator!, config };
}

async function readKernelConfig(): Promise<{ kernelEndpointEnabled?: boolean; skillsExtensionEnabled?: boolean; kernelOptions?: unknown }> {
    try {
        const obj = await siyuan.storage.get(CONFIG_PATH);
        if (!obj) return {};
        const text = await obj.text();
        const parsed = JSON.parse(text);
        return typeof parsed === 'object' && parsed ? parsed : {};
    } catch { return {}; }
}

async function kernelExtensions() {
    const settings = await readKernelConfig();
    return {
        [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] },
        ...(settings.skillsExtensionEnabled !== false ? { [SKILLS_EXTENSION_ID]: { directoryRead: false } } : {}),
        [TASK_EXTENSION]: { version: '2', terminalResults: true },
    };
}

/* ---------- JSON-RPC ---------- */

function jsonRpcResult(id: unknown, result: unknown): any {
    return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: { data: { type: 'JSON', data: { jsonrpc: '2.0', id: id ?? null, result } } } };
}
function jsonRpcError(id: unknown, code: number, message: string): any {
    return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: { data: { type: 'JSON', data: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } } } };
}
function plainResponse(statusCode: number, data: unknown): any {
    return { statusCode, headers: { 'Content-Type': ['application/json'] }, body: { data: { type: 'JSON', data } } };
}
function toolResultToMcp(result: ToolResult): Record<string, unknown> {
    result = withStructuredContent(result) as ToolResult;
    const out: Record<string, unknown> = { content: result.content, ...(result.isError ? { isError: true } : {}) };
    if (result.structuredContent && typeof result.structuredContent === 'object') out.structuredContent = result.structuredContent;
    if (result._meta) out._meta = result._meta;
    return out;
}

/* ---------- dispatch ---------- */

const scheduler = new KernelScheduler();
const confirmations = new KernelConfirmations();
const taskResults = new KernelTaskResults();
async function accessRevision(): Promise<string> {
    // A changed permission/config snapshot invalidates cached disclosure.
    const { client } = await ensureRuntime();
    return hashWriteState(await Promise.all([
        client.readFile('/data/storage/petal/' + PLUGIN_NAME + '/mcpToolsConfig'),
        client.readFile('/data/storage/petal/' + PLUGIN_NAME + '/notebookPermissions'),
    ]));
}
function taskKey(owner: string, id: string) { return JSON.stringify([owner, 'string', id]); }


function errorResult(code: string, message: string): ToolResult {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code, message } }) }] };
}

async function callTool(name: string, input: Record<string, unknown>, appsEnabled = false, task: KernelTask, modern?: ModernContext): Promise<Record<string, unknown>> {
    const { client: c, coordinator: coord, config: cfg } = await ensureRuntime(true);
    scheduler.checkpoint(task);
    // Each call owns its permission snapshot; parallel reloads cannot mutate another call.
    task.cooperative = true;
    const settings = await readKernelConfig();
    const options = normalizeKernelOptions(settings.kernelOptions);
    // Image payload has its own existing 20 MiB cap; preserve ordinary lookup overhead.
    const imageRead = resolveCategory(name) === 'file' && normalizeActionAlias('file', String(input.action ?? '')) === 'read_image';
    const budget = new KernelReadBudget(options.readMaxRequests, (options.readMaxMiB + (imageRead ? 20 : 0)) * 1024 * 1024);
    c.configure(options);
    const scoped = taskClient(c, scheduler, task, budget);
    const pm = new PermissionManager(scoped as any);
    const appEntries = {
        [FLASHCARD_REVIEW_SESSION_TOOL_NAME]: { config: cfg.mcpApps.flashcardReview, call: callFlashcardReviewSessionTool },
        [TIMELINE_APP_TOOL_NAME]: { config: cfg.mcpApps.timeline, call: callTimelineAppTool },
        [MASCOT_SHOP_APP_TOOL_NAME]: { config: cfg.mcpApps.mascotShop, call: callMascotShopAppTool },
    };
    const appEntry = appEntries[name];
    if (appEntry) {
        if (!appEntry.config.enabled) return toolResultToMcp(errorResult('tool_disabled', `${name} is disabled.`));
        if (name === FLASHCARD_REVIEW_SESSION_TOOL_NAME && (!cfg.flashcard.enabled || !cfg.flashcard.actions.list_cards)) {
            return toolResultToMcp(errorResult('action_disabled', 'Flashcard candidate selection is disabled.'));
        }
        return scheduler.run(task, 'exclusive', async () => {
            await pm.load();
            const result = await appEntry.call(scoped as any, pm, input, appEntry.config);
            scheduler.checkpoint(task);
            return toolResultToMcp(result);
        });
    }
    const appActionCategory = name === TIMELINE_APP_ACTION_TOOL_NAME ? 'timeline'
        : name === FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME ? 'flashcard'
        : name === MASCOT_SHOP_APP_ACTION_TOOL_NAME ? 'mascot' : undefined;
    const category = appActionCategory ?? resolveCategory(name);
    if (!category) return toolResultToMcp(errorResult('unknown_tool', `Unknown tool '${name}'`));
    const args = normalizeToolArguments(category, {
        ...input,
        action: category === 'extension' ? input.action : normalizeActionAlias(category, typeof input.action === 'string' ? input.action : ''),
    });
    const action = String(args.action ?? '');
    const actionConfig = appActionCategory === 'timeline' ? cfg.mcpApps.timeline
        : appActionCategory === 'flashcard' ? cfg.mcpApps.flashcardReview
        : appActionCategory === 'mascot' ? cfg.mcpApps.mascotShop : cfg[category];
    if (!actionConfig.enabled) return toolResultToMcp(errorResult('tool_disabled', `${name} is disabled.`));
    if (action !== 'help' && (category !== 'extension' || Object.prototype.hasOwnProperty.call(actionConfig.actions, action)) && !actionConfig.actions[action]) {
        return toolResultToMcp(errorResult('action_disabled', `${name}.${action} is disabled or unknown.`));
    }
    if (category === 'file' && action === 'upload_asset' && !args.uploadSource) {
        return toolResultToMcp(errorResult('kernel_local_file_unavailable',
            'Stage bytes at the authenticated /transfer/upload endpoint and pass uploadSource instead of localFilePath. CLI/Node do this automatically (maximum 10 MiB). No write was attempted.'));
    }
    if (category === 'extension') await TOOL_REGISTRY.extension.prepare?.(cfg.extension, kernelOfficialRuntime);
    const extensionTool = category === 'extension'
        ? getExposedExtensionTools(cfg.extension, kernelOfficialRuntime).find(t => t.name === action)
        : undefined;
    const needsConfirmation = category === 'extension'
        ? extensionTool !== undefined && !extensionTool.readOnlyHint
        : isDangerousAction(category, action);
    if (needsConfirmation && args.validateOnly !== true && modern) {
        const challenge = confirmations.check(modern, name, args);
        if (challenge) return challenge;
    }
    if (needsConfirmation && args.validateOnly !== true && !modern && args.confirm !== true) {
        return toolResultToMcp(errorResult('dangerous_action_requires_confirmation',
            `Action ${name}.${action} was not executed. Confirm with the user, then resend the same arguments with confirm=true.`));
    }
    const cleanArgs = { ...args };
    delete cleanArgs.confirm;
    const execute = async () => {
        if (task.readOnly) task.deadline = Date.now() + options.readTimeoutMs;
        await pm.reload();
        return runToolCall({ client: c as any, category, name, action, args: cleanArgs, slimResponses: cfg.debug.slimResponses && args.delivery !== 'download' },
            () => coord.run({
                client: scoped as any, permMgr: pm, category, action, args: cleanArgs,
                strictMode: cfg.writeSafety.strictMode,
                beforeCommit: () => scheduler.beginCommit(task),
                validateArgs: safeArgs => validateRegisteredToolArguments(category, safeArgs),
                execute: safeArgs => TOOL_REGISTRY[category].callTool(scoped as any, safeArgs, actionConfig, pm, kernelOfficialRuntime),
            }));
    };
    const policy = getActionSafetyPolicy(category, action, cleanArgs);
    // Third-party calls remain serial even with readOnlyHint: their shared bridge
    // and side effects are outside our owned read-action policy.
    const lane = category !== 'extension' && policy.mode === 'read' ? 'read' : 'exclusive';
    task.readOnly = lane === 'read';
    const result = await scheduler.run(task, lane, execute).catch(error => {
        if (error instanceof KernelQueueError) throw error;
        const translated = translateError(error instanceof Error ? error : new Error(String(error)));
        return errorResult(translated?.code ?? 'handler_error', translated?.hint ?? String(error));
    });
    scheduler.checkpoint(task);
    if (task.readOnly) budget.check();
    return toolResultToMcp(compactMcpAppToolResult(name, action, withStructuredContent(result), appsEnabled, cfg.mcpApps) as ToolResult);
}

/** Advice only: never fabricate a cursor, advance a failed page or re-run a write. */
function readRecovery(name: string, args: Record<string, unknown>) {
    const action = String(args.action ?? '');
    const category = resolveCategory(name);
    const help = `siyuan://help/action/${category ?? name}/${action}`;
    if (category === 'file' && action === 'export_markdown_snapshot') return { strategy: 'smaller_page', help, retryArguments: { ...args, limit: Math.max(1, Math.floor(Number(args.limit ?? 20) / 2)) }, advanceCursor: false };
    if (category === 'av' && ['render', 'get_primary_key_values'].includes(action)) return { strategy: 'smaller_page', help, retryArguments: { ...args, pageSize: Math.max(1, Math.floor(Number(args.pageSize) > 0 ? Number(args.pageSize) / 2 : 20)) }, advancePage: false };
    if (Array.isArray(args.ids) && args.ids.length > 1) return { strategy: 'split_ids', help, batchSize: Math.max(1, Math.floor(args.ids.length / 2)), preserveOrder: true, advancePage: false };
    return { strategy: 'narrow_scope', help, hint: 'Use the action pagination/target filters. For SQL add a bounded LIMIT and a stable ORDER BY; do not automatically rewrite arbitrary SQL.', advancePage: false };
}

/* ---------- MCP method router ---------- */

// Only negotiated presentation capabilities are stored here, never auth or
// write leases. Bounded idle expiry avoids retaining abandoned client state.
const sessions = new Map<string, { apps: boolean; seen: number; owner: string }>();
function requestSessionId(request: any): string | undefined {
    for (const [name, value] of Object.entries(request?.request?.headers ?? {})) {
        if (name.toLowerCase() === 'mcp-session-id') return Array.isArray(value) ? value[0] : String(value);
    }
    return undefined;
}


async function handleMcp(request: any): Promise<any> {
    let rpc: any;
    try {
        const data = request?.request?.body?.data;
        const text = data && typeof data.text === 'function' ? await data.text() : null;
        rpc = text ? JSON.parse(text) : null;
    } catch { return jsonRpcError(null, -32700, 'Parse error'); }
    if (!isObject(rpc) || rpc.jsonrpc !== '2.0') return jsonRpcError(null, -32600, 'Invalid Request');
    const { id, method, params } = rpc;
    let modern: ModernContext | undefined;
    try { modern = modernContext(request, rpc); }
    catch (error) { return jsonRpcError(id, -32602, String(error)); }
    const result = (value: any) => jsonRpcResult(id, modern ? modernResult(method, value, siyuan.plugin?.version ?? '0.0.0') : value);
    if (modern && ['initialize', 'ping', 'notifications/initialized', 'notifications/cancelled'].includes(method)) return jsonRpcError(id, -32601, 'Method unavailable in this protocol revision');
    const now = Date.now();
    for (const [key, session] of sessions) if (now - session.seen > 30 * 60_000) { scheduler.cancelSession(key); sessions.delete(key); }
    const sid = modern ? undefined : requestSessionId(request);
    const session = sid ? sessions.get(sid) : undefined;
    if (sid && (!session || session.owner !== taskOwner(request))) return plainResponse(404, { error: 'session_expired' });
    if (session) session.seen = now;
    const appsEnabled = modern ? supportsMcpApps(modern.capabilities) : session?.apps === true;

    switch (method) {
        case 'server/discover': {
            if (!modern) return jsonRpcError(id, -32601, 'Modern discovery requires a protocol envelope');
            const { config: cfg } = await ensureRuntime(true);
            return result({ supportedVersions: [MODERN_VERSION, PROTOCOL_VERSION], capabilities: { tools: {}, resources: {}, prompts: {}, extensions: await kernelExtensions() }, instructions: buildServerInstructions(cfg) });
        }
        case 'initialize': {
            const { config: cfg } = await ensureRuntime(true);
            const sessionId = randomUUID();
            if (sessions.size >= 256) {
                const oldest = sessions.keys().next().value!;
                scheduler.cancelSession(oldest);
                sessions.delete(oldest);
            }
            sessions.set(sessionId, { owner: taskOwner(request), apps: supportsMcpApps(params?.capabilities), seen: now });
            const response = jsonRpcResult(id, {
                protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', PROTOCOL_VERSION].includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSION,
                instructions: buildServerInstructions(cfg),
                capabilities: {
                    tools: { listChanged: !!siyuan.server.private.es },
                    resources: {},
                    prompts: {},
                    extensions: await kernelExtensions(),
                },
                serverInfo: { name: 'siyuan-sisyphus-kernel', version: siyuan.plugin?.version ?? '0.0.0' },
            });
            response.headers['Mcp-Session-Id'] = [sessionId];
            return response;
        }
        case 'notifications/cancelled':
            // Cancellation IDs are JSON-RPC request IDs, not write requestId leases.
            if (sid && (typeof params?.requestId === 'string' || (typeof params?.requestId === 'number' && Number.isFinite(params.requestId)))) scheduler.cancelRequest(sid, params.requestId);
            return { statusCode: 202, headers: {}, body: null };
        case 'notifications/initialized':
        case 'initialized':
            return { statusCode: 202, headers: {}, body: null };
        case 'ping':
            return result({});
        case 'tools/list': {
            const { config: cfg } = await ensureRuntime(true);
            await TOOL_REGISTRY.extension.prepare?.(cfg.extension, kernelOfficialRuntime);
            const tools = decorateToolsWithMcpApps(listAllTools(cfg, kernelOfficialRuntime), appsEnabled, cfg.mcpApps).map(tool => ({
                ...tool,
                inputSchema: {
                    ...tool.inputSchema,
                    properties: {
                        ...(tool.inputSchema.properties as object),
                        confirm: { type: 'boolean', description: 'Set only after user confirmation of this exact dangerous call.' },
                    },
                    // Extension branches are strict; the transport consumes confirm.
                    ...(Array.isArray(tool.inputSchema.oneOf) ? { oneOf: tool.inputSchema.oneOf.map((branch: any) => ({
                        ...branch, properties: { ...branch.properties, confirm: { type: 'boolean' } },
                    })) } : {}),
                },
            }));
            return result({ tools });
        }
        case 'tools/call': {
            const name = params?.name;
            const args = params?.arguments ?? {};
            if (typeof name !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) return jsonRpcError(id, -32602, 'tools/call requires params.name');
            if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id))) return jsonRpcError(id, -32600, 'tools/call requires a string or numeric request id');
            let task: KernelTask | undefined;
            let retained: Record<string, unknown> | undefined;
            let access = '';
            let key: string | undefined;
            try {
                const taskId = params?._meta?.[TASK_META];
                if (taskId !== undefined && (typeof taskId !== 'string' || !/^[a-f0-9-]{36}$/.test(taskId))) return jsonRpcError(id, -32602, 'Invalid taskId');
                key = taskId ? taskKey(taskOwner(request), taskId) : undefined;
                if (key && taskResults.has(key)) throw new KernelQueueError('duplicate_request', 'Task ID already completed; query /tasks result instead of submitting it again.');
                task = scheduler.begin(taskId ? taskOwner(request) : sid, taskId ?? id, { session: sid, id });
                if (key) access = await accessRevision();
                retained = await callTool(name, args, appsEnabled, task, modern);
            } catch (err) {
                const code = err instanceof KernelQueueError ? err.code : 'internal';
                retained = {
                    isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false,
                        ...(err instanceof KernelQueueError ? { writeAttempted: false, writeExecuted: false } : {}),
                        error: { code, message: err instanceof Error ? err.message : String(err) },
                        ...(['read_budget_exceeded', 'read_deadline_exceeded'].includes(code) ? { complete: false, recovery: readRecovery(name, args) } : {}) }) }],
                };
            } finally {
                if (task) {
                    try { if (key && retained && retained.resultType !== 'input_required' && access) taskResults.save(key, retained, access); }
                    finally { scheduler.finish(task); }
                }
            }
            return result(retained!);
        }
        case 'resources/list': {
            const { config: cfg } = await ensureRuntime(true);
            return result({ resources: [...listMcpAppResources(cfg.mcpApps), ...kernelListResources(), ...((await readKernelConfig()).skillsExtensionEnabled !== false ? listSepSkillResources() : [])] });
        }
        case 'resources/templates/list': {
            return result({ resourceTemplates: kernelListResourceTemplates() });
        }
        case 'resources/read': {
            const uri = params?.uri;
            if (typeof uri !== 'string') return jsonRpcError(id, -32602, 'resources/read requires params.uri');
            const { config: cfg } = await ensureRuntime(true);
            const content = readMcpAppResource(uri, cfg.mcpApps) ?? kernelReadResource(uri, cfg?.userRulesText ?? '') ?? ((await readKernelConfig()).skillsExtensionEnabled !== false ? readSepSkillResource(uri) : undefined);
            if (!content) return jsonRpcError(id, -32602, `Unknown resource: ${uri}`);
            return result({ contents: [content] });
        }
        case 'skills/list': {
            if ((await readKernelConfig()).skillsExtensionEnabled === false) return jsonRpcError(id, -32601, 'Skills extension disabled');
            return result({
                skills: listSepSkills(),
                ttlMs: 300_000,
                cacheScope: 'public',
            });
        }
        case 'skills/get': {
            if ((await readKernelConfig()).skillsExtensionEnabled === false) return jsonRpcError(id, -32601, 'Skills extension disabled');
            const uri = params?.uri;
            if (typeof uri !== 'string') return jsonRpcError(id, -32602, 'skills/get requires params.uri');
            const skill = getSepSkill(uri);
            if (!skill) return jsonRpcError(id, -32602, `Unknown skill URI: ${uri}`);
            return result({ skill });
        }
        case 'prompts/list': {
            return result({ prompts: kernelListPrompts() });
        }
        case 'prompts/get': {
            const name = params?.name;
            if (typeof name !== 'string') return jsonRpcError(id, -32602, 'prompts/get requires params.name');
            const prompt = kernelGetPrompt(name, params?.arguments?.task);
            if (!prompt) return jsonRpcError(id, -32602, `Unknown prompt: ${name}`);
            return result(prompt);
        }
        default:
            return jsonRpcError(id, -32601, `Method not found: ${String(method)}`);
    }
}

/* ---------- entry ---------- */

async function handleRequest(request: any): Promise<any> {
    const path: string = request?.url?.path ?? '';
    const cfg = await readKernelConfig();
    const options = normalizeKernelOptions(cfg.kernelOptions);
    if (!isKernelOriginAllowed(header(request, 'origin'), request?.url?.host ?? '', options)) return plainResponse(403, { error: 'untrusted_origin' });
    if (cfg.kernelEndpointEnabled !== true) {
        return plainResponse(503, {
            error: 'kernel_coordinator_disabled',
            message: 'The kernel coordinator endpoint is disabled. Enable "Kernel endpoint" in the plugin HTTP server settings.',
        });
    }
    if (path.endsWith('/health') || path.endsWith('/ping')) {
        return plainResponse(200, { ok: true, plugin: siyuan.plugin?.name ?? 'unknown', version: siyuan.plugin?.version ?? '', queue: scheduler.snapshot(), uploadsInFlight, events: events.snapshot(), taskResults: taskResults.snapshot(), readBudget: { maxRequests: options.readMaxRequests, maxBytes: options.readMaxMiB * 1024 * 1024, imageExtraBytes: 20 * 1024 * 1024, timeoutMs: options.readTimeoutMs, hostAbort: false }, telemetry: client ? getTelemetryStatus(client as any) : { status: 'idle' }, kernelOptions: options, taskControl: { version: '2', path: '/tasks', meta: TASK_META } });
    }
    const method = request?.request?.method;
    if (path.endsWith('/tasks')) {
        if (method !== 'POST') return plainResponse(405, { error: 'method_not_allowed' });
        try {
            const body = JSON.parse(await request.request.body.data.text());
            if (typeof body.taskId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.taskId) || !['status', 'cancel', 'result'].includes(body.operation)) return plainResponse(400, { error: 'invalid_task_control' });
            const owner = taskOwner(request);
            const accepted = body.operation === 'cancel' ? scheduler.cancel(owner, body.taskId) : undefined;
            const status = scheduler.status(owner, body.taskId) ?? taskResults.get(taskKey(owner, body.taskId), await accessRevision(), body.operation === 'result');
            return plainResponse(200, { found: !!status, ...status, ...(accepted !== undefined ? { accepted } : {}) });
        } catch { return plainResponse(400, { error: 'invalid_task_control' }); }
    }
    if (path.endsWith('/transfer/lookup')) {
        if (method !== 'POST') return plainResponse(405, { error: 'method_not_allowed' });
        const { client: c, config: tools } = await ensureRuntime(true);
        if (!tools.file.enabled || !tools.file.actions.upload_asset) return plainResponse(403, { error: 'action_disabled' });
        try {
            const body = JSON.parse(await request.request.body.data.text());
            const receipt = c.uploads.lookup(body.fileName, body.sha256, body.bytes);
            return receipt ? plainResponse(200, receipt) : plainResponse(404, { error: 'upload_source_not_found' });
        } catch { return plainResponse(400, { error: 'invalid_upload_fingerprint' }); }
    }
    if (path.endsWith('/transfer/upload')) {
        if (method !== 'POST') return plainResponse(405, { error: 'method_not_allowed' });
        const { client: c, config: tools } = await ensureRuntime(true);
        if (!tools.file.enabled || !tools.file.actions.upload_asset) return plainResponse(403, { error: 'action_disabled' });
        if (uploadsInFlight >= 2) return plainResponse(429, { error: 'upload_capacity' });
        uploadsInFlight++;
        try {
            const header = (name: string): string => {
                for (const [key, value] of Object.entries(request.request.headers ?? {})) if (key.toLowerCase() === name) return Array.isArray(value) ? String(value[0]) : String(value);
                return '';
            };
            if (header('content-type').split(';')[0].trim() === 'application/octet-stream') {
                const size = Number(header('content-length'));
                if (size > MAX_TRANSFER_FILE_BYTES) throw new Error('Upload exceeds 10 MiB');
                const bytes = new Uint8Array(await request.request.body.data.arrayBuffer());
                return plainResponse(200, await c.uploads.stageBytesAsync(decodeURIComponent(header('x-sisyphus-file-name')), bytes));
            }
            const raw = await request.request.body.data.text();
            if (raw.length > Math.ceil(MAX_TRANSFER_FILE_BYTES / 3) * 4 + 4096) throw new Error('Upload request too large');
            const body = JSON.parse(raw);
            return plainResponse(200, c.uploads.stage(body.fileName, body.dataBase64));
        } catch (error) { return plainResponse(400, { error: String(error) }); }
        finally { uploadsInFlight--; }
    }

    if (method === 'DELETE') {
        const sid = requestSessionId(request);
        if (sid && sessions.get(sid)?.owner === taskOwner(request)) { scheduler.cancelSession(sid); sessions.delete(sid); }
        return { statusCode: 204, headers: {}, body: null };
    }
    if (method && method !== 'POST') return plainResponse(405, { error: 'method_not_allowed' });
    return handleMcp(request);
}

siyuan.server.private.http.handler = function (request: any) {
    return handleRequest(request);
};

// SiYuan dispatches requests with Accept exactly text/event-stream to this hook.
const events = new KernelEvents(async () => {
    if ((await readKernelConfig()).kernelEndpointEnabled !== true) throw new Error('Endpoint disabled');
    const { client } = await ensureRuntime();
    const raw = await client.readFile('/data/storage/petal/' + PLUGIN_NAME + '/mcpToolsConfig');
    const cfg = normalizeToolConfig(raw ? JSON.parse(raw) : null);
    await TOOL_REGISTRY.extension.prepare?.(cfg.extension, kernelOfficialRuntime);
    return hashWriteState({ config: cfg, tools: listAllTools(cfg, kernelOfficialRuntime) });
}, (owner, sid) => {
    const session = sessions.get(sid);
    return !!session && session.owner === owner && Date.now() - session.seen < 30 * 60_000;
});
if (siyuan.server.private.es) siyuan.server.private.es.handler = async (request: any) => {
    const sid = requestSessionId(request);
    const options = normalizeKernelOptions((await readKernelConfig()).kernelOptions);
    if (!isKernelOriginAllowed(header(request, 'origin'), request?.url?.host ?? '', options)) throw new Error('Untrusted origin');
    if (request.request.method !== 'GET' || !request.url.path.endsWith('/mcp') || !sid
        || sessions.get(sid)?.owner !== taskOwner(request)) throw new Error('SSE requires an authenticated legacy MCP session');
    await events.attach(request.port, taskOwner(request), sid);
};
