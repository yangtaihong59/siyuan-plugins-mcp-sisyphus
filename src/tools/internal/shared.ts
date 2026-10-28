import { usesBakedActionSchemas } from '../../core/action-schema-runtime';
import { renderAiLayoutGuide } from '../../core/ai-layout-guide';
import { z, ZodError } from 'zod';

import { getEnabledActions, isDangerousAction, type CategoryToolConfig, type ToolCategory } from '../../core/config';
import { translateError } from './errorTranslation';
import type { ActionVariant, AggregatedToolOptions, JsonSchema, PaginatedPayload, ToolErrorContext, ToolResult } from './types';
import { formatZodIssues, getValidationMessage, includeDebugDetails, isApiError, resolveHint } from './validation';
export { applyTruncation, paginate } from './pagination';
export type { ToolTextContent, ToolImageContent, ToolContent, ToolResult, JsonSchema, ActionVariant, AggregatedToolOptions, TruncationMeta, PaginationResult, PaginatedPayload } from './types';
import { buildActionHelp, buildActionSignatures, buildHelpIndex } from './help-render';
import {
    getSchemaProperties,
    getSchemaRequired,
    mergePropertySchemas,
    normalizeJsonSchema,
} from './schema-analyzer';

export const ACTION_SCHEMA_BRANCHES_KEY = 'x-sisyphus-actionSchemas';

export { getSchemaProperties, getSchemaRequired, normalizeJsonSchema };

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
    // Reflection is build-time only in goja. defineTool installs the complete
    // baked schema after the category's variant customizations have run.
    const jsonSchema = usesBakedActionSchemas
        ? createActionSchema(action, {}, [], description)
        : flattenAllOfObjectSchema(z.toJSONSchema(schema) as JsonSchema);
    delete jsonSchema.$schema;
    if (description && !jsonSchema.description) {
        jsonSchema.description = description;
    }
    return {
        action,
        schema: normalizeJsonSchema(jsonSchema),
        validate: (args) => { schema.parse(args); },
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
                enum: ['overview', 'ai-layout-guide', 'ai_layout_guide', ...enabledActions],
                description: 'Action name or ai-layout-guide for the complete layout guide; omit or use "overview" for the action index.',
            },
        },
        required: ['action'],
    };
}

function toErrorText(payload: Record<string, unknown>, isError = true): ToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError,
    };
}

/**
 * Tool descriptions follow a fixed, token-lean shape: what the tool is for,
 * then one compact signature per action. Everything else (optional fields,
 * per-action nuance, guidance, examples) is served on demand through
 * action="help" / siyuan://help resources, so it is not paid on every mount.
 */
function buildToolDescription<Action extends string>(
    category: ToolCategory,
    description: string,
    enabledVariants: ActionVariant<Action>[],
): string {
    const hasConfirmation = enabledVariants.some((variant) => isDangerousAction(category, variant.action));
    return [
        description,
        `Actions (required fields): ${buildActionSignatures(category, enabledVariants)}`,
        `${hasConfirmation ? '* = ask the user to confirm first. ' : ''}action="help" (topic=<action>) returns optional fields, nested shapes, and examples.`,
    ].join('\n');
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

    const fullDescription = buildToolDescription(category, description, enabledVariants);

    // References are relative to each action's original schema root. Keep that
    // root under an action namespace so recursive definitions survive merging
    // and independently generated names such as __schema0 cannot collide.
    const definitions: JsonSchema = {};
    const scopedVariants = enabledVariants.map((variant) => {
        const prefix = `#/$defs/${variant.action.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        let hasLocalRef = false;
        const relocate = (value: any): any => {
            if (Array.isArray(value)) return value.map(relocate);
            if (!value || typeof value !== 'object') return value;
            return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
                if (key === '$ref' && typeof nested === 'string' && (nested === '#' || nested.startsWith('#/'))) {
                    hasLocalRef = true;
                    return [key, prefix + nested.slice(1)];
                }
                return [key, relocate(nested)];
            }));
        };
        const schema = relocate(variant.schema);
        if (hasLocalRef) definitions[variant.action] = schema;
        return { ...variant, schema };
    });
    const mergedProperties = mergePropertySchemas(scopedVariants, options.propertyDescriptionOverrides);
    // `topic` is a help-only selector; merge it in without clobbering any action-specific property.
    if (!('topic' in mergedProperties)) {
        mergedProperties.topic = {
            type: 'string',
            description: 'Topic for action="help".',
        };
    }
    // Collapsed nested fields may no longer point into an action's definitions.
    const mergedJson = JSON.stringify(mergedProperties);
    for (const action of Object.keys(definitions)) {
        const prefix = `#/$defs/${action.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        if (!mergedJson.includes(`"${prefix}"`) && !mergedJson.includes(`"${prefix}/`)) delete definitions[action];
    }
    const actionBranches = [
        ...enabledVariants.map((variant) => withActionDiscriminator(variant)),
        buildHelpActionSchema(enabledActions),
    ];

    const inputSchema = normalizeJsonSchema({
        type: 'object',
        ...(Object.keys(definitions).length > 0 ? { $defs: definitions } : {}),
        properties: {
            action: {
                type: 'string',
                enum: [...enabledActions, 'help'],
                description: 'Operation.',
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

    if (topic === 'ai-layout-guide' || topic === 'ai_layout_guide') {
        return createJsonResult({ uri: 'siyuan://help/ai-layout-guide', mimeType: 'text/markdown', text: renderAiLayoutGuide() });
    }
    if (topic) {
        if (!enabledSet.has(topic as Action)) {
            return toErrorText({
                error: {
                    type: 'unknown_help_topic',
                    message: `Unknown help topic "${topic}" for tool "${category}".`,
                    tool: category,
                    topic,
                    validTopics: ['ai-layout-guide', ...enabledActions],
                    hint: `Call ${category}(action="help") without topic to see the action index.`,
                },
            });
        }
        return createJsonResult(buildActionHelp(category, topic as Action, enabledVariants));
    }

    return createJsonResult(buildHelpIndex(category, enabledActions, enabledVariants));
}

/**
 * Build the standard `{ data, total, page, pageSize, pageCount, hasNextPage }` shape
 * used by every list-style action. `extras` are merged at the top level (e.g. avID,
 * notebook, warnings). Pass a `PaginationResult` from `paginate()` or hand-rolled values.
 */
export function createPaginatedResult<T>(
    data: T[],
    pagination: { total: number | null; page: number; pageSize: number; pageCount: number; hasNextPage?: boolean },
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
            type: isApiError(normalizedError) ? 'api_error' : (clientErrorCode(normalizedError) ?? 'internal_error'),
            ...(translation ? { code: translation.code } : {}),
            message: normalizedError.message,
            ...clientErrorDetails(normalizedError),
            ...(context?.tool ? { tool: context.tool } : {}),
            ...(context?.action ? { action: context.action } : {}),
            ...(combinedHint ? { hint: combinedHint } : {}),
            ...(includeDebugDetails() && normalizedError.stack ? { details: normalizedError.stack } : {}),
        },
    };

    return toErrorText(payload);
}

/** Caller-correctable errors raised with an explicit code (see fs-path createFsError). */
const CLIENT_ERROR_CODES = new Set(['not_found', 'ambiguous_path', 'invalid_path', 'permission_denied']);

function clientErrorCode(error: Error): string | undefined {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && CLIENT_ERROR_CODES.has(code) ? code : undefined;
}

function clientErrorDetails(error: Error): Record<string, unknown> {
    if (!clientErrorCode(error)) return {};
    const details: Record<string, unknown> = {};
    for (const key of ['notebook', 'current_permission', 'required_permission'] as const) {
        const value = (error as unknown as Record<string, unknown>)[key];
        if (typeof value === 'string') details[key] = value;
    }
    return details;
}

export function createPermissionDeniedResult(notebookId: string, currentPerm: string, required: 'read' | 'write' | 'delete'): ToolResult {
    return toErrorText({
        error: {
            type: 'permission_denied',
            message: `Notebook "${notebookId}" has permission "${currentPerm}", ${required} access is required. Nothing was changed.`,
            hint: 'Only the user can change notebook permissions (plugin settings, or notebook(action="set_permission") if they have enabled it). Ask them, or pick a notebook listed as writable by notebook(action="get_permissions").',
            notebook: notebookId,
            current_permission: currentPerm,
            required_permission: required,
        },
    });
}

const ENABLE_IN_SETTINGS_HINT = 'Enable it in Settings -> Plugins -> SiYuan MCP sisyphus, or call listTools() again to inspect the currently enabled tools and actions.';

/*
 * tools/call gate errors. The Node server, kernel endpoint and CLI all return
 * these exact shapes, so clients can branch on error.type regardless of transport.
 */
/** POSIX, Windows drive (C:\\ or C:/) and UNC paths. */
export function isAbsoluteLocalPath(value: string): boolean {
    return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value);
}

/**
 * A server-side process cannot know the caller's working directory, so a
 * relative localFilePath would silently resolve against the server's cwd.
 */
export function createRelativeLocalPathResult(name: string, action: string, localFilePath: string): ToolResult {
    return toErrorText({
        error: {
            type: 'validation_error',
            message: `localFilePath must be an absolute path on the MCP server host; got relative path "${localFilePath}".`,
            tool: name,
            action,
            field: 'localFilePath',
            hint: 'Pass an absolute path (e.g. /Users/me/Pictures/cover.png). The CLI resolves relative paths against your current directory automatically. No write was attempted.',
        },
    });
}

export function createUnknownToolResult(name: string): ToolResult {
    return toErrorText({
        error: {
            type: 'unknown_tool',
            message: `Unknown tool "${name}".`,
            tool: name,
            hint: 'Call listTools() to see the tools currently exposed by this server.',
        },
    });
}

export function createDisabledToolResult(name: string): ToolResult {
    return toErrorText({
        error: {
            type: 'tool_disabled',
            message: `Tool "${name}" is disabled.`,
            tool: name,
            hint: ENABLE_IN_SETTINGS_HINT,
        },
    });
}

export function createDisabledActionResult(
    name: string,
    action: string,
    message = `Action "${action}" is disabled for tool "${name}".`,
): ToolResult {
    return toErrorText({
        error: {
            type: 'action_disabled',
            message,
            tool: name,
            action,
            hint: ENABLE_IN_SETTINGS_HINT,
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
