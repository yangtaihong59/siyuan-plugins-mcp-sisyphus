import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ACTIONS_BY_CATEGORY, TOOL_CATEGORIES, type ToolCategory, type ToolConfig } from '@/core/config';
import { TOOL_ACTION_EXAMPLES, type HelpExample } from '@/core/help';
import { normalizeToolArguments } from '@/core/argument-aliases';
import { stripSafetyFields } from '@/core/write-safety-ledger';
import { TOOL_REGISTRY } from '@/core/tool-registry';
import { DocumentEnsureLinkTargetsSchema } from '@/core/types';
import { readHelpResource } from '@/core/resources';
import * as toolModules from '@/tools';
import { buildActionHelp } from '@/tools/internal/help-render';
import type { ActionVariant } from '@/tools/internal/shared';
import { createMockClient } from '../../helpers/mock-client';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';

function createAllEnabledConfig(): ToolConfig {
    return {
        avActionsVersion: 2,
        fs: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.fs.map((action) => [action, true])) as ToolConfig['fs']['actions'],
        },
        notebook: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.notebook.map((action) => [action, true])) as ToolConfig['notebook']['actions'],
        },
        document: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.document.map((action) => [action, true])) as ToolConfig['document']['actions'],
        },
        block: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.block.map((action) => [action, true])) as ToolConfig['block']['actions'],
        },
        av: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.av.map((action) => [action, true])) as ToolConfig['av']['actions'],
        },
        file: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.file.map((action) => [action, true])) as ToolConfig['file']['actions'],
            uploadLargeFileThresholdMB: 10,
        },
        search: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.search.map((action) => [action, true])) as ToolConfig['search']['actions'],
        },
        tag: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.tag.map((action) => [action, true])) as ToolConfig['tag']['actions'],
        },
        timeline: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.timeline.map((action) => [action, true])) as ToolConfig['timeline']['actions'],
        },
        system: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.system.map((action) => [action, true])) as ToolConfig['system']['actions'],
        },
        flashcard: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.flashcard.map((action) => [action, true])) as ToolConfig['flashcard']['actions'],
        },
        extension: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.extension.map((action) => [action, true])) as ToolConfig['extension']['actions'],
            includeNativeTools: false,
            blockedTools: [],
        },
        mascot: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.mascot.map((action) => [action, true])) as ToolConfig['mascot']['actions'],
        },
        feedback: {
            enabled: true,
            actions: Object.fromEntries(ACTIONS_BY_CATEGORY.feedback.map((action) => [action, true])) as ToolConfig['feedback']['actions'],
        },
        mcpApps: {
            timeline: { enabled: true, actions: Object.fromEntries(ACTIONS_BY_CATEGORY.timeline.map((action) => [action, true])) as ToolConfig['mcpApps']['timeline']['actions'] },
            flashcardReview: { enabled: true, actions: { review_card: true } },
            mascotShop: { enabled: true, actions: { get_balance: true, shop: true, buy: true } },
        },
        userRulesText: '',
        agentSiyuanMemoryText: '',
        agentSiyuanMemoryUpdatedAt: '',
        writeSafety: { strictMode: true },
        debug: {
            includeUiRefreshMetadata: false,
            slimResponses: true,
        },
    };
}

async function collectHelpOutputs() {
    const config = createAllEnabledConfig();
    const client = createMockClient();
    const permMgr = createMockPermissionManager();
    const outputs: Record<string, unknown> = {};

    for (const category of TOOL_CATEGORIES) {
        const module = TOOL_REGISTRY[category];
        const toolDescriptor = module.listTools(config[category])[0];
        const actionOutputs: Record<string, unknown> = {};

        for (const action of ACTIONS_BY_CATEGORY[category]) {
            actionOutputs[action] = parseResult(await module.callTool(client, { action: 'help', topic: action }, config[category], permMgr));
        }

        outputs[category] = {
            description: toolDescriptor.description,
            overview: parseResult(await module.callTool(client, { action: 'help' }, config[category], permMgr)),
            actions: actionOutputs,
        };
    }

    return outputs;
}

describe('tool description and help outputs', () => {
    it.each(Object.entries(TOOL_ACTION_EXAMPLES).flatMap(([category, actions]) =>
        Object.entries(actions).flatMap(([action, examples]) => examples?.length
            ? [[category, action, examples[0]] as [ToolCategory, string, HelpExample]] : []),
    ))('%s.%s uses a curated default accepted by its real action contract', (category, action, curated) => {
        const variants = toolModules[`${category.toUpperCase()}_VARIANTS` as keyof typeof toolModules] as ActionVariant<string>[];
        const variant = variants.find((item) => item.action === action);
        expect(variant).toBeDefined();
        const example = buildActionHelp(category, action, variants).example as Record<string, unknown>;
        expect(example).toEqual(curated.mcp);
        const normalized = stripSafetyFields(normalizeToolArguments(category, example));
        // Zod-backed actions retain their actual validator, including refinements.
        // Handwritten variants (extension) are checked against their declared schema.
        if (variant!.validate) expect(() => variant!.validate!(normalized)).not.toThrow();
        else expect(() => z.fromJSONSchema(variant!.schema).parse(normalized)).not.toThrow();
    });

    it('publishes separate leaf and nested group filter examples for AV view updates', async () => {
        const config = createAllEnabledConfig();
        const output = parseResult(await TOOL_REGISTRY.av.callTool(
            createMockClient(), { action: 'help', topic: 'update_view' },
            config.av, createMockPermissionManager(),
        ));
        expect(output.examples).toHaveLength(2);
        expect(output.example).toEqual(output.examples[0].mcp);
        expect(output.example.filters[0]).toEqual({
            column: '20240318112233-status1', operator: '=',
            value: { type: 'select', mSelect: [{ content: '待办' }] },
        });
        const validator = toolModules.AV_VARIANTS.find((variant) => variant.action === 'update_view')!.validate!;
        for (const { mcp } of output.examples) {
            expect(mcp).toMatchObject({
                avID: '20240318112233-avdb001', blockID: '20240318112233-block01',
                viewID: '20240318112233-view001', validateOnly: true,
            });
            expect(() => validator(stripSafetyFields(mcp))).not.toThrow();
        }
        const group = output.examples[1].mcp.filters[0];
        expect(Object.keys(group).sort()).toEqual(['combination', 'filters']);
        expect(Object.keys(group.filters[0]).sort()).toEqual(['combination', 'filters']);
        expect(output.hint).toContain('must not mix');
        const resource = readHelpResource('siyuan://help/action/av/update_view');
        expect(resource!.text).toContain('Preflight a select leaf filter');
        expect(resource!.text).toContain('Preflight nested filter groups');
    });

    it('publishes valid link-target examples for each mode through shared tool help and resources', async () => {
        const config = createAllEnabledConfig();
        const output = parseResult(await TOOL_REGISTRY.document.callTool(
            createMockClient(),
            { action: 'help', topic: 'ensure_link_targets' },
            config.document,
            createMockPermissionManager(),
        ));

        expect(DocumentEnsureLinkTargetsSchema.safeParse(output.example).success).toBe(true);
        expect(output.example).toEqual(output.examples[0].mcp);
        expect(output.examples.map((example: any) => example.mcp.mode)).toEqual(['resolve', 'reuse', 'create']);
        for (const { mcp } of output.examples) {
            expect(DocumentEnsureLinkTargetsSchema.safeParse(mcp).success).toBe(true);
            expect(mcp.targets[0]).toEqual(mcp.mode === 'create'
                ? { key: 'source-index', title: 'New Target' }
                : { key: 'source-index', id: '20240318112233-def4567' });
        }

        const resource = readHelpResource('siyuan://help/action/document/ensure_link_targets');
        const examples = [...resource!.text.split('## Minimal examples')[1].matchAll(/```json\n([\s\S]*?)\n```/g)]
            .map((match) => JSON.parse(match[1]));
        expect(examples).toEqual(output.examples.map((example: any) => example.mcp));
    });

    it('matches the locked snapshot for all aggregated tools', async () => {
        await expect(collectHelpOutputs()).resolves.toMatchSnapshot();
    });

    it('documents child document creation path semantics in document create help', async () => {
        const config = createAllEnabledConfig();
        const client = createMockClient();
        const permMgr = createMockPermissionManager();
        const output = parseResult(await TOOL_REGISTRY.document.callTool(
            client,
            { action: 'help', topic: 'create' },
            config.document,
            permMgr,
        )) as Record<string, unknown>;

        expect(JSON.stringify(output)).toContain('/Folder/Parent/New Child');
        expect(JSON.stringify(output)).toContain('/Folder/Parent');
        expect(JSON.stringify(output)).toContain('/20240318112233-abc123.sy');
        expect(JSON.stringify(output)).toContain('notebook-local hpath');
        expect(JSON.stringify(output)).toContain('not /Notebook/...');
        expect(JSON.stringify(output)).toContain('not .sy');
        expect(JSON.stringify(output)).toContain('duplicate-name error');
    });
});
