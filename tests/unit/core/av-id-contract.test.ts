import { describe, expect, it, vi } from 'vitest';
import { normalizeAvIdArgs, AV_ID_ALIAS_ACTIONS } from '@/core/argument-aliases';
import { WriteSafetyLedger } from '@/core/write-safety-ledger';
import { WriteSafetyCoordinator } from '@/core/write-safety-coordinator';
import { AV_VARIANTS, callAvTool } from '@/tools/av';
import { buildDefaultToolConfig } from '@/core/config';
import { parseResult } from '../../helpers/parse-result';

const config = buildDefaultToolConfig();
describe('AV ID contract', () => {
    it.each(AV_ID_ALIAS_ACTIONS)('%s accepts only unambiguous legacy names', (action) => {
        const canonical = { action, avID: 'av-1' };
        expect(normalizeAvIdArgs({ action, id: 'av-1' })).toEqual(canonical);
        expect(normalizeAvIdArgs({ ...canonical, id: 'av-1' })).toEqual(canonical);
        expect(() => normalizeAvIdArgs({ ...canonical, id: 'av-2' })).toThrow('Conflicting');
        const variant = AV_VARIANTS.find(v => v.action === action)!;
        expect(variant.schema.properties.avID.type).toBe('string');
        expect(variant.schema.properties.id.deprecated).toBe(true);
        expect(variant.schema.required).not.toContain('id');
    });

    it('does not rewrite nested entity IDs or unrelated actions', () => {
        const args = { action: 'set_new_item_templates', avID: 'a', templates: [{ id: 'template' }] };
        expect(normalizeAvIdArgs(args)).toEqual(args);
    });

    it('rejects conflicts before ledger access', async () => {
        const client = { readFile: vi.fn(), writeFile: vi.fn() } as any;
        const execute = vi.fn();
        const result = await new WriteSafetyCoordinator(client).run({ client, permMgr: {} as any,
            category: 'av', action: 'render', args: { action: 'render', id: 'a', avID: 'b', createIfNotExist: true, validateOnly: true },
            strictMode: true, execute });
        expect(result.isError).toBe(true);
        expect(client.readFile).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('issues one canonical digest and warns during legacy preflight', async () => {
        let saved = JSON.stringify({ version: 1, entries: [] });
        const client = { readFile: vi.fn(async () => saved), writeFile: vi.fn(async (_p, content) => { saved = content; }) } as any;
        const coordinator = new WriteSafetyCoordinator(client);
        const result = parseResult(await coordinator.run({ client, permMgr: {} as any,
            category: 'av', action: 'render', args: { action: 'render', id: 'a', blockID: 'b', createIfNotExist: true, validateOnly: true },
            strictMode: true, execute: vi.fn() }));
        expect(result.warnings).toEqual([expect.objectContaining({ code: 'deprecated_parameter', replacement: 'avID' })]);
        const ledger = new WriteSafetyLedger(client);
        await expect(ledger.inspect(result.requestId, 'av', 'render', { action: 'render', avID: 'a', blockID: 'b', createIfNotExist: true })).resolves.toHaveProperty('argsHash');
    });

    it.each(['id', 'both'])('preserves old persisted render results: %s', async (shape) => {
        let saved = JSON.stringify({ version: 1, entries: [] });
        const client = { readFile: async () => saved, writeFile: async (_p, content) => { saved = content; } } as any;
        const oldArgs = { action: 'render', id: 'a', ...(shape === 'both' ? { avID: 'a' } : {}), blockID: 'b', createIfNotExist: true };
        const old = new WriteSafetyLedger(client);
        const { requestId } = await old.issue('av', 'render', oldArgs);
        const { argsHash } = await old.inspect(requestId, 'av', 'render', oldArgs);
        await old.record({ requestId, tool: 'av', action: 'render', argsHash, targetIds: ['a'], state: 'committed', result: { avID: 'a' } });
        const restarted = new WriteSafetyLedger(client);
        const args = { action: 'render', avID: 'a', blockID: 'b', createIfNotExist: true };
        expect((await restarted.inspect(requestId, 'av', 'render', args)).entry?.result).toEqual({ avID: 'a' });
        await expect(restarted.inspect(requestId, 'av', 'render', { ...args, blockID: 'different' })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    });

    it('rejects a successful render response when the AV cannot be read back', async () => {
        let saved = JSON.stringify({ version: 1, entries: [] });
        const client = { readFile: async () => saved, writeFile: async (_p, content) => { saved = content; },
            requestRead: vi.fn(async () => ({ av: null })) } as any;
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'render', blockID: 'parent', createIfNotExist: true };
        const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ avID: 'created-av', blockID: 'carrier' }) }] }));
        const execution = { client, permMgr: {} as any, category: 'av' as const, action: 'render', args, strictMode: true, execute };
        const pre = parseResult(await coordinator.run({ ...execution, args: { ...args, validateOnly: true } }));
        const result = parseResult(await coordinator.run({ ...execution, args: { ...args, requestId: pre.requestId } }));
        expect(result.error.code).toBe('readback_mismatch');
        expect(client.requestRead).toHaveBeenCalledWith('/api/av/getAttributeView', { id: 'created-av' });
        await coordinator.run({ ...execution, args: { ...args, requestId: pre.requestId } });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('generates canonical, complete help examples', async () => {
        for (const action of AV_ID_ALIAS_ACTIONS.filter(a => a !== 'render')) {
            const result = parseResult(await callAvTool({} as any, { action: 'help', topic: action }, config.av, {} as any));
            expect(result.example.avID).toBeTruthy();
            expect(result.example).not.toHaveProperty('id');
        }
    });

    it('returns an actionable canonical missing-ID hint', async () => {
        const result = parseResult(await callAvTool({} as any, { action: 'get' }, config.av, {} as any));
        expect(JSON.stringify(result)).toContain('avID');
    });
});
