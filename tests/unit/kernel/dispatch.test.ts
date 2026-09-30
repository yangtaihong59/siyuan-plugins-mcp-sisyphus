import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import manifest from '@/kernel/generated/kernel-schemas.json';
import { buildDefaultToolConfig } from '@/core/config';

// Exercise the same no-reflection branch used by the kernel bundler.
vi.mock('@/core/action-schema-runtime', () => ({
    usesBakedActionSchemas: true,
    getBakedActionSchema: (category: string, action: string) => (manifest as any).actions[category][action],
}));

let handler: (request: any) => Promise<any>;
let storage: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let config: ReturnType<typeof buildDefaultToolConfig>;
let downstreamCalls: any[];
let officialTools: any[];
let failCall = false;
let sessionId: string | undefined;
const response = (body: unknown, headers = {}) => ({ ok: true, status: 200, headers, text: async () => JSON.stringify(body) });
const rpc = async (method: string, params: any = {}) => {
    storage.set('mcpToolsConfig', JSON.stringify(config));
    const res = await handler({ url: { path: '/plugin/private/siyuan-plugins-mcp-sisyphus/mcp' }, request: { headers: sessionId ? { 'Mcp-Session-Id': [sessionId] } : {}, body: { data: { text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) } } } });
    sessionId = res.headers['Mcp-Session-Id']?.[0] ?? sessionId;
    return res.body.data.data;
};
const call = async (name: string, args: any) => (await rpc('tools/call', { name, arguments: args })).result;

beforeEach(async () => {
    vi.resetModules();
    config = buildDefaultToolConfig();
    config.debug.slimResponses = false;
    config.extension.enabled = true;
    storage = new Map([['mcpHttpSettings', '{"kernelEndpointEnabled":true}'], ['notebookPermissions', '{}']]);
    downstreamCalls = [];
    officialTools = [{ name: 'plugin__example__echo', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }];
    failCall = false;
    sessionId = undefined;
    fetchMock = vi.fn(async (path: string, init: any) => {
        const body = JSON.parse(init.body || '{}');
        if (path === '/mcp') {
            if (body.method === 'initialize') return response({ jsonrpc: '2.0', id: 'init', result: {} }, { 'Mcp-Session-Id': 'test' });
            if (body.method === 'tools/list') return response({ jsonrpc: '2.0', id: 1, result: { tools: officialTools } });
            if (body.method === 'tools/call') {
                downstreamCalls.push(body.params);
                if (failCall) throw new Error('lost after dispatch');
                return response({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'echo' }], structuredContent: { ok: true } } });
            }
            return response({});
        }
        if (path === '/api/notebook/createNotebook') {
            const notebook = { id: '20260928123456-abcdefg', name: body.name, closed: false };
            storage.set('test-notebook', JSON.stringify(notebook));
            return response({ code: 0, data: { notebook } });
        }
        if (path === '/api/notebook/lsNotebooks') return response({ code: 0, data: { notebooks: storage.has('test-notebook') ? [JSON.parse(storage.get('test-notebook')!)] : [] } });
        if (path === '/api/system/version') return response({ code: 0, data: '3.8.6' });
        return response({ code: 0, data: {} });
    });
    vi.stubGlobal('siyuan', {
        plugin: { name: 'test', version: 'test' }, client: { fetch: fetchMock },
        storage: { get: async (key: string) => ({ text: async () => storage.get(key) ?? '' }), put: async (key: string, value: string) => { storage.set(key, value); } },
        server: { private: { http: {}, es: {} } },
    });
    vi.stubEnv('SIYUAN_MCP_TRANSPORT', 'kernel');
    await import('@/kernel/index');
    handler = (globalThis as any).siyuan.server.private.http.handler;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('kernel shared dispatch', () => {
    it('retains rules, negotiates only supported protocol, and serves action help', async () => {
        config.userRulesText = '遵守测试规则';
        const init = (await rpc('initialize', { protocolVersion: '2026-07-28' })).result;
        expect(init.protocolVersion).toBe('2025-11-25');
        expect(init.instructions).toContain('遵守测试规则');
        expect((await call('block', { action: 'help', topic: 'update' })).isError).not.toBe(true);
        const resource = await rpc('resources/read', { uri: 'siyuan://help/action/block/update' });
        expect(resource.result.contents[0].text).toContain('update');
    });
    it('normalizes aliases and enforces category and action toggles in list and call', async () => {
        expect((await call('system', { action: 'get-version' })).isError).not.toBe(true);
        config.system.actions.get_version = false;
        expect((await call('system', { action: 'get-version' })).isError).toBe(true);
        const listed = (await rpc('tools/list')).result.tools.find((t: any) => t.name === 'system');
        expect(listed.inputSchema.properties.action.enum).not.toContain('get_version');
        config.system.enabled = false;
        const count = fetchMock.mock.calls.length;
        expect((await call('system', { action: 'get_version' })).isError).toBe(true);
        expect(fetchMock.mock.calls.length).toBe(count);
    });
    it('negotiates App tools per session and serves the shared HTML resource metadata', async () => {
        const before = (await rpc('tools/list')).result.tools;
        expect(before.some((t: any) => t.name === 'timeline_app')).toBe(false);
        await rpc('initialize', { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } });
        const after = (await rpc('tools/list')).result.tools;
        const app = after.find((t: any) => t.name === 'timeline_app');
        expect(app._meta.ui.resourceUri).toBeTruthy();
        const resource = (await rpc('resources/read', { uri: app._meta.ui.resourceUri })).result.contents[0];
        expect(resource.mimeType).toBe('text/html;profile=mcp-app');
        expect(resource._meta.ui.prefersBorder).toBe(true);
        config.mcpApps.timeline.enabled = false;
        expect((await call('timeline_app', {})).isError).toBe(true);
        expect((await call('timeline_app_action', { action: 'list_nodes' })).isError).toBe(true);
    });
    it('rejects host-file upload preflight before issuing credentials or accessing local files', async () => {
        const result = await call('file', { action: 'upload_asset', assetsDirPath: '/assets/', localFilePath: '/tmp/fixture.png', validateOnly: true });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('kernel_local_file_unavailable');
        expect(storage.has('writeSafetyLedger')).toBe(false);
    });
    it('validates mutation input before issuing preflight credentials', async () => {
        const result = await call('block', { action: 'update', validateOnly: true });
        expect(result.isError).toBe(true);
        expect(storage.has('writeSafetyLedger')).toBe(false);
    });
    it('lists a callable aggregate and unwraps downstream results', async () => {
        const tools = (await rpc('tools/list')).result.tools;
        expect(tools.some((t: any) => t.name === 'extension')).toBe(true);
        expect(tools.some((t: any) => t.name === 'plugin__example__echo')).toBe(false);
        const result = await call('extension', { action: 'plugin__example__echo', arguments: { value: 'hello' } });
        expect(result.result).toBeUndefined();
        expect(result.content[0].type).toBe('text');
        expect(result.structuredContent).toMatchObject({ ok: true });
        expect(downstreamCalls).toEqual([{ name: 'plugin__example__echo', arguments: { value: 'hello' } }]);
    });
    it('never dispatches an extension preflight even with nested arguments and confirmation', async () => {
        const result = await call('extension', { action: 'plugin__example__echo', arguments: {}, validateOnly: true, confirm: true });
        expect(result.isError).toBe(true);
        expect(downstreamCalls).toHaveLength(0);
    });
    it('enforces blocked tools and category off before forwarding', async () => {
        config.extension.blockedTools = ['plugin__example__echo'];
        expect((await call('extension', { action: 'plugin__example__echo', arguments: {}, confirm: true })).isError).toBe(true);
        config.extension.enabled = false;
        expect((await call('extension', { action: 'plugin__example__echo', arguments: {}, confirm: true })).isError).toBe(true);
        expect(downstreamCalls).toHaveLength(0);
    });
    it('never retries a lost downstream write response', async () => {
        failCall = true;
        officialTools[0].annotations.readOnlyHint = false;
        const result = await call('extension', { action: 'plugin__example__echo', arguments: {}, confirm: true });
        expect(result.isError).toBe(true);
        expect(downstreamCalls).toHaveLength(1);
        expect(JSON.stringify(result)).toContain('outcome_unknown');
    });
    it('shares one preflight and replay ledger across direct kernel and CLI HTTP calls', async () => {
        const preflight = await call('notebook', { action: 'create', name: 'fixture', validateOnly: true });
        const credential = preflight.structuredContent ?? JSON.parse(preflight.content[0].text);
        expect(credential.requestId).toMatch(/^[a-f0-9]{4,64}$/);
        const http = createServer(async (req, res) => {
            try {
                let body = '';
                for await (const part of req) body += part;
                const reply = await handler({ url: { path: req.url }, request: {
                    method: req.method, headers: req.headers,
                    body: { data: { text: async () => body } },
                } });
                res.writeHead(reply.statusCode, reply.headers);
                res.end(reply.body ? JSON.stringify(reply.body.data.data) : undefined);
            } catch (error) { res.writeHead(500); res.end(String(error)); }
        });
        await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
        const port = (http.address() as any).port;
        try {
            const { callCliWriteCoordinator } = await import('@/cli/write-coordinator');
            const settings = { owner: 'kernel' as const, endpoints: [{ url: `http://127.0.0.1:${port}/plugin/private/test/mcp` }] };
            const args = { action: 'create', name: 'fixture', requestId: credential.requestId };
            const result = await callCliWriteCoordinator(settings, 'notebook', args);
            expect(result.isError, JSON.stringify(result)).not.toBe(true);
            const replay = await call('notebook', args);
            expect(replay.isError, JSON.stringify(replay)).not.toBe(true);
            expect(fetchMock.mock.calls.filter(([path]) => path === '/api/notebook/createNotebook')).toHaveLength(1);
            expect(JSON.stringify(result)).toContain('committed');
        } finally {
            http.closeAllConnections();
            await new Promise<void>(resolve => http.close(() => resolve()));
        }
    });

});

it('stages bytes without asset writes, validates source and commits/replays the exact binary once', async () => {
    config.file.actions.upload_asset = true;
    storage.set('mcpToolsConfig', JSON.stringify(config));
    const bytes = new TextEncoder().encode('中文附件 🌏');
    const stage = await handler({ url: { path: '/plugin/private/siyuan-plugins-mcp-sisyphus/transfer/upload' }, request: { method: 'POST', body: { data: { text: async () => JSON.stringify({ fileName: '附件.txt', dataBase64: Buffer.from(bytes).toString('base64') }) } } } });
    const binary = await handler({ url: { path: '/transfer/upload' }, request: { method: 'POST', headers: { 'Content-Type': ['application/octet-stream'], 'X-Sisyphus-File-Name': encodeURIComponent('附件.txt') }, body: { data: { arrayBuffer: async () => bytes.buffer } } } });
    expect(binary.statusCode).toBe(200);
    expect(binary.body.data.data).toMatchObject({ uploadSource: stage.body.data.data.uploadSource, bytes: bytes.length });
    const oversized = await handler({ url: { path: '/transfer/upload' }, request: { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(10 * 1024 * 1024 + 1) } } });
    expect(oversized.statusCode).toBe(400);
    expect(stage.statusCode).toBe(200);
    const uploadSource = stage.body.data.data.uploadSource;
    expect(uploadSource).toMatch(/^[a-f0-9]{64}$/);
    let writes = 0;
    fetchMock.mockImplementation(async (path: string, init: any) => {
        if (path === '/api/asset/upload') {
            writes++;
            const form = await new Response(init.body, { headers: init.headers }).formData();
            expect(await (form.get('file[]') as File).text()).toBe('中文附件 🌏');
            return response({ code: 0, data: { errFiles: [], succMap: { '附件.txt': 'assets/附件-fixture.txt' } } });
        }
        if (path === '/api/file/getFile') return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
        return response({ code: 0, data: {} });
    });
    const args = { action: 'upload_asset', assetsDirPath: '/assets/', uploadSource };
    const p = await call('file', { ...args, validateOnly: true });
    expect(writes).toBe(0);
    const pre = p.structuredContent ?? JSON.parse(p.content[0].text);
    expect(pre.preconditionField).toBe('expectedSourceHash');
    const committed = await call('file', { ...args, requestId: pre.requestId, expectedSourceHash: pre.expectedSourceHash, confirm: true });
    expect(committed.isError).not.toBe(true);
    expect(JSON.stringify(committed)).toContain('committed');
    const replay = await call('file', { ...args, requestId: pre.requestId, expectedSourceHash: pre.expectedSourceHash, confirm: true });
    expect(JSON.stringify(replay)).toContain('"replayed":true');
    expect(writes).toBe(1);
});

async function requestInSession(sid: string, id: number | string | undefined, method: string, params: any) {
    storage.set('mcpToolsConfig', JSON.stringify(config));
    return handler({ url: { path: '/plugin/private/siyuan-plugins-mcp-sisyphus/mcp' }, request: {
        method: 'POST', headers: { 'Mcp-Session-Id': [sid] },
        body: { data: { text: async () => JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }) } },
    } });
}
const toolPayload = (response: any) => response.body.data.data.result;
it('runs four reads concurrently, cancels a fifth only in its session and preserves every completed analytics event', async () => {
    await rpc('initialize'); const sid = sessionId!;
    await rpc('initialize'); const other = sessionId!;
    const original = fetchMock.getMockImplementation()!;
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    let active = 0, highWater = 0, calls = 0;
    fetchMock.mockImplementation(async (path: string, init: any) => {
        if (path === '/api/system/version') { active++; calls++; highWater = Math.max(highWater, active); await gate; active--; }
        return original(path, init);
    });
    const params = { name: 'system', arguments: { action: 'get_version' } };
    const reads = [1, 2, 3, 4].map(id => requestInSession(sid, id, 'tools/call', params));
    await vi.waitFor(() => expect(active).toBe(4));
    let settled = false;
    const queued = requestInSession(sid, 5, 'tools/call', params).then(r => { settled = true; return r; });
    await requestInSession(other, undefined, 'notifications/cancelled', { requestId: 5 });
    expect(settled).toBe(false);
    // Slow reads do not block a mutation preflight in the independent admission lane.
    const write = toolPayload(await requestInSession(sid, 6, 'tools/call', { name: 'notebook', arguments: { action: 'create', name: 'parallel', validateOnly: true } }));
    expect(write.isError).not.toBe(true);
    await requestInSession(sid, undefined, 'notifications/cancelled', { requestId: 5 });
    expect(JSON.stringify(toolPayload(await queued))).toContain('request_cancelled');
    release(); await Promise.all(reads);
    expect(calls).toBe(4); expect(highWater).toBe(4);
    const events = (storage.get('analytics.jsonl') ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(events.filter(e => e.tool === 'system' && e.action === 'get_version')).toHaveLength(4);
    expect(JSON.parse(storage.get('puppyStats.json')!).totalCalls).toBe(5);
});
it('cancels a queued mutation without consuming its lease and never reports a running write as cancelled', async () => {
    await rpc('initialize'); const sid = sessionId!;
    const preflight = async (id: number, name: string) => {
        const r = toolPayload(await requestInSession(sid, id, 'tools/call', { name: 'notebook', arguments: { action: 'create', name, validateOnly: true } }));
        return r.structuredContent ?? JSON.parse(r.content[0].text);
    };
    const a = await preflight(1, 'first'), b = await preflight(2, 'second');
    const original = fetchMock.getMockImplementation()!;
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    let writes = 0;
    fetchMock.mockImplementation(async (path: string, init: any) => { if (path === '/api/notebook/createNotebook') { writes++; await gate; } return original(path, init); });
    const one = requestInSession(sid, 3, 'tools/call', { name: 'notebook', arguments: { action: 'create', name: 'first', requestId: a.requestId } });
    await vi.waitFor(() => expect(writes).toBe(1));
    const args = { action: 'create', name: 'second', requestId: b.requestId };
    const two = requestInSession(sid, 4, 'tools/call', { name: 'notebook', arguments: args });
    await requestInSession(sid, undefined, 'notifications/cancelled', { requestId: 4 });
    expect(JSON.stringify(toolPayload(await two))).toContain('request_cancelled');
    await requestInSession(sid, undefined, 'notifications/cancelled', { requestId: 3 });
    release(); expect(JSON.stringify(toolPayload(await one))).toContain('committed');
    expect(writes).toBe(1);
    const resumed = toolPayload(await requestInSession(sid, 5, 'tools/call', { name: 'notebook', arguments: args }));
    expect(resumed.isError).not.toBe(true); expect(writes).toBe(2);
});

it('serves modern SDK discovery, cacheable resources, and bound multi-round confirmation over HTTP', async () => {
    config.system.actions.perform_sync = true;
    storage.set('mcpToolsConfig', JSON.stringify(config));
    const http = createServer(async (req, res) => {
        try {
            let body = ''; for await (const part of req) body += part;
            const reply = await handler({ url: { path: req.url }, request: { method: req.method, headers: req.headers, body: { data: { text: async () => body } } } });
            res.writeHead(reply.statusCode, reply.headers); res.end(reply.body ? JSON.stringify(reply.body.data.data) : undefined);
        } catch (error) { res.writeHead(500); res.end(String(error)); }
    });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const sdk = new Client({ name: 'modern-test', version: '1' }, { capabilities: { elicitation: {}, extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }, versionNegotiation: { mode: 'auto' } });
    let accept = false;
    const confirm = vi.fn(async () => ({ action: accept ? 'accept' as const : 'decline' as const, content: { confirm: accept } }));
    sdk.setRequestHandler('elicitation/create', confirm);
    try {
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(http.address() as any).port}/mcp`));
        await sdk.connect(transport);
        expect(sdk.getNegotiatedProtocolVersion()).toBe('2026-07-28');
        expect(transport.sessionId).toBeUndefined();
        expect((await sdk.listTools()).tools.length).toBeGreaterThan(10);
        expect((await sdk.listResources()).resources.length).toBeGreaterThan(0);
        const candidates = await sdk.callTool({ name: 'flashcard', arguments: { action: 'list_cards', scope: 'all', filter: 'due' } });
        expect(candidates.structuredContent).toMatchObject({ scope: 'all', filter: 'due', candidateView: 'ai-selectable-due-flashcards', candidateToken: expect.any(String) });
        expect((await sdk.callTool({ name: 'system', arguments: { action: 'get_version' } })).isError).not.toBe(true);
        expect((await sdk.callTool({ name: 'system', arguments: { action: 'perform_sync', confirm: true } })).isError).toBe(true);
        expect(fetchMock.mock.calls.filter(([path]) => path === '/api/sync/performSync')).toHaveLength(0);
        accept = true;
        expect((await sdk.callTool({ name: 'system', arguments: { action: 'perform_sync' }, _meta: { 'io.siyuan.sisyphus/taskId': '11111111-1111-4111-8111-111111111111' } })).isError).not.toBe(true);
        expect(fetchMock.mock.calls.filter(([path]) => path === '/api/sync/performSync')).toHaveLength(1);
        expect(confirm).toHaveBeenCalledTimes(2);
    } finally { await sdk.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); }
});

it('auth-binds modern task cancellation and retains the slot until the native read finishes', async () => {
    config.extension.enabled = false; storage.set('mcpToolsConfig', JSON.stringify(config));
    const taskId = '11111111-1111-4111-8111-111111111111';
    let release!: () => void, started!: () => void;
    const start = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    fetchMock.mockImplementation(async (path: string) => {
        if (path === '/api/system/version') { started(); await gate; return response({ code: 0, data: '3.8.6' }); }
        return response({ code: 0, data: {} });
    });
    const invoke = (path: string, data: any, auth = 'Bearer principal-a') => handler({ url: { path }, request: { method: 'POST', headers: { Authorization: [auth] }, body: { data: { text: async () => JSON.stringify(data) } } } });
    const pending = invoke('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'system', arguments: { action: 'get_version' }, _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.siyuan.sisyphus/taskId': taskId,
    } } });
    await start;
    const wrong = (await invoke('/tasks', { taskId, operation: 'cancel' }, 'Bearer principal-b')).body.data.data;
    expect(wrong).toMatchObject({ found: false, accepted: false });
    const cancelled = (await invoke('/tasks', { taskId, operation: 'cancel' })).body.data.data;
    expect(cancelled).toMatchObject({ found: true, accepted: true, state: 'running', cancelRequested: true });
    release();
    const result = (await pending).body.data.data.result;
    expect(JSON.stringify(result)).toContain('request_cancelled');
    expect(JSON.parse(result.content[0].text).writeAttempted).toBe(false);
    expect((await invoke('/tasks', { taskId, operation: 'status' })).body.data.data).toMatchObject({ found: true, state: 'done', resultAvailable: true });
    expect(JSON.stringify((await invoke('/tasks', { taskId, operation: 'result' })).body.data.data.result)).toContain('request_cancelled');
});

it('bounds upload staging admission before reading request bodies', async () => {
    storage.set('mcpToolsConfig', JSON.stringify(config));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const upload = (name: string) => handler({ url: { path: '/transfer/upload' }, request: { method: 'POST', headers: { 'Content-Type': ['application/octet-stream'], 'X-Sisyphus-File-Name': [name] }, body: { data: { arrayBuffer: async () => { await gate; return new Uint8Array([1, 2]).buffer; } } } } });
    const one = upload('one'), two = upload('two');
    for (let i = 0; i < 20; i++) {
        const health = await handler({ url: { path: '/health' }, request: {} });
        if (health.body.data.data.uploadsInFlight === 2) break;
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect((await upload('third')).statusCode).toBe(429);
    release();
    expect((await one).statusCode).toBe(200); expect((await two).statusCode).toBe(200);
    expect((await handler({ url: { path: '/health' }, request: {} })).body.data.data.uploadsInFlight).toBe(0);
});

it('retains completed results with auth/config isolation and rejects task ID reuse', async () => {
    storage.set('mcpToolsConfig', JSON.stringify(config));
    const taskId = '22222222-2222-4222-8222-222222222222';
    const invoke = async (path: string, body: any, auth = 'Bearer a') => handler({ url: { path }, request: { method: 'POST', headers: { Authorization: auth }, body: { data: { text: async () => JSON.stringify(body) } } } });
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'system', arguments: { action: 'get_version' }, _meta: { 'io.siyuan.sisyphus/taskId': taskId } } };
    const result = (await invoke('/mcp', request)).body.data.data.result;
    expect((await invoke('/tasks', { operation: 'result', taskId })).body.data.data).toMatchObject({ found: true, state: 'done', resultAvailable: true, result });
    expect((await invoke('/tasks', { operation: 'result', taskId }, 'Bearer b')).body.data.data.found).toBe(false);
    expect(JSON.stringify(await invoke('/mcp', request))).toContain('duplicate_request');
    storage.set('notebookPermissions', '{"new":"none"}');
    const revoked = (await invoke('/tasks', { operation: 'result', taskId })).body.data.data;
    expect(revoked).toMatchObject({ resultAvailable: false, reason: 'access_changed' }); expect(revoked).not.toHaveProperty('result');
});

it('rejects oversized read bodies even when the tool handler catches the budget exception', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (path: string, init: any) => path === '/api/system/version' ? response({ code: 0, data: 'x'.repeat(8 * 1024 * 1024 + 1) }) : original(path, init));
    const result = await call('system', { action: 'get_version' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('read_budget_exceeded');
});
it('advertises App capabilities and honors the persisted Skills switch', async () => {
    storage.set('mcpHttpSettings', JSON.stringify({ kernelEndpointEnabled: true, skillsExtensionEnabled: false }));
    const init = (await rpc('initialize')).result;
    expect(init.capabilities.extensions['io.modelcontextprotocol/ui'].mimeTypes).toContain('text/html;profile=mcp-app');
    expect(init.capabilities.extensions['io.modelcontextprotocol/skills']).toBeUndefined();
    expect((await rpc('skills/list')).error.code).toBe(-32601);
    const resources = (await rpc('resources/list')).result.resources;
    const { listSepSkillResources } = await import('@/core/skills');
    const sepUris = new Set(listSepSkillResources().map(r => r.uri));
    expect(resources.some((r: any) => sepUris.has(r.uri))).toBe(false);
});
it('enforces exact Origin allowlist on the private endpoint', async () => {
    storage.set('mcpHttpSettings', JSON.stringify({ kernelEndpointEnabled: true, kernelOptions: { allowedOrigins: ['https://client.example'] } }));
    const request = (origin: string) => handler({ url: { path: '/plugin/private/siyuan-plugins-mcp-sisyphus/health' }, request: { headers: { Origin: [origin], Host: ['localhost:6806'] }, method: 'GET' } });
    expect((await request('https://client.example')).statusCode).toBe(200);
    expect((await request('https://client.example.evil')).statusCode).toBe(403);
});
it('returns bounded read recovery information without pretending partial results are complete', async () => {
    storage.set('mcpHttpSettings', JSON.stringify({ kernelEndpointEnabled: true, kernelOptions: { readMaxMiB: 1 } }));
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (path: string, init: any) => path === '/api/system/version' ? response({ code: 0, data: 'x'.repeat(1024 * 1024 + 1) }) : original(path, init));
    const result = await call('system', { action: 'get_version' });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.complete).toBe(false); expect(payload.recovery.advancePage).toBe(false);
});


it('uses the host URL authority for HTTP and SSE without Host or forwarded-host fallbacks', async () => {
    await rpc('initialize');
    const sid = sessionId!;
    storage.set('mcpToolsConfig', JSON.stringify(config));
    storage.set('mcpHttpSettings', JSON.stringify({ kernelEndpointEnabled: true, kernelOptions: { allowedOrigins: ['https://allowed.example'] } }));
    const invoke = (origin?: string, host = '127.0.0.1:16807') => ({
        url: { host, path: '/mcp' }, request: { method: 'GET', headers: {
            'Mcp-Session-Id': [sid], ...(origin ? { Origin: [origin] } : {}),
            'X-Forwarded-Host': ['evil.example'],
        } }, port: { send: vi.fn(), close: vi.fn() },
    });
    const sse = (globalThis as any).siyuan.server.private.es.handler;
    for (const origin of [undefined, 'http://127.0.0.1:16807', 'https://allowed.example']) {
        const req = invoke(origin);
        expect((await handler({ ...req, url: { ...req.url, path: '/health' } })).statusCode).toBe(200);
        await expect(sse(req)).resolves.toBeUndefined();
        req.port.onclose?.();
    }
    for (const origin of ['http://127.0.0.1:16808', 'http://localhost:16807', 'http://evil.example']) {
        const req = invoke(origin);
        expect((await handler(req)).statusCode).toBe(403);
        await expect(sse(req)).rejects.toThrow('Untrusted origin');
    }
    const forged = invoke('http://127.0.0.1:16807', 'different.example');
    (forged.request.headers as any).Host = ['127.0.0.1:16807'];
    expect((await handler(forged)).statusCode).toBe(403);
    await expect(sse(forged)).rejects.toThrow('Untrusted origin');
});

it.each(['notification', 'delete', 'expiry', 'eviction', 'explicit'])(
    'cancels a taskId read through %s while retaining the native I/O slot', async mode => {
    config.extension.enabled = false;
    await rpc('initialize'); const sid = sessionId!;
    const taskId = '33333333-3333-4333-8333-333333333333';
    const original = fetchMock.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let started = false;
    fetchMock.mockImplementation(async (path: string, init: any) => {
        if (path === '/api/system/version') { started = true; await gate; }
        return original(path, init);
    });
    const pending = requestInSession(sid, 1, 'tools/call', { name: 'system', arguments: { action: 'get_version' }, _meta: { 'io.siyuan.sisyphus/taskId': taskId } });
    await vi.waitFor(() => expect(started).toBe(true));
    const control = (operation: string) => handler({ url: { path: '/tasks' }, request: { method: 'POST', body: { data: { text: async () => JSON.stringify({ taskId, operation }) } } } });
    try {
        if (mode === 'notification') await requestInSession(sid, undefined, 'notifications/cancelled', { requestId: 1 });
        if (mode === 'delete') await handler({ url: { path: '/mcp' }, request: { method: 'DELETE', headers: { 'Mcp-Session-Id': [sid] } } });
        if (mode === 'explicit') expect((await control('cancel')).body.data.data.accepted).toBe(true);
        if (mode === 'expiry') {
            const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
            await rpc('initialize'); vi.restoreAllMocks();
        }
        if (mode === 'eviction') for (let i = 0; i < 256; i++) await rpc('initialize');
        expect((await control('status')).body.data.data).toMatchObject({ cancelRequested: true, state: 'running' });
        const health = await handler({ url: { path: '/health' }, request: {} });
        expect(health.body.data.data.queue).toMatchObject({ inFlight: 1, readsRunning: 1, cancelledRunning: 1 });
    } finally { release(); }
    expect(JSON.stringify(toolPayload(await pending))).toContain('request_cancelled');
    expect((await control('result')).body.data.data).toMatchObject({ found: true, state: 'done' });
});
