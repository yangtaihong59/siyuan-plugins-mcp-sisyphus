import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDangerousAction } from '@/core/config';
import { callAvTool, listAvTools } from '@/tools/av';
import type { ToolResult } from '@/tools/internal/shared';

vi.mock('@/tools/internal/context', () => ({
    ensurePermissionForDocumentId: vi.fn(async () => ({
        context: { documentId: 'doc-1', notebook: 'nb-1', path: '/doc-1.sy' },
        denied: null,
    })),
    resolveDocumentContextById: vi.fn(async () => ({
        documentId: 'doc-1',
        notebook: 'nb-1',
        path: '/doc-1.sy',
    })),
    resolveResultItemContext: vi.fn(),
    createResultResolutionCache: vi.fn(() => ({ documentContextById: new Map(), notebookByPath: new Map() })),
    escapeSqlString: (value: string) => value.replace(/\0/g, '').replace(/'/g, "''"),
}));

vi.mock('@/api/av', () => ({
    getAttributeView: vi.fn(),
    renderAttributeView: vi.fn(),
    getAttributeViewKeys: vi.fn(),
    getAttributeViewFilterSort: vi.fn(),
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

vi.mock('@/api/block', () => ({
    appendBlock: vi.fn(),
    checkBlockExist: vi.fn(),
    getBlockDOM: vi.fn(),
}));

vi.mock('@/api/search', () => ({
    querySQL: vi.fn(),
}));

vi.mock('@/api/transaction', () => ({
    performTransactions: vi.fn(),
}));

describe('av tool', () => {
    const enabledActions = <T extends string>(...actions: T[]) => ({
        enabled: true,
        actions: Object.fromEntries(actions.map((action) => [action, true])) as Record<T, boolean>,
    });

    const client = {} as any;
    const permMgr = {
        reload: vi.fn(async () => undefined),
        canRead: vi.fn(() => true),
    } as any;

    beforeEach(async () => {
        const avApi = await import('@/api/av');
        const context = await import('@/tools/internal/context');
        const blockApi = await import('@/api/block');
        const searchApi = await import('@/api/search');
        const transactionApi = await import('@/api/transaction');

        vi.mocked(avApi.getAttributeView).mockReset();
        vi.mocked(avApi.renderAttributeView).mockReset();
        vi.mocked(avApi.getAttributeViewKeys).mockReset();
        vi.mocked(avApi.getAttributeViewFilterSort).mockReset();
        vi.mocked(avApi.searchAttributeView).mockReset();
        vi.mocked(avApi.getAttributeViewPrimaryKeyValues).mockReset();
        vi.mocked(avApi.addAttributeViewBlocks).mockReset();
        vi.mocked(avApi.batchSetAttributeViewBlockAttrs).mockReset();
        vi.mocked(avApi.setAttributeViewBlockAttr).mockReset();
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockReset();
        vi.mocked(avApi.duplicateAttributeViewBlock).mockReset();
        vi.mocked(avApi.spinBlockDOM).mockReset();
        vi.mocked(context.ensurePermissionForDocumentId).mockReset();
        vi.mocked(context.resolveResultItemContext).mockReset();
        vi.mocked(blockApi.appendBlock).mockReset();
        vi.mocked(blockApi.checkBlockExist).mockReset();
        vi.mocked(blockApi.getBlockDOM).mockReset();
        vi.mocked(searchApi.querySQL).mockReset();
        vi.mocked(transactionApi.performTransactions).mockReset();
        vi.mocked(context.ensurePermissionForDocumentId).mockResolvedValue({
            context: { documentId: 'doc-1', notebook: 'nb-1', path: '/doc-1.sy' },
            denied: null,
        } as { context: { documentId: string; notebook: string; path: string }; denied: ToolResult | null });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
        vi.mocked(blockApi.appendBlock).mockResolvedValue({
            doOperations: [{ action: 'append', id: 'av-block-new', parentID: 'target-doc' }],
            undoOperations: [{ action: 'delete', id: 'av-block-new' }],
        } as never);
        vi.mocked(blockApi.checkBlockExist).mockResolvedValue(true);
        vi.mocked(searchApi.querySQL).mockResolvedValue([]);
        vi.mocked(avApi.spinBlockDOM).mockImplementation(async (_clientArg, dom) => ({ dom: `<div data-spun="1">${dom}</div>` }));
        vi.mocked(blockApi.getBlockDOM).mockImplementation(async (_clientArg, id) => ({
            id,
            dom: typeof id === 'string' && id.startsWith('db-block')
                ? '<div data-type="NodeAttributeView" data-av-id="av-1" class="av"></div>'
                : typeof id === 'string' && id === 'av-block-new'
                    ? '<div data-type="NodeAttributeView" data-av-id="av-new" class="av"></div>'
                    : '<div class="p"></div>',
        }));
        vi.mocked(transactionApi.performTransactions).mockResolvedValue([{
            doOperations: [{ action: 'insert', id: 'block-copy', previousID: 'prev-1' }],
            undoOperations: [{ action: 'delete', id: 'block-copy' }],
        }]);

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
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({
            id: 'av-1',
            viewID: 'view-1',
            viewType: 'table',
            rows: [],
        });
        vi.mocked(avApi.getAttributeViewKeys).mockResolvedValue([{ id: 'k1', name: 'Title' }]);
        vi.mocked(avApi.getAttributeViewPrimaryKeyValues).mockResolvedValue({
            name: 'AV',
            blockIDs: [],
            rows: { values: [] },
        });
        vi.mocked(avApi.getAttributeViewFilterSort).mockResolvedValue({
            filters: [{ field: 'status' }],
            sorts: [{ field: 'updated' }],
        });

        // Reset client.request so applyUiRefresh is skipped by default in AV tests
        client.request = undefined;
    });

    it('exports set_cells cells with nested array item schemas intact', () => {
        const [tool] = listAvTools(enabledActions('set_cells'));
        const setCellsSchema = (tool.inputSchema['x-sisyphus-actionSchemas'] as Array<{ properties?: Record<string, any> }>)
            .find((schema) => schema.properties?.action?.const === 'set_cells');
        const properties = setCellsSchema?.properties;

        expect(properties?.cells?.items?.properties?.options?.items).toEqual({ type: 'string' });
        expect(properties?.cells?.items?.properties?.assets?.items?.properties?.content?.type).toBe('string');
    });

    it('publishes complete-list options and bounded row-copy schemas', () => {
        const [tool] = listAvTools(enabledActions('set_column_options', 'duplicate_rows'));
        const schemas = tool.inputSchema['x-sisyphus-actionSchemas'] as Array<{ properties?: Record<string, any> }>;
        const options = schemas.find((schema) => schema.properties?.action?.const === 'set_column_options')?.properties;
        const duplicateRows = schemas.find((schema) => schema.properties?.action?.const === 'duplicate_rows')?.properties;

        expect(options?.options?.type).toBe('array');
        expect(options?.options?.items?.additionalProperties).toBe(false);
        expect(duplicateRows?.sourceRowIDs?.items?.type).toBe('string');
        expect(duplicateRows?.previousID?.type).toBe('string');
        expect(isDangerousAction('av', 'set_column_options')).toBe(true);
        expect(isDangerousAction('av', 'duplicate_rows')).toBe(true);
    });

    it('replaces select options with native update plus intentional removals and exact readback', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const before = {
            id: 'av-1',
            keyValues: [
                { key: { id: 'title', type: 'block' }, values: [{ id: 'value-title', blockID: 'row-1', block: { id: 'block-1', content: 'Row' } }] },
                { key: { id: 'status', type: 'select', options: [{ name: 'Old', color: '1', desc: '' }, { name: 'Keep', color: '2', desc: 'old description' }] }, values: [{ id: 'value-status', blockID: 'row-1', mSelect: [{ content: 'Keep', color: '2' }] }] },
            ],
            views: [{ id: 'view-1', itemIDs: ['row-1'], groups: [] }],
        };
        const after = structuredClone(before);
        ((after.keyValues[1] as any).key.options) = [{ name: 'Keep', color: '3', desc: 'new description' }, { name: 'New', color: '4', desc: '' }];
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: before }).mockResolvedValueOnce({ av: after });

        const result = await callAvTool(client, {
            action: 'set_column_options',
            avID: 'av-1',
            keyID: 'status',
            options: [
                { name: 'Keep', color: '3', desc: 'new description' },
                { name: 'New', color: '4' },
            ],
        }, enabledActions('set_column_options'), permMgr);

        const operations = vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations;
        expect(operations[0]).toMatchObject({ action: 'updateAttrViewColOptions', avID: 'av-1', id: 'status', data: [{ name: 'Keep', color: '3', desc: 'new description' }, { name: 'New', color: '4' }] });
        expect(operations[1]).toMatchObject({ action: 'removeAttrViewColOption', avID: 'av-1', id: 'status', data: 'Old' });
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true,
            action: 'set_column_options',
            status: 'applied',
            observedOptions: [{ name: 'Keep', color: '3', desc: 'new description' }, { name: 'New', color: '4', desc: '' }],
        });
    });

    it('reports append-order option readback as intermediate without a second write', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const before = {
            id: 'av-1',
            keyValues: [
                { key: { id: 'title', type: 'block' }, values: [{ id: 'value-title', blockID: 'row-1', block: { id: 'block-1', content: 'Row' } }] },
                { key: { id: 'status', type: 'select', options: [{ name: 'Old', color: '1', desc: '' }] }, values: [] },
            ],
            views: [{ id: 'view-1', itemIDs: ['row-1'], groups: [] }],
        };
        const after = structuredClone(before);
        ((after.keyValues[1] as any).key.options) = [{ name: 'Old', color: '1', desc: '' }, { name: 'New', color: '2', desc: '' }];
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: before }).mockResolvedValueOnce({ av: after });

        const result = await callAvTool(client, {
            action: 'set_column_options', avID: 'av-1', keyID: 'status',
            options: [{ name: 'New', color: '2' }, { name: 'Old', color: '1' }],
        }, enabledActions('set_column_options'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true,
            status: 'intermediate_option_order',
            observedOptions: [{ name: 'Old', color: '1', desc: '' }, { name: 'New', color: '2', desc: '' }],
        });
    });

    it('copies only a persistent bound row and verifies detached copy placement', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const before = {
            id: 'av-1',
            keyValues: [
                { key: { id: 'title', type: 'block' }, values: [{ id: 'value-title', blockID: 'row-1', block: { id: 'block-1', content: 'Bound Row' } }] },
                { key: { id: 'note', type: 'text' }, values: [{ id: 'value-note', blockID: 'row-1', text: { content: 'copied note' } }] },
            ],
            views: [{ id: 'view-1', itemIDs: ['row-1'], groups: [] }],
        };
        let copiedRowID = '';
        vi.mocked(avApi.getAttributeView).mockImplementation(async () => {
            if (!copiedRowID) return { av: before };
            const after = structuredClone(before);
            (after.keyValues[0] as any).values.push({ id: 'value-title-copy', blockID: copiedRowID, isDetached: true, block: { content: 'Bound Row' } });
            (after.keyValues[1] as any).values.push({ id: 'value-note-copy', blockID: copiedRowID, text: { content: 'copied note' } });
            (after.views[0] as any).itemIDs.push(copiedRowID);
            return { av: after };
        });
        vi.mocked(transactionApi.performTransactions).mockImplementation(async (_clientArg, transactions) => {
            copiedRowID = String((transactions[0].doOperations[0] as { id?: unknown }).id);
            return [] as never;
        });

        const result = await callAvTool(client, {
            action: 'duplicate_rows', avID: 'av-1', blockID: 'db-block-copy', sourceRowIDs: ['row-1'],
        }, enabledActions('duplicate_rows'), permMgr);

        const operations = vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations;
        expect(operations[0]).toMatchObject({ action: 'duplicateAttrViewRow', avID: 'av-1', srcIDs: ['row-1'], previousID: '' });
        const payload = JSON.parse(result.content[0].text);
        expect(payload).toMatchObject({ success: true, action: 'duplicate_rows', copied: 1 });
        expect(payload.rowIDs).toHaveLength(1);
    });

    it('rejects detached rows before duplicate_rows dispatch', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [{ key: { id: 'title', type: 'block' }, values: [{ id: 'value-title', blockID: 'row-detached', isDetached: true, block: { content: 'Detached' } }] }],
                views: [{ id: 'view-1', itemIDs: ['row-detached'] }],
            },
        });

        const result = await callAvTool(client, {
            action: 'duplicate_rows', avID: 'av-1', blockID: 'db-block-copy', sourceRowIDs: ['row-detached'],
        }, enabledActions('duplicate_rows'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: { action: 'duplicate_rows', type: 'validation_error', sourceRowID: 'row-detached' },
        });
    });

    it('publishes JSON types for render creation parameters', () => {
        const [tool] = listAvTools(enabledActions('render'));

        expect(tool.inputSchema.properties.createIfNotExist.type).toBe('boolean');
        expect(tool.inputSchema.properties.groupPaging.type).toBe('object');
        expect(tool.inputSchema.properties.page.type).toBe('integer');
    });

    it('maps typed set_cells input into the kernel value payload', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
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
        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'row-1',
            columnID: 'col-1',
            valueType: 'number',
            number: 12.5,
            numberFormat: 'CNY',
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toEqual({
            action: 'updateAttrViewCell',
            avID: 'av-1',
            keyID: 'col-1',
            rowID: 'row-1',
            data: {
                keyID: 'col-1',
                blockID: 'row-1',
                type: 'number',
                number: {
                    content: 12.5,
                    isNotEmpty: true,
                    format: 'CNY',
                    formattedContent: '',
                },
            },
        });

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'row-1',
            columnID: 'col-1',
            valueType: 'number',
        });
    });

    it('maps mAsset set_cells input into the kernel value payload', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
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
        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'row-1',
            columnID: 'col-cover',
            valueType: 'mAsset',
            assets: [
                { type: 'image', content: 'assets/cover.png' },
                { type: 'file', content: 'assets/spec.pdf', name: '规格书' },
            ],
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toEqual({
            action: 'updateAttrViewCell',
            avID: 'av-1',
            keyID: 'col-cover',
            rowID: 'row-1',
            data: {
                keyID: 'col-cover',
                blockID: 'row-1',
                type: 'mAsset',
                text: {
                    content: '![](assets/cover.png)\n[规格书](assets/spec.pdf)',
                },
                mAsset: [
                    { type: 'image', name: '', content: 'assets/cover.png' },
                    { type: 'file', name: '规格书', content: 'assets/spec.pdf' },
                ],
            },
        });

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'row-1',
            columnID: 'col-cover',
            valueType: 'mAsset',
        });
    });

    it('maps mAsset set_cells input into the kernel value payload', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
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
        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            items: [{
                rowID: 'row-1',
                columnID: 'col-cover',
                valueType: 'mAsset',
                text: '![封面](assets/cover.png)',
                assets: [{ type: 'image', content: 'assets/cover.png', name: '封面' }],
            }],
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toEqual({
            action: 'updateAttrViewCell',
            avID: 'av-1',
            keyID: 'col-cover',
            rowID: 'row-1',
            data: {
                keyID: 'col-cover',
                blockID: 'row-1',
                type: 'mAsset',
                text: { content: '![封面](assets/cover.png)' },
                mAsset: [{ type: 'image', name: '封面', content: 'assets/cover.png' }],
            },
        });

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'set_cells',
            avID: 'av-1',
            updated: 1,
        });
    });

    it('rejects set_cells when rowID is a source block ID and suggests the row item ID', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [{ id: 'value-1', blockID: 'row-actual', block: { id: 'block-source' } }],
                    },
                ],
            },
        });

        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'block-source',
            columnID: 'col-1',
            valueType: 'text',
            text: '备注',
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(avApi.setAttributeViewBlockAttr)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toEqual({
            error: {
                type: 'validation_error',
                tool: 'av',
                action: 'set_cells',
                reason: 'row_id_required',
                message: 'rowID "block-source" is a source block ID in attribute view "av-1". Use the row item ID instead.',
                avID: 'av-1',
                rowID: 'block-source',
                detectedSourceBlockID: 'block-source',
                suggestedRowID: 'row-actual',
                hint: 'Use the row item ID stored in value.blockID, or the rowID returned by av(action="add_rows"). The source block ID lives in block.id and is not writable as rowID.',
            },
        });
    });

    it('rejects set_cells when rowID is a cell value ID and suggests the row item ID', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [{ id: 'value-1', blockID: 'row-actual', block: { id: 'block-source' } }],
                    },
                    {
                        key: { id: 'col-title', type: 'text' },
                        values: [{ id: 'value-title-1', blockID: 'row-actual', text: { content: '标题' } }],
                    },
                ],
            },
        });

        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'value-title-1',
            columnID: 'col-1',
            valueType: 'text',
            text: '备注',
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(avApi.setAttributeViewBlockAttr)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toEqual({
            error: {
                type: 'validation_error',
                tool: 'av',
                action: 'set_cells',
                reason: 'row_id_alias_detected',
                message: 'rowID "value-title-1" is a cell value ID in attribute view "av-1", not the database row item ID.',
                avID: 'av-1',
                rowID: 'value-title-1',
                detectedValueID: 'value-title-1',
                suggestedRowID: 'row-actual',
                hint: 'Use the AV row item ID stored in each value.blockID, or the rowID returned by av(action="add_rows"). Do not reuse value.id from set_cells responses as rowID.',
            },
        });
    });

    it('accepts set_cells for the second row when other columns are out of order', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [
                            { id: 'value-block-1', blockID: 'row-1', block: { id: 'block-1' } },
                            { id: 'value-block-2', blockID: 'row-2', block: { id: 'block-2' } },
                        ],
                    },
                    {
                        key: { id: 'col-title', type: 'text' },
                        values: [
                            { id: 'value-title-2', blockID: 'row-2', text: { content: '第二行' } },
                            { id: 'value-title-1', blockID: 'row-1', text: { content: '第一行' } },
                        ],
                    },
                ],
            },
        });
        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'row-2',
            columnID: 'col-note',
            valueType: 'text',
            text: '写到第二行',
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toEqual({
            action: 'updateAttrViewCell',
            avID: 'av-1',
            keyID: 'col-note',
            rowID: 'row-2',
            data: {
                keyID: 'col-note',
                blockID: 'row-2',
                type: 'text',
                text: {
                    content: '写到第二行',
                },
            },
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'row-2',
            columnID: 'col-note',
            valueType: 'text',
        });
    });

    it('uses explicit blockID permission context for set_cells while keeping row validation intact', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');
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
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-explicit',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-1" class="av"></div>',
        });
        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            blockID: 'db-block-explicit',
            rowID: 'row-1',
            columnID: 'col-1',
            valueType: 'text',
            text: 'hello',
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'db-block-explicit', 'write');
        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toEqual({
            action: 'updateAttrViewCell',
            avID: 'av-1',
            keyID: 'col-1',
            rowID: 'row-1',
            data: {
                keyID: 'col-1',
                blockID: 'row-1',
                type: 'text',
                text: { content: 'hello' },
            },
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'set_cells',
            avID: 'av-1',
            rowID: 'row-1',
            columnID: 'col-1',
            valueType: 'text',
        });
    });

    it('returns the AV payload for get', async () => {
        const result = await callAvTool(client, {
            action: 'get',
            id: 'av-1',
        }, enabledActions('get'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            id: 'av-1',
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [{ id: 'val-1', blockID: 'row-1', block: { id: 'block-1' } }],
                    },
                ],
            },
            resolvedRows: [
                { rowID: 'row-1', sourceBlockID: 'block-1', valueIDs: ['val-1'] },
            ],
        });
    });

    it('uses explicit blockID to resolve get permissions for an empty AV', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');

        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-empty',
                keyValues: [],
            },
        });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-empty',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-empty" class="av"></div>',
        });

        const result = await callAvTool(client, {
            action: 'get',
            id: 'av-empty',
            blockID: 'db-block-empty',
        }, enabledActions('get'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'db-block-empty', 'read');
        expect(JSON.parse(result.content[0].text)).toEqual({
            id: 'av-empty',
            av: {
                id: 'av-empty',
                keyValues: [],
            },
        });
    });

    it('auto-resolves get permissions for an empty AV from SQL database block matches', async () => {
        const avApi = await import('@/api/av');
        const searchApi = await import('@/api/search');
        const context = await import('@/tools/internal/context');

        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-empty',
                keyValues: [],
            },
        });
        vi.mocked(searchApi.querySQL).mockResolvedValue([{ id: 'db-block-empty' }]);

        const result = await callAvTool(client, {
            action: 'get',
            id: 'av-empty',
        }, enabledActions('get'), permMgr);

        expect(vi.mocked(searchApi.querySQL).mock.calls[0][1]).toContain("type = 'av'");
        expect(vi.mocked(searchApi.querySQL).mock.calls[0][1]).toContain('av-empty');
        expect(vi.mocked(context.resolveResultItemContext)).not.toHaveBeenCalled();
        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'db-block-empty', 'read');
        expect(JSON.parse(result.content[0].text)).toEqual({
            id: 'av-empty',
            av: {
                id: 'av-empty',
                keyValues: [],
            },
        });
    });

    it('resolves rows by canonical rowID even when column value order is misaligned', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-misaligned',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [
                            { id: 'value-block-1', blockID: 'row-1', block: { id: 'block-1' } },
                            { id: 'value-block-2', blockID: 'row-2', block: { id: 'block-2' } },
                        ],
                    },
                    {
                        key: { id: 'col-title', type: 'text' },
                        values: [
                            { id: 'value-title-2', blockID: 'row-2', text: { content: '第二行' } },
                            { id: 'value-title-1', blockID: 'row-1', text: { content: '第一行' } },
                        ],
                    },
                    {
                        key: { id: 'col-cover', type: 'text' },
                        values: [
                            { id: 'value-cover-1', blockID: 'row-1', text: { content: '封面1' } },
                        ],
                    },
                ],
            },
        });

        const result = await callAvTool(client, {
            action: 'get',
            id: 'av-misaligned',
        }, enabledActions('get'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            id: 'av-misaligned',
            av: {
                id: 'av-misaligned',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [
                            { id: 'value-block-1', blockID: 'row-1', block: { id: 'block-1' } },
                            { id: 'value-block-2', blockID: 'row-2', block: { id: 'block-2' } },
                        ],
                    },
                    {
                        key: { id: 'col-title', type: 'text' },
                        values: [
                            { id: 'value-title-2', blockID: 'row-2', text: { content: '第二行' } },
                            { id: 'value-title-1', blockID: 'row-1', text: { content: '第一行' } },
                        ],
                    },
                    {
                        key: { id: 'col-cover', type: 'text' },
                        values: [
                            { id: 'value-cover-1', blockID: 'row-1', text: { content: '封面1' } },
                        ],
                    },
                ],
            },
            resolvedRows: [
                { rowID: 'row-1', sourceBlockID: 'block-1', valueIDs: ['value-block-1', 'value-title-1', 'value-cover-1'] },
                { rowID: 'row-2', sourceBlockID: 'block-2', valueIDs: ['value-block-2', 'value-title-2'] },
            ],
        });
    });

    it('filters unreadable AV search results', async () => {
        const avApi = await import('@/api/av');
        const context = await import('@/tools/internal/context');

        vi.mocked(avApi.searchAttributeView).mockResolvedValue({
            results: [{ id: 'av-a' }, { id: 'av-b' }],
        });
        vi.mocked(context.resolveResultItemContext)
            .mockResolvedValueOnce({ notebook: 'allowed', path: '/a.sy', documentId: 'doc-a' })
            .mockResolvedValueOnce({ notebook: 'blocked', path: '/b.sy', documentId: 'doc-b' });
        permMgr.canRead = vi.fn((notebook: string) => notebook !== 'blocked');

        const result = await callAvTool(client, {
            action: 'search',
            keyword: 'crm',
        }, enabledActions('search'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            keyword: 'crm',
            searchScope: {
                kernel: 'attribute_view_name_or_kernel_candidates',
                fallback: 'primary_key_values',
            },
            results: [{ id: 'av-a', avID: 'av-a', renderArgs: { action: 'render', id: 'av-a' } }],
            unresolvedResults: [],
            rawResultCount: 2,
            filteredOutCount: 1,
            unresolvedCount: 0,
            permissionFilteredOutCount: 1,
            partial: true,
            reason: 'permission_filtered',
        });
    });

    it('reports unresolved AV search results separately from permission filtering', async () => {
        const avApi = await import('@/api/av');
        const context = await import('@/tools/internal/context');

        vi.mocked(avApi.searchAttributeView).mockResolvedValue({
            results: [{ id: 'av-a' }],
        });
        vi.mocked(context.resolveResultItemContext).mockResolvedValue(null);

        const result = await callAvTool(client, {
            action: 'search',
            keyword: '账本',
        }, enabledActions('search'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            keyword: '账本',
            searchScope: {
                kernel: 'attribute_view_name_or_kernel_candidates',
                fallback: 'primary_key_values',
            },
            results: [],
            unresolvedResults: [{ id: 'av-a' }],
            rawResultCount: 1,
            filteredOutCount: 1,
            unresolvedCount: 1,
            permissionFilteredOutCount: 0,
            partial: true,
            reason: 'context_unresolved',
            emptyReason: 'no_verified_results_unresolved_candidates_available',
            unresolvedHint: 'unresolvedResults contains kernel search candidates that matched, but MCP could not verify notebook context yet.',
            warning: 'No verified AV matches were found. AV search primarily covers database names and primary-key values; non-primary-key cell text may not be searchable immediately after writes.',
        });
    });

    it('resolves AV search results by blockID when kernel results include database blocks', async () => {
        const avApi = await import('@/api/av');
        const context = await import('@/tools/internal/context');

        vi.mocked(avApi.searchAttributeView).mockResolvedValue({
            results: [{ avID: 'av-a', avName: '测试', blockID: 'db-block-1' }],
        });
        vi.mocked(context.resolveResultItemContext).mockResolvedValue({
            notebook: 'allowed',
            path: '/a.sy',
            documentId: 'doc-a',
        });

        const result = await callAvTool(client, {
            action: 'search',
            keyword: '测试',
        }, enabledActions('search'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            keyword: '测试',
            searchScope: {
                kernel: 'attribute_view_name_or_kernel_candidates',
                fallback: 'primary_key_values',
            },
            results: [{
                avID: 'av-a',
                id: 'av-a',
                avName: '测试',
                blockID: 'db-block-1',
                renderArgs: { action: 'render', id: 'av-a' },
            }],
            unresolvedResults: [],
            rawResultCount: 1,
            filteredOutCount: 0,
            unresolvedCount: 0,
            permissionFilteredOutCount: 0,
        });
    });

    it('falls back to primary key search when name search misses AV row content', async () => {
        const avApi = await import('@/api/av');
        const context = await import('@/tools/internal/context');
        client.request = vi.fn(async (endpoint: string) => {
            if (endpoint === '/api/file/readDir') {
                return [{ isDir: false, name: '20260407011715-lmkb6df.json' }];
            }
            throw new Error(`unexpected endpoint: ${endpoint}`);
        });
        vi.mocked(avApi.searchAttributeView).mockResolvedValue({ results: [] });
        vi.mocked(avApi.getAttributeViewPrimaryKeyValues).mockResolvedValue({
            name: '测试',
            blockIDs: ['row-block-1'],
            rows: { values: [{ id: 'row-1', blockID: 'item-1', block: { id: 'row-block-1', content: 'av row seed' } }] },
        });
        vi.mocked(context.resolveResultItemContext).mockResolvedValue({
            notebook: 'allowed',
            path: '/db.sy',
            documentId: 'doc-db',
        });

        const result = await callAvTool(client, {
            action: 'search',
            keyword: 'av row seed',
        }, enabledActions('search'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            keyword: 'av row seed',
            searchScope: {
                kernel: 'attribute_view_name_or_kernel_candidates',
                fallback: 'primary_key_values',
            },
            results: [{
                avID: '20260407011715-lmkb6df',
                id: '20260407011715-lmkb6df',
                avName: '测试',
                blockID: 'row-block-1',
                blockIDs: ['row-block-1'],
                renderArgs: { action: 'render', id: '20260407011715-lmkb6df' },
                rows: { values: [{ id: 'row-1', blockID: 'item-1', block: { id: 'row-block-1', content: 'av row seed' } }] },
                matchedRowCount: 1,
                matchSource: 'primary_key',
            }],
            unresolvedResults: [],
            rawResultCount: 1,
            filteredOutCount: 0,
            unresolvedCount: 0,
            permissionFilteredOutCount: 0,
        });
    });

    it('skips primary key fallback AVs when returned rows contain no matched values', async () => {
        const avApi = await import('@/api/av');
        client.request = vi.fn(async (endpoint: string) => {
            if (endpoint === '/api/file/readDir') {
                return [
                    { isDir: false, name: '20260407011715-lmkb6df.json' },
                    { isDir: false, name: '20260407011715-otherav.json' },
                ];
            }
            throw new Error(`unexpected endpoint: ${endpoint}`);
        });
        vi.mocked(avApi.searchAttributeView).mockResolvedValue({ results: [] });
        vi.mocked(avApi.getAttributeViewPrimaryKeyValues)
            .mockResolvedValueOnce({
                name: '测试',
                blockIDs: ['row-block-1'],
                rows: { values: [{ id: 'row-1', blockID: 'item-1', block: { id: 'row-block-1', content: 'av row seed' } }] },
            })
            .mockResolvedValueOnce({
                name: '其他库',
                blockIDs: ['row-block-2'],
                rows: { values: [] },
            });

        const result = await callAvTool(client, {
            action: 'search',
            keyword: 'av row seed',
        }, enabledActions('search'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            keyword: 'av row seed',
            searchScope: {
                kernel: 'attribute_view_name_or_kernel_candidates',
                fallback: 'primary_key_values',
            },
            results: [],
            unresolvedResults: [{
                avID: '20260407011715-lmkb6df',
                avName: '测试',
                blockID: 'row-block-1',
                blockIDs: ['row-block-1'],
                rows: { values: [{ id: 'row-1', blockID: 'item-1', block: { id: 'row-block-1', content: 'av row seed' } }] },
                matchedRowCount: 1,
                matchSource: 'primary_key',
            }],
            rawResultCount: 1,
            filteredOutCount: 1,
            unresolvedCount: 1,
            permissionFilteredOutCount: 0,
            partial: true,
            reason: 'context_unresolved',
            emptyReason: 'no_verified_results_unresolved_candidates_available',
            unresolvedHint: 'unresolvedResults contains kernel search candidates that matched, but MCP could not verify notebook context yet.',
            warning: 'No verified AV matches were found. AV search primarily covers database names and primary-key values; non-primary-key cell text may not be searchable immediately after writes.',
        });
    });

    it('falls back to database block refs when an AV has no rows yet', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-empty',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [],
                    },
                ],
            },
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({
            refDefs: [{ refID: 'db-block-1' }],
        });
        const result = await callAvTool(client, {
            action: 'add_column',
            avID: 'av-empty',
            keyID: 'col-1',
            keyName: '备注',
            keyType: 'text',
        }, enabledActions('add_column'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'addAttrViewCol',
            avID: 'av-empty',
            id: 'col-1',
            name: '备注',
            type: 'text',
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'add_column',
            avID: 'av-empty',
            keyID: 'col-1',
            keyName: '备注',
            keyType: 'text',
        });
    });

    it('uses explicit blockID permission context for add_column on an empty AV', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-empty',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [],
                    },
                ],
            },
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-explicit',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-empty" class="av"></div>',
        });
        const result = await callAvTool(client, {
            action: 'add_column',
            avID: 'av-empty',
            blockID: 'db-block-explicit',
            keyID: 'col-1',
            keyName: '备注',
            keyType: 'text',
        }, enabledActions('add_column'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'db-block-explicit', 'write');
        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'addAttrViewCol',
            avID: 'av-empty',
            id: 'col-1',
            name: '备注',
            type: 'text',
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'add_column',
            avID: 'av-empty',
            keyID: 'col-1',
            keyName: '备注',
            keyType: 'text',
        });
    });

    it('keeps unresolved permission scope errors for empty AV writes without blockID', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-empty',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [],
                    },
                ],
            },
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });

        const result = await callAvTool(client, {
            action: 'add_column',
            avID: 'av-empty',
            keyID: 'col-1',
            keyName: '备注',
            keyType: 'text',
        }, enabledActions('add_column'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: {
                type: 'internal_error',
                tool: 'av',
                action: 'add_column',
                message: 'Unable to resolve notebook permission scope for attribute view "av-empty". The database may have no rows yet; AV writes require a resolvable owning block context.',
            },
        });
    });

    it('auto-generates keyID for add_column when omitted', async () => {
        const transactionApi = await import('@/api/transaction');

        const result = await callAvTool(client, {
            action: 'add_column',
            avID: 'av-1',
            keyName: '日期',
            keyType: 'date',
        }, enabledActions('add_column'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'addAttrViewCol',
            avID: 'av-1',
            name: '日期',
            type: 'date',
            id: expect.stringMatching(/^\d{14}-[a-z0-9]{7}$/),
        });

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'add_column',
            avID: 'av-1',
            keyID: expect.stringMatching(/^\d{14}-[a-z0-9]{7}$/),
            keyName: '日期',
            keyType: 'date',
        });
    });

    it('accepts mAsset as an add_column keyType', async () => {
        const transactionApi = await import('@/api/transaction');

        const result = await callAvTool(client, {
            action: 'add_column',
            avID: 'av-1',
            keyID: 'col-asset-1',
            keyName: '封面',
            keyType: 'mAsset',
        }, enabledActions('add_column'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'addAttrViewCol',
            avID: 'av-1',
            id: 'col-asset-1',
            name: '封面',
            type: 'mAsset',
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'add_column',
            avID: 'av-1',
            keyID: 'col-asset-1',
            keyName: '封面',
            keyType: 'mAsset',
        });
    });

    it('accepts lineNumber as an add_column keyType', async () => {
        const transactionApi = await import('@/api/transaction');

        const result = await callAvTool(client, {
            action: 'add_column',
            avID: 'av-1',
            keyID: 'col-line-1',
            keyName: '行号',
            keyType: 'lineNumber',
        }, enabledActions('add_column'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'addAttrViewCol',
            avID: 'av-1',
            id: 'col-line-1',
            name: '行号',
            type: 'lineNumber',
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'add_column',
            avID: 'av-1',
            keyID: 'col-line-1',
            keyName: '行号',
            keyType: 'lineNumber',
        });
    });

    it('accepts columnID as an alias in remove_column', async () => {
        const transactionApi = await import('@/api/transaction');

        const result = await callAvTool(client, {
            action: 'remove_column',
            avID: 'av-1',
            columnID: 'col-alias-1',
        }, enabledActions('remove_column'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'removeAttrViewCol',
            avID: 'av-1',
            id: 'col-alias-1',
            removeDest: false,
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'remove_column',
            avID: 'av-1',
            keyID: 'col-alias-1',
            removeRelationDest: false,
        });
    });

    it('uses explicit blockID permission context for remove_column on an empty AV', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-empty',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [],
                    },
                ],
            },
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-explicit',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-empty" class="av"></div>',
        });
        const result = await callAvTool(client, {
            action: 'remove_column',
            avID: 'av-empty',
            blockID: 'db-block-explicit',
            keyID: 'col-1',
        }, enabledActions('remove_column'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'db-block-explicit', 'write');
        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'removeAttrViewCol',
            avID: 'av-empty',
            id: 'col-1',
            removeDest: false,
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'remove_column',
            avID: 'av-empty',
            keyID: 'col-1',
            removeRelationDest: false,
        });
    });

    it('rejects set_cells when explicit blockID does not belong to the AV', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [{ key: { type: 'block' }, values: [{ id: 'val-1', blockID: 'row-1', block: { id: 'block-1' } }] }],
            },
        });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-explicit',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-other" class="av"></div>',
        });

        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            blockID: 'db-block-explicit',
            rowID: 'row-1',
            columnID: 'col-1',
            valueType: 'text',
            text: 'hello',
        }, enabledActions('set_cells'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: {
                type: 'validation_error',
                action: 'set_cells',
                message: 'blockID "db-block-explicit" is not a database block for attribute view "av-1".',
            },
        });
        expect(vi.mocked(avApi.setAttributeViewBlockAttr)).not.toHaveBeenCalled();
    });

    it('rejects add_column when explicit blockID does not belong to the AV', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: { id: 'av-empty', keyValues: [{ key: { type: 'block' }, values: [] }] },
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-explicit',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-other" class="av"></div>',
        });

        const result = await callAvTool(client, {
            action: 'add_column',
            avID: 'av-empty',
            blockID: 'db-block-explicit',
            keyID: 'col-1',
            keyName: '备注',
            keyType: 'text',
        }, enabledActions('add_column'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: {
                type: 'validation_error',
                action: 'add_column',
            },
        });
        expect(vi.mocked(avApi.addAttributeViewKey)).not.toHaveBeenCalled();
    });

    it('rejects remove_rows when explicit blockID does not belong to the AV', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: { id: 'av-empty', keyValues: [{ key: { type: 'block' }, values: [] }] },
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-explicit',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-other" class="av"></div>',
        });

        const result = await callAvTool(client, {
            action: 'remove_rows',
            avID: 'av-empty',
            blockID: 'db-block-explicit',
            srcIDs: ['row-a'],
        }, enabledActions('remove_rows'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: {
                type: 'validation_error',
                action: 'remove_rows',
            },
        });
        expect(vi.mocked(avApi.removeAttributeViewBlocks)).not.toHaveBeenCalled();
    });

    it('rejects set_cells when explicit blockID does not belong to the AV', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [{ key: { type: 'block' }, values: [{ id: 'value-row-1', blockID: 'row-1', block: { id: 'block-1' } }] }],
            },
        });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-explicit',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-other" class="av"></div>',
        });

        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            blockID: 'db-block-explicit',
            items: [
                { rowID: 'row-1', columnID: 'col-text', valueType: 'text', text: '早餐' },
            ],
        }, enabledActions('set_cells'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: {
                type: 'validation_error',
                action: 'set_cells',
            },
        });
        expect(vi.mocked(avApi.batchSetAttributeViewBlockAttrs)).not.toHaveBeenCalled();
    });

    it('treats add_rows with an empty blockIDs list as a no-op success', async () => {
        const avApi = await import('@/api/av');

        const result = await callAvTool(client, {
            action: 'add_rows',
            avID: 'av-1',
            blockIDs: [],
        }, enabledActions('add_rows'), permMgr);

        expect(vi.mocked(avApi.addAttributeViewBlocks)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'add_rows',
            avID: 'av-1',
            blockIDs: [],
            primaryKeyTexts: [],
            rows: [],
            added: 0,
            skipped: true,
            message: 'No blockIDs or primaryKeyTexts were provided, so no rows were added.',
        });
    });

    it('adds rows when blockIDs are provided', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
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
                                { id: 'value-a', blockID: 'row-a', block: { id: 'block-a' } },
                                { id: 'value-b', blockID: 'row-b', block: { id: 'block-b' } },
                            ],
                        },
                    ],
                },
            });
        const result = await callAvTool(client, {
            action: 'add_rows',
            avID: 'av-1',
            blockIDs: ['block-a', 'block-b'],
            viewID: 'view-1',
        }, enabledActions('add_rows'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'insertAttrViewBlock',
            avID: 'av-1',
            blockID: 'block-1',
            viewID: 'view-1',
            groupID: undefined,
            previousID: undefined,
            ignoreDefaultFill: undefined,
            srcs: [
                { id: 'block-a', isDetached: false, itemID: expect.stringMatching(/^\d{14}-[a-z0-9]{7}$/) },
                { id: 'block-b', isDetached: false, itemID: expect.stringMatching(/^\d{14}-[a-z0-9]{7}$/) },
            ],
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'add_rows',
            avID: 'av-1',
            blockIDs: ['block-a', 'block-b'],
            rows: [
                { blockID: 'block-a', rowID: 'row-a' },
                { blockID: 'block-b', rowID: 'row-b' },
            ],
            added: 2,
        });
    });

    it('adds detached rows when primaryKeyTexts are provided', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        let addOperation: any;
        vi.mocked(transactionApi.performTransactions).mockImplementation(async (_clientArg, transactions) => {
            addOperation = transactions[0].doOperations[0];
            return null;
        });
        vi.mocked(avApi.getAttributeView).mockImplementation(async () => {
            const detachedSrc = addOperation?.srcs?.[0] as { itemID?: string; content?: string } | undefined;
            return {
                av: {
                    id: 'av-1',
                    keyValues: [
                        {
                            key: { type: 'block' },
                            values: detachedSrc ? [
                                {
                                    id: 'value-detached',
                                    blockID: detachedSrc.itemID,
                                    isDetached: true,
                                    block: { content: detachedSrc.content },
                                },
                            ] : [
                                { id: 'value-existing', blockID: 'row-existing', block: { id: 'block-existing' } },
                            ],
                        },
                    ],
                },
            };
        });

        const result = await callAvTool(client, {
            action: 'add_rows',
            avID: 'av-1',
            primaryKeyTexts: ['saaa'],
        }, enabledActions('add_rows'), permMgr);

        expect(addOperation).toEqual({
            action: 'insertAttrViewBlock',
            avID: 'av-1',
            blockID: 'block-existing',
            viewID: undefined,
            groupID: undefined,
            previousID: undefined,
            ignoreDefaultFill: undefined,
            srcs: [
                {
                    itemID: expect.stringMatching(/^\d{14}-[a-z0-9]{7}$/),
                    id: expect.stringMatching(/^\d{14}-[a-z0-9]{7}$/),
                    isDetached: true,
                    content: 'saaa',
                },
            ],
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'add_rows',
            avID: 'av-1',
            primaryKeyTexts: ['saaa'],
            rows: [{ primaryKeyText: 'saaa', rowID: (addOperation?.srcs[0] as { itemID: string }).itemID }],
            added: 1,
        });
    });

    it('polls until add_rows can resolve writable rowIDs', async () => {
        const avApi = await import('@/api/av');
        vi.useFakeTimers();
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
        vi.mocked(avApi.addAttributeViewBlocks).mockResolvedValue(null);

        try {
            const resultPromise = callAvTool(client, {
                action: 'add_rows',
                avID: 'av-1',
                blockIDs: ['block-new'],
            }, enabledActions('add_rows'), permMgr);

            await vi.advanceTimersByTimeAsync(500);
            const result = await resultPromise;

            expect(JSON.parse(result.content[0].text)).toEqual({
                success: true,
                action: 'add_rows',
                avID: 'av-1',
                blockIDs: ['block-new'],
                rows: [{ blockID: 'block-new', rowID: 'row-new' }],
                added: 1,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('fails add_rows when writable rowIDs do not appear before timeout', async () => {
        const avApi = await import('@/api/av');
        vi.useFakeTimers();
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
            });
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [{ id: 'value-existing', blockID: 'row-existing', block: { id: 'block-1' } }],
                    },
                ],
            },
        });
        vi.mocked(avApi.addAttributeViewBlocks).mockResolvedValue(null);

        try {
            const resultPromise = callAvTool(client, {
                action: 'add_rows',
                avID: 'av-1',
                blockIDs: ['block-missing'],
            }, enabledActions('add_rows'), permMgr);

            await vi.advanceTimersByTimeAsync(2500);
            const result = await resultPromise;

            expect(JSON.parse(result.content[0].text)).toEqual({
                error: {
                    type: 'api_error',
                    tool: 'av',
                    action: 'add_rows',
                    reason: 'row_id_sync_timeout',
                    message: 'Added rows to attribute view "av-1", but MCP could not observe writable row item IDs before the sync timeout expired.',
                    avID: 'av-1',
                    blockIDs: ['block-missing'],
                    rows: [{ blockID: 'block-missing', status: 'missing' }],
                    unresolvedBlockIDs: ['block-missing'],
                    hint: 'Retry av(action="add_rows") or wait briefly and re-read the database. Only call set_cells after add_rows returns rows[].rowID.',
                },
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('fails add_rows when a source block resolves to multiple rowIDs', async () => {
        const avApi = await import('@/api/av');
        vi.useFakeTimers();
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [
                            { id: 'value-1', blockID: 'row-a', block: { id: 'block-dup' } },
                            { id: 'value-2', blockID: 'row-b', block: { id: 'block-dup' } },
                        ],
                    },
                ],
            },
        });
        vi.mocked(avApi.addAttributeViewBlocks).mockResolvedValue(null);

        try {
            const resultPromise = callAvTool(client, {
                action: 'add_rows',
                avID: 'av-1',
                blockIDs: ['block-dup'],
            }, enabledActions('add_rows'), permMgr);

            await vi.advanceTimersByTimeAsync(2500);
            const result = await resultPromise;

            expect(JSON.parse(result.content[0].text)).toEqual({
                error: {
                    type: 'api_error',
                    tool: 'av',
                    action: 'add_rows',
                    reason: 'row_id_sync_timeout',
                    message: 'Added rows to attribute view "av-1", but MCP could not observe writable row item IDs before the sync timeout expired.',
                    avID: 'av-1',
                    blockIDs: ['block-dup'],
                    rows: [{ blockID: 'block-dup', rowIDs: ['row-a', 'row-b'], status: 'ambiguous' }],
                    unresolvedBlockIDs: ['block-dup'],
                    hint: 'Retry av(action="add_rows") or wait briefly and re-read the database. Only call set_cells after add_rows returns rows[].rowID.',
                },
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('removes rows by srcIDs', async () => {
        const transactionApi = await import('@/api/transaction');

        const result = await callAvTool(client, {
            action: 'remove_rows',
            avID: 'av-1',
            srcIDs: ['row-a', 'row-b'],
        }, enabledActions('remove_rows'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'removeAttrViewBlock',
            avID: 'av-1',
            srcIDs: ['row-a', 'row-b'],
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'remove_rows',
            avID: 'av-1',
            srcIDs: ['row-a', 'row-b'],
            removed: 2,
        });
    });

    it('uses explicit blockID permission context for remove_rows on an empty AV', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-empty',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [],
                    },
                ],
            },
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-explicit',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-empty" class="av"></div>',
        });
        const result = await callAvTool(client, {
            action: 'remove_rows',
            avID: 'av-empty',
            blockID: 'db-block-explicit',
            srcIDs: ['row-a'],
        }, enabledActions('remove_rows'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'db-block-explicit', 'write');
        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'removeAttrViewBlock',
            avID: 'av-empty',
            srcIDs: ['row-a'],
        });
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'remove_rows',
            avID: 'av-empty',
            srcIDs: ['row-a'],
            removed: 1,
        });
    });

    it('batch updates typed cells', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [
                            { id: 'value-row-1', blockID: 'row-1', block: { id: 'block-1' } },
                            { id: 'value-row-2', blockID: 'row-2', block: { id: 'block-2' } },
                        ],
                    },
                ],
            },
        });
        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            items: [
                { rowID: 'row-1', columnID: 'col-text', valueType: 'text', text: '早餐' },
                { rowID: 'row-2', columnID: 'col-check', valueType: 'checkbox', checked: true },
            ],
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: 'updateAttrViewCell',
                    avID: 'av-1',
                    keyID: 'col-text',
                    rowID: 'row-1',
                    data: {
                        keyID: 'col-text',
                        blockID: 'row-1',
                        type: 'text',
                        text: { content: '早餐' },
                    },
                }),
                expect.objectContaining({
                    action: 'updateAttrViewCell',
                    avID: 'av-1',
                    keyID: 'col-check',
                    rowID: 'row-2',
                    data: {
                        keyID: 'col-check',
                        blockID: 'row-2',
                        type: 'checkbox',
                        checkbox: { checked: true },
                    },
                }),
            ]),
        );
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'set_cells',
            avID: 'av-1',
            updated: 2,
        });
    });

    it('uses explicit blockID permission context for set_cells while keeping row validation intact', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [
                            { id: 'value-row-1', blockID: 'row-1', block: { id: 'block-1' } },
                            { id: 'value-row-2', blockID: 'row-2', block: { id: 'block-2' } },
                        ],
                    },
                ],
            },
        });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-explicit',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-1" class="av"></div>',
        });
        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            blockID: 'db-block-explicit',
            items: [
                { rowID: 'row-1', columnID: 'col-text', valueType: 'text', text: '早餐' },
                { rowID: 'row-2', columnID: 'col-check', valueType: 'checkbox', checked: true },
            ],
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'db-block-explicit', 'write');
        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: 'updateAttrViewCell',
                    avID: 'av-1',
                    keyID: 'col-text',
                    rowID: 'row-1',
                    data: {
                        keyID: 'col-text',
                        blockID: 'row-1',
                        type: 'text',
                        text: { content: '早餐' },
                    },
                }),
                expect.objectContaining({
                    action: 'updateAttrViewCell',
                    avID: 'av-1',
                    keyID: 'col-check',
                    rowID: 'row-2',
                    data: {
                        keyID: 'col-check',
                        blockID: 'row-2',
                        type: 'checkbox',
                        checkbox: { checked: true },
                    },
                }),
            ]),
        );
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            action: 'set_cells',
            avID: 'av-1',
            updated: 2,
        });
    });

    it('rejects set_cells when an item uses a source block ID', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    {
                        key: { type: 'block' },
                        values: [
                            { id: 'value-row-1', blockID: 'row-1', block: { id: 'block-1' } },
                            { id: 'value-row-2', blockID: 'row-2', block: { id: 'block-2' } },
                        ],
                    },
                ],
            },
        });

        const result = await callAvTool(client, {
            action: 'set_cells',
            avID: 'av-1',
            items: [
                { rowID: 'row-1', columnID: 'col-text', valueType: 'text', text: '早餐' },
                { rowID: 'block-2', columnID: 'col-check', valueType: 'checkbox', checked: true },
            ],
        }, enabledActions('set_cells'), permMgr);

        expect(vi.mocked(avApi.batchSetAttributeViewBlockAttrs)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toEqual({
            error: {
                type: 'validation_error',
                tool: 'av',
                action: 'set_cells',
                reason: 'row_id_required',
                message: 'rowID "block-2" is a source block ID in attribute view "av-1". Use the row item ID instead.',
                avID: 'av-1',
                rowID: 'block-2',
                detectedSourceBlockID: 'block-2',
                suggestedRowID: 'row-2',
                itemIndex: 1,
                hint: 'Use the row item ID stored in value.blockID, or the rowID returned by av(action="add_rows"). The source block ID lives in block.id and is not writable as rowID.',
            },
        });
    });

    it('duplicates a mirror database block using SiYuan frontend transaction semantics by default', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.duplicateAttributeViewBlock).mockResolvedValue({
            avID: 'av-copy',
            blockID: 'block-copy',
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (clientArg, avID) => ({
            refDefs: avID === 'av-copy' ? [{ refID: 'block-copy' }] : [],
        }));
        vi.mocked(avApi.getAttributeView)
            .mockResolvedValueOnce({
                av: {
                    id: 'av-1',
                    keyValues: [
                        {
                            key: { type: 'block' },
                            values: [{ id: 'value-1', blockID: 'row-1', block: { id: 'block-1' } }],
                        },
                    ],
                },
            })
            .mockResolvedValueOnce({
                av: {
                    id: 'av-copy',
                    keyValues: [],
                },
            });

        const result = await callAvTool(client, {
            action: 'duplicate',
            avID: 'av-1',
        }, enabledActions('duplicate'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(client, [{
            doOperations: [{
                action: 'insert',
                id: 'block-copy',
                data: '<div data-spun="1"><div class="av" data-node-id="block-copy" data-av-id="av-copy" data-type="NodeAttributeView" data-av-type="table"></div></div>',
                previousID: 'block-1',
            }],
            undoOperations: [{
                action: 'delete',
                id: 'block-copy',
            }],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            avID: 'av-copy',
            blockID: 'block-copy',
            action: 'duplicate',
            sourceAvID: 'av-1',
            prepared: true,
            materialized: true,
            insertedAfter: 'block-1',
            semantics: 'siyuan_duplicate_mirror',
        });
    });

    it('falls back to the mirrored source block as the insertion target', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.duplicateAttributeViewBlock).mockResolvedValue({
            avID: 'av-copy',
            blockID: 'block-copy',
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (clientArg, avID) => ({
            refDefs: avID === 'av-copy' ? [{ refID: 'block-copy' }] : [{ refID: 'mirror-block-1' }],
        }));
        vi.mocked(avApi.getAttributeView)
            .mockResolvedValueOnce({
                av: {
                    id: 'av-1',
                    keyValues: [],
                },
            })
            .mockResolvedValueOnce({
                av: {
                    id: 'av-copy',
                    keyValues: [],
                },
            });

        const result = await callAvTool(client, {
            action: 'duplicate',
            avID: 'av-1',
        }, enabledActions('duplicate'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(client, [{
            doOperations: [{
                action: 'insert',
                id: 'block-copy',
                data: '<div data-spun="1"><div class="av" data-node-id="block-copy" data-av-id="av-copy" data-type="NodeAttributeView" data-av-type="table"></div></div>',
                previousID: 'mirror-block-1',
            }],
            undoOperations: [{
                action: 'delete',
                id: 'block-copy',
            }],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            avID: 'av-copy',
            blockID: 'block-copy',
            action: 'duplicate',
            sourceAvID: 'av-1',
            prepared: true,
            materialized: true,
            insertedAfter: 'mirror-block-1',
            semantics: 'siyuan_duplicate_mirror',
        });
    });

    it('uses explicit blockID to duplicate an empty AV and insert after that database block', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');

        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-empty',
                keyValues: [],
            },
        });
        vi.mocked(avApi.duplicateAttributeViewBlock).mockResolvedValue({
            avID: 'av-copy',
            blockID: 'block-copy',
        });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-empty',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-empty" class="av"></div>',
        });

        const result = await callAvTool(client, {
            action: 'duplicate',
            avID: 'av-empty',
            blockID: 'db-block-empty',
        }, enabledActions('duplicate'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'db-block-empty', 'write');
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(client, [{
            doOperations: [{
                action: 'insert',
                id: 'block-copy',
                data: '<div data-spun="1"><div class="av" data-node-id="block-copy" data-av-id="av-copy" data-type="NodeAttributeView" data-av-type="table"></div></div>',
                previousID: 'db-block-empty',
            }],
            undoOperations: [{
                action: 'delete',
                id: 'block-copy',
            }],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            avID: 'av-copy',
            blockID: 'block-copy',
            action: 'duplicate',
            sourceAvID: 'av-empty',
            prepared: true,
            materialized: true,
            insertedAfter: 'db-block-empty',
            semantics: 'siyuan_duplicate_mirror',
        });
    });

    it('auto-resolves duplicate insertion for an empty AV from SQL database block matches', async () => {
        const avApi = await import('@/api/av');
        const searchApi = await import('@/api/search');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');

        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-empty',
                keyValues: [],
            },
        });
        vi.mocked(searchApi.querySQL).mockResolvedValue([{ id: 'db-block-empty' }]);
        vi.mocked(avApi.duplicateAttributeViewBlock).mockResolvedValue({
            avID: 'av-copy',
            blockID: 'block-copy',
        });

        const result = await callAvTool(client, {
            action: 'duplicate',
            avID: 'av-empty',
        }, enabledActions('duplicate'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'db-block-empty', 'write');
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(client, [{
            doOperations: [{
                action: 'insert',
                id: 'block-copy',
                data: '<div data-spun="1"><div class="av" data-node-id="block-copy" data-av-id="av-copy" data-type="NodeAttributeView" data-av-type="table"></div></div>',
                previousID: 'db-block-empty',
            }],
            undoOperations: [{
                action: 'delete',
                id: 'block-copy',
            }],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            avID: 'av-copy',
            blockID: 'block-copy',
            action: 'duplicate',
            sourceAvID: 'av-empty',
            prepared: true,
            materialized: true,
            insertedAfter: 'db-block-empty',
            semantics: 'siyuan_duplicate_mirror',
        });
    });

    it('uses unspun AV DOM when spinBlockDOM is unavailable', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.duplicateAttributeViewBlock).mockResolvedValue({
            avID: 'av-copy',
            blockID: 'block-copy',
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (clientArg, avID) => ({
            refDefs: avID === 'av-copy' ? [{ refID: 'block-copy' }] : [],
        }));
        vi.mocked(avApi.getAttributeView)
            .mockResolvedValueOnce({
                av: {
                    id: 'av-1',
                    keyValues: [
                        {
                            key: { type: 'block' },
                            values: [{ id: 'value-1', blockID: 'row-1', block: { id: 'block-1' } }],
                        },
                    ],
                },
            })
            .mockResolvedValueOnce({
                av: {
                    id: 'av-copy',
                    keyValues: [],
                },
            });
        vi.mocked(avApi.spinBlockDOM).mockRejectedValue(new Error('not found'));

        const result = await callAvTool(client, {
            action: 'duplicate',
            avID: 'av-1',
        }, enabledActions('duplicate'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(client, [{
            doOperations: [{
                action: 'insert',
                id: 'block-copy',
                data: '<div class="av" data-node-id="block-copy" data-av-id="av-copy" data-type="NodeAttributeView" data-av-type="table"></div>',
                previousID: 'block-1',
            }],
            undoOperations: [{
                action: 'delete',
                id: 'block-copy',
            }],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            avID: 'av-copy',
            blockID: 'block-copy',
            action: 'duplicate',
            sourceAvID: 'av-1',
            prepared: true,
            materialized: true,
            insertedAfter: 'block-1',
            semantics: 'siyuan_duplicate_mirror',
        });
    });

    it('duplicates and inserts the mirror database block when previousID is provided', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.duplicateAttributeViewBlock).mockResolvedValue({
            avID: 'av-copy',
            blockID: 'block-copy',
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [{ refID: 'block-copy' }] });
        vi.mocked(avApi.getAttributeView)
            .mockResolvedValueOnce({
                av: {
                    id: 'av-1',
                    keyValues: [
                        {
                            key: { type: 'block' },
                            values: [{ id: 'value-1', blockID: 'row-1', block: { id: 'block-1' } }],
                        },
                    ],
                },
            })
            .mockResolvedValueOnce({
                av: {
                    id: 'av-copy',
                    keyValues: [],
                },
            });

        const result = await callAvTool(client, {
            action: 'duplicate',
            avID: 'av-1',
            previousID: 'prev-1',
        }, enabledActions('duplicate'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(client, [{
            doOperations: [{
                action: 'insert',
                id: 'block-copy',
                data: '<div data-spun="1"><div class="av" data-node-id="block-copy" data-av-id="av-copy" data-type="NodeAttributeView" data-av-type="table"></div></div>',
                previousID: 'prev-1',
            }],
            undoOperations: [{
                action: 'delete',
                id: 'block-copy',
            }],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            avID: 'av-copy',
            blockID: 'block-copy',
            action: 'duplicate',
            sourceAvID: 'av-1',
            prepared: true,
            materialized: true,
            insertedAfter: 'prev-1',
            semantics: 'siyuan_duplicate_mirror_with_override',
        });
    });

    it('fails duplicate when the insertion target cannot be resolved', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
        vi.mocked(avApi.getAttributeView)
            .mockResolvedValueOnce({
                av: {
                    id: 'av-1',
                    keyValues: [],
                },
            })
            .mockResolvedValueOnce({
                av: {
                    id: 'av-copy',
                    keyValues: [],
                },
            });

        const result = await callAvTool(client, {
            action: 'duplicate',
            avID: 'av-1',
        }, enabledActions('duplicate'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            error: {
                type: 'internal_error',
                tool: 'av',
                action: 'duplicate',
                message: 'Unable to resolve notebook permission scope for attribute view "av-1". The database may have no rows yet; AV writes require a resolvable owning block context.',
                hint: 'Matches SiYuan copy-as-mirror behavior: call the kernel duplicate API, spin the AV block DOM, then commit an insert transaction. previousID overrides the insertion target; otherwise MCP uses blockID or the resolved owning database block.',
            },
        });
        expect(vi.mocked(avApi.duplicateAttributeViewBlock)).not.toHaveBeenCalled();
    });

    it('returns filtered primary key values', async () => {
        const avApi = await import('@/api/av');
        const context = await import('@/tools/internal/context');
        vi.mocked(avApi.getAttributeViewPrimaryKeyValues).mockResolvedValue({
            name: '记账',
            blockIDs: ['block-a', 'block-b'],
            rows: [{ id: 'row-a' }, { id: 'row-b' }],
        });
        vi.mocked(context.resolveResultItemContext).mockImplementation(async (_client, item) => {
            const id = item && typeof item === 'object' && 'id' in item ? (item as { id?: string }).id : undefined;
            if (id === 'block-a') {
                return { notebook: 'allowed', path: '/a.sy', documentId: 'doc-a' };
            }
            if (id === 'block-b') {
                return { notebook: 'blocked', path: '/b.sy', documentId: 'doc-b' };
            }
            return { notebook: 'allowed', path: '/av.sy', documentId: 'doc-av' };
        });
        permMgr.canRead = vi.fn((notebook: string) => notebook !== 'blocked');

        const result = await callAvTool(client, {
            action: 'get_primary_key_values',
            avID: 'av-1',
        }, enabledActions('get_primary_key_values'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            avID: 'av-1',
            name: '记账',
            blockIDs: ['block-a'],
            rows: [{ id: 'row-a' }],
            filteredOutCount: 1,
            partial: true,
            reason: 'permission_filtered',
        });
    });

    it('renders an attribute view with optional context', async () => {
        const result = await callAvTool(client, {
            action: 'render',
            id: 'av-1',
            viewID: 'view-1',
            page: 2,
        }, enabledActions('render'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            data: [],
            total: 0,
            page: 2,
            pageSize: 1,
            pageCount: 1,
            hasNextPage: false,
            avID: 'av-1',
            id: 'av-1',
            viewID: 'view-1',
            viewType: 'table',
        });
    });

    it('accepts avID alias and adds a lightweight table view when render rows are parseable', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({
            id: 'av-1',
            viewID: 'view-1',
            viewType: 'table',
            keyValues: [
                { key: { id: 'col-title', name: 'Title', type: 'text' } },
            ],
            rows: [
                {
                    id: 'row-1',
                    values: [
                        { key: { id: 'col-title' }, content: 'Paper A' },
                    ],
                },
            ],
            rowCount: 1,
        });

        const result = await callAvTool(client, {
            action: 'render',
            avID: 'av-1',
        }, enabledActions('render'), permMgr);

        const parsed = JSON.parse(result.content[0].text);
        expect(result.isError).toBeUndefined();
        expect(vi.mocked(avApi.renderAttributeView)).toHaveBeenCalledWith(client, expect.objectContaining({ id: 'av-1' }));
        expect(parsed).toMatchObject({
            avID: 'av-1',
            id: 'av-1',
            table: {
                columns: [{ id: 'col-title', name: 'Title', type: 'text' }],
                rows: [{ id: 'row-1', cells: { 'col-title': 'Paper A' } }],
                rowCount: 1,
            },
        });
    });

    it('requires id when createIfNotExist is not enabled', async () => {
        const avApi = await import('@/api/av');
        const result = await callAvTool(client, {
            action: 'render',
            blockID: 'target-doc',
        }, enabledActions('render'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: {
                type: 'internal_error',
                tool: 'av',
                action: 'render',
                message: 'av(action="render") requires id unless createIfNotExist=true is provided.',
            },
        });
        expect(vi.mocked(avApi.renderAttributeView)).not.toHaveBeenCalled();
    });

    it('renders and initializes a new attribute view using blockID as permission context', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');

        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-new',
                keyValues: [],
            },
        });
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({
            id: 'av-new',
            viewID: 'view-new',
            viewType: 'table',
            columns: [{ name: '主键' }, { name: '单选' }],
            rows: [],
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async () => {
            const blockID = vi.mocked(transactionApi.performTransactions).mock.calls[0]?.[1]?.[0]?.doOperations?.[0]?.id;
            return { refDefs: typeof blockID === 'string' ? [{ refID: blockID }] : [] };
        });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'av-block-new',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-new" class="av"></div>',
        });

        const result = await callAvTool(client, {
            action: 'render',
            id: 'av-new',
            blockID: 'target-doc',
            createIfNotExist: true,
        }, enabledActions('render'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'target-doc', 'write');
        expect(vi.mocked(avApi.renderAttributeView)).toHaveBeenCalledWith(client, {
            id: 'av-new',
            blockID: 'target-doc',
            viewID: undefined,
            page: undefined,
            pageSize: undefined,
            query: undefined,
            groupPaging: undefined,
            createIfNotExist: true,
        });
        expect(vi.mocked(blockApi.appendBlock)).not.toHaveBeenCalled();
        const insertedBlockID = vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0].id;
        expect(insertedBlockID).toMatch(/^\d{14}-[a-z0-9]{7}$/);
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(client, [{
            doOperations: [{
                action: 'insert',
                id: insertedBlockID,
                data: `<div data-spun="1"><div class="av" data-node-id="${insertedBlockID}" data-av-id="av-new" data-type="NodeAttributeView" data-av-type="table"></div></div>`,
                parentID: 'target-doc',
            }],
            undoOperations: [{
                action: 'delete',
                id: insertedBlockID,
            }],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            data: [],
            total: 0,
            page: 1,
            pageSize: 1,
            pageCount: 1,
            hasNextPage: false,
            avID: 'av-new',
            id: 'av-new',
            viewID: 'view-new',
            viewType: 'table',
            columns: [{ name: '主键' }, { name: '单选' }],
            generatedAvID: false,
            materialized: true,
            blockID: insertedBlockID,
            parentID: 'target-doc',
            databaseBlockRegistrationVerified: true,
        });
    });

    it('auto-generates an avID and materializes the database block when creating without id', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');

        vi.mocked(avApi.renderAttributeView).mockImplementation(async (_clientArg, payload) => ({
            id: payload.id,
            viewID: 'view-new',
            viewType: 'table',
            columns: [{ name: '主键' }, { name: '单选' }],
            rows: [],
        }));
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async () => {
            const blockID = vi.mocked(transactionApi.performTransactions).mock.calls[0]?.[1]?.[0]?.doOperations?.[0]?.id;
            return { refDefs: typeof blockID === 'string' ? [{ refID: blockID }] : [] };
        });

        const result = await callAvTool(client, {
            action: 'render',
            blockID: 'target-doc',
            createIfNotExist: true,
        }, enabledActions('render'), permMgr);

        const renderPayload = vi.mocked(avApi.renderAttributeView).mock.calls[0][1];
        expect(renderPayload.id).toMatch(/^\d{14}-[a-z0-9]{7}$/);
        expect(renderPayload).toMatchObject({
            blockID: 'target-doc',
            createIfNotExist: true,
        });
        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'target-doc', 'write');
        expect(vi.mocked(blockApi.appendBlock)).not.toHaveBeenCalled();
        const insertedBlockID = vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0].id;
        expect(insertedBlockID).toMatch(/^\d{14}-[a-z0-9]{7}$/);
        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'insert',
            id: insertedBlockID,
            parentID: 'target-doc',
        });
        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0].data).toContain(`data-av-id="${renderPayload.id}"`);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            avID: renderPayload.id,
            id: renderPayload.id,
            generatedAvID: true,
            materialized: true,
            blockID: insertedBlockID,
            parentID: 'target-doc',
            databaseBlockRegistrationVerified: true,
            columns: [{ name: '主键' }, { name: '单选' }],
        });
    });

    it('initializes a missing attribute view using blockID as permission context', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const transactionApi = await import('@/api/transaction');

        vi.mocked(avApi.getAttributeView).mockRejectedValue(new Error('attribute view "av-missing" not found'));
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({
            id: 'av-missing',
            viewID: 'view-new',
            viewType: 'table',
            rows: [],
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async () => {
            const blockID = vi.mocked(transactionApi.performTransactions).mock.calls[0]?.[1]?.[0]?.doOperations?.[0]?.id;
            return { refDefs: typeof blockID === 'string' ? [{ refID: blockID }] : [] };
        });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'av-block-new',
            dom: '<div data-type="NodeAttributeView" data-av-id="av-missing" class="av"></div>',
        });

        const result = await callAvTool(client, {
            action: 'render',
            id: 'av-missing',
            blockID: 'target-doc',
            createIfNotExist: true,
        }, enabledActions('render'), permMgr);

        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'target-doc', 'write');
        expect(vi.mocked(avApi.renderAttributeView)).toHaveBeenCalled();
        const insertedBlockID = vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0].id;
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            avID: 'av-missing',
            id: 'av-missing',
            viewID: 'view-new',
            viewType: 'table',
            generatedAvID: false,
            materialized: true,
            blockID: insertedBlockID,
            parentID: 'target-doc',
            databaseBlockRegistrationVerified: true,
        });
    });

    it('returns AV creation info when the materialized block exists but mirror registration is not visible yet', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');

        vi.useFakeTimers();
        try {
            vi.mocked(avApi.getAttributeView).mockRejectedValue(new Error('attribute view "av-stuck" not found'));
            vi.mocked(avApi.renderAttributeView).mockResolvedValue({
                id: 'av-stuck',
                viewID: 'view-new',
                viewType: 'table',
                rows: [],
            });
            vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
            vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
                id: 'av-block-new',
                dom: '<div data-type="NodeAttributeView" data-av-id="av-stuck" class="av"></div>',
            });

            const pending = callAvTool(client, {
                action: 'render',
                id: 'av-stuck',
                blockID: 'target-doc',
                createIfNotExist: true,
            }, enabledActions('render'), permMgr);

            await vi.advanceTimersByTimeAsync(300 * 6);
            const result = await pending;

            expect(result.isError).toBeFalsy();
            expect(JSON.parse(result.content[0].text)).toMatchObject({
                avID: 'av-stuck',
                id: 'av-stuck',
                materialized: true,
                blockID: expect.stringMatching(/^\d{14}-[a-z0-9]{7}$/),
                parentID: 'target-doc',
                databaseBlockRegistrationVerified: false,
                warning: expect.stringMatching(/^Created attribute view "av-stuck" and materialized database block "\d{14}-[a-z0-9]{7}", but MCP could not verify mirror registration before the timeout\./),
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns permission denied when new AV creation blockID is unreadable', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const context = await import('@/tools/internal/context');
        const deniedResult: ToolResult = {
            isError: true,
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: {
                        type: 'permission_denied',
                        notebook: 'blocked',
                    },
                }),
            }],
        };

        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-new',
                keyValues: [],
            },
        });
        vi.mocked(context.ensurePermissionForDocumentId).mockResolvedValue({
            context: { documentId: 'doc-blocked', notebook: 'blocked', path: '/doc-blocked.sy' },
            denied: deniedResult,
        } as { context: { documentId: string; notebook: string; path: string }; denied: ToolResult | null });

        const result = await callAvTool(client, {
            action: 'render',
            id: 'av-new',
            blockID: 'blocked-doc',
            createIfNotExist: true,
        }, enabledActions('render'), permMgr);

        expect(result).toBe(deniedResult);
        expect(vi.mocked(context.ensurePermissionForDocumentId)).toHaveBeenCalledWith(client, permMgr, 'blocked-doc', 'write');
        expect(vi.mocked(avApi.renderAttributeView)).not.toHaveBeenCalled();
        expect(vi.mocked(blockApi.appendBlock)).not.toHaveBeenCalled();
    });

    it('requires blockID when createIfNotExist cannot resolve an AV permission scope', async () => {
        const avApi = await import('@/api/av');

        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-new',
                keyValues: [],
            },
        });

        const result = await callAvTool(client, {
            action: 'render',
            id: 'av-new',
            createIfNotExist: true,
        }, enabledActions('render'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: {
                type: 'internal_error',
                tool: 'av',
                action: 'render',
                message: 'Unable to create or render attribute view "av-new" because createIfNotExist=true requires blockID to resolve notebook permission scope.',
            },
        });
        expect(vi.mocked(avApi.renderAttributeView)).not.toHaveBeenCalled();
    });

    it('returns attribute view keys', async () => {
        const result = await callAvTool(client, {
            action: 'get_attribute_view_keys',
            id: 'av-1',
        }, enabledActions('get_attribute_view_keys'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            avID: 'av-1',
            keys: [{ id: 'k1', name: 'Title' }],
        });
    });

    it('falls back to av.keyValues when get_attribute_view_keys returns empty', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.getAttributeViewKeys).mockResolvedValue([]);
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [
                    { key: { id: 'k1', name: '主键', type: 'block' }, values: [{ id: 'value-1', blockID: 'row-1', block: { id: 'block-1' } }] },
                    { key: { id: 'k2', name: '状态', type: 'select' }, values: [] },
                ],
            },
        });

        const result = await callAvTool(client, {
            action: 'get_attribute_view_keys',
            id: 'av-1',
        }, enabledActions('get_attribute_view_keys'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            avID: 'av-1',
            keys: [
                { id: 'k1', name: '主键', type: 'block' },
                { id: 'k2', name: '状态', type: 'select' },
            ],
        });
    });

    it('returns attribute view filters and sorts', async () => {
        const avApi = await import('@/api/av');
        const result = await callAvTool(client, {
            action: 'get_attribute_view_filter_sort',
            id: 'av-1',
            blockID: 'block-av-1',
        }, enabledActions('get_attribute_view_filter_sort'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            avID: 'av-1',
            blockID: 'block-av-1',
            filters: [{ field: 'status' }],
            sorts: [{ field: 'updated' }],
        });
        expect(vi.mocked(avApi.getAttributeViewFilterSort)).toHaveBeenCalledWith(client, {
            id: 'av-1',
            blockID: 'block-av-1',
        });
    });

    it('passes an empty blockID for attribute view filters and sorts when omitted', async () => {
        const avApi = await import('@/api/av');
        const result = await callAvTool(client, {
            action: 'get_attribute_view_filter_sort',
            id: 'av-1',
        }, enabledActions('get_attribute_view_filter_sort'), permMgr);

        expect(result.isError).toBeUndefined();
        expect(vi.mocked(avApi.getAttributeViewFilterSort)).toHaveBeenCalledWith(client, {
            id: 'av-1',
            blockID: '',
        });
    });

    it('skips stale mirror block refs when resolving AV permissions', async () => {
        const avApi = await import('@/api/av');
        const context = await import('@/tools/internal/context');

        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-stale',
                keyValues: [{ key: { type: 'block' }, values: [] }],
            },
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({
            refDefs: [{ refID: 'missing-block' }, { refID: 'good-block' }],
        });
        vi.mocked(context.ensurePermissionForDocumentId)
            .mockRejectedValueOnce(new Error('SiYuan API error: -1 - 未找到 ID 为 [missing-block] 的内容块'))
            .mockResolvedValueOnce({
                context: { documentId: 'doc-good', notebook: 'nb-1', path: '/doc-good.sy' },
                denied: null,
            } as { context: { documentId: string; notebook: string; path: string }; denied: ToolResult | null });

        const result = await callAvTool(client, {
            action: 'get',
            id: 'av-stale',
        }, enabledActions('get'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            id: 'av-stale',
            av: {
                id: 'av-stale',
                keyValues: [{ key: { type: 'block' }, values: [] }],
            },
        });
    });

    it('skips a stale first-row block and falls back to mirror refs', async () => {
        const avApi = await import('@/api/av');
        const context = await import('@/tools/internal/context');

        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-row-stale',
                keyValues: [{ key: { type: 'block' }, values: [{ id: 'value-stale', blockID: 'row-stale', block: { id: 'missing-row-block' } }] }],
            },
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({
            refDefs: [{ refID: 'good-block' }],
        });
        vi.mocked(context.ensurePermissionForDocumentId)
            .mockRejectedValueOnce(new Error('SiYuan API error: -1 - 未找到 ID 为 [missing-row-block] 的内容块'))
            .mockResolvedValueOnce({
                context: { documentId: 'doc-good', notebook: 'nb-1', path: '/doc-good.sy' },
                denied: null,
            } as { context: { documentId: string; notebook: string; path: string }; denied: ToolResult | null });

        const result = await callAvTool(client, {
            action: 'get',
            id: 'av-row-stale',
        }, enabledActions('get'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            id: 'av-row-stale',
            av: {
                id: 'av-row-stale',
                keyValues: [{ key: { type: 'block' }, values: [{ id: 'value-stale', blockID: 'row-stale', block: { id: 'missing-row-block' } }] }],
            },
            resolvedRows: [
                { rowID: 'row-stale', sourceBlockID: 'missing-row-block', valueIDs: ['value-stale'] },
            ],
        });
    });
});
