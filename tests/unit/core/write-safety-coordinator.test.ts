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

function createCrossObjectAvFixture() {
    const sourceAvID = '20260813000000-sourcea';
    const destinationAvID = '20260813000001-desta01';
    const sourceBlockID = '20260813000002-sourceb';
    const destinationBlockID = '20260813000003-destb01';
    const sourceItemID = '20260813000004-sourcei';
    const destinationItemID = '20260813000005-desti01';
    const sourceKeyID = '20260813000006-relkey1';
    const destinationKeyID = '20260813000008-destkey';
    const rollupKeyID = '20260813000009-rollup1';
    const templateID = '20260813000010-templat';
    const notebookConfig = { revision: 1 };
    const carriers: Record<string, { avID: string; box: string; domRevision: number }> = {
        [sourceBlockID]: { avID: sourceAvID, box: 'nb-source', domRevision: 1 },
        [destinationBlockID]: { avID: destinationAvID, box: 'nb-destination', domRevision: 1 },
    };
    const sourceAv: Record<string, any> = {
        id: sourceAvID,
        revision: 1,
        keyValues: [
            {
                key: { id: '20260813000011-blockkey', type: 'block' },
                values: [{ blockID: sourceItemID, block: { id: '20260813000012-sourcedoc' } }],
            },
            {
                key: {
                    id: sourceKeyID,
                    type: 'relation',
                    name: 'Source links',
                    relation: { avID: destinationAvID, backKeyID: '20260813000007-backkey', isTwoWay: true },
                },
                values: [{
                    id: '20260813000015-relvalue',
                    blockID: sourceItemID,
                    relation: { blockIDs: [destinationItemID] },
                }],
            },
            {
                key: {
                    id: rollupKeyID,
                    type: 'rollup',
                    name: 'Destination status',
                    rollup: { relationKeyID: sourceKeyID, keyID: destinationKeyID, calc: { operator: 'count' } },
                },
                values: [],
            },
        ],
        views: [{ id: '20260813000017-view001', itemIDs: [sourceItemID] }],
        newItemTemplates: [{
            id: templateID,
            name: 'Linked document',
            targetType: 'document',
            saveLocation: { boxID: 'nb-destination', pathTemplate: '/Linked' },
            fieldValues: {
                [sourceKeyID]: {
                    mode: 'static',
                    value: { type: 'relation', relation: { blockIDs: [destinationItemID] } },
                },
            },
        }],
    };
    const destinationAv: Record<string, any> = {
        id: destinationAvID,
        revision: 1,
        keyValues: [
            {
                key: { id: '20260813000013-destblock', type: 'block' },
                values: [{ blockID: destinationItemID, block: { id: '20260813000014-destdoc' } }],
            },
            {
                key: {
                    id: '20260813000007-backkey',
                    type: 'relation',
                    name: 'Destination links',
                    relation: { avID: sourceAvID, backKeyID: sourceKeyID, isTwoWay: true },
                },
                values: [{
                    id: '20260813000016-backvalue',
                    blockID: destinationItemID,
                    relation: { blockIDs: [sourceItemID] },
                }],
            },
            {
                key: { id: destinationKeyID, type: 'text', name: 'Status' },
                values: [{ id: '20260813000018-destval', blockID: destinationItemID, text: { content: 'Ready' } }],
            },
        ],
        views: [],
    };
    const client = {
        readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
        writeFile: vi.fn(async () => undefined),
        requestRead: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
            if (endpoint === '/api/av/getAttributeView') {
                const avID = body?.id;
                if (avID === sourceAvID) return { av: structuredClone(sourceAv) };
                if (avID === destinationAvID) return { av: structuredClone(destinationAv) };
                throw new Error(`unexpected AV ${String(avID)}`);
            }
            if (endpoint === '/api/av/getMirrorDatabaseBlocks') {
                return { refDefs: [{ refID: destinationBlockID }] };
            }
            if (endpoint === '/api/notebook/getNotebookConf') {
                return { notebook: body?.notebook, revision: notebookConfig.revision };
            }
            if (endpoint === '/api/query/sql') return [];
            if (endpoint === '/api/block/getBlockDOM') {
                const carrier = carriers[String(body?.id)];
                if (!carrier) return { dom: '' };
                return {
                    dom: `<div data-type="NodeAttributeView" data-av-id="${carrier.avID}" data-lease-revision="${carrier.domRevision}"></div>`,
                };
            }
            if (endpoint === '/api/block/getBlockInfo') {
                const carrier = carriers[String(body?.id)];
                return carrier ? { id: body?.id, box: carrier.box, revision: carrier.domRevision } : {};
            }
            return null;
        }),
    } as never;
    const permMgr = createMockPermissionManager({ canRead: () => true, canWrite: () => true, canDelete: () => true });
    permMgr.getAll = vi.fn(() => ({ 'nb-source': 'rw', 'nb-destination': 'rw' }));
    permMgr.get = vi.fn((notebook: string) => notebook === 'nb-source' || notebook === 'nb-destination' ? 'rw' : 'r');

    return {
        client,
        permMgr,
        sourceAv,
        destinationAv,
        carriers,
        notebookConfig,
        ids: {
            sourceAvID,
            destinationAvID,
            sourceBlockID,
            destinationBlockID,
            sourceItemID,
            destinationItemID,
            sourceKeyID,
            destinationKeyID,
            rollupKeyID,
            templateID,
        },
    };
}

async function assertStableCrossObjectActionThenRejectDrift(
    action: 'duplicate_rows' | 'configure_two_way_relation' | 'configure_rollup' | 'create_from_template',
    args: Record<string, unknown>,
    drift: (fixture: ReturnType<typeof createCrossObjectAvFixture>) => void,
    suffix: string,
) {
    const stableFixture = createCrossObjectAvFixture();
    const stableCoordinator = new WriteSafetyCoordinator(stableFixture.client);
    const stablePreflight = parseResult(await stableCoordinator.run({
        client: stableFixture.client,
        permMgr: stableFixture.permMgr,
        category: 'av',
        action,
        args: { ...args, validateOnly: true },
        strictMode: true,
        execute: vi.fn(),
    }));
    const stableExecute = vi.fn(async () => success({ success: true, action, changed: false, status: 'already_applied' }));
    const stableResult = parseResult(await stableCoordinator.run({
        client: stableFixture.client,
        permMgr: stableFixture.permMgr,
        category: 'av',
        action,
        args: {
            ...args,
            requestId: uuidV7(Date.now(), `${suffix.slice(0, 10)}01`),
            [action === 'duplicate_rows' ? 'expectedManifestHash' : 'expectedStateHash']:
                action === 'duplicate_rows' ? stablePreflight.manifestHash : stablePreflight.stateHash,
        },
        strictMode: true,
        execute: stableExecute,
    }));
    expect(stableExecute).toHaveBeenCalledTimes(1);
    expect(stableResult).toMatchObject({
        success: true,
        safety: { writeAttempted: false, writeExecuted: false, transactionState: 'no_change' },
    });

    const staleFixture = createCrossObjectAvFixture();
    const staleCoordinator = new WriteSafetyCoordinator(staleFixture.client);
    const stalePreflight = parseResult(await staleCoordinator.run({
        client: staleFixture.client,
        permMgr: staleFixture.permMgr,
        category: 'av',
        action,
        args: { ...args, validateOnly: true },
        strictMode: true,
        execute: vi.fn(),
    }));
    drift(staleFixture);
    const staleExecute = vi.fn();
    const staleResult = parseResult(await staleCoordinator.run({
        client: staleFixture.client,
        permMgr: staleFixture.permMgr,
        category: 'av',
        action,
        args: {
            ...args,
            requestId: uuidV7(Date.now(), `${suffix.slice(0, 10)}02`),
            [action === 'duplicate_rows' ? 'expectedManifestHash' : 'expectedStateHash']:
                action === 'duplicate_rows' ? stalePreflight.manifestHash : stalePreflight.stateHash,
        },
        strictMode: true,
        execute: staleExecute,
    }));
    expect(staleResult.error).toMatchObject({
        code: 'state_changed',
        expectedHash: action === 'duplicate_rows' ? stalePreflight.manifestHash : stalePreflight.stateHash,
    });
    expect(staleExecute).not.toHaveBeenCalled();
}

describe('write safety coordinator', () => {
    it('rejects a set_relation destination AV drift before dispatch', async () => {
        const fixture = createCrossObjectAvFixture();
        const coordinator = new WriteSafetyCoordinator(fixture.client);
        const args = {
            action: 'set_relation', avID: fixture.ids.sourceAvID, blockID: fixture.ids.sourceBlockID,
            itemID: fixture.ids.sourceItemID, keyID: fixture.ids.sourceKeyID,
            relatedItemIDs: [fixture.ids.destinationItemID],
        };
        const preflight = parseResult(await coordinator.run({
            client: fixture.client, permMgr: fixture.permMgr, category: 'av', action: 'set_relation',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        fixture.destinationAv.revision += 1;
        const execute = vi.fn();
        const result = parseResult(await coordinator.run({
            client: fixture.client, permMgr: fixture.permMgr, category: 'av', action: 'set_relation',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000101'),
                expectedStateHash: preflight.stateHash,
            },
            strictMode: true,
            execute,
        }));

        expect(result.error).toMatchObject({ code: 'state_changed', expectedHash: preflight.stateHash });
        expect(execute).not.toHaveBeenCalled();
    });

    it('leases duplicate_rows against its linked destination AV and carrier', async () => {
        const ids = createCrossObjectAvFixture().ids;
        await assertStableCrossObjectActionThenRejectDrift(
            'duplicate_rows',
            { action: 'duplicate_rows', avID: ids.sourceAvID, blockID: ids.sourceBlockID, sourceRowIDs: [ids.sourceItemID] },
            (fixture) => { fixture.destinationAv.revision += 1; },
            '000000000111',
        );
    });

    it('leases configure_two_way_relation against the verified destination carrier', async () => {
        const ids = createCrossObjectAvFixture().ids;
        await assertStableCrossObjectActionThenRejectDrift(
            'configure_two_way_relation',
            {
                action: 'configure_two_way_relation', avID: ids.sourceAvID, blockID: ids.sourceBlockID,
                keyID: ids.sourceKeyID, destinationAvID: ids.destinationAvID, destinationBlockID: ids.destinationBlockID,
                backRelationKeyID: '20260813000007-backkey', sourceName: 'Source links', destinationName: 'Destination links',
            },
            (fixture) => { fixture.carriers[fixture.ids.destinationBlockID].domRevision += 1; },
            '000000000112',
        );
    });

    it('leases configure_rollup against the relation destination AV', async () => {
        const ids = createCrossObjectAvFixture().ids;
        await assertStableCrossObjectActionThenRejectDrift(
            'configure_rollup',
            {
                action: 'configure_rollup', avID: ids.sourceAvID, blockID: ids.sourceBlockID,
                keyID: ids.rollupKeyID, relationKeyID: ids.sourceKeyID, destinationKeyID: ids.destinationKeyID,
                calc: { operator: 'count' },
            },
            (fixture) => { fixture.destinationAv.revision += 1; },
            '000000000113',
        );
    });

    it('leases create_from_template against its explicit destination notebook', async () => {
        const ids = createCrossObjectAvFixture().ids;
        await assertStableCrossObjectActionThenRejectDrift(
            'create_from_template',
            {
                action: 'create_from_template', avID: ids.sourceAvID, blockID: ids.sourceBlockID,
                templateID: ids.templateID, viewID: '20260813000017-view001',
            },
            (fixture) => { fixture.notebookConfig.revision += 1; },
            '000000000114',
        );
    });

    it('preflights select options against a verified rw AV carrier without requiring rwd', async () => {
        const avID = '20260813000000-avopts01';
        const carrierBlockID = '20260813000001-carrier';
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/av/getAttributeView') {
                    return {
                        av: {
                            id: avID,
                            keyValues: [{ key: { id: 'status', type: 'select', options: [] }, values: [] }],
                            views: [],
                        },
                    };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return { id: body?.id, dom: `<div data-type="NodeAttributeView" data-av-id="${avID}"></div>` };
                }
                if (endpoint === '/api/block/getBlockInfo') return { id: body?.id, box: 'nb-rw' };
                return [];
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: (notebook) => notebook === 'nb-rw', canDelete: () => false });
        permMgr.getAll = vi.fn(() => ({ 'nb-rw': 'rw' }));
        const result = parseResult(await new WriteSafetyCoordinator(client).run({
            client,
            permMgr,
            category: 'av',
            action: 'set_column_options',
            args: {
                action: 'set_column_options', avID, blockID: carrierBlockID, keyID: 'status', options: [], validateOnly: true,
            },
            strictMode: true,
            execute: vi.fn(),
        }));

        expect(result).toMatchObject({ validateOnly: true, writeAttempted: false });
        expect(result.stateHash).toMatch(/^sha256:v1:/);
        expect(permMgr.canWrite).toHaveBeenCalledWith('nb-rw');
        expect(permMgr.canDelete).not.toHaveBeenCalled();
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

    it('reads an AV empty AND root semantically after one strict filter replacement', async () => {
        const avID = '20260813000000-avtest1';
        const blockID = '20260813000001-avtest1';
        const viewID = '20260813000002-avtest1';
        const definition: Record<string, any> = {
            id: avID,
            viewID,
            keyValues: [{ key: { id: 'key-status', type: 'select' }, values: [] }],
            views: [{
                id: viewID,
                name: '主视图',
                type: 'table',
                filters: [{ column: 'key-status', operator: '=', value: { type: 'select', mSelect: [{ content: '进行中' }] } }],
                sorts: [],
                table: { columns: [{ id: 'key-status', hidden: false }] },
            }],
        };
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/av/getAttributeView') return { av: structuredClone(definition) };
                if (endpoint === '/api/attr/getBlockAttrs') return { 'custom-sy-av-view': viewID, 'custom-sy-av-visible-views': 'all' };
                if (endpoint === '/api/block/getBlockDOM') return { id: blockID, dom: `<div data-type="NodeAttributeView" data-av-id="${avID}"></div>` };
                if (endpoint === '/api/block/getBlockInfo') return { id: blockID, box: 'nb-1' };
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rw' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'set_filters', avID, blockID, viewID, filters: [] };
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'av', action: 'set_filters',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        const execute = vi.fn(async () => {
            // `filters,omitempty` means the durable empty AND root loses its
            // empty child array and zero-value leaf fields on raw readback.
            definition.views[0].filters = [{ column: '', operator: '', value: null, combination: 'and' }];
            return success({ success: true, action: 'set_filters' });
        });
        const result = parseResult(await coordinator.run({
            client, permMgr, category: 'av', action: 'set_filters',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000031'),
                expectedStateHash: preflight.stateHash,
            },
            strictMode: true,
            execute,
        }));

        expect(result.safety).toMatchObject({ writeExecuted: true, transactionState: 'committed' });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(client.requestRead).toHaveBeenCalledWith('/api/av/getAttributeView', { id: avID });
        expect(client.requestRead).not.toHaveBeenCalledWith('/api/av/renderAttributeView', expect.anything());
        expect(permMgr.reload).toHaveBeenCalled();
    });

    it('accepts the Retest6 native add-view carrier transition from SiYuan v3.8.0', async () => {
        const avID = '20260813045601-avview1';
        const blockID = '20260813045603-cmg284p';
        const tableViewID = '20260813045603-kizaqbf';
        const newViewID = '20260813045610-vwnew01';
        const definition: Record<string, any> = {
            id: avID,
            viewID: tableViewID,
            views: [{ id: tableViewID, name: '表格', type: 'table', table: { columns: [] } }],
        };
        let carrierAttrs: Record<string, string> = {
            'custom-sy-av-view': tableViewID,
        };
        const requestRead = vi.fn(async (endpoint: string) => {
            if (endpoint === '/api/av/getAttributeView') return { av: structuredClone(definition) };
            if (endpoint === '/api/attr/getBlockAttrs') return carrierAttrs;
            if (endpoint === '/api/block/getBlockDOM') return { id: blockID, dom: `<div data-type="NodeAttributeView" data-av-id="${avID}"></div>` };
            if (endpoint === '/api/block/getBlockInfo') return { id: blockID, box: 'nb-1' };
            return null;
        });
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead,
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rw' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'add_view', avID, blockID, viewID: newViewID, layout: 'table', name: 'Retest6 View' };
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'av', action: 'add_view',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        const execute = vi.fn(async () => {
            definition.viewID = newViewID;
            definition.views.push({ id: newViewID, name: 'Retest6 View', type: 'table', table: { columns: [] } });
            // v3.8.0 addAttrViewView appends this ID after normalizing the
            // carrier list to raw AV view order, and selects it on the carrier.
            carrierAttrs = {
                'custom-sy-av-view': newViewID,
                'custom-sy-av-visible-views': `${tableViewID},${newViewID}`,
            };
            return success({ success: true, action: 'add_view' });
        });

        const result = parseResult(await coordinator.run({
            client, permMgr, category: 'av', action: 'add_view',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000032'),
                expectedStateHash: preflight.stateHash,
            },
            strictMode: true,
            execute,
        }));

        expect(result.safety).toMatchObject({ writeExecuted: true, transactionState: 'committed' });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(requestRead).not.toHaveBeenCalledWith('/api/av/renderAttributeView', expect.anything());
    });

    it('treats an add-view carrier list that is not the native new-ID append as unknown', async () => {
        const avID = '20260813045701-avview1';
        const blockID = '20260813045703-cmg284p';
        const currentViewID = '20260813045703-kizaqbf';
        const newViewID = '20260813045705-newview';
        const definition: Record<string, any> = {
            id: avID,
            viewID: currentViewID,
            views: [{ id: currentViewID, name: '主视图', type: 'table', table: { columns: [] } }],
        };
        let carrierAttrs: Record<string, string> = {
            'custom-sy-av-view': currentViewID,
            'custom-sy-av-visible-views': currentViewID,
        };
        const client = {
            readFile: vi.fn(async () => { throw new Error('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/av/getAttributeView') return { av: structuredClone(definition) };
                if (endpoint === '/api/attr/getBlockAttrs') return carrierAttrs;
                if (endpoint === '/api/block/getBlockDOM') return { id: blockID, dom: `<div data-type="NodeAttributeView" data-av-id="${avID}"></div>` };
                if (endpoint === '/api/block/getBlockInfo') return { id: blockID, box: 'nb-1' };
                return null;
            }),
        } as never;
        const permMgr = createMockPermissionManager({ canWrite: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rw' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const args = { action: 'add_view', avID, blockID, viewID: newViewID, layout: 'gallery', name: '新增画廊' };
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'av', action: 'add_view',
            args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn(),
        }));
        const result = parseResult(await coordinator.run({
            client, permMgr, category: 'av', action: 'add_view',
            args: {
                ...args,
                requestId: uuidV7(Date.now(), '000000000033'),
                expectedStateHash: preflight.stateHash,
            },
            strictMode: true,
            execute: vi.fn(async () => {
                definition.viewID = newViewID;
                definition.views.push({ id: newViewID, name: '新增画廊', type: 'gallery', gallery: { fields: [] } });
                carrierAttrs = {
                    'custom-sy-av-view': newViewID,
                    'custom-sy-av-visible-views': `${currentViewID},unexpected-view,${newViewID}`,
                };
                return success({ success: true, action: 'add_view' });
            }),
        }));

        expect(result).toMatchObject({
            writeAttempted: true,
            writeExecuted: false,
            transactionState: 'unknown',
            error: { code: 'readback_mismatch' },
        });
    });
});
