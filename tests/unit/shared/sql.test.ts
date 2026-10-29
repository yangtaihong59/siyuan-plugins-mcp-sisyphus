import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { escapeSqlString } from '@/shared/sql';

type SqliteDb = { prepare(sql: string): { all(): Record<string, unknown>[] } };
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb };

// Values that differ between SQLite and MySQL/rqlite-style lexers. The same
// corpus (and a cross-product of these pieces around a hidden subquery) was
// replayed against SiYuan 3.8.8's /api/query/sql: every literal round-tripped.
const NASTY = [
    '\\', "\\'", "x\\' OR 1=1 -- ", "' OR 1=1 --", '"a` , (SELECT upper(\'leak\')) , `b"', '`', '[x]', '/* c */', '-- c',
    'a\nb', 'tab\tx', '\r', '\u0001\u001f\u007f', ' ', 'é漢字', '%_', '\\\\%', ';SELECT 1',
];

describe('escapeSqlString', () => {
    it('doubles single quotes, strips NUL and leaves backslashes alone', () => {
        expect(escapeSqlString("it's")).toBe("it''s");
        expect(escapeSqlString('a\0b')).toBe('ab');
        expect(escapeSqlString('a\\b')).toBe('a\\b');
    });

    it.each(NASTY)('round-trips %j as a single SQLite string literal', (value) => {
        const db = new DatabaseSync(':memory:');
        const rows = db.prepare(`SELECT '${escapeSqlString(value)}' AS s`).all();
        expect(rows).toEqual([{ s: value }]);
    });
});
