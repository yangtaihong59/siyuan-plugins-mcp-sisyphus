/**
 * Escape a value for use inside a single-quoted SiYuan SQL string literal.
 *
 * SiYuan's /api/query/sql re-parses statements with a Go SQL parser and may
 * execute that parser's re-serialised text instead of the original. Audited on
 * SiYuan 3.8.8: single-quoted literals escaped this way round-trip exactly
 * (backslashes, backticks, double quotes, comment markers and control
 * characters included), whereas double-quoted identifiers containing
 * backticks do not. So user-controlled values must only ever be interpolated
 * through this helper inside '...' — never into "..." / `...` / [...]
 * identifiers. Numbers must be validated integers before interpolation.
 */
export function escapeSqlString(value: string): string {
    return value.replace(/\0/g, '').replace(/'/g, "''");
}
