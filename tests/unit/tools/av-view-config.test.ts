import { describe, expect, it } from 'vitest';
import { normalizeAvFilters } from '@/tools/av/view-config';

const leaf = (type: string, option: Record<string, unknown>) => ({
    column: 'status', operator: '=', value: { type, mSelect: [option] },
});

describe('native select filter defaults', () => {
    it.each(['select', 'mSelect'])('matches the serialized empty color without mutating %s input', (type) => {
        const input = [leaf(type, { content: '待办' })];
        const before = structuredClone(input);
        const native = [{ column: '', operator: '', value: null, combination: 'and', filters: [leaf(type, { content: '待办', color: '' })] }];
        expect(normalizeAvFilters(input)).toEqual(normalizeAvFilters(native));
        expect(input).toEqual(before);
    });

    it('normalizes select defaults at every level while preserving an OR group', () => {
        const input = [{ combination: 'or', filters: [leaf('select', { content: '待办' }), { combination: 'and', filters: [leaf('mSelect', { content: '完成' })] }] }];
        const native = [{ combination: 'or', filters: [leaf('select', { content: '待办', color: '' }), { combination: 'and', filters: [leaf('mSelect', { content: '完成', color: '' })] }] }];
        expect(normalizeAvFilters(input)).toEqual(normalizeAvFilters(native));
        expect(normalizeAvFilters(input)).not.toEqual(normalizeAvFilters([{ ...native[0], combination: 'and' }]));
    });

    it('normalizes an optional empty child list on a leaf like the native root wrapper', () => {
        const filter = leaf('select', { content: '待办' });
        expect(normalizeAvFilters([{ ...filter, filters: [] }])).toEqual(normalizeAvFilters([filter]));
    });

    it.each([
        { content: '完成', color: '' },
        { content: '', color: '' },
        { color: '' },
        { content: '待办', color: '2' },
        { content: '待办', color: null },
        { content: '待办', color: '', unexpected: true },
    ])('preserves material option differences: %j', (observed) => {
        expect(normalizeAvFilters([leaf('select', { content: '待办' })]))
            .not.toEqual(normalizeAvFilters([leaf('select', observed)]));
    });

    it('preserves explicit colors, option ordering and the typed value', () => {
        const input = [{ column: 'status', operator: '=', value: { type: 'mSelect', mSelect: [{ content: 'A', color: '1' }, { content: 'B', color: '2' }] } }];
        const reversed = structuredClone(input); reversed[0].value.mSelect.reverse();
        expect(normalizeAvFilters(input)).not.toEqual(normalizeAvFilters(reversed));
        expect(normalizeAvFilters([leaf('select', { content: 'A', color: '1' })]))
            .not.toEqual(normalizeAvFilters([leaf('mSelect', { content: 'A', color: '1' })]));
        expect(normalizeAvFilters([leaf('select', { content: 'A', color: '1' })]))
            .not.toEqual(normalizeAvFilters([leaf('select', { content: 'A', color: '' })]));
    });

    it('does not normalize other value types or invent null/empty/missing options', () => {
        const unrelated = [leaf('text', { content: '待办' })];
        expect(normalizeAvFilters(unrelated)).not.toEqual(normalizeAvFilters([leaf('text', { content: '待办', color: '' })]));
        const input = [{ column: 'status', operator: '=', value: { type: 'select', mSelect: [null, [], 'text'] } }];
        expect((normalizeAvFilters(input)[0] as any).filters[0].value.mSelect).toEqual([null, [], 'text']);
        expect(normalizeAvFilters([{ column: 'status', operator: '=', value: { type: 'select', mSelect: [] } }]))
            .not.toEqual(normalizeAvFilters([{ column: 'status', operator: '=', value: { type: 'select' } }]));
    });
});
