import { isDangerousAction, type ToolCategory, type ToolConfig } from './config';
import {
    FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME,
    FLASHCARD_REVIEW_SESSION_TOOL_NAME,
    MASCOT_SHOP_APP_ACTION_TOOL_NAME,
    MASCOT_SHOP_APP_TOOL_NAME,
    TIMELINE_APP_ACTION_TOOL_NAME,
    TIMELINE_APP_TOOL_NAME,
} from './mcp-app-names';
import { resolveCategory } from './tool-registry';
import { RESERVED_EXTENSION_ACTIONS } from '../tools/extension';
import type { ActionSafetyPolicy } from './write-safety-policy';

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
