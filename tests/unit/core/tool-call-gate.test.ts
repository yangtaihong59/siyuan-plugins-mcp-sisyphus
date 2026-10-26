import { describe, expect, it } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { TIMELINE_APP_ACTION_TOOL_NAME } from '@/core/mcp-apps';
import {
    isActionEnabled,
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
});
