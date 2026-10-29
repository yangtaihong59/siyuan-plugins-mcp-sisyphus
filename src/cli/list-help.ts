import {
    TOOL_CATEGORIES,
    getEnabledActions,
    getActionTier,
    isDangerousAction,
} from '../core/config';
import { normalizeActionAlias } from '../core/action-aliases';
import { TOOL_REGISTRY, prepareTool, resolveCategory } from '../mcp/tool-registry';
import { PRIMARY_CLI_COMMAND } from '../shared/constants';
import { getExposedExtensionTools } from '../tools/extension';


import type { ParsedArgs } from './args';
import {
    renderCliError,
    renderToolResult,
    writeBulletList,
    writeHeading,
    writeHint,
    writeSection,
} from './render';
import { loadCliRuntimeState } from './runtime';
import { createDisabledToolResult } from '../tools/internal/shared';
import { annotateHelpWithOneStep } from '../mcp/write-safety-if-match';

export async function runList(cli: ParsedArgs): Promise<number> {
    const out = process.stdout;
    const toolFilter = cli.tool ? resolveCategory(cli.tool) : null;
    const { toolConfig, officialMcpRuntime } = await loadCliRuntimeState(cli, { loadPermissions: false });
    await prepareTool('extension', toolConfig, officialMcpRuntime);

    if (!toolFilter) {
        if (cli.tool) {
            renderCliError(`Unknown tool "${cli.tool}". Showing all tools instead.`);
        }
        const enabledTools = TOOL_CATEGORIES.filter((cat) => TOOL_REGISTRY[cat].listTools(toolConfig[cat], officialMcpRuntime).length > 0);
        writeHeading('SiYuan tools', out);
        writeBulletList(enabledTools.map((cat) => {
            const actions = cat === 'extension'
                ? [
                    'list',
                    ...getExposedExtensionTools(toolConfig.extension, officialMcpRuntime)
                        .map((tool) => tool.name),
                ]
                : getEnabledActions(toolConfig[cat]);
            const basicCount = actions.filter((action) => getActionTier(cat, action) === 'basic').length;
            const advancedCount = actions.length - basicCount;
            return `${cat} — ${actions.length} actions (${basicCount} common, ${advancedCount} advanced)`;
        }), out);
        writeSection('Next Step', out);
        writeHint('Tip', `Run \`${PRIMARY_CLI_COMMAND} list <tool>\` to see a tool’s actions.`, out);
        return 0;
    }

    if (TOOL_REGISTRY[toolFilter].listTools(toolConfig[toolFilter], officialMcpRuntime).length === 0) {
        renderCliError(`Tool "${toolFilter}" is disabled.`);
        return 1;
    }

    writeHeading(`${toolFilter} actions`, out);
    const actions = toolFilter === 'extension'
        ? [
            'list',
            ...getExposedExtensionTools(toolConfig.extension, officialMcpRuntime)
                .map((tool) => tool.name),
        ]
        : getEnabledActions(toolConfig[toolFilter]);
    writeBulletList(actions.map((action) => {
        const extensionTool = toolFilter === 'extension'
            ? officialMcpRuntime.bridge.getTools().find((tool) => tool.name === action)
            : undefined;
        const tier = getActionTier(toolFilter, action) === 'basic' ? 'common' : 'advanced';
        const safety = extensionTool
            ? extensionTool.readOnlyHint ? ' · declared read-only' : ' · confirmation required'
            : isDangerousAction(toolFilter, action) ? ' · confirmation required' : '';
        const source = extensionTool ? ` · ${extensionTool.source}` : '';
        return `${action} — ${tier}${source}${safety}`;
    }), out);
    writeSection('Next Step', out);
    writeHint('Tip', `Run \`${PRIMARY_CLI_COMMAND} help ${toolFilter} <action>\` for fields and examples.`, out);
    return 0;
}

/**
 * Forward `siyuan-sisyphus help <tool> [action]` to the existing `action="help"`
 * mechanism inside each tool — this gives the same help content AI clients see.
 */
export async function runHelp(cli: ParsedArgs): Promise<number> {
    const tool = cli.tool;
    if (!tool) {
        renderCliError(`Missing tool. Usage: ${PRIMARY_CLI_COMMAND} help <tool> [action]`);
        return 2;
    }

    const category = resolveCategory(tool);
    if (!category) {
        renderCliError(`Unknown tool "${tool}". Available: ${TOOL_CATEGORIES.join(', ')}.`);
        return 2;
    }

    try {
        const { client, toolConfig, permMgr, officialMcpRuntime } = await loadCliRuntimeState(cli, { loadPermissions: false });
        if (!toolConfig[category].enabled) {
            return renderToolResult(createDisabledToolResult(tool), { json: cli.json, debug: cli.debug });
        }

        const module = TOOL_REGISTRY[category];
        await prepareTool(category, toolConfig, officialMcpRuntime);
        const payload: Record<string, unknown> = { action: 'help' };
        if (cli.action) payload.topic = normalizeActionAlias(category, cli.action);

        const result = await module.callTool(client, payload, toolConfig[category], permMgr, officialMcpRuntime);
        // Same one-step note the coordinator adds to action help, only when enabled.
        const annotated = toolConfig.writeSafety.oneStep === 'low_risk' && toolConfig.writeSafety.strictMode
            ? annotateHelpWithOneStep(category, payload, result)
            : result;
        return renderToolResult(annotated, { json: cli.json, debug: cli.debug });
    } catch (error) {
        renderCliError(error, { debug: cli.debug });
        return 1;
    }
}
