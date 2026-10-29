import { describe, expect, it } from 'vitest';
import { toCanonicalAvCell } from '@/tools/av/cell-shape';

/** Rendered kernel cells as SiYuan 3.8 returns them from renderAttributeView. */
const cell = (value: Record<string, unknown>, valueType?: string) => ({ id: 'v', value: { keyID: 'k', blockID: 'r', ...value }, ...(valueType ? { valueType } : {}) });

describe('canonical AV cell { type, value, formatted }', () => {
    it('reads the primary key as a string, dropping kernel created/updated', () => {
        expect(toCanonicalAvCell(cell({ type: 'block', isDetached: true, block: { content: 'Standup', created: 1, updated: 2 } }, 'block'), 'block'))
            .toEqual({ type: 'block', value: 'Standup', formatted: 'Standup' });
    });

    it('keeps the displayed block content when an older write left a stray text object', () => {
        expect(toCanonicalAvCell(cell({ type: 'block', block: { content: 'Dentist' }, text: { content: 'ignored' } }), 'block'))
            .toEqual({ type: 'block', value: 'Dentist', formatted: 'Dentist' });
    });

    it('returns the same primary-key shape for a bare kernel value (primary_keys mode)', () => {
        expect(toCanonicalAvCell({ id: 'v', blockID: 'r', isDetached: true, block: { content: 'Independent' } }, 'block'))
            .toEqual({ type: 'block', value: 'Independent', formatted: 'Independent' });
    });

    it('maps dates to epoch ms or {start,end} and keeps kernel formatting', () => {
        expect(toCanonicalAvCell(cell({ type: 'date', date: { content: 1793871000000, isNotEmpty: true, hasEndDate: true, content2: 1793872800000, isNotEmpty2: true, formattedContent: '2026-11-05 09:30 → 2026-11-05 10:00' } }), 'date'))
            .toEqual({ type: 'date', value: { start: 1793871000000, end: 1793872800000 }, formatted: '2026-11-05 09:30 → 2026-11-05 10:00' });
        expect(toCanonicalAvCell(cell({ type: 'date', date: { content: 1794009600000, isNotEmpty: true, hasEndDate: false, isNotTime: true, formattedContent: '2026-11-07' } }), 'date'))
            .toEqual({ type: 'date', value: 1794009600000, formatted: '2026-11-07' });
        expect(toCanonicalAvCell(cell({ type: 'date', date: { content: 0, isNotEmpty: false } }), 'date'))
            .toEqual({ type: 'date', value: null, formatted: '' });
        // Without kernel formatting MCP does not invent a timezone.
        expect(toCanonicalAvCell(cell({ type: 'date', date: { content: 5, isNotEmpty: true } }), 'date'))
            .toEqual({ type: 'date', value: 5, formatted: '' });
    });

    it('maps select and multi-select to option-name arrays, empty when unset', () => {
        expect(toCanonicalAvCell(cell({ type: 'select', mSelect: [{ content: 'Meeting', color: '' }] }), 'select'))
            .toEqual({ type: 'select', value: ['Meeting'], formatted: 'Meeting' });
        expect(toCanonicalAvCell(cell({ type: 'mSelect', mSelect: [{ content: 'team' }, { content: 'daily' }] }), 'mSelect'))
            .toEqual({ type: 'mSelect', value: ['team', 'daily'], formatted: 'team, daily' });
        expect(toCanonicalAvCell(cell({ type: 'select', createdAt: 1 }), 'select'))
            .toEqual({ type: 'select', value: [], formatted: '' });
    });

    it('maps number, checkbox and text scalars', () => {
        expect(toCanonicalAvCell(cell({ number: { content: 0.5, isNotEmpty: true, formattedContent: '0.5' } }), 'number'))
            .toEqual({ type: 'number', value: 0.5, formatted: '0.5' });
        expect(toCanonicalAvCell(cell({ number: { content: 0, isNotEmpty: false } }), 'number'))
            .toEqual({ type: 'number', value: null, formatted: '' });
        expect(toCanonicalAvCell(cell({ checkbox: { checked: false } }), 'checkbox'))
            .toEqual({ type: 'checkbox', value: false, formatted: 'false' });
        expect(toCanonicalAvCell(cell({ text: { content: '' } }), 'text'))
            .toEqual({ type: 'text', value: '', formatted: '' });
        expect(toCanonicalAvCell(cell({ url: { content: 'https://x.test' } }), 'url'))
            .toEqual({ type: 'url', value: 'https://x.test', formatted: 'https://x.test' });
    });

    it('maps relation, asset and rollup cells to arrays', () => {
        expect(toCanonicalAvCell(cell({ relation: { blockIDs: ['row-x'], contents: [{ type: 'block', block: { content: 'Paper X' } }] } }), 'relation'))
            .toEqual({ type: 'relation', value: ['row-x'], formatted: 'Paper X' });
        expect(toCanonicalAvCell(cell({ mAsset: [{ type: 'image', name: 'a.png', content: 'assets/a.png' }] }), 'mAsset'))
            .toEqual({ type: 'mAsset', value: ['assets/a.png'], formatted: 'a.png' });
        expect(toCanonicalAvCell(cell({ rollup: { contents: [{ type: 'number', number: { content: 3, isNotEmpty: true } }, { type: 'text', text: { content: 'b' } }] } }), 'rollup'))
            .toEqual({ type: 'rollup', value: [3, 'b'], formatted: '3, b' });
    });

    it('falls back to the cell valueType and then the value sub-object when the column type is unknown', () => {
        expect(toCanonicalAvCell(cell({ text: { content: 'x' } }, 'text'))).toEqual({ type: 'text', value: 'x', formatted: 'x' });
        expect(toCanonicalAvCell({ value: { number: { content: 2, isNotEmpty: true } } })).toEqual({ type: 'number', value: 2, formatted: '2' });
    });
});
