import * as notebookApi from '../../api/notebook';
import * as searchApi from '../../api/search';
import { DOCUMENT_QUERY_FIELDS, DocumentQuerySchema } from './schemas';
import { escapeSqlString } from '../../shared/sql';
import type { ToolActionHandler } from '../internal/define-tool';
import { availableReadSteps } from '../internal/read-guidance';
import { createPaginatedResult, createPermissionDeniedResult } from '../internal/shared';

// These expressions are owned by the server. No caller-supplied SQL, column,
// operator, or sort expression is interpolated into the query.
const COLUMNS = {
    id: 'd.id', notebook: 'd.box', title: 'd.title', path: 'd.path',
    hpath: 'd.hpath', created: 'd.created', updated: 'd.updated',
    blockCount: 'COALESCE(m.blockCount, 0)',
    contentChars: 'COALESCE(m.contentChars, 0)',
    sameTitleCount: 't.sameTitleCount',
} as const;

export const handleDocumentQuery: ToolActionHandler = async ({ client, permMgr, rawArgs }) => {
    const args = DocumentQuerySchema.parse(rawArgs);
    await permMgr.reload();
    const { notebooks } = await notebookApi.listNotebooks(client);
    const requested = args.notebooks ? [...new Set(args.notebooks)] : undefined;
    if (requested) {
        for (const id of requested) {
            if (!permMgr.canRead(id)) return createPermissionDeniedResult(id, permMgr.get(id), 'read');
            const notebook = notebooks.find(notebook => notebook.id === id);
            if (!notebook) throw new Error(`Notebook "${id}" not found.`);
            if (notebook.closed) throw new Error(`Notebook "${id}" is closed. Open it before using document.query.`);
        }
    }
    const readable = notebooks.filter(notebook => permMgr.canRead(notebook.id)
        && (!requested || requested.includes(notebook.id)));
    const scope = {
        notebooks: readable.filter(notebook => !notebook.closed).map(notebook => notebook.id),
        excludedClosedNotebooks: readable.filter(notebook => notebook.closed).map(notebook => notebook.id),
    };
    const page = args.page ?? 1;
    const pageSize = args.pageSize ?? 50;
    const fields = [...new Set(args.fields ?? DOCUMENT_QUERY_FIELDS)];
    const sortBy = args.sortBy ?? 'updated';
    const direction = args.sortOrder === 'asc' ? 'ASC' : 'DESC';
    let total = 0;
    let data: Record<string, unknown>[] = [];

    if (scope.notebooks.length > 0) {
        const boxes = scope.notebooks.map(id => `'${escapeSqlString(id)}'`).join(', ');
        const docFilters = ["b.type = 'd'", `b.box IN (${boxes})`];
        if (args.title !== undefined) docFilters.push(`instr(b.content, '${escapeSqlString(args.title)}') > 0`);
        const prefix = args.hpathPrefix?.replace(/\/+$/, '') || '/';
        if (args.hpathPrefix !== undefined && prefix !== '/') {
            const literal = escapeSqlString(prefix);
            // substr avoids treating '%' and '_' in a human path as wildcards.
            docFilters.push(`(b.hpath = '${literal}' OR substr(b.hpath, 1, length('${literal}/')) = '${literal}/')`);
        }
        const needsMetrics = fields.some(field => field === 'blockCount' || field === 'contentChars')
            || sortBy === 'blockCount' || sortBy === 'contentChars'
            || [args.minBlocks, args.maxBlocks, args.minChars, args.maxChars].some(value => value !== undefined);
        const needsTitles = args.duplicatesOnly || fields.includes('sameTitleCount') || sortBy === 'sameTitleCount';
        const ctes = [`scoped_docs AS (
            SELECT b.id, b.box, COALESCE(b.content, '') AS title, b.path, b.hpath, b.created, b.updated
            FROM blocks b WHERE ${docFilters.join(' AND ')}
        )`];
        const joins: string[] = [];
        if (needsMetrics) {
            ctes.push(`metrics AS (
                SELECT b.box, b.root_id, COUNT(*) AS blockCount,
                    COALESCE(SUM(length(b.content)), 0) AS contentChars
                FROM blocks b INNER JOIN scoped_docs s ON s.id = b.root_id AND s.box = b.box
                WHERE b.box IN (${boxes}) AND b.type != 'd'
                GROUP BY b.box, b.root_id
            )`);
            joins.push('LEFT JOIN metrics m ON m.root_id = d.id AND m.box = d.box');
        }
        if (needsTitles) {
            ctes.push('titles AS (SELECT title, COUNT(*) AS sameTitleCount FROM scoped_docs GROUP BY title)');
            joins.push('LEFT JOIN titles t ON t.title = d.title');
        }
        const filters: string[] = [];
        for (const [key, field, operator] of [
            ['minBlocks', 'blockCount', '>='], ['maxBlocks', 'blockCount', '<='],
            ['minChars', 'contentChars', '>='], ['maxChars', 'contentChars', '<='],
        ] as const) {
            if (args[key] !== undefined) filters.push(`${COLUMNS[field]} ${operator} ${args[key]}`);
        }
        if (args.duplicatesOnly) filters.push('t.sameTitleCount > 1');
        const withClause = `WITH ${ctes.join(',\n')}`;
        const fromClause = `FROM scoped_docs d ${joins.join(' ')}${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''}`;
        const countRows = await searchApi.querySQL(client, `${withClause} SELECT COUNT(*) AS total ${fromClause}`);
        const count = (countRows[0] as Record<string, unknown> | undefined)?.total;
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
            throw new Error('Document query returned an invalid indexed document count.');
        }
        total = count;
        if (total > 0) {
            const projection = fields.map(field => `${COLUMNS[field]} AS ${field}`).join(', ');
            const order = `${COLUMNS[sortBy]} ${direction}${sortBy === 'id' ? '' : `, d.id ${direction}`}`;
            const rows = await searchApi.querySQL(client,
                `${withClause} SELECT ${projection}, d.box AS __notebook ${fromClause} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
            data = rows.map(row => {
                const item = row as Record<string, unknown>;
                if (!item || typeof item !== 'object' || !scope.notebooks.includes(String(item.__notebook))) {
                    throw new Error('Document query returned a row outside the authorized notebook scope.');
                }
                return Object.fromEntries(fields.map(field => [field, item[field]]));
            });
        }
        // Aggregate values cannot be post-filtered after a permission change.
        // Reject the entire result instead of returning stale-authorized data.
        await permMgr.reload();
        for (const id of scope.notebooks) {
            if (!permMgr.canRead(id)) return createPermissionDeniedResult(id, permMgr.get(id), 'read');
        }
    }
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const hasNextPage = page < pageCount;
    const nextSteps = await availableReadSteps(client, hasNextPage && page < 1000000 ? [{
        purpose: 'continue_read', tool: 'document',
        arguments: { ...args, notebooks: scope.notebooks, page: page + 1, pageSize },
    }] : []);
    return createPaginatedResult(data, { total, page, pageSize, pageCount, hasNextPage }, {
        scope,
        readInfo: {
            scope: 'sql_query', representation: 'sql_rows',
            coverage: page > 1 || hasNextPage ? 'partial' : 'complete',
            limitations: ['sql_index_may_lag', 'not_a_snapshot', 'indexed_content_not_display_text',
                ...(hasNextPage && page === 1000000 ? ['page_limit'] : []),
                ...(scope.excludedClosedNotebooks.length ? ['closed_notebooks_excluded'] : [])],
        },
        metrics: {
            blockCount: 'Non-document indexed block rows, including container blocks; document titles excluded.',
            contentChars: 'Sum of SQLite length(content) over those rows; not bytes, native word count, or deduplicated display text.',
            sameTitleCount: 'Title frequency within the selected notebook/title/hpath scope, before block/character filters; not proof of duplicate content.',
        },
        ...(nextSteps.length ? { nextSteps } : {}),
    });
};
