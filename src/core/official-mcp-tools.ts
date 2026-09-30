import { z } from 'zod';

const SELF_PLUGIN_TOOL_PREFIX = 'plugin__siyuan_plugins_mcp_sisyphus__';

const OfficialToolSchema = z.object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: z.unknown().optional(),
    outputSchema: z.unknown().optional(),
    source: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    effectScope: z.string().optional(),
    annotations: z.object({ readOnlyHint: z.boolean().optional() }).passthrough().optional(),
}).passthrough();
export const OfficialListToolsResultSchema = z.object({
    tools: z.array(OfficialToolSchema),
    nextCursor: z.string().optional(),
}).passthrough();

export type OfficialMcpToolSource = 'plugin' | 'native';

export interface OfficialMcpTool {
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    source: OfficialMcpToolSource;
    readOnlyHint: boolean;
    effectScope?: string;
    schemaDegraded: boolean;
}

export interface OfficialMcpDiscoverySnapshot {
    tools: OfficialMcpTool[];
    connected: boolean;
    supported?: boolean;
    siyuanVersion?: string;
    minSupportedVersion?: string;
    lastSuccessfulRefreshAt?: string;
    lastAttemptAt?: string;
    error?: string;
    changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeOfficialInputSchema(
    schema: unknown,
): { schema: Record<string, unknown>; degraded: boolean } {
    if (!isRecord(schema)) {
        return { schema: { type: 'object', additionalProperties: true }, degraded: true };
    }

    const declaredType = schema.type;
    const hasComposition = Array.isArray(schema.oneOf)
        || Array.isArray(schema.anyOf)
        || Array.isArray(schema.allOf)
        || typeof schema.$ref === 'string';
    if (declaredType !== undefined && declaredType !== 'object') {
        return { schema: { type: 'object', additionalProperties: true }, degraded: true };
    }
    if (declaredType === undefined && !hasComposition && !isRecord(schema.properties)) {
        return { schema: { type: 'object', additionalProperties: true }, degraded: true };
    }

    return {
        schema: declaredType === undefined && !hasComposition
            ? { ...schema, type: 'object' }
            : { ...schema },
        degraded: false,
    };
}

export function selectOfficialTools(rawTools: unknown[], capabilities: unknown = []): OfficialMcpTool[] {
    // Metadata only enriches tools already exposed by /mcp. Never expose a
    // capability just because the agent registry knows it.
    const metadata = new Map<string, Record<string, unknown>>();
    for (const capability of Array.isArray(capabilities) ? capabilities : []) {
        if (isRecord(capability) && typeof capability.name === 'string') metadata.set(capability.name, capability);
    }
    const selected = new Map<string, OfficialMcpTool>();
    for (const rawTool of rawTools) {
        const parsed = OfficialToolSchema.safeParse(rawTool);
        if (!parsed.success) continue;
        const tool = parsed.data;
        const capability = metadata.get(tool.name);
        if (capability?.ownerId === 'siyuan-plugins-mcp-sisyphus') continue;
        const source = capability?.source ?? tool.source ?? (tool.name.startsWith('plugin__') ? 'plugin' : 'native');
        if (source !== 'plugin' && source !== 'native') continue;
        if (tool.name.startsWith(SELF_PLUGIN_TOOL_PREFIX)) continue;

        const normalizedInput = normalizeOfficialInputSchema(tool.inputSchema);
        selected.set(tool.name, {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: normalizedInput.schema,
            outputSchema: isRecord(tool.outputSchema) ? tool.outputSchema : undefined,
            source,
            readOnlyHint: (tool.annotations?.readOnlyHint ?? tool.readOnlyHint) === true,
            effectScope: tool.effectScope,
            schemaDegraded: normalizedInput.degraded,
        });
    }
    return [...selected.values()].sort((left, right) => left.name.localeCompare(right.name));
}
