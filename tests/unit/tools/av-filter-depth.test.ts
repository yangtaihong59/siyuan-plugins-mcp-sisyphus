import { describe, expect, it } from 'vitest';

import { AV_FILTER_MAX_DEPTH } from '@/core/types';
import { buildDefaultToolConfig, type AvAction, type CategoryToolConfig } from '@/core/config';
import { AV_TOOL_NAME, AV_VARIANTS, listAvTools } from '@/tools/av';

const setFiltersVariant = AV_VARIANTS.find((variant) => variant.action === 'set_filters');

// GLM-5.3's upstream inliner rejects recursive $refs with
// "tools.function.parameters: recursive $ref ... cannot be inlined",
// so the filter-tree schema must stay depth-bounded and $ref-free.
describe('av set_filters schema depth bounding', () => {
    it('exposes the set_filters variant', () => {
        expect(setFiltersVariant).toBeDefined();
    });

    it('emits a JSON schema without $ref/$defs', () => {
        const serialized = JSON.stringify(setFiltersVariant!.schema);
        expect(serialized).not.toContain('$ref');
        expect(serialized).not.toContain('$defs');
    });

    it('allows exactly AV_FILTER_MAX_DEPTH filter levels and stops nesting there', () => {
        let wrapper = (setFiltersVariant!.schema as any).properties.filters;
        let depth = 0;
        while (wrapper) {
            depth += 1;
            wrapper = wrapper.items?.properties?.filters;
        }
        expect(depth).toBe(AV_FILTER_MAX_DEPTH);
    });

    it('accepts a leaf-only filter tree', () => {
        setFiltersVariant!.validate({
            action: 'set_filters',
            avID: 'av-1',
            blockID: 'block-1',
            viewID: 'view-1',
            filters: [{ column: 'col-1', operator: 'Contains' }],
        });
    });

    it('accepts a tree nested exactly AV_FILTER_MAX_DEPTH levels', () => {
        let filter: Record<string, unknown> = { column: 'col-1', operator: 'Contains' };
        for (let level = 1; level < AV_FILTER_MAX_DEPTH; level++) {
            filter = { combination: 'and', filters: [filter] };
        }
        setFiltersVariant!.validate({
            action: 'set_filters',
            avID: 'av-1',
            blockID: 'block-1',
            viewID: 'view-1',
            filters: [filter],
        });
    });

    it('rejects a tree nested beyond AV_FILTER_MAX_DEPTH levels', () => {
        let filter: Record<string, unknown> = { column: 'col-1', operator: 'Contains' };
        for (let level = 0; level < AV_FILTER_MAX_DEPTH; level++) {
            filter = { combination: 'and', filters: [filter] };
        }
        expect(() => setFiltersVariant!.validate({
            action: 'set_filters',
            avID: 'av-1',
            blockID: 'block-1',
            viewID: 'view-1',
            filters: [filter],
        })).toThrow();
    });

    it('rejects a combination-only empty group at the deepest level (kernel ErrFilterTooDeep parity)', () => {
        // 4 nested groups (levels 1-4) with a combination-only node at level 5:
        // the kernel counts it as a group at depth 4 and rejects it, so zod must too.
        let filter: Record<string, unknown> = { combination: 'and' };
        for (let level = 0; level < 4; level++) {
            filter = { combination: 'and', filters: [filter] };
        }
        expect(() => setFiltersVariant!.validate({
            action: 'set_filters',
            avID: 'av-1',
            blockID: 'block-1',
            viewID: 'view-1',
            filters: [filter],
        })).toThrow();
    });

    it('keeps every AV action variant schema $ref-free', () => {
        for (const variant of AV_VARIANTS) {
            expect(JSON.stringify(variant.schema)).not.toContain('$ref');
        }
    });

    it('keeps the aggregated av tool schema $ref-free after buildAggregatedTool', () => {
        const config = buildDefaultToolConfig().av as CategoryToolConfig<AvAction>;
        const tools = listAvTools(config);
        const av = tools.find((tool) => tool.name === AV_TOOL_NAME);
        expect(av).toBeDefined();
        const serialized = JSON.stringify(av!.inputSchema);
        expect(serialized).not.toContain('$ref');
        expect(serialized).not.toContain('$defs');
    });
});
