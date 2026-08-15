import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDangerousAction } from '@/core/config';
import { callAvTool, listAvTools } from '@/tools/av';
import { firstJsonDifferencePath, projectAvStateWithoutColumnOptions } from '@/tools/av/handlers';
import type { ToolResult } from '@/tools/internal/shared';

vi.mock('@/tools/internal/context', () => ({
    ensurePermissionForDocumentId: vi.fn(async () => ({
        context: { documentId: 'doc-1', notebook: 'nb-1', path: '/doc-1.sy' },
        denied: null,
    })),
    ensurePermissionForNotebook: vi.fn(async () => null),
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
    setAttributeViewFilters: vi.fn(),
    setAttributeViewSorts: vi.fn(),
    setAttributeViewGroup: vi.fn(),
    searchAttributeView: vi.fn(),
    addAttributeViewBlocks: vi.fn(),
    createAttributeViewItem: vi.fn(),
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
    getBlockAttrs: vi.fn(),
    getBlockDOM: vi.fn(),
}));

vi.mock('@/api/document', () => ({
    getHPathByID: vi.fn(),
}));

vi.mock('@/api/search', () => ({
    querySQL: vi.fn(),
}));

vi.mock('@/api/system', () => ({
    getCurrentTime: vi.fn(),
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
        const documentApi = await import('@/api/document');
        const searchApi = await import('@/api/search');
        const systemApi = await import('@/api/system');
        const transactionApi = await import('@/api/transaction');

        vi.mocked(avApi.getAttributeView).mockReset();
        vi.mocked(avApi.renderAttributeView).mockReset();
        vi.mocked(avApi.getAttributeViewKeys).mockReset();
        vi.mocked(avApi.getAttributeViewFilterSort).mockReset();
        vi.mocked(avApi.setAttributeViewFilters).mockReset();
        vi.mocked(avApi.setAttributeViewSorts).mockReset();
        vi.mocked(avApi.setAttributeViewGroup).mockReset();
        vi.mocked(avApi.searchAttributeView).mockReset();
        vi.mocked(avApi.getAttributeViewPrimaryKeyValues).mockReset();
        vi.mocked(avApi.addAttributeViewBlocks).mockReset();
        vi.mocked(avApi.createAttributeViewItem).mockReset();
        vi.mocked(avApi.batchSetAttributeViewBlockAttrs).mockReset();
        vi.mocked(avApi.setAttributeViewBlockAttr).mockReset();
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockReset();
        vi.mocked(avApi.duplicateAttributeViewBlock).mockReset();
        vi.mocked(avApi.spinBlockDOM).mockReset();
        vi.mocked(context.ensurePermissionForDocumentId).mockReset();
        vi.mocked(context.ensurePermissionForNotebook).mockReset();
        vi.mocked(context.resolveResultItemContext).mockReset();
        vi.mocked(blockApi.appendBlock).mockReset();
        vi.mocked(blockApi.checkBlockExist).mockReset();
        vi.mocked(blockApi.getBlockAttrs).mockReset();
        vi.mocked(blockApi.getBlockDOM).mockReset();
        vi.mocked(documentApi.getHPathByID).mockReset();
        vi.mocked(searchApi.querySQL).mockReset();
        vi.mocked(systemApi.getCurrentTime).mockReset();
        vi.mocked(transactionApi.performTransactions).mockReset();
        vi.mocked(context.ensurePermissionForDocumentId).mockResolvedValue({
            context: { documentId: 'doc-1', notebook: 'nb-1', path: '/doc-1.sy' },
            denied: null,
        } as { context: { documentId: string; notebook: string; path: string }; denied: ToolResult | null });
        vi.mocked(context.ensurePermissionForNotebook).mockResolvedValue(null);
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [] });
        vi.mocked(blockApi.appendBlock).mockResolvedValue({
            doOperations: [{ action: 'append', id: 'av-block-new', parentID: 'target-doc' }],
            undoOperations: [{ action: 'delete', id: 'av-block-new' }],
        } as never);
        vi.mocked(blockApi.checkBlockExist).mockResolvedValue(true);
        vi.mocked(blockApi.getBlockAttrs).mockResolvedValue({ 'custom-sy-av-view': 'view-1' });
        vi.mocked(documentApi.getHPathByID).mockResolvedValue('/Created document');
        vi.mocked(searchApi.querySQL).mockResolvedValue([]);
        vi.mocked(systemApi.getCurrentTime).mockResolvedValue(1_710_000_000_000);
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
                        key: { id: 'key-title', type: 'block' },
                        values: [{ id: 'val-1', blockID: 'row-1', block: { id: 'block-1' } }],
                    },
                    { key: { id: 'key-status', type: 'select' }, values: [] },
                ],
                views: [{
                    id: 'view-1', name: 'Main', type: 'table', filters: [], sorts: [],
                    table: { columns: [{ id: 'key-title', hidden: false }, { id: 'key-status', hidden: false }] },
                }],
            },
        });
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({
            id: 'av-1',
            viewID: 'view-1',
            viewType: 'table',
            view: {
                id: 'view-1',
                pageSize: 50,
                columns: [],
                rows: [],
                rowCount: 0,
            },
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

    it('returns a zero-dispatch no-op for an already exact retest4-shaped option postimage', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const avID = 'fixture-av-retest4';
        const primaryKeyID = 'fixture-primary-key';
        const targetKeyID = 'fixture-select-key';
        const desiredOptions = [
            { name: '待办', color: '1', desc: '目标模板触发' },
            { name: '进行中', color: '2', desc: '' },
        ];
        // This is the relevant v3.8 raw-definition shape from retest4, but
        // uses synthetic IDs so the regression does not preserve live data.
        const alreadyApplied = {
            spec: 7, id: avID, name: '', keyIDs: null, viewID: 'fixture-table-view',
            keyValues: [
                { key: { id: primaryKeyID, name: '主键', type: 'block', icon: '', desc: '', numberFormat: '', template: '' } },
                { key: { id: targetKeyID, name: '单选', type: 'select', icon: '', desc: '', numberFormat: '', template: '', options: desiredOptions } },
            ],
            views: [{
                id: 'fixture-table-view', icon: '', name: '表格', hideAttrViewName: false, desc: '',
                filters: [{ column: '', operator: '', value: null, combination: 'and' }], pageSize: 50, type: 'table',
                table: { spec: 0, id: 'fixture-table-layout', showIcon: true, wrapField: false, columns: [{ id: primaryKeyID, wrap: false, hidden: false, pin: false, width: '' }, { id: targetKeyID, wrap: false, hidden: false, pin: false, width: '' }], rowIds: null },
                groupCreated: 0, groupItemIds: null, groupFolded: false, groupHidden: 0, groupSort: 0,
            }],
        };
        vi.mocked(avApi.getAttributeView).mockResolvedValue({ av: alreadyApplied });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [{ refID: 'fixture-db-block' }] });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'fixture-db-block', dom: `<div data-type="NodeAttributeView" data-av-id="${avID}" class="av"></div>`,
        });

        const result = await callAvTool(client, {
            action: 'set_column_options', avID, blockID: 'fixture-db-block', keyID: targetKeyID, options: desiredOptions,
        }, enabledActions('set_column_options'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true, action: 'set_column_options', changed: false, status: 'already_applied', observedOptions: desiredOptions,
        });
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

    it('does not certify a matching postimage after an option transaction response is lost', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const before = {
            id: 'av-1',
            keyValues: [
                { key: { id: 'title', type: 'block' }, values: [] },
                { key: { id: 'status', type: 'select', options: [{ name: 'Old', color: '1', desc: '' }] }, values: [] },
            ],
        };
        const observedPostimage = structuredClone(before);
        ((observedPostimage.keyValues[1] as any).key.options) = [{ name: 'New', color: '2', desc: '' }];
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: before }).mockResolvedValueOnce({ av: observedPostimage });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: 'db-block-options', dom: '<div data-type="NodeAttributeView" data-av-id="av-1" class="av"></div>',
        });
        vi.mocked(transactionApi.performTransactions).mockRejectedValue(new Error('transport response lost'));

        const result = await callAvTool(client, {
            action: 'set_column_options', avID: 'av-1', blockID: 'db-block-options', keyID: 'status', options: [{ name: 'New', color: '2' }],
        }, enabledActions('set_column_options'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
        // The handler must leave this exception for the strict coordinator,
        // which records outcome_unknown; a readback could predate the request.
        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: { type: 'internal_error', message: 'transport response lost' },
        });
        expect(vi.mocked(avApi.getAttributeView)).toHaveBeenCalledTimes(1);
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

    it('accepts v3.8 option replacement readback after target-key dependent normalization without replaying', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const before = {
            id: 'av-1', spec: 6,
            keyValues: [
                { key: { id: 'title', type: 'block' }, values: [{ id: 'value-title', blockID: 'row-1', block: { id: 'block-1', content: 'Row' } }] },
                { key: { id: 'status', type: 'select', options: [{ name: 'Old', color: '1', desc: '' }, { name: 'Keep', color: '2', desc: '' }] }, values: [{ id: 'value-status', blockID: 'row-1', mSelect: [{ content: 'Old', color: '1' }] }] },
                { key: { id: 'other', type: 'select', options: [{ name: 'Other', color: '3', desc: '' }] }, values: [] },
            ],
            newItemTemplates: [{ id: 'template-1', name: 'Target default', fieldValues: { status: { mode: 'static', value: { type: 'select', mSelect: [{ content: 'Old', color: '1' }] } } } }],
            views: [{
                id: 'view-1', itemIDs: ['row-1'], group: { field: 'status', method: 0 }, groups: [{ id: 'old-group' }],
                filters: [{ column: 'status', operator: '=', value: { type: 'select', mSelect: [{ content: 'Old', color: '1' }] } }],
                sorts: [{ column: 'other', order: 1 }],
            }],
        };
        const after = structuredClone(before);
        after.spec = 7;
        ((after.keyValues[1] as any).key.options) = [{ name: 'Keep', color: '4', desc: 'retained' }, { name: 'New', color: '5', desc: '' }];
        ((after.keyValues[1] as any).values) = [];
        ((after.newItemTemplates[0] as any).fieldValues) = undefined;
        ((after.views[0] as any).filters) = [{ combination: 'and' }];
        ((after.views[0] as any).groups) = [{ id: 'regenerated-group' }];
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: before }).mockResolvedValueOnce({ av: after });

        const result = await callAvTool(client, {
            action: 'set_column_options', avID: 'av-1', keyID: 'status',
            options: [{ name: 'Keep', color: '4', desc: 'retained' }, { name: 'New', color: '5' }],
        }, enabledActions('set_column_options'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({ success: true, status: 'applied' });
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
    });

    it('accepts the retest5 shape when SaveAttributeView materializes only a missing view icon', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        // v3.8 View.Icon has no omitempty JSON tag. This mirrors the saved
        // raw pre/post shape without retaining live IDs or content.
        const before = {
            spec: 7, id: 'av-retest5', name: '', keyIDs: null, viewID: 'view-1',
            keyValues: [
                { key: { id: 'title', type: 'block', icon: '', desc: '', numberFormat: '', template: '' }, values: [{ id: 'title-value', blockID: 'row-1', block: { id: 'source-1', content: 'Source', created: 1, updated: 1 }, createdAt: 1, updatedAt: 1 }] },
                { key: { id: 'status', type: 'select', icon: '', desc: '', numberFormat: '', template: '' } },
            ],
            views: [{
                id: 'view-1', name: 'Table', hideAttrViewName: false, desc: '',
                filters: [{ column: '', operator: '', value: null, combination: 'and' }], pageSize: 50, type: 'table',
                table: { spec: 0, id: 'layout-1', showIcon: true, wrapField: false, columns: [{ id: 'title', wrap: false, hidden: false, pin: false, width: '' }, { id: 'status', wrap: false, hidden: false, pin: false, width: '' }], rowIds: null },
                itemIds: ['row-1'], groupCreated: 0, groupItemIds: null, groupFolded: false, groupHidden: 0, groupSort: 0,
            }],
        };
        const after = structuredClone(before);
        ((after.keyValues[1] as any).key.options) = [
            { name: '待办', color: '1', desc: '目标派生' },
            { name: '进行中', color: '2', desc: '' },
        ];
        (after.views[0] as any).icon = '';
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: before }).mockResolvedValueOnce({ av: after });

        const result = await callAvTool(client, {
            action: 'set_column_options', avID: 'av-retest5', keyID: 'status',
            options: [{ name: '待办', color: '1', desc: '目标派生' }, { name: '进行中', color: '2' }],
        }, enabledActions('set_column_options'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({ success: true, status: 'applied' });
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
    });

    it('accepts the complete retest10 raw envelope when target options have a different JSON field position', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const avID = 'fixture-av-retest10';
        const carrierID = 'fixture-db-block-retest10';
        const primaryKeyID = 'fixture-primary-key-retest10';
        const targetKeyID = 'fixture-select-key-retest10';
        const desiredOptions = [
            { name: '待办', color: '1', desc: 'raw evidence' },
            { name: '进行中', color: '2', desc: '' },
        ];
        // This is the full retained retest10 getAttributeView shape with only
        // IDs kept synthetic. Go's save emits key.options before numberFormat,
        // whereas the preimage projection appends its sentinel after template.
        const before = {
            spec: 7, id: avID, name: '', keyIDs: null, viewID: 'fixture-table-view-retest10',
            keyValues: [
                { key: { id: primaryKeyID, name: '主键', type: 'block', icon: '', desc: '', numberFormat: '', template: '' } },
                { key: { id: targetKeyID, name: '单选', type: 'select', icon: '', desc: '', numberFormat: '', template: '' } },
            ],
            views: [{
                id: 'fixture-table-view-retest10', icon: '', name: '表格', hideAttrViewName: false, desc: '',
                filters: [{ column: '', operator: '', value: null, combination: 'and' }], pageSize: 50, type: 'table',
                table: { spec: 0, id: 'fixture-table-layout-retest10', showIcon: true, wrapField: false, columns: [{ id: primaryKeyID, wrap: false, hidden: false, pin: false, width: '' }, { id: targetKeyID, wrap: false, hidden: false, pin: false, width: '' }], rowIds: null },
                groupCreated: 0, groupItemIds: null, groupFolded: false, groupHidden: 0, groupSort: 0,
            }],
        };
        // Do not use structuredClone for this object: retest10's failure came
        // from the kernel inserting options before numberFormat in raw JSON.
        const after = {
            spec: 7, id: avID, name: '', keyIDs: null, viewID: 'fixture-table-view-retest10',
            keyValues: [
                { key: { id: primaryKeyID, name: '主键', type: 'block', icon: '', desc: '', numberFormat: '', template: '' } },
                { key: { id: targetKeyID, name: '单选', type: 'select', icon: '', desc: '', options: desiredOptions, numberFormat: '', template: '' } },
            ],
            views: [{
                id: 'fixture-table-view-retest10', icon: '', name: '表格', hideAttrViewName: false, desc: '',
                filters: [{ column: '', operator: '', value: null, combination: 'and' }], pageSize: 50, type: 'table',
                table: { spec: 0, id: 'fixture-table-layout-retest10', showIcon: true, wrapField: false, columns: [{ id: primaryKeyID, wrap: false, hidden: false, pin: false, width: '' }, { id: targetKeyID, wrap: false, hidden: false, pin: false, width: '' }], rowIds: null },
                groupCreated: 0, groupItemIds: null, groupFolded: false, groupHidden: 0, groupSort: 0,
            }],
        };
        const protectedBefore = projectAvStateWithoutColumnOptions(before, targetKeyID, []);
        const protectedAfter = projectAvStateWithoutColumnOptions(after, targetKeyID, []);
        // This was retest10's exact false-positive predicate: no semantic
        // difference remains, yet insertion order makes JSON.stringify differ.
        expect(firstJsonDifferencePath(protectedBefore, protectedAfter)).toBeUndefined();
        expect(JSON.stringify(protectedBefore)).not.toBe(JSON.stringify(protectedAfter));
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: before }).mockResolvedValueOnce({ av: after });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: carrierID, dom: `<div data-type="NodeAttributeView" data-av-id="${avID}" class="av"></div>`,
        });

        const result = await callAvTool(client, {
            action: 'set_column_options', avID, blockID: carrierID, keyID: targetKeyID, options: desiredOptions,
        }, enabledActions('set_column_options'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true, action: 'set_column_options', status: 'applied', observedOptions: desiredOptions,
        });
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
    });

    it('still rejects a non-empty view icon drift while replacing target options', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const before = {
            id: 'av-1',
            keyValues: [
                { key: { id: 'title', type: 'block' }, values: [] },
                { key: { id: 'status', type: 'select', options: [{ name: 'Old', color: '1', desc: '' }] }, values: [] },
            ],
            views: [{ id: 'view-1', name: 'Table', icon: '', itemIDs: [] }],
        };
        const after = structuredClone(before);
        ((after.keyValues[1] as any).key.options) = [{ name: 'New', color: '2', desc: '' }];
        (after.views[0] as any).icon = '1f4cc';
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: before }).mockResolvedValueOnce({ av: after });

        const result = await callAvTool(client, {
            action: 'set_column_options', avID: 'av-1', blockID: 'db-block-options', keyID: 'status', options: [{ name: 'New', color: '2' }],
        }, enabledActions('set_column_options'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: { type: 'internal_error', message: expect.stringContaining('Unrelated AV state changed') },
        });
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
    });

    it('accepts a v3.8 complete clear with omitted options and an empty AND filter root', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const before = {
            id: 'av-1',
            keyValues: [
                { key: { id: 'title', type: 'block' }, values: [{ id: 'value-title', blockID: 'row-1', block: { id: 'block-1', content: 'Row' } }] },
                { key: { id: 'status', type: 'select', options: [{ name: 'Old', color: '1', desc: '' }] }, values: [{ id: 'value-status', blockID: 'row-1', mSelect: [{ content: 'Old', color: '1' }] }] },
            ],
            views: [{ id: 'view-1', itemIDs: ['row-1'], filters: [{ column: 'status', operator: '=', value: { type: 'select', mSelect: [{ content: 'Old', color: '1' }] } }] }],
        };
        const after = structuredClone(before);
        delete (after.keyValues[1] as any).key.options;
        ((after.keyValues[1] as any).values) = [];
        ((after.views[0] as any).filters) = [{ combination: 'and' }];
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: before }).mockResolvedValueOnce({ av: after });

        const result = await callAvTool(client, {
            action: 'set_column_options', avID: 'av-1', keyID: 'status', options: [],
        }, enabledActions('set_column_options'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({ success: true, status: 'applied', optionCount: 0, observedOptions: [] });
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
    });

    it('still rejects unrelated key, template, and filter drift after target-key option normalization', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const before = {
            id: 'av-1',
            keyValues: [
                { key: { id: 'title', type: 'block' }, values: [{ id: 'value-title', blockID: 'row-1', block: { id: 'block-1', content: 'Row' } }] },
                { key: { id: 'status', type: 'select', options: [{ name: 'Old', color: '1', desc: '' }] }, values: [] },
                { key: { id: 'other', type: 'select', options: [{ name: 'Stable', color: '2', desc: '' }] }, values: [] },
            ],
            newItemTemplates: [{ id: 'template-1', name: 'Unrelated default', fieldValues: { other: { mode: 'static', value: { type: 'select', mSelect: [{ content: 'Stable', color: '2' }] } } } }],
            views: [{
                id: 'view-1', itemIDs: ['row-1'],
                filters: [{ column: 'other', operator: '=', value: { type: 'select', mSelect: [{ content: 'Stable', color: '2' }] } }],
            }],
        };
        const after = structuredClone(before);
        delete (after.keyValues[1] as any).key.options;
        ((after.keyValues[2] as any).key.options) = [{ name: 'Drifted', color: '2', desc: '' }];
        ((after.newItemTemplates[0] as any).fieldValues.other.value.mSelect[0].content) = 'Drifted';
        ((after.views[0] as any).filters[0].value.mSelect[0].content) = 'Drifted';
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: before }).mockResolvedValueOnce({ av: after });

        const result = await callAvTool(client, {
            action: 'set_column_options', avID: 'av-1', keyID: 'status', options: [],
        }, enabledActions('set_column_options'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: { type: 'internal_error', message: expect.stringContaining('Unrelated AV state changed') },
        });
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
    });

    it('diagnoses the saved ac9b468 live pre/post raw shape as a new bound row, not target option drift', () => {
        // These values are copied from the isolated FLO.W v3.8.0 raw
        // getAttributeView snapshots. Keep this fixture local: a repository
        // regression test must not depend on the private live-evidence path.
        const avID = '20260813030615-avview1';
        const primaryKeyID = '20260813030636-ppzghqp';
        const targetKeyID = '20260813030636-8vwj098';
        const rowID = '20260813030737-fr91sts';
        const before = {
            spec: 7, id: avID, name: '', keyIDs: null, viewID: '20260813030636-zza0o0m',
            keyValues: [
                { key: { id: primaryKeyID, name: '主键', type: 'block', icon: '', desc: '', numberFormat: '', template: '' } },
                { key: { id: targetKeyID, name: '单选', type: 'select', icon: '', desc: '', numberFormat: '', template: '' } },
            ],
            views: [{
                id: '20260813030636-zza0o0m', icon: '', name: '表格', hideAttrViewName: false, desc: '',
                filters: [{ column: '', operator: '', value: null, combination: 'and' }], pageSize: 50, type: 'table',
                table: { spec: 0, id: '20260813030636-yjqebdx', showIcon: true, wrapField: false, columns: [{ id: primaryKeyID, wrap: false, hidden: false, pin: false, width: '' }, { id: targetKeyID, wrap: false, hidden: false, pin: false, width: '' }], rowIds: null },
                groupCreated: 0, groupItemIds: null, groupFolded: false, groupHidden: 0, groupSort: 0,
            }],
        };
        const after = structuredClone(before);
        (after.keyValues[0] as any).values = [{
            id: '20260813030737-wzrib28', keyID: primaryKeyID, blockID: rowID, type: 'block',
            createdAt: 1786561657455, updatedAt: 1786561657455,
            block: { id: '20260813030613-19lt4ra', content: 'Disposable AV retest document.', created: 1786561657455, updated: 1786561657455 },
        }];
        (after.keyValues[1] as any).key.options = [
            { name: '待办', color: '1', desc: '目标模板触发' },
            { name: '进行中', color: '2', desc: '' },
        ];
        (after.views[0] as any).itemIds = [rowID];
        (after.views[0] as any).groupSort = null;

        expect(firstJsonDifferencePath(
            projectAvStateWithoutColumnOptions(before, targetKeyID, []),
            projectAvStateWithoutColumnOptions(after, targetKeyID, []),
        )).toBe('$.keyValues[0].values');
    });

    it('copies a persistent bound row from the raw getAttributeView itemIds shape', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const before = {
            id: 'av-1',
            keyValues: [
                { key: { id: 'title', type: 'block' }, values: [{ id: 'value-title', blockID: 'row-1', block: { id: 'block-1', content: 'Bound Row' } }] },
                { key: { id: 'note', type: 'text' }, values: [{ id: 'value-note', blockID: 'row-1', text: { content: 'copied note' } }] },
            ],
            // SiYuan raw getAttributeView uses itemIds, not itemIDs, for the
            // persistent top-level view membership that duplicate_rows must
            // validate before it submits a native copy transaction.
            views: [{ id: 'view-1', itemIds: ['row-1'], groups: [] }],
        };
        let copiedRowID = '';
        vi.mocked(avApi.getAttributeView).mockImplementation(async () => {
            if (!copiedRowID) return { av: before };
            const after = structuredClone(before);
            (after.keyValues[0] as any).values.push({ id: 'value-title-copy', blockID: copiedRowID, isDetached: true, block: { content: 'Bound Row' } });
            (after.keyValues[1] as any).values.push({ id: 'value-note-copy', blockID: copiedRowID, text: { content: 'copied note' } });
            (after.views[0] as any).itemIds.push(copiedRowID);
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

    it('publishes the native template, relation, and rollup action schemas', () => {
        const [tool] = listAvTools(enabledActions(
            'set_new_item_templates',
            'create_from_template',
            'configure_two_way_relation',
            'configure_rollup',
            'set_relation',
        ));
        const schemas = tool.inputSchema['x-sisyphus-actionSchemas'] as Array<{ properties?: Record<string, any> }>;
        for (const action of ['set_new_item_templates', 'create_from_template', 'configure_two_way_relation', 'configure_rollup', 'set_relation']) {
            expect(schemas.find((schema) => schema.properties?.action?.const === action)).toBeTruthy();
        }
        const relation = schemas.find((schema) => schema.properties?.action?.const === 'set_relation');
        expect(relation?.properties?.itemID.description).toContain('never the bound document block ID');
    });

    it('replaces the complete ordered native template configuration and reads it back', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const avID = '20260813000009-iiiiiii';
        const databaseBlockID = '20260813000010-jjjjjjj';
        const templateID = '20260813000000-aaaaaaa';
        const requestedTemplate = { id: templateID, name: 'Inbox', icon: '', targetType: 'detached' };
        const persistedTemplate = { id: templateID, name: 'Inbox', targetType: 'detached' };
        const source = {
            id: avID,
            keyValues: [{
                key: { type: 'block' },
                values: [{ id: 'value-block', blockID: '20260813000001-bbbbbbb', block: { id: 'bound-doc' } }],
            }],
            newItemTemplates: [],
            defaultTemplateID: '',
        };
        const after = { ...source, newItemTemplates: [persistedTemplate], defaultTemplateID: templateID };
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [{ refID: databaseBlockID }] });
        vi.mocked(avApi.getAttributeView)
            .mockResolvedValueOnce({ av: source })
            .mockResolvedValueOnce({ av: after });

        const result = await callAvTool(client, {
            action: 'set_new_item_templates',
            avID,
            blockID: databaseBlockID,
            templates: [requestedTemplate],
            defaultTemplateID: templateID,
        }, enabledActions('set_new_item_templates'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'setAttrViewNewItemTemplates',
            avID,
            blockID: databaseBlockID,
            data: { defaultTemplateID: templateID, templates: [persistedTemplate] },
        });
        const payload = JSON.parse(result.content[0].text);
        expect(payload).toMatchObject({
            success: true,
            action: 'set_new_item_templates',
            avID,
            defaultTemplateID: templateID,
        });
        expect(payload.templatePreimageHash).toMatch(/^sha256:v1:/);
        expect(payload.templatePostimageHash).toMatch(/^sha256:v1:/);
    });

    it('accepts a template field for a newly added v3.8 key whose empty values list is omitted', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const avID = '20260813000009-iiiiiii';
        const databaseBlockID = '20260813000010-jjjjjjj';
        const templateID = '20260813000000-aaaaaaa';
        const textKeyID = '20260813000002-ccccccc';
        const requestedTemplate = {
            id: templateID,
            name: 'Text default',
            targetType: 'detached',
            fieldValues: {
                [textKeyID]: {
                    mode: 'static',
                    value: { type: 'text', text: { content: 'template-default' } },
                },
            },
        };
        const source = {
            id: avID,
            keyValues: [
                { key: { id: '20260813000001-bbbbbbb', type: 'block' }, values: [{ blockID: 'row-1', block: { id: 'bound-doc' } }] },
                // Go KeyValues.Values is json:"values,omitempty". A just-added
                // text key therefore has metadata but no `values` property.
                { key: { id: textKeyID, type: 'text' } },
            ],
            newItemTemplates: [],
            defaultTemplateID: '',
        };
        const after = { ...source, newItemTemplates: [requestedTemplate], defaultTemplateID: templateID };
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [{ refID: databaseBlockID }] });
        vi.mocked(avApi.getAttributeView)
            .mockResolvedValueOnce({ av: source })
            .mockResolvedValueOnce({ av: after });

        const result = await callAvTool(client, {
            action: 'set_new_item_templates',
            avID,
            blockID: databaseBlockID,
            templates: [requestedTemplate],
            defaultTemplateID: templateID,
        }, enabledActions('set_new_item_templates'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true,
            action: 'set_new_item_templates',
            avID,
            defaultTemplateID: templateID,
        });
    });

    it('returns a zero-dispatch no-op when the complete native template configuration already matches', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const avID = '20260813000009-iiiiiii';
        const databaseBlockID = '20260813000010-jjjjjjj';
        const templateID = '20260813000000-aaaaaaa';
        const persistedTemplate = { id: templateID, name: 'Inbox', targetType: 'detached' };
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: avID,
                keyValues: [{ key: { type: 'block' }, values: [] }],
                newItemTemplates: [persistedTemplate],
                defaultTemplateID: templateID,
            },
        });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: databaseBlockID, dom: `<div data-type="NodeAttributeView" data-av-id="${avID}" class="av"></div>`,
        });

        const result = await callAvTool(client, {
            action: 'set_new_item_templates',
            avID,
            blockID: databaseBlockID,
            templates: [{ ...persistedTemplate, icon: '' }],
            defaultTemplateID: templateID,
        }, enabledActions('set_new_item_templates'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true, action: 'set_new_item_templates', changed: false, status: 'already_applied',
        });
    });

    it('does not certify an already-observed template postimage after a transaction response is lost', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const avID = '20260813000009-iiiiiii';
        const databaseBlockID = '20260813000010-jjjjjjj';
        const templateID = '20260813000000-aaaaaaa';
        const preimage = {
            id: avID,
            keyValues: [{ key: { type: 'block' }, values: [] }],
            newItemTemplates: [],
            defaultTemplateID: '',
        };
        const observedPostimage = { ...preimage, newItemTemplates: [{ id: templateID, name: 'Inbox', targetType: 'detached' }], defaultTemplateID: templateID };
        vi.mocked(avApi.getAttributeView).mockResolvedValueOnce({ av: preimage }).mockResolvedValueOnce({ av: observedPostimage });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: databaseBlockID, dom: `<div data-type="NodeAttributeView" data-av-id="${avID}" class="av"></div>`,
        });
        vi.mocked(transactionApi.performTransactions).mockRejectedValue(new Error('template response lost'));

        const result = await callAvTool(client, {
            action: 'set_new_item_templates', avID, blockID: databaseBlockID,
            templates: [{ id: templateID, name: 'Inbox', targetType: 'detached' }], defaultTemplateID: templateID,
        }, enabledActions('set_new_item_templates'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(avApi.getAttributeView)).toHaveBeenCalledTimes(1);
        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: { type: 'internal_error', message: 'template response lost' },
        });
    });

    it('rejects a template that names an option the current AV does not contain', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const avID = '20260813000009-iiiiiii';
        const databaseBlockID = '20260813000010-jjjjjjj';
        const templateID = '20260813000000-aaaaaaa';
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [{ refID: databaseBlockID }] });
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: avID,
                keyValues: [
                    { key: { type: 'block' }, values: [{ blockID: '20260813000001-bbbbbbb', block: { id: 'bound-doc' } }] },
                    { key: { id: '20260813000002-ccccccc', type: 'select', options: [{ name: 'Open' }] }, values: [] },
                ],
                newItemTemplates: [],
                defaultTemplateID: '',
            },
        });

        const result = await callAvTool(client, {
            action: 'set_new_item_templates',
            avID,
            blockID: databaseBlockID,
            templates: [{
                id: templateID,
                name: 'Unsafe status',
                targetType: 'detached',
                fieldValues: {
                    '20260813000002-ccccccc': {
                        mode: 'static',
                        value: { type: 'select', mSelect: [{ content: 'Missing option' }] },
                    },
                },
            }],
            defaultTemplateID: templateID,
        }, enabledActions('set_new_item_templates'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: { action: 'set_new_item_templates', reason: 'template_configuration_invalid' },
        });
    });

    it('creates a document template item with distinct AV item and bound document IDs', async () => {
        const avApi = await import('@/api/av');
        const context = await import('@/tools/internal/context');
        const documentApi = await import('@/api/document');
        const systemApi = await import('@/api/system');
        const templateID = '20260813000000-aaaaaaa';
        const avID = '20260813000009-iiiiiii';
        const databaseBlockID = '20260813000010-jjjjjjj';
        const itemID = '20260813000001-bbbbbbb';
        const documentID = '20260813000002-ccccccc';
        const source = {
            id: avID,
            keyValues: [{
                key: { type: 'block' },
                values: [{ blockID: '20260813000003-ddddddd', block: { id: 'bound-doc' } }],
            }, {
                key: { id: '20260813000004-eeeeeee', type: 'date' },
                values: [],
            }],
            newItemTemplates: [{
                id: templateID,
                name: 'Meeting note',
                targetType: 'document',
                primaryKeyTemplate: 'Meeting note',
                saveLocation: { pathTemplate: '/Meetings/{{.Year}}', boxID: 'nb-1' },
                fieldValues: {
                    '20260813000004-eeeeeee': { mode: 'currentTime' },
                },
            }],
        };
        const after = {
            ...source,
            keyValues: [
                {
                    key: { type: 'block' },
                    values: [
                        { blockID: '20260813000003-ddddddd', block: { id: 'bound-doc' } },
                        { blockID: itemID, block: { id: documentID } },
                    ],
                },
                {
                    key: { id: '20260813000004-eeeeeee', type: 'date' },
                    values: [{ blockID: itemID, type: 'date', date: { content: 1_710_000_000_001 } }],
                },
            ],
        };
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [{ refID: databaseBlockID }] });
        vi.mocked(avApi.getAttributeView)
            .mockResolvedValueOnce({ av: source })
            .mockResolvedValueOnce({ av: after });
        vi.mocked(avApi.createAttributeViewItem).mockResolvedValue({
            itemID,
            blockID: documentID,
            content: 'Meeting note',
            isDetached: false,
        });
        vi.mocked(documentApi.getHPathByID).mockResolvedValue('/Meetings/Meeting note');

        const result = await callAvTool(client, {
            action: 'create_from_template',
            avID,
            blockID: databaseBlockID,
            templateID,
        }, enabledActions('create_from_template'), permMgr);

        expect(vi.mocked(avApi.createAttributeViewItem)).toHaveBeenCalledWith(client, {
            avID, blockID: databaseBlockID, templateID, viewID: undefined, previousID: undefined, groupID: undefined,
        });
        expect(vi.mocked(context.ensurePermissionForNotebook)).toHaveBeenCalledWith(permMgr, 'nb-1', 'write');
        expect(vi.mocked(systemApi.getCurrentTime)).toHaveBeenCalledWith(client);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true,
            action: 'create_from_template',
            itemID,
            blockID: documentID,
            isDetached: false,
            fieldReadback: 'verified',
        });
    });

    it('writes and clears a two-way relation through the dedicated cross-AV action', async () => {
        const avApi = await import('@/api/av');
        const sourceAvID = '20260813000009-iiiiiii';
        const sourceBlockID = '20260813000010-jjjjjjj';
        const sourceItemID = '20260813000001-bbbbbbb';
        const destinationItemID = '20260813000002-ccccccc';
        const relationKeyID = '20260813000003-ddddddd';
        const backKeyID = '20260813000004-eeeeeee';
        const sourceBefore = {
            id: sourceAvID,
            keyValues: [
                { key: { type: 'block' }, values: [{ blockID: sourceItemID, block: { id: 'source-doc' } }] },
                { key: { id: relationKeyID, type: 'relation', relation: { avID: '20260813000005-fffffff', isTwoWay: true, backKeyID } }, values: [{ blockID: sourceItemID, relation: { blockIDs: [destinationItemID], contents: null } }] },
            ],
        };
        const destinationBefore = {
            id: '20260813000005-fffffff',
            keyValues: [
                { key: { type: 'block' }, values: [{ blockID: destinationItemID, block: { id: 'destination-doc' } }] },
                { key: { id: backKeyID, type: 'relation', relation: { avID: sourceAvID, isTwoWay: true, backKeyID: relationKeyID } }, values: [{ blockID: destinationItemID, relation: { blockIDs: [sourceItemID], contents: null } }] },
            ],
        };
        const sourceAfter = {
            ...sourceBefore,
            keyValues: [sourceBefore.keyValues[0], { ...sourceBefore.keyValues[1], values: [{ blockID: sourceItemID, relation: { blockIDs: null, contents: null } }] }],
        };
        const destinationAfter = {
            ...destinationBefore,
            keyValues: [destinationBefore.keyValues[0], { ...destinationBefore.keyValues[1], values: [{ blockID: destinationItemID, relation: { blockIDs: null, contents: null } }] }],
        };
        let sourceReads = 0;
        let destinationReads = 0;
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: sourceReads++ < 2 ? sourceBefore : sourceAfter };
            if (id === '20260813000005-fffffff') return { av: destinationReads++ === 0 ? destinationBefore : destinationAfter };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (_clientArg, id) => (
            id === '20260813000005-fffffff' ? { refDefs: [{ refID: '20260813000011-kkkkkkk' }] }
                : id === sourceAvID ? { refDefs: [{ refID: sourceBlockID }] }
                    : { refDefs: [] }
        ));
        vi.mocked(avApi.setAttributeViewBlockAttr).mockResolvedValue({ value: {} });

        const result = await callAvTool(client, {
            action: 'set_relation',
            avID: sourceAvID,
            blockID: sourceBlockID,
            itemID: sourceItemID,
            keyID: relationKeyID,
            relatedItemIDs: [],
        }, enabledActions('set_relation'), permMgr);

        expect(vi.mocked(avApi.setAttributeViewBlockAttr)).toHaveBeenCalledWith(client, {
            avID: sourceAvID,
            keyID: relationKeyID,
            itemID: sourceItemID,
            value: { type: 'relation', relation: { blockIDs: [], contents: null } },
        });
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true,
            action: 'set_relation',
            cleared: true,
            reverseReadback: 'verified',
        });
    });

    it('creates the first two-way relation cell from the v3.8 omitted-values raw shape', async () => {
        const avApi = await import('@/api/av');
        const sourceAvID = '20260813001009-iiiiiii';
        const sourceBlockID = '20260813001010-jjjjjjj';
        const sourceItemID = '20260813001001-bbbbbbb';
        const destinationAvID = '20260813001005-fffffff';
        const destinationItemID = '20260813001002-ccccccc';
        const relationKeyID = '20260813001003-ddddddd';
        const backKeyID = '20260813001004-eeeeeee';
        const sourceBefore = {
            id: sourceAvID,
            keyValues: [
                { key: { id: '20260813001011-blockkey', type: 'block' }, values: [{ blockID: sourceItemID, block: { id: 'source-doc' } }] },
                // Go KeyValues.Values has `omitempty`; a configured relation
                // with no cell values is emitted with no `values` property.
                { key: { id: relationKeyID, type: 'relation', relation: { avID: destinationAvID, isTwoWay: true, backKeyID } } },
            ],
        };
        const destinationBefore = {
            id: destinationAvID,
            keyValues: [
                { key: { id: '20260813001012-destblock', type: 'block' }, values: [{ blockID: destinationItemID, block: { id: 'destination-doc' } }] },
                { key: { id: backKeyID, type: 'relation', relation: { avID: sourceAvID, isTwoWay: true, backKeyID: relationKeyID } } },
            ],
        };
        const sourceAfter = {
            ...sourceBefore,
            keyValues: [sourceBefore.keyValues[0], {
                key: sourceBefore.keyValues[1].key,
                values: [{ blockID: sourceItemID, relation: { blockIDs: [destinationItemID], contents: null } }],
            }],
        };
        const destinationAfter = {
            ...destinationBefore,
            keyValues: [destinationBefore.keyValues[0], {
                key: destinationBefore.keyValues[1].key,
                values: [{ blockID: destinationItemID, relation: { blockIDs: [sourceItemID], contents: null } }],
            }],
        };
        let sourceReads = 0;
        let destinationReads = 0;
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: sourceReads++ < 2 ? sourceBefore : sourceAfter };
            if (id === destinationAvID) return { av: destinationReads++ === 0 ? destinationBefore : destinationAfter };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (_clientArg, id) => (
            id === sourceAvID ? { refDefs: [{ refID: sourceBlockID }] }
                : id === destinationAvID ? { refDefs: [{ refID: '20260813001013-kkkkkkk' }] }
                    : { refDefs: [] }
        ));
        vi.mocked(avApi.setAttributeViewBlockAttr).mockResolvedValue({ value: {} });

        const result = await callAvTool(client, {
            action: 'set_relation',
            avID: sourceAvID,
            blockID: sourceBlockID,
            itemID: sourceItemID,
            keyID: relationKeyID,
            relatedItemIDs: [destinationItemID],
        }, enabledActions('set_relation'), permMgr);

        expect(vi.mocked(avApi.setAttributeViewBlockAttr)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(avApi.setAttributeViewBlockAttr)).toHaveBeenCalledWith(client, {
            avID: sourceAvID,
            keyID: relationKeyID,
            itemID: sourceItemID,
            value: { type: 'relation', relation: { blockIDs: [destinationItemID], contents: null } },
        });
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true,
            action: 'set_relation',
            relatedItemIDs: [destinationItemID],
            reverseReadback: 'verified',
        });
    });

    it('writes, clears, and rewrites a two-way relation across v3.8 omitted, empty, and list shapes', async () => {
        const avApi = await import('@/api/av');
        const sourceAvID = '20260813001209-iiiiiii';
        const sourceBlockID = '20260813001210-jjjjjjj';
        const sourceItemID = '20260813001201-bbbbbbb';
        const destinationAvID = '20260813001205-fffffff';
        const destinationItemID = '20260813001202-ccccccc';
        const relationKeyID = '20260813001203-ddddddd';
        const backKeyID = '20260813001204-eeeeeee';
        const sourceBlockEntry = {
            key: { id: '20260813001211-blockkey', type: 'block' },
            values: [{ blockID: sourceItemID, block: { id: 'source-doc' } }],
        };
        const destinationBlockEntry = {
            key: { id: '20260813001212-destkey', type: 'block' },
            values: [{ blockID: destinationItemID, block: { id: 'destination-doc' } }],
        };
        const sourceRelationKey = { id: relationKeyID, type: 'relation', relation: { avID: destinationAvID, isTwoWay: true, backKeyID } };
        const destinationRelationKey = { id: backKeyID, type: 'relation', relation: { avID: sourceAvID, isTwoWay: true, backKeyID: relationKeyID } };
        let source: Record<string, unknown> = { id: sourceAvID, keyValues: [sourceBlockEntry, { key: sourceRelationKey }] };
        let destination: Record<string, unknown> = { id: destinationAvID, keyValues: [destinationBlockEntry, { key: destinationRelationKey }] };
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => ({
            av: structuredClone(id === sourceAvID ? source : destination),
        }));
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (_clientArg, id) => (
            id === sourceAvID ? { refDefs: [{ refID: sourceBlockID }] }
                : id === destinationAvID ? { refDefs: [{ refID: '20260813001213-kkkkkkk' }] }
                    : { refDefs: [] }
        ));
        vi.mocked(avApi.setAttributeViewBlockAttr).mockImplementation(async (_clientArg, payload) => {
            const blockIDs = ((payload.value.relation as Record<string, unknown>).blockIDs as string[]);
            source = {
                id: sourceAvID,
                keyValues: [sourceBlockEntry, {
                    key: sourceRelationKey,
                    values: [{ blockID: sourceItemID, relation: { blockIDs: [...blockIDs], contents: null } }],
                }],
            };
            destination = {
                id: destinationAvID,
                keyValues: [destinationBlockEntry, {
                    key: destinationRelationKey,
                    values: [{
                        blockID: destinationItemID,
                        relation: { blockIDs: blockIDs.includes(destinationItemID) ? [sourceItemID] : [], contents: null },
                    }],
                }],
            };
            return { value: {} };
        });

        const transitions = [
            { name: 'first write', relatedItemIDs: [destinationItemID], cleared: false },
            { name: 'clear', relatedItemIDs: [], cleared: true },
            { name: 'rewrite', relatedItemIDs: [destinationItemID], cleared: false },
        ];
        for (const transition of transitions) {
            const result = await callAvTool(client, {
                action: 'set_relation', avID: sourceAvID, blockID: sourceBlockID,
                itemID: sourceItemID, keyID: relationKeyID, relatedItemIDs: transition.relatedItemIDs,
            }, enabledActions('set_relation'), permMgr);
            expect(JSON.parse(result.content[0].text), transition.name).toMatchObject({
                success: true,
                action: 'set_relation',
                relatedItemIDs: transition.relatedItemIDs,
                cleared: transition.cleared,
                reverseReadback: 'verified',
            });
        }

        expect(vi.mocked(avApi.setAttributeViewBlockAttr).mock.calls.map((call) => (
            ((call[1].value.relation as Record<string, unknown>).blockIDs)
        ))).toEqual([[destinationItemID], [], [destinationItemID]]);
    });

    it('refuses a null relation value list even when the source AV item exists', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const sourceAvID = '20260813001109-iiiiiii';
        const sourceBlockID = '20260813001110-jjjjjjj';
        const sourceItemID = '20260813001101-bbbbbbb';
        const relationKeyID = '20260813001103-ddddddd';
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: sourceAvID,
                keyValues: [
                    { key: { id: '20260813001111-blockkey', type: 'block' }, values: [{ blockID: sourceItemID, block: { id: 'source-doc' } }] },
                    { key: { id: relationKeyID, type: 'relation', relation: { avID: '20260813001105-fffffff', isTwoWay: false } }, values: null },
                ],
            },
        });
        vi.mocked(blockApi.getBlockDOM).mockResolvedValue({
            id: sourceBlockID,
            dom: `<div data-type="NodeAttributeView" data-av-id="${sourceAvID}" class="av"></div>`,
        });

        const result = await callAvTool(client, {
            action: 'set_relation',
            avID: sourceAvID,
            blockID: sourceBlockID,
            itemID: sourceItemID,
            keyID: relationKeyID,
            relatedItemIDs: [],
        }, enabledActions('set_relation'), permMgr);

        expect(vi.mocked(avApi.setAttributeViewBlockAttr)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: {
                action: 'set_relation',
                reason: 'relation_preflight_failed',
                message: `set_relation preflight: keyID "${relationKeyID}" has no value list.`,
            },
        });
    });

    it('does not dispatch set_relation when the complete two-way postimage already exists', async () => {
        const avApi = await import('@/api/av');
        const sourceAvID = '20260813000109-iiiiiii';
        const sourceBlockID = '20260813000110-jjjjjjj';
        const sourceItemID = '20260813000101-bbbbbbb';
        const destinationItemID = '20260813000102-ccccccc';
        const relationKeyID = '20260813000103-ddddddd';
        const backKeyID = '20260813000104-eeeeeee';
        const destinationAvID = '20260813000105-fffffff';
        const source = {
            id: sourceAvID,
            keyValues: [
                { key: { type: 'block' }, values: [{ blockID: sourceItemID, block: { id: 'source-doc' } }] },
                { key: { id: relationKeyID, type: 'relation', relation: { avID: destinationAvID, isTwoWay: true, backKeyID } }, values: [{ blockID: sourceItemID, relation: { blockIDs: [destinationItemID], contents: null } }] },
            ],
        };
        const destination = {
            id: destinationAvID,
            keyValues: [
                { key: { type: 'block' }, values: [{ blockID: destinationItemID, block: { id: 'destination-doc' } }] },
                { key: { id: backKeyID, type: 'relation', relation: { avID: sourceAvID, isTwoWay: true, backKeyID: relationKeyID } }, values: [{ blockID: destinationItemID, relation: { blockIDs: [sourceItemID], contents: null } }] },
            ],
        };
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => ({ av: id === sourceAvID ? source : destination }));
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (_clientArg, id) => (
            id === destinationAvID ? { refDefs: [{ refID: '20260813000111-kkkkkkk' }] } : { refDefs: [{ refID: sourceBlockID }] }
        ));

        const result = await callAvTool(client, {
            action: 'set_relation', avID: sourceAvID, blockID: sourceBlockID,
            itemID: sourceItemID, keyID: relationKeyID, relatedItemIDs: [destinationItemID],
        }, enabledActions('set_relation'), permMgr);

        expect(vi.mocked(avApi.setAttributeViewBlockAttr)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true, action: 'set_relation', changed: false, status: 'already_applied', reverseReadback: 'verified',
        });
    });

    it('does not recover a lost set_relation response from an ambiguous postimage', async () => {
        const avApi = await import('@/api/av');
        const sourceAvID = '20260813000209-iiiiiii';
        const sourceBlockID = '20260813000210-jjjjjjj';
        const sourceItemID = '20260813000201-bbbbbbb';
        const destinationItemID = '20260813000202-ccccccc';
        const relationKeyID = '20260813000203-ddddddd';
        const backKeyID = '20260813000204-eeeeeee';
        const destinationAvID = '20260813000205-fffffff';
        const sourceBefore = {
            id: sourceAvID,
            keyValues: [
                { key: { type: 'block' }, values: [{ blockID: sourceItemID, block: { id: 'source-doc' } }] },
                { key: { id: relationKeyID, type: 'relation', relation: { avID: destinationAvID, isTwoWay: true, backKeyID } }, values: [{ blockID: sourceItemID, relation: { blockIDs: null, contents: null } }] },
            ],
        };
        const destinationBefore = {
            id: destinationAvID,
            keyValues: [
                { key: { type: 'block' }, values: [{ blockID: destinationItemID, block: { id: 'destination-doc' } }] },
                { key: { id: backKeyID, type: 'relation', relation: { avID: sourceAvID, isTwoWay: true, backKeyID: relationKeyID } }, values: [{ blockID: destinationItemID, relation: { blockIDs: null, contents: null } }] },
            ],
        };
        const sourceAfter = {
            ...sourceBefore,
            keyValues: [sourceBefore.keyValues[0], { ...sourceBefore.keyValues[1], values: [{ blockID: sourceItemID, relation: { blockIDs: [destinationItemID], contents: null } }] }],
        };
        const destinationAfter = {
            ...destinationBefore,
            keyValues: [destinationBefore.keyValues[0], { ...destinationBefore.keyValues[1], values: [{ blockID: destinationItemID, relation: { blockIDs: [sourceItemID], contents: null } }] }],
        };
        let sourceReads = 0;
        let destinationReads = 0;
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: sourceReads++ < 2 ? sourceBefore : sourceAfter };
            if (id === destinationAvID) return { av: destinationReads++ === 0 ? destinationBefore : destinationAfter };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (_clientArg, id) => (
            id === destinationAvID ? { refDefs: [{ refID: '20260813000211-kkkkkkk' }] } : { refDefs: [{ refID: sourceBlockID }] }
        ));
        vi.mocked(avApi.setAttributeViewBlockAttr).mockRejectedValue(new Error('relation response lost'));

        const result = await callAvTool(client, {
            action: 'set_relation', avID: sourceAvID, blockID: sourceBlockID,
            itemID: sourceItemID, keyID: relationKeyID, relatedItemIDs: [destinationItemID],
        }, enabledActions('set_relation'), permMgr);

        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toMatchObject({ error: { type: 'internal_error', message: 'relation response lost' } });
        expect(vi.mocked(avApi.setAttributeViewBlockAttr)).toHaveBeenCalledTimes(1);
        // The postimage was intentionally available after the transport error,
        // but the handler must not inspect it and claim this request wrote it.
        expect(sourceReads).toBe(2);
        expect(destinationReads).toBe(1);
    });

    it('configures both sides of a two-way relation with native transaction metadata', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const sourceAvID = '20260813000009-iiiiiii';
        const destinationAvID = '20260813000005-fffffff';
        const sourceBlockID = '20260813000010-jjjjjjj';
        const destinationBlockID = '20260813000011-kkkkkkk';
        const keyID = '20260813000003-ddddddd';
        const backKeyID = '20260813000004-eeeeeee';
        const sourceBefore = {
            id: sourceAvID,
            keyValues: [
                { key: { type: 'block' }, values: [] },
                { key: { id: keyID, type: 'relation', name: 'Projects' }, values: [] },
            ],
        };
        const destinationBefore = { id: destinationAvID, keyValues: [{ key: { type: 'block' }, values: [] }] };
        const sourceAfter = {
            ...sourceBefore,
            keyValues: [sourceBefore.keyValues[0], {
                key: { id: keyID, type: 'relation', name: 'Projects', relation: { avID: destinationAvID, isTwoWay: true, backKeyID } },
                values: [],
            }],
        };
        const destinationAfter = {
            id: destinationAvID,
            keyValues: [
                destinationBefore.keyValues[0],
                { key: { id: backKeyID, type: 'relation', name: 'Tasks', relation: { avID: sourceAvID, isTwoWay: true, backKeyID: keyID } }, values: [] },
            ],
        };
        let sourceReads = 0;
        let destinationReads = 0;
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: sourceReads++ === 0 ? sourceBefore : sourceAfter };
            if (id === destinationAvID) return { av: destinationReads++ === 0 ? destinationBefore : destinationAfter };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (_clientArg, id) => (
            id === sourceAvID ? { refDefs: [{ refID: sourceBlockID }] }
                : id === destinationAvID ? { refDefs: [{ refID: destinationBlockID }] }
                    : { refDefs: [] }
        ));

        const result = await callAvTool(client, {
            action: 'configure_two_way_relation',
            avID: sourceAvID,
            blockID: sourceBlockID,
            keyID,
            destinationAvID,
            destinationBlockID,
            backRelationKeyID: backKeyID,
            sourceName: 'Projects',
            destinationName: 'Tasks',
        }, enabledActions('configure_two_way_relation'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'updateAttrViewColRelation', avID: sourceAvID, keyID, id: destinationAvID,
            backRelationKeyID: backKeyID, isTwoWay: true, name: 'Tasks', format: 'Projects',
        });
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true, action: 'configure_two_way_relation', sourceAvID, destinationAvID, backRelationKeyID: backKeyID,
        });
    });

    it('returns a zero-dispatch no-op when both two-way relation definitions already match', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const sourceAvID = '20260813000009-iiiiiii';
        const destinationAvID = '20260813000005-fffffff';
        const sourceBlockID = '20260813000010-jjjjjjj';
        const destinationBlockID = '20260813000011-kkkkkkk';
        const keyID = '20260813000003-ddddddd';
        const backKeyID = '20260813000004-eeeeeee';
        const source = {
            id: sourceAvID,
            keyValues: [
                { key: { type: 'block' }, values: [] },
                { key: { id: keyID, type: 'relation', name: 'Projects', relation: { avID: destinationAvID, isTwoWay: true, backKeyID } }, values: [] },
            ],
        };
        const destination = {
            id: destinationAvID,
            keyValues: [
                { key: { type: 'block' }, values: [] },
                { key: { id: backKeyID, type: 'relation', name: 'Tasks', relation: { avID: sourceAvID, isTwoWay: true, backKeyID: keyID } }, values: [] },
            ],
        };
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: source };
            if (id === destinationAvID) return { av: destination };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (_clientArg, id) => (
            id === destinationAvID ? { refDefs: [{ refID: destinationBlockID }] } : { refDefs: [] }
        ));
        vi.mocked(blockApi.getBlockDOM).mockImplementation(async (_clientArg, id) => ({
            id,
            dom: `<div data-type="NodeAttributeView" data-av-id="${id === sourceBlockID ? sourceAvID : destinationAvID}" class="av"></div>`,
        }));

        const result = await callAvTool(client, {
            action: 'configure_two_way_relation', avID: sourceAvID, blockID: sourceBlockID, keyID,
            destinationAvID, destinationBlockID, backRelationKeyID: backKeyID, sourceName: 'Projects', destinationName: 'Tasks',
        }, enabledActions('configure_two_way_relation'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true, action: 'configure_two_way_relation', changed: false, status: 'already_applied',
        });
    });

    it('does not certify matching two-way relation definitions after a transaction response is lost', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const sourceAvID = '20260813000009-iiiiiii';
        const destinationAvID = '20260813000005-fffffff';
        const sourceBlockID = '20260813000010-jjjjjjj';
        const destinationBlockID = '20260813000011-kkkkkkk';
        const keyID = '20260813000003-ddddddd';
        const backKeyID = '20260813000004-eeeeeee';
        const sourcePreimage = { id: sourceAvID, keyValues: [{ key: { type: 'block' }, values: [] }, { key: { id: keyID, type: 'relation', name: 'Projects' }, values: [] }] };
        const destinationPreimage = { id: destinationAvID, keyValues: [{ key: { type: 'block' }, values: [] }] };
        const sourcePostimage = { ...sourcePreimage, keyValues: [sourcePreimage.keyValues[0], { key: { id: keyID, type: 'relation', name: 'Projects', relation: { avID: destinationAvID, isTwoWay: true, backKeyID } }, values: [] }] };
        const destinationPostimage = { id: destinationAvID, keyValues: [destinationPreimage.keyValues[0], { key: { id: backKeyID, type: 'relation', name: 'Tasks', relation: { avID: sourceAvID, isTwoWay: true, backKeyID: keyID } }, values: [] }] };
        let sourceReads = 0;
        let destinationReads = 0;
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: sourceReads++ === 0 ? sourcePreimage : sourcePostimage };
            if (id === destinationAvID) return { av: destinationReads++ === 0 ? destinationPreimage : destinationPostimage };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [{ refID: destinationBlockID }] });
        vi.mocked(blockApi.getBlockDOM).mockImplementation(async (_clientArg, id) => ({
            id,
            dom: `<div data-type="NodeAttributeView" data-av-id="${id === sourceBlockID ? sourceAvID : destinationAvID}" class="av"></div>`,
        }));
        vi.mocked(transactionApi.performTransactions).mockRejectedValue(new Error('two-way response lost'));

        const result = await callAvTool(client, {
            action: 'configure_two_way_relation', avID: sourceAvID, blockID: sourceBlockID, keyID,
            destinationAvID, destinationBlockID, backRelationKeyID: backKeyID, sourceName: 'Projects', destinationName: 'Tasks',
        }, enabledActions('configure_two_way_relation'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
        expect(sourceReads).toBe(1);
        expect(destinationReads).toBe(1);
        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: { type: 'internal_error', message: 'two-way response lost' },
        });
    });

    it('configures an existing rollup key using native RollupCalc data', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const sourceAvID = '20260813000009-iiiiiii';
        const destinationAvID = '20260813000005-fffffff';
        const sourceBlockID = '20260813000010-jjjjjjj';
        const destinationBlockID = '20260813000011-kkkkkkk';
        const relationKeyID = '20260813000003-ddddddd';
        const rollupKeyID = '20260813000004-eeeeeee';
        const destinationKeyID = '20260813000006-ggggggg';
        const calc = { operator: 'Count all' };
        const rawCalc = { operator: 'Count all', result: null };
        const sourceBefore = {
            id: sourceAvID,
            keyValues: [
                { key: { type: 'block' }, values: [] },
                { key: { id: relationKeyID, type: 'relation', relation: { avID: destinationAvID } }, values: [] },
                { key: { id: rollupKeyID, type: 'rollup' }, values: [] },
            ],
        };
        const destination = {
            id: destinationAvID,
            keyValues: [
                { key: { type: 'block' }, values: [] },
                { key: { id: destinationKeyID, type: 'number' }, values: [] },
            ],
        };
        const sourceAfter = {
            ...sourceBefore,
            keyValues: [sourceBefore.keyValues[0], sourceBefore.keyValues[1], {
                key: { id: rollupKeyID, type: 'rollup', rollup: { relationKeyID, keyID: destinationKeyID, calc: rawCalc } }, values: [],
            }],
        };
        let sourceReads = 0;
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: sourceReads++ === 0 ? sourceBefore : sourceAfter };
            if (id === destinationAvID) return { av: destination };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (_clientArg, id) => (
            id === sourceAvID ? { refDefs: [{ refID: sourceBlockID }] }
                : id === destinationAvID ? { refDefs: [{ refID: destinationBlockID }] }
                    : { refDefs: [] }
        ));

        const result = await callAvTool(client, {
            action: 'configure_rollup',
            avID: sourceAvID,
            blockID: sourceBlockID,
            keyID: rollupKeyID,
            relationKeyID,
            destinationKeyID,
            calc,
        }, enabledActions('configure_rollup'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions).mock.calls[0][1][0].doOperations[0]).toMatchObject({
            action: 'updateAttrViewColRollup', id: rollupKeyID, avID: sourceAvID,
            parentID: relationKeyID, keyID: destinationKeyID, data: { calc },
        });
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true, action: 'configure_rollup', destinationAvID, destinationKeyID,
        });
    });

    it('returns a zero-dispatch no-op for v3.8 result-null rollup readback', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const sourceAvID = '20260813000009-iiiiiii';
        const destinationAvID = '20260813000005-fffffff';
        const sourceBlockID = '20260813000010-jjjjjjj';
        const destinationBlockID = '20260813000011-kkkkkkk';
        const relationKeyID = '20260813000003-ddddddd';
        const rollupKeyID = '20260813000004-eeeeeee';
        const destinationKeyID = '20260813000006-ggggggg';
        const calc = { operator: 'Count all' };
        const source = {
            id: sourceAvID,
            keyValues: [
                { key: { type: 'block' }, values: [] },
                { key: { id: relationKeyID, type: 'relation', relation: { avID: destinationAvID } }, values: [] },
                { key: { id: rollupKeyID, type: 'rollup', rollup: { relationKeyID, keyID: destinationKeyID, calc: { operator: 'Count all', result: null } } }, values: [] },
            ],
        };
        const destination = { id: destinationAvID, keyValues: [{ key: { type: 'block' }, values: [] }, { key: { id: destinationKeyID, type: 'number' }, values: [] }] };
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: source };
            if (id === destinationAvID) return { av: destination };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [{ refID: destinationBlockID }] });
        vi.mocked(blockApi.getBlockDOM).mockImplementation(async (_clientArg, id) => ({
            id,
            dom: `<div data-type="NodeAttributeView" data-av-id="${id === sourceBlockID ? sourceAvID : destinationAvID}" class="av"></div>`,
        }));

        const result = await callAvTool(client, {
            action: 'configure_rollup', avID: sourceAvID, blockID: sourceBlockID, keyID: rollupKeyID,
            relationKeyID, destinationKeyID, calc,
        }, enabledActions('configure_rollup'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true, action: 'configure_rollup', changed: false, status: 'already_applied',
        });
    });

    it.each([
        ['different operator', { operator: 'Count values', result: null }],
        ['non-null result', { operator: 'Count all', result: { type: 'number', number: { content: 1 } } }],
    ])('does not treat %s rollup metadata as the requested configuration', async (_caseName, observedCalc) => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const sourceAvID = '20260813002009-iiiiiii';
        const destinationAvID = '20260813002005-fffffff';
        const sourceBlockID = '20260813002010-jjjjjjj';
        const destinationBlockID = '20260813002011-kkkkkkk';
        const relationKeyID = '20260813002003-ddddddd';
        const rollupKeyID = '20260813002004-eeeeeee';
        const destinationKeyID = '20260813002006-ggggggg';
        const calc = { operator: 'Count all' };
        const sourceBefore = {
            id: sourceAvID,
            keyValues: [
                { key: { type: 'block' }, values: [] },
                { key: { id: relationKeyID, type: 'relation', relation: { avID: destinationAvID } }, values: [] },
                { key: { id: rollupKeyID, type: 'rollup', rollup: { relationKeyID, keyID: destinationKeyID, calc: observedCalc } }, values: [] },
            ],
        };
        const sourceAfter = {
            ...sourceBefore,
            keyValues: [sourceBefore.keyValues[0], sourceBefore.keyValues[1], {
                key: { id: rollupKeyID, type: 'rollup', rollup: { relationKeyID, keyID: destinationKeyID, calc: { operator: 'Count all', result: null } } }, values: [],
            }],
        };
        const destination = {
            id: destinationAvID,
            keyValues: [{ key: { type: 'block' }, values: [] }, { key: { id: destinationKeyID, type: 'text' }, values: [] }],
        };
        let sourceReads = 0;
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: sourceReads++ === 0 ? sourceBefore : sourceAfter };
            if (id === destinationAvID) return { av: destination };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockImplementation(async (_clientArg, id) => (
            id === sourceAvID ? { refDefs: [{ refID: sourceBlockID }] }
                : id === destinationAvID ? { refDefs: [{ refID: destinationBlockID }] }
                    : { refDefs: [] }
        ));

        const result = await callAvTool(client, {
            action: 'configure_rollup', avID: sourceAvID, blockID: sourceBlockID, keyID: rollupKeyID,
            relationKeyID, destinationKeyID, calc,
        }, enabledActions('configure_rollup'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
        expect(JSON.parse(result.content[0].text)).toMatchObject({ success: true, action: 'configure_rollup' });
    });

    it('does not certify matching native rollup metadata after a transaction response is lost', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const sourceAvID = '20260813000009-iiiiiii';
        const destinationAvID = '20260813000005-fffffff';
        const sourceBlockID = '20260813000010-jjjjjjj';
        const destinationBlockID = '20260813000011-kkkkkkk';
        const relationKeyID = '20260813000003-ddddddd';
        const rollupKeyID = '20260813000004-eeeeeee';
        const destinationKeyID = '20260813000006-ggggggg';
        const calc = { operator: 'count', result: { type: 'number', number: { content: 0 } } };
        const sourcePreimage = {
            id: sourceAvID,
            keyValues: [
                { key: { type: 'block' }, values: [] },
                { key: { id: relationKeyID, type: 'relation', relation: { avID: destinationAvID } }, values: [] },
                { key: { id: rollupKeyID, type: 'rollup' }, values: [] },
            ],
        };
        const sourcePostimage = { ...sourcePreimage, keyValues: [sourcePreimage.keyValues[0], sourcePreimage.keyValues[1], { key: { id: rollupKeyID, type: 'rollup', rollup: { relationKeyID, keyID: destinationKeyID, calc } }, values: [] }] };
        const destination = { id: destinationAvID, keyValues: [{ key: { type: 'block' }, values: [] }, { key: { id: destinationKeyID, type: 'number' }, values: [] }] };
        let sourceReads = 0;
        vi.mocked(avApi.getAttributeView).mockImplementation(async (_clientArg, id) => {
            if (id === sourceAvID) return { av: sourceReads++ === 0 ? sourcePreimage : sourcePostimage };
            if (id === destinationAvID) return { av: destination };
            throw new Error(`unexpected AV ${id}`);
        });
        vi.mocked(avApi.getMirrorDatabaseBlocks).mockResolvedValue({ refDefs: [{ refID: destinationBlockID }] });
        vi.mocked(blockApi.getBlockDOM).mockImplementation(async (_clientArg, id) => ({
            id,
            dom: `<div data-type="NodeAttributeView" data-av-id="${id === sourceBlockID ? sourceAvID : destinationAvID}" class="av"></div>`,
        }));
        vi.mocked(transactionApi.performTransactions).mockRejectedValue(new Error('rollup response lost'));

        const result = await callAvTool(client, {
            action: 'configure_rollup', avID: sourceAvID, blockID: sourceBlockID, keyID: rollupKeyID,
            relationKeyID, destinationKeyID, calc,
        }, enabledActions('configure_rollup'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);
        expect(sourceReads).toBe(1);
        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            error: { type: 'internal_error', message: 'rollup response lost' },
        });
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

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            id: 'av-1',
            av: { id: 'av-1' },
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
            pageSize: 50,
            pageCount: 1,
            hasNextPage: false,
            avID: 'av-1',
            id: 'av-1',
            viewID: 'view-1',
            viewType: 'table',
            view: {
                id: 'view-1',
                pageSize: 50,
                columns: [],
                rows: [],
                rowCount: 0,
            },
        });
    });

    it('accepts avID alias and reads rows/columns from the kernel nested view structure', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({
            id: 'av-1',
            viewID: 'view-1',
            viewType: 'table',
            view: {
                id: 'view-1',
                name: '表格',
                pageSize: 50,
                columns: [
                    { id: 'col-title', name: 'Title', type: 'text', pin: false, width: '200px', align: 0 },
                    { id: 'col-done', name: '完成', type: 'checkbox', pin: false, width: '100px', align: 0 },
                ],
                rows: [
                    {
                        id: 'row-1',
                        cells: [
                            { id: 'val-1', value: { id: 'val-1', keyID: 'col-title', blockID: 'row-1', type: 0, text: { content: 'Paper A' } }, valueType: 0 },
                            { id: 'val-2', value: { id: 'val-2', keyID: 'col-done', blockID: 'row-1', type: 10, checkbox: { checked: true } }, valueType: 10 },
                        ],
                    },
                ],
                rowCount: 1,
            },
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
            data: [{ id: 'row-1', cells: { 'col-title': 'Paper A', 'col-done': true } }],
            total: 1,
            pageSize: 50,
            table: {
                columns: [
                    { id: 'col-title', name: 'Title', type: 'text' },
                    { id: 'col-done', name: '完成', type: 'checkbox' },
                ],
                rows: [{ id: 'row-1', cells: { 'col-title': 'Paper A', 'col-done': true } }],
                rowCount: 1,
            },
            view: {
                id: 'view-1',
                name: '表格',
                pageSize: 50,
                rows: [{
                    id: 'row-1',
                    cells: [
                        { id: 'val-1', value: { keyID: 'col-title', blockID: 'row-1', text: { content: 'Paper A' } } },
                        { id: 'val-2', value: { keyID: 'col-done', blockID: 'row-1', checkbox: { checked: true } } },
                    ],
                }],
                rowCount: 1,
            },
        });
    });

    it('computes pagination from kernel rowCount and the effective page size', async () => {
        const avApi = await import('@/api/av');
        const view = {
            id: 'view-1',
            pageSize: 50,
            columns: [{ id: 'col-title', name: 'Title', type: 'text' }],
            rows: Array.from({ length: 20 }, (_, i) => ({
                id: `row-${i + 1}`,
                cells: [{ id: `val-${i + 1}`, value: { keyID: 'col-title', blockID: `row-${i + 1}`, text: { content: `Item ${i + 1}` } }, valueType: 0 }],
            })),
            rowCount: 120,
        };
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({ id: 'av-1', viewID: 'view-1', viewType: 'table', view });

        const result = await callAvTool(client, {
            action: 'render',
            id: 'av-1',
            page: 3,
        }, enabledActions('render'), permMgr);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.data).toHaveLength(20);
        expect(parsed.data[0]).toMatchObject({ id: 'row-1', cells: { 'col-title': 'Item 1' } });
        expect(parsed.data[19]).toMatchObject({ id: 'row-20', cells: { 'col-title': 'Item 20' } });
        expect(parsed).toMatchObject({
            total: 120,
            page: 3,
            pageSize: 50,
            pageCount: 3,
            hasNextPage: false,
        });
    });

    it('normalizes pageSize=-1 to the view default page size', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({
            id: 'av-1',
            viewID: 'view-1',
            viewType: 'table',
            view: {
                id: 'view-1',
                pageSize: 50,
                columns: [],
                rows: [],
                rowCount: 120,
            },
        });

        const result = await callAvTool(client, {
            action: 'render',
            id: 'av-1',
            pageSize: -1,
        }, enabledActions('render'), permMgr);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toMatchObject({
            data: [],
            total: 120,
            page: 1,
            pageSize: 50,
            pageCount: 3,
            hasNextPage: true,
        });
    });

    it('aggregates rows from group views when the kernel groups rows', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({
            id: 'av-1',
            viewID: 'view-1',
            viewType: 'table',
            view: {
                id: 'view-1',
                name: '分组表格',
                pageSize: 50,
                columns: [{ id: 'col-title', name: 'Title', type: 'text' }],
                rows: [],
                rowCount: 3,
                groups: [
                    {
                        id: 'grp-1',
                        name: 'A 组',
                        pageSize: 50,
                        rows: [
                            { id: 'grow-1', cells: [{ id: 'gv-1', value: { keyID: 'col-title', blockID: 'grow-1', text: { content: 'Alpha' } }, valueType: 0 }] },
                            { id: 'grow-2', cells: [{ id: 'gv-2', value: { keyID: 'col-title', blockID: 'grow-2', text: { content: 'Beta' } }, valueType: 0 }] },
                        ],
                        rowCount: 2,
                    },
                    {
                        id: 'grp-2',
                        name: 'B 组',
                        pageSize: 50,
                        rows: [
                            { id: 'grow-3', cells: [{ id: 'gv-3', value: { keyID: 'col-title', blockID: 'grow-3', text: { content: 'Gamma' } }, valueType: 0 }] },
                        ],
                        rowCount: 1,
                    },
                ],
            },
        });

        const result = await callAvTool(client, {
            action: 'render',
            id: 'av-1',
        }, enabledActions('render'), permMgr);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.data).toHaveLength(3);
        expect(parsed.data[0]).toMatchObject({ id: 'grow-1', cells: { 'col-title': 'Alpha' } });
        expect(parsed.data[2]).toMatchObject({ id: 'grow-3', cells: { 'col-title': 'Gamma' } });
        expect(parsed).toMatchObject({
            total: 3,
            pageSize: 50,
            pageCount: 1,
            hasNextPage: false,
            table: {
                rows: [
                    { id: 'grow-1', cells: { 'col-title': 'Alpha' } },
                    { id: 'grow-2', cells: { 'col-title': 'Beta' } },
                    { id: 'grow-3', cells: { 'col-title': 'Gamma' } },
                ],
                rowCount: 3,
            },
        });
    });

    it('computes grouped pagination from the largest group instead of summed rowCount', async () => {
        const avApi = await import('@/api/av');
        vi.mocked(avApi.renderAttributeView).mockResolvedValue({
            id: 'av-1',
            viewID: 'view-1',
            viewType: 'table',
            view: {
                id: 'view-1',
                pageSize: 50,
                columns: [{ id: 'col-title', name: 'Title', type: 'text' }],
                rows: [],
                rowCount: 80,
                groups: [
                    { id: 'grp-1', rows: [], rowCount: 40 },
                    { id: 'grp-2', rows: [], rowCount: 40 },
                ],
            },
        });

        const result = await callAvTool(client, {
            action: 'render',
            id: 'av-1',
        }, enabledActions('render'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            total: 80,
            pageSize: 50,
            pageCount: 1,
            hasNextPage: false,
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
            view: {
                id: 'view-new',
                pageSize: 50,
                columns: [{ name: '主键' }, { name: '单选' }],
                rows: [],
                rowCount: 0,
            },
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
            pageSize: 50,
            pageCount: 1,
            hasNextPage: false,
            avID: 'av-new',
            id: 'av-new',
            viewID: 'view-new',
            viewType: 'table',
            view: {
                id: 'view-new',
                pageSize: 50,
                columns: [{ name: '主键' }, { name: '单选' }],
                rows: [],
                rowCount: 0,
            },
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
            view: {
                id: 'view-new',
                pageSize: 50,
                columns: [{ name: '主键' }, { name: '单选' }],
                rows: [],
                rowCount: 0,
            },
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
            view: {
                id: 'view-new',
                pageSize: 50,
                columns: [{ name: '主键' }, { name: '单选' }],
                rows: [],
                rowCount: 0,
            },
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
            view: {
                id: 'view-new',
                pageSize: 50,
                columns: [],
                rows: [],
                rowCount: 0,
            },
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
                view: {
                    id: 'view-new',
                    pageSize: 50,
                    columns: [],
                    rows: [],
                    rowCount: 0,
                },
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

    it('adds a named gallery view through one native transaction without render', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        const result = await callAvTool(client, {
            action: 'add_view',
            avID: 'av-1',
            blockID: 'db-block-explicit',
            viewID: 'view-gallery',
            layout: 'gallery',
            name: '卡片视图',
        }, enabledActions('add_view'), permMgr);

        expect(vi.mocked(avApi.renderAttributeView)).not.toHaveBeenCalled();
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(client, [{
            doOperations: [
                { action: 'addAttrViewView', avID: 'av-1', id: 'view-gallery', blockID: 'db-block-explicit', layout: 'gallery' },
                { action: 'setAttrViewViewName', avID: 'av-1', id: 'view-gallery', data: '卡片视图' },
            ],
            undoOperations: [],
        }]);
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            success: true, action: 'add_view', viewID: 'view-gallery', layout: 'gallery', name: '卡片视图',
        });
    });

    it('refuses kanban creation that would synthesize a schema field in existing views', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1',
                keyValues: [{ key: { id: 'key-title', type: 'block' }, values: [] }],
                views: [{ id: 'view-1', type: 'table', table: { columns: [{ id: 'key-title' }] } }],
            },
        });
        const result = await callAvTool(client, {
            action: 'add_view', avID: 'av-1', blockID: 'db-block-explicit', viewID: 'view-kanban', layout: 'kanban', name: '看板',
        }, enabledActions('add_view'), permMgr);

        expect(result.isError).toBe(true);
        expect(JSON.parse(result.content[0].text)).toMatchObject({ error: { message: expect.stringContaining('requires an existing select column') } });
        expect(vi.mocked(transactionApi.performTransactions)).not.toHaveBeenCalled();
    });

    it('replaces filters through the public endpoint and rejects a stale carrier view', async () => {
        const avApi = await import('@/api/av');
        const blockApi = await import('@/api/block');
        const filter = { column: 'key-status', operator: '=', value: { type: 'select', mSelect: [{ content: '进行中' }] } };
        const result = await callAvTool(client, {
            action: 'set_filters', avID: 'av-1', blockID: 'db-block-explicit', viewID: 'view-1', filters: [filter],
        }, enabledActions('set_filters'), permMgr);

        expect(vi.mocked(avApi.setAttributeViewFilters)).toHaveBeenCalledWith(client, {
            avID: 'av-1', blockID: 'db-block-explicit', data: [filter],
        });
        expect(vi.mocked(avApi.renderAttributeView)).not.toHaveBeenCalled();

        vi.mocked(blockApi.getBlockAttrs).mockResolvedValue({ 'custom-sy-av-view': 'other-view' });
        const stale = await callAvTool(client, {
            action: 'set_filters', avID: 'av-1', blockID: 'db-block-explicit', viewID: 'view-1', filters: [],
        }, enabledActions('set_filters'), permMgr);
        expect(stale.isError).toBe(true);
        expect(vi.mocked(avApi.setAttributeViewFilters)).toHaveBeenCalledTimes(1);
    });

    it('replaces complete sort and group configuration on the verified carrier view', async () => {
        const avApi = await import('@/api/av');
        await callAvTool(client, {
            action: 'set_sorts', avID: 'av-1', blockID: 'db-block-explicit', viewID: 'view-1',
            sorts: [{ column: 'key-status', order: 'DESC' }],
        }, enabledActions('set_sorts'), permMgr);
        await callAvTool(client, {
            action: 'set_group', avID: 'av-1', blockID: 'db-block-explicit', viewID: 'view-1',
            group: { field: 'key-status', method: 0, order: 3, hideEmpty: true },
        }, enabledActions('set_group'), permMgr);
        expect(vi.mocked(avApi.setAttributeViewSorts)).toHaveBeenCalledWith(client, {
            avID: 'av-1', blockID: 'db-block-explicit', data: [{ column: 'key-status', order: 'DESC' }],
        });
        expect(vi.mocked(avApi.setAttributeViewGroup)).toHaveBeenCalledWith(client, {
            avID: 'av-1', blockID: 'db-block-explicit', group: { field: 'key-status', method: 0, order: 3, hideEmpty: true },
        });
    });

    it('updates gallery visibility and requires a complete field order', async () => {
        const avApi = await import('@/api/av');
        const transactionApi = await import('@/api/transaction');
        vi.mocked(avApi.getAttributeView).mockResolvedValue({
            av: {
                id: 'av-1', keyValues: [{ key: { id: 'key-title', type: 'block' }, values: [] }, { key: { id: 'key-status', type: 'select' }, values: [] }],
                views: [{ id: 'view-1', type: 'gallery', gallery: { fields: [{ id: 'key-title', hidden: false }, { id: 'key-status', hidden: false }] } }],
            },
        });
        await callAvTool(client, {
            action: 'set_column_visibility', avID: 'av-1', blockID: 'db-block-explicit', viewID: 'view-1', keyID: 'key-status', hidden: true,
        }, enabledActions('set_column_visibility'), permMgr);
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(client, [{
            doOperations: [{ action: 'setAttrViewColHidden', avID: 'av-1', blockID: 'db-block-explicit', id: 'key-status', data: true }], undoOperations: [],
        }]);

        const partial = await callAvTool(client, {
            action: 'set_column_order', avID: 'av-1', blockID: 'db-block-explicit', viewID: 'view-1', keyIDs: ['key-status'],
        }, enabledActions('set_column_order'), permMgr);
        expect(partial.isError).toBe(true);
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledTimes(1);

        await callAvTool(client, {
            action: 'set_column_order', avID: 'av-1', blockID: 'db-block-explicit', viewID: 'view-1', keyIDs: ['key-status', 'key-title'],
        }, enabledActions('set_column_order'), permMgr);
        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenLastCalledWith(client, [{
            doOperations: [
                { action: 'sortAttrViewCol', avID: 'av-1', blockID: 'db-block-explicit', id: 'key-status', previousID: '' },
                { action: 'sortAttrViewCol', avID: 'av-1', blockID: 'db-block-explicit', id: 'key-title', previousID: 'key-status' },
            ], undoOperations: [],
        }]);
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
