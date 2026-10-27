/** Escape a value for use inside a single-quoted SiYuan SQL string literal. */
export function escapeSqlString(value: string): string {
    return value.replace(/\0/g, '').replace(/'/g, "''");
}
