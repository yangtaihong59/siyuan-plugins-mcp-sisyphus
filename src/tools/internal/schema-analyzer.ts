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

export function mergePropertySchemas<Action extends string>(
    variants: SchemaVariant<Action>[],
    propertyDescriptionOverrides: Record<string, string> = {},
): JsonSchema {
    const mergedProperties: JsonSchema = {};
    const descriptions = new Map<string, Set<string>>();
    const enums = new Map<string, Set<unknown>>();
    const requiredBy = new Map<string, Set<string>>();
    const optionalIn = new Map<string, Set<string>>();
    const conditionalIn = new Map<string, Set<string>>();

    for (const variant of variants) {
        const variantRequired = new Set(getSchemaRequired(variant.schema));
        const conditionalRequired = new Set<string>((variant.schema.oneOf ?? variant.schema.anyOf ?? []).flatMap(getSchemaRequired));
        for (const [propertyName, propertySchema] of Object.entries(getSchemaProperties(variant.schema))) {
            if (propertyName === 'action' || !propertySchema || typeof propertySchema !== 'object') continue;

            mergedProperties[propertyName] = mergeLoosePropertySchema(
                mergedProperties[propertyName] as JsonSchema | undefined,
                propertySchema as JsonSchema,
            );

            const description = getSchemaDescription(propertySchema as JsonSchema);
            if (description) {
                const values = descriptions.get(propertyName) ?? new Set<string>();
                values.add(description);
                descriptions.set(propertyName, values);
            }

            const enumValues = (propertySchema as JsonSchema).enum;
            if (Array.isArray(enumValues)) {
                const values = enums.get(propertyName) ?? new Set<unknown>();
                for (const value of enumValues) values.add(value);
                enums.set(propertyName, values);
            }

            const targetMap = variantRequired.has(propertyName) ? requiredBy
                : conditionalRequired.has(propertyName) ? conditionalIn : optionalIn;
            const set = targetMap.get(propertyName) ?? new Set<string>();
            set.add(variant.action);
            targetMap.set(propertyName, set);
        }
    }

    for (const [propertyName, propertySchema] of Object.entries(mergedProperties)) {
        const propertyDescriptions = descriptions.get(propertyName);
        const baseDescription = propertyDescriptionOverrides[propertyName]
            ?? (propertyDescriptions && propertyDescriptions.size > 0 ? [...propertyDescriptions].join(' / ') : undefined);
        const required = [...(requiredBy.get(propertyName) ?? [])].sort();
        const optional = [...(optionalIn.get(propertyName) ?? [])].sort();
        const annotations = [
            ...(required.length > 0 ? [`Required by: ${required.join(', ')}`] : []),
            ...(optional.length > 0 ? [`Optional in: ${optional.join(', ')}`] : []),
            ...(conditionalIn.has(propertyName) ? [`Required in a parameter combination: ${[...conditionalIn.get(propertyName)!].sort().join(', ')}`] : []),
        ];
        const annotationText = annotations.length > 0 ? `[${annotations.join('; ')}]` : '';

        (propertySchema as JsonSchema).description = baseDescription
            ? (annotationText ? `${baseDescription} ${annotationText}` : baseDescription)
            : (annotationText || undefined);

        const enumValues = enums.get(propertyName);
        if (enumValues && enumValues.size > 0) {
            (propertySchema as JsonSchema).enum = [...enumValues];
        }
    }

    return mergedProperties;
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
