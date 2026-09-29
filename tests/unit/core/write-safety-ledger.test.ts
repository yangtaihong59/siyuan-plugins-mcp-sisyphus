import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WriteSafetyLedger, WRITE_SAFETY_LEDGER_TTL_MS } from '@/core/write-safety-ledger';
import { WRITE_PREFLIGHT_LEASE_TTL_MS } from '@/core/write-preflight-lease';

vi.mock('node:crypto', async (original) => {
    const actual = await original<typeof import('node:crypto')>();
    return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

function fixture() {
    let saved = JSON.stringify({ code: 404, msg: 'file does not exist', data: null });
    const client = {
        readFile: vi.fn(async () => saved),
        writeFile: vi.fn(async (_path: string, content: string) => { saved = content; }),
    };
    return { client, ledger: new WriteSafetyLedger(client as never), saved: () => JSON.parse(saved) };
}
const args = { action: 'update', id: 'block-1', data: 'SECRET NOTE BODY' };

describe('write safety ledger', () => {
    it('issues four bare digits, persists only metadata, and binds the exact operation', async () => {
        const f = fixture();
        const issued = await f.ledger.issue('block', 'update', args);
        expect(issued.requestId).toMatch(/^[a-f0-9]{4}$/);
        expect(issued.requestIdExpiresAt).toBeGreaterThan(Date.now());
        expect(JSON.stringify(f.saved())).not.toContain('SECRET NOTE BODY');
        expect(f.saved().entries[0].state).toBe('issued');
        const inspected = await f.ledger.inspect(issued.requestId, 'block', 'update', args);
        expect(inspected.entry).toBeUndefined();
        await expect(f.ledger.inspect(issued.requestId, 'block', 'delete', { action: 'delete' }))
            .rejects.toMatchObject({ code: 'idempotency_conflict' });
        await expect(f.ledger.inspect(issued.requestId, 'block', 'update', { ...args, data: 'other' }))
            .rejects.toMatchObject({ code: 'idempotency_conflict' });
        await expect(f.ledger.inspect('not-issued', 'block', 'update', args))
            .rejects.toMatchObject({ code: 'invalid_request_id' });
        await expect(f.ledger.inspect('f'.repeat(64), 'block', 'update', args))
            .rejects.toMatchObject({ code: 'request_id_expired' });
    });

    it('extends collisions across actions, preserves old IDs, and never reuses expired IDs after restart', async () => {
        const f = fixture();
        const digest = Buffer.from('abcd' + '0'.repeat(60), 'hex');
        vi.mocked(randomBytes).mockReturnValue(digest as never);
        try {
            const first = await f.ledger.issue('block', 'update', args);
            const second = await f.ledger.issue('block', 'append', { action: 'append' });
            expect(first.requestId).toBe('abcd');
            expect(second.requestId).toBe('abcd0');
            await expect(f.ledger.inspect('abcd', 'block', 'append', { action: 'append' }))
                .rejects.toMatchObject({ code: 'idempotency_conflict' });
            const now = Date.now();
            vi.spyOn(Date, 'now').mockReturnValue(now + WRITE_PREFLIGHT_LEASE_TTL_MS + 1);
            const restarted = new WriteSafetyLedger(f.client as never);
            await expect(restarted.inspect(first.requestId, 'block', 'update', args))
                .rejects.toMatchObject({ code: 'request_id_expired' });
            const third = await restarted.issue('block', 'update', args);
            expect(third.requestId).toBe('abcd00');
            expect(f.saved().reservedRequestIds).toEqual(['abcd', 'abcd0', 'abcd00']);
        } finally {
            vi.mocked(randomBytes).mockReset();
            const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
            vi.mocked(randomBytes).mockImplementation(actual.randomBytes);
        }
    });

    it('replays persisted results after restart, then rejects after result expiry', async () => {
        const f = fixture();
        const { requestId } = await f.ledger.issue('block', 'update', args);
        const inspected = await f.ledger.inspect(requestId, 'block', 'update', args);
        await f.ledger.record({ requestId, tool: 'block', action: 'update', argsHash: inspected.argsHash,
            targetIds: ['block-1'], state: 'committed', result: { success: true } });
        const restarted = new WriteSafetyLedger(f.client as never);
        expect((await restarted.inspect(requestId, 'block', 'update', args)).entry?.result).toEqual({ success: true });
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + WRITE_SAFETY_LEDGER_TTL_MS + 1);
        await expect(restarted.inspect(requestId, 'block', 'update', args)).rejects.toMatchObject({ code: 'request_id_expired' });
    });

    it('fails closed when reservation persistence fails', async () => {
        const f = fixture();
        f.client.writeFile.mockRejectedValueOnce(new Error('storage unavailable'));
        await expect(f.ledger.issue('block', 'update', args)).rejects.toThrow('storage unavailable');
        expect(f.client.writeFile).toHaveBeenCalledTimes(1);
    });

    it('fails closed for non-404 SiYuan file API envelopes', async () => {
        const client = { readFile: vi.fn(async () => JSON.stringify({ code: 500, msg: 'storage unavailable', data: null })), writeFile: vi.fn() };
        await expect(new WriteSafetyLedger(client as never).issue('block', 'update', args))
            .rejects.toMatchObject({ code: 'write_ledger_unavailable' });
    });
});
