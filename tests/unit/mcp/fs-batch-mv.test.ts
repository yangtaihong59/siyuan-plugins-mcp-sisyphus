import { describe, expect, it, vi } from 'vitest';

import '@/mcp/tool-registry';
import { buildDefaultToolConfig } from '@/core/config';
import { decideOneStep, getOneStepTier, getWriteBatchSize } from '@/core/write-safety-policy';
import { WriteSafetyCoordinator } from '@/mcp/write-safety-coordinator';
import { callFsTool } from '@/tools/fs';
import { FsMvSchema } from '@/tools/fs/schemas';
import { BATCH_HINTS } from '@/tools/internal/batch-hints';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';
import { requestError } from '../../helpers/request-error';

const NB = '20261029000000-nbaaaaa';

/*
 * A tiny live document tree: hpath -> id. Path resolution in the handler is
 * mocked onto it; the strict probe reads the same tree through the kernel API
 * mock, so a move is observed by the post-write readback.
 */
const tree = new Map<string, string>();
const names = new Map<string, string>();

vi.mock('@/tools/internal/helpers/fs-path', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/tools/internal/helpers/fs-path')>();
    const hpathOf = (path: string) => `/${path.replace(/^\/+/, '').split('/').slice(1).join('/')}`;
    return {
        ...original,
        resolveFsScopePath: vi.fn(async (_client: unknown, _perm: unknown, path: string) => {
            const id = tree.get(hpathOf(path));
            if (!id) throw Object.assign(new Error(`No document at "${path}".`), { code: 'not_found' });
            return { type: 'document', id, notebook: NB, notebookName: 'Lab', hPath: hpathOf(path), storagePath: `/${id}.sy`, canonicalPath: path, name: names.get(id) ?? '' };
        }),
        resolveFsDestinationTarget: vi.fn(async (_client: unknown, _perm: unknown, path: string) => {
            const hpath = hpathOf(path);
            const parent = hpath.split('/').slice(0, -1).join('/') || '/';
            return { notebook: NB, notebookName: 'Lab', title: hpath.split('/').at(-1), parentHPath: parent, parentStoragePath: '/', parentId: parent === '/' ? undefined : tree.get(parent), hPath: hpath, canonicalPath: path };
        }),
    };
});

function seed(paths: string[]) {
    tree.clear();
    names.clear();
    paths.forEach((hpath, index) => {
        const id = `20261029000${String(100 + index)}-doc${String(index).padStart(4, '0')}`;
        tree.set(hpath, id);
        names.set(id, hpath.split('/').at(-1)!);
    });
}

/** Kernel mock: moves/renames update the tree; the call numbered `failAt` fails with `failure`. */
function createKernel(failAt?: number, failure?: Error) {
    let calls = 0;
    const writes: Array<[string, Record<string, any>]> = [];
    const client: any = {
        readFile: vi.fn(async () => { throw requestError('HTTP error: 404 Not Found'); }),
        writeFile: vi.fn(async () => undefined),
        requestWrite: vi.fn(async (endpoint: string, body: Record<string, any>) => {
            if (endpoint.startsWith('/api/ui/')) return null;
            const index = calls++;
            if (index === failAt) throw failure;
            writes.push([endpoint, body]);
            if (endpoint === '/api/filetree/moveDocsByID') {
                const id = body.fromIDs[0];
                const [oldPath] = [...tree.entries()].find(([, value]) => value === id)!;
                const parentPath = body.toID === NB ? '' : [...tree.entries()].find(([, value]) => value === body.toID)![0];
                tree.delete(oldPath);
                tree.set(`${parentPath}/${names.get(id)}`, id);
                return null;
            }
            if (endpoint === '/api/filetree/renameDocByID') {
                const [oldPath] = [...tree.entries()].find(([, value]) => value === body.id)!;
                tree.delete(oldPath);
                tree.set(`${oldPath.split('/').slice(0, -1).join('/')}/${body.title}`, body.id);
                names.set(body.id, body.title);
                return null;
            }
            throw new Error(`unexpected write ${endpoint}`);
        }),
        requestRead: vi.fn(async (endpoint: string, body?: Record<string, any>) => {
            if (endpoint === '/api/notebook/lsNotebooks') return { notebooks: [{ id: NB, name: 'Lab', closed: false }] };
            if (endpoint === '/api/filetree/getIDsByHPath') return tree.has(body?.path) ? [tree.get(body?.path)] : [];
            if (endpoint === '/api/block/checkBlockExist') return [...tree.values()].includes(body?.id);
            if (endpoint === '/api/block/getBlockInfo') return { id: body?.id, rootID: body?.id, box: NB };
            if (endpoint === '/api/attr/getBlockAttrs') return {};
            if (endpoint === '/api/block/getBlockKramdown') return { kramdown: '' };
            if (endpoint === '/api/block/getChildBlocks' || endpoint === '/api/query/sql') return [];
            if (endpoint === '/api/block/getBlockDOM') return { dom: '<div></div>' };
            return null;
        }),
    };
    return { client, writes };
}

const permMgr = () => {
    const manager = createMockPermissionManager();
    manager.getAll = vi.fn(() => ({ [NB]: 'rwd' }));
    return manager;
};

async function runStrict(kernel: ReturnType<typeof createKernel>, args: Record<string, unknown>, coordinator = new WriteSafetyCoordinator(kernel.client)) {
    const perms = permMgr();
    const config = buildDefaultToolConfig().fs;
    return coordinator.run({
        client: kernel.client, permMgr: perms, category: 'fs', action: 'mv', args, strictMode: true, oneStep: 'low_risk',
        execute: (safeArgs, tracked = kernel.client) => callFsTool(tracked, safeArgs, config, perms),
    });
}

/** Preflight then commit, the only path for fs mv (tier 3). */
async function preflightAndCommit(kernel: ReturnType<typeof createKernel>, args: Record<string, unknown>) {
    const coordinator = new WriteSafetyCoordinator(kernel.client);
    const preflight = parseResult(await runStrict(kernel, { ...args, validateOnly: true }, coordinator));
    expect(preflight.preflight?.commitArgs, JSON.stringify(preflight)).toBeDefined();
    const raw = await runStrict(kernel, preflight.preflight.commitArgs, coordinator);
    return { preflight, raw, result: parseResult(raw) };
}

const items = (...pairs: Array<[string, string]>) => pairs.map(([from, to]) => ({ from: `/Lab${from}`, to: `/Lab${to}` }));

describe('fs mv batch (items)', () => {
    it('validates the batch shape: exclusive with from/to, unique, no chained moves, at most 20', () => {
        const many = (count: number) => Array.from({ length: count }, (_, index) => ({ from: `/Lab/A${index}`, to: `/Lab/B${index}` }));
        expect(FsMvSchema.safeParse({ action: 'mv', items: many(20) }).success).toBe(true);
        expect(FsMvSchema.safeParse({ action: 'mv', items: many(21) }).success).toBe(false);
        expect(FsMvSchema.safeParse({ action: 'mv', items: many(2), from: '/Lab/X' }).success).toBe(false);
        expect(FsMvSchema.safeParse({ action: 'mv' }).success).toBe(false);
        const dupFrom = FsMvSchema.safeParse({ action: 'mv', items: [{ from: '/Lab/A', to: '/Lab/B' }, { from: '/Lab//A/', to: '/Lab/C' }] });
        expect(JSON.stringify(dupFrom.error?.issues)).toContain('items[1].from repeats items[0].from');
        const dupTo = FsMvSchema.safeParse({ action: 'mv', items: [{ from: '/Lab/A', to: '/Lab/X' }, { from: '/Lab/B', to: '/Lab/X' }] });
        expect(JSON.stringify(dupTo.error?.issues)).toContain('items[1].to repeats items[0].to');
        const swap = FsMvSchema.safeParse({ action: 'mv', items: [{ from: '/Lab/A', to: '/Lab/B' }, { from: '/Lab/B', to: '/Lab/A' }] });
        expect(JSON.stringify(swap.error?.issues)).toContain('chained or swapped moves');
    });

    it('keeps fs mv on the two-step flow (tier 3) and counts items as the batch size', () => {
        expect(getOneStepTier('fs', 'mv', { items: [] })).toBe(3);
        expect(getWriteBatchSize({ items: items(['/A', '/B'], ['/C', '/D']) })).toBe(2);
        expect(decideOneStep('low_risk', 'fs', 'mv', { items: items(['/A', '/B']) })).toMatchObject({ allowed: false, tier: 3 });
    });

    it('lists every move in the preflight and moves all items in order on commit', async () => {
        seed(['/Inbox', '/Archive', '/Inbox/A', '/Inbox/B']);
        const kernel = createKernel();
        const { preflight, result } = await preflightAndCommit(kernel, { action: 'mv', items: items(['/Inbox/A', '/Archive/A'], ['/Inbox/B', '/Archive/B 2026']) });
        expect(preflight.preview.changes.map((change: any) => change.kind)).toEqual(['move_documents', 'move', 'move']);
        expect(preflight.preview.changes[2].summary).toContain('[1] Moves /Lab/Inbox/B to /Lab/Archive/B 2026');
        expect(preflight.preflight.counts.targetCount).toBeGreaterThan(0);
        expect(result.success).toBe(true);
        expect(result.safety.transactionState).toBe('committed');
        expect(result.moved.map((item: any) => item.to)).toEqual(['/Lab/Archive/A', '/Lab/Archive/B 2026']);
        expect(result.batchHint).toBeUndefined();
        expect(tree.has('/Archive/A') && tree.has('/Archive/B 2026')).toBe(true);
        // One move per item, plus one rename only where the title changes.
        expect(kernel.writes.map(([endpoint]) => endpoint)).toEqual(['/api/filetree/moveDocsByID', '/api/filetree/moveDocsByID', '/api/filetree/renameDocByID']);
    });

    it('rejects a destination that already exists before the first write', async () => {
        seed(['/Inbox', '/Archive', '/Inbox/A', '/Inbox/B', '/Archive/B']);
        const kernel = createKernel();
        const coordinator = new WriteSafetyCoordinator(kernel.client);
        const args = { action: 'mv', items: items(['/Inbox/A', '/Archive/A'], ['/Inbox/B', '/Archive/B']) };
        const preflight = parseResult(await runStrict(kernel, { ...args, validateOnly: true }, coordinator));
        expect(preflight.preview.changes[2].summary).toContain('a document already exists at the destination');
        const result = parseResult(await runStrict(kernel, preflight.preflight.commitArgs, coordinator));
        expect(result.error.type).toBe('validation_error');
        expect(JSON.stringify(result.error)).toContain('Destination already exists');
        expect(result.safety.transactionState).toBe('rejected');
        expect(kernel.writes).toHaveLength(0);
    });

    it('stops at an explicit rejection and reports moved, failed (not_applied) and never-sent items', async () => {
        seed(['/Inbox', '/Archive', '/Inbox/A', '/Inbox/B', '/Inbox/C']);
        const kernel = createKernel(1, requestError('SiYuan API error: -1 move failed'));
        const { raw, result } = await preflightAndCommit(kernel, { action: 'mv', items: items(['/Inbox/A', '/Archive/A'], ['/Inbox/B', '/Archive/B'], ['/Inbox/C', '/Archive/C']) });
        expect(raw.isError).toBe(true);
        expect(result.safety).toMatchObject({ transactionState: 'partial', writeExecuted: true });
        expect(result.overallState).toBe('partial');
        expect(result.moved).toEqual([expect.objectContaining({ index: 0, from: '/Lab/Inbox/A', to: '/Lab/Archive/A' })]);
        expect(result.failed).toMatchObject({ index: 1, from: '/Lab/Inbox/B', state: 'not_applied' });
        expect(result.notApplied).toEqual([expect.objectContaining({ index: 2, from: '/Lab/Inbox/C' })]);
        expect(result.counts).toEqual({ requested: 3, moved: 1, failed: 1, notApplied: 1 });
        expect(result.error.message).toContain('1 of 3 document(s) were moved');
        expect(result.error.details).toContain('not_applied, never sent (1)');
    });

    it('marks a later item unknown when its outcome cannot be known', async () => {
        seed(['/Inbox', '/Archive', '/Inbox/A', '/Inbox/B']);
        const kernel = createKernel(1, requestError('Request timeout after 30000ms'));
        const { result } = await preflightAndCommit(kernel, { action: 'mv', items: items(['/Inbox/A', '/Archive/A'], ['/Inbox/B', '/Archive/B']) });
        expect(result.safety.transactionState).toBe('unknown');
        expect(result.failed).toMatchObject({ index: 1, state: 'unknown' });
        expect(result.error.message).toContain('first check where /Lab/Inbox/B is now');
    });

    it('classifies a rejected first item as not_applied: nothing was moved', async () => {
        seed(['/Inbox', '/Archive', '/Inbox/A', '/Inbox/B']);
        const kernel = createKernel(0, requestError('SiYuan API error: -1 move failed'));
        const { result } = await preflightAndCommit(kernel, { action: 'mv', items: items(['/Inbox/A', '/Archive/A'], ['/Inbox/B', '/Archive/B']) });
        expect(result.safety.transactionState).toBe('not_applied');
        expect(kernel.writes).toHaveLength(0);
    });

    it('adds a batchHint only to a single mv', async () => {
        seed(['/Inbox', '/Archive', '/Inbox/A']);
        const kernel = createKernel();
        const { result } = await preflightAndCommit(kernel, { action: 'mv', from: '/Lab/Inbox/A', to: '/Lab/Archive/A' });
        expect(result.success).toBe(true);
        expect(result.batchHint).toBe(BATCH_HINTS.fsMv);
    });
});
