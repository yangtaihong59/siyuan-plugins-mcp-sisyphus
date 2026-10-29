import { describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { callSearchTool } from '@/tools/search';
import { createMockClient } from '../../helpers/mock-client';
import { parseResult } from '../../helpers/parse-result';

const sqlEntrypoints = [
    { name: 'query_sql stmt', args: { action: 'query_sql' }, sqlKey: 'stmt', endpoint: '/api/query/sql' },
    { name: 'query_sql sql alias', args: { action: 'query_sql' }, sqlKey: 'sql', endpoint: '/api/query/sql' },
    { name: 'fulltext numeric SQL method', args: { action: 'fulltext', method: 2 }, sqlKey: 'query', endpoint: '/api/search/fullTextSearchBlock' },
    { name: 'fulltext SQL method alias', args: { action: 'fulltext', method: 0, methodName: 'sql' }, sqlKey: 'query', endpoint: '/api/search/fullTextSearchBlock' },
];

describe.each(sqlEntrypoints)('$name notebook scope', ({ args, sqlKey, endpoint }) => {
    // query_sql switches to restricted mode instead (see search-restricted-sql.test.ts).
    it.runIf(endpoint !== '/api/query/sql')('reloads permissions and refuses SQL before either SQL endpoint is called', async () => {
        let readable = true;
        const reload = vi.fn(async () => { readable = false; });
        const permMgr = { reload, canRead: (id: string) => id !== 'blocked' || readable };
        const request = vi.fn(async (path: string) => {
            expect(readable).toBe(false);
            if (path === '/api/notebook/lsNotebooks') return {
                notebooks: [{ id: 'allowed', name: 'Allowed' }, { id: 'blocked', name: 'Blocked' }],
            };
            throw new Error(`SQL must not execute: ${path}`);
        });
        const result = await callSearchTool(createMockClient({ request }), {
            ...args, [sqlKey]: 'SELECT COUNT(*) AS content FROM blocks',
        }, buildDefaultToolConfig().search, permMgr as never);

        expect(result.isError).toBe(true);
        expect(parseResult(result).error).toMatchObject({
            type: 'permission_denied',
            code: 'raw_sql_unavailable_with_restricted_notebooks',
            reason: 'permission_scope_not_enforceable',
            restrictedNotebookCount: 1,
        });
        expect(parseResult(result).error.hint).toContain('document(action="query")');
        expect(reload).toHaveBeenCalledOnce();
        expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/notebook/lsNotebooks']);
    });

    it.each([
        'WITH doomed AS (SELECT id FROM blocks) DELETE FROM blocks WHERE id IN doomed',
        'SELECT * FROM blocks; DELETE FROM blocks',
    ])('rejects unsafe SQL without loading permissions or calling the kernel: %s', async (stmt) => {
        const request = vi.fn();
        const reload = vi.fn(async () => undefined);
        const result = await callSearchTool(createMockClient({ request }), {
            ...args, [sqlKey]: stmt,
        }, buildDefaultToolConfig().search, { reload, canRead: () => true } as never);

        expect(result.isError).toBe(true);
        expect(parseResult(result).error.message).toContain('Only SELECT statements');
        expect(reload).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });

    it('executes SQL when the refreshed permissions allow every notebook', async () => {
        let readable = false;
        const reload = vi.fn(async () => { readable = true; });
        const permMgr = { reload, canRead: () => readable };
        const stmt = "SELECT box, content FROM blocks WHERE type = 'd' LIMIT 1";
        const request = vi.fn(async (path: string, body: unknown) => {
            expect(readable).toBe(true);
            if (path === '/api/notebook/lsNotebooks') return {
                notebooks: [{ id: 'allowed', name: 'Allowed' }, { id: 'blocked', name: 'Now readable' }],
            };
            expect(path).toBe(endpoint);
            expect(body).toMatchObject(endpoint === '/api/query/sql' ? { stmt } : { query: stmt, method: 2 });
            const blocks = [{ box: 'allowed', content: 'Readable document' }];
            return endpoint === '/api/query/sql' ? blocks : { blocks, matchedBlockCount: 1, pageCount: 1 };
        });
        const result = await callSearchTool(createMockClient({ request }), {
            ...args, [sqlKey]: stmt,
        }, buildDefaultToolConfig().search, permMgr as never);

        expect(result.isError).not.toBe(true);
        expect(parseResult(result).data).toEqual([expect.objectContaining({ box: 'allowed', content: 'Readable document' })]);
        expect(reload).toHaveBeenCalledOnce();
        expect(request.mock.calls[0][0]).toBe('/api/notebook/lsNotebooks');
        expect(request.mock.calls.filter(([path]) => path === endpoint)).toHaveLength(1);
    });
});

describe('SQL scope guard failures and non-SQL searches', () => {
    it.each(sqlEntrypoints)('fails closed for $name when permission reload fails', async ({ args, sqlKey }) => {
        const request = vi.fn();
        const result = await callSearchTool(createMockClient({ request }), {
            ...args, [sqlKey]: 'SELECT * FROM blocks LIMIT 1',
        }, buildDefaultToolConfig().search, {
            reload: async () => { throw new Error('Permissions unavailable'); },
            canRead: () => true,
        } as never);

        expect(result.isError).toBe(true);
        expect(parseResult(result).error.message).toContain('Permissions unavailable');
        expect(request).not.toHaveBeenCalled();
    });

    it.each([
        { method: 0 },
        { method: 2, methodName: 'keyword' },
    ])('keeps keyword search available when another notebook is unreadable: %j', async (methodArgs) => {
        const reload = vi.fn(async () => undefined);
        const request = vi.fn(async (path: string, body: unknown) => {
            expect(path).toBe('/api/search/fullTextSearchBlock');
            expect(body).toMatchObject({ query: 'SELECT is a keyword here', method: 0 });
            return { blocks: [], matchedBlockCount: 0, pageCount: 1 };
        });
        const result = await callSearchTool(createMockClient({ request }), {
            action: 'fulltext', query: 'SELECT is a keyword here', ...methodArgs,
        }, buildDefaultToolConfig().search, { reload, canRead: (id: string) => id !== 'blocked' } as never);

        expect(result.isError).not.toBe(true);
        expect(parseResult(result).data).toEqual([]);
        expect(reload).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledOnce();
    });
});
