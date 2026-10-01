import { describe, expect, it } from 'vitest';

import {
    mergePropertySchemas,
    normalizeJsonSchema,
} from '@/tools/internal/schema-analyzer';
import { createActionSchema } from '@/tools/internal/shared';
import { buildAggregatedTool } from '@/tools/internal/shared';

describe('schema-analyzer helpers', () => {
    it('isolates recursive definitions from different actions without mutating the source', () => {
        const variants = ['set_filters', 'set_sorts'].map((action) => ({
            action,
            schema: createActionSchema(action, {
                [action]: { $ref: '#/$defs/__schema0' },
            }, []),
        }));
        for (const variant of variants) variant.schema.$defs = {
            __schema0: { type: 'object', properties: {
                value: { const: variant.action },
                children: { type: 'array', items: { $ref: '#/$defs/__schema0' } },
            } },
        };
        const schema = buildAggregatedTool('av', '', {
            enabled: true, actions: { set_filters: true, set_sorts: true },
        }, variants)[0].inputSchema;
        for (const { action } of variants) {
            expect(schema.properties[action].$ref).toBe(`#/$defs/${action}/$defs/__schema0`);
            const definition = schema.$defs[action].$defs.__schema0;
            expect(definition.properties.value.const).toBe(action);
            expect(definition.properties.children.items.$ref).toBe(`#/$defs/${action}/$defs/__schema0`);
        }
        expect(variants[0].schema.properties.set_filters.$ref).toBe('#/$defs/__schema0');
    });

    it('keeps one description per merged property without changing small nested schemas', () => {
        const merged = mergePropertySchemas([
            createActionSchema('append', {
                parentID: { type: 'string', description: 'Parent ID' },
                items: { type: 'array', items: { type: 'string' }, description: 'Values' },
            }, ['parentID']),
            createActionSchema('update', {
                parentID: { type: 'string', description: 'Parent block ID for update' },
            }, []),
        ].map((schema, index) => ({ action: index === 0 ? 'append' : 'update', schema })));

        expect((merged.parentID as Record<string, unknown>).description).toBe('Parent ID');
        expect((merged.items as Record<string, unknown>).items).toEqual({ type: 'string' });
    });

    it('hides deprecated and pure alias properties from the merged schema', () => {
        const merged = mergePropertySchemas([{
            action: 'lookup',
            schema: createActionSchema('lookup', {
                hpath: { type: 'string', description: 'Human path' },
                hPath: { type: 'string', description: 'Alias for hpath' },
                id: { type: 'string', deprecated: true },
                orderBy: { type: 'number', description: 'Legacy numeric sort order' },
                mode: { type: 'string', description: 'Compatibility option.' },
            }, []),
        }]);

        expect(Object.keys(merged)).toEqual(['hpath']);
    });

    it('collapses large nested property schemas to a help pointer', () => {
        const leaf = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`field${i}`, { type: 'string' }]));
        const merged = mergePropertySchemas([{
            action: 'set_filters',
            schema: createActionSchema('set_filters', {
                filters: { type: 'array', description: 'Filter tree.', items: { type: 'object', properties: leaf } },
                mixed: { anyOf: [{ type: 'string' }, { type: 'object', properties: leaf }] },
            }, ['filters']),
        }]);

        expect(merged.filters).toEqual({
            type: 'array',
            items: { type: 'object' },
            description: 'Filter tree. Read action="help", topic="<action>" before constructing this nested value.',
        });
        expect(merged.mixed).toEqual({ description: 'Read action="help", topic="<action>" before constructing this nested value.' });
    });

    it('does not drop scalar types or enums when their descriptions are long', () => {
        const mode = { type: 'string', enum: ['a', 'b'], description: 'long '.repeat(200) };
        const count = { type: 'integer', minimum: 1, description: 'long '.repeat(200) };
        const merged = mergePropertySchemas([{ action: 'read', schema: createActionSchema('read', { mode, count }, []) }]);
        expect(merged.mode).toEqual(mode);
        expect(merged.count).toEqual(count);
    });

    it('normalizes nested array item schemas', () => {
        const schema = normalizeJsonSchema({
            type: 'object',
            properties: {
                values: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            tags: { type: 'array' },
                        },
                    },
                },
            },
        }) as Record<string, any>;

        expect(schema.properties.values.items.properties.tags.items).toEqual({ type: 'string' });
    });
});
