import type { z } from 'zod';

import { SiYuanClient } from '../../api/client';
import { normalizeActionAlias } from '../../core/action-aliases';
import { normalizeToolArguments } from '../../core/argument-aliases';
import type { CategoryToolConfig, ToolCategory } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import {
    buildAggregatedTool,
    createDisabledActionResult,
    createErrorResult,
    createUnknownActionResult,
    tryHandleHelpAction,
    type ActionVariant,
    type AggregatedToolOptions,
    type ToolResult,
} from './shared';

/**
 * Arguments passed to an individual action handler after the factory has
 * resolved the outer scaffold (help routing, enabled check, action parsing).
 *
 * Handlers are responsible for parsing `rawArgs` with their own zod schema —
 * that way each action keeps its narrow typed args without the factory trying
 * to be a generic schema dispatcher.
 */
export interface ToolHandlerContext {
    client: SiYuanClient;
    rawArgs: Record<string, unknown>;
    permMgr: PermissionManager;
}

export type ToolActionHandler = (ctx: ToolHandlerContext) => Promise<ToolResult>;

export interface DefineToolOptions<Action extends string> {
    /** The tool category name (also used as the aggregated tool name). */
    name: ToolCategory;
    /** Top-of-description blurb (emoji + one sentence). */
    description: string;
    /** Action schema variants, one per supported action. */
    variants: ActionVariant<Action>[];
    /** Handlers keyed by action. Must cover every action in `variants`. */
    handlers: Record<Action, ToolActionHandler>;
    /**
     * Zod schema that narrows `rawArgs.action` to one of the supported
     * Action literals. Typically a `z.enum([...])` re-exported from `types.ts`.
     */
    actionSchema: z.ZodType<Action>;
    /** Forwarded to `buildAggregatedTool`. */
    aggregateOptions?: AggregatedToolOptions<Action>;
}

export interface DefinedTool<Action extends string> {
    listTools(config: CategoryToolConfig<Action>): ReturnType<typeof buildAggregatedTool>;
    callTool(
        client: SiYuanClient,
        args: Record<string, unknown> | undefined,
        config: CategoryToolConfig<Action>,
        permMgr: PermissionManager,
    ): Promise<ToolResult>;
}

/**
 * Collapse the repeated "variants + handler map + dispatcher" skeleton that
 * every tool file hand-writes (help routing, enabled check, action schema
 * parsing, switch, try/catch, error wrapping) into a single factory.
 *
 * Design notes:
 * - Handlers parse their own args. Trying to pre-parse inside the factory
 *   would either require a second schema map (doubling the surface) or a
 *   discriminated union that loses per-action typing. Leaving parsing to the
 *   handler keeps types narrow and action-local.
 * - Help and disabled-action short-circuits fire before handlers run, so
 *   handlers never observe action="help" or a disabled action.
 * - Errors from handlers are routed through `createErrorResult` so zod
 *   validation and translated SiYuan errors render consistently.
 */
export function defineTool<Action extends string>(options: DefineToolOptions<Action>): DefinedTool<Action> {
    const { name, description, variants, handlers, actionSchema, aggregateOptions } = options;

    return {
        listTools(config) {
            return buildAggregatedTool(name, description, config, variants, aggregateOptions);
        },

        async callTool(client, args, config, permMgr) {
            installRequestSemanticsCompatibility(client);
            const rawArgs = args ?? {};
            const rawAction = typeof rawArgs.action === 'string' ? rawArgs.action : undefined;
            const normalizedAction = rawAction ? normalizeActionAlias(name, rawAction) : undefined;
            let normalizedArgs: Record<string, unknown>;
            try {
                normalizedArgs = normalizeToolArguments(name, normalizedAction && normalizedAction !== rawAction
                    ? { ...rawArgs, action: normalizedAction }
                    : rawArgs);
            } catch (error) {
                return createErrorResult(error, { tool: name, action: normalizedAction ?? rawAction, rawArgs });
            }

            const helpResult = tryHandleHelpAction(name, normalizedArgs, config, variants);
            if (helpResult) return helpResult;

            try {
                const enabledActions = variants
                    .map((variant) => variant.action)
                    .filter((action) => config.actions[action]);
                if (rawAction && !variants.some((variant) => variant.action === normalizedAction)) {
                    return createUnknownActionResult(name, rawAction, enabledActions);
                }
                const parsedAction = actionSchema.parse(normalizedArgs.action);
                if (!config.enabled || !config.actions[parsedAction]) {
                    return createDisabledActionResult(name, parsedAction);
                }

                const handler = handlers[parsedAction];
                if (!handler) {
                    return createErrorResult(
                        new Error(`No handler registered for action "${parsedAction}" on tool "${name}".`),
                        { tool: name, action: parsedAction, rawArgs: normalizedArgs },
                    );
                }

                return await handler({ client, rawArgs: normalizedArgs, permMgr });
            } catch (error) {
                return createErrorResult(error, { tool: name, action: normalizedAction ?? rawAction, rawArgs: normalizedArgs });
            }
        },
    };
}

/**
 * Older embedders and the existing test doubles expose only request(). Keep
 * them source-compatible while production SiYuanClient uses explicit read /
 * write semantics. The fallback is conservative: the legacy request method
 * now has single-attempt write semantics in production.
 */
function installRequestSemanticsCompatibility(client: SiYuanClient): void {
    const compatible = client as SiYuanClient & {
        requestRead?: SiYuanClient['requestRead'];
        requestWrite?: SiYuanClient['requestWrite'];
        requestFormDataRead?: SiYuanClient['requestFormDataRead'];
        requestFormDataWrite?: SiYuanClient['requestFormDataWrite'];
    };
    const legacyDouble = !(client instanceof SiYuanClient);
    if ((legacyDouble || typeof compatible.requestRead !== 'function') && typeof compatible.request === 'function') {
        compatible.requestRead = compatible.request.bind(compatible);
    }
    if ((legacyDouble || typeof compatible.requestWrite !== 'function') && typeof compatible.request === 'function') {
        compatible.requestWrite = compatible.request.bind(compatible);
    }
    if ((legacyDouble || typeof compatible.requestFormDataRead !== 'function') && typeof compatible.requestFormData === 'function') {
        compatible.requestFormDataRead = compatible.requestFormData.bind(compatible);
    }
    if ((legacyDouble || typeof compatible.requestFormDataWrite !== 'function') && typeof compatible.requestFormData === 'function') {
        compatible.requestFormDataWrite = compatible.requestFormData.bind(compatible);
    }
}
