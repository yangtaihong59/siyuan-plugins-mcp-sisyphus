import { beforeEach, describe, expect, it, vi } from 'vitest';

import { callAvTool } from '@/tools/av';
import { callBlockTool } from '@/tools/block';
import { callDocumentTool } from '@/tools/document';
import { callNotebookTool } from '@/tools/notebook';
import { callTagTool } from '@/tools/tag';



vi.mock('@/tools/internal/context', () => ({
    ensurePermissionForDocumentId: vi.fn(async (_client: unknown, _permMgr: unknown, id: string) => ({
        context: { documentId: id && id.startsWith('doc-') ? id : 'doc-1', notebook: 'nb-1', path: '/doc-1.sy' },
        denied: null,
    })),
    ensurePermissionForNotebook: vi.fn(async () => null),
    listChildDocumentsByPath: vi.fn(),
    resolveMoveTargetNotebook: vi.fn(),
    resolveNotebookForPath: vi.fn(),
    resolveDocumentContextById: vi.fn(async (_client: unknown, id: string) => ({
        documentId: id,
        notebook: 'nb-1',
        path: `/${id}.sy`,
    })),
    resolveResultItemContext: vi.fn(),
    createResultResolutionCache: vi.fn(() => ({ documentContextById: new Map(), notebookByPath: new Map() })),
    escapeSqlString: (value: string) => value.replace(/\0/g, '').replace(/'/g, "''"),
}));

vi.mock('@/api/block', () => ({
    appendBlock: vi.fn(),
    updateBlock: vi.fn(),
    checkBlockExist: vi.fn(),
    setBlockAttrs: vi.fn(),
}));

vi.mock('@/api/document', () => ({
    createDoc: vi.fn(),
}));

vi.mock('@/api/notebook', () => ({
    createNotebook: vi.fn(),
    setNotebookIcon: vi.fn(),
}));

vi.mock('@/api/tag', () => ({
    renameTag: vi.fn(),
}));

vi.mock('@/api/av', () => ({
    getAttributeView: vi.fn(),
    searchAttributeView: vi.fn(),
    addAttributeViewBlocks: vi.fn(),
    removeAttributeViewBlocks: vi.fn(),
    addAttributeViewKey: vi.fn(),
    removeAttributeViewKey: vi.fn(),
    setAttributeViewBlockAttr: vi.fn(),
    batchSetAttributeViewBlockAttrs: vi.fn(),
    duplicateAttributeViewBlock: vi.fn(),
    spinBlockDOM: vi.fn(),
    getMirrorDatabaseBlocks: vi.fn(),
    getAttributeViewPrimaryKeyValues: vi.fn(),
}));

vi.mock('@/api/search', () => ({
    querySQL: vi.fn(),
}));

vi.mock('@/api/transaction', () => ({
    performTransactions: vi.fn(),
}));

import { parseResult } from '../../helpers/parse-result';
import { withRequestSemantics } from '../../helpers/mock-client';

describe('UI refresh integration', () => {
    const client = withRequestSemantics({
        request: vi.fn(async () => null),
    } as any);

    const permMgr = {
        reload: vi.fn(async () => undefined),
        canRead: vi.fn(() => true),
        canWrite: vi.fn(() => true),
        canDelete: vi.fn(() => true),
        get: vi.fn(() => 'rwd'),
        set: vi.fn(async () => undefined),
    } as never;

    const blockConfig = {
        enabled: true,
        actions: {
            append: true,
            update: true,
        },
    } as const;

    const documentConfig = {
        enabled: true,
        actions: {
            create: true,
            set_attr: true,
        },
    } as const;

    const notebookConfig = {
        enabled: true,
        actions: {
            create: true,
            set_icon: true,
        },
    } as const;

    const tagConfig = {
        enabled: true,
        actions: {
            rename: true,
        },
    } as const;

    const avConfig = {
        enabled: true,
        actions: {
            add_rows: true,
            add_column: true,
            set_cells: true,
        },
    } as const;

    beforeEach(async () => {
        client.request = vi.fn(async () => null);
        const blockApi = await import('@/api/block');
        const documentApi = await import('@/api/document');
        const notebookApi = await import('@/api/notebook');
        const tagApi = await import('@/api/tag');
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const searchApi = await import('@/api/search');
        const context = await import('@/tools/internal/context');

        vi.mocked(blockApi.appendBlock).mockReset();
        vi.mocked(blockApi.updateBlock).mockReset();
        vi.mocked(blockApi.checkBlockExist).mockReset();
        vi.mocked(documentApi.createDoc).mockReset();
        vi.mocked(notebookApi.createNotebook).mockReset();
        vi.mocked(notebookApi.setNotebookIcon).mockReset();
        vi.mocked(tagApi.renameTag).mockReset();
        vi.mocked(avApi.getAttributeView).mockReset();
        vi.mocked(avApi.addAttributeViewBlocks).mockReset();
        vi.mocked(avApi.addAttributeViewKey).mockReset();
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockReset();
        vi.mocked(avApi.setAttributeViewBlockAttr).mockReset();
        vi.mocked(transactionApi.performTransactions).mockReset();
        vi.mocked(searchApi.querySQL).mockReset();
        vi.mocked(context.resolveDocumentContextById).mockReset();

        vi.mocked(blockApi.appendBlock).mockResolvedValue([{ doOperations: [{ id: 'block-new' }] }] as never);
        vi.mocked(blockApi.updateBlock).mockResolvedValue({ updated: '20260408010101' } as never);
        vi.mocked(documentApi.createDoc).mockResolvedValue('doc-new');
        vi.mocked(notebookApi.createNotebook).mockResolvedValue({ notebook: { id: 'nb-new', name: 'New Notebook' } } as never);
        vi.mocked(notebookApi.setNotebookIcon).mockResolvedValue(null as never);
        vi.mocked(tagApi.renameTag).mockResolvedValue(null);
        vi.mocked(avApi.addAttributeViewBlocks).mockResolvedValue(null);
        vi.mocked(avApi.addAttributeViewKey).mockResolvedValue(null);
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
        vi.mocked(searchApi.querySQL).mockResolvedValue([]);
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [{ id: 'val-1', blockID: 'row-1', block: { id: 'block-1' } }],
                    },
                ],
            },
        });
        vi.mocked(avApi.setAttributeViewBlockAttr).mockResolvedValue({ value: { type: 'text' } });
        vi.mocked(transactionApi.performTransactions).mockResolvedValue([]);
        vi.mocked(context.resolveDocumentContextById).mockImplementation(async (_client: unknown, id: string) => ({
            documentId: id && id.startsWith('doc-') ? id : 'doc-1',
            notebook: 'nb-1',
            path: '/doc-1.sy',
        }));
    });

    it('reloads protyle after block update', async () => {
        const result = await callBlockTool(client, {
            action: 'update',
            id: 'block-1',
            dataType: 'markdown',
            data: 'hello',
        }, blockConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadProtyle', id: 'doc-1' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
    });

    it('reloads protyle after block append', async () => {
        const result = await callBlockTool(client, {
            action: 'append',
            parentID: 'doc-1',
            dataType: 'markdown',
            data: 'hello',
        }, blockConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadProtyle', id: 'doc-1' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
    });

    it('keeps ui refresh metadata without a spurious multiline warning', async () => {
        const result = await callBlockTool(client, {
            action: 'update',
            id: 'block-1',
            dataType: 'markdown',
            data: 'line 1\nline 2',
        }, blockConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.warning).toBeUndefined();
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadProtyle', id: 'doc-1' }]);
    });

    it('keeps block update successful when refresh fails', async () => {
        client.request = vi.fn(async (endpoint: string) => {
            if (endpoint === '/api/ui/reloadProtyle') throw new Error('reload failed');
            return null;
        });

        const result = await callBlockTool(client, {
            action: 'update',
            id: 'block-1',
            dataType: 'markdown',
            data: 'hello',
        }, blockConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.success).toBe(true);
        expect(parsed.uiRefresh.partialFailure).toEqual([{ type: 'reloadProtyle', id: 'doc-1', message: 'reload failed' }]);
    });

    it('reloads icon UI after document set_attr icon', async () => {
        const result = await callDocumentTool(client, {
            action: 'set_attr',
            id: 'doc-1',
            attrs: { icon: '1f4d4' },
        }, documentConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadIcon' }, { type: 'reloadFiletree' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadIcon', {});
    });

    it('keeps document set_attr icon successful when icon refresh fails', async () => {
        client.request = vi.fn(async (endpoint: string) => {
            if (endpoint === '/api/ui/reloadIcon') throw new Error('icon reload failed');
            return null;
        });

        const result = await callDocumentTool(client, {
            action: 'set_attr',
            id: 'doc-1',
            attrs: { icon: '1f4d4' },
        }, documentConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.success).toBe(true);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadIcon' }, { type: 'reloadFiletree' }]);
        expect(parsed.uiRefresh.partialFailure).toEqual([{ type: 'reloadIcon', message: 'icon reload failed' }]);
    });

    it('reloads protyle and filetree after document create', async () => {
        const result = await callDocumentTool(client, {
            action: 'create',
            notebook: 'nb-1',
            path: '/Inbox/Test',
            markdown: '# Test',
        }, documentConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([
            { type: 'reloadProtyle', id: 'doc-new' },
            { type: 'reloadFiletree' },
        ]);
        expect(client.request).toHaveBeenNthCalledWith(1, '/api/ui/reloadProtyle', { id: 'doc-new' });
        expect(client.request).toHaveBeenNthCalledWith(2, '/api/ui/reloadFiletree', {});
    });

    it('reloads icon UI after document create with icon', async () => {
        const result = await callDocumentTool(client, {
            action: 'create',
            notebook: 'nb-1',
            path: '/Inbox/Test',
            markdown: '# Test',
            icon: '1f4d4',
        }, documentConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadIcon' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadIcon', {});
    });

    it('reloads filetree after notebook create', async () => {
        const result = await callNotebookTool(client, {
            action: 'create',
            name: 'New Notebook',
        }, notebookConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadFiletree' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadFiletree', {});
    });

    it('reloads icon UI after notebook create with icon', async () => {
        const result = await callNotebookTool(client, {
            action: 'create',
            name: 'New Notebook',
            icon: '1f4d4',
        }, notebookConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadIcon' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadIcon', {});
    });

    it('reloads icon UI after notebook set_icon', async () => {
        const result = await callNotebookTool(client, {
            action: 'set_icon',
            notebook: 'nb-1',
            icon: '1f4d4',
        }, notebookConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadIcon' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadIcon', {});
    });

    it('reloads tag UI after tag rename', async () => {
        const result = await callTagTool(client, {
            action: 'rename',
            oldLabel: 'old',
            newLabel: 'new',
        }, tagConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadTag' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadTag', {});
    });

    it('reloads protyle after av set_cells when the owning document can be resolved', async () => {
        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'row-1',
            columnID: 'col-1',
            valueType: 'text',
            text: 'hello',
        }, avConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadProtyle', id: 'doc-1' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
    });

    it('reloads protyle after av add_column when the owning document can be resolved', async () => {
        const result = await callAvTool(client, {
            action: 'add_column',
            avID: 'av-1',
            keyID: 'col-1',
            keyName: 'Status',
            keyType: 'text',
        }, avConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadProtyle', id: 'doc-1' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
    });

    it('reloads protyle after av add_rows when the owning document can be resolved', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.getAttributeView)
            .mockResolvedValueOnce({
                av: {
                    id: 'av-1',
                    keyValues: [
                        {
                            key: { type: 'block' },
                            values: [{ id: 'value-existing', blockID: 'row-existing', block: { id: 'block-1' } }],
                        },
                    ],
                },
            })
            .mockResolvedValueOnce({
                av: {
                    id: 'av-1',
                    keyValues: [
                        {
                            key: { type: 'block' },
                            values: [
                                { id: 'value-existing', blockID: 'row-existing', block: { id: 'block-1' } },
                                { id: 'value-new', blockID: 'row-new', block: { id: 'block-new' } },
                            ],
                        },
                    ],
                },
            });

        const result = await callAvTool(client, {
            action: 'add_rows',
            avID: 'av-1',
            blockIDs: ['block-new'],
        }, avConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadProtyle', id: 'doc-1' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
    });

    it('falls back to attribute-view refresh when the owning document cannot be resolved', async () => {
        const context = await import('@/tools/internal/context');
        vi.mocked(context.resolveDocumentContextById).mockRejectedValue(new Error('document context unavailable'));

        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'row-1',
            columnID: 'col-1',
            valueType: 'text',
            text: 'hello',
        }, avConfig as never, permMgr);

        const parsed = parseResult(result);
        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadAttributeView', id: 'av-1' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadAttributeView', { id: 'av-1' });
    });
});
