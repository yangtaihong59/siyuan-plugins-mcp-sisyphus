import { describe, expect, it, vi } from 'vitest';
import { WriteSafetyCoordinator } from '@/mcp/write-safety-coordinator';
import { WRITE_SAFETY_LEDGER_PATH } from '@/mcp/write-safety-ledger';
import { AvCreateSchema } from '@/tools/av/schemas';
import { callAvTool } from '@/tools/av';
import { buildDefaultToolConfig } from '@/core/config';

vi.mock('@/tools/internal/context', async original => ({ ...await original<any>(), ensurePermissionForDocumentId: vi.fn(async () => ({ denied: null, context: { notebook: 'nb', documentId: 'parent' } })) }));

function fixture() {
    const files = new Map<string, string>();
    const avs = new Map<string, any>();
    const blocks = new Map<string, string>();
    let failure = '';
    let writes = 0;
    let ledgerWrites = 0;
    const client: any = {
        readFile: async (path: string) => files.get(path) ?? '',
        writeFile: async (path: string, value: string) => {
            ledgerWrites++;
            if (failure === `ledger-${ledgerWrites}`) throw new Error('ledger unavailable');
            files.set(path, value);
        },
        requestRead: vi.fn(async (path: string, args: any) => {
            if (path === '/api/lute/spinBlockDOM') return { dom: args.dom };
            if (path === '/api/av/getAttributeView') {
                if (failure === 'av-readback' && writes) throw new Error('readback timeout');
                return { av: avs.get(args.id) ?? null };
            }
            if (path === '/api/block/getChildBlocks') return args.id === 'parent' ? [{ id: 'first-child', type: 'p' }, { id: 'last-child', type: 'p' }] : [];
            if (path === '/api/block/getBlockDOM') {
                if (failure === 'carrier-readback') throw new Error('carrier timeout');
                return { dom: blocks.get(args.id) ?? '' };
            }
            throw new Error(`Unexpected read ${path}`);
        }),
        requestWrite: vi.fn(async (path: string, args: any) => {
            if (path === '/api/av/renderAttributeView') {
                writes++; avs.set(args.id, { id: args.id, keyValues: [{ key: { id: 'key-pk', name: '主键', type: 'block' } }, { key: { id: 'key-sel', name: '单选', type: 'select' } }], views: [] });
                if (failure === 'av-response') throw new Error('lost AV response');
                return {};
            }
            if (path === '/api/lute/spinBlockDOM') return { dom: args.dom };
            if (path === '/api/transactions') {
                if (failure === 'carrier-before') throw new Error('carrier insert failed');
                writes++;
                for (const operation of args.transactions[0].doOperations) {
                    if (operation.action === 'setAttrViewName') { avs.get(operation.avID).name = operation.data; continue; }
                    blocks.set(operation.id, operation.data);
                }
                if (failure === 'carrier-response') throw new Error('lost carrier response');
                return [];
            }
            if (path.startsWith('/api/ui/')) return null;
            throw new Error(`Unexpected write ${path}`);
        }),
    };
    const config = buildDefaultToolConfig();
    let coordinator = new WriteSafetyCoordinator(client);
    const run = (args: Record<string, unknown>, oneStep?: 'low_risk') => coordinator.run({ client, permMgr: {} as any, category: 'av', action: 'create', args, strictMode: true, oneStep,
        validateArgs: args => { AvCreateSchema.parse(args); }, execute: args => callAvTool(client, args, config.av, {} as any) });
    const payload = (result: any) => result.structuredContent ?? JSON.parse(result.content[0].text);
    return { client, avs, blocks, run, payload, files, writes: () => writes, fail: (value: string) => { failure = value; }, restart: () => { coordinator = new WriteSafetyCoordinator(client); } };
}

describe('durable multi-step AV creation', () => {
    it('creates a named database in one step when one-step writes are on', async () => {
        const f = fixture();
        const result = f.payload(await f.run({ action: 'create', parentID: 'parent', name: 'Tasks' }, 'low_risk'));
        expect(result.stage).toBe('verified');
        expect(result.name).toBe('Tasks');
        expect(f.avs.get(result.avID).name).toBe('Tasks');
        expect(result.oneStep).toMatchObject({ tier: 1 });
        expect(result.preview.changes[0].summary).toContain('named «Tasks»');
        expect(result.safety).toMatchObject({ transactionState: 'committed', requestId: expect.stringMatching(/^[a-f0-9]{4,}$/) });
        // Replaying the server-issued request ID returns the saved receipt, without a second database.
        const replay = f.payload(await f.run({ action: 'create', parentID: 'parent', name: 'Tasks', requestId: result.safety.requestId }));
        expect(replay.avID).toBe(result.avID);
        expect(f.avs.size).toBe(1);
    });

    it('replays the original result and identities before the existing-AV check, including after restart', async () => {
        const f = fixture();
        const args = { action: 'create', parentID: 'parent', avID: '20261008120000-abcdefg' };
        const pre = f.payload(await f.run({ ...args, validateOnly: true }));
        expect(f.writes()).toBe(0);
        expect(pre.preflight).toMatchObject({
            version: 2,
            requestId: pre.requestId,
            expiresAt: pre.expiresAt,
            counts: { operationCount: 1 },
            commitArgs: {
                action: 'create',
                parentID: 'parent',
                avID: '20261008120000-abcdefg',
                validateOnly: false,
                requestId: pre.requestId,
            },
        });
        const result = f.payload(await f.run({ ...args, requestId: pre.requestId }));
        expect(result.stage).toBe('verified');
        expect(result.safety.transactionState).toBe('committed');
        expect(f.blocks.has(result.blockID)).toBe(true);
        // Appended after the parent's last child, not prepended (the kernel default without previousID).
        const insert = f.client.requestWrite.mock.calls.find(([path]: any[]) => path === '/api/transactions')[1].transactions[0].doOperations[0];
        expect(insert).toMatchObject({ action: 'insert', id: result.blockID, parentID: 'parent', previousID: 'last-child' });
        // SiYuan's default select column is named with a ready removal preflight, never removed silently.
        expect(result.defaultColumns).toEqual([{ keyID: 'key-sel', name: '单选', type: 'select' }]);
        expect(result.removeDefaultColumn.arguments).toEqual({ action: 'remove_column', avID: result.avID, keyID: 'key-sel', validateOnly: true });
        f.restart();
        const replay = f.payload(await f.run({ ...args, requestId: pre.requestId }));
        expect(replay).toEqual({ ...result, safety: { ...result.safety, replayed: true } });
        expect(f.writes()).toBe(2);
        expect(f.payload(await f.run({ ...args, validateOnly: true })).error.code).toBe('already_exists');
        expect(f.payload(await f.run({ ...args, parentID: 'other', requestId: pre.requestId })).error.code).toBe('idempotency_conflict');
    });
    it.each(['av-response', 'av-readback', 'carrier-before', 'carrier-response', 'carrier-readback', 'ledger-3', 'ledger-4', 'ledger-5', 'ledger-6'])('preserves stable IDs and prevents redispatch on %s', async failure => {
        const f = fixture();
        const args = { action: 'create', parentID: 'parent' };
        const pre = f.payload(await f.run({ ...args, validateOnly: true }));
        f.fail(failure);
        const result = f.payload(await f.run({ ...args, requestId: pre.requestId }));
        expect(result.error.code).toBe('outcome_unknown');
        expect(result.avID).toMatch(/^\d{14}-[a-z0-9]{7}$/);
        expect(result.blockID).toMatch(/^\d{14}-[a-z0-9]{7}$/);
        const count = f.writes();
        f.restart(); f.fail('');
        const replay = f.payload(await f.run({ ...args, requestId: pre.requestId }));
        expect(replay.avID).toBe(result.avID);
        expect(replay.blockID).toBe(result.blockID);
        expect(f.writes()).toBe(count);
        expect(f.files.get(WRITE_SAFETY_LEDGER_PATH)).toContain(result.avID);
    });
    it('does not dispatch when reservation cannot be persisted', async () => {
        const f = fixture(); const args = { action: 'create', parentID: 'parent' };
        const pre = f.payload(await f.run({ ...args, validateOnly: true }));
        f.fail('ledger-2');
        expect((await f.run({ ...args, requestId: pre.requestId })).isError).toBe(true);
        expect(f.writes()).toBe(0);
    });
    it('returns persisted executing context after an interrupted process without resuming', async () => {
        const f = fixture(); const args = { action: 'create', parentID: 'parent' };
        const pre = f.payload(await f.run({ ...args, validateOnly: true }));
        const complete = f.payload(await f.run({ ...args, requestId: pre.requestId }));
        const ledger = JSON.parse(f.files.get(WRITE_SAFETY_LEDGER_PATH)!);
        const entry = ledger.entries.find((item: any) => item.requestId === pre.requestId);
        entry.state = 'executing'; entry.creation.stage = 'av_created'; entry.creation.currentStep = 'insert_carrier'; delete entry.response;
        f.files.set(WRITE_SAFETY_LEDGER_PATH, JSON.stringify(ledger)); f.restart();
        const replay = f.payload(await f.run({ ...args, requestId: pre.requestId }));
        expect(replay).toMatchObject({ avID: complete.avID, blockID: complete.blockID, stage: 'av_created', partial: true, carrierConfirmed: false, error: { code: 'outcome_unknown' } });
        expect(f.writes()).toBe(2);
    });
    it('refuses an expired creation request after restart instead of issuing new IDs', async () => {
        const f = fixture(); const args = { action: 'create', parentID: 'parent' };
        const pre = f.payload(await f.run({ ...args, validateOnly: true }));
        const ledger = JSON.parse(f.files.get(WRITE_SAFETY_LEDGER_PATH)!);
        ledger.entries[0].createdAt = ledger.entries[0].updatedAt = 1;
        f.files.set(WRITE_SAFETY_LEDGER_PATH, JSON.stringify(ledger)); f.restart();
        expect(f.payload(await f.run({ ...args, requestId: pre.requestId })).error.code).toBe('request_id_expired');
        expect(f.writes()).toBe(0);
    });

});
