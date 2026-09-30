import { describe, expect, it } from 'vitest';
import { buildDefaultToolConfig, TOOL_CATEGORIES } from '@/core/config';
import { calculateMcpInitialTokenCost } from '@/core/analytics';
import { buildServerInstructions } from '@/core/server-instructions';
import { listAllTools, TOOL_REGISTRY } from '@/core/tool-registry';
import { readHelpResource } from '@/core/resources';
import { AV_VARIANTS } from '@/tools/av';
import { DOCUMENT_VARIANTS } from '@/tools/document';
import { validateRegisteredToolArguments } from '@/tools/internal/define-tool';
import { buildActionHelp } from '@/tools/internal/help-render';
import { createMockClient } from '../../helpers/mock-client';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';

describe('MCP progressive disclosure contract', () => {
    it.each([false, true])('bounds the real serialized mount payload (all static actions: %s)', (allActions) => {
        const config = buildDefaultToolConfig();
        if (allActions) for (const category of TOOL_CATEGORIES) {
            config[category].enabled = true;
            for (const action of Object.keys(config[category].actions)) config[category].actions[action] = true;
        }
        const tools = listAllTools(config);
        const instructions = buildServerInstructions(config).trim();
        const payload = JSON.stringify({ tools });
        const cost = calculateMcpInitialTokenCost(config);
        expect(tools).toHaveLength(14);
        expect(cost.mcpInitialChars).toBe(instructions.length + payload.length);
        expect(instructions.length).toBeLessThan(4_000);
        expect(cost.mcpInitialChars).toBeLessThan(allActions ? 66_000 : 64_000);
        expect(JSON.stringify(tools.find(tool => tool.name === 'av')).length).toBeLessThan(12_500);
        expect(payload).not.toContain('x-sisyphus-actionSchemas');
        expect(payload).not.toContain('Parameter contract per action');
        expect(payload).not.toContain('[Required by');
    });

    it('serves the complete collapsed filter schema through both help routes', async () => {
        const config = buildDefaultToolConfig();
        const schema = AV_VARIANTS.find(variant => variant.action === 'set_filters')!.schema;
        const mounted = listAllTools(config).find(tool => tool.name === 'av')!.inputSchema as any;
        expect(JSON.stringify(mounted.properties.filters).length).toBeLessThan(400);
        const client = createMockClient();
        const help = parseResult(await TOOL_REGISTRY.av.callTool(client,
            { action: 'help', topic: 'set_filters' }, config.av, createMockPermissionManager())) as any;
        expect(help.parameters).toEqual(schema);
        expect(help.parameters.properties.filters.items.properties.operator.enum).toContain('Contains');
        const resource = readHelpResource('siyuan://help/action/av/set_filters')!;
        const schemaText = resource.text.split('## Parameter schema\n\n')[1].split('```json\n')[1].split('\n```')[0];
        expect(JSON.parse(schemaText)).toEqual(schema);
        expect(client.request).not.toHaveBeenCalled();
    });

    it('still rejects malformed nested filters before issuing write credentials', async () => {
        const config = buildDefaultToolConfig();
        const args = { action: 'set_filters', avID: 'av-1', blockID: 'db-1', viewID: 'view-1',
            filters: [{ combination: 'and', filters: [{ operator: '=' }] }] };
        expect(() => validateRegisteredToolArguments('av', args)).toThrow();
        expect(() => validateRegisteredToolArguments('av', { ...args,
            filters: [{ combination: 'and', filters: [{ column: 'key-1', operator: '=' }] }],
        })).not.toThrow();
        const client = createMockClient();
        const result = await TOOL_REGISTRY.av.callTool(client, args, config.av, createMockPermissionManager());
        expect(result.isError).toBe(true);
        expect(client.request).not.toHaveBeenCalled();
    });

    it('keeps alternate required shapes and examples in document create help', () => {
        const help = buildActionHelp('document', 'create', DOCUMENT_VARIANTS);
        expect(help.requiredFields).toEqual([['notebook', 'path'], ['notebook', 'parentPath', 'title']]);
        expect(help.example).toEqual(expect.objectContaining({
            action: 'create', notebook: expect.any(String), path: expect.any(String),
        }));
        const resource = readHelpResource('siyuan://help/action/document/create')!.text;
        expect(resource).toContain('notebook + path');
        expect(resource).toContain('notebook + parentPath + title');
    });

    it('preserves the original root and reference targets in action help', () => {
        const schema = { type: 'object', properties: { action: { const: 'read' }, node: { $ref: '#/$defs/node' } },
            required: ['action', 'node'], $defs: { node: { type: 'object', properties: { parent: { $ref: '#' } } } } };
        expect(buildActionHelp('fs', 'read', [{ action: 'read', schema }]).parameters).toEqual(schema);
    });

    it('keeps disabled actions out of listing and inline help', async () => {
        const config = buildDefaultToolConfig();
        config.av.actions.set_filters = false;
        const mounted = listAllTools(config).find(tool => tool.name === 'av')!;
        expect((mounted.inputSchema as any).properties.action.enum).not.toContain('set_filters');
        expect(mounted.description).not.toContain('set_filters(');
        const result = await TOOL_REGISTRY.av.callTool(createMockClient(),
            { action: 'help', topic: 'set_filters' }, config.av, createMockPermissionManager());
        expect(result.isError).toBe(true);
    });
});
