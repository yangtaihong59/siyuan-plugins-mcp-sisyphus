import { describe, expect, it, vi } from 'vitest';
import { WriteSafetyCoordinator } from '@/core/write-safety-coordinator';
import { AvUpdateViewSchema } from '@/tools/av/schemas';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { createJsonResult } from '@/tools/internal/shared';

function fixture(type = 'table') {
    const fields = [{ id: 'title', hidden: false, width: '100px' }, { id: 'status', hidden: true, width: '80px' }];
    const definition: any = { id: 'av-1', keyValues: [{ key: { id: 'title', type: 'block' }, values: [] }, { key: { id: 'status', type: 'select' }, values: [] }], views: [
        { id: 'view-1', type, filters: [], sorts: [], [type]: { [type === 'table' ? 'columns' : 'fields']: fields } },
        { id: 'other', type: 'table', filters: [], table: { columns: [] } },
    ] };
    let selected = 'view-1';
    const client: any = {
        readFile: async () => '', writeFile: async () => undefined,
        requestRead: async (endpoint: string) => {
            if (endpoint === '/api/av/getAttributeView') return { av: structuredClone(definition) };
            if (endpoint === '/api/attr/getBlockAttrs') return { 'custom-sy-av-view': selected };
            if (endpoint === '/api/block/getBlockDOM') return { dom: '<div data-type="NodeAttributeView" data-av-id="av-1"></div>' };
            if (endpoint === '/api/block/getBlockInfo') return { box: 'nb-1' };
            return null;
        },
    };
    const permMgr = createMockPermissionManager({ canWrite: () => true });
    permMgr.getAll = () => ({ 'nb-1': 'rw' });
    const coordinator = new WriteSafetyCoordinator(client);
    const run = (args: any, execute: any) => coordinator.run({ client, permMgr, category: 'av', action: 'update_view', args, strictMode: true, validateArgs: value => { AvUpdateViewSchema.parse(value); }, execute });
    const payload = (r: any) => r.structuredContent ?? JSON.parse(r.content[0].text);
    return { definition, fields, run, payload, select: (id: string) => { selected = id; } };
}
const base = { action: 'update_view', avID: 'av-1', blockID: 'carrier', viewID: 'view-1' };

describe('combined view protection', () => {
    it.each(['table', 'gallery', 'kanban'])('verifies all requested settings together for %s', async type => {
        const f = fixture(type);
        const args = { ...base, filters: [], sorts: [{ column: 'status', order: 'DESC' }], group: { field: 'status', method: 0, order: 0, hideEmpty: true }, columnVisibility: [{ columnID: 'title', hidden: true }], columnOrder: ['status', 'title'] };
        const pre = f.payload(await f.run({ ...args, validateOnly: true }, vi.fn()));
        const execute = vi.fn(async () => {
            const view = f.definition.views[0];
            view.filters = [{ combination: 'and' }]; view.sorts = args.sorts;
            view.group = { ...args.group, order: 3 }; view.groups = []; view.groupCreated = Date.now();
            f.fields[0].hidden = true; f.fields.reverse();
            return createJsonResult({ success: true });
        });
        const result = f.payload(await f.run({ ...args, requestId: pre.requestId, expectedStateHash: pre.expectedStateHash }, execute));
        expect(result.safety?.transactionState).toBe('committed');
        expect(execute).toHaveBeenCalledTimes(1);
    });
    it.each(['unlisted_visibility', 'column_attribute', 'other_view', 'unrequested_sort'])('does not exempt %s from combined protection', async drift => {
        const f = fixture(); const args = { ...base, columnVisibility: [{ columnID: 'title', hidden: true }], columnOrder: ['status', 'title'] };
        const pre = f.payload(await f.run({ ...args, validateOnly: true }, vi.fn()));
        const result = f.payload(await f.run({ ...args, requestId: pre.requestId, expectedStateHash: pre.expectedStateHash }, async () => {
            f.fields[0].hidden = true;
            if (drift === 'unlisted_visibility') f.fields[1].hidden = false;
            if (drift === 'column_attribute') f.fields[0].width = '200px';
            if (drift === 'other_view') f.definition.views[1].filters = [{ column: 'title' }];
            if (drift === 'unrequested_sort') f.definition.views[0].sorts = [{ column: 'title', order: 'ASC' }];
            f.fields.reverse(); return createJsonResult({ success: true });
        }));
        expect(result.error.code).toBe('readback_mismatch');
        expect(result.error.cause).toContain('Complete verification failed');
    });
    it('rejects changed carrier selection before dispatch', async () => {
        const f = fixture(); const args = { ...base, filters: [] };
        const pre = f.payload(await f.run({ ...args, validateOnly: true }, vi.fn()));
        f.select('other'); const execute = vi.fn();
        expect((await f.run({ ...args, requestId: pre.requestId, expectedStateHash: pre.expectedStateHash }, execute)).isError).toBe(true);
        expect(execute).not.toHaveBeenCalled();
    });
    it('rejects unsupported layout during preflight', async () => {
        const f = fixture('unsupported'); const execute = vi.fn();
        expect((await f.run({ ...base, filters: [], validateOnly: true }, execute)).isError).toBe(true);
        expect(execute).not.toHaveBeenCalled();
    });
});
