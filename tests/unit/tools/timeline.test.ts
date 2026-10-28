import { describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig, isDangerousAction } from '@/core/config';
import {
    compareTimelineNode,
    createTimelineNode,
    deleteTimelineNode,
    rollbackTimelineBlock,
} from '@/core/timeline-service';
import { callTimelineTool, listTimelineTools } from '@/tools/timeline';
import { createMockClient } from '../../helpers/mock-client';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';

const DOC_ID = '20260805200000-abcdefg';
const GLOBAL_TAG = 'sisyphustimeline_global_release';
const DOCUMENT_TAG = `sisyphustimeline_${DOC_ID}_release`;

function snapshotClient(options: { tagged?: boolean } = { tagged: true }) {
    let createCount = 0;
    const request = vi.fn(async (endpoint: string, data?: Record<string, unknown>) => {
        if (endpoint === '/api/repo/getRepoSnapshots') {
            const snapshots = [
                ...Array.from({ length: createCount }, (_, index) => ({
                    id: `current-${index + 1}`,
                    memo: index === 0 ? 'release' : `[Sisyphus Timeline Current] ${DOC_ID}`,
                    created: 200 + index,
                })).reverse(),
                { id: 'old', memo: 'old', created: 1 },
            ];
            return { snapshots, pageCount: 1, totalCount: snapshots.length };
        }
        if (endpoint === '/api/repo/createSnapshot') {
            createCount += 1;
            return null;
        }
        if (endpoint === '/api/repo/getRepoTagSnapshots') {
            return options.tagged === false ? { snapshots: [] } : {
                snapshots: [{ id: 'history', memo: 'release', tag: data?.tag ?? GLOBAL_TAG, created: 100 }],
            };
        }
        if (endpoint === '/api/repo/tagSnapshot') return null;
        if (endpoint === '/api/repo/removeRepoTagSnapshot') return null;
        if (endpoint === '/api/repo/diffRepoSnapshots') {
            return {
                updatesLeft: [{ fileID: 'left-file', path: `/data/${DOC_ID}.sy`, title: 'Doc' }],
                updatesRight: [{ fileID: 'right-file', path: `/data/${DOC_ID}.sy`, title: 'Doc' }],
            };
        }
        if (endpoint === '/api/repo/openRepoSnapshotFile') {
            return data?.id === 'left-file'
                ? { title: 'Doc', content: '', displayInText: true, updated: 'old' }
                : { title: 'Doc', content: '<div data-node-id="added" data-type="NodeParagraph">new</div>', displayInText: true, updated: 'new' };
        }
        if (endpoint === '/api/block/deleteBlock') return null;
        if (endpoint === '/api/attr/getBlockAttrs') return {};
        if (endpoint === '/api/attr/setBlockAttrs') return null;
        return null;
    });
    return createMockClient({ request });
}

describe('timeline tool', () => {
    it('enables list/create/compare and keeps destructive actions disabled by default', () => {
        const config = buildDefaultToolConfig().timeline;
        expect(config).toEqual({
            enabled: true,
            actions: {
                list_nodes: true,
                create_node: true,
                compare_node: true,
                delete_node: false,
                rollback_document: false,
                rollback_block: false,
            },
        });
        expect(listTimelineTools(config)[0].inputSchema.properties.action.enum).toEqual([
            'list_nodes', 'create_node', 'compare_node', 'help',
        ]);
        expect(isDangerousAction('timeline', 'delete_node')).toBe(true);
        expect(isDangerousAction('timeline', 'rollback_document')).toBe(true);
        expect(isDangerousAction('timeline', 'rollback_block')).toBe(true);
    });

    it('creates a global node and returns its stable tag', async () => {
        const client = snapshotClient({ tagged: false });
        const result = await createTimelineNode(client, { name: 'release', scope: 'global' });

        expect(result.node).toMatchObject({
            name: 'release',
            scope: 'global',
            snapshotId: 'current-1',
            tag: GLOBAL_TAG,
        });
        expect(client.request).toHaveBeenCalledWith('/api/repo/tagSnapshot', {
            id: 'current-1',
            name: GLOBAL_TAG,
        });
    });

    it('deletes only the timeline tag and reports that the snapshot is retained', async () => {
        const client = snapshotClient();
        const result = await deleteTimelineNode(client, { tag: GLOBAL_TAG });

        expect(result).toMatchObject({ success: true, tag: GLOBAL_TAG, snapshotRetained: true });
        expect(client.request).toHaveBeenCalledWith('/api/repo/removeRepoTagSnapshot', { tag: GLOBAL_TAG });
        expect(client.request.mock.calls.map(([endpoint]: [string]) => endpoint)).not.toContain('/api/repo/removeSnapshot');
    });

    it('returns a paginated changed block and uses its opaque key for rollback', async () => {
        const client = snapshotClient();
        const comparison = await compareTimelineNode(client, {
            documentId: DOC_ID,
            tag: GLOBAL_TAG,
            page: 1,
            pageSize: 1,
        });

        expect(comparison.noChanges).toBe(false);
        expect(comparison.stats.changedBlocks).toBe(1);
        expect(comparison.changes[0]).toMatchObject({
            changeKey: 'added:none:added',
            status: 'added',
            rollbackable: true,
            current: { id: 'added', markdown: 'new' },
        });

        await expect(rollbackTimelineBlock(client, {
            documentId: DOC_ID,
            tag: GLOBAL_TAG,
            changeKey: comparison.changes[0].changeKey,
        })).resolves.toMatchObject({ success: true, status: 'added' });
        expect(client.request).toHaveBeenCalledWith('/api/block/deleteBlock', { id: 'added' });
    });

    it('requires rwd before either rollback action reaches snapshot APIs', async () => {
        const config = buildDefaultToolConfig().timeline;
        config.actions.rollback_document = true;
        config.actions.rollback_block = true;
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/query/sql') {
                    return [{ id: DOC_ID, root_id: DOC_ID, box: 'nb-1', path: `/${DOC_ID}.sy`, type: 'd' }];
                }
                return null;
            }),
        });
        const permMgr = createMockPermissionManager({ canDelete: () => false });
        permMgr.get = vi.fn(() => 'rw');

        const documentResult = parseResult(await callTimelineTool(
            client,
            { action: 'rollback_document', documentId: DOC_ID, tag: DOCUMENT_TAG },
            config,
            permMgr,
        )) as Record<string, unknown>;
        const blockResult = parseResult(await callTimelineTool(
            client,
            { action: 'rollback_block', documentId: DOC_ID, tag: DOCUMENT_TAG, changeKey: 'modified:a:a' },
            config,
            permMgr,
        )) as Record<string, unknown>;

        expect((documentResult.error as Record<string, unknown>).type).toBe('permission_denied');
        expect((blockResult.error as Record<string, unknown>).type).toBe('permission_denied');
        expect(client.request).not.toHaveBeenCalledWith('/api/repo/getRepoTagSnapshots', expect.anything());
    });
});
