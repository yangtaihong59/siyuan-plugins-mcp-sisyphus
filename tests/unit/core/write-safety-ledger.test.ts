import { describe, expect, it, vi } from 'vitest';

import { WriteSafetyLedger } from '@/core/write-safety-ledger';

function uuidV7(now = Date.now(), suffix = '000000000001') {
    const timestamp = now.toString(16).padStart(12, '0');
    return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7000-8000-${suffix}`;
}

describe('write safety ledger', () => {
    it('initializes an empty ledger from SiYuan getFile missing-file envelope', async () => {
        const writes: string[] = [];
        const client = {
            readFile: vi.fn(async () => JSON.stringify({ code: 404, msg: 'file does not exist', data: null })),
            writeFile: vi.fn(async (_path: string, content: string) => { writes.push(content); }),
        } as never;
        const ledger = new WriteSafetyLedger(client);
        const requestId = uuidV7();
        const inspected = await ledger.inspect(requestId, 'fs', 'write', {
            action: 'write',
            path: '/Test/New',
            markdown: 'body',
        });

        await ledger.record({
            requestId,
            tool: 'fs',
            action: 'write',
            argsHash: inspected.argsHash,
            targetIds: ['/Test/New'],
            state: 'executing',
        });

        expect(JSON.parse(writes[0])).toMatchObject({
            version: 1,
            entries: [{ requestId, state: 'executing' }],
        });
    });

    it('fails closed for non-404 SiYuan file API envelopes', async () => {
        const client = {
            readFile: vi.fn(async () => JSON.stringify({ code: 500, msg: 'storage unavailable', data: null })),
            writeFile: vi.fn(),
        } as never;
        const ledger = new WriteSafetyLedger(client);

        await expect(ledger.inspect(uuidV7(), 'fs', 'write', { action: 'write' }))
            .rejects.toMatchObject({ code: 'write_ledger_unavailable' });
    });

    it('persists metadata hashes without storing note bodies and rejects requestId reuse', async () => {
        const writes: string[] = [];
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async (_path: string, content: string) => { writes.push(content); }),
        } as never;
        const ledger = new WriteSafetyLedger(client);
        const requestId = uuidV7();
        const args = { action: 'update', id: 'block-1', data: 'SECRET NOTE BODY' };
        const inspected = await ledger.inspect(requestId, 'block', 'update', args);
        await ledger.record({
            requestId,
            tool: 'block',
            action: 'update',
            argsHash: inspected.argsHash,
            targetIds: ['block-1'],
            state: 'committed',
            result: { resultHash: 'sha256:v1:abc' },
        });

        expect(writes[writes.length - 1]).not.toContain('SECRET NOTE BODY');
        await expect(ledger.inspect(requestId, 'block', 'delete', { action: 'delete' }))
            .rejects.toMatchObject({ code: 'idempotency_conflict' });
    });
});
