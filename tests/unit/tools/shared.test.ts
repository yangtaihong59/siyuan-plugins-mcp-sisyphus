import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError, z } from 'zod';
import {
    getSchemaProperties,
    getSchemaRequired,
    normalizeJsonSchema,
} from '@/tools/internal/schema-analyzer';
import {
    createActionSchema,
    createZodActionVariant,
    createJsonResult,
    createErrorResult,
    createPaginatedResult,
    createPermissionDeniedResult,
    createDisabledActionResult,
    buildAggregatedTool,
    type JsonSchema,
    type ActionVariant,
} from '@/tools/internal/shared';
import type { ToolCategory, CategoryToolConfig } from '@/core/config';

describe('createActionSchema', () => {
    it('should create schema with action and properties', () => {
        const properties: JsonSchema = {
            name: { type: 'string' },
            count: { type: 'number' },
        };
        const schema = createActionSchema('test', properties, ['name'], 'Test description');

        expect(schema.type).toBe('object');
        expect(schema.description).toBe('Test description');
        expect(schema.additionalProperties).toBe(false);
        expect(schema.properties?.action).toEqual({
            type: 'string',
            const: 'test',
            description: 'Action to perform',
        });
        expect(schema.properties?.name).toEqual({ type: 'string' });
        expect(schema.required).toEqual(['action', 'name']);
    });

    it('should create schema with no additional properties', () => {
        const schema = createActionSchema('empty', {}, [], 'Empty schema');

        expect(schema.properties?.action?.const).toBe('empty');
        expect(schema.required).toEqual(['action']);
    });
});

describe('createZodActionVariant', () => {
    it('derives JSON Schema from a Zod action schema', () => {
        const variant = createZodActionVariant('rename', z.object({
            action: z.literal('rename'),
            oldLabel: z.string().describe('Existing tag label'),
            newLabel: z.string().describe('New tag label'),
            dryRun: z.boolean().optional().describe('Preview only'),
        }), 'Rename a tag.');

        expect(variant.action).toBe('rename');
        expect(variant.schema.description).toBe('Rename a tag.');
        expect(variant.schema.additionalProperties).toBe(false);
        expect(variant.schema.properties?.action).toEqual({ type: 'string', const: 'rename' });
        expect(variant.schema.properties?.oldLabel?.description).toBe('Existing tag label');
        expect(variant.schema.properties?.dryRun?.type).toBe('boolean');
        expect(variant.schema.required).toEqual(['action', 'oldLabel', 'newLabel']);
        expect(variant.schema.$schema).toBeUndefined();
    });
});

describe('getSchemaProperties', () => {
    it('should return properties from schema', () => {
        const schema: JsonSchema = {
            type: 'object',
            properties: {
                foo: { type: 'string' },
                bar: { type: 'number' },
            },
        };
        expect(getSchemaProperties(schema)).toEqual({
            foo: { type: 'string' },
            bar: { type: 'number' },
        });
    });

    it('should return empty object for schema without properties', () => {
        expect(getSchemaProperties({})).toEqual({});
        expect(getSchemaProperties({ type: 'object' })).toEqual({});
    });

    it('should handle non-object properties', () => {
        const schema: JsonSchema = { properties: 'invalid' as unknown as JsonSchema };
        expect(getSchemaProperties(schema)).toEqual({});
    });
});

describe('getSchemaRequired', () => {
    it('should return required fields from schema', () => {
        const schema: JsonSchema = {
            type: 'object',
            required: ['foo', 'bar'],
        };
        expect(getSchemaRequired(schema)).toEqual(['foo', 'bar']);
    });

    it('should filter out non-string required values', () => {
        const schema: JsonSchema = {
            type: 'object',
            required: ['foo', 123, 'bar', null],
        };
        expect(getSchemaRequired(schema)).toEqual(['foo', 'bar']);
    });

    it('should return empty array for schema without required', () => {
        expect(getSchemaRequired({})).toEqual([]);
        expect(getSchemaRequired({ type: 'object' })).toEqual([]);
    });
});

describe('createJsonResult', () => {
    it('should create result with JSON content', () => {
        const data = { foo: 'bar', count: 42 };
        const result = createJsonResult(data);

        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toBe(JSON.stringify(data, null, 2));
        expect(result.isError).toBeUndefined();
    });

    it('should handle null value', () => {
        const result = createJsonResult(null);
        expect(result.content[0].text).toBe('null');
    });

    it('should handle nested objects', () => {
        const data = { nested: { deep: { value: 1 } }, list: [1, 2, 3] };
        const result = createJsonResult(data);
        expect(JSON.parse(result.content[0].text)).toEqual(data);
    });
});

describe('createErrorResult', () => {
    it('should create error result from Error', () => {
        const error = new Error('Something went wrong');
        const result = createErrorResult(error);

        expect(result.isError).toBe(true);
        expect(result.content[0].type).toBe('text');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.message).toBe('Something went wrong');
        expect(parsed.error.type).toBe('internal_error');
    });

    it('should create error result from API error', () => {
        const error = new Error('SiYuan API error: 404 - Not found');
        const result = createErrorResult(error);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.type).toBe('api_error');
    });

    it('should include context in error result', () => {
        const error = new Error('Test error');
        const result = createErrorResult(error, {
            tool: 'notebook',
            action: 'create',
        });

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.tool).toBe('notebook');
        expect(parsed.error.action).toBe('create');
    });

    it('should handle ZodError for validation errors', () => {
        const schema = z.object({ name: z.string(), count: z.number() });
        const parseResult = schema.safeParse({ name: 123, count: 'not a number' });

        expect(parseResult.success).toBe(false);
        if (!parseResult.success) {
            const result = createErrorResult(parseResult.error);
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error.type).toBe('validation_error');
            expect(parsed.error.fields).toBeDefined();
            expect(parsed.error.fields.length).toBeGreaterThan(0);
        }
    });

    it('should handle non-Error values', () => {
        const result = createErrorResult('string error');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.message).toBe('string error');
    });
});

describe('createPermissionDeniedResult', () => {
    it('should create permission denied result', () => {
        const result = createPermissionDeniedResult('notebook123', 'r', 'delete');

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.type).toBe('permission_denied');
        expect(parsed.error.notebook).toBe('notebook123');
        expect(parsed.error.current_permission).toBe('r');
        expect(parsed.error.required_permission).toBe('delete');
    });

    it('should include helpful message', () => {
        const result = createPermissionDeniedResult('nb', 'none', 'read');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.message).toContain('notebook');
        expect(parsed.error.message).toContain('set_permission');
    });
});

describe('createDisabledActionResult', () => {
    it('should create disabled action result', () => {
        const result = createDisabledActionResult('notebook' as ToolCategory, 'delete');

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.type).toBe('action_disabled');
        expect(parsed.error.tool).toBe('notebook');
        expect(parsed.error.action).toBe('delete');
        expect(parsed.error.hint).toContain('Settings');
    });
});

describe('buildAggregatedTool', () => {
    const mockConfig: CategoryToolConfig<string> = {
        enabled: true,
        actions: {
            list: true,
            create: true,
            remove: false,
        },
    };

    const variants: ActionVariant<string>[] = [
        { action: 'list', schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
        { action: 'create', schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
        { action: 'remove', schema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } },
    ];

    it('should return empty array when tool is disabled', () => {
        const config = { ...mockConfig, enabled: false };
        const result = buildAggregatedTool('notebook', 'Test tool', config, variants);
        expect(result).toEqual([]);
    });

    it('should return empty array when no actions enabled', () => {
        const config = {
            enabled: true,
            actions: { list: false, create: false },
        };
        const result = buildAggregatedTool('notebook', 'Test tool', config, variants);
        expect(result).toEqual([]);
    });

    it('should build tool with enabled actions only', () => {
        const result = buildAggregatedTool('notebook', 'Test tool', mockConfig, variants);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('notebook');
        expect(result[0].inputSchema.properties?.action?.enum).toEqual(['list', 'create', 'help']);
    });

    it('should include description with action list', () => {
        const result = buildAggregatedTool('notebook', 'Test tool', mockConfig, variants);

        expect(result[0].description).toContain('Test tool');
        expect(result[0].description).toContain('list');
        expect(result[0].description).toContain('create');
    });

    it('publishes typed action-specific properties at the top level without strict branches', () => {
        const result = buildAggregatedTool('notebook', 'Test tool', mockConfig, variants);
        const schema = result[0].inputSchema;

        expect(schema.properties?.id).toBeDefined();
        expect(schema.properties?.id?.type).toBe('string');
        expect(schema.properties?.name).toBeDefined();
        expect(schema.properties?.name?.type).toBe('string');
        expect(schema.properties?.topic).toBeDefined();
        expect(schema.oneOf).toBeUndefined();
        expect(schema.additionalProperties).toBe(true);
        expect(JSON.stringify(schema)).not.toContain('x-sisyphus-actionSchemas');
    });

    it('keeps strict action schemas for internal consumers', () => {
        const result = buildAggregatedTool('notebook', 'Test tool', mockConfig, variants);
        const schema = result[0].inputSchema;
        const branches = schema['x-sisyphus-actionSchemas'];

        expect(branches?.[0].properties?.action?.const).toBe('list');
        expect(branches?.[0].required).toContain('action');
        expect(branches?.[1].properties?.action?.const).toBe('create');
        expect(branches?.[2].properties?.action?.const).toBe('help');
    });

    it('serves guidance through help instead of the mount-time description', () => {
        const options = {
            guidance: ['Note: Be careful with this tool.'],
        };
        const result = buildAggregatedTool('notebook', 'Test tool', mockConfig, variants, options);

        expect(result[0].description).not.toContain('Be careful');
        expect(result[0].description).toContain('action="help"');
    });

    it('should include confirmation note for dangerous actions', () => {
        const configWithDangerous = {
            enabled: true,
            actions: { list: true, create: true, remove: true },
        };
        const result = buildAggregatedTool('notebook', 'Test tool', configWithDangerous, variants);

        expect(result[0].description).toContain('remove*(value)');
        expect(result[0].description).toContain('* = ask the user to confirm first.');
        const safe = buildAggregatedTool('notebook', 'Test tool', mockConfig, variants);
        expect(safe[0].description).not.toContain('confirm');
    });

    it('should preserve nested array item schemas', () => {
        const nestedVariants: ActionVariant<string>[] = [{
            action: 'create',
            schema: createActionSchema('create', {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            tags: {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        },
                        required: ['tags'],
                    },
                },
            }, ['items']),
        }];

        const result = buildAggregatedTool('notebook', 'Test tool', {
            enabled: true,
            actions: { create: true },
        }, nestedVariants);

        const schema = result[0].inputSchema;
        expect(schema['x-sisyphus-actionSchemas']?.[0].properties?.items?.items?.properties?.tags?.items).toEqual({ type: 'string' });
    });
});

describe('createPaginatedResult', () => {
    it('wraps items in the canonical { data, total, page, pageSize, pageCount, hasNextPage } shape', () => {
        const result = createPaginatedResult([{ id: 1 }, { id: 2 }], {
            total: 12,
            page: 2,
            pageSize: 2,
            pageCount: 6,
        });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toEqual({
            data: [{ id: 1 }, { id: 2 }],
            total: 12,
            page: 2,
            pageSize: 2,
            pageCount: 6,
            hasNextPage: true,
        });
    });

    it('computes hasNextPage from page vs pageCount when omitted', () => {
        const result = createPaginatedResult([], {
            total: 0,
            page: 1,
            pageSize: 10,
            pageCount: 1,
        });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.hasNextPage).toBe(false);
    });

    it('merges extras at the top level', () => {
        const result = createPaginatedResult(['a'], { total: 1, page: 1, pageSize: 1, pageCount: 1 }, { notebook: 'nb-1', warning: 'x' });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.notebook).toBe('nb-1');
        expect(parsed.warning).toBe('x');
    });
});

describe('mergePropertySchemas annotations', () => {
    it('does not expose action-specific fields at the top level', () => {
        const variants: ActionVariant<string>[] = [
            { action: 'append', schema: { type: 'object', properties: { parentID: { type: 'string', description: 'Parent ID' }, data: { type: 'string' } }, required: ['parentID', 'data'] } },
            { action: 'update', schema: { type: 'object', properties: { id: { type: 'string' }, data: { type: 'string' } }, required: ['id', 'data'] } },
        ];
        const result = buildAggregatedTool('block', 'Test', { enabled: true, actions: { append: true, update: true } }, variants);
        const schema = result[0].inputSchema;
        expect(schema.properties?.data).toBeDefined();
        expect(schema.properties?.data?.type).toBe('string');
        expect(schema.properties?.parentID).toBeDefined();
        expect(schema.properties?.parentID?.type).toBe('string');
        expect(schema['x-sisyphus-actionSchemas']?.[0].properties?.parentID).toBeDefined();
        expect(schema['x-sisyphus-actionSchemas']?.[1].properties?.data).toBeDefined();
    });

    it('lists compact required-field signatures in the tool description', () => {
        const variants: ActionVariant<string>[] = [
            { action: 'create', schema: { type: 'object', properties: { name: { type: 'string' }, icon: { type: 'string' } }, required: ['name'] } },
            { action: 'list', schema: { type: 'object', properties: {} } },
        ];
        const result = buildAggregatedTool('notebook', 'Manage notebooks.', { enabled: true, actions: { create: true, list: true } }, variants);
        expect(result[0].description).toContain('Actions (required fields): create(name) · list()');
        expect(result[0].description).not.toContain('icon');
        expect(result[0].inputSchema.properties?.icon).toBeDefined();
    });
});

describe('normalizeJsonSchema', () => {
    it('fills missing items for nested array schemas', () => {
        const schema = normalizeJsonSchema({
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            values: {
                                type: 'array',
                            },
                        },
                    },
                },
            },
        });

        expect(schema.properties?.items?.items?.properties?.values?.items).toEqual({ type: 'string' });
    });

    it('drops redundant string propertyNames from record schemas', () => {
        const schema = normalizeJsonSchema({
            type: 'object',
            properties: {
                types: {
                    type: 'object',
                    propertyNames: { type: 'string' },
                    additionalProperties: { type: 'boolean' },
                },
            },
        });

        expect(schema.properties?.types?.propertyNames).toBeUndefined();
        expect(schema.properties?.types?.additionalProperties).toEqual({ type: 'boolean' });
    });
});
