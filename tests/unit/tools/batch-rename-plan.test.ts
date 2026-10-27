import { describe, expect, it, vi } from 'vitest';

import {
    BATCH_RENAME_MAX_ITEMS,
    assertBatchRenameInput,
    buildBatchRenamePlan,
} from '@/tools/document/batch-rename-plan';

function createClient(options: {
    hpaths?: Record<string, string>;
    notebooks?: Record<string, string>;
    targetIDs?: Record<string, string[]>;
    paths?: Record<string, string>;
    blockInfo?: Record<string, Record<string, unknown>>;
} = {}) {
    const hpaths = options.hpaths ?? {};
    const paths = options.paths ?? {};
    const notebooks = options.notebooks ?? {};
    const notebookFor = (id: string) => notebooks[id] ?? 'nb-1';
    return {
        requestRead: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
            const id = String(body?.id ?? '');
            if (endpoint === '/api/filetree/getPathByID') {
                return { notebook: notebookFor(id), path: paths[id] ?? `/${id}.sy` };
            }
            if (endpoint === '/api/filetree/getHPathByID') return hpaths[id] ?? `/${id}`;
            if (endpoint === '/api/block/getBlockInfo') {
                return options.blockInfo?.[id] ?? {
                    // Real SiYuan 3.8.7 shape: no id and no type.
                    box: notebookFor(id),
                    path: paths[id] ?? `/${id}.sy`,
                    rootID: id,
                    rootChildID: '',
                    rootTitle: id,
                };
            }
            if (endpoint === '/api/filetree/getIDsByHPath') {
                const path = String(body?.path);
                const notebook = String(body?.notebook);
                return options.targetIDs?.[`${notebook}:${path}`]
                    ?? options.targetIDs?.[path]
                    ?? [];
            }
            throw new Error(`Unexpected endpoint: ${endpoint}`);
        }),
    } as never;
}

function permMgr(canWrite = true) {
    return {
        reload: vi.fn(async () => undefined),
        canWrite: vi.fn(() => canWrite),
        canRead: vi.fn(() => true),
        get: vi.fn(() => (canWrite ? 'rw' : 'r')),
    } as never;
}

describe('batch rename plan', () => {
    it('resolves every target path and preserves input order', async () => {
        const client = createClient({ hpaths: { a: '/Folder/A', b: '/B' } });
        const plan = await buildBatchRenamePlan(client, permMgr(), [
            { id: 'a', title: 'A2' },
            { id: 'b', title: 'B2' },
        ]);
        expect(plan.items).toEqual([
            expect.objectContaining({ index: 0, id: 'a', title: 'A2', parentHPath: '/Folder', targetHPath: '/Folder/A2', noChange: false }),
            expect.objectContaining({ index: 1, id: 'b', title: 'B2', parentHPath: '', targetHPath: '/B2', noChange: false }),
        ]);
    });

    it('rejects duplicate IDs before any write', async () => {
        await expect(buildBatchRenamePlan(createClient(), permMgr(), [
            { id: 'a', title: 'A2' },
            { id: 'a', title: 'A3' },
        ])).rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining('duplicated') });
    });

    it('rejects an existing sibling target', async () => {
        const client = createClient({ targetIDs: { '/A2': ['existing'] } });
        await expect(buildBatchRenamePlan(client, permMgr(), [{ id: 'a', title: 'A2' }]))
            .rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining('already exists') });
    });

    it('rejects another batch item current path as a target', async () => {
        const client = createClient({ hpaths: { a: '/A', b: '/B' } });
        await expect(buildBatchRenamePlan(client, permMgr(), [
            { id: 'a', title: 'B' },
            { id: 'b', title: 'B2' },
        ])).rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining("another batch document's current path") });
    });

    it('rejects parent-child dependent batches', async () => {
        const client = createClient({ paths: { parent: '/parent.sy', child: '/parent/child.sy' } });
        await expect(buildBatchRenamePlan(client, permMgr(), [
            { id: 'parent', title: 'Parent 2' },
            { id: 'child', title: 'Child 2' },
        ])).rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining('parent-child') });
    });

    it('fails closed when any notebook is not writable', async () => {
        await expect(buildBatchRenamePlan(createClient(), permMgr(false), [{ id: 'a', title: 'A2' }]))
            .rejects.toMatchObject({ code: 'permission_denied' });
    });

    it('requires every target to be a document using the real 3.8.7 getBlockInfo shape', async () => {
        const descendant = createClient({
            blockInfo: {
                a: { box: 'nb-1', path: '/a.sy', rootID: 'parent-doc', rootChildID: 'a', rootTitle: 'A' },
            },
        });
        await expect(buildBatchRenamePlan(descendant, permMgr(), [{ id: 'a', title: 'A2' }]))
            .rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining('not a document') });

        const nonDocument = createClient({
            blockInfo: {
                a: { box: 'nb-1', path: '/a', rootID: 'a', rootChildID: 'a', rootTitle: 'A' },
            },
        });
        await expect(buildBatchRenamePlan(nonDocument, permMgr(), [{ id: 'a', title: 'A2' }]))
            .rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining('not a document') });

        const wrongBox = createClient({
            blockInfo: {
                a: { box: 'nb-other', path: '/a.sy', rootID: 'a', rootChildID: '', rootTitle: 'A' },
            },
        });
        await expect(buildBatchRenamePlan(wrongBox, permMgr(), [{ id: 'a', title: 'A2' }]))
            .rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining('not a document') });
    });

    it('rejects unwritable notebooks before reading block identity', async () => {
        const client = createClient();
        await expect(buildBatchRenamePlan(client, permMgr(false), [{ id: 'a', title: 'A2' }]))
            .rejects.toMatchObject({ code: 'permission_denied' });
        const endpoints = vi.mocked((client as any).requestRead).mock.calls.map((call) => call[0]);
        expect(endpoints).toEqual(['/api/filetree/getPathByID']);
    });

    it('does not confuse identical human-readable paths across notebooks', async () => {
        const client = createClient({
            hpaths: { a: '/Same', b: '/Same' },
            notebooks: { a: 'nb-1', b: 'nb-2' },
        });
        const plan = await buildBatchRenamePlan(client, permMgr(), [
            { id: 'a', title: 'Renamed' },
            { id: 'b', title: 'Renamed' },
        ]);
        expect(plan.items).toEqual([
            expect.objectContaining({ id: 'a', notebook: 'nb-1', targetHPath: '/Renamed' }),
            expect.objectContaining({ id: 'b', notebook: 'nb-2', targetHPath: '/Renamed' }),
        ]);

        const conflictClient = createClient({
            hpaths: { a: '/Same', b: '/Same' },
            notebooks: { a: 'nb-1', b: 'nb-2' },
        });
        await expect(buildBatchRenamePlan(conflictClient, permMgr(), [
            { id: 'a', title: 'Same' },
            { id: 'b', title: 'Renamed' },
        ])).resolves.toMatchObject({ items: [{ noChange: true }, { noChange: false }] });
    });

    it('bounds the batch count and serialized size', () => {
        expect(() => assertBatchRenameInput(Array.from({ length: BATCH_RENAME_MAX_ITEMS + 1 }, (_, index) => ({ id: String(index), title: 'x' }))))
            .toThrow(/batch limit/);
        expect(() => assertBatchRenameInput([{ id: 'a', title: 'x'.repeat(256 * 1024) }]))
            .toThrow(/serialized input limit/);
    });
});
