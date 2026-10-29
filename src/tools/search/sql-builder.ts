import type { SiYuanClient } from '../../api/client';
import * as notebookApi from '../../api/notebook';
import * as searchApi from '../../api/search';
import type { PermissionManager } from '../../core/permissions';
import { escapeSqlString } from '../../shared/sql';
import type { ToolResult } from '../internal/shared';

function escapeSqlLike(value: string): string {
    return value
        .replace(/\0/g, '')
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
        .replace(/'/g, "''");
}

const READ_ONLY_SQL_ERROR = 'Only SELECT statements and WITH CTEs whose main statement is SELECT are allowed. Mutation queries (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE) are forbidden.';

/**
 * A statement query_sql never runs (mutation, PRAGMA, EXPLAIN, multiple
 * statements). Caller-correctable: `code` maps it to permission_denied, the
 * same family as restricted-mode rejections, never internal_error.
 */
export class SqlStatementRejectedError extends Error {
    readonly code = 'permission_denied';
    constructor(message: string, readonly hint?: string) {
        super(message);
        this.name = 'SqlStatementRejectedError';
    }
}

function maskSqlLiteralsAndComments(stmt: string): string {
    let result = '';
    let index = 0;

    while (index < stmt.length) {
        const current = stmt[index];
        const next = stmt[index + 1];

        if (current === '-' && next === '-') {
            result += '  ';
            index += 2;
            while (index < stmt.length && stmt[index] !== '\n') {
                result += ' ';
                index += 1;
            }
            continue;
        }

        if (current === '/' && next === '*') {
            result += '  ';
            index += 2;
            while (index < stmt.length) {
                if (stmt[index] === '*' && stmt[index + 1] === '/') {
                    result += '  ';
                    index += 2;
                    break;
                }
                result += stmt[index] === '\n' ? '\n' : ' ';
                index += 1;
            }
            continue;
        }

        if (current === '\'' || current === '"' || current === '`') {
            const quote = current;
            result += ' ';
            index += 1;
            while (index < stmt.length) {
                const char = stmt[index];
                result += char === '\n' ? '\n' : ' ';
                index += 1;
                if (char === quote) {
                    if ((quote === '\'' || quote === '"') && stmt[index] === quote) {
                        result += ' ';
                        index += 1;
                        continue;
                    }
                    break;
                }
            }
            continue;
        }

        if (current === '[') {
            result += ' ';
            index += 1;
            while (index < stmt.length) {
                const char = stmt[index];
                result += char === '\n' ? '\n' : ' ';
                index += 1;
                if (char === ']') break;
            }
            continue;
        }

        result += current;
        index += 1;
    }

    return result;
}

function skipWhitespace(value: string, index: number): number {
    while (index < value.length && /\s/.test(value[index])) index += 1;
    return index;
}

function readKeyword(value: string, index: number): { keyword: string; end: number } | null {
    const start = skipWhitespace(value, index);
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.slice(start));
    if (!match) return null;
    return { keyword: match[0].toUpperCase(), end: start + match[0].length };
}

function skipIdentifier(value: string, index: number): number {
    const start = skipWhitespace(value, index);
    const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(value.slice(start));
    if (!match) throw new SqlStatementRejectedError(READ_ONLY_SQL_ERROR);
    return start + match[0].length;
}

function skipBalancedParens(value: string, index: number): number {
    const start = skipWhitespace(value, index);
    if (value[start] !== '(') throw new SqlStatementRejectedError(READ_ONLY_SQL_ERROR);

    let depth = 0;
    for (let cursor = start; cursor < value.length; cursor += 1) {
        if (value[cursor] === '(') depth += 1;
        if (value[cursor] === ')') {
            depth -= 1;
            if (depth === 0) return cursor + 1;
        }
    }

    throw new SqlStatementRejectedError(READ_ONLY_SQL_ERROR);
}

function assertNoAdditionalStatements(masked: string): void {
    const firstSemicolon = masked.indexOf(';');
    if (firstSemicolon < 0) return;
    if (masked.slice(firstSemicolon + 1).trim().length > 0) {
        throw new SqlStatementRejectedError(READ_ONLY_SQL_ERROR);
    }
}

function assertReadOnlyWithSql(masked: string, withEnd: number): void {
    let index = skipWhitespace(masked, withEnd);
    const maybeRecursive = readKeyword(masked, index);
    if (maybeRecursive?.keyword === 'RECURSIVE') {
        index = maybeRecursive.end;
    }

    while (index < masked.length) {
        index = skipIdentifier(masked, index);
        index = skipWhitespace(masked, index);

        if (masked[index] === '(') {
            index = skipBalancedParens(masked, index);
            index = skipWhitespace(masked, index);
        }

        const asKeyword = readKeyword(masked, index);
        if (asKeyword?.keyword !== 'AS') throw new SqlStatementRejectedError(READ_ONLY_SQL_ERROR);
        index = skipWhitespace(masked, asKeyword.end);

        const materializedKeyword = readKeyword(masked, index);
        if (materializedKeyword?.keyword === 'MATERIALIZED') {
            index = skipWhitespace(masked, materializedKeyword.end);
        } else if (materializedKeyword?.keyword === 'NOT') {
            const nextKeyword = readKeyword(masked, materializedKeyword.end);
            if (nextKeyword?.keyword !== 'MATERIALIZED') throw new SqlStatementRejectedError(READ_ONLY_SQL_ERROR);
            index = skipWhitespace(masked, nextKeyword.end);
        }

        index = skipBalancedParens(masked, index);
        index = skipWhitespace(masked, index);

        if (masked[index] === ',') {
            index += 1;
            continue;
        }

        const mainStatement = readKeyword(masked, index);
        if (mainStatement?.keyword !== 'SELECT') {
            throw new SqlStatementRejectedError(READ_ONLY_SQL_ERROR);
        }
        return;
    }

    throw new SqlStatementRejectedError(READ_ONLY_SQL_ERROR);
}

export function assertReadOnlySql(stmt: string): void {
    const masked = maskSqlLiteralsAndComments(stmt).trim();
    assertNoAdditionalStatements(masked);

    const firstWord = readKeyword(masked, 0);
    if (firstWord?.keyword === 'SELECT') {
        return;
    }
    if (firstWord?.keyword === 'WITH') {
        assertReadOnlyWithSql(masked, firstWord.end);
        return;
    }
    if (firstWord?.keyword === 'PRAGMA' || firstWord?.keyword === 'EXPLAIN') {
        throw new SqlStatementRejectedError(
            `${firstWord.keyword} statements are not allowed: query_sql runs only SELECT / WITH … SELECT over the index tables, and schema metadata is not exposed.`,
            'For column names, SELECT * FROM blocks LIMIT 1; for documents, use document(action="query").',
        );
    }

    throw new SqlStatementRejectedError(READ_ONLY_SQL_ERROR);
}

export async function ensureRawSqlReadAccess(
    client: SiYuanClient,
    permMgr: PermissionManager,
    stmt: string,
): Promise<ToolResult | undefined> {
    assertReadOnlySql(stmt);
    await permMgr.reload();
    const notebookList = await notebookApi.listNotebooks(client);
    const restrictedNotebookCount = notebookList.notebooks.filter((notebook) => !permMgr.canRead(notebook.id)).length;
    if (restrictedNotebookCount === 0) return undefined;

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'permission_denied',
                    code: 'raw_sql_unavailable_with_restricted_notebooks',
                    reason: 'permission_scope_not_enforceable',
                    restrictedNotebookCount,
                    message: 'Raw SQL is unavailable while one or more notebooks are unreadable because aggregate, join, CTE, and subquery results cannot be safely post-filtered by notebook.',
                    hint: 'Use document(action="query") to query readable documents without changing permissions, or grant read access to every notebook before using raw SQL.',
                },
            }, null, 2),
        }],
        isError: true,
    };
}

export interface RawSqlScope {
    mode: 'restricted' | 'full';
    readableNotebooks: string[];
    excludedNotebooks: number;
    /** Restricted mode only: names of the notebooks behind the two fields above. */
    readable?: Array<{ id: string; name: string; closed?: true }>;
    /** Same disclosure as notebook(action="list"), which lists unreadable notebooks by name. */
    excluded?: Array<{ id: string; name: string }>;
}

/** Reload permissions and compute which notebooks a raw SQL query may observe. */
export async function loadRawSqlScope(client: SiYuanClient, permMgr: PermissionManager): Promise<RawSqlScope> {
    await permMgr.reload();
    const notebookList = await notebookApi.listNotebooks(client);
    const notebooks = Array.isArray(notebookList?.notebooks) ? notebookList.notebooks : [];
    const readable = notebooks.filter((notebook) => permMgr.canRead(notebook.id));
    const readableNotebooks = readable.map((notebook) => notebook.id);
    const excludedNotebooks = notebooks.length - readableNotebooks.length;
    if (excludedNotebooks === 0) return { mode: 'full', readableNotebooks, excludedNotebooks };
    return {
        mode: 'restricted',
        readableNotebooks,
        excludedNotebooks,
        readable: readable.map((notebook) => ({ id: notebook.id, name: String(notebook.name ?? ''), ...(notebook.closed === true ? { closed: true as const } : {}) })),
        excluded: notebooks.filter((notebook) => !permMgr.canRead(notebook.id)).map((notebook) => ({ id: notebook.id, name: String(notebook.name ?? '') })),
    };
}

/** Real table/view names of the index DB, so CTE names can never shadow one. */
export async function listIndexTableNames(client: SiYuanClient): Promise<string[]> {
    const rows = await searchApi.querySQL(client, "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') LIMIT 1000");
    return rows
        .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>).name : undefined))
        .filter((name): name is string => typeof name === 'string');
}

async function getBlockLabel(client: SiYuanClient, id: string): Promise<string | undefined> {
    const rows = await searchApi.querySQL(
        client,
        `SELECT content, name FROM blocks WHERE id = '${escapeSqlString(id)}' LIMIT 1`,
    );
    const row = Array.isArray(rows) && rows[0] && typeof rows[0] === 'object'
        ? rows[0] as Record<string, unknown>
        : null;
    if (!row) return undefined;

    const label = [row.content, row.name].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return label?.trim();
}

async function queryFallbackBacklinkRows(
    client: SiYuanClient,
    id: string,
    keyword?: string,
    refTreeID?: string,
): Promise<unknown[]> {
    const escapedId = escapeSqlString(id);
    const filters = [
        "s.type = 'textmark block-ref'",
        `instr(s.markdown, '${escapedId}') > 0`,
    ];
    if (refTreeID) {
        filters.push(`s.root_id = '${escapeSqlString(refTreeID)}'`);
    }
    if (keyword && keyword.trim()) {
        filters.push(`b.content LIKE '%${escapeSqlLike(keyword.trim())}%' ESCAPE '\\'`);
    }

    return searchApi.querySQL(
        client,
        `
        SELECT
            s.block_id AS id,
            s.root_id,
            s.box,
            s.path,
            b.hpath,
            b.type,
            b.content,
            b.markdown
        FROM spans s
        LEFT JOIN blocks b ON b.id = s.block_id
        WHERE ${filters.join(' AND ')}
        ORDER BY b.updated DESC
        LIMIT 200
        `.trim(),
    );
}

async function queryFallbackBackmentionRows(
    client: SiYuanClient,
    id: string,
    keyword?: string,
    refTreeID?: string,
): Promise<unknown[]> {
    const label = await getBlockLabel(client, id);
    if (!label) return [];

    const filters = [
        `id != '${escapeSqlString(id)}'`,
        `instr(content, '${escapeSqlString(label)}') > 0`,
    ];
    if (refTreeID) {
        filters.push(`root_id = '${escapeSqlString(refTreeID)}'`);
    }
    if (keyword && keyword.trim()) {
        filters.push(`instr(content, '${escapeSqlString(keyword.trim())}') > 0`);
    }

    return searchApi.querySQL(
        client,
        `
        SELECT
            id,
            root_id,
            box,
            path,
            hpath,
            type,
            content,
            markdown
        FROM blocks
        WHERE ${filters.join(' AND ')}
        ORDER BY updated DESC
        LIMIT 200
        `.trim(),
    );
}

export const REFERENCING_BLOCKS_LIMIT = 200;

/**
 * Blocks whose content references `id` (refs.def_block_id). SiYuan's
 * /api/search/searchRefBlock is the "((" autocomplete picker and returns
 * candidate targets, not referrers, so it cannot back search_refs.
 * Fetches one row past the limit so callers can report truncation.
 */
export async function queryReferencingBlocks(
    client: SiYuanClient,
    id: string,
    rootID?: string,
    keyword?: string,
): Promise<unknown[]> {
    const filters = [`r.def_block_id = '${escapeSqlString(id)}'`];
    if (rootID) {
        filters.push(`r.root_id = '${escapeSqlString(rootID)}'`);
    }
    if (keyword && keyword.trim()) {
        filters.push(`b.content LIKE '%${escapeSqlLike(keyword.trim())}%' ESCAPE '\\'`);
    }

    return searchApi.querySQL(
        client,
        `
        SELECT
            b.id,
            b.root_id,
            b.box,
            b.path,
            b.hpath,
            b.type,
            b.content,
            b.markdown,
            MAX(r.content) AS ref_text
        FROM refs r
        JOIN blocks b ON b.id = r.block_id
        WHERE ${filters.join(' AND ')}
        GROUP BY b.id
        ORDER BY MAX(b.updated) DESC
        LIMIT ${REFERENCING_BLOCKS_LIMIT + 1}
        `.trim(),
    );
}

export async function getBacklinksWithFallback(
    client: SiYuanClient,
    id: string,
    keyword?: string,
    refTreeID?: string,
    mode: 'links' | 'mentions' | 'both' = 'both',
): Promise<{ backlinks: unknown[]; backmentions: unknown[]; fallbackUsed?: boolean; sourcePayloadMissing?: boolean; fallbackQuery?: 'sql'; resultConfidence?: 'fallback' }> {
    let result: { backlinks?: unknown[]; backmentions?: unknown[] } | null;
    if (!refTreeID) {
        // The Doc endpoints require a concrete referencing document, not an empty scope.
        result = await searchApi.getBacklink2(client, id, keyword);
    } else {
        const links = mode !== 'mentions' ? await searchApi.getBacklinkDoc(client, id, keyword, refTreeID) : null;
        const mentions = mode !== 'links' ? await searchApi.getBackmentionDoc(client, id, keyword, refTreeID) : null;
        result = { backlinks: links?.backlinks, backmentions: mentions?.backmentions };
    }

    const linksMissing = mode !== 'mentions' && !Array.isArray(result?.backlinks);
    const mentionsMissing = mode !== 'links' && !Array.isArray(result?.backmentions);
    const [backlinks, backmentions] = await Promise.all([
        linksMissing ? queryFallbackBacklinkRows(client, id, keyword, refTreeID) : Promise.resolve(mode === 'mentions' ? [] : result?.backlinks ?? []),
        mentionsMissing ? queryFallbackBackmentionRows(client, id, keyword, refTreeID) : Promise.resolve(mode === 'links' ? [] : result?.backmentions ?? []),
    ]);
    return {
        backlinks,
        backmentions,
        ...(linksMissing || mentionsMissing ? {
            fallbackUsed: true,
            sourcePayloadMissing: true,
            fallbackQuery: 'sql' as const,
            resultConfidence: 'fallback' as const,
        } : {}),
    };
}
