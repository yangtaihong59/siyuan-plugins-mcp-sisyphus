import { getActionTier, isDangerousAction, type ActionTier, type ToolCategory } from '../../core/config';
import { TOOL_ACTION_EXAMPLES, TOOL_ACTION_HINTS, TOOL_GUIDANCE_BY_CATEGORY, type HelpExample } from '../../core/help';
import { getSchemaProperties, getSchemaRequired } from './schema-analyzer';
import type { ActionVariant, JsonSchema } from './types';

function getSchemaRequiredWithoutAction(schema: JsonSchema): string[] {
    return getSchemaRequired(schema).filter(field => field !== 'action');
}

function getSchemaFieldNames(schema: JsonSchema, required?: boolean): string[] {
    const requiredFields = new Set(getSchemaRequiredWithoutAction(schema));

    return Object.entries(getSchemaProperties(schema)).flatMap(([name, propertySchema]) => {
        if (name === 'action' || !propertySchema || typeof propertySchema !== 'object' || Array.isArray(propertySchema)) {
            return [];
        }

        if (required === true && !requiredFields.has(name)) return [];
        if (required === false && requiredFields.has(name)) return [];
        return [name];
    });
}

export function buildExampleValue(fieldName: string, schema: JsonSchema): unknown {
    const description = typeof schema.description === 'string' ? schema.description : '';
    const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
    if (enumValues.length > 0) return enumValues[0];

    switch (fieldName) {
        case 'notebook':
            return '20210808180117-czj9bvb';
        case 'deckID':
            return '20230218211946-2kw8jgx';
        case 'cardID':
            return '20240318112233-card01';
        case 'rootID':
            return '20240318112233-root01';
        case 'id':
        case 'parentID':
        case 'previousID':
        case 'nextID':
        case 'fromID':
        case 'toID':
            return '20240318112233-abc123';
        case 'fromIDs':
            return ['20240318112233-a', '20240318112233-b'];
        case 'fromPaths':
            return ['/20240318112233-a.sy', '/20240318112233-b.sy'];
        case 'toNotebook':
            return '20210808180117-czj9bvb';
        case 'toPath':
            return '/20240318112233-existing-parent.sy';
        case 'path':
            if (description.toLowerCase().includes('workspace')) {
                // Prefer canonical fs paths with the notebook name even though
                // uniquely matching notebook-omitted paths are also accepted.
                return '/Notebook/Folder/Doc';
            }
            if (description.includes('Human-readable')) {
                // document tool paths are notebook-local (e.g., /Folder/Weekly Note)
                return '/Folder/Weekly Note';
            }
            // storage paths (e.g., /20240318112233-abc123.sy)
            return '/20240318112233-abc123.sy';
        case 'paths':
            return ['/assets/example.png'];
        case 'title':
            return 'Weekly Notes';
        case 'name':
            return description.includes('Export file name') ? 'assets-export.zip' : 'Research';
        case 'markdown':
            return '- Seed item';
        case 'dataType':
            return 'markdown';
        case 'data':
            return '- New item';
        case 'template':
            return 'codex-{{ now | date "2006" }}';
        case 'msg':
            return 'Hello from MCP';
        case 'timeout':
            return 3000;
        case 'rating':
            return 3;
        case 'reviewedCards':
            return [{ cardID: '20240318112233-card01', rating: 3 }];
        case 'assetsDirPath':
            return '/assets/';
        case 'file':
            return 'SGVsbG8sIFNpWXVhbg==';
        case 'fileName':
            return 'hello.txt';
        case 'attrs':
            return { 'custom-mcp': 'demo' };
        case 'conf':
            return { closed: false };
        case 'permission':
            return 'none';
        case 'query':
            return 'search keyword';
        case 'stmt':
            return "SELECT * FROM blocks WHERE content LIKE '%keyword%' LIMIT 20";
        case 'k':
            return 'todo';
        case 'keyword':
            return 'filter text';
        default:
            break;
    }

    if (schema.type === 'array') {
        const items = schema.items && typeof schema.items === 'object' ? schema.items as JsonSchema : { type: 'string' };
        return [buildExampleValue(`${fieldName}Item`, items)];
    }

    if (schema.type === 'object') {
        const properties = getSchemaProperties(schema);
        const firstProperty = Object.keys(properties)[0];
        if (!firstProperty) return {};
        return {
            [firstProperty]: buildExampleValue(firstProperty, properties[firstProperty] as JsonSchema),
        };
    }

    if (schema.type === 'number') return 1;
    if (schema.type === 'boolean') return false;
    return `<${fieldName}>`;
}

export function buildActionExampleObjects<Action extends string>(
    variants: ActionVariant<Action>[],
    action: string,
): Record<string, unknown>[] {
    const matching = variants.filter((variant) => variant.action === action);

    return matching.map((variant) => {
        const properties = getSchemaProperties(variant.schema);
        const example: Record<string, unknown> = { action };

        for (const field of getSchemaRequiredWithoutAction(variant.schema)) {
            example[field] = buildExampleValue(field, (properties[field] ?? {}) as JsonSchema);
        }

        return example;
    });
}

export function getCuratedActionExamples(category: ToolCategory, action: string): HelpExample[] {
    return TOOL_ACTION_EXAMPLES[category]?.[action] ?? [];
}

export function buildActionShapes<Action extends string>(
    variants: ActionVariant<Action>[],
    action: string,
): string[] {
    return variants
        .filter((variant) => variant.action === action)
        .map((variant) => {
            const fields = getSchemaRequiredWithoutAction(variant.schema);
            return fields.length > 0 ? fields.join(' + ') : 'action only';
        });
}

function formatFieldList(fields: string[]): string {
    return fields.length > 0 ? fields.join(', ') : 'no additional fields';
}

export function buildActionUsageSummary<Action extends string>(variants: ActionVariant<Action>[]): string {
    const actionShapes = new Map<string, string[]>();

    for (const variant of variants) {
        const shape = formatFieldList(
            getSchemaFieldNames(variant.schema, true),
        );
        const shapes = actionShapes.get(variant.action) ?? [];
        if (!shapes.includes(shape)) shapes.push(shape);
        actionShapes.set(variant.action, shapes);
    }

    return [...actionShapes.entries()].map(([action, shapes]) => `${action}: ${shapes.join(' | ')}`).join('; ');
}

export function buildParameterContract<Action extends string>(
    category: ToolCategory,
    variants: ActionVariant<Action>[],
): string {
    const seen = new Set<string>();
    return variants.flatMap((variant) => {
        if (seen.has(variant.action)) return [];
        seen.add(variant.action);

        const required = getSchemaFieldNames(variant.schema, true);
        const optional = getSchemaFieldNames(variant.schema, false);

        return [`${category}.${variant.action}: required ${required.length > 0 ? `[${required.join(', ')}]` : '[]'} | optional ${optional.length > 0 ? `[${optional.join(', ')}]` : '[]'}`];
    }).join('\n');
}

export function buildHelpIndex<Action extends string>(
    category: ToolCategory,
    enabledActions: Action[],
    enabledVariants: ActionVariant<Action>[],
): Record<string, unknown> {
    const tierGroups: Record<ActionTier, string[]> = { basic: [], advanced: [] };
    for (const action of enabledActions) tierGroups[getActionTier(category, action)].push(action);

    const actionSummaries: Record<string, string> = {};
    const actions: Record<string, { hint?: string; requiresConfirmation: boolean }> = {};
    const seen = new Set<string>();
    for (const variant of enabledVariants) {
        if (seen.has(variant.action)) continue;
        seen.add(variant.action);
        const hint = TOOL_ACTION_HINTS[category]?.[variant.action];
        const fields = getSchemaFieldNames(variant.schema, true);
        actionSummaries[variant.action] = hint ?? (fields.length > 0 ? `requires: ${fields.join(', ')}` : 'no extra fields');
        actions[variant.action] = {
            ...(hint ? { hint } : {}),
            requiresConfirmation: isDangerousAction(category, variant.action),
        };
    }

    const confirmationActions = enabledActions.filter((action) => isDangerousAction(category, action));
    return {
        tool: category,
        commonActions: tierGroups.basic,
        advancedActions: tierGroups.advanced,
        guidance: TOOL_GUIDANCE_BY_CATEGORY[category] ?? [],
        actions,
        actionSummaries,
        ...(confirmationActions.length > 0 ? { requiresConfirmation: confirmationActions } : {}),
        detailsHint: `Call ${category}(action="help", topic="<actionName>") for required fields, shapes, and a minimal example.`,
        helpResources: [
            `siyuan://help/action/${category}/{action}`,
            'siyuan://help/tool-overview',
            'siyuan://help/examples',
            'siyuan://help/ai-layout-guide',
        ],
    };
}

export function buildActionHelp<Action extends string>(
    category: ToolCategory,
    action: Action,
    enabledVariants: ActionVariant<Action>[],
): Record<string, unknown> {
    const matching = enabledVariants.filter((variant) => variant.action === action);
    const requiredFieldSets = matching.map((variant) => getSchemaFieldNames(variant.schema, true));
    const generatedExamples = buildActionExampleObjects(matching, action);
    const curatedExamples = getCuratedActionExamples(category, action);
    const example = generatedExamples.length === 1 ? generatedExamples[0] : generatedExamples;

    return {
        tool: category,
        action,
        ...(TOOL_ACTION_HINTS[category]?.[action] ? { hint: TOOL_ACTION_HINTS[category][action] } : {}),
        shapes: requiredFieldSets.map((fields) => fields.length > 0 ? fields.join(' + ') : 'action only'),
        requiredFields: requiredFieldSets.length === 1 ? requiredFieldSets[0] : requiredFieldSets,
        example,
        ...(curatedExamples.length > 0 ? { examples: curatedExamples } : {}),
        guidance: TOOL_GUIDANCE_BY_CATEGORY[category] ?? [],
        requiresConfirmation: isDangerousAction(category, action),
        fullDocResource: `siyuan://help/action/${category}/${action}`,
    };
}

// Re-export alias for backward compatibility with resources.ts style callers.
export function buildActionExamplesMarkdown<Action extends string>(
    variants: ActionVariant<Action>[],
    action: string,
    category?: ToolCategory,
): string[] {
    if (category) {
        const curated = getCuratedActionExamples(category, action);
        if (curated.length > 0) {
            return curated.map((example) => [
                `### ${example.title}`,
                '',
                ...(example.description ? [example.description, ''] : []),
                `\`\`\`json\n${JSON.stringify(example.mcp, null, 2)}\n\`\`\``,
            ].join('\n'));
        }
    }

    return buildActionExampleObjects(variants, action).map((example) =>
        `\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\``,
    );
}

export function buildShapeSummaryMarkdown<Action extends string>(
    variants: ActionVariant<Action>[],
    action: string,
): string[] {
    return variants
        .filter((variant) => variant.action === action)
        .map((variant) => {
            const fields = getSchemaRequiredWithoutAction(variant.schema);
            return fields.length > 0 ? `- \`${fields.join(' + ')}\`` : '- `action` only';
        });
}

export type { ToolCategory };
