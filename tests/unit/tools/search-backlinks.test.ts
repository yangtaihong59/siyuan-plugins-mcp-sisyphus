import { describe, expect, it, vi } from 'vitest';
import * as api from '@/api/search';
import { getBacklinksWithFallback } from '@/tools/search/sql-builder';
import { callSearchTool } from '@/tools/search';
import * as context from '@/tools/internal/context';
import { parseResult } from '../../helpers/parse-result';

describe('backlink query scope', () => {
    it('preserves empty native global lists without using SQL', async () => {
        vi.spyOn(api, 'getBacklink2').mockResolvedValue({ backlinks: [], backmentions: [] });
        const sql = vi.spyOn(api, 'querySQL');
        await expect(getBacklinksWithFallback({} as any, 'target')).resolves.toEqual({ backlinks: [], backmentions: [] });
        expect(sql).not.toHaveBeenCalled();
    });

    it.each(['HTTP 401 Unauthorized', 'network unavailable'])('propagates native errors without a SQL fallback (%s)', async (message) => {
        vi.spyOn(api, 'getBacklink2').mockRejectedValue(new Error(message));
        const sql = vi.spyOn(api, 'querySQL');
        await expect(getBacklinksWithFallback({} as any, 'target')).rejects.toThrow(message);
        expect(sql).not.toHaveBeenCalled();
    });

    it.each(['links', 'mentions', 'both'] as const)('uses one native global query without a document scope (%s)', async (mode) => {
        const global = vi.spyOn(api, 'getBacklink2').mockResolvedValue({
            backlinks: [{ id: 'reference', box: 'readable' }],
            backmentions: [{ id: 'mention', box: 'readable' }],
        });
        const scopedLinks = vi.spyOn(api, 'getBacklinkDoc');
        const scopedMentions = vi.spyOn(api, 'getBackmentionDoc');
        const sql = vi.spyOn(api, 'querySQL');

        const out = await getBacklinksWithFallback({} as any, 'target', undefined, undefined, mode);

        expect(global).toHaveBeenCalledTimes(1);
        expect(global).toHaveBeenCalledWith(expect.anything(), 'target', undefined);
        expect(out.backlinks).toHaveLength(mode === 'mentions' ? 0 : 1);
        expect(out.backmentions).toHaveLength(mode === 'links' ? 0 : 1);
        expect(out.sourcePayloadMissing).toBeUndefined();
        expect(scopedLinks).not.toHaveBeenCalled();
        expect(scopedMentions).not.toHaveBeenCalled();
        expect(sql).not.toHaveBeenCalled();
    });

    it('keeps legitimate empty scoped results without a SQL fallback', async () => {
        const global = vi.spyOn(api, 'getBacklink2');
        const links = vi.spyOn(api, 'getBacklinkDoc').mockResolvedValue({ backlinks: [], backmentions: [] });
        const mentions = vi.spyOn(api, 'getBackmentionDoc').mockResolvedValue({ backmentions: [] });
        const sql = vi.spyOn(api, 'querySQL');

        const out = await getBacklinksWithFallback({} as any, 'target', 'filter', 'source-doc');

        expect(links).toHaveBeenCalledTimes(1);
        expect(links).toHaveBeenCalledWith(expect.anything(), 'target', 'filter', 'source-doc');
        expect(mentions).toHaveBeenCalledTimes(1);
        expect(mentions).toHaveBeenCalledWith(expect.anything(), 'target', 'filter', 'source-doc');
        expect(out).toEqual({ backlinks: [], backmentions: [] });
        expect(global).not.toHaveBeenCalled();
        expect(sql).not.toHaveBeenCalled();
    });

    it('only falls back for the missing scoped payload and preserves the native half', async () => {
        vi.spyOn(api, 'getBacklinkDoc').mockResolvedValue({ backlinks: [{ id: 'native', box: 'readable' }], backmentions: [] });
        vi.spyOn(api, 'getBackmentionDoc').mockResolvedValue(null);
        const sql = vi.spyOn(api, 'querySQL').mockImplementation(async (_client, stmt) => stmt.includes('SELECT content, name') ? [{ content: 'label' }] : [{ id: 'fallback', box: 'readable' }]);

        const out = await getBacklinksWithFallback({} as any, 'target', undefined, 'source-doc');

        expect(out.backlinks[0]).toMatchObject({ id: 'native' });
        expect(out.backmentions[0]).toMatchObject({ id: 'fallback' });
        expect(out).toMatchObject({ sourcePayloadMissing: true, fallbackQuery: 'sql', resultConfidence: 'fallback' });
        expect(sql.mock.calls.some(([, stmt]) => stmt.includes('FROM spans'))).toBe(false);
        expect(sql.mock.calls.some(([, stmt]) => stmt.includes("root_id = 'source-doc'"))).toBe(true);
    });

    it('denies a restricted reference document before calling the native Doc endpoint', async () => {
        const denied = { isError: true, content: [{ type: 'text', text: '{"error":"permission_denied"}' }] };
        const permission = vi.spyOn(context, 'ensurePermissionForDocumentId')
            .mockResolvedValueOnce({ context: {} as any, denied: null })
            .mockResolvedValueOnce({ context: {} as any, denied } as any);
        const native = vi.spyOn(api, 'getBacklinkDoc');

        const out = await callSearchTool({} as any, { action: 'get_backlinks', id: 'target', scopeRootId: 'restricted' }, { enabled: true, actions: { get_backlinks: true } } as any, {} as any);

        expect(out).toBe(denied);
        expect(permission.mock.calls.map((call) => call[2])).toEqual(['target', 'restricted']);
        expect(native).not.toHaveBeenCalled();
    });

    it('filters restricted and unattributed global results without leaking native totals', async () => {
        vi.spyOn(context, 'ensurePermissionForDocumentId').mockResolvedValue({ context: {} as any, denied: null });
        vi.spyOn(api, 'getBacklink2').mockResolvedValue({
            backlinks: [{ id: 'visible', box: 'readable' }, { id: 'hidden', box: 'restricted' }, { id: 'unattributed' }],
            backmentions: [{ id: 'unknown', box: '' }],
            linkRefsCount: 99,
        } as any);
        const out = parseResult(await callSearchTool({} as any, { action: 'get_backlinks', id: 'target' }, { enabled: true, actions: { get_backlinks: true } } as any, { canRead: (box: string) => box === 'readable' } as any));

        expect(out.backlinks).toHaveLength(1);
        expect(out.backlinks[0].id).toBe('visible');
        expect(out.backmentions).toEqual([]);
        expect(out).toMatchObject({ partial: true, filteredOutCount: 3, reason: 'permission_filtered' });
        expect(out.linkRefsCount).toBeUndefined();
    });
});
