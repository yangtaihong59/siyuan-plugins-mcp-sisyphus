import { expect, it, vi } from 'vitest';
import { appendAnalyticsEvent, ANALYTICS_PATH, parseJsonl } from '@/core/analytics';
import { earnPuppyBalance, spendPuppyBalance, readPuppyStats } from '@/core/puppy-state';
import { queueStorage } from '@/core/storage-queue';
function storageClient() {
    const files = new Map<string, string>();
    return { files, client: {
        readFile: async (path: string) => { const snapshot = files.get(path) ?? ''; await Promise.resolve(); return snapshot; },
        writeFile: async (path: string, value: string) => { await Promise.resolve(); files.set(path, value); },
    } as any };
}
it('concurrent analytics and earnings preserve all events and increments', async () => {
    const { client, files } = storageClient();
    await Promise.all(Array.from({ length: 32 }, (_, i) => Promise.all([
        earnPuppyBalance(client, `test-${i}`),
        appendAnalyticsEvent(client, { tool: 'system', action: `test-${i}`, status: 'success', durationMs: 1, paramKeys: [], transport: 'kernel' }),
    ])));
    expect(await readPuppyStats(client)).toMatchObject({ totalCalls: 32, balance: 32 });
    expect(new Set(parseJsonl(files.get(ANALYTICS_PATH)!).map(e => e.action)).size).toBe(32);
});
it('spending and earning share the stats lock and reject double spending', async () => {
    const { client } = storageClient(); await earnPuppyBalance(client);
    const results = await Promise.allSettled([spendPuppyBalance(client, 1), spendPuppyBalance(client, 1)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await Promise.all([earnPuppyBalance(client), spendPuppyBalance(client, 1)]);
    expect(await readPuppyStats(client)).toMatchObject({ totalCalls: 2, balance: 0 });
});
it('metadata queues isolate file groups and recover from rejected writes', async () => {
    const client = {}; let release!: () => void;
    const slow = queueStorage(client, 'analytics', () => new Promise<void>(r => { release = r; }));
    await Promise.resolve();
    await expect(queueStorage(client, 'stats', async () => 7)).resolves.toBe(7);
    release(); await slow;
    await expect(queueStorage(client, 'stats', async () => { throw new Error('failed'); })).rejects.toThrow();
    await expect(queueStorage(client, 'stats', async () => 8)).resolves.toBe(8);
});

it('analytics supports the native goja Buffer without byteLength', async () => {
    const { client, files } = storageClient();
    const event = { tool: 'system', action: '中文', status: 'success' as const, durationMs: 1, paramKeys: [], transport: 'kernel' as const };
    vi.stubGlobal('Buffer', { from: Buffer.from });
    try {
        await appendAnalyticsEvent(client, event);
        await appendAnalyticsEvent(client, event);
        expect(parseJsonl(files.get(ANALYTICS_PATH)!)).toHaveLength(2);
    } finally { vi.unstubAllGlobals(); }
});
