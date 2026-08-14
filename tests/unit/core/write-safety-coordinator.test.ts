import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { WriteSafetyCoordinator } from '@/core/write-safety-coordinator';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';

function uuidV7(now = Date.now(), suffix = '000000000002') {
    const timestamp = now.toString(16).padStart(12, '0');
    return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7000-8000-${suffix}`;
}

function success(payload: Record<string, unknown>) {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
    };
}

describe('write safety coordinator', () => {
    it('preflights an explicit link-target scope, rejects a changed child list, commits once, and replays the request ID', async () => {
        const parentId = '20260813020101-parent01';
        const existingId = '20260813020102-child001';
        const createdId = '20260813020103-child002';
        let children = [{ id: existingId, name: 'Existing target', path: `/${parentId}/${existingId}.sy`, hPath: '/Imports/Existing target' }];
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                const id = body?.id as string | undefined;
                if (endpoint === '/api/filetree/getPathByID') {
                    if (id === parentId) return { notebook: 'nb-1', path: `/${parentId}.sy` };
                    if (id === existingId) return { notebook: 'nb-1', path: `/${parentId}/${existingId}.sy` };
                    if (id === createdId) return { notebook: 'nb-1', path: `/${parentId}/${createdId}.sy` };
                }
                if (endpoint === '/api/filetree/getHPathByID') {
                    if (id === parentId) return '/Imports';
                    if (id === existingId) return '/Imports/Existing target';
                    if (id === createdId) return '/Imports/New target';
                }
                if (endpoint === '/api/block/getDocInfo') {
                    if (id === parentId) return { id, rootID: id, name: 'Imports' };
                    if (id === existingId) return { id, rootID: id, name: 'Existing target' };
                    if (id === createdId) return { id, rootID: id, name: 'New target' };
                }
                if (endpoint === '/api/filetree/listDocsByPath') {
                    return { box: 'nb-1', path: `/${parentId}.sy`, files: children.map((child) => ({ ...child, box: 'nb-1' })) };
                }
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rw' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = {
            action: 'ensure_link_targets',
            notebook: 'nb-1',
            parentId,
            mode: 'create',
            targets: [{ key: 'new', title: 'New target' }],
        };
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'ensure_link_targets',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        expect(preflight.preconditionField).toBe('expectedStructureHash');
        expect(preflight.structureHash).toMatch(/^sha256:v1:/);

        // A new sibling changes the full authority scope, so the create is
        // stopped before dispatch rather than deciding by a title search.
        children = [...children, { id: '20260813020104-child003', name: 'Concurrent target', path: `/${parentId}/20260813020104-child003.sy`, hPath: '/Imports/Concurrent target' }];
        const blocked = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'ensure_link_targets',
            args: { ...args, requestId: uuidV7(Date.now(), '000000000041'), expectedStructureHash: preflight.structureHash },
            strictMode: true, execute: vi.fn(),
        }));
        expect(blocked.error.code).toBe('state_changed');

        const fresh = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'ensure_link_targets',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        const execute = vi.fn(async () => {
            children = [...children, { id: createdId, name: 'New target', path: `/${parentId}/${createdId}.sy`, hPath: '/Imports/New target' }];
            return success({
                success: true,
                created: 1,
                linkMap: { new: { id: createdId, notebook: 'nb-1', path: `/${parentId}/${createdId}.sy`, hPath: '/Imports/New target' } },
            });
        });
        const requestId = uuidV7(Date.now(), '000000000042');
        const committed = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'ensure_link_targets',
            args: { ...args, requestId, expectedStructureHash: fresh.structureHash },
            strictMode: true, execute,
        }));
        expect(committed.safety).toMatchObject({ transactionState: 'committed', writeExecuted: true });
        expect(execute).toHaveBeenCalledTimes(1);

        const replayed = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'ensure_link_targets',
            args: { ...args, requestId, expectedStructureHash: fresh.structureHash },
            strictMode: true, execute,
        }));
        expect(replayed.replayed).toBe(true);
        expect(execute).toHaveBeenCalledTimes(1);

        const unknownArgs = {
            ...args,
            targets: [{ key: 'unknown', title: 'Unknown target' }],
        };
        const unknownPreflight = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'ensure_link_targets',
            args: { ...unknownArgs, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        const uncertainExecute = vi.fn(async () => { throw new Error('connection dropped after create dispatch'); });
        const unknownRequestId = uuidV7(Date.now(), '000000000043');
        const unknown = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'ensure_link_targets',
            args: { ...unknownArgs, requestId: unknownRequestId, expectedStructureHash: unknownPreflight.structureHash },
            strictMode: true, execute: uncertainExecute,
        }));
        expect(unknown).toMatchObject({
            transactionState: 'unknown',
            error: { code: 'outcome_unknown' },
        });

        const unknownReplay = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'ensure_link_targets',
            args: { ...unknownArgs, requestId: unknownRequestId, expectedStructureHash: unknownPreflight.structureHash },
            strictMode: true, execute: uncertainExecute,
        }));
        expect(unknownReplay.error.code).toBe('outcome_unknown');
        expect(uncertainExecute).toHaveBeenCalledTimes(1);
    });

    it('observes timeline rollback changes through live document markdown', async () => {
        const documentID = '20260812000000-timeline';
        const blockID = '20260812000001-timeline';
        let markdown = 'after snapshot';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/repo/getRepoTagSnapshots') return { tags: [{ tag: 'timeline-tag' }] };
                if (endpoint === '/api/block/getChildBlocks') {
                    return body?.id === documentID ? [{ id: blockID, type: 'p' }] : [];
                }
                if (endpoint === '/api/block/getBlockKramdown') return { kramdown: markdown };
                if (endpoint === '/api/block/checkBlockExist') return true;
                if (endpoint === '/api/block/getBlockInfo') return { id: body?.id, box: 'nb-1' };
                if (endpoint === '/api/attr/getBlockAttrs') return {};
                if (endpoint === '/api/query/sql') return [];
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = {
            action: 'rollback_document',
            documentId: documentID,
            tag: 'timeline-tag',
        };
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'timeline', action: 'rollback_document',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        const result = parseResult(await coordinator.run({
            client, permMgr, category: 'timeline', action: 'rollback_document',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000011'),
                expectedStateHash: preflight.stateHash,
            },
            strictMode: true,
            execute: vi.fn(async () => {
                markdown = 'snapshot content';
                return success({ success: true, documentId: documentID });
            }),
        }));

        expect(result.safety).toMatchObject({ writeExecuted: true, transactionState: 'committed' });
        expect(result.safety.previousHash).not.toBe(result.safety.resultHash);
    });

    it('reads back a newly created notebook before it has an explicit permission entry', async () => {
        const notebookID = '20260812000000-newbook';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/notebook/lsNotebooks') {
                    return { notebooks: [{ id: notebookID, name: 'New Notebook', closed: false }] };
                }
                if (endpoint === '/api/notebook/getNotebookConf') return { closed: false };
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({
            canWrite: (id) => id !== notebookID,
            canDelete: (id) => id !== notebookID,
        });
        permMgr.getAll = vi.fn(() => ({ 'nb-existing': 'rwd' }));

        const result = parseResult(await new WriteSafetyCoordinator(client).run({
            client,
            permMgr,
            category: 'notebook',
            action: 'create',
            args: {
                action: 'create',
                name: 'New Notebook',
                requestId: uuidV7(Date.now(), '000000000001'),
            },
            strictMode: true,
            execute: vi.fn(async () => success({ id: notebookID, name: 'New Notebook' })),
        }));

        expect(result.safety).toMatchObject({
            writeSafetyGuaranteed: true,
            writeExecuted: true,
            transactionState: 'committed',
        });
        expect(result.safety.resultHash).toMatch(/^sha256:v1:/);
        expect(permMgr.canWrite).not.toHaveBeenCalledWith(notebookID);
    });

    it('allows set_permission to bootstrap a notebook without an existing permission entry', async () => {
        const notebookID = '20260812000000-newperm';
        let permission = 'r';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/notebook/lsNotebooks') {
                    return { notebooks: [{ id: notebookID, name: 'New Notebook', closed: false, permission }] };
                }
                if (endpoint === '/api/notebook/getNotebookConf') return { closed: false };
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({
            canWrite: () => false,
            canDelete: () => false,
        });
        permMgr.getAll = vi.fn(() => permission === 'rwd' ? { [notebookID]: 'rwd' } : {});
        const coordinator = new WriteSafetyCoordinator(client);
        const baseArgs = { action: 'set_permission', notebook: notebookID, permission: 'rwd' };
        const preflight = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'notebook',
            action: 'set_permission',
            args: { ...baseArgs, validateOnly: true },
            strictMode: true,
            execute: vi.fn(),
        }));
        const result = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'notebook',
            action: 'set_permission',
            args: {
                ...baseArgs,
                requestId: uuidV7(Date.now(), '000000000009'),
                expectedStateHash: preflight.stateHash,
            },
            strictMode: true,
            execute: vi.fn(async () => {
                permission = 'rwd';
                return success({ success: true });
            }),
        }));

        expect(preflight.stateHash).toMatch(/^sha256:v1:/);
        expect(result.safety).toMatchObject({ writeExecuted: true, transactionState: 'committed' });
        expect(permMgr.canWrite).not.toHaveBeenCalled();
        expect(permMgr.canDelete).not.toHaveBeenCalled();
    });

    it('reads back the newly created document when duplicating a source document', async () => {
        const sourceID = '20260812000000-source1';
        const duplicateID = '20260812000001-copy001';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/checkBlockExist') return true;
                if (endpoint === '/api/block/getBlockInfo') return { id: body?.id, box: 'nb-1', updated: '1' };
                if (endpoint === '/api/attr/getBlockAttrs') return {};
                if (endpoint === '/api/block/getBlockKramdown') return { kramdown: body?.id === duplicateID ? 'copy' : 'source' };
                if (endpoint === '/api/block/getChildBlocks') return [];
                if (endpoint === '/api/query/sql') return [];
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const baseArgs = { action: 'duplicate', id: sourceID };
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'duplicate',
            args: { ...baseArgs, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        const result = parseResult(await coordinator.run({
            client, permMgr, category: 'document', action: 'duplicate',
            args: {
                ...baseArgs,
                requestId: uuidV7(Date.now(), '000000000010'),
                expectedStateHash: preflight.stateHash,
            },
            strictMode: true,
            execute: vi.fn(async () => success({ success: true, sourceID, id: duplicateID })),
        }));

        expect(result.safety).toMatchObject({ writeExecuted: true, transactionState: 'committed' });
        expect(client.requestRead).toHaveBeenCalledWith('/api/block/getBlockInfo', { id: duplicateID });
    });

    it('preflights, rejects stale state, commits once, and replays requestIds', async () => {
        let updated = '20260812010101';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/block/checkBlockExist') return true;
                if (endpoint === '/api/block/getBlockInfo') return { id: '20260812000000-abcdefg', box: 'nb-1', updated };
                if (endpoint === '/api/attr/getBlockAttrs') return {};
                if (endpoint === '/api/block/getBlockKramdown') return { kramdown: updated };
                if (endpoint === '/api/block/getChildBlocks') return [];
                if (endpoint === '/api/query/sql') return [];
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
        permMgr.get = vi.fn(() => 'rwd');
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const baseArgs = { action: 'update', id: '20260812000000-abcdefg' };

        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', args: { ...baseArgs, validateOnly: true }, strictMode: true,
            execute: vi.fn(),
        }));
        expect(preflight.writeExecuted).toBe(false);
        expect(preflight.stateHash).toMatch(/^sha256:v1:[a-f0-9]{4}$/);
        expect(preflight.hashPrefixLength).toBe(4);
        expect(preflight.leaseExpiresAt).toBeGreaterThan(Date.now());

        const execute = vi.fn(async () => {
            updated = '20260812020202';
            return success({ success: true, action: 'update' });
        });
        const requestId = uuidV7();
        const bareUppercaseCredential = String(preflight.stateHash).replace('sha256:v1:', '').toUpperCase();
        const committed = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'block',
            action: 'update',
            args: { ...baseArgs, requestId, expectedStateHash: bareUppercaseCredential },
            strictMode: true,
            execute,
        }));
        expect(committed.safety).toMatchObject({ transactionState: 'committed', writeExecuted: true });
        expect(execute).toHaveBeenCalledTimes(1);

        const replayed = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'block',
            action: 'update',
            args: { ...baseArgs, requestId, expectedStateHash: preflight.stateHash },
            strictMode: true,
            execute,
        }));
        expect(replayed.replayed).toBe(true);
        expect(execute).toHaveBeenCalledTimes(1);

        const stale = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'block',
            action: 'update',
            args: { ...baseArgs, requestId: uuidV7(Date.now(), '000000000003'), expectedStateHash: preflight.stateHash },
            strictMode: true,
            execute,
        }));
        expect(stale.error).toMatchObject({ code: 'preflight_lease_invalid', revalidateRequired: true });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('preserves a lease for a definite pre-write rejection and consumes it after an unknown outcome', async () => {
        const id = '20260812000000-abcdefg';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/block/checkBlockExist') return true;
                if (endpoint === '/api/block/getBlockInfo') return { id, box: 'nb-1' };
                if (endpoint === '/api/attr/getBlockAttrs') return {};
                if (endpoint === '/api/block/getBlockKramdown') return { kramdown: 'stable' };
                if (endpoint === '/api/block/getChildBlocks' || endpoint === '/api/query/sql') return [];
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rw' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'update', id, data: 'next' };
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', args: { ...args, validateOnly: true }, strictMode: true,
            execute: vi.fn(),
        }));

        const rejected = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'block',
            action: 'update',
            args: { ...args, requestId: uuidV7(Date.now(), '000000000020'), expectedStateHash: preflight.stateHash },
            strictMode: true,
            execute: vi.fn(async () => ({
                content: [{ type: 'text' as const, text: JSON.stringify({ error: { type: 'permission_denied' } }) }],
                isError: true,
            })),
        }));
        expect(rejected.safety).toMatchObject({ writeAttempted: false, transactionState: 'rejected' });

        const failed = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'block',
            action: 'update',
            args: { ...args, requestId: uuidV7(Date.now(), '000000000021'), expectedStateHash: preflight.stateHash },
            strictMode: true,
            execute: vi.fn(async () => { throw new Error('connection dropped'); }),
        }));
        expect(failed.error.code).toBe('outcome_unknown');

        const consumed = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'block',
            action: 'update',
            args: { ...args, requestId: uuidV7(Date.now(), '000000000022'), expectedStateHash: preflight.stateHash },
            strictMode: true,
            execute: vi.fn(),
        }));
        expect(consumed.error).toMatchObject({ code: 'preflight_lease_invalid', revalidateRequired: true });
    });

    it('rejects malformed credentials before probing or executing', async () => {
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            requestRead: vi.fn(),
        } as never;
        const coordinator = new WriteSafetyCoordinator(client);
        const execute = vi.fn();
        for (const [index, credential] of ['abc', 'f'.repeat(65), 'sha256:v2:8ac2', 'zzzz'].entries()) {
            const result = parseResult(await coordinator.run({
                client,
                permMgr: createMockPermissionManager(),
                category: 'block',
                action: 'update',
                args: {
                    action: 'update',
                    id: '20260812000000-abcdefg',
                    requestId: uuidV7(Date.now(), String(index + 30).padStart(12, '0')),
                    expectedStateHash: credential,
                },
                strictMode: true,
                execute,
            }));
            expect(result.error.code).toBe('precondition_required');
        }
        expect(client.requestRead).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('consumes the lease when the committed idempotency record cannot be persisted', async () => {
        const id = '20260812000000-abcdefg';
        let markdown = 'before';
        let ledgerWrites = 0;
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => {
                ledgerWrites += 1;
                if (ledgerWrites === 2) throw new Error('ledger storage unavailable');
            }),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/block/checkBlockExist') return true;
                if (endpoint === '/api/block/getBlockInfo') return { id, box: 'nb-1' };
                if (endpoint === '/api/attr/getBlockAttrs') return {};
                if (endpoint === '/api/block/getBlockKramdown') return { kramdown: markdown };
                if (endpoint === '/api/block/getChildBlocks' || endpoint === '/api/query/sql') return [];
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rw' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'update', id, data: 'after' };
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', args: { ...args, validateOnly: true }, strictMode: true,
            execute: vi.fn(),
        }));
        const execute = vi.fn(async () => {
            markdown = 'after';
            return success({ success: true, updated: true });
        });
        const failed = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'block',
            action: 'update',
            args: { ...args, requestId: uuidV7(Date.now(), '000000000025'), expectedStateHash: preflight.stateHash },
            strictMode: true,
            execute,
        }));
        expect(failed.error.code).toBe('outcome_unknown');
        expect(execute).toHaveBeenCalledTimes(1);

        const consumed = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'block',
            action: 'update',
            args: { ...args, requestId: uuidV7(Date.now(), '000000000026'), expectedStateHash: preflight.stateHash },
            strictMode: true,
            execute,
        }));
        expect(consumed.error.code).toBe('preflight_lease_invalid');
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('consumes a lease after a verified no-change result', async () => {
        vi.useFakeTimers();
        try {
            const id = '20260812000000-abcdefg';
            const client = {
                readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
                writeFile: vi.fn(async () => undefined),
                requestRead: vi.fn(async (endpoint: string) => {
                    if (endpoint === '/api/block/checkBlockExist') return true;
                    if (endpoint === '/api/block/getBlockInfo') return { id, box: 'nb-1' };
                    if (endpoint === '/api/attr/getBlockAttrs') return {};
                    if (endpoint === '/api/block/getBlockKramdown') return { kramdown: 'same' };
                    if (endpoint === '/api/block/getChildBlocks' || endpoint === '/api/query/sql') return [];
                    return null;
                }),
            } as never;
            const permMgr = createMockPermissionManager({ canWrite: () => true });
            permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rw' }));
            const coordinator = new WriteSafetyCoordinator(client);
            const args = { action: 'update', id, data: 'same' };
            const preflight = parseResult(await coordinator.run({
                client, permMgr, category: 'block', action: 'update', args: { ...args, validateOnly: true }, strictMode: true,
                execute: vi.fn(),
            }));
            const execute = vi.fn(async () => success({ success: true, changed: false }));
            const pending = coordinator.run({
                client,
                permMgr,
                category: 'block',
                action: 'update',
                args: { ...args, requestId: uuidV7(Date.now(), '000000000027'), expectedStateHash: preflight.stateHash },
                strictMode: true,
                execute,
            });
            await vi.runAllTimersAsync();
            const noChange = parseResult(await pending);
            expect(noChange.safety.transactionState).toBe('no_change');

            const consumed = parseResult(await coordinator.run({
                client,
                permMgr,
                category: 'block',
                action: 'update',
                args: { ...args, requestId: uuidV7(Date.now(), '000000000028'), expectedStateHash: preflight.stateHash },
                strictMode: true,
                execute,
            }));
            expect(consumed.error.code).toBe('preflight_lease_invalid');
            expect(execute).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('never executes validateOnly when strict mode is disabled', async () => {
        const execute = vi.fn();
        const result = parseResult(await new WriteSafetyCoordinator({} as never).run({
            client: {} as never,
            permMgr: createMockPermissionManager(),
            category: 'mascot',
            action: 'buy',
            args: { action: 'buy', item_id: 'fish', validateOnly: true },
            strictMode: false,
            execute,
        }));
        expect(result.error.code).toBe('strict_mode_disabled');
        expect(execute).not.toHaveBeenCalled();
    });

    it('never treats validateOnly as permission to execute an external side effect', async () => {
        const execute = vi.fn();
        const result = parseResult(await new WriteSafetyCoordinator({} as never).run({
            client: {} as never,
            permMgr: createMockPermissionManager(),
            category: 'system',
            action: 'perform_sync',
            args: { action: 'perform_sync', validateOnly: true },
            strictMode: true,
            execute,
        }));
        expect(result.error.code).toBe('preflight_unavailable');
        expect(execute).not.toHaveBeenCalled();
    });

    it('fingerprints complete fs documents by human path before compound edits', async () => {
        let markdown = 'old';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string, payload?: { stmt?: string }) => {
                if (endpoint === '/api/notebook/lsNotebooks') {
                    return { notebooks: [{ id: 'nb-1', name: 'Notes' }] };
                }
                if (endpoint === '/api/filetree/getIDsByHPath') {
                    return ['20260812000000-abcdefg'];
                }
                if (endpoint === '/api/block/getChildBlocks') {
                    return [{ id: '20260812000001-abcdefg', type: 'p' }];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { kramdown: markdown };
                }
                if (payload?.stmt?.includes('hpath')) {
                    return [{ id: '20260812000000-abcdefg', box: 'nb-1', hpath: '/Doc' }];
                }
                return [];
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'replace', path: '/Notes/Doc', edit: { old: 'old', new: 'new' } };

        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'fs', action: 'replace', args: { ...args, validateOnly: true }, strictMode: true,
            execute: vi.fn(),
        }));
        const execute = vi.fn(async () => {
            markdown = 'new';
            return success({ success: true });
        });
        const result = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'fs',
            action: 'replace',
            args: { ...args, requestId: uuidV7(Date.now(), '000000000004'), expectedManifestHash: preflight.manifestHash },
            strictMode: true,
            execute,
        }));

        expect(result.safety).toMatchObject({ writeExecuted: true, transactionState: 'committed' });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('rejects an fs overwrite when live block kramdown changed before execution', async () => {
        let markdown = 'baseline';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string, payload?: { stmt?: string }) => {
                if (endpoint === '/api/notebook/lsNotebooks') {
                    return { notebooks: [{ id: 'nb-1', name: 'Notes' }] };
                }
                if (endpoint === '/api/filetree/getIDsByHPath') {
                    return ['20260812000000-abcdefg'];
                }
                if (endpoint === '/api/block/getChildBlocks') {
                    return [{ id: '20260812000001-abcdefg', type: 'p' }];
                }
                if (endpoint === '/api/block/getBlockKramdown') return { kramdown: markdown };
                if (payload?.stmt?.includes('hpath')) {
                    return [{ id: '20260812000000-abcdefg', box: 'nb-1', hpath: '/Doc' }];
                }
                return [];
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'write', path: '/Notes/Doc', markdown: 'replacement', overwrite: true };

        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'fs', action: 'write', args: { ...args, validateOnly: true }, strictMode: true,
            execute: vi.fn(),
        }));
        markdown = 'concurrent change';
        const execute = vi.fn();
        const result = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'fs',
            action: 'write',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000005'),
                expectedStateHash: preflight.stateHash,
            },
            strictMode: true,
            execute,
        }));

        expect(result.error).toMatchObject({
            code: 'state_changed',
            expectedHash: preflight.stateHash,
        });
        expect(result.error.currentHash).toMatch(/^sha256:v1:/);
        expect(execute).not.toHaveBeenCalled();

        const consumed = parseResult(await coordinator.run({
            client,
            permMgr,
            category: 'fs',
            action: 'write',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000023'),
                expectedStateHash: preflight.stateHash,
            },
            strictMode: true,
            execute,
        }));
        expect(consumed.error.code).toBe('preflight_lease_invalid');
    });

    it('treats an unchanged find_replace readback as unknown instead of guaranteed no_change', async () => {
        vi.useFakeTimers();
        try {
            const id = '20260812000000-abcdefg';
            const client = {
                readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
                writeFile: vi.fn(async () => undefined),
                requestRead: vi.fn(async (endpoint: string) => {
                    if (endpoint === '/api/block/checkBlockExist') return true;
                    if (endpoint === '/api/block/getBlockInfo') return { id, box: 'nb-1' };
                    if (endpoint === '/api/attr/getBlockAttrs') return {};
                    if (endpoint === '/api/block/getBlockKramdown') return { kramdown: 'OLD' };
                    if (endpoint === '/api/block/getChildBlocks') return [];
                    if (endpoint === '/api/query/sql') return [];
                    return null;
                }),
            } as never;
            const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
            permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
            const coordinator = new WriteSafetyCoordinator(client);
            const args = { action: 'find_replace', ids: [id], k: 'OLD', r: 'NEW' };
            const preflight = parseResult(await coordinator.run({
                client, permMgr, category: 'search', action: 'find_replace', args: { ...args, validateOnly: true }, strictMode: true,
                execute: vi.fn(),
            }));
            expect(preflight.targetCount).toBe(1);

            const pending = coordinator.run({
                client,
                permMgr,
                category: 'search',
                action: 'find_replace',
                args: {
                    ...args,
                    requestId: uuidV7(Date.now(), '000000000006'),
                    expectedManifestHash: preflight.manifestHash,
                },
                strictMode: true,
                execute: vi.fn(async () => success({ success: true, replaced: true, ids: [id] })),
            });
            await vi.runAllTimersAsync();
            const result = parseResult(await pending);

            expect(result).toMatchObject({
                writeAttempted: true,
                writeExecuted: false,
                transactionState: 'unknown',
                error: { code: 'readback_mismatch' },
            });
            const consumed = parseResult(await coordinator.run({
                client,
                permMgr,
                category: 'search',
                action: 'find_replace',
                args: {
                    ...args,
                    requestId: uuidV7(Date.now(), '000000000024'),
                    expectedManifestHash: preflight.manifestHash,
                },
                strictMode: true,
                execute: vi.fn(),
            }));
            expect(consumed.error.code).toBe('preflight_lease_invalid');
        } finally {
            vi.useRealTimers();
        }
    });

    it('hashes equivalent Kramdown IAL attribute orders identically', async () => {
        const id = '20260812000000-abcdefg';
        let reverse = false;
        const client = {
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/block/checkBlockExist') return true;
                if (endpoint === '/api/block/getBlockInfo') return { id, box: 'nb-1', updated: reverse ? '2' : '1' };
                if (endpoint === '/api/attr/getBlockAttrs') return { id, updated: reverse ? '2' : '1', 'custom-test': 'stable' };
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        kramdown: reverse
                            ? `content\n{: updated="2" id="${id}" custom-test="stable"}`
                            : `content\n{: custom-test="stable" id="${id}" updated="1"}`,
                    };
                }
                if (endpoint === '/api/block/getChildBlocks') return [];
                if (endpoint === '/api/query/sql') return [];
                return null;
            }),
        } as never;
        const coordinator = new WriteSafetyCoordinator(client);
        const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
        const args = { action: 'update', id };

        const first = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', args: { ...args, validateOnly: true }, strictMode: true,
            execute: vi.fn(),
        }));
        reverse = true;
        const second = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', args: { ...args, validateOnly: true }, strictMode: true,
            execute: vi.fn(),
        }));

        expect(second.stateHash).toBe(first.stateHash);
    });

    it('fails closed when a live block probe cannot be read', async () => {
        const id = '20260812000000-abcdefg';
        const client = {
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/block/checkBlockExist') return true;
                if (endpoint === '/api/block/getBlockInfo') throw new Error('live endpoint unavailable');
                return {};
            }),
        } as never;
        const execute = vi.fn();
        const result = parseResult(await new WriteSafetyCoordinator(client).run({
            client,
            permMgr: createMockPermissionManager({ canWrite: () => true }),
            category: 'block',
            action: 'update',
            args: { action: 'update', id, validateOnly: true },
            strictMode: true,
            execute,
        }));

        expect(result.error).toMatchObject({ code: 'write_safety_failed' });
        expect(execute).not.toHaveBeenCalled();
    });

    it('does not treat an empty flashcard box field as a notebook permission target', async () => {
        const blockID = '20260812000000-abcdefg';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/riff/getRiffCards') {
                    return { cards: [{ id: blockID, box: '', content: 'card' }] };
                }
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: (box) => box !== '' });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
        const result = parseResult(await new WriteSafetyCoordinator(client).run({
            client,
            permMgr,
            category: 'flashcard',
            action: 'create_card',
            args: {
                action: 'create_card',
                deckID: '20230218211946-2kw8jgx',
                blockIDs: [blockID],
                requestId: uuidV7(Date.now(), '000000000007'),
            },
            strictMode: true,
            execute: vi.fn(async () => success({ success: true, created: true })),
        }));

        expect(result.safety).toMatchObject({ writeExecuted: true, transactionState: 'committed' });
        expect(permMgr.canWrite).not.toHaveBeenCalledWith('');
    });

    it('scopes flashcard hashes to requested block IDs', async () => {
        const targetID = '20260812000000-abcdefg';
        let unrelatedDue = 1;
        let targetDue = 1;
        const client = {
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/riff/getRiffCards') {
                    return {
                        cards: [
                            { id: targetID, box: 'nb-1', content: 'target', riffCard: { due: targetDue, reps: 0, state: 0 } },
                            { id: '20260812000001-abcdefg', box: 'nb-1', due: unrelatedDue },
                        ],
                    };
                }
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canDelete: () => true, canWrite: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'remove_card', deckID: '20230218211946-2kw8jgx', blockIDs: [targetID] };

        const first = parseResult(await coordinator.run({
            client, permMgr, category: 'flashcard', action: 'remove_card', args: { ...args, validateOnly: true }, strictMode: true,
            execute: vi.fn(),
        }));
        unrelatedDue = 2;
        targetDue = 2;
        const second = parseResult(await coordinator.run({
            client, permMgr, category: 'flashcard', action: 'remove_card', args: { ...args, validateOnly: true }, strictMode: true,
            execute: vi.fn(),
        }));

        expect(second.stateHash).toBe(first.stateHash);
    });

    it('marks a digest-verified upload as committed even when source and destination hashes match', async () => {
        const sourcePath = '/private/tmp/source.txt';
        const bytes = new Uint8Array([1, 2, 3]);
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            readFileBinary: vi.fn(async () => bytes),
        } as never;
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'upload_asset', localFilePath: sourcePath, assetsDirPath: '/assets/' };
        vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from(bytes));
        const preflight = parseResult(await coordinator.run({
            client,
            permMgr: createMockPermissionManager(),
            category: 'file',
            action: 'upload_asset',
            args: { ...args, validateOnly: true },
            strictMode: true,
            execute: vi.fn(),
        }));
        const result = parseResult(await coordinator.run({
            client,
            permMgr: createMockPermissionManager(),
            category: 'file',
            action: 'upload_asset',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000008'),
                expectedSourceHash: preflight.sourceHash,
            },
            strictMode: true,
            execute: vi.fn(async () => success({ succMap: { 'source.txt': 'assets/source.txt' } })),
        }));

        expect(result.safety).toMatchObject({ writeExecuted: true, transactionState: 'committed' });
    });

    function createReorderSafetyFixture() {
        const notebookID = '20260813000000-nbook01';
        const docs = [
            { id: '20260813000001-doc0001', path: '/a.sy', hPath: '/A', sort: 10 },
            { id: '20260813000002-doc0002', path: '/b.sy', hPath: '/B', sort: 20 },
            { id: '20260813000003-doc0003', path: '/c.sy', hPath: '/C', sort: 30 },
        ];
        let order = docs.map((item) => item.id);
        let sortMode = 2;
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/notebook/lsNotebooks') return { notebooks: [{ id: notebookID, name: 'Ideas', closed: false }] };
                if (endpoint === '/api/notebook/getNotebookConf') return { box: notebookID, name: 'Ideas', conf: { sortMode, dailyNoteSavePath: '/' } };
                if (endpoint === '/api/filetree/listDocsByPath') return { box: notebookID, files: order.map((id) => docs.find((item) => item.id === id)) };
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
        permMgr.getAll = vi.fn(() => ({ [notebookID]: 'rwd' }));
        return {
            notebookID,
            docs,
            client,
            permMgr,
            getOrder: () => [...order],
            setOrder: (next: string[]) => { order = [...next]; },
            setSortMode: (next: number) => { sortMode = next; },
        };
    }

    it('uses a structure lease for reorder, rejects stale trees, commits once, and replays request IDs', async () => {
        const fixture = createReorderSafetyFixture();
        const coordinator = new WriteSafetyCoordinator(fixture.client);
        const targetOrder = [fixture.docs[2].id, fixture.docs[0].id, fixture.docs[1].id];
        const args = { action: 'reorder', parentID: fixture.notebookID, orderedIDs: targetOrder };
        const firstPreflight = parseResult(await coordinator.run({
            client: fixture.client, permMgr: fixture.permMgr, category: 'document', action: 'reorder',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));

        expect(firstPreflight).toMatchObject({
            validateOnly: true,
            writeExecuted: false,
            preconditionField: 'expectedStructureHash',
        });
        expect(firstPreflight.structureHash).toMatch(/^sha256:v1:[a-f0-9]{4,}$/);

        fixture.setOrder([fixture.docs[1].id, fixture.docs[0].id, fixture.docs[2].id]);
        const staleExecute = vi.fn();
        const stale = parseResult(await coordinator.run({
            client: fixture.client, permMgr: fixture.permMgr, category: 'document', action: 'reorder',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000041'),
                expectedStructureHash: firstPreflight.structureHash,
            },
            strictMode: true,
            execute: staleExecute,
        }));
        expect(stale.error).toMatchObject({ code: 'state_changed', revalidateRequired: true });
        expect(staleExecute).not.toHaveBeenCalled();

        fixture.setOrder(fixture.docs.map((item) => item.id));
        const preflight = parseResult(await coordinator.run({
            client: fixture.client, permMgr: fixture.permMgr, category: 'document', action: 'reorder',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        const execute = vi.fn(async () => {
            fixture.setOrder(targetOrder);
            fixture.setSortMode(6);
            return success({ success: true, changed: true, order: targetOrder });
        });
        const requestId = uuidV7(Date.now(), '000000000042');
        const committed = parseResult(await coordinator.run({
            client: fixture.client, permMgr: fixture.permMgr, category: 'document', action: 'reorder',
            args: { ...args, requestId, expectedStructureHash: preflight.structureHash }, strictMode: true, execute,
        }));
        expect(committed.safety).toMatchObject({ writeExecuted: true, transactionState: 'committed', replayed: false });
        expect(execute).toHaveBeenCalledTimes(1);

        const replayed = parseResult(await coordinator.run({
            client: fixture.client, permMgr: fixture.permMgr, category: 'document', action: 'reorder',
            args: { ...args, requestId, expectedStructureHash: preflight.structureHash }, strictMode: true, execute,
        }));
        expect(replayed.replayed).toBe(true);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('returns readback_mismatch when reorder does not retain the exact target order', async () => {
        const fixture = createReorderSafetyFixture();
        const coordinator = new WriteSafetyCoordinator(fixture.client);
        const targetOrder = [fixture.docs[2].id, fixture.docs[0].id, fixture.docs[1].id];
        const args = { action: 'reorder', parentID: fixture.notebookID, orderedIDs: targetOrder };
        const preflight = parseResult(await coordinator.run({
            client: fixture.client, permMgr: fixture.permMgr, category: 'document', action: 'reorder',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        const result = parseResult(await coordinator.run({
            client: fixture.client, permMgr: fixture.permMgr, category: 'document', action: 'reorder',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000043'),
                expectedStructureHash: preflight.structureHash,
            },
            strictMode: true,
            execute: vi.fn(async () => {
                fixture.setSortMode(6);
                return success({ success: true, changed: true, order: targetOrder });
            }),
        }));

        expect(result.error.code).toBe('readback_mismatch');
        expect(result.error.cause).toContain('requested complete order');
    });
});
