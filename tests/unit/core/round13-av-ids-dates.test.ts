import { describe, expect, it } from 'vitest';

import { getFlagAliasRules, normalizeToolArguments } from '@/core/argument-aliases';
import { buildStrongCellValue, dateCellOmitsTime, parseDateMillis } from '@/tools/av/definition';
import { verifyAvCellsReadback } from '@/tools/av/cell-readback';
import { estimateMarkdownBlocks } from '@/mcp/write-impact-preview';

describe('AV column ID spellings (round 13)', () => {
    it('accepts keyID for columnID in set_cells and add_rows cells', () => {
        expect(normalizeToolArguments('av', { action: 'set_cells', avID: 'a', rowID: 'r', keyID: 'c', valueType: 'text', text: 'x' }))
            .toEqual({ action: 'set_cells', avID: 'a', rowID: 'r', columnID: 'c', valueType: 'text', text: 'x' });
        expect(normalizeToolArguments('av', { action: 'set_cells', avID: 'a', cells: [{ rowID: 'r', keyID: 'c', valueType: 'text', text: 'x' }] }).cells)
            .toEqual([{ rowID: 'r', columnID: 'c', valueType: 'text', text: 'x' }]);
        expect((normalizeToolArguments('av', { action: 'add_rows', avID: 'a', rows: [{ clientKey: 'k', cells: [{ keyID: 'c', valueType: 'text', text: 'x' }] }] }).rows as any)[0].cells[0])
            .toEqual({ columnID: 'c', valueType: 'text', text: 'x' });
    });

    it('accepts columnID for keyID in column actions, and the CLI spellings of both', () => {
        expect(normalizeToolArguments('av', { action: 'rename', avID: 'a', columnID: 'c', keyName: 'N' })).toEqual({ action: 'rename', avID: 'a', keyID: 'c', keyName: 'N' });
        expect(getFlagAliasRules({ category: 'av', action: 'set_cells' })[0]).toMatchObject({ canonical: 'columnID', aliases: expect.arrayContaining(['key-id']) });
        expect(getFlagAliasRules({ category: 'av', action: 'rename' })[0]).toMatchObject({ canonical: 'keyID', aliases: expect.arrayContaining(['column-id']) });
    });
});

describe('date cells without a time (round 13)', () => {
    it('stores a date-only string as local midnight with no time component', () => {
        expect(parseDateMillis('2026-11-05', 'date')).toBe(new Date(2026, 10, 5).getTime());
        expect(dateCellOmitsTime({ date: '2026-11-05' })).toBe(true);
        expect(dateCellOmitsTime({ date: '2026-11-05', includeTime: true })).toBe(false);
        expect(dateCellOmitsTime({ date: '2026-11-05T14:30' })).toBe(false);
        expect(dateCellOmitsTime({ date: 1_790_000_000_000 })).toBe(false);
        const value = buildStrongCellValue('col', 'row', { valueType: 'date', date: '2026-11-05' } as any) as any;
        expect(value.date).toMatchObject({ content: new Date(2026, 10, 5).getTime(), isNotTime: true });
    });

    it('reads a date-only cell back with the same rule', () => {
        const cell = { rowID: 'row', columnID: 'col', valueType: 'date', date: '2026-11-05' };
        const definition = { keyValues: [{ key: { id: 'col' }, values: [{ blockID: 'row', date: { isNotEmpty: true, content: new Date(2026, 10, 5).getTime(), isNotTime: true } }] }] };
        expect(() => verifyAvCellsReadback({ cells: [cell] }, definition)).not.toThrow();
    });
});

describe('document create block estimate (round 13)', () => {
    it('counts a list as one top-level block', () => {
        expect(estimateMarkdownBlocks('## A\n\n- one\n- two\n- three\n\n## B\n\nText')).toHaveLength(4);
    });
});
