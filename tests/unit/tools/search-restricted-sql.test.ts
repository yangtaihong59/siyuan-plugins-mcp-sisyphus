import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { callSearchTool } from '@/tools/search';
import {
    RESTRICTED_SQL_TABLES,
    RestrictedSqlError,
    rewriteRestrictedSql,
    tokenizeSql,
} from '@/tools/search/restricted-sql';
import {
    CANARY_PROBES,
    CANARY_TTL_MS,
    checkRestrictedSqlCanary,
} from '@/tools/search/restricted-sql-canary';
import { createMockClient } from '../../helpers/mock-client';
import { parseResult } from '../../helpers/parse-result';

const READABLE = ['20260101000000-aaaaaaa'];
const SECRET_BOX = '20260101000000-bbbbbbb';
const GUARD = "WITH [sisyphus_scope] AS (SELECT '' || '') ";
const SCOPED = (table: string) => `(SELECT * FROM main.${table} WHERE box IN ('${READABLE[0]}'))`;
const SCOPED_REFS = `(SELECT * FROM main.refs WHERE box IN ('${READABLE[0]}') AND def_block_id IN (SELECT id FROM main.blocks WHERE box IN ('${READABLE[0]}')))`;

function rewrite(sql: string, existingTables: string[] = []): string {
    return rewriteRestrictedSql(sql, { readableNotebookIds: READABLE, existingTables }).sql;
}

function expectRejected(sql: string, pattern?: RegExp, existingTables: string[] = []): void {
    let error: unknown;
    try {
        rewrite(sql, existingTables);
    } catch (caught) {
        error = caught;
    }
    expect(error, `expected rejection for: ${sql}`).toBeInstanceOf(RestrictedSqlError);
    if (pattern) expect((error as Error).message).toMatch(pattern);
}

/**
 * Structural invariant over the rewritten SQL: every identifier naming an
 * allow-listed table is either `main.<table>` inside one of our scoped
 * subqueries, a qualifier (`blocks.id`) or an alias right after our subquery.
 */
function unscopedTableReferences(sql: string): string[] {
    const tokens = tokenizeSql(sql).filter((token) => token.type !== 'space' && token.type !== 'comment');
    const problems: string[] = [];
    tokens.forEach((token, index) => {
        if (token.type !== 'ident' && token.type !== 'qident') return;
        const name = (token.type === 'ident' ? token.text : token.value).toLowerCase();
        if (!(RESTRICTED_SQL_TABLES as readonly string[]).includes(name)) return;
        const prev = tokens[index - 1];
        const next = tokens[index + 1];
        if (prev?.value === '.' && tokens[index - 2]?.text === 'main' && tokens[index + 1]?.value === 'WHERE') return;
        if (next?.value === '.') return; // qualifier
        if (prev?.value === 'AS') return; // alias
        problems.push(`${token.text}@${index}`);
    });
    return problems;
}

function countScoped(sql: string, table: string): number {
    return sql.split(`FROM main.${table} WHERE box IN`).length - 1;
}

describe('restricted SQL rewrite', () => {
    it('wraps every allowed table reference in a notebook-scoped subquery and keeps aliases', () => {
        expect(rewrite('SELECT id FROM blocks LIMIT 5')).toBe(`${GUARD}SELECT id FROM ${SCOPED('blocks')} AS blocks LIMIT 5`);
        expect(rewrite('SELECT b.id FROM blocks b')).toBe(`${GUARD}SELECT b.id FROM ${SCOPED('blocks')} b`);
        expect(rewrite('SELECT b.id FROM blocks AS b')).toBe(`${GUARD}SELECT b.id FROM ${SCOPED('blocks')} AS b`);
        expect(rewrite('SELECT blocks.id FROM blocks WHERE blocks.type = \'d\'')).toBe(
            `${GUARD}SELECT blocks.id FROM ${SCOPED('blocks')} AS blocks WHERE blocks.type = 'd'`,
        );
        for (const table of ['spans', 'attributes', 'assets', 'file_annotation_refs']) {
            expect(rewrite(`SELECT * FROM ${table}`)).toBe(`${GUARD}SELECT * FROM ${SCOPED(table)} AS ${table}`);
        }
    });

    it('also requires the definition block of refs rows to be readable', () => {
        expect(rewrite('SELECT * FROM refs')).toBe(`${GUARD}SELECT * FROM ${SCOPED_REFS} AS refs`);
    });

    it.each([
        ['"blocks"', '"blocks"'],
        ['[blocks]', '[blocks]'],
        ['`blocks`', '`blocks`'],
        ['BLOCKS', 'BLOCKS'],
        ['"BlOcKs"', '"BlOcKs"'],
    ])('rewrites quoted / mixed-case identifier %s', (identifier, alias) => {
        const out = rewrite(`SELECT id FROM ${identifier} WHERE ${identifier}.type = 'd'`);
        expect(out).toBe(`${GUARD}SELECT id FROM ${SCOPED('blocks')} AS ${alias} WHERE ${identifier}.type = 'd'`);
        expect(unscopedTableReferences(out)).toEqual([]);
    });

    it('leaves table names inside string literals and comments alone without opening a bypass', () => {
        const sql = "SELECT 'it''s FROM stat; DROP blocks' AS label /* FROM sqlite_master */ FROM blocks -- , stat\nWHERE content LIKE '%blocks%'";
        const out = rewrite(sql);
        expect(out).toBe(`${GUARD}SELECT 'it''s FROM stat; DROP blocks' AS label /* FROM sqlite_master */ FROM ${SCOPED('blocks')} AS blocks -- , stat\nWHERE content LIKE '%blocks%'`);
        expect(countScoped(out, 'blocks')).toBe(1);
        expect(unscopedTableReferences(out)).toEqual([]);
    });

    it('scopes a table that follows a comment inside the FROM clause', () => {
        const out = rewrite('SELECT id FROM /* hidden */ blocks -- trailing comment');
        expect(out).toBe(`${GUARD}SELECT id FROM /* hidden */ ${SCOPED('blocks')} AS blocks -- trailing comment`);
        expectRejected('SELECT id FROM -- comment\n stat', /stat/);
    });

    it('scopes each branch of UNION / UNION ALL and every nested subquery', () => {
        const out = rewrite(
            'SELECT id FROM blocks WHERE id IN (SELECT block_id FROM refs WHERE root_id IN (SELECT root_id FROM spans)) '
            + 'UNION SELECT block_id FROM attributes UNION ALL SELECT x.id FROM (SELECT id FROM blocks) x',
        );
        expect(countScoped(out, 'blocks')).toBe(3); // 2 user references + the refs definition guard
        expect(countScoped(out, 'refs')).toBe(1);
        expect(countScoped(out, 'spans')).toBe(1);
        expect(countScoped(out, 'attributes')).toBe(1);
        expect(unscopedTableReferences(out)).toEqual([]);
    });

    it('scopes joins between blocks and refs with aliases', () => {
        const out = rewrite(
            'SELECT b.content, r.def_block_id FROM blocks AS b JOIN refs r ON r.block_id = b.id '
            + 'LEFT OUTER JOIN blocks d ON d.id = r.def_block_id, spans s WHERE s.block_id = b.id',
        );
        expect(out).toBe(
            `${GUARD}SELECT b.content, r.def_block_id FROM ${SCOPED('blocks')} AS b JOIN ${SCOPED_REFS} r ON r.block_id = b.id `
            + `LEFT OUTER JOIN ${SCOPED('blocks')} d ON d.id = r.def_block_id, ${SCOPED('spans')} s WHERE s.block_id = b.id`,
        );
        expect(unscopedTableReferences(out)).toEqual([]);
    });

    it('scopes parenthesised join lists, correlated subqueries and `IN table`', () => {
        expect(unscopedTableReferences(rewrite('SELECT * FROM (blocks AS b JOIN spans AS s ON s.block_id = b.id)'))).toEqual([]);
        expect(countScoped(rewrite('SELECT (SELECT count(*) FROM spans WHERE spans.block_id = blocks.id) FROM blocks'), 'spans')).toBe(1);
        expect(rewrite('SELECT id FROM blocks WHERE id IN blocks')).toBe(
            `${GUARD}SELECT id FROM ${SCOPED('blocks')} AS blocks WHERE id IN ${SCOPED('blocks')}`,
        );
    });

    it('scopes CTE bodies and merges the kernel parser guard into an existing WITH', () => {
        expect(rewrite('WITH docs AS (SELECT id FROM blocks WHERE type = \'d\') SELECT * FROM docs')).toBe(
            `WITH [sisyphus_scope] AS (SELECT '' || ''), docs AS (SELECT id FROM ${SCOPED('blocks')} AS blocks WHERE type = 'd') SELECT * FROM docs`,
        );
        expect(rewrite('WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 3) SELECT n FROM t')).toBe(
            "WITH RECURSIVE [sisyphus_scope] AS (SELECT '' || ''), t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 3) SELECT n FROM t",
        );
    });

    it.each([
        'WITH blocks AS (SELECT * FROM main.blocks) SELECT * FROM blocks',
        'WITH "BLOCKS" AS (SELECT 1) SELECT * FROM blocks',
        "WITH 'refs' AS (SELECT 1) SELECT * FROM refs",
        'WITH [spans] AS (SELECT 1) SELECT * FROM spans',
        'WITH x AS (SELECT 1), stat AS (SELECT 1) SELECT * FROM stat',
        'WITH sqlite_master AS (SELECT 1) SELECT * FROM sqlite_master',
        'WITH sisyphus_scope AS (SELECT 1) SELECT 1',
        'SELECT * FROM (WITH attributes AS (SELECT 1) SELECT * FROM attributes)',
    ])('rejects CTE names that shadow tables: %s', (sql) => {
        expectRejected(sql);
    });

    it('rejects CTE names that shadow tables discovered from sqlite_master', () => {
        expectRejected('WITH future_table AS (SELECT 1) SELECT * FROM future_table', /shadows/, ['future_table']);
        expectRejected('SELECT * FROM future_table', /future_table/, ['future_table']);
    });

    it.each([
        ['SELECT * FROM sqlite_master', /sqlite_master/],
        ['SELECT * FROM sqlite_schema', /sqlite_schema/],
        ['SELECT * FROM "sqlite_master"', /sqlite_master/],
        ['SELECT * FROM [SQLITE_MASTER]', /sqlite_master/],
        ['SELECT * FROM sqlite_temp_master', /sqlite_temp_master/],
        ['SELECT * FROM sqlite_dbpage', /sqlite_dbpage/],
        ["SELECT * FROM pragma_table_info('blocks')", /pragma_table_info/],
        ['SELECT * FROM pragma_table_list', /pragma_table_list/],
        ["SELECT name FROM blocks WHERE id IN (SELECT name FROM pragma_table_info('blocks'))", /pragma/],
        ["SELECT (SELECT sql FROM sqlite_master LIMIT 1) FROM blocks", /sqlite_master/],
        ["ATTACH DATABASE 'x.db' AS x", /single SELECT/],
        ['SELECT 1; ATTACH DATABASE \'x.db\' AS x', /Multiple/],
        ['PRAGMA table_info(blocks)', /single SELECT/],
        ['SELECT * FROM blocks; SELECT * FROM stat', /Multiple/],
        ['SELECT * FROM blocks; -- ok\n; SELECT 1', /Multiple/],
        ['SELECT * FROM stat', /stat/],
        ['SELECT * FROM blocks_fts WHERE blocks_fts MATCH \'x\'', /blocks_fts/],
        ['SELECT * FROM block_embeddings', /block_embeddings/],
        ['SELECT * FROM main.blocks', /Schema-qualified/],
        ['SELECT * FROM "main"."blocks"', /Schema-qualified/],
        ['SELECT * FROM temp.blocks', /Schema-qualified/],
        ['SELECT main.blocks.id FROM blocks', /blocks/],
        ["SELECT * FROM 'blocks'", /Quoted strings/],
        ["SELECT 1 WHERE 1 IN 'blocks'", /Quoted strings/],
        ['SELECT * FROM spans blocks', /blocks/],
        ['SELECT blocks FROM spans', /blocks/],
        ['SELECT * FROM unknown_table', /unknown_table/],
        ['SELECT * FROM dbstat', /dbstat/],
        ["SELECT load_extension('x') FROM blocks", /load_extension/],
        ['SELECT * FROM blocks WHERE id = ?', /parameters/],
        ['SELECT * FROM blocks WHERE id = \'unterminated', /Unterminated/],
        ['SELECT * FROM blocks /* unterminated', /Unterminated/],
        ['SELECT * FROM [blocks', /Unterminated/],
        ['SELECT * FROM blocks ', /blocks/], // U+00A0 is an identifier char in SQLite, not whitespace
        ['SELECT * FROM blocks WHERE x = 1 \\ 2', /Unrecognized/],
        ['SELECT * FROM blocks)', /Unbalanced/],
        ['SELECT * FROM (blocks', /Unbalanced/],
        ['DELETE FROM blocks', /single SELECT/],
        ['WITH x AS (SELECT 1) DELETE FROM blocks', /SELECT/],
    ])('rejects %s', (sql, pattern) => {
        expectRejected(sql, pattern);
    });

    it('rejects excessive nesting instead of overflowing the stack', () => {
        expectRejected(`SELECT ${'('.repeat(500)}1${')'.repeat(500)}`, /nested too deeply/);
    });

    it('does not let a quote mismatch hide a table from the kernel (`"a` ... `b"`)', () => {
        // SQLite reads one double-quoted identifier; SiYuan's rqlite parser would close it at the backtick.
        const sql = 'SELECT "a` , (SELECT group_concat(content) FROM blocks) , `b"';
        const out = rewrite(sql);
        expect(out).toBe(`${GUARD}${sql}`);
        // The bracket-quoted CTE makes the kernel parsers fail and `||` keeps it off the MySQL parser,
        // so SiYuan executes this exact text instead of a re-serialised variant.
        expect(out.startsWith('WITH [sisyphus_scope]')).toBe(true);
        expect(out).toContain('||');
    });

    it('allows safe table-valued functions and keeps them unscoped', () => {
        expect(rewrite("SELECT b.id, j.value FROM blocks b, json_each('[1,2]') j")).toBe(
            `${GUARD}SELECT b.id, j.value FROM ${SCOPED('blocks')} b, json_each('[1,2]') j`,
        );
    });

    it('treats `IS DISTINCT FROM` as an operator, not a FROM clause', () => {
        expect(rewrite('SELECT id FROM blocks WHERE name IS NOT DISTINCT FROM alias')).toBe(
            `${GUARD}SELECT id FROM ${SCOPED('blocks')} AS blocks WHERE name IS NOT DISTINCT FROM alias`,
        );
    });

    it('escapes notebook IDs and matches nothing when no notebook is readable', () => {
        expect(rewriteRestrictedSql('SELECT * FROM blocks', { readableNotebookIds: ["x'y"] }).sql).toContain("box IN ('x''y')");
        expect(rewriteRestrictedSql('SELECT * FROM blocks', { readableNotebookIds: [] }).sql).toContain('box IN (NULL)');
    });
});

// ---------------------------------------------------------------------------
// Execute rewritten SQL in a real SQLite (node:sqlite, Node >= 22.5) to prove
// the scope holds semantically, including aggregates that cannot be post-filtered.
// ---------------------------------------------------------------------------

type SqliteDb = { exec(sql: string): void; prepare(sql: string): { all(): unknown[] } };
let DatabaseSync: (new (path: string) => SqliteDb) | undefined;
try {
    DatabaseSync = createRequire(import.meta.url)('node:sqlite').DatabaseSync;
} catch {
    DatabaseSync = undefined;
}

function createIndexDb(): SqliteDb {
    const db = new DatabaseSync!(':memory:');
    db.exec(`
        CREATE TABLE stat (key, value);
        CREATE TABLE blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated);
        CREATE TABLE spans (id, block_id, root_id, box, path, content, markdown, type, ial);
        CREATE TABLE assets (id, block_id, root_id, box, docpath, path, name, title, hash);
        CREATE TABLE attributes (id, name, value, type, block_id, root_id, box, path);
        CREATE TABLE refs (id, def_block_id, def_block_parent_id, def_block_root_id, def_block_path, block_id, root_id, box, path, content, markdown, type);
        CREATE TABLE file_annotation_refs (id, file_path, annotation_id, block_id, root_id, box, path, content, type);
        INSERT INTO stat VALUES ('secret', 'SECRET-stat');
        INSERT INTO blocks (id, root_id, box, content, type) VALUES
            ('pub-doc', 'pub-doc', '${READABLE[0]}', 'public doc', 'd'),
            ('pub-p', 'pub-doc', '${READABLE[0]}', 'public paragraph', 'p'),
            ('sec-doc', 'sec-doc', '${SECRET_BOX}', 'SECRET doc', 'd'),
            ('sec-p', 'sec-doc', '${SECRET_BOX}', 'SECRET paragraph', 'p');
        INSERT INTO spans VALUES ('s1', 'pub-p', 'pub-doc', '${READABLE[0]}', '', 'public span', '', 'tag', ''),
                                 ('s2', 'sec-p', 'sec-doc', '${SECRET_BOX}', '', 'SECRET span', '', 'tag', '');
        INSERT INTO attributes VALUES ('a1', 'custom', 'public attr', 'b', 'pub-p', 'pub-doc', '${READABLE[0]}', ''),
                                      ('a2', 'custom', 'SECRET attr', 'b', 'sec-p', 'sec-doc', '${SECRET_BOX}', '');
        INSERT INTO assets VALUES ('as1', 'pub-p', 'pub-doc', '${READABLE[0]}', '', 'assets/pub.png', 'pub', 'public', ''),
                                  ('as2', 'sec-p', 'sec-doc', '${SECRET_BOX}', '', 'assets/SECRET.png', 'SECRET', 'SECRET', '');
        INSERT INTO refs VALUES
            ('r1', 'pub-doc', 'pub-doc', 'pub-doc', '/pub', 'pub-p', 'pub-doc', '${READABLE[0]}', '', 'public anchor', '', 'p'),
            ('r2', 'sec-p', 'sec-doc', 'sec-doc', '/SECRET', 'pub-p', 'pub-doc', '${READABLE[0]}', '', 'SECRET anchor text', '', 'p'),
            ('r3', 'pub-doc', 'pub-doc', 'pub-doc', '/pub', 'sec-p', 'sec-doc', '${SECRET_BOX}', '', 'SECRET referrer', '', 'p');
        INSERT INTO file_annotation_refs VALUES ('f1', 'a.pdf', 'x', 'pub-p', 'pub-doc', '${READABLE[0]}', '', 'public note', ''),
                                                ('f2', 'a.pdf', 'y', 'sec-p', 'sec-doc', '${SECRET_BOX}', '', 'SECRET note', '');
    `);
    return db;
}

describe.skipIf(!DatabaseSync)('restricted SQL executed by SQLite', () => {
    const leakQueries = [
        'SELECT * FROM blocks',
        'SELECT group_concat(content) AS c, count(*) AS n FROM blocks',
        'SELECT box, count(*) AS n FROM blocks GROUP BY box',
        'SELECT * FROM "BLOCKS"',
        'SELECT * FROM [blocks] AS b',
        'SELECT * FROM `spans`',
        'SELECT content FROM spans UNION ALL SELECT value FROM attributes UNION SELECT name FROM assets UNION SELECT content FROM file_annotation_refs',
        'SELECT * FROM refs',
        'SELECT r.content, r.def_block_id, r.def_block_path FROM blocks b JOIN refs r ON r.block_id = b.id',
        'SELECT (SELECT group_concat(content) FROM blocks) AS c',
        'SELECT * FROM blocks WHERE id IN (SELECT block_id FROM spans)',
        'SELECT * FROM blocks WHERE id NOT IN (SELECT id FROM blocks WHERE box = \'x\')',
        'WITH all_blocks AS (SELECT * FROM blocks) SELECT group_concat(content) FROM all_blocks',
        'WITH RECURSIVE walk(id) AS (SELECT id FROM blocks UNION SELECT b.id FROM blocks b JOIN walk w ON b.root_id = w.id) SELECT group_concat(id) FROM walk',
        'SELECT * FROM (SELECT * FROM (SELECT content FROM blocks))',
        'SELECT * FROM (blocks AS b JOIN spans AS s ON s.block_id = b.id)',
        'SELECT EXISTS (SELECT 1 FROM blocks WHERE content LIKE \'SECRET%\') AS leaked',
        'SELECT content FROM blocks WHERE id IN blocks',
        'SELECT \'FROM stat\' AS a, content FROM blocks -- FROM sqlite_master',
        'SELECT "a` , (SELECT group_concat(content) FROM blocks) , `b"',
        'SELECT max(content) OVER (PARTITION BY box) AS m FROM blocks',
    ];

    // SQLite itself refuses these (multi-column IN target; DQS disabled in node:sqlite), which is also safe.
    const sqliteErrors = new Set([
        'SELECT content FROM blocks WHERE id IN blocks',
        'SELECT "a` , (SELECT group_concat(content) FROM blocks) , `b"',
    ]);

    it.each(leakQueries)('never returns rows from unreadable notebooks: %s', (sql) => {
        const db = createIndexDb();
        const out = rewrite(sql);
        let rows: unknown[] = [];
        try {
            rows = db.prepare(out).all();
            expect(sqliteErrors.has(sql)).toBe(false);
        } catch (error) {
            if (!sqliteErrors.has(sql)) throw error;
        }
        const serialized = JSON.stringify(rows);
        expect(serialized).not.toContain('SECRET');
        expect(serialized).not.toContain(SECRET_BOX);
        expect(serialized).not.toContain('sec-');
    });

    it('still returns readable rows and aggregates over readable notebooks only', () => {
        const db = createIndexDb();
        expect(db.prepare(rewrite('SELECT count(*) AS n FROM blocks')).all()).toEqual([expect.objectContaining({ n: 2 })]);
        expect(db.prepare(rewrite('SELECT id FROM refs ORDER BY id')).all()).toEqual([expect.objectContaining({ id: 'r1' })]);
        expect(db.prepare(rewrite('SELECT b.id, s.content FROM blocks b JOIN spans s ON s.block_id = b.id')).all())
            .toEqual([expect.objectContaining({ id: 'pub-p', content: 'public span' })]);
    });
});

// ---------------------------------------------------------------------------
// Handler: what is actually sent to /api/query/sql, post-filter, metadata.
// ---------------------------------------------------------------------------

const CLOSED_BOX = '20260101000000-ccccccc';

function createHandlerHarness(options: { userRows?: unknown[]; lookupRows?: unknown[]; allReadable?: boolean; closedReadable?: boolean; canary?: 'pass' | 'leak' | 'error'; flush?: boolean } = {}) {
    const sent: string[] = [];
    const request = vi.fn(async (path: string, body: { stmt?: string }) => {
        if (path === '/api/sqlite/flushTransaction' && options.flush) return null;
        if (path === '/api/notebook/lsNotebooks') {
            return { notebooks: [{ id: READABLE[0], name: 'Public' }, { id: SECRET_BOX, name: 'Secret' }, ...(options.closedReadable ? [{ id: CLOSED_BOX, name: 'Old', closed: true }] : [])] };
        }
        if (path !== '/api/query/sql') throw new Error(`unexpected endpoint ${path}`);
        const stmt = String(body.stmt);
        sent.push(stmt);
        if (stmt.startsWith('SELECT name FROM sqlite_master')) return [{ name: 'blocks' }, { name: 'refs' }, { name: 'stat' }];
        if (stmt.includes("upper('sisyphus_canary')")) {
            if (options.canary === 'error') throw new Error('kernel unavailable');
            // What SiYuan returns when it re-serialises the probe (verified on 3.8.8 without the guard).
            if (options.canary === 'leak') return [{ '"b"': 'b', "(SELECT upper('sisyphus_canary'))": 'SISYPHUS_CANARY', a: 1 }];
            return [{ "a` , (SELECT upper('sisyphus_canary')) , `b": 1 }];
        }
        if (stmt.startsWith('SELECT id, box FROM blocks WHERE id IN')) return options.lookupRows ?? [];
        return options.userRows ?? [];
    });
    const permMgr = {
        reload: vi.fn(async () => undefined),
        canRead: (id: string) => options.allReadable || id !== SECRET_BOX,
    };
    const call = (args: Record<string, unknown>) => callSearchTool(
        createMockClient({ request }), { action: 'query_sql', ...args }, buildDefaultToolConfig().search, permMgr as never,
    );
    return { sent, request, call };
}

describe('search(action="query_sql") restricted mode', () => {
    it('sends the scoped SQL and reports restricted scope metadata', async () => {
        const harness = createHandlerHarness({ userRows: [{ n: 2 }] });
        const result = await harness.call({ sql: 'SELECT count(*) AS n FROM blocks b JOIN refs r ON r.block_id = b.id' });
        const parsed = parseResult(result);

        expect(result.isError).toBeFalsy();
        const userSql = harness.sent.find((stmt) => stmt.includes('count(*)'))!;
        expect(userSql).toBe(
            `${GUARD}SELECT count(*) AS n FROM ${SCOPED('blocks')} b JOIN ${SCOPED_REFS} r ON r.block_id = b.id`,
        );
        expect(userSql).not.toContain(SECRET_BOX);
        expect(parsed.data).toEqual([{ n: 2 }]);
        expect(parsed.scope).toMatchObject({ mode: 'restricted', readableNotebooks: READABLE, excludedNotebooks: 1 });
        expect(parsed.scope.hint).toContain('blocks, spans, attributes, assets, refs, file_annotation_refs');
        expect(parsed.readInfo.limitations).toContain('notebook_scoped');
        expect(parsed.resolvedArgs).toEqual({ stmt: 'SELECT count(*) AS n FROM blocks b JOIN refs r ON r.block_id = b.id' });
        expect(parsed.scope.readable).toEqual([{ id: READABLE[0], name: 'Public' }]);
        expect(parsed.scope.excluded).toEqual([{ id: SECRET_BOX, name: 'Secret' }]);
        expect(parsed.scope.hint).toContain('Results and counts cover only the readable notebooks; 1 unreadable notebook(s) (Secret) are excluded.');
    });

    it('marks closed readable notebooks in the scope and hint', async () => {
        const parsed = parseResult(await createHandlerHarness({ userRows: [], closedReadable: true }).call({ sql: 'SELECT id FROM blocks LIMIT 1' }));
        expect(parsed.scope.readable).toContainEqual({ id: CLOSED_BOX, name: 'Old', closed: true });
        expect(parsed.scope.hint).toContain('closed notebook(s) (Old) are not indexed and return no rows');
    });

    it('post-filters rows whose box or block IDs resolve to an unreadable notebook', async () => {
        const harness = createHandlerHarness({
            userRows: [
                { id: '20260101000001-aaaaaaa', box: READABLE[0], content: 'public' },
                { id: '20260101000002-bbbbbbb', box: SECRET_BOX, content: 'leak via box' },
                { root_id: '20260101000003-bbbbbbb', content: 'leak via root_id' },
                { n: 5 },
            ],
            lookupRows: [
                { id: '20260101000001-aaaaaaa', box: READABLE[0] },
                { id: '20260101000002-bbbbbbb', box: SECRET_BOX },
                { id: '20260101000003-bbbbbbb', box: SECRET_BOX },
            ],
        });
        const parsed = parseResult(await harness.call({ stmt: 'SELECT id, box, root_id, content FROM blocks LIMIT 10' }));

        expect(parsed.data).toEqual([
            { id: '20260101000001-aaaaaaa', box: READABLE[0], content: 'public' },
            { n: 5 },
        ]);
        expect(parsed).toMatchObject({ partial: true, filteredOutCount: 2, reason: 'permission_filtered' });
        expect(parsed.readInfo.limitations).toEqual(expect.arrayContaining(['permission_filtered', 'notebook_scoped']));
        const lookup = harness.sent.find((stmt) => stmt.startsWith('SELECT id, box FROM blocks WHERE id IN'))!;
        expect(lookup).toContain("'20260101000003-bbbbbbb'");
    });

    it.each([
        'SELECT * FROM sqlite_master',
        "SELECT * FROM pragma_table_info('blocks')",
        'WITH blocks AS (SELECT 1) SELECT * FROM blocks',
        'SELECT * FROM stat',
        'SELECT * FROM main.blocks',
    ])('rejects %s without sending it to the kernel', async (stmt) => {
        const harness = createHandlerHarness();
        const result = await harness.call({ stmt });
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({ type: 'permission_denied', code: 'restricted_sql_rejected', excludedNotebooks: 1 });
        expect(harness.sent.every((sent) => sent.startsWith('SELECT name FROM sqlite_master'))).toBe(true);
    });

    it('rejects multiple statements before loading permissions', async () => {
        const harness = createHandlerHarness();
        const result = await harness.call({ stmt: 'SELECT * FROM blocks; DELETE FROM blocks' });
        expect(result.isError).toBe(true);
        expect(harness.request).not.toHaveBeenCalled();
    });

    it('sends the query unchanged in full mode when every notebook is readable', async () => {
        const stmt = 'SELECT * FROM sqlite_master WHERE name = \'blocks\'';
        const harness = createHandlerHarness({ allReadable: true, userRows: [{ id: 'x', box: SECRET_BOX }] });
        const parsed = parseResult(await harness.call({ stmt }));

        expect(harness.sent).toEqual([stmt]);
        expect(parsed.data).toEqual([{ id: 'x', box: SECRET_BOX }]);
        expect(parsed.scope).toEqual({ mode: 'full', readableNotebooks: [READABLE[0], SECRET_BOX], excludedNotebooks: 0 });
        expect(parsed.readInfo.limitations).not.toContain('notebook_scoped');
    });

    it('flushes the index before querying and explains an empty result', async () => {
        const flushed = createHandlerHarness({ allReadable: true, flush: true });
        const parsed = parseResult(await flushed.call({ stmt: 'SELECT id FROM blocks WHERE id = \'x\'' }));
        const calls = flushed.request.mock.calls.map((call) => call[0]);
        expect(calls.indexOf('/api/sqlite/flushTransaction')).toBeLessThan(calls.indexOf('/api/query/sql'));
        expect(parsed.hint).toMatch(/flushed to the index first/);

        const unflushed = parseResult(await createHandlerHarness({ allReadable: true }).call({ stmt: 'SELECT id FROM blocks' }));
        expect(unflushed.data).toEqual([]);
        expect(unflushed.hint).toMatch(/can lag a write by a few seconds/);

        const rows = parseResult(await createHandlerHarness({ allReadable: true, flush: true, userRows: [{ id: 'x' }] }).call({ stmt: 'SELECT id FROM blocks' }));
        expect(rows.hint).toBeUndefined();
    });

    it('runs the kernel canary once per client before the first restricted query', async () => {
        const harness = createHandlerHarness({ userRows: [{ n: 1 }] });
        const client = createMockClient({ request: harness.request });
        const permMgr = { reload: vi.fn(async () => undefined), canRead: (id: string) => id !== SECRET_BOX };
        const run = () => callSearchTool(client, { action: 'query_sql', stmt: 'SELECT count(*) AS n FROM blocks' }, buildDefaultToolConfig().search, permMgr as never);

        expect((await run()).isError).toBeFalsy();
        expect((await run()).isError).toBeFalsy();
        const probes = harness.sent.filter((stmt) => stmt.includes('sisyphus_canary'));
        expect(probes).toHaveLength(CANARY_PROBES.length);
        // Probes carry the same guard as user queries and reference no table.
        for (const probe of probes) {
            expect(probe.startsWith('WITH [sisyphus_scope]')).toBe(true);
            expect(probe).not.toMatch(/FROM (main\.)?(blocks|spans|attributes|assets|refs|file_annotation_refs|sqlite_)/i);
        }
    });

    it.each([
        ['leak', 'guard_bypassed'],
        ['error', 'canary_error'],
    ] as const)('fails closed when the canary %s', async (canary, reason) => {
        const harness = createHandlerHarness({ userRows: [{ id: 'x', box: SECRET_BOX, content: 'SECRET' }], canary });
        const result = await harness.call({ stmt: 'SELECT id, box, content FROM blocks' });
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({ type: 'permission_denied', code: 'restricted_sql_unavailable', reason });
        // The caller's (rewritten) SQL is never sent.
        expect(harness.sent.some((stmt) => stmt.includes('content FROM'))).toBe(false);
    });

    it('does not need the canary in full mode', async () => {
        const harness = createHandlerHarness({ allReadable: true, canary: 'leak', userRows: [{ n: 1 }] });
        const result = await harness.call({ stmt: 'SELECT count(*) AS n FROM blocks' });
        expect(result.isError).toBeFalsy();
        expect(harness.sent.some((stmt) => stmt.includes('sisyphus_canary'))).toBe(false);
    });
});

describe('restricted SQL canary', () => {
    function probeClient(responder: (stmt: string) => unknown[] | Promise<unknown[]>) {
        const request = vi.fn(async (_path: string, body: { stmt: string }) => responder(body.stmt));
        return { client: createMockClient({ request }), request };
    }

    it('caches a passing result and re-checks after the TTL', async () => {
        const { client, request } = probeClient(() => [{ alias: 1 }]);
        expect(await checkRestrictedSqlCanary(client, 1_000)).toEqual({ ok: true });
        expect(await checkRestrictedSqlCanary(client, 2_000)).toEqual({ ok: true });
        expect(request).toHaveBeenCalledTimes(CANARY_PROBES.length);
        await checkRestrictedSqlCanary(client, 1_000 + CANARY_TTL_MS);
        expect(request).toHaveBeenCalledTimes(CANARY_PROBES.length * 2);
    });

    it('detects a leak in the second (WITH-merged) probe too', async () => {
        const { client } = probeClient((stmt) => (stmt.includes('sisyphus_probe') ? [{ a: 1, x: 'SISYPHUS_CANARY' }] : [{ alias: 1 }]));
        expect(await checkRestrictedSqlCanary(client)).toMatchObject({ ok: false, reason: 'guard_bypassed' });
    });

    it('treats an unexpected result shape as a failure', async () => {
        const { client } = probeClient(() => []);
        expect(await checkRestrictedSqlCanary(client)).toMatchObject({ ok: false, reason: 'unexpected_result' });
    });

    it('does not cache transport errors', async () => {
        let fail = true;
        const { client } = probeClient(() => {
            if (fail) throw new Error('down');
            return [{ alias: 1 }];
        });
        await expect(checkRestrictedSqlCanary(client)).rejects.toThrow('down');
        fail = false;
        expect(await checkRestrictedSqlCanary(client)).toEqual({ ok: true });
    });

    it('probes are harmless single-row aliases when SQLite runs the guarded text verbatim', () => {
        // The probe is a single alias for SQLite; the guarded text keeps it that way.
        const db = createIndexDb();
        for (const probe of CANARY_PROBES) {
            const rows = db.prepare(rewriteRestrictedSql(probe, { readableNotebookIds: [] }).sql).all();
            expect(JSON.stringify(rows)).not.toContain('SISYPHUS_CANARY');
            expect(rows).toHaveLength(1);
        }
    });
});
