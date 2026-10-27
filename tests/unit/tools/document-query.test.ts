import { describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { DocumentQuerySchema } from '@/tools/document/schemas';
import { callDocumentTool, listDocumentTools } from '@/tools/document';
import { createMockClient } from '../../helpers/mock-client';
import { parseResult } from '../../helpers/parse-result';

const fields = ['id', 'notebook', 'title', 'path', 'hpath', 'created', 'updated', 'blockCount', 'contentChars', 'sameTitleCount'];
const notebooks = [
    { id: 'readable-a', name: 'Research', closed: false },
    { id: 'denied', name: 'Private', closed: false },
    { id: 'readable-b', name: 'Projects', closed: false },
    { id: 'closed', name: 'Archive', closed: true },
];

function fixture(options: {
    notebooks?: typeof notebooks;
    readable?: string[];
    total?: number;
    rows?: Record<string, unknown>[];
    revokeAfterQuery?: string;
} = {}) {
    const config = buildDefaultToolConfig();
    const readable = new Set(options.readable ?? ['readable-a', 'readable-b', 'closed']);
    const statements: string[] = [];
    const rows = options.rows ?? [{
        id: 'doc-a', notebook: 'readable-a', __notebook: 'readable-a', title: 'Empty document', path: '/doc-a.sy', hpath: '/Empty document',
        created: '20261020100000', updated: '20261020110000', blockCount: 0, contentChars: 0, sameTitleCount: 1,
    }];
    const request = vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
        if (endpoint === '/api/notebook/lsNotebooks') return { notebooks: options.notebooks ?? notebooks };
        if (endpoint === '/api/query/sql') {
            const stmt = String(body?.stmt ?? '');
            statements.push(stmt);
            return /SELECT\s+COUNT\s*\(\s*\*\s*\)\s+AS\s+total\b/i.test(stmt)
                ? [{ total: options.total ?? rows.length }]
                : rows;
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
    });
    const client = createMockClient({ request, readFile: async () => JSON.stringify(config) });
    const permMgr = {
        reload: vi.fn(async () => {
            if (statements.length && options.revokeAfterQuery) readable.delete(options.revokeAfterQuery);
        }),
        canRead: vi.fn((id: string) => readable.has(id)),
        get: vi.fn((id: string) => readable.has(id) ? 'r' : 'none'),
    };
    async function query(args: Record<string, unknown> = {}) {
        const result = await callDocumentTool(client, { action: 'query', ...args }, config.document, permMgr as never);
        return { result, payload: parseResult(result) };
    }
    return { query, statements, request, permMgr, config };
}

describe('document.query schema', () => {
    it('is available in the document action schema', () => {
        const [tool] = listDocumentTools(buildDefaultToolConfig().document);
        expect(tool.inputSchema.properties.action.enum).toContain('query');
    });

    it('accepts explicit supported bounds and a strict field projection', () => {
        expect(DocumentQuerySchema.safeParse({
            action: 'query', notebooks: ['readable-a'], fields, title: 'report', hpathPrefix: '/Lab',
            minBlocks: 0, maxBlocks: 10, minChars: 0, maxChars: 500, duplicatesOnly: true,
            sortBy: 'sameTitleCount', sortOrder: 'asc', page: 1000000, pageSize: 100,
        }).success).toBe(true);
    });

    it.each([
        { stmt: 'SELECT * FROM blocks' },
        { sql: 'SELECT * FROM blocks' },
        { extra: true },
        { fields: ['content'] },
        { fields: [] },
        { notebooks: [] },
        { title: '' },
        { hpathPrefix: 'relative/path' },
        { minBlocks: -1 },
        { maxBlocks: 1.5 },
        { minChars: -1 },
        { maxChars: 0.5 },
        { minBlocks: 5, maxBlocks: 4 },
        { minChars: 5, maxChars: 4 },
        { sortBy: 'title; DROP TABLE blocks' },
        { sortOrder: 'descending' },
        { page: 0 },
        { page: 1.5 },
        { page: 1000001 },
        { pageSize: 0 },
        { pageSize: 101 },
    ])('rejects invalid or unrecognized query parameters: %j', (args) => {
        expect(DocumentQuerySchema.safeParse({ action: 'query', ...args }).success).toBe(false);
    });

    it('rejects arbitrary SQL before making any kernel request', async () => {
        const ctx = fixture();
        const { result } = await ctx.query({ stmt: 'SELECT * FROM blocks' });
        expect(result.isError).toBe(true);
        expect(ctx.request).not.toHaveBeenCalled();
    });
});

describe('document.query notebook scope', () => {
    it('queries every readable open notebook, preserving empty documents and default fields', async () => {
        const ctx = fixture();
        const { result, payload } = await ctx.query();
        expect(result.isError).toBeUndefined();
        expect(payload).toMatchObject({
            total: 1, page: 1, pageSize: 50, pageCount: 1, hasNextPage: false,
            scope: { notebooks: ['readable-a', 'readable-b'], excludedClosedNotebooks: ['closed'] },
            data: [{ id: 'doc-a', blockCount: 0, contentChars: 0 }],
        });
        expect(Object.keys(payload.data[0]).sort()).toEqual([...fields].sort());
        expect(payload.readInfo).toMatchObject({ coverage: 'complete' });
        expect(ctx.statements).toHaveLength(2);
        expect(ctx.statements[1]).toMatch(/LIMIT\s+50\s+OFFSET\s+0\b/i);
        expect(ctx.statements[1]).toMatch(/ORDER\s+BY\s+(?:\w+\.)?updated\s+DESC\b/i);
        for (const stmt of ctx.statements) {
            expect(stmt).toContain("'readable-a'");
            expect(stmt).toContain("'readable-b'");
            expect(stmt).not.toContain("'denied'");
            expect(stmt).not.toContain("'closed'");
        }
    });

    it('allows a caller to narrow the scope to a readable notebook', async () => {
        const ctx = fixture();
        const { result, payload } = await ctx.query({ notebooks: ['readable-a'] });
        expect(result.isError).toBeUndefined();
        expect(payload.scope.notebooks).toEqual(['readable-a']);
        for (const stmt of ctx.statements) expect(stmt).not.toContain("'readable-b'");
    });

    it.each(['denied', 'unknown', 'closed'])('rejects an explicit unavailable notebook %s before SQL execution', async (id) => {
        const ctx = fixture();
        const { result, payload } = await ctx.query({ notebooks: ['readable-a', id] });
        expect(result.isError).toBe(true);
        expect(payload.error).toBeDefined();
        expect(ctx.statements).toEqual([]);
    });

    it('returns an empty result without SQL when no notebook is both readable and open', async () => {
        const ctx = fixture({ readable: ['closed'] });
        const { result, payload } = await ctx.query();
        expect(result.isError).toBeUndefined();
        expect(payload).toMatchObject({
            data: [], total: 0, page: 1, pageSize: 50, hasNextPage: false,
            scope: { notebooks: [], excludedClosedNotebooks: ['closed'] },
        });
        expect(ctx.statements).toEqual([]);
    });

    it('only runs the count query when the selected scope contains no matching documents', async () => {
        const ctx = fixture({ total: 0, rows: [] });
        const { result, payload } = await ctx.query();
        expect(result.isError).toBeUndefined();
        expect(payload).toMatchObject({ data: [], total: 0, hasNextPage: false });
        expect(ctx.statements).toHaveLength(1);
    });

    it('withholds results when a scoped notebook loses read permission during the query', async () => {
        const ctx = fixture({ revokeAfterQuery: 'readable-a' });
        const { result, payload } = await ctx.query();
        expect(result.isError).toBe(true);
        expect(payload.data).toBeUndefined();
        expect(ctx.permMgr.reload.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it.each([
        { id: 'leak', notebook: 'denied' },
        { id: 'leak', __notebook: 'denied' },
        { id: 'unattributed' },
    ])('rejects a kernel result outside the authorized notebook scope: %j', async (row) => {
        const ctx = fixture({ rows: [row] });
        const { result, payload } = await ctx.query({ fields: ['id'] });
        expect(result.isError).toBe(true);
        expect(payload.data).toBeUndefined();
    });
});

describe('document.query SQL generation and result projection', () => {
    it('applies notebook scope before document grouping and body metric aggregation', async () => {
        const ctx = fixture();
        await ctx.query({ minBlocks: 0, maxBlocks: 5, minChars: 0, maxChars: 100, duplicatesOnly: true });
        expect(ctx.statements).toHaveLength(2);
        for (const raw of ctx.statements) {
            const sql = raw.replace(/\s+/g, ' ');
            expect(sql).toMatch(/\bscoped_docs\s+AS\s*\(/i);
            expect(sql).toMatch(/\bmetrics\s+AS\s*\(/i);
            expect(sql).toMatch(/COUNT\s*\(\s*\*\s*\)/i);
            expect(sql).toMatch(/SUM\s*\(\s*(?:COALESCE\s*\(\s*)?LENGTH\s*\(/i);
            expect(sql).toMatch(/GROUP\s+BY\s+(?:\w+\.)?box\s*,\s*(?:\w+\.)?root_id/i);
            expect(sql).toMatch(/LEFT\s+JOIN\s+metrics\b/i);
            // Every base blocks read must independently enforce the readable notebook set.
            const baseReads = [...sql.matchAll(/\bFROM\s+blocks\s+(?:AS\s+)?(\w+)\b/gi)];
            expect(baseReads.length).toBeGreaterThanOrEqual(2);
            for (const [, alias] of baseReads) {
                expect(sql).toMatch(new RegExp(`\\b${alias}\\.box\\s+IN\\s*\\(\\s*'readable-a'\\s*,\\s*'readable-b'\\s*\\)`, 'i'));
            }
            expect(sql).toMatch(/(?:\w+\.)?type\s*(?:!=|<>)\s*'d'/i);
        }
    });

    it('treats quotes, SQL-looking text, percent and underscore as literal filter text', async () => {
        const title = "O'Reilly_%' OR 1=1 --";
        const hpathPrefix = "/Lab/_%' OR 2=2 --";
        const ctx = fixture();
        await ctx.query({ title, hpathPrefix });
        for (const stmt of ctx.statements) {
            expect(stmt).toContain(title.replace(/'/g, "''"));
            expect(stmt).toContain(hpathPrefix.replace(/'/g, "''"));
            const withoutLiterals = stmt.replace(/'(?:''|[^'])*'/g, "''");
            expect(withoutLiterals).not.toMatch(/OR\s+[12]\s*=\s*[12]\s*--/i);
            // INSTR/substr or an escaped LIKE is required; raw LIKE changes literal _/% semantics.
            expect(stmt).toMatch(/\b(?:instr|substr)\s*\(|\bESCAPE\b/i);
        }
    });

    it('keeps the title duplicate count before body metric and duplicates-only filters', async () => {
        const ctx = fixture({ rows: [{ id: 'doc-a', notebook: 'readable-a', __notebook: 'readable-a', sameTitleCount: 3 }] });
        const { payload } = await ctx.query({
            title: 'Shared', hpathPrefix: '/Lab', minBlocks: 2, maxBlocks: 4,
            minChars: 10, maxChars: 200, duplicatesOnly: true,
            fields: ['id', 'notebook', 'sameTitleCount'],
        });
        expect(payload.data[0].sameTitleCount).toBe(3);
        for (const stmt of ctx.statements) {
            const duplicatePosition = stmt.search(/\b(?:sameTitleCount|title_counts)\b/i);
            const metricFilterPosition = stmt.search(/(?:COALESCE\s*\(\s*)?(?:\w+\.)?blockCount(?:\s*,\s*0\s*\))?\s*>=\s*2\b/i);
            expect(duplicatePosition).toBeGreaterThanOrEqual(0);
            expect(metricFilterPosition).toBeGreaterThan(duplicatePosition);
            expect(stmt).toMatch(/(?:COALESCE\s*\(\s*)?(?:\w+\.)?blockCount(?:\s*,\s*0\s*\))?\s*<=\s*4\b/i);
            expect(stmt).toMatch(/(?:COALESCE\s*\(\s*)?(?:\w+\.)?contentChars(?:\s*,\s*0\s*\))?\s*>=\s*10\b/i);
            expect(stmt).toMatch(/(?:COALESCE\s*\(\s*)?(?:\w+\.)?contentChars(?:\s*,\s*0\s*\))?\s*<=\s*200\b/i);
            expect(stmt).toMatch(/\bsameTitleCount\s*>\s*1\b/i);
        }
    });

    it('strips the internal notebook guard column from a projected result', async () => {
        const ctx = fixture({ rows: [{ id: 'doc-a', title: 'Alpha', __notebook: 'readable-a' }] });
        const { result, payload } = await ctx.query({ fields: ['id', 'title'] });
        expect(result.isError).toBeUndefined();
        expect(payload.data).toEqual([{ id: 'doc-a', title: 'Alpha' }]);
        expect(ctx.statements[1]).toMatch(/\bbox\s+AS\s+__notebook\b/i);
    });

    it('does not silently add default columns to an explicit notebook projection', async () => {
        const ctx = fixture({ rows: [{ notebook: 'readable-a', __notebook: 'readable-a', title: 'Alpha' }] });
        const { result, payload } = await ctx.query({ fields: ['notebook', 'title'] });
        expect(result.isError).toBeUndefined();
        expect(payload.data).toEqual([{ notebook: 'readable-a', title: 'Alpha' }]);
        expect(Object.keys(payload.data[0]).sort()).toEqual(['notebook', 'title']);
    });
});

describe('document.query pagination and read continuation', () => {
    it('preserves every caller filter and projection when suggesting the next page', async () => {
        const ctx = fixture({ total: 7, rows: [{ id: 'doc-a', __notebook: 'readable-a' }] });
        const args = {
            notebooks: ['readable-a'], fields: ['id'], title: 'Report', hpathPrefix: '/Research',
            minBlocks: 0, maxBlocks: 5, minChars: 0, maxChars: 1000, duplicatesOnly: true,
            sortBy: 'title', sortOrder: 'asc', page: 2, pageSize: 2,
        };
        const { result, payload } = await ctx.query(args);
        expect(result.isError).toBeUndefined();
        expect(payload).toMatchObject({ total: 7, page: 2, pageSize: 2, pageCount: 4, hasNextPage: true });
        expect(payload.readInfo).toMatchObject({ coverage: 'partial' });
        expect(ctx.statements[1]).toMatch(/ORDER\s+BY\s+(?:\w+\.)?title\s+ASC\b/i);
        expect(ctx.statements[1]).toMatch(/LIMIT\s+2\s+OFFSET\s+2\b/i);
        const next = payload.nextSteps.find((step: any) => step.purpose === 'continue_read');
        expect(next).toMatchObject({ tool: 'document', arguments: { action: 'query', ...args, page: 3 } });
    });

    it('does not invent a continuation after the last page or beyond the available range', async () => {
        const ctx = fixture({ total: 2, rows: [] });
        const { result, payload } = await ctx.query({ page: 5, pageSize: 1 });
        expect(result.isError).toBeUndefined();
        expect(payload).toMatchObject({ data: [], total: 2, page: 5, pageSize: 1, pageCount: 2, hasNextPage: false });
        expect((payload.nextSteps ?? []).some((step: any) => step.purpose === 'continue_read')).toBe(false);
        expect(ctx.statements[1]).toMatch(/LIMIT\s+1\s+OFFSET\s+4\b/i);
    });

    it('does not advertise a continuation beyond the schema page limit', async () => {
        const ctx = fixture({ total: 1000001, rows: [] });
        const { payload } = await ctx.query({ page: 1000000, pageSize: 1 });
        expect(payload.hasNextPage).toBe(true);
        expect(payload.nextSteps).toBeUndefined();
        expect(payload.readInfo.limitations).toContain('page_limit');
    });
});
