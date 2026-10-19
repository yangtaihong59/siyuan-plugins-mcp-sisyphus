import { describe, expect, it, vi } from 'vitest';
import { WriteSafetyCoordinator } from '@/core/write-safety-coordinator';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';

const avID = '20261019000000-av00001';
const parentID = '20261019000000-parent1';
const blockID = '20261019000001-block01';
const mirrorID = '20261019000002-mirror1';
const dom = (id: string) => `<div data-node-id="${id}" data-type="NodeAttributeView" data-av-id="${avID}"></div>`;

function fixture() {
    let reversed = false;
    const client = {
        readFile: vi.fn(async () => { throw Error('HTTP error: 404 Not Found'); }),
        writeFile: vi.fn(async () => undefined),
        requestRead: vi.fn(async (endpoint: string, args: any) => {
            if (endpoint === '/api/av/getAttributeView') return { av: { id: avID, keyValues: [{ key: { id: 'status', type: 'select', options: [] }, values: [] }] } };
            const ids = reversed ? [parentID, mirrorID, blockID] : [blockID, mirrorID, parentID];
            if (endpoint === '/api/av/getMirrorDatabaseBlocks') return { refDefs: ids.map(refID => ({ refID })) };
            if (endpoint === '/api/query/sql') return ids.filter(id => id !== parentID).map(id => ({ id }));
            if (endpoint === '/api/block/getBlockDOM') return { dom: dom(args.id === parentID ? blockID : args.id) };
            if (endpoint === '/api/block/getBlockInfo') return { id: args.id, box: 'nb' };
            return null;
        }),
    };
    const permMgr = createMockPermissionManager({ canRead: () => true, canWrite: () => true });
    permMgr.getAll = vi.fn(() => ({ nb: 'rw' }));
    permMgr.get = vi.fn(() => 'rw');
    const coordinator = new WriteSafetyCoordinator(client as never);
    const execute = vi.fn(async () => ({ structuredContent: { success: true, changed: false, status: 'already_applied' }, content: [] }));
    const args = { action: 'set_column_options', avID, keyID: 'status', options: [] };
    const run = async (extra: Record<string, unknown>) => parseResult(await coordinator.run({ client: client as never, permMgr, category: 'av', action: 'set_column_options', args: { ...args, ...extra }, strictMode: true, execute }));
    return { client, execute, run, reverse: () => { reversed = true; } };
}

describe('exact AV carrier leases', () => {
    it('keeps the same carrier when native parent/mirror and SQL candidate orders flip', async () => {
        const f = fixture();
        const pre = await f.run({ validateOnly: true });
        expect(pre, JSON.stringify(pre)).toHaveProperty('expectedStateHash');
        f.reverse();
        const result = await f.run({ requestId: pre.requestId, expectedStateHash: pre.expectedStateHash });
        expect(result.safety.transactionState).toBe('no_change');
        expect(f.execute).toHaveBeenCalledTimes(1);
        const resolved = f.client.requestRead.mock.calls.filter(([endpoint]) => endpoint === '/api/block/getBlockInfo').map(([, args]) => args.id);
        expect(new Set(resolved)).toEqual(new Set([blockID]));
    });

    it.each([
        ['parent with first-child AV', dom(blockID)],
        ['parent wrapping child AV', `<div data-node-id="${parentID}" data-type="NodeDocument">${dom(blockID)}</div>`],
        ['split identity attributes', `<div data-node-id="${parentID}">${dom(blockID)}</div>`],
        ['duplicate identity', dom(parentID).replace('data-node-id=', `data-node-id="${blockID}" data-node-id=`)],
        ['wrong AV', dom(parentID).replace(avID, 'other-av')],
        ['fake attributes inside a quoted value', `<div title='data-node-id="${parentID}" data-type="NodeAttributeView" data-av-id="${avID}"'></div>`],
    ])('rejects explicit %s before dispatch', async (_, value) => {
        const f = fixture();
        const read = f.client.requestRead.getMockImplementation()!;
        f.client.requestRead.mockImplementation(async (endpoint, args) => endpoint === '/api/block/getBlockDOM' ? { dom: value } : read(endpoint, args));
        const result = await f.run({ blockID: parentID, validateOnly: true });
        expect(result.error.code).toBe('permission_denied');
        expect(f.execute).not.toHaveBeenCalled();
    });

    it('accepts an explicit actual carrier with single quotes and reordered attributes', async () => {
        const f = fixture();
        const read = f.client.requestRead.getMockImplementation()!;
        f.client.requestRead.mockImplementation(async (endpoint, args) => endpoint === '/api/block/getBlockDOM'
            ? { dom: `<div data-av-id='${avID}' data-type='NodeAttributeView' data-node-id='${blockID}'></div>` } : read(endpoint, args));
        const pre = await f.run({ blockID, validateOnly: true });
        expect(pre, JSON.stringify(pre)).toHaveProperty('expectedStateHash');
    });

    it('rejects a carrier identity change between discovery and state read', async () => {
        const f = fixture();
        const read = f.client.requestRead.getMockImplementation()!;
        let reads = 0;
        f.client.requestRead.mockImplementation(async (endpoint, args) => endpoint === '/api/block/getBlockDOM'
            ? { dom: dom(++reads === 1 ? blockID : mirrorID) } : read(endpoint, args));
        expect((await f.run({ blockID, validateOnly: true })).error.code).toBe('precondition_required');
        expect(f.execute).not.toHaveBeenCalled();
    });
});
