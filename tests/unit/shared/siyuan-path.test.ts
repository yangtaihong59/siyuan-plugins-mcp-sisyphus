import { describe, expect, it } from 'vitest';

import { normalizeFsPath, stripSySuffix } from '@/shared/siyuan-path';
import { escapeSqlString } from '@/shared/sql';

describe('shared SiYuan path and SQL helpers', () => {
    it('strips only a trailing .sy suffix', () => {
        expect(stripSySuffix('20260101000000-abcdefg.sy')).toBe('20260101000000-abcdefg');
        expect(stripSySuffix('a.sy.md')).toBe('a.sy.md');
        expect(stripSySuffix(undefined)).toBeUndefined();
    });

    it('normalizes fs paths and rejects empty input', () => {
        expect(normalizeFsPath(' Notebook//Doc/ ')).toBe('/Notebook/Doc');
        expect(normalizeFsPath('/')).toBe('/');
        expect(() => normalizeFsPath('  ')).toThrow('fs path must not be empty.');
    });

    it('escapes quotes and drops NUL bytes for SQL string literals', () => {
        expect(escapeSqlString("it's\0")).toBe("it''s");
    });
});
