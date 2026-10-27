import { isDangerousAction, type ToolCategory, type ToolConfig } from '../core/config';
import {
    FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME,
    FLASHCARD_REVIEW_SESSION_TOOL_NAME,
    MASCOT_SHOP_APP_ACTION_TOOL_NAME,
    MASCOT_SHOP_APP_TOOL_NAME,
    TIMELINE_APP_ACTION_TOOL_NAME,
    TIMELINE_APP_TOOL_NAME,
} from '../core/mcp-app-names';
import { resolveCategory } from './tool-registry';
import { RESERVED_EXTENSION_ACTIONS } from '../tools/extension';
import { getActionSafetyPolicy, type ActionSafetyPolicy } from '../core/write-safety-policy';
import { normalizeActionAlias } from '../core/action-aliases';
import { normalizeToolArguments } from '../core/argument-aliases';
import { createDisabledActionResult, createDisabledToolResult, createUnknownToolResult, type ToolResult } from '../tools/internal/shared';

/*
 * Transport-neutral tools/call gating shared by the Node server, the kernel
 * endpoint and the CLI. Each transport keeps its own response rendering; the
 * decisions themselves must not diverge.
 */

interface ActionSwitches {
    enabled: boolean;
    actions: Record<string, boolean>;
}

export interface ToolCallTarget {
    category: ToolCategory;
    /** Set when the name is an MCP App presentation action rather than an aggregated tool. */
    appAction?: 'timeline' | 'flashcard' | 'mascot';
    /** The switches that govern this call: the App config for App actions, else the category config. */
    actionConfig: ActionSwitches;
}

const MCP_APP_TOOL_NAMES = new Set([
    FLASHCARD_REVIEW_SESSION_TOOL_NAME,
    TIMELINE_APP_TOOL_NAME,
    MASCOT_SHOP_APP_TOOL_NAME,
    FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME,
    TIMELINE_APP_ACTION_TOOL_NAME,
    MASCOT_SHOP_APP_ACTION_TOOL_NAME,
]);

/** MCP App tools are only listed for App-capable clients; any other client gets unknown_tool. */
export function isHiddenMcpAppTool(name: string, appsEnabled: boolean): boolean {
    return !appsEnabled && MCP_APP_TOOL_NAMES.has(name);
}

export function resolveToolCallTarget(name: string, config: ToolConfig): ToolCallTarget | null {
    if (name === TIMELINE_APP_ACTION_TOOL_NAME) {
        return { category: 'timeline', appAction: 'timeline', actionConfig: config.mcpApps.timeline as ActionSwitches };
    }
    if (name === FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME) {
        return { category: 'flashcard', appAction: 'flashcard', actionConfig: config.mcpApps.flashcardReview as ActionSwitches };
    }
    if (name === MASCOT_SHOP_APP_ACTION_TOOL_NAME) {
        return { category: 'mascot', appAction: 'mascot', actionConfig: config.mcpApps.mascotShop as ActionSwitches };
    }
    const category = resolveCategory(name) as ToolCategory | undefined;
    return category ? { category, actionConfig: config[category] as unknown as ActionSwitches } : null;
}

/**
 * help is always callable. Dynamically discovered extension actions stay
 * governed by bridge discovery/trust; the Sisyphus-owned extension actions use
 * their persisted switches like every other category.
 */
export function isActionEnabled(target: ToolCallTarget, action: string): boolean {
    if (action === 'help') return true;
    const { actions } = target.actionConfig;
    if (!target.appAction && target.category === 'extension' && !Object.prototype.hasOwnProperty.call(actions, action)) {
        return true;
    }
    return actions[action] === true;
}

/** Dangerous static actions, plus any official extension tool not declared readOnlyHint=true. */
export function requiresDangerConfirmation(
    category: ToolCategory,
    action: string,
    extensionTool?: { readOnlyHint?: boolean },
): boolean {
    if (isDangerousAction(category, action)) return true;
    return category === 'extension' && !RESERVED_EXTENSION_ACTIONS.has(action) && extensionTool?.readOnlyHint !== true;
}

/** Mutations that must go through the write-safety coordinator (strict mode, or AV creation always). */
export function requiresCoordinatedWrite(
    policy: Pick<ActionSafetyPolicy, 'mode'>,
    config: Pick<ToolConfig, 'writeSafety'>,
    category: ToolCategory,
    action: string,
): boolean {
    return policy.mode === 'mutation' && (config.writeSafety.strictMode || (category === 'av' && action === 'create'));
}

export type McpAppSessionTool = 'flashcard' | 'timeline' | 'mascot';

export type ToolCallPlan =
    | { kind: 'rejected'; result: ToolResult }
    /** An App session tool (flashcard_review_session, timeline_app, mascot_shop_app). */
    | { kind: 'app'; app: McpAppSessionTool; config: ToolConfig['mcpApps'][keyof ToolConfig['mcpApps']] }
    | {
        kind: 'tool';
        target: ToolCallTarget;
        category: ToolCategory;
        /** Canonical action (aliases resolved) and the normalized arguments carrying it. */
        action: string;
        args: Record<string, unknown>;
        /** Dangerous action not sent as validateOnly: the transport must obtain confirmation. */
        needsConfirmation: boolean;
        policy: ActionSafetyPolicy;
        /** Must run through the single write-safety coordinator. */
        coordinated: boolean;
    };

export interface ToolCallPlanOptions {
    appsEnabled: boolean;
    /** Discovered official extension tools; only consulted for the extension category. */
    extensionTools?: ReadonlyArray<{ name: string; readOnlyHint?: boolean }>;
}

const APP_SESSION_TOOLS: Record<string, McpAppSessionTool> = {
    [FLASHCARD_REVIEW_SESSION_TOOL_NAME]: 'flashcard',
    [TIMELINE_APP_TOOL_NAME]: 'timeline',
    [MASCOT_SHOP_APP_TOOL_NAME]: 'mascot',
};

/**
 * The transport-neutral tools/call decision: every gate, alias normalization
 * and routing choice the Node server, kernel endpoint and CLI must agree on.
 * Transports only add their own confirmation UI, scheduling and rendering.
 */
export function planToolCall(
    name: string,
    input: Record<string, unknown> | undefined,
    config: ToolConfig,
    options: ToolCallPlanOptions,
): ToolCallPlan {
    if (isHiddenMcpAppTool(name, options.appsEnabled)) return { kind: 'rejected', result: createUnknownToolResult(name) };

    const app = APP_SESSION_TOOLS[name];
    if (app) {
        const appConfig = app === 'flashcard' ? config.mcpApps.flashcardReview
            : app === 'timeline' ? config.mcpApps.timeline : config.mcpApps.mascotShop;
        if (!appConfig.enabled) return { kind: 'rejected', result: createDisabledToolResult(name) };
        if (app === 'flashcard' && (!config.flashcard.enabled || config.flashcard.actions.list_cards !== true)) {
            return { kind: 'rejected', result: createDisabledActionResult('flashcard', 'list_cards', 'flashcard_review_session requires flashcard(action="list_cards") to be enabled for candidate selection.') };
        }
        return { kind: 'app', app, config: appConfig };
    }

    const target = resolveToolCallTarget(name, config);
    if (!target) return { kind: 'rejected', result: createUnknownToolResult(name) };
    if (!target.actionConfig.enabled) return { kind: 'rejected', result: createDisabledToolResult(name) };

    const { category } = target;
    const rawAction = typeof input?.action === 'string' ? input.action : '';
    // Extension actions are discovered tool names, never aliases of built-in actions.
    const args = normalizeToolArguments(category, {
        ...input,
        action: category === 'extension' ? input?.action : normalizeActionAlias(category, rawAction),
    });
    const action = String(args.action ?? '');
    if (!isActionEnabled(target, action)) return { kind: 'rejected', result: createDisabledActionResult(name, action) };

    const extensionTool = category === 'extension'
        ? options.extensionTools?.find((tool) => tool.name === action)
        : undefined;
    const policy = getActionSafetyPolicy(category, action, args);
    return {
        kind: 'tool',
        target,
        category,
        action,
        args,
        needsConfirmation: args.validateOnly !== true && requiresDangerConfirmation(category, action, extensionTool),
        policy,
        coordinated: requiresCoordinatedWrite(policy, config, category, action),
    };
}
