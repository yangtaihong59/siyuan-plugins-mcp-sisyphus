import { describe, expect, it } from 'vitest';

import { ACTIONS_BY_CATEGORY, buildDefaultToolConfig, TOOL_CATEGORIES } from '@/core/config';
import { listAllTools } from '@/core/tool-registry';
import { buildServerInstructions } from '@/core/server-instructions';
import { validateRegisteredToolArguments } from '@/tools/internal/define-tool';
import { ACTION_SCHEMA_BRANCHES_KEY } from '@/tools/internal/shared';
import { getPossibleActionSafetyPolicies, PRECONDITION_FIELD } from '@/core/write-safety-policy';

describe('tool registry', () => {
    it('advertises strict credentials only for enabled mutations and explains external actions', () => {
        const config = buildDefaultToolConfig();
        config.writeSafety.strictMode = true;
        for (const category of TOOL_CATEGORIES) {
            config[category].enabled = true;
            for (const action of ACTIONS_BY_CATEGORY[category]) config[category].actions[action] = true;
        }
        for (const tool of listAllTools(config)) {
            const category = tool.name as typeof TOOL_CATEGORIES[number];
            const properties = tool.inputSchema.properties as Record<string, any>;
            const actions = properties.action.enum.filter((action: string) => action !== 'help');
            const mutations = actions.flatMap((action: string) => getPossibleActionSafetyPolicies(category, action))
                .filter((policy: any) => policy.mode === 'mutation');
            expect('requestId' in properties, category).toBe(mutations.length > 0);
            expect('validateOnly' in properties, category).toBe(mutations.length > 0);
            for (const [precondition, field] of Object.entries(PRECONDITION_FIELD)) {
                expect(field in properties, `${category}.${field}`).toBe(mutations.some((policy: any) => policy.precondition === precondition));
            }
            for (const branch of (tool.inputSchema[ACTION_SCHEMA_BRANCHES_KEY] ?? []) as any[]) {
                const action = branch.properties.action.const;
                if (action === 'help') continue;
                const needsPreflight = getPossibleActionSafetyPolicies(category, action).some(policy => policy.mode === 'mutation');
                expect('validateOnly' in branch.properties, `${category}.${action}`).toBe(needsPreflight);
            }
        }
        // The strict-write flow (including the external-action exception) is
        // stated once in server instructions rather than in every tool.
        const feedback = listAllTools(config).find(tool => tool.name === 'feedback')!;
        expect(feedback.description).not.toContain('validateOnly');
        const instructions = buildServerInstructions({ writeSafety: config.writeSafety });
        expect(instructions).toContain('validateOnly=true');
        expect(instructions).toContain('External submissions (feedback) skip preflight');
        expect(buildServerInstructions({ writeSafety: { strictMode: false } })).not.toContain('validateOnly');
        for (const action of ACTIONS_BY_CATEGORY.av) config.av.actions[action] = false;
        config.av.actions.get = true;
        expect(listAllTools(config).find(tool => tool.name === 'av')!.inputSchema.properties).not.toHaveProperty('requestId');
    });

    it.each([false, true])('publishes acyclic filter schemas with matching runtime depth limits (strict: %s)', (strict) => {
        const config = buildDefaultToolConfig();
        config.writeSafety.strictMode = strict;
        for (const category of TOOL_CATEGORIES) {
            config[category].enabled = true;
            for (const action of ACTIONS_BY_CATEGORY[category]) config[category].actions[action] = true;
        }
        for (const tool of listAllTools(config)) {
            const root = JSON.parse(JSON.stringify(tool.inputSchema));
            const visit = (node: any, ancestors = new Set<object>()) => {
                if (!node || typeof node !== 'object') return;
                expect(ancestors.has(node), `${tool.name}: recursive schema`).toBe(false);
                const next = new Set(ancestors).add(node);
                if (typeof node.$ref === 'string') {
                    const target = node.$ref === '#' ? root : node.$ref.slice(2).split('/').reduce(
                        (value: any, key: string) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root,
                    );
                    expect(target).toBeDefined();
                    visit(target, next);
                }
                Object.values(node).forEach(value => visit(value, next));
            };
            visit(root);
            if (tool.name === 'av') expect(JSON.stringify(root).length).toBeLessThan(100_000);
        }
        const leaf = { column: 'key-status', operator: '=', value: { type: 'text', text: { content: 'ready' } } };
        let filter: any = leaf;
        for (let depth = 0; depth < 4; depth++) filter = { combination: depth % 2 ? 'and' : 'or', filters: [filter] };
        const args = { action: 'set_filters', avID: 'av-1', blockID: 'block-1', viewID: 'view-1', filters: [filter] };
        expect(() => validateRegisteredToolArguments('av', args)).not.toThrow();
        delete leaf.column;
        expect(() => validateRegisteredToolArguments('av', args)).toThrow('A leaf filter requires column and operator.');
    });

    it.each([false, true])('keeps every local schema reference resolvable with strict writes %s', (strict) => {
        const config = buildDefaultToolConfig();
        config.writeSafety.strictMode = strict;
        for (const category of TOOL_CATEGORIES) {
            config[category].enabled = true;
            for (const action of ACTIONS_BY_CATEGORY[category]) config[category].actions[action] = true;
        }
        for (const tool of listAllTools(config)) {
            const root = JSON.parse(JSON.stringify(tool.inputSchema));
            const visit = (node: any) => {
                if (!node || typeof node !== 'object') return;
                if (typeof node.$ref === 'string') {
                    expect(node.$ref.startsWith('#'), tool.name).toBe(true);
                    const target = node.$ref === '#' ? root : node.$ref.slice(2).split('/').reduce(
                        (value: any, key: string) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root,
                    );
                    expect(target, `${tool.name}: ${node.$ref}`).toBeDefined();
                }
                Object.values(node).forEach(visit);
            };
            visit(root);
        }
    });

    it('keeps session-wide reminders out of tool descriptions', () => {
        const config = buildDefaultToolConfig();
        config.userRulesText = 'Always set icons.';
        config.agentSiyuanMemoryText = 'Workspace has Inbox and Projects notebooks.';

        const tools = listAllTools(config);

        expect(tools.length).toBeGreaterThan(0);
        for (const tool of tools) {
            expect(tool.description).not.toContain('/USER_RULES.md');
            expect(tool.description).not.toContain('/AGENTS.md');
            expect(tool.description).not.toContain('Workspace has Inbox and Projects notebooks.');
        }
    });
});
