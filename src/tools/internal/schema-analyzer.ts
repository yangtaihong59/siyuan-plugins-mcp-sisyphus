type JsonSchema = Record<string, any>;

type SchemaVariant<Action extends string = string> = {
    action: Action;
    schema: JsonSchema;
};

function getSchemaDescription(schema: JsonSchema): string | null {
    return typeof schema.description === 'string' ? schema.description : null;
}

export function getSchemaProperties(schema: JsonSchema): JsonSchema {
    const value = schema.properties;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonSchema : {};
}

export function getSchemaRequired(schema: JsonSchema): string[] {
    return Array.isArray(schema.required)
        ? schema.required.filter((value): value is string => typeof value === 'string')
        : [];
}

/**
 * Nested property schemas above this JSON size are collapsed in the merged
 * (mount-time) schema to their top-level type plus a pointer to action help.
 * Full validation still runs server-side against each action's Zod schema, and
 * action help returns the complete nested shape on demand.
 */
export const COLLAPSED_PROPERTY_SCHEMA_CHARS = 600;

export function mergePropertySchemas<Action extends string>(
    variants: SchemaVariant<Action>[],
    propertyDescriptionOverrides: Record<string, string> = {},
): JsonSchema {
    const mergedProperties: JsonSchema = {};
    const descriptions = new Map<string, string>();
    const enums = new Map<string, Set<unknown>>();

    for (const variant of variants) {
        for (const [propertyName, propertySchema] of Object.entries(getSchemaProperties(variant.schema))) {
            if (propertyName === 'action' || !propertySchema || typeof propertySchema !== 'object') continue;
            // Deprecated / pure alias fields stay accepted at runtime but are not advertised.
            if (isHiddenAliasProperty(propertySchema as JsonSchema)) continue;

            mergedProperties[propertyName] = mergeLoosePropertySchema(
                mergedProperties[propertyName] as JsonSchema | undefined,
                propertySchema as JsonSchema,
            );

            // Keep the first action's wording; per-action nuance lives in action help.
            const description = getSchemaDescription(propertySchema as JsonSchema);
            if (description && !descriptions.has(propertyName)) descriptions.set(propertyName, description);

            const enumValues = (propertySchema as JsonSchema).enum;
            if (Array.isArray(enumValues)) {
                const values = enums.get(propertyName) ?? new Set<unknown>();
                for (const value of enumValues) values.add(value);
                enums.set(propertyName, values);
            }
        }
    }

    for (const [propertyName, propertySchema] of Object.entries(mergedProperties)) {
        const description = propertyDescriptionOverrides[propertyName] ?? descriptions.get(propertyName);
        (propertySchema as JsonSchema).description = description;
        if (!description) delete (propertySchema as JsonSchema).description;

        const enumValues = enums.get(propertyName);
        if (enumValues && enumValues.size > 0) {
            (propertySchema as JsonSchema).enum = [...enumValues];
        }

        mergedProperties[propertyName] = collapseLargePropertySchema(propertySchema as JsonSchema);
    }

    return mergedProperties;
}

const HIDDEN_ALIAS_DESCRIPTION = /^(Alias (of|for) |Compatibility option|Legacy )/;

function isHiddenAliasProperty(schema: JsonSchema): boolean {
    const description = getSchemaDescription(schema);
    return schema.deprecated === true || (description !== null && HIDDEN_ALIAS_DESCRIPTION.test(description));
}

function collapseLargePropertySchema(schema: JsonSchema): JsonSchema {
    // Long scalar descriptions/enums are not nested structures. Keep their types
    // and constraints (also used by CLI flag coercion).
    const nested = schema.type === 'object' || schema.type === 'array'
        || Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf);
    if (!nested || JSON.stringify(schema).length <= COLLAPSED_PROPERTY_SCHEMA_CHARS) return schema;
    const pointer = 'Read action="help", topic="<action>" before constructing this nested value.';
    const collapsed: JsonSchema = {
        description: typeof schema.description === 'string' ? `${schema.description} ${pointer}` : pointer,
    };
    // Mixed unions (e.g. string | object) keep no type so no valid form is excluded.
    if (schema.type === 'object') collapsed.type = 'object';
    if (schema.type === 'array') {
        collapsed.type = 'array';
        const itemType = (schema.items as JsonSchema | undefined)?.type;
        collapsed.items = typeof itemType === 'string' ? { type: itemType } : {};
    }
    return collapsed;
}

function mergeLoosePropertySchema(previous: JsonSchema | undefined, next: JsonSchema): JsonSchema {
    if (!previous) return { ...next };
    const merged = { ...previous, ...next };

    mergeLowerBound(merged, previous, next, 'minimum');
    mergeLowerBound(merged, previous, next, 'exclusiveMinimum');
    mergeUpperBound(merged, previous, next, 'maximum');
    mergeUpperBound(merged, previous, next, 'exclusiveMaximum');

    return merged;
}

function mergeLowerBound(target: JsonSchema, previous: JsonSchema, next: JsonSchema, key: string) {
    const previousValue = previous[key];
    const nextValue = next[key];
    if (typeof previousValue === 'number' && typeof nextValue === 'number') {
        target[key] = Math.min(previousValue, nextValue);
    } else {
        delete target[key];
    }
}

function mergeUpperBound(target: JsonSchema, previous: JsonSchema, next: JsonSchema, key: string) {
    const previousValue = previous[key];
    const nextValue = next[key];
    if (typeof previousValue === 'number' && typeof nextValue === 'number') {
        target[key] = Math.max(previousValue, nextValue);
    } else {
        delete target[key];
    }
}

function normalizeSchemaNode(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;

    const normalized = { ...(schema as JsonSchema) };

    if (normalized.type === 'array') {
        normalized.items = normalizeSchemaNode(
            normalized.items && typeof normalized.items === 'object'
                ? normalized.items
                : { type: 'string' },
        );
    }

    if (normalized.properties && typeof normalized.properties === 'object' && !Array.isArray(normalized.properties)) {
        normalized.properties = Object.fromEntries(
            Object.entries(normalized.properties).map(([key, value]) => [key, normalizeSchemaNode(value)]),
        );
    }

    if (
        normalized.propertyNames &&
        typeof normalized.propertyNames === 'object' &&
        !Array.isArray(normalized.propertyNames)
    ) {
        const propertyNames = normalized.propertyNames as JsonSchema;
        if (propertyNames.type === 'string' && Object.keys(propertyNames).length === 1) {
            delete normalized.propertyNames;
        } else {
            normalized.propertyNames = normalizeSchemaNode(propertyNames);
        }
    }

    if (normalized.additionalProperties && typeof normalized.additionalProperties === 'object' && !Array.isArray(normalized.additionalProperties)) {
        normalized.additionalProperties = normalizeSchemaNode(normalized.additionalProperties);
    }

    if (Array.isArray(normalized.oneOf)) normalized.oneOf = normalized.oneOf.map((item) => normalizeSchemaNode(item));
    if (Array.isArray(normalized.anyOf)) normalized.anyOf = normalized.anyOf.map((item) => normalizeSchemaNode(item));
    if (Array.isArray(normalized.allOf)) normalized.allOf = normalized.allOf.map((item) => normalizeSchemaNode(item));

    return normalized;
}

export function normalizeJsonSchema(schema: JsonSchema): JsonSchema {
    return normalizeSchemaNode(schema) as JsonSchema;
}
