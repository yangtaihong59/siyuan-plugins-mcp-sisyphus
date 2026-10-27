import { describe, expect, it } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { TIMELINE_APP_ACTION_TOOL_NAME } from '@/core/mcp-apps';
import {
    isActionEnabled,
    planToolCall,
    requiresCoordinatedWrite,
    requiresDangerConfirmation,
    resolveToolCallTarget,
} from '@/core/tool-call-gate';

describe('tool call gate', () => {
    it('resolves aggregated tools, MCP App actions, and unknown names', () => {
        const config = buildDefaultToolConfig();

        expect(resolveToolCallTarget('document', config)).toMatchObject({ category: 'document', actionConfig: config.document });
        expect(resolveToolCallTarget(TIMELINE_APP_ACTION_TOOL_NAME, config)).toMatchObject({
            category: 'timeline',
            appAction: 'timeline',
            actionConfig: config.mcpApps.timeline,
        });
        expect(resolveToolCallTarget('no_such_tool', config)).toBeNull();
    });

    it('applies action switches, always allows help, and leaves discovered extension actions to the bridge', () => {
        const config = buildDefaultToolConfig();
        config.block.actions.update = false;
        const block = resolveToolCallTarget('block', config)!;
        const extension = resolveToolCallTarget('extension', config)!;

        expect(isActionEnabled(block, 'update')).toBe(false);
        expect(isActionEnabled(block, 'help')).toBe(true);
        expect(isActionEnabled(extension, 'some_official_tool')).toBe(true);
        config.extension.actions.list = false;
        expect(isActionEnabled(extension, 'list')).toBe(false);
    });

    it('requires confirmation for dangerous actions and non-read-only extension tools', () => {
        expect(requiresDangerConfirmation('block', 'delete')).toBe(true);
        expect(requiresDangerConfirmation('block', 'get_kramdown')).toBe(false);
        expect(requiresDangerConfirmation('extension', 'list')).toBe(false);
        expect(requiresDangerConfirmation('extension', 'official_read', { readOnlyHint: true })).toBe(false);
        expect(requiresDangerConfirmation('extension', 'official_write', { readOnlyHint: false })).toBe(true);
        // Not (yet) discovered: fail safe and ask, matching the Node server.
        expect(requiresDangerConfirmation('extension', 'official_unknown')).toBe(true);
    });

    it('routes strict-mode mutations and every AV creation through the coordinator', () => {
        const strict = { writeSafety: { ...buildDefaultToolConfig().writeSafety, strictMode: true } };
        const relaxed = { writeSafety: { ...strict.writeSafety, strictMode: false } };

        expect(requiresCoordinatedWrite({ mode: 'mutation' }, strict, 'block', 'update')).toBe(true);
        expect(requiresCoordinatedWrite({ mode: 'mutation' }, relaxed, 'block', 'update')).toBe(false);
        expect(requiresCoordinatedWrite({ mode: 'mutation' }, relaxed, 'av', 'create')).toBe(true);
        expect(requiresCoordinatedWrite({ mode: 'read' }, strict, 'block', 'get_kramdown')).toBe(false);
    });

    describe('planToolCall', () => {
        it('resolves action aliases before gating, so every transport accepts them', () => {
            const config = buildDefaultToolConfig();
            config.fs.actions.ls = true;
            const plan = planToolCall('fs', { action: 'list', path: '/' }, config, { appsEnabled: false });
            expect(plan).toMatchObject({ kind: 'tool', category: 'fs', action: 'ls', args: { action: 'ls', path: '/' } });
        });

        it('rejects with the shared gate shapes', () => {
            const config = buildDefaultToolConfig();
            config.block.actions.update = false;
            config.tag.enabled = false;
            const shape = (plan: ReturnType<typeof planToolCall>) => plan.kind === 'rejected' ? JSON.parse((plan.result.content[0] as { text: string }).text).error.type : plan.kind;
            expect(shape(planToolCall('nope', { action: 'x' }, config, { appsEnabled: true }))).toBe('unknown_tool');
            expect(shape(planToolCall('tag', { action: 'list' }, config, { appsEnabled: true }))).toBe('tool_disabled');
            expect(shape(planToolCall('block', { action: 'update' }, config, { appsEnabled: true }))).toBe('action_disabled');
            expect(shape(planToolCall(TIMELINE_APP_ACTION_TOOL_NAME, { action: 'create_node' }, config, { appsEnabled: false }))).toBe('unknown_tool');
        });

        it('carries confirmation, safety policy and coordinator routing for the canonical action', () => {
            const config = buildDefaultToolConfig();
            config.writeSafety.strictMode = true;
            config.block.actions.delete = true;
            const plan = planToolCall('block', { action: 'del', id: 'x' }, config, { appsEnabled: false });
            expect(plan).toMatchObject({ kind: 'tool', action: 'delete', needsConfirmation: true, coordinated: true, policy: { mode: 'mutation' } });
            const preflight = planToolCall('block', { action: 'delete', id: 'x', validateOnly: true }, config, { appsEnabled: false });
            expect(preflight).toMatchObject({ kind: 'tool', needsConfirmation: false });
        });

        it('routes App session tools only for App-capable clients', () => {
            const config = buildDefaultToolConfig();
            config.mcpApps.timeline.enabled = true;
            expect(planToolCall('timeline_app', {}, config, { appsEnabled: true })).toMatchObject({ kind: 'app', app: 'timeline' });
            expect(planToolCall('timeline_app', {}, config, { appsEnabled: false })).toMatchObject({ kind: 'rejected' });
        });
    });
});
