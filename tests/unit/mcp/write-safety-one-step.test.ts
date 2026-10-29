import { describe, expect, it, vi } from 'vitest';

import { WriteSafetyCoordinator } from '@/mcp/write-safety-coordinator';
import { probeCurrentState } from '@/mcp/write-safety-probe';
import { formatIfMatch } from '@/core/write-safety-policy';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';
import { requestError } from '../../helpers/request-error';

const BLOCK_ID = '20260812000000-abcdefg';
const STATE_POLICY = { mode: 'mutation', precondition: 'state', validateOnly: true } as const;
const MANIFEST_POLICY = { mode: 'mutation', precondition: 'manifest', validateOnly: true } as const;

function success(payload: Record<string, unknown>) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
}

function ledgerFile() {
    return {
        readFile: vi.fn(async () => { throw requestError('HTTP error: 404 Not Found'); }),
        writeFile: vi.fn(async () => undefined),
    };
}

/** A block/document whose kramdown the test can change between calls. */
function createBlockWorld() {
    const world: any = { kramdown: 'v1', children: [] as unknown[] };
    const client = {
        ...ledgerFile(),
        requestRead: vi.fn(async (endpoint: string) => {
            if (endpoint === '/api/block/checkBlockExist') return true;
            if (endpoint === '/api/block/getBlockInfo') return { id: BLOCK_ID, box: 'nb-1', rootID: BLOCK_ID };
            if (endpoint === '/api/attr/getBlockAttrs') return { id: BLOCK_ID };
            if (endpoint === '/api/block/getBlockKramdown') return { id: BLOCK_ID, kramdown: world.kramdown };
            if (endpoint === '/api/block/getChildBlocks') return world.children;
            if (endpoint === '/api/block/getBlockDOM') return { dom: `<div data-node-id="${BLOCK_ID}">${world.kramdown}</div>` };
            if (endpoint === '/api/query/sql') return [];
            return null;
        }),
    } as any;
    const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
    permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
    return Object.assign(world, { client, permMgr });
}

function createFsWorld() {
    const world: any = { markdown: 'old' };
    const client = {
        ...ledgerFile(),
        requestRead: vi.fn(async (endpoint: string, payload?: { stmt?: string }) => {
            if (endpoint === '/api/notebook/lsNotebooks') return { notebooks: [{ id: 'nb-1', name: 'Notes' }] };
            if (endpoint === '/api/filetree/getIDsByHPath') return [BLOCK_ID];
            if (endpoint === '/api/block/checkBlockExist') return true;
            if (endpoint === '/api/block/getChildBlocks') return [{ id: '20260812000001-abcdefg', type: 'p' }];
            if (endpoint === '/api/block/getBlockKramdown') return { kramdown: world.markdown };
            if (payload?.stmt?.includes('hpath')) return [{ id: BLOCK_ID, box: 'nb-1', hpath: '/Doc' }];
            return [];
        }),
    } as any;
    const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
    permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
    return Object.assign(world, { client, permMgr });
}

function createAvWorld() {
    const world: any = { revision: 1 };
    const client = {
        ...ledgerFile(),
        requestRead: vi.fn(async (endpoint: string) => {
            if (endpoint === '/api/av/getAttributeView') {
                return { av: {
                    id: 'av-1',
                    revision: world.revision,
                    keyValues: [{ key: { id: 'key-title', type: 'text' }, values: [{ blockID: 'row-a', text: { content: '' } }] }],
                    views: [{ id: 'view-1', type: 'table' }],
                } };
            }
            if (endpoint === '/api/query/sql') return [];
            return null;
        }),
    } as any;
    return Object.assign(world, { client, permMgr: createMockPermissionManager() });
}

function createTemplateWorld() {
    const world: any = { markdown: '# T' };
    const client = {
        ...ledgerFile(),
        requestRead: vi.fn(async () => []),
        requestResource: vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => world.markdown })),
    } as any;
    return Object.assign(world, { client, permMgr: createMockPermissionManager() });
}

async function read(coordinator: WriteSafetyCoordinator, world: { client: any; permMgr: any }, category: any, args: Record<string, unknown>, oneStep: 'off' | 'low_risk' = 'low_risk') {
    return parseResult(await coordinator.run({
        client: world.client, permMgr: world.permMgr, category, action: String(args.action), args, strictMode: true, oneStep,
        execute: vi.fn(async () => success({ content: 'read body' })),
    }));
}

describe('read hashes (ifMatch)', () => {
    it.each([
        ['block', { action: 'get_kramdown', id: BLOCK_ID }],
        ['block', { action: 'get_attrs', id: BLOCK_ID }],
        ['block', { action: 'get_children', id: BLOCK_ID }],
        ['document', { action: 'get_doc', id: BLOCK_ID }],
    ] as const)('%s.%s equals the block.update preflight state hash', async (category, args) => {
        const world = createBlockWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const result = await read(coordinator, world, category, args);
        expect(result.content).toBe('read body');
        expect(result.ifMatch).toMatch(/^[a-f0-9]{16}$/);

        const writeArgs = { action: 'update', id: BLOCK_ID, dataType: 'markdown', data: 'next' };
        const probe = await probeCurrentState(world.client, world.permMgr, 'block', 'update', writeArgs, STATE_POLICY);
        expect(result.ifMatch).toBe(formatIfMatch(probe.hash));
        const preflight = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update',
            args: { ...writeArgs, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        expect(String(result.ifMatch).startsWith(preflight.expectedStateHash)).toBe(true);
    });

    it('fs.read equals the fs.write overwrite preflight state hash', async () => {
        const world = createFsWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const result = await read(coordinator, world, 'fs', { action: 'read', path: '/Notes/Doc' });
        const writeArgs = { action: 'write', path: '/Notes/Doc', markdown: 'x', overwrite: true };
        const probe = await probeCurrentState(world.client, world.permMgr, 'fs', 'write', writeArgs, STATE_POLICY);
        expect(result.ifMatch).toBe(formatIfMatch(probe.hash));
        const preflight = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'fs', action: 'write',
            args: { ...writeArgs, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        expect(String(result.ifMatch).startsWith(preflight.expectedStateHash)).toBe(true);
    });

    it.each(['get', 'query'])('av.%s equals the av.set_cells preflight manifest hash', async (action) => {
        const world = createAvWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const result = await read(coordinator, world, 'av', { action, avID: 'av-1' });
        const writeArgs = { action: 'set_cells', avID: 'av-1', cells: [{ rowID: 'row-a', columnID: 'key-title', valueType: 'text', text: 'x' }] };
        const probe = await probeCurrentState(world.client, world.permMgr, 'av', 'set_cells', writeArgs, MANIFEST_POLICY);
        expect(result.ifMatch).toBe(formatIfMatch(probe.hash));
        const preflight = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'av', action: 'set_cells',
            args: { ...writeArgs, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        expect(String(result.ifMatch).startsWith(preflight.expectedManifestHash)).toBe(true);
    });

    it('file.read_template equals the update_template preflight state hash for every path spelling', async () => {
        const world = createTemplateWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const spelled = await read(coordinator, world, 'file', { action: 'read_template', path: '/data/templates/daily.md' });
        const relative = await read(coordinator, world, 'file', { action: 'read_template', path: 'daily.md' });
        expect(spelled.ifMatch).toBe(relative.ifMatch);
        const writeArgs = { action: 'update_template', path: 'daily.md', markdown: '# U' };
        const probe = await probeCurrentState(world.client, world.permMgr, 'file', 'update_template', writeArgs, STATE_POLICY);
        expect(relative.ifMatch).toBe(formatIfMatch(probe.hash));
    });

    it('adds nothing and reads nothing extra while one-step is off', async () => {
        const world = createBlockWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const result = await read(coordinator, world, 'block', { action: 'get_kramdown', id: BLOCK_ID }, 'off');
        expect(result).not.toHaveProperty('ifMatch');
        expect(world.client.requestRead).not.toHaveBeenCalled();
    });

    it('omits ifMatch when the target is not writable', async () => {
        const world = createBlockWorld();
        world.permMgr.canWrite = vi.fn(() => false);
        world.permMgr.canDelete = vi.fn(() => false);
        const result = await read(new WriteSafetyCoordinator(world.client), world, 'block', { action: 'get_kramdown', id: BLOCK_ID });
        expect(result.content).toBe('read body');
        expect(result).not.toHaveProperty('ifMatch');
    });
});

describe('ifMatch on writes', () => {
    it('rejects a two-step preflight whose ifMatch is stale and keeps ifMatch out of commitArgs', async () => {
        const world = createBlockWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const { ifMatch } = await read(coordinator, world, 'block', { action: 'get_kramdown', id: BLOCK_ID });
        const args = { action: 'update', id: BLOCK_ID, dataType: 'markdown', data: 'next', ifMatch };

        const fresh = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        expect(fresh.preflight.commitArgs).not.toHaveProperty('ifMatch');

        world.kramdown = 'changed elsewhere';
        const stale = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        expect(stale.error).toMatchObject({ code: 'state_changed', expectedField: 'ifMatch', revalidateRequired: true });
        expect(stale.error.hint).toContain('ifMatch must come from a read of this exact target');
        expect(stale.error.hint).toContain('block(action="get_kramdown"');
    });

    it('rejects malformed or unmappable ifMatch without executing', async () => {
        const world = createBlockWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const execute = vi.fn();
        const malformed = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update',
            args: { action: 'update', id: BLOCK_ID, data: 'x', ifMatch: 'abcd', validateOnly: true }, strictMode: true, execute,
        }));
        expect(malformed.error).toMatchObject({ code: 'invalid_arguments', field: 'ifMatch' });
        const unmappable = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'append',
            args: { action: 'append', parentID: BLOCK_ID, data: 'x', ifMatch: 'a'.repeat(16), validateOnly: true }, strictMode: true, execute,
        }));
        expect(unmappable.error).toMatchObject({ code: 'invalid_arguments', oneStep: { reason: 'if_match_unsupported' } });
        expect(execute).not.toHaveBeenCalled();
    });
});

describe('one-step commits', () => {
    const appendArgs = { action: 'append', parentID: BLOCK_ID, dataType: 'markdown', data: 'new paragraph' };

    it('setting off keeps the exact two-step refusal', async () => {
        const world = createBlockWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const execute = vi.fn();
        for (const oneStep of [undefined, 'off'] as const) {
            const result = parseResult(await coordinator.run({
                client: world.client, permMgr: world.permMgr, category: 'block', action: 'append', args: appendArgs,
                strictMode: true, oneStep, execute,
            }));
            expect(result.error).toEqual({
                code: 'precondition_required',
                message: 'requestId is required for every strict write. Copy it from validateOnly preflight.',
            });
        }
        const withIfMatch = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update',
            args: { action: 'update', id: BLOCK_ID, data: 'x', ifMatch: 'a'.repeat(16) }, strictMode: true, oneStep: 'off', execute,
        }));
        expect(withIfMatch.error).toMatchObject({ code: 'precondition_required', oneStep: { allowed: false, reason: 'setting_off' } });
        expect(execute).not.toHaveBeenCalled();
        expect(world.client.requestRead).not.toHaveBeenCalled();
    });

    it('commits a tier-1 write in one step with a ledger entry, receipt and preview', async () => {
        const world = createBlockWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const execute = vi.fn(async () => {
            world.children = [{ id: '20260812000009-newpara', type: 'p' }];
            return success({ success: true, action: 'append', id: '20260812000009-newpara' });
        });
        const result = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'append', args: appendArgs,
            strictMode: true, oneStep: 'low_risk', execute,
        }));
        expect(execute).toHaveBeenCalledTimes(1);
        expect(result.oneStep).toEqual({ tier: 1, meaning: 'additive or name-only change; ifMatch optional' });
        expect(result.preview).toMatchObject({ detail: 'summary' });
        expect(result.safety).toMatchObject({ writeSafetyMode: 'strict', writeExecuted: true, replayed: false });
        expect(result.safety.requestId).toMatch(/^[a-f0-9]{4,}$/);
        const entry = (coordinator as any).ledger.entries.get(result.safety.requestId);
        expect(entry).toMatchObject({ tool: 'block', action: 'append', state: 'committed' });
    });

    it('requires a matching ifMatch for tier-2 overwrites', async () => {
        const world = createBlockWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const args = { action: 'update', id: BLOCK_ID, dataType: 'markdown', data: 'v2' };
        const execute = vi.fn(async () => {
            world.kramdown = 'v2';
            return success({ success: true, action: 'update', changed: true });
        });

        const missing = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update', args,
            strictMode: true, oneStep: 'low_risk', execute,
        }));
        expect(missing.error).toMatchObject({ code: 'precondition_required', oneStep: { tier: 2, reason: 'missing_if_match' } });
        expect(missing.error.message).toContain('ifMatch');

        const { ifMatch } = await read(coordinator, world, 'block', { action: 'get_kramdown', id: BLOCK_ID });
        world.kramdown = 'edited in the UI';
        const stale = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update', args: { ...args, ifMatch },
            strictMode: true, oneStep: 'low_risk', execute,
        }));
        expect(stale.error).toMatchObject({ code: 'state_changed', expectedField: 'ifMatch' });
        expect(execute).not.toHaveBeenCalled();

        const fresh = await read(coordinator, world, 'block', { action: 'get_kramdown', id: BLOCK_ID });
        const committed = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update', args: { ...args, ifMatch: fresh.ifMatch },
            strictMode: true, oneStep: 'low_risk', execute,
        }));
        expect(execute).toHaveBeenCalledTimes(1);
        expect(committed.oneStep).toEqual({ tier: 2, meaning: 'overwrite guarded by ifMatch' });
        expect(committed.safety).toMatchObject({ transactionState: 'committed', writeExecuted: true });
        expect(committed.preview.changes[0].kind).toBeTruthy();
    });

    it('always refuses tier-3 writes and oversized batches with the reason', async () => {
        const world = createBlockWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const execute = vi.fn();
        const tier3 = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'tag', action: 'rename',
            args: { action: 'rename', oldLabel: 'a', newLabel: 'b' }, strictMode: true, oneStep: 'low_risk', execute,
        }));
        expect(tier3.error).toMatchObject({ code: 'precondition_required', oneStep: { tier: 3, reason: 'tier3' } });
        expect(tier3.error.message).toContain('validateOnly=true');

        const rows = Array.from({ length: 21 }, (_, index) => ({ clientKey: `k${index}`, primaryKeyText: `row ${index}` }));
        const batch = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'av', action: 'add_rows',
            args: { action: 'add_rows', avID: 'av-1', rows }, strictMode: true, oneStep: 'low_risk', execute,
        }));
        expect(batch.error).toMatchObject({ code: 'precondition_required', oneStep: { reason: 'batch_too_large' } });
        expect(execute).not.toHaveBeenCalled();
    });

    it('annotates help for one-step-eligible actions only when enabled', async () => {
        const world = createBlockWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const help = (oneStep: 'off' | 'low_risk', topic: string) => coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'help', args: { action: 'help', topic },
            strictMode: true, oneStep, execute: vi.fn(async () => success({ tool: 'block', action: topic })),
        }).then(parseResult);
        expect(await help('off', 'update')).not.toHaveProperty('oneStep');
        expect((await help('low_risk', 'update')).oneStep).toMatchObject({ tier: 2 });
        expect((await help('low_risk', 'append')).oneStep).toMatchObject({ tier: 1 });
        expect(await help('low_risk', 'delete')).not.toHaveProperty('oneStep');
    });
});
