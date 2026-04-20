import { SiYuanClient } from '../api/client';
import {
    ACTIONS_BY_CATEGORY,
    TOOL_CATEGORIES,
    buildDefaultToolConfig,
    type ToolCategory,
    type ToolConfig,
} from '../mcp/config';
import { PermissionManager } from '../mcp/permissions';
import { TOOL_REGISTRY, resolveCategory } from '../mcp/tool-registry';
import { runToolCall } from '../mcp/tool-lifecycle';
import { ensureRequiredPluginInstalled } from './plugin-check';

import type { ParsedArgs } from './args';
import { PRIMARY_CLI_COMMAND } from './args';
import { applyConfigToEnv, loadFileConfig, resolveConfig } from './config';
import { mapFlagsToArgs } from './flag-mapper';
import { renderCliError, renderToolResult } from './render';

export async function runDispatch(cli: ParsedArgs): Promise<number> {
    const { tool, action, rest } = cli;
    if (!tool || !action) {
        throw new Error('runDispatch requires both tool and action.');
    }

    const category = resolveCategory(tool);
    if (!category) {
        throw formatUnknownToolError(tool);
    }

    const normalizedAction = action.replace(/-/g, '_');
    const knownActions = ACTIONS_BY_CATEGORY[category];
    if (!knownActions.includes(normalizedAction as never) && normalizedAction !== 'help') {
        throw formatUnknownActionError(category, normalizedAction);
    }

    const fileConfig = loadFileConfig(cli.configPath);
    const resolved = resolveConfig(fileConfig, cli.url, cli.token);
    applyConfigToEnv(resolved);

    const client = new SiYuanClient({ baseUrl: resolved.apiUrl });
    if (resolved.token) client.setToken(resolved.token);

    const previousTransport = process.env.SIYUAN_MCP_TRANSPORT;
    process.env.SIYUAN_MCP_TRANSPORT = 'cli';

    try {
        await ensureRequiredPluginInstalled(client);

        const permMgr = new PermissionManager(client);
        await permMgr.load();

        const toolConfig = buildPermissiveToolConfig();
        const module = TOOL_REGISTRY[category];
        const inputSchema = resolveInputSchema(category, toolConfig);

        const { args: mappedArgs, warnings } = mapFlagsToArgs(rest, inputSchema);
        if (warnings.length > 0 && cli.debug) {
            for (const w of warnings) process.stderr.write(`[warn] ${w}\n`);
        }

        const payload = { action: normalizedAction, ...mappedArgs } as Record<string, unknown>;
        const result = await runToolCall(
            { client, category, name: tool, action: normalizedAction, args: payload },
            () => module.callTool(client, payload, toolConfig[category], permMgr),
        );
        return renderToolResult(result, { json: cli.json, debug: cli.debug });
    } catch (error) {
        renderCliError(error, { debug: cli.debug });
        return 1;
    } finally {
        if (previousTransport === undefined) {
            delete process.env.SIYUAN_MCP_TRANSPORT;
        } else {
            process.env.SIYUAN_MCP_TRANSPORT = previousTransport;
        }
    }
}

function resolveInputSchema(category: ToolCategory, config: ToolConfig): Record<string, unknown> {
    const descriptors = TOOL_REGISTRY[category].listTools(config[category]);
    const descriptor = descriptors[0];
    if (!descriptor) {
        throw new Error(`Tool "${category}" has no aggregated descriptor — this is a bug.`);
    }
    return descriptor.inputSchema;
}

/**
 * CLI users explicitly type each command, so all actions are opted-in by
 * default — including the ones that the plugin UI gates off for safety.
 */
function buildPermissiveToolConfig(): ToolConfig {
    const base = buildDefaultToolConfig();
    for (const cat of TOOL_CATEGORIES) {
        const actions = ACTIONS_BY_CATEGORY[cat];
        const record = base[cat].actions as Record<string, boolean>;
        for (const action of actions) record[action] = true;
    }
    return base;
}

function formatUnknownToolError(tool: string): Error {
    const categories = TOOL_CATEGORIES.join(', ');
    return new Error(`Unknown tool "${tool}". Available tools: ${categories}. Try "${PRIMARY_CLI_COMMAND} list".`);
}

function formatUnknownActionError(category: ToolCategory, action: string): Error {
    const actions = ACTIONS_BY_CATEGORY[category].join(', ');
    return new Error(
        `Unknown action "${action}" for tool "${category}". ` +
        `Available actions: ${actions}. Try "${PRIMARY_CLI_COMMAND} help ${category}".`,
    );
}
