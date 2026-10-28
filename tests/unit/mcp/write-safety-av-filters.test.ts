import { describe, expect, it, vi } from 'vitest';
import { WriteSafetyCoordinator } from '@/mcp/write-safety-coordinator';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';
import { requestError } from '../../helpers/request-error';

describe('strict AV native select filter readback', () => {
    it.each([
        { type: 'select', color: undefined, observedColor: '', changed: false },
        { type: 'mSelect', color: undefined, observedColor: '', changed: false },
        { type: 'select', color: '', observedColor: '', changed: false },
        { type: 'mSelect', color: '3', observedColor: '3', changed: false },
        { type: 'select', color: '3', observedColor: '4', changed: true },
        { type: 'select', color: undefined, observedColor: '4', changed: true },
    ])('commits only an equivalent native filter: %j', async ({ type, color, observedColor, changed }) => {
        const avID = 'fixture-filter-av', blockID = 'fixture-filter-carrier', viewID = 'fixture-filter-view';
        const definition: Record<string, any> = { id: avID, viewID, keyValues: [{ key: { id: 'status', type }, values: [] }], views: [{
            id: viewID, type: 'table', name: 'Table', filters: [], sorts: [], table: { columns: [{ id: 'status', hidden: false }] },
        }] };
        const client = {
            readFile: vi.fn(async () => { throw requestError('HTTP error: 404 Not Found'); }),
            writeFile: vi.fn(async () => undefined),
            requestRead: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/av/getAttributeView') return { av: structuredClone(definition) };
                if (endpoint === '/api/attr/getBlockAttrs') return { 'custom-sy-av-view': viewID };
                if (endpoint === '/api/block/getBlockDOM') return { id: blockID, dom: `<div data-type="NodeAttributeView" data-av-id="${avID}" custom-sy-av-view="${viewID}"></div>` };
                if (endpoint === '/api/block/getBlockInfo') return { id: blockID, box: 'nb-1' };
                return null;
            }),
        } as any;
        const permMgr = createMockPermissionManager({ canWrite: () => true });
        permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rw' }));
        const coordinator = new WriteSafetyCoordinator(client);
        const filters = [{ column: 'status', operator: '=', value: { type, mSelect: [{ content: '待办', ...(color === undefined ? {} : { color }) }] } }];
        const args = { action: 'update_view', avID, blockID, viewID, filters };
        const preflight = parseResult(await coordinator.run({ client, permMgr, category: 'av', action: 'update_view', args: { ...args, validateOnly: true }, strictMode: true, execute: vi.fn() }));
        const execute = vi.fn(async () => {
            definition.views[0].filters = [{ column: '', operator: '', value: null, combination: 'and', filters: [{ column: 'status', operator: '=', value: { type, mSelect: [{ content: '待办', color: observedColor }] } }] }];
            const out = { success: true, action: 'update_view' };
            return { content: [{ type: 'text' as const, text: JSON.stringify(out) }], structuredContent: out };
        });
        const input = { ...args, requestId: preflight.requestId, expectedStateHash: preflight.expectedStateHash };
        const result = parseResult(await coordinator.run({ client, permMgr, category: 'av', action: 'update_view', args: input, strictMode: true, execute }));
        if (changed) expect(result).toMatchObject({ transactionState: 'unknown', error: { code: 'readback_mismatch' } });
        else {
            expect(result.safety).toMatchObject({ transactionState: 'committed', writeSafetyGuaranteed: true });
            const replay = parseResult(await coordinator.run({ client, permMgr, category: 'av', action: 'update_view', args: input, strictMode: true, execute }));
            expect((replay.safety ?? replay).replayed).toBe(true);
        }
        expect(execute).toHaveBeenCalledTimes(1);
    });
});
