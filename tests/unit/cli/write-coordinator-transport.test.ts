import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), callTool: vi.fn(), close: vi.fn() }));
vi.mock('@modelcontextprotocol/client', () => ({
    Client: class { setRequestHandler = vi.fn(); connect = mocks.connect; callTool = mocks.callTool; close = mocks.close; },
    StreamableHTTPClientTransport: class {},
}));
import { callCliWriteCoordinator } from '@/cli/write-coordinator';
const settings = { owner: 'kernel' as const, endpoints: [{ url: 'http://localhost:6806/plugin/private/test/mcp' }] };
beforeEach(() => {
    vi.resetAllMocks();
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
});
it('preserves content and app metadata when delegating to the selected owner', async () => {
    const response = { content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }], _meta: { ui: {} }, structuredContent: { ok: true } };
    mocks.callTool.mockResolvedValue(response);
    expect(await callCliWriteCoordinator(settings, 'block', { action: 'update' })).toEqual(response);
    expect(mocks.callTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'block', arguments: { action: 'update', confirm: true } }));
});
it('reports unknown outcome after dispatch without retry or a false no-write guarantee', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    mocks.callTool.mockRejectedValue(new Error('response lost'));
    const result = await callCliWriteCoordinator(settings, 'block', { action: 'update', requestId: '1234' });
    expect(result.structuredContent).toMatchObject({ error: { code: 'outcome_unknown' }, writeAttempted: true });
    expect(result.structuredContent).not.toHaveProperty('writeExecuted');
    expect(mocks.callTool).toHaveBeenCalledTimes(1);
});
it('rejects a legacy list of competing authorities before connecting', async () => {
    const result = await callCliWriteCoordinator({ endpoints: [...settings.endpoints, { url: 'http://localhost:36806/mcp' }] }, 'block', {});
    expect(result.isError).toBe(true);
    expect(mocks.connect).not.toHaveBeenCalled();
});

it('relays abort through task control and still returns the real committed result', async () => {
    const stop = new AbortController();
    let finish!: (v: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    mocks.callTool.mockImplementation(async () => { stop.abort(); return pending; });
    const response = { content: [{ type: 'text', text: 'committed' }] };
    const fetcher = vi.fn(async (_url, init) => {
        expect(JSON.parse(init.body).operation).toBe('cancel');
        finish(response);
        return new Response(JSON.stringify({ found: true, accepted: false, committing: true }));
    });
    vi.stubGlobal('fetch', fetcher);
    try {
        expect(await callCliWriteCoordinator(settings, 'block', { action: 'update' }, undefined, stop.signal)).toEqual(response);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(mocks.callTool.mock.calls[0][0]._meta['io.siyuan.sisyphus/taskId']).toMatch(/^[a-f0-9-]{36}$/);
    } finally { vi.unstubAllGlobals(); }
});

it('recovers a lost response from the original task without resubmitting a write', async () => {
    const result = { content: [{ type: 'text', text: 'committed' }], structuredContent: { transactionState: 'committed' } };
    mocks.callTool.mockRejectedValue(new Error('response lost'));
    const fetcher = vi.fn(async (_url, init) => {
        expect(JSON.parse(init.body)).toEqual({ operation: 'result', taskId: mocks.callTool.mock.calls[0][0]._meta['io.siyuan.sisyphus/taskId'] });
        return new Response(JSON.stringify({ found: true, state: 'done', resultAvailable: true, result }));
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await callCliWriteCoordinator(settings, 'block', { action: 'update' })).toEqual(result);
    expect(mocks.callTool).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
});
