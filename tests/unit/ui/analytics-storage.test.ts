import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStorageFile } from '@/ui/setting/mcp-config/telemetry-panel-logic';

describe('analytics storage reads', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('reads JSONL as raw text even when SiYuan labels it application/json', async () => {
        const jsonl = '{"tool":"block","action":"append","ts":1}\n{"tool":"block","action":"get_kramdown","ts":2}';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(jsonl, {
            headers: { 'content-type': 'application/json' },
        })));

        await expect(readStorageFile('/data/storage/petal/test/analytics.jsonl')).resolves.toBe(jsonl);
        expect(fetch).toHaveBeenCalledWith('/api/file/getFile', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ path: '/data/storage/petal/test/analytics.jsonl' }),
        }));
    }, 500);

    it('preserves the JSON text consumed by the initial token-cost parser', async () => {
        const json = '{"mcpInitialChars":1200,"mcpInitialApproxTokens":300,"measuredAt":1}';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(json, {
            headers: { 'content-type': 'application/json' },
        })));
        await expect(readStorageFile('/data/storage/petal/test/mcp-initial-cost.json')).resolves.toBe(json);
    }, 500);

    it('accepts an empty statistics file', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('')));
        await expect(readStorageFile('/data/storage/petal/test/analytics.jsonl')).resolves.toBe('');
    }, 500);

    it.each([202, 403, 404, 500])('rejects a failed storage read (HTTP %i)', async (status) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"code":-1,"msg":"unavailable"}', { status })));
        await expect(readStorageFile('/data/storage/petal/test/missing')).rejects.toThrow();
    }, 500);

    it('settles when the network fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        await expect(readStorageFile('/data/storage/petal/test/analytics.jsonl')).rejects.toThrow('Failed to fetch');
    }, 500);

    it('aborts a stalled read rather than leaving the loading promise pending', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        })));
        const failed = expect(readStorageFile('/data/storage/petal/test/analytics.jsonl')).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(10_000);
        await failed;
        expect(vi.getTimerCount()).toBe(0);
    }, 500);
});
