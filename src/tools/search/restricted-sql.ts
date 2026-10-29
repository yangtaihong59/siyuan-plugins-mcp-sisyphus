/**
 * Permission-scoped ("restricted") raw SQL for search(action="query_sql").
 *
 * When some notebooks are unreadable, a caller-supplied SELECT is not trusted.
 * Instead it is tokenized with SQLite's lexical rules and every reference to
 * an allow-listed index table is replaced by a subquery that only exposes rows
 * from readable notebooks:
 *
 *   FROM blocks b  ->  FROM (SELECT * FROM main.blocks WHERE box IN ('nbA')) b
 *
 * Everything that cannot be scoped (other tables, sqlite_* / pragma_* objects,
 * schema-qualified names, CTEs that shadow real tables, multiple statements)
 * is rejected. The rewrite is the primary guarantee; the handler additionally
 * post-filters attributable rows as defence in depth.
 *
 * SiYuan's /api/query/sql re-parses statements with Go SQL parsers whose
 * lexers differ from SQLite (e.g. `"a` closes a double-quoted identifier),
 * and then executes the parser's re-serialised text. That re-serialisation
 * could turn text this module saw as a quoted identifier into live SQL. The
 * rewritten statement therefore always starts with a bracket-quoted CTE and
 * contains `||`, which makes the kernel's parsers fail and forces it to run
 * the exact text analysed here.
 */

import { escapeSqlString } from '../../shared/sql';

/** Index tables that carry a notebook (`box`) column and can be scoped. */
export const RESTRICTED_SQL_TABLES = ['blocks', 'spans', 'attributes', 'assets', 'refs', 'file_annotation_refs'] as const;
type RestrictedTable = typeof RESTRICTED_SQL_TABLES[number];

const ALLOWED_TABLES = new Set<string>(RESTRICTED_SQL_TABLES);

/** Tables present in SiYuan's index DB (3.x) that cannot be scoped by notebook. */
const KNOWN_UNSCOPED_TABLES = [
    'stat',
    'blocks_fts', 'blocks_fts_case_insensitive',
    'blocks_fts_data', 'blocks_fts_idx', 'blocks_fts_docsize', 'blocks_fts_config', 'blocks_fts_content',
    'blocks_fts_case_insensitive_data', 'blocks_fts_case_insensitive_idx', 'blocks_fts_case_insensitive_docsize',
    'blocks_fts_case_insensitive_config', 'blocks_fts_case_insensitive_content',
    'block_embeddings',
    'sqlite_master', 'sqlite_schema', 'sqlite_temp_master', 'sqlite_temp_schema', 'sqlite_sequence',
    'sqlite_stat1', 'sqlite_stat2', 'sqlite_stat3', 'sqlite_stat4',
    // Eponymous virtual tables that exist without being listed in sqlite_master.
    'dbstat', 'sqlite_dbpage', 'sqlite_stmt', 'fts5vocab', 'fts3tokenize', 'zipfile', 'fsdir',
    'generate_series', 'carray', 'completion', 'bytecode', 'tables_used',
];

/** Table-valued functions that only read their own arguments. */
const SAFE_TABLE_FUNCTIONS = new Set(['json_each', 'json_tree', 'jsonb_each', 'jsonb_tree']);

/** Functions that are never needed for querying and may touch more than the index. */
const DENIED_FUNCTIONS = new Set(['load_extension', 'fts3_tokenizer', 'readfile', 'writefile', 'edit', 'sqlite_dbpage', 'highlight', 'snippet', 'bm25', 'fts5']);

const SAFE_SQLITE_FUNCTIONS = new Set(['sqlite_version', 'sqlite_source_id']);

/** Unquoted keywords that never belong in a read-only SELECT. */
const DENIED_KEYWORDS = new Set([
    'ATTACH', 'DETACH', 'PRAGMA', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
    'VACUUM', 'REINDEX', 'ANALYZE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'TRIGGER',
]);

/** Keywords that end a FROM clause at the same nesting level. */
const FROM_TERMINATORS = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'INTERSECT', 'EXCEPT', 'SELECT', 'VALUES']);

/** Keywords that may directly follow a table reference (so it has no implicit alias). */
const TABLE_FOLLOW_KEYWORDS = new Set([
    'ON', 'USING', 'JOIN', 'LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS', 'NATURAL', 'OUTER',
    'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW', 'UNION', 'INTERSECT', 'EXCEPT',
    'INDEXED', 'NOT', 'RETURNING', 'OFFSET',
]);

const MAX_NESTING_DEPTH = 64;

export const SCOPE_CTE_NAME = 'sisyphus_scope';
const KERNEL_PARSER_GUARD = `[${SCOPE_CTE_NAME}] AS (SELECT '' || '')`;

export class RestrictedSqlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RestrictedSqlError';
    }
}

export function restrictedTablesHint(): string {
    return `Restricted SQL can read only these tables: ${RESTRICTED_SQL_TABLES.join(', ')} (rows from unreadable notebooks are invisible).`;
}

function reject(message: string): never {
    throw new RestrictedSqlError(`${message} ${restrictedTablesHint()}`);
}

// ---------------------------------------------------------------------------
// Tokenizer (mirrors sqlite3GetToken lexical classes)
// ---------------------------------------------------------------------------

type TokenType = 'space' | 'comment' | 'ident' | 'qident' | 'string' | 'number' | 'blob' | 'variable' | 'punct';

export interface SqlToken {
    type: TokenType;
    text: string;
    /** ident: ASCII upper-cased text; qident/string: unescaped body; punct: operator. */
    value: string;
}

function isSpace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r';
}

function isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
}

/** SQLite treats every byte >= 0x80 as an identifier character. */
function isIdStart(ch: string | undefined): boolean {
    if (ch === undefined) return false;
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch.charCodeAt(0) >= 0x80;
}

function isIdChar(ch: string | undefined): boolean {
    return isIdStart(ch) || isDigit(ch) || ch === '$';
}

/** SQLite keyword/identifier comparison folds ASCII only. */
function asciiUpper(value: string): string {
    return value.replace(/[a-z]/g, (c) => c.toUpperCase());
}

function asciiLower(value: string): string {
    return value.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

const MULTI_CHAR_OPERATORS = ['->>', '||', '<=', '>=', '<>', '!=', '==', '<<', '>>', '->'];
const SINGLE_CHAR_OPERATORS = new Set(['(', ')', ',', ';', '.', '+', '-', '*', '/', '%', '<', '>', '=', '&', '|', '~']);

export function tokenizeSql(sql: string): SqlToken[] {
    const tokens: SqlToken[] = [];
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i];
        const next = sql[i + 1];
        const start = i;

        if (ch === '\0') reject('NUL characters are not allowed in SQL.');

        if (isSpace(ch)) {
            while (i < sql.length && isSpace(sql[i])) i += 1;
            tokens.push({ type: 'space', text: sql.slice(start, i), value: ' ' });
            continue;
        }
        if (ch === '-' && next === '-') {
            while (i < sql.length && sql[i] !== '\n') i += 1;
            tokens.push({ type: 'comment', text: sql.slice(start, i), value: '' });
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = sql.indexOf('*/', i + 2);
            if (end < 0) reject('Unterminated /* comment.');
            i = end + 2;
            tokens.push({ type: 'comment', text: sql.slice(start, i), value: '' });
            continue;
        }
        if (ch === '\'' || ch === '"' || ch === '`') {
            let body = '';
            i += 1;
            let closed = false;
            while (i < sql.length) {
                if (sql[i] === ch) {
                    if (sql[i + 1] === ch) {
                        body += ch;
                        i += 2;
                        continue;
                    }
                    i += 1;
                    closed = true;
                    break;
                }
                body += sql[i];
                i += 1;
            }
            if (!closed) reject(`Unterminated ${ch} quote.`);
            tokens.push({ type: ch === '\'' ? 'string' : 'qident', text: sql.slice(start, i), value: body });
            continue;
        }
        if (ch === '[') {
            const end = sql.indexOf(']', i + 1);
            if (end < 0) reject('Unterminated [identifier].');
            i = end + 1;
            tokens.push({ type: 'qident', text: sql.slice(start, i), value: sql.slice(start + 1, end) });
            continue;
        }
        if ((ch === 'x' || ch === 'X') && next === '\'') {
            i += 2;
            while (i < sql.length && sql[i] !== '\'') i += 1;
            if (i >= sql.length) reject('Unterminated blob literal.');
            i += 1;
            tokens.push({ type: 'blob', text: sql.slice(start, i), value: '' });
            continue;
        }
        if (isDigit(ch) || (ch === '.' && isDigit(next))) {
            // Consume the whole numeric literal; SQLite rejects a number directly followed by identifier chars.
            while (i < sql.length) {
                const c = sql[i];
                if (isIdChar(c) || c === '.') {
                    i += 1;
                    continue;
                }
                if ((c === '+' || c === '-') && (sql[i - 1] === 'e' || sql[i - 1] === 'E') && !/^0[xX]/.test(sql.slice(start, i))) {
                    i += 1;
                    continue;
                }
                break;
            }
            tokens.push({ type: 'number', text: sql.slice(start, i), value: sql.slice(start, i) });
            continue;
        }
        if (isIdStart(ch)) {
            while (i < sql.length && isIdChar(sql[i])) i += 1;
            const text = sql.slice(start, i);
            tokens.push({ type: 'ident', text, value: asciiUpper(text) });
            continue;
        }
        if (ch === '?' || ch === ':' || ch === '@' || ch === '$' || ch === '#') {
            reject('Bound parameters are not supported in query_sql.');
        }
        const multi = MULTI_CHAR_OPERATORS.find((op) => sql.startsWith(op, i));
        if (multi) {
            i += multi.length;
            tokens.push({ type: 'punct', text: multi, value: multi });
            continue;
        }
        if (SINGLE_CHAR_OPERATORS.has(ch)) {
            i += 1;
            tokens.push({ type: 'punct', text: ch, value: ch });
            continue;
        }
        reject(`Unrecognized character ${JSON.stringify(ch)} in SQL.`);
    }
    return tokens;
}

// ---------------------------------------------------------------------------
// Structural walk + rewrite
// ---------------------------------------------------------------------------

export interface RestrictedSqlOptions {
    /** Notebook IDs whose rows may be visible. */
    readableNotebookIds: string[];
    /** Real table/view names from sqlite_master (lower-cased or not); unioned with the static list. */
    existingTables?: Iterable<string>;
}

export interface RestrictedSqlRewrite {
    sql: string;
    tables: RestrictedTable[];
}

function buildScopedSubquery(table: RestrictedTable, notebookList: string): string {
    const base = `SELECT * FROM main.${table} WHERE box IN (${notebookList})`;
    if (table === 'refs') {
        // A ref row also exposes the definition block's IDs/path and its anchor text.
        // Require the definition block to live in a readable notebook as well.
        return `${base} AND def_block_id IN (SELECT id FROM main.blocks WHERE box IN (${notebookList}))`;
    }
    return base;
}

class RestrictedSqlRewriter {
    private readonly sig: number[] = [];
    private pos = 0;
    private depth = 0;
    private readonly edits = new Map<number, string>();
    private readonly cteNames = new Set<string>();
    private readonly tables = new Set<RestrictedTable>();
    private readonly unscopedTables: Set<string>;
    private readonly notebookList: string;

    constructor(private readonly tokens: SqlToken[], options: RestrictedSqlOptions) {
        tokens.forEach((token, index) => {
            if (token.type !== 'space' && token.type !== 'comment') this.sig.push(index);
        });
        this.unscopedTables = new Set(KNOWN_UNSCOPED_TABLES);
        for (const name of options.existingTables ?? []) {
            const key = asciiLower(String(name));
            if (!ALLOWED_TABLES.has(key)) this.unscopedTables.add(key);
        }
        const ids = [...new Set(options.readableNotebookIds)].map((id) => `'${escapeSqlString(id)}'`);
        this.notebookList = ids.length > 0 ? ids.join(', ') : 'NULL';
    }

    // --- token helpers -----------------------------------------------------

    private tok(offset = 0): SqlToken | undefined {
        const index = this.sig[this.pos + offset];
        return index === undefined ? undefined : this.tokens[index];
    }

    private tokenIndex(offset = 0): number {
        return this.sig[this.pos + offset];
    }

    private isKw(token: SqlToken | undefined, keyword: string): boolean {
        return token?.type === 'ident' && token.value === keyword;
    }

    private isPunct(token: SqlToken | undefined, punct: string): boolean {
        return token?.type === 'punct' && token.value === punct;
    }

    private isName(token: SqlToken | undefined): boolean {
        return token?.type === 'ident' || token?.type === 'qident';
    }

    private nameKey(token: SqlToken): string {
        return asciiLower(token.type === 'ident' ? token.text : token.value);
    }

    private isTableLikeName(key: string): boolean {
        return ALLOWED_TABLES.has(key)
            || this.unscopedTables.has(key)
            || key.startsWith('sqlite_')
            || key.startsWith('pragma_')
            || key.includes('_fts');
    }

    // --- entry -------------------------------------------------------------

    rewrite(): RestrictedSqlRewrite {
        const first = this.tok();
        if (!this.isKw(first, 'SELECT') && !this.isKw(first, 'WITH')) {
            reject('Only a single SELECT (optionally with WITH CTEs) is allowed.');
        }
        this.walkLevel('top');
        if (this.pos < this.sig.length) reject('Unbalanced parentheses in SQL.');

        // Kernel parser guard: see module comment.
        let prefix = '';
        if (this.isKw(first, 'WITH')) {
            const second = this.tokens[this.sig[1]];
            if (this.isKw(second, 'RECURSIVE')) {
                this.appendEdit(this.sig[1], ` ${KERNEL_PARSER_GUARD},`);
            } else {
                this.appendEdit(this.sig[0], ` ${KERNEL_PARSER_GUARD},`);
            }
        } else {
            prefix = `WITH ${KERNEL_PARSER_GUARD} `;
        }

        const sql = prefix + this.tokens.map((token, index) => this.edits.get(index) ?? token.text).join('');
        return { sql, tables: [...this.tables] };
    }

    private appendEdit(index: number, suffix: string): void {
        this.edits.set(index, (this.edits.get(index) ?? this.tokens[index].text) + suffix);
    }

    // --- levels ------------------------------------------------------------

    /**
     * Walk tokens until the `)` closing this level (left unconsumed) or EOF.
     * kind: top = whole statement; paren = subquery/expression group; from = parenthesised join list.
     */
    private walkLevel(kind: 'top' | 'paren' | 'from'): void {
        this.depth += 1;
        if (this.depth > MAX_NESTING_DEPTH) reject('SQL is nested too deeply.');
        try {
            this.walkLevelBody(kind);
        } finally {
            this.depth -= 1;
        }
    }

    private walkLevelBody(kind: 'top' | 'paren' | 'from'): void {
        let inFrom = kind === 'from';
        let expectTable = kind === 'from';
        let atStart = true;

        while (this.pos < this.sig.length) {
            const token = this.tok()!;

            if (this.isPunct(token, ')')) {
                if (kind === 'top') reject('Unbalanced parentheses in SQL.');
                return;
            }
            if (this.isPunct(token, ';')) {
                if (kind !== 'top' || this.pos !== this.sig.length - 1) {
                    reject('Multiple SQL statements are not allowed.');
                }
                this.pos += 1;
                continue;
            }
            if (atStart && this.isKw(token, 'WITH')) {
                this.pos += 1;
                this.walkWith();
                atStart = false;
                continue;
            }
            atStart = false;

            if (expectTable) {
                this.consumeTableReference();
                expectTable = false;
                continue;
            }

            if (this.isPunct(token, '(')) {
                this.pos += 1;
                this.walkLevel('paren');
                this.expectCloseParen();
                continue;
            }

            if (this.isPunct(token, ',')) {
                if (inFrom) expectTable = true;
                this.pos += 1;
                continue;
            }

            if (token.type === 'ident') {
                const keyword = token.value;
                if (keyword === 'FROM') {
                    const prev = this.tok(-1);
                    const prev2 = this.tok(-2);
                    // `a IS [NOT] DISTINCT FROM b` is an operator, not a FROM clause.
                    const isDistinctFrom = this.isKw(prev, 'DISTINCT') && (this.isKw(prev2, 'IS') || this.isKw(prev2, 'NOT'));
                    if (!isDistinctFrom) {
                        inFrom = true;
                        expectTable = true;
                    }
                    this.pos += 1;
                    continue;
                }
                if (keyword === 'JOIN') {
                    if (!inFrom) reject('JOIN outside a FROM clause is not allowed.');
                    expectTable = true;
                    this.pos += 1;
                    continue;
                }
                if (keyword === 'IN' && !this.isPunct(this.tok(1), '(')) {
                    this.pos += 1;
                    this.consumeInTarget();
                    continue;
                }
                if (FROM_TERMINATORS.has(keyword)) {
                    inFrom = false;
                } else if (keyword === 'WINDOW' && this.isName(this.tok(1)) && this.isKw(this.tok(2), 'AS')) {
                    inFrom = false;
                }
            }

            this.checkIdentifier();
            this.pos += 1;
        }

        if (kind !== 'top') reject('Unbalanced parentheses in SQL.');
    }

    private expectCloseParen(): void {
        if (!this.isPunct(this.tok(), ')')) reject('Unbalanced parentheses in SQL.');
        this.pos += 1;
    }

    /** Parse `[RECURSIVE] name [(cols)] AS [[NOT] MATERIALIZED] (select) [, ...]`. */
    private walkWith(): void {
        if (this.isKw(this.tok(), 'RECURSIVE')) this.pos += 1;
        for (;;) {
            const nameToken = this.tok();
            if (!nameToken || !(this.isName(nameToken) || nameToken.type === 'string')) {
                reject('Malformed WITH clause.');
            }
            const key = this.nameKey(nameToken);
            if (this.isTableLikeName(key) || SAFE_TABLE_FUNCTIONS.has(key) || key === SCOPE_CTE_NAME) {
                reject(`CTE name "${key}" shadows a real table or reserved name; choose another CTE name.`);
            }
            this.cteNames.add(key);
            this.pos += 1;

            if (this.isPunct(this.tok(), '(')) {
                this.pos += 1;
                while (this.pos < this.sig.length && !this.isPunct(this.tok(), ')')) {
                    const column = this.tok()!;
                    if (!this.isName(column) && !this.isPunct(column, ',')) reject('Malformed CTE column list.');
                    this.pos += 1;
                }
                this.expectCloseParen();
            }
            if (!this.isKw(this.tok(), 'AS')) reject('Malformed WITH clause.');
            this.pos += 1;
            if (this.isKw(this.tok(), 'NOT') && this.isKw(this.tok(1), 'MATERIALIZED')) this.pos += 2;
            else if (this.isKw(this.tok(), 'MATERIALIZED')) this.pos += 1;
            if (!this.isPunct(this.tok(), '(')) reject('Malformed WITH clause.');
            this.pos += 1;
            this.walkLevel('paren');
            this.expectCloseParen();
            if (this.isPunct(this.tok(), ',')) {
                this.pos += 1;
                continue;
            }
            break;
        }
        if (!this.isKw(this.tok(), 'SELECT') && !this.isKw(this.tok(), 'VALUES')) {
            reject('The statement after WITH must be a SELECT.');
        }
    }

    /** A table position after FROM / JOIN / comma in FROM. */
    private consumeTableReference(): void {
        const token = this.tok();
        if (!token) reject('Missing table after FROM/JOIN.');

        if (this.isPunct(token, '(')) {
            this.pos += 1;
            const inner = this.tok();
            const isSubquery = this.isKw(inner, 'SELECT') || this.isKw(inner, 'WITH') || this.isKw(inner, 'VALUES');
            this.walkLevel(isSubquery ? 'paren' : 'from');
            this.expectCloseParen();
            return;
        }
        if (token.type === 'string') reject('Quoted strings cannot be used as table names.');
        if (!this.isName(token) || (token.type === 'ident' && (TABLE_FOLLOW_KEYWORDS.has(token.value) || FROM_TERMINATORS.has(token.value)))) {
            reject('Unsupported FROM clause.');
        }

        const key = this.nameKey(token);
        const next = this.tok(1);
        if (this.isPunct(next, '.')) reject(`Schema-qualified table names (${token.text}.…) are not allowed.`);
        if (this.isPunct(next, '(')) {
            if (!SAFE_TABLE_FUNCTIONS.has(key)) reject(`Table-valued function "${key}" is not allowed.`);
            this.pos += 1; // the argument list is walked as an ordinary parenthesised expression
            return;
        }
        if (ALLOWED_TABLES.has(key)) {
            const table = key as RestrictedTable;
            this.tables.add(table);
            const subquery = `(${buildScopedSubquery(table, this.notebookList)})`;
            this.edits.set(this.tokenIndex(), this.hasExplicitAlias(1) ? subquery : `${subquery} AS ${token.text}`);
            this.pos += 1;
            return;
        }
        if (this.cteNames.has(key)) {
            this.pos += 1;
            return;
        }
        reject(`Table "${key}" cannot be scoped by notebook and is not available in restricted mode.`);
    }

    /** `expr [NOT] IN table` (no parenthesis): SQLite reads a table here. */
    private consumeInTarget(): void {
        const token = this.tok();
        if (!token) reject('Missing IN target.');
        if (token.type === 'string') reject('Quoted strings cannot be used as table names.');
        if (!this.isName(token)) return; // e.g. a parameterless function call or expression; walked normally
        const key = this.nameKey(token);
        const next = this.tok(1);
        if (this.isPunct(next, '.')) reject(`Schema-qualified table names (${token.text}.…) are not allowed.`);
        if (this.isPunct(next, '(')) {
            if (!SAFE_TABLE_FUNCTIONS.has(key)) {
                // Ordinary scalar function? SQLite only accepts table-valued functions here.
                reject(`Table-valued function "${key}" is not allowed.`);
            }
            this.pos += 1;
            return;
        }
        if (ALLOWED_TABLES.has(key)) {
            const table = key as RestrictedTable;
            this.tables.add(table);
            this.edits.set(this.tokenIndex(), `(${buildScopedSubquery(table, this.notebookList)})`);
            this.pos += 1;
            return;
        }
        if (this.cteNames.has(key)) {
            this.pos += 1;
            return;
        }
        reject(`Table "${key}" cannot be scoped by notebook and is not available in restricted mode.`);
    }

    private hasExplicitAlias(offset: number): boolean {
        const next = this.tok(offset);
        if (!next) return false;
        if (this.isKw(next, 'AS')) return true;
        if (next.type === 'qident' || next.type === 'string') return true;
        if (next.type === 'ident') return !TABLE_FOLLOW_KEYWORDS.has(next.value) && !FROM_TERMINATORS.has(next.value);
        return false;
    }

    /** Rules for every identifier outside table positions. */
    private checkIdentifier(): void {
        const token = this.tok()!;
        if (token.type !== 'ident' && token.type !== 'qident') return;

        if (token.type === 'ident' && DENIED_KEYWORDS.has(token.value)) {
            reject(`Keyword ${token.value} is not allowed in query_sql.`);
        }

        const prev = this.tok(-1);
        const next = this.tok(1);
        const key = this.nameKey(token);

        // Name being defined: column/table alias, CAST type, window name.
        if (this.isKw(prev, 'AS') && !this.isPunct(next, '.')) return;

        if (DENIED_FUNCTIONS.has(key)) reject(`Function "${key}" is not allowed in query_sql.`);
        if (key.startsWith('pragma_')) reject('pragma_* functions are not allowed in query_sql.');
        if (key.startsWith('sqlite_')) {
            if (token.type === 'ident' && SAFE_SQLITE_FUNCTIONS.has(key) && this.isPunct(next, '(')) return;
            reject(`"${key}" is not allowed in query_sql.`);
        }

        if (this.isTableLikeName(key)) {
            // `blocks.id` qualifies a FROM item (which is already scoped); `x.blocks` would be schema-qualified.
            if (this.isPunct(next, '.') && !this.isPunct(prev, '.') && ALLOWED_TABLES.has(key)) return;
            if (ALLOWED_TABLES.has(key)) {
                reject(`Table "${key}" may only appear directly after FROM/JOIN (with an optional alias).`);
            }
            reject(`Table "${key}" cannot be scoped by notebook and is not available in restricted mode.`);
        }
    }
}

/**
 * Rewrite a caller-supplied SELECT so that it can only observe rows from the
 * given readable notebooks. Throws RestrictedSqlError when the statement
 * cannot be scoped safely.
 */
export function rewriteRestrictedSql(sql: string, options: RestrictedSqlOptions): RestrictedSqlRewrite {
    const tokens = tokenizeSql(sql);
    return new RestrictedSqlRewriter(tokens, options).rewrite();
}
