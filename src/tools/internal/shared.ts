import { z, ZodError, type ZodIssue } from 'zod';

import { getActionTier, getEnabledActions, isDangerousAction, type CategoryToolConfig, type ToolCategory } from '../../core/config';
import { getActionHint } from '../../core/help';
import { translateError } from './errorTranslation';
import { buildActionHelp, buildActionUsageSummary, buildHelpIndex, buildParameterContract } from './help-render';
import {
    getSchemaProperties,
    getSchemaRequired,
    mergePropertySchemas,
    normalizeJsonSchema,
} from './schema-analyzer';

export interface ToolTextContent {
    type: 'text';
    text: string;
    data?: never;
    mimeType?: never;
}

export interface ToolImageContent {
    type: 'image';
    data: string;
    mimeType: string;
    text?: never;
    _meta?: Record<string, unknown>;
}

export type ToolContent = ToolTextContent | ToolImageContent;

export interface ToolResult {
    content: ToolContent[];
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
}

export type JsonSchema = Record<string, any>;

export interface ActionVariant<Action extends string> {
    action: Action;
    schema: JsonSchema;
}

export const ACTION_SCHEMA_BRANCHES_KEY = 'x-sisyphus-actionSchemas';

export { getSchemaProperties, getSchemaRequired, normalizeJsonSchema };

export interface AggregatedToolOptions<Action extends string> {
    guidance?: string[];
    actionHints?: Partial<Record<Action, string>>;
    propertyDescriptionOverrides?: Record<string, string>;
    guidanceInlineLimit?: number;
}

interface ToolErrorContext {
    tool?: string;
    action?: string;
    rawArgs?: Record<string, unknown>;
    hint?: string;
}

interface ToolFieldError {
    path: string;
    message: string;
}

export function createActionSchema(
    action: string,
    properties: JsonSchema,
    required: string[],
    description?: string,
): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        description,
        properties: {
            action: {
                type: 'string',
                const: action,
                description: 'Action to perform',
            },
            ...properties,
        },
        required: ['action', ...required],
    };
}

export function createZodActionVariant<Action extends string>(
    action: Action,
    schema: z.ZodType,
    description?: string,
): ActionVariant<Action> {
    const jsonSchema = flattenAllOfObjectSchema(z.toJSONSchema(schema) as JsonSchema);
    delete jsonSchema.$schema;
    if (description && !jsonSchema.description) {
        jsonSchema.description = description;
    }
    return {
        action,
        schema: normalizeJsonSchema(jsonSchema),
    };
}

function flattenAllOfObjectSchema(schema: JsonSchema): JsonSchema {
    const normalizedChildren: JsonSchema = { ...schema };

    if (normalizedChildren.properties && typeof normalizedChildren.properties === 'object' && !Array.isArray(normalizedChildren.properties)) {
        normalizedChildren.properties = Object.fromEntries(
            Object.entries(normalizedChildren.properties).map(([key, value]) => [
                key,
                value && typeof value === 'object' && !Array.isArray(value)
                    ? flattenAllOfObjectSchema(value as JsonSchema)
                    : value,
            ]),
        );
    }

    if (normalizedChildren.items && typeof normalizedChildren.items === 'object' && !Array.isArray(normalizedChildren.items)) {
        normalizedChildren.items = flattenAllOfObjectSchema(normalizedChildren.items as JsonSchema);
    }

    if (
        normalizedChildren.additionalProperties &&
        typeof normalizedChildren.additionalProperties === 'object' &&
        !Array.isArray(normalizedChildren.additionalProperties)
    ) {
        normalizedChildren.additionalProperties = flattenAllOfObjectSchema(normalizedChildren.additionalProperties as JsonSchema);
    }

    if (Array.isArray(normalizedChildren.oneOf)) {
        normalizedChildren.oneOf = normalizedChildren.oneOf.map((item) => (
            item && typeof item === 'object' && !Array.isArray(item) ? flattenAllOfObjectSchema(item as JsonSchema) : item
        ));
    }
    if (Array.isArray(normalizedChildren.anyOf)) {
        normalizedChildren.anyOf = normalizedChildren.anyOf.map((item) => (
            item && typeof item === 'object' && !Array.isArray(item) ? flattenAllOfObjectSchema(item as JsonSchema) : item
        ));
    }

    if (!Array.isArray(normalizedChildren.allOf)) return normalizedChildren;

    const properties: JsonSchema = {};
    const required = new Set<string>();
    const flattenedParts: JsonSchema[] = [];

    for (const part of normalizedChildren.allOf) {
        if (!part || typeof part !== 'object' || Array.isArray(part)) return schema;
        const flattened = flattenAllOfObjectSchema(part as JsonSchema);
        if (flattened.type !== 'object') return schema;
        Object.assign(properties, getSchemaProperties(flattened));
        for (const field of getSchemaRequired(flattened)) required.add(field);
        flattenedParts.push(flattened);
    }

    const { allOf: _allOf, ...rest } = normalizedChildren;
    return {
        ...rest,
        type: 'object',
        properties,
        required: [...required],
        additionalProperties: flattenedParts.every((part) => part.additionalProperties === false)
            ? false
            : normalizedChildren.additionalProperties,
    };
}

function withActionDiscriminator<Action extends string>(variant: ActionVariant<Action>): JsonSchema {
    const properties = {
        action: {
            type: 'string',
            const: variant.action,
            description: 'Action to perform',
        },
        ...getSchemaProperties(variant.schema),
    };
    return normalizeJsonSchema({
        ...variant.schema,
        type: 'object',
        additionalProperties: false,
        properties,
        required: Array.from(new Set(['action', ...getSchemaRequired(variant.schema)])),
    });
}

function createLoosePropertySchema(schema: JsonSchema): JsonSchema {
    const loose: JsonSchema = { ...schema };
    delete loose.const;
    delete loose.required;
    return loose;
}

function createLooseInputProperties(properties: JsonSchema): JsonSchema {
    return Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
            key,
            value && typeof value === 'object' && !Array.isArray(value)
                ? createLoosePropertySchema(value as JsonSchema)
                : {},
        ]),
    );
}

function buildHelpActionSchema(enabledActions: string[]): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            action: {
                type: 'string',
                const: 'help',
                description: 'Show help for this tool or one action.',
            },
            topic: {
                type: 'string',
                enum: ['overview', ...enabledActions],
                description: 'Optional action name to inspect; omit or use "overview" for the action index.',
            },
        },
        required: ['action'],
    };
}

function buildEssentialGuidance<Action extends string>(
    category: ToolCategory,
    actionList: Action[],
    options: AggregatedToolOptions<Action>,
): string[] {
    const notes: string[] = [];

    const guidanceInlineLimit = options.guidanceInlineLimit ?? 2;

    // Only include the configured number of top guidance lines (most critical context)
    const guidance = options.guidance ?? [];
    notes.push(...guidance.slice(0, guidanceInlineLimit));

    const confirmationActions = actionList.filter((action) => isDangerousAction(category, action));
    if (confirmationActions.length > 0) {
        notes.push(`Requires user confirmation before: ${confirmationActions.join(', ')}.`);
    }

    // Action hints are no longer inlined — available via siyuan://help/action/{tool}/{action}

    return notes;
}

function formatIssuePath(path: PropertyKey[]): string {
    return path
        .map((segment) => typeof segment === 'number' ? `[${segment}]` : String(segment))
        .join('.')
        .replace(/\.\[/g, '[');
}

function getValueAtPath(value: unknown, path: PropertyKey[]): unknown {
    let current = value;
    for (const segment of path) {
        if (current === null || current === undefined) return undefined;
        if (typeof segment === 'number') {
            if (!Array.isArray(current)) return undefined;
            current = current[segment];
            continue;
        }
        if (typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[String(segment)];
    }
    return current;
}

function formatIssueMessage(issue: ZodIssue, rawArgs?: Record<string, unknown>): string {
    const path = formatIssuePath(issue.path);
    const valueAtPath = path ? getValueAtPath(rawArgs, issue.path) : undefined;

    if (issue.code === 'invalid_type') {
        if (valueAtPath === undefined && path) {
            return `${path} is required.`;
        }
        return path ? `${path} has an invalid type.` : 'Invalid input type.';
    }

    if (issue.code === 'unrecognized_keys' && 'keys' in issue && Array.isArray(issue.keys)) {
        return `Unexpected field(s): ${issue.keys.join(', ')}.`;
    }

    if (issue.message && issue.message !== 'Invalid input') {
        return issue.message;
    }

    return path ? `Invalid value for ${path}.` : 'Invalid input.';
}

function formatZodIssues(error: ZodError, rawArgs?: Record<string, unknown>): ToolFieldError[] {
    return error.issues.map((issue) => ({
        path: formatIssuePath(issue.path),
        message: formatIssueMessage(issue, rawArgs),
    }));
}

function getValidationMessage(tool?: string, action?: string): string {
    if (tool && action) return `Invalid arguments for ${tool}(action="${action}").`;
    if (tool) return `Invalid arguments for tool "${tool}".`;
    return 'Invalid arguments.';
}

function resolveHint(context?: ToolErrorContext): string | undefined {
    return context?.hint ?? getActionHint(context?.tool, context?.action);
}

function toErrorText(payload: Record<string, unknown>, isError = true): ToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError,
    };
}

function isApiError(error: Error): boolean {
    return error.name === 'SiYuanError'
        || error.message.startsWith('SiYuan API error:')
        || error.message.startsWith('HTTP error:')
        || error.message.startsWith('Request timeout');
}

function includeDebugDetails(): boolean {
    return process.env.SIYUAN_MCP_DEBUG_ERRORS === '1';
}

function buildTieredDescription<Action extends string>(
    category: ToolCategory,
    description: string,
    enabledActions: Action[],
    enabledVariants: ActionVariant<Action>[],
    options: AggregatedToolOptions<Action>,
): string {
    const basicActions = enabledActions.filter((a) => getActionTier(category, a) === 'basic');
    const advancedActions = enabledActions.filter((a) => getActionTier(category, a) === 'advanced');

    const basicVariants = enabledVariants.filter((v) => basicActions.includes(v.action));
    const basicUsageSummary = buildActionUsageSummary(basicVariants);

    const parts = [
        `${description} Use the "action" field to select the operation.`,
    ];

    if (basicActions.length > 0) {
        parts.push(`Common actions: ${basicActions.join(', ')}. Required fields: ${basicUsageSummary}.`);
    }

    if (advancedActions.length > 0) {
        parts.push(`Additional actions: ${advancedActions.join(', ')}. Read siyuan://help/action/${category}/{action} for details, or call action="help" if resources are unavailable.`);
    }

    const contract = buildParameterContract(category, enabledVariants);
    if (contract.length > 0) {
        parts.push(`Parameter contract per action (fields outside the action's optional list should not be sent):\n${contract}`);
    }

    const guidance = buildEssentialGuidance(category, enabledActions, options);
    if (guidance.length > 0) {
        parts.push(guidance.join(' '));
    }

    return parts.join('\n\n');
}

export function buildAggregatedTool<Action extends string>(
    category: ToolCategory,
    description: string,
    config: CategoryToolConfig<Action>,
    variants: ActionVariant<Action>[],
    options: AggregatedToolOptions<Action> = {},
) {
    if (!config.enabled) return [];

    const enabledActions = getEnabledActions(config) as Action[];
    const enabledActionSet = new Set(enabledActions);
    const enabledVariants = variants.filter((variant) => enabledActionSet.has(variant.action));
    if (enabledVariants.length === 0) return [];

    const fullDescription = buildTieredDescription(category, description, enabledActions, enabledVariants, options);
    const confirmationActions = enabledActions.filter((action) => isDangerousAction(category, action));

    const mergedProperties = mergePropertySchemas(enabledVariants, options.propertyDescriptionOverrides);
    // `topic` is a help-only selector; merge it in without clobbering any action-specific property.
    if (!('topic' in mergedProperties)) {
        mergedProperties.topic = {
            type: 'string',
            description: 'Optional. Only used when action="help". Pass an action name (e.g. "create") to get per-action help; omit or use "overview" for the action index.',
        };
    }
    const actionBranches = [
        ...enabledVariants.map((variant) => withActionDiscriminator(variant)),
        buildHelpActionSchema(enabledActions),
    ];

    const inputSchema = normalizeJsonSchema({
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: [...enabledActions, 'help'],
                description: `Action to perform. Supported values: ${enabledActions.join(', ')}. Use action="help" for the action index, or action="help" with topic="<actionName>" for per-action details.${confirmationActions.length > 0 ? ` User confirmation is required before calling: ${confirmationActions.join(', ')}.` : ''}`,
            },
            ...createLooseInputProperties(mergedProperties),
        },
        additionalProperties: true,
    });
    Object.defineProperty(inputSchema, ACTION_SCHEMA_BRANCHES_KEY, {
        value: actionBranches,
        enumerable: false,
    });

    return [{
        name: category,
        description: fullDescription,
        inputSchema,
    }];
}

export function tryHandleHelpAction<Action extends string>(
    category: ToolCategory,
    rawArgs: Record<string, unknown>,
    config: CategoryToolConfig<Action>,
    variants: ActionVariant<Action>[],
): ToolResult | null {
    if (rawArgs.action !== 'help') return null;

    const enabledActions = getEnabledActions(config) as Action[];
    const enabledSet = new Set(enabledActions);
    const enabledVariants = variants.filter((v) => enabledSet.has(v.action));

    const rawTopic = typeof rawArgs.topic === 'string' ? rawArgs.topic.trim() : '';
    const topic = rawTopic && rawTopic !== 'overview' ? rawTopic : null;

    if (topic) {
        if (!enabledSet.has(topic as Action)) {
            return toErrorText({
                error: {
                    type: 'unknown_help_topic',
                    message: `Unknown help topic "${topic}" for tool "${category}".`,
                    tool: category,
                    topic,
                    validTopics: [...enabledActions],
                    hint: `Call ${category}(action="help") without topic to see the action index.`,
                },
            });
        }
        return createJsonResult(buildActionHelp(category, topic as Action, enabledVariants));
    }

    return createJsonResult(buildHelpIndex(category, enabledActions, enabledVariants));
}

export interface TruncationMeta {
    truncated: boolean;
    showing: number;
    total: number;
    hint: string;
}

export function applyTruncation<T>(
    items: T[],
    limit: number,
    hint: string,
): { items: T[]; meta?: TruncationMeta } {
    if (items.length <= limit) return { items };
    return {
        items: items.slice(0, limit),
        meta: {
            truncated: true,
            showing: limit,
            total: items.length,
            hint,
        },
    };
}

export interface PaginationResult<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    showing: number;
    truncated: boolean;
    hasNextPage: boolean;
}

export function paginate<T>(items: T[], page: number, pageSize: number): PaginationResult<T> {
    const total = items.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const normalizedPage = Math.min(page, pageCount);
    const start = (normalizedPage - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);
    return {
        items: paged,
        total,
        page: normalizedPage,
        pageSize,
        pageCount,
        showing: paged.length,
        truncated: pageCount > 1,
        hasNextPage: normalizedPage < pageCount,
    };
}

export interface PaginatedPayload<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    hasNextPage: boolean;
}

/**
 * Build the standard `{ data, total, page, pageSize, pageCount, hasNextPage }` shape
 * used by every list-style action. `extras` are merged at the top level (e.g. avID,
 * notebook, warnings). Pass a `PaginationResult` from `paginate()` or hand-rolled values.
 */
export function createPaginatedResult<T>(
    data: T[],
    pagination: { total: number; page: number; pageSize: number; pageCount: number; hasNextPage?: boolean },
    extras?: Record<string, unknown>,
): ToolResult {
    const payload: PaginatedPayload<T> & Record<string, unknown> = {
        data,
        total: pagination.total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        pageCount: pagination.pageCount,
        hasNextPage: pagination.hasNextPage ?? (pagination.page < pagination.pageCount),
        ...(extras ?? {}),
    };
    return createJsonResult(payload);
}

export function createJsonResult(value: unknown): ToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    };
}

export function createSetIconReminder(
    target: 'document' | 'notebook',
    alreadySet = false,
): string {
    if (target === 'notebook') {
        return alreadySet
            ? 'Use notebook(action="set_icon") later if you want to change the notebook icon. Prefer a Unicode hex code string like "1f4d4" instead of a raw emoji character.'
            : 'After creation, call notebook(action="set_icon") to set the notebook icon. Prefer a Unicode hex code string like "1f4d4" instead of a raw emoji character.';
    }

    return alreadySet
        ? 'Use document(action="set_attr", attrs={ icon }) later if you want to change the document icon. Prefer a Unicode hex code string like "1f4d4" instead of a raw emoji character.'
        : 'After creation, call document(action="set_attr", attrs={ icon }) to set the document icon. Prefer a Unicode hex code string like "1f4d4" instead of a raw emoji character.';
}

export function createWriteSuccessResult(
    context: Record<string, unknown>,
    rawResult?: unknown,
): ToolResult {
    if (rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)) {
        return createJsonResult({ success: true, ...(rawResult as Record<string, unknown>), ...context });
    }

    return createJsonResult({ success: true, ...context });
}

export function createErrorResult(error: unknown, context?: ToolErrorContext): ToolResult {
    if (error instanceof ZodError) {
        const fields = formatZodIssues(error, context?.rawArgs);
        const payload: Record<string, unknown> = {
            error: {
                type: 'validation_error',
                message: getValidationMessage(context?.tool, context?.action),
                ...(context?.tool ? { tool: context.tool } : {}),
                ...(context?.action ? { action: context.action } : {}),
                ...(fields.length > 0 ? { fields } : {}),
                ...(resolveHint(context) ? { hint: resolveHint(context) } : {}),
            },
        };
        return toErrorText(payload);
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const translation = translateError(normalizedError);
    const contextHint = resolveHint(context);
    const combinedHint = translation && contextHint
        ? `${translation.hint} ${contextHint}`
        : (translation?.hint ?? contextHint);

    const payload: Record<string, unknown> = {
        error: {
            type: isApiError(normalizedError) ? 'api_error' : 'internal_error',
            ...(translation ? { code: translation.code } : {}),
            message: normalizedError.message,
            ...(context?.tool ? { tool: context.tool } : {}),
            ...(context?.action ? { action: context.action } : {}),
            ...(combinedHint ? { hint: combinedHint } : {}),
            ...(includeDebugDetails() && normalizedError.stack ? { details: normalizedError.stack } : {}),
        },
    };

    return toErrorText(payload);
}

export function createPermissionDeniedResult(notebookId: string, currentPerm: string, required: 'read' | 'write' | 'delete'): ToolResult {
    return toErrorText({
        error: {
            type: 'permission_denied',
            message: `Notebook "${notebookId}" has permission "${currentPerm}", ${required} access is required. Use notebook(action="set_permission") to change.`,
            notebook: notebookId,
            current_permission: currentPerm,
            required_permission: required,
        },
    });
}

export function createDisabledActionResult(name: ToolCategory, action: string): ToolResult {
    return toErrorText({
        error: {
            type: 'action_disabled',
            message: `Action "${action}" is disabled for tool "${name}".`,
            tool: name,
            action,
            hint: 'Enable the action in Settings -> Plugins -> SiYuan MCP sisyphus, or call listTools() again to inspect the currently enabled actions.',
        },
    });
}

export function createUnknownActionResult(name: ToolCategory, action: string, validActions: string[]): ToolResult {
    return toErrorText({
        error: {
            type: 'unknown_action',
            message: `Unknown action "${action}" for tool "${name}".`,
            tool: name,
            action,
            validActions: [...validActions, 'help'],
            hint: `Call ${name}(action="help") to inspect available actions and parameter shapes.`,
        },
    });
}
