import {
    ACTIONS_BY_CATEGORY,
    TOOL_CATEGORIES,
    type ToolCategory,
    type ToolConfig,
} from '../core/config';
import { normalizeActionAlias } from '../core/action-aliases';
import { listConfiguredToolsForCategory, prepareTool, TOOL_REGISTRY, resolveCategory } from '../core/tool-registry';
import { runToolCall } from '../core/tool-lifecycle';
import { PRIMARY_CLI_COMMAND } from '../shared/constants';
import { getExposedExtensionTools } from '../tools/extension';


import type { ParsedArgs } from './args';
import { mapFlagsToArgs } from './flag-mapper';
import { extractPaginationInfo, renderCliError, renderToolResult } from './render';
import { loadCliRuntimeState } from './runtime';
import { callCliWriteCoordinator } from './write-coordinator';
import { getActionSafetyPolicy } from '../core/write-safety-policy';
import { WriteSafetyCoordinator } from '../core/write-safety-coordinator';

import type { ToolResult } from '../tools/internal/shared';

export async function runDispatch(cli: ParsedArgs): Promise<number> {
    const { tool, action, rest } = cli;
    if (!tool || !action) {
        throw new Error('runDispatch requires both tool and action.');
    }

    const category = resolveCategory(tool);
    if (!category) {
        throw formatUnknownToolError(tool);
    }

    const normalizedAction = normalizeActionAlias(category, action);
    const knownActions = ACTIONS_BY_CATEGORY[category];
    if (category !== 'extension'
        && !knownActions.includes(normalizedAction as never)
        && normalizedAction !== 'help') {
        throw formatUnknownActionError(category, normalizedAction);
    }

    const previousTransport = process.env.SIYUAN_MCP_TRANSPORT;
    process.env.SIYUAN_MCP_TRANSPORT = 'cli';

    try {
        const { client, toolConfig, permMgr, officialMcpRuntime, writeCoordinator } = await loadCliRuntimeState(cli);
        if (!toolConfig[category].enabled) {
            return renderToolResult({
                content: [{ type: 'text', text: `Tool "${tool}" is disabled.` }],
                isError: true,
            }, { json: cli.json, debug: cli.debug });
        }

        const module = TOOL_REGISTRY[category];
        if (category === 'extension') {
            // validate_package deliberately accepts only caller-provided in-memory content. It must
            // remain useful when the official bridge is unavailable, otherwise a static package
            // check would unnecessarily depend on a live SiYuan instance and blur those states.
            if (normalizedAction !== 'validate_package') {
                await prepareTool(category, toolConfig, officialMcpRuntime);
                const discoveredActions = getExposedExtensionTools(toolConfig.extension, officialMcpRuntime)
                    .map((tool) => tool.name);
                if (normalizedAction !== 'help'
                    && !knownActions.includes(normalizedAction as never)
                    && !discoveredActions.includes(normalizedAction)) {
                    throw formatUnknownActionError(category, normalizedAction, discoveredActions);
                }
            }
        }
        const inputSchema = resolveInputSchema(category, toolConfig, officialMcpRuntime);

        const restWithPositional = applyPositionalActionArgs(category, normalizedAction, rest);
        const { args: mappedArgs, warnings } = mapFlagsToArgs(restWithPositional, inputSchema, {
            category,
            action: normalizedAction,
        });
        if (warnings.length > 0 && cli.debug) {
            for (const w of warnings) process.stderr.write(`[warn] ${w}\n`);
        }

        const basePayload = { action: normalizedAction, ...mappedArgs } as Record<string, unknown>;
        const requestText = [PRIMARY_CLI_COMMAND, tool, action, ...rest].join(' ').trim();
        const runPage = async (page?: number): Promise<ToolResult> => {
            const payload = page === undefined ? basePayload : { ...basePayload, page };
            const policy = getActionSafetyPolicy(category, normalizedAction, payload);
            const executeDirect = (safeArgs = payload) => module.callTool(
                client,
                safeArgs,
                toolConfig[category],
                permMgr,
                officialMcpRuntime,
            );
            const invoke = toolConfig.writeSafety.strictMode && policy.mode === 'mutation'
                ? () => callCliWriteCoordinator(writeCoordinator, tool, payload)
                : toolConfig.writeSafety.strictMode && policy.mode === 'external'
                    ? () => new WriteSafetyCoordinator(client).run({
                        client,
                        permMgr,
                        category,
                        action: normalizedAction,
                        args: payload,
                        strictMode: true,
                        execute: executeDirect,
                    })
                    : () => executeDirect();
            return runToolCall(
                {
                    client,
                    category,
                    name: tool,
                    action: normalizedAction,
                    args: payload,
                    requestText: category === 'extension'
                        ? [PRIMARY_CLI_COMMAND, tool, normalizedAction].join(' ')
                        : requestText,
                    slimResponses: toolConfig.debug.slimResponses && !cli.debug,
                },
                invoke,
            );
        };

        const result = await runPage();
        const code = renderToolResult(result, { json: cli.json, debug: cli.debug });
        if (code !== 0 || cli.json) return code;

        await runInteractivePaging(result, runPage, { json: cli.json, debug: cli.debug });
        return code;
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

function applyPositionalActionArgs(category: ToolCategory, action: string, rest: string[]): string[] {
    const positionals = rest.filter((token) => !token.startsWith('-'));
    if (positionals.length === 0) return rest;

    if (category === 'fs') {
        if (['ls', 'tree', 'read', 'rm'].includes(action)) {
            return prependMissingFlag(rest, 'path', positionals[0]);
        }
        if (action === 'search') {
            return prependMissingFlag(prependMissingFlag(rest, 'path', positionals[0]), 'query', positionals[1]);
        }
        if (action === 'mv') {
            return prependMissingFlag(prependMissingFlag(rest, 'from', positionals[0]), 'to', positionals[1]);
        }
    }

    return rest;
}

function prependMissingFlag(rest: string[], flag: string, value: string | undefined): string[] {
    if (!value || hasFlag(rest, flag)) return rest;
    return [`--${flag}`, value, ...removeFirstPositional(rest, value)];
}

function hasFlag(rest: string[], flag: string): boolean {
    const variants = new Set([flag, flag.replace(/_/g, '-'), flag.replace(/-/g, '_')]);
    return rest.some((token) => {
        if (!token.startsWith('-')) return false;
        const name = token.replace(/^-+/, '').split('=')[0];
        return variants.has(name);
    });
}

function removeFirstPositional(rest: string[], value: string): string[] {
    let removed = false;
    return rest.filter((token) => {
        if (!removed && token === value && !token.startsWith('-')) {
            removed = true;
            return false;
        }
        return true;
    });
}

async function runInteractivePaging(
    initialResult: ToolResult,
    runPage: (page?: number) => Promise<ToolResult>,
    renderOptions: { json: boolean; debug: boolean },
): Promise<void> {
    if (!canUseInteractivePaging()) return;

    let pagination = extractPaginationInfo(initialResult);
    if (!pagination || pagination.pageCount <= 1) return;

    const input = process.stdin;
    const output = process.stdout;
    const wasRaw = Boolean(input.isRaw);

    try {
        input.setRawMode?.(true);
        input.resume();

        while (pagination.pageCount > 1) {
            output.write('\nPaging: Enter/n next, p previous, q quit › ');
            const key = await readKey();
            output.write('\n');

            if (key === '\u0003' || key === '\u001b' || key.toLowerCase() === 'q') {
                return;
            }

            const nextPage = resolveRequestedPage(key, pagination.page, pagination.pageCount);
            if (nextPage === null) {
                continue;
            }

            const result = await runPage(nextPage);
            renderToolResult(result, renderOptions);
            const nextPagination = extractPaginationInfo(result);
            if (!nextPagination) return;
            pagination = nextPagination;
        }
    } finally {
        input.setRawMode?.(wasRaw);
        input.pause();
    }
}

function canUseInteractivePaging(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function resolveRequestedPage(key: string, page: number, pageCount: number): number | null {
    const normalized = key.toLowerCase();
    if ((key === '\r' || key === '\n' || normalized === 'n') && page < pageCount) {
        return page + 1;
    }
    if (normalized === 'p' && page > 1) {
        return page - 1;
    }
    return null;
}

function readKey(): Promise<string> {
    return new Promise((resolve) => {
        process.stdin.once('data', (chunk: Buffer | string) => {
            resolve(String(chunk));
        });
    });
}

function resolveInputSchema(
    category: ToolCategory,
    config: ToolConfig,
    officialMcpRuntime?: import('../core/official-mcp-bridge').OfficialMcpRuntime,
): Record<string, unknown> {
    const descriptors = listConfiguredToolsForCategory(category, config, officialMcpRuntime);
    const descriptor = descriptors[0];
    if (!descriptor) {
        throw new Error(`Tool "${category}" has no aggregated descriptor — this is a bug.`);
    }
    return descriptor.inputSchema;
}

function formatUnknownToolError(tool: string): Error {
    const categories = TOOL_CATEGORIES.join(', ');
    return new Error(`Unknown tool "${tool}". Available tools: ${categories}. Try "${PRIMARY_CLI_COMMAND} list".`);
}

function formatUnknownActionError(category: ToolCategory, action: string, dynamicActions: string[] = []): Error {
    const actions = [...ACTIONS_BY_CATEGORY[category], ...dynamicActions].join(', ');
    return new Error(
        `Unknown action "${action}" for tool "${category}". ` +
        `Available actions: ${actions}. Try "${PRIMARY_CLI_COMMAND} help ${category}".`,
    );
}
