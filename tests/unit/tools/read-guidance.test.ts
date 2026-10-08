import { describe, expect, it } from 'vitest';
import { buildDefaultToolConfig } from '@/core/config';
import { availableReadSteps, documentReadInfo, databaseReadSteps } from '@/tools/internal/read-guidance';
import { viewReadState } from '@/tools/av/read-context';
import { slimToolResult } from '@/core/slim-response';
import { createJsonResult } from '@/tools/internal/shared';

describe('read guidance', () => {
    it('does not confuse the last window with the complete document', () => {
        expect(documentReadInfo({ blockStart: 10, hasNextWindow: false, totalBlocks: 12 }).coverage).toBe('partial');
        expect(documentReadInfo({ blockStart: 0, hasNextWindow: false, totalBlocks: null }).coverage).toBe('unknown');
        expect(documentReadInfo({ blockStart: 0, hasNextWindow: false, totalBlocks: 12 }, ['av']).limitations)
            .toContain('database_contents_not_included');
        expect(documentReadInfo({ blockStart: 0, hasNextWindow: false, totalBlocks: 0 }).coverage).toBe('complete');
    });

    it('uses canonical IDs and never invents an AV ID', () => {
        expect(databaseReadSteps([{ blockID: 'carrier' }])).toEqual([]);
        expect(databaseReadSteps([{ blockID: 'carrier', avID: 'database' }])[0].arguments)
            .toEqual({ action: 'get', avID: 'database', blockID: 'carrier' });
    });

    it('omits disabled actions, mutation suggestions and unverified configuration', async () => {
        const config = buildDefaultToolConfig();
        config.av.actions.get = false;
        const client = { readFile: async () => JSON.stringify(config) } as any;
        const steps = [
            ...databaseReadSteps([{ avID: 'db', blockID: 'carrier' }]),
            { purpose: 'read_view', tool: 'av' as const, arguments: { action: 'render', avID: 'db', createIfNotExist: true } },
            { purpose: 'help', tool: 'av' as const, arguments: { action: 'help', topic: 'set_cells' } },
        ];
        expect((await availableReadSteps(client, steps)).map(step => step.arguments.action)).toEqual(['help']);
        config.av.actions.set_cells = false;
        expect(await availableReadSteps(client, steps)).toEqual([]);
        expect(await availableReadSteps({ readFile: async () => { throw new Error('unavailable'); } } as any, steps)).toEqual([]);
    });

    it('preserves executable nested arguments through response slimming', () => {
        const nextSteps = [{ purpose: 'continue_read', tool: 'search', arguments: {
            action: 'fulltext', query: 'needle', parentId: 'parent', hasTags: true, page: 2, types: { paragraph: true },
        } }];
        const result = slimToolResult(createJsonResult({ nextSteps }), { category: 'search', action: 'fulltext' });
        expect(JSON.parse(result.content[0].text).nextSteps).toEqual(nextSteps);
    });

    it('advances independently paged groups without repeating finished groups', () => {
        const args = { action: 'render', avID: 'db', viewID: 'view', query: 'needle', page: 1, pageSize: 2,
            groupPaging: { a: { page: 2, pageSize: 1 }, b: { page: 1, pageSize: 2 } } };
        const view = { groups: [{ id: 'a', rowCount: 3 }, { id: 'b', rowCount: 1 }] };
        const state = viewReadState(view, args, 2);
        expect(state.readInfo.coverage).toBe('partial');
        expect(state.next).toMatchObject({ avID: 'db', viewID: 'view', query: 'needle', createIfNotExist: false,
            groupPaging: { a: { page: 3, pageSize: 1 }, b: { page: 2, pageSize: 2 } } });
        expect(viewReadState(view, state.next!, 2).next).toBeUndefined();
    });

    it('never treats inferred row totals or missing group IDs as complete pagination', () => {
        expect(viewReadState({ rows: [] }, {}, 20).readInfo.coverage).toBe('unknown');
        const state = viewReadState({ groups: [{ rowCount: 21 }] }, {}, 20);
        expect(state.readInfo.coverage).toBe('unknown');
        expect(state.next).toBeUndefined();
        expect(viewReadState({ rowCount: 0 }, { page: 1 }, 20).readInfo.coverage).toBe('complete');
    });
});
