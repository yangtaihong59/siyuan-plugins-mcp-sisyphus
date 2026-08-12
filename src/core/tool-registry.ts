import type { SiYuanClient } from '../api/client';
import { AGENT_MEMORY_VIRTUAL_PATH, isDangerousAction, TOOL_CATEGORIES, USER_RULES_VIRTUAL_PATH, type ToolCategory, type ToolConfig } from './config';
import type { PermissionManager } from './permissions';
import type { ToolResult } from '@/tools/internal/shared';
import type { OfficialMcpRuntime, OfficialMcpDiscoverySnapshot } from './official-mcp-bridge';
import { ACTION_SCHEMA_BRANCHES_KEY } from '@/tools/internal/shared';
import { PRECONDITION_FIELD, getPossibleActionSafetyPolicies } from './write-safety-policy';

import {
    callAvTool,
    callBlockTool,
    callDocumentTool,
    callExtensionTool,
    callFileTool,
    callFeedbackTool,
    callFlashcardTool,
    callFsTool,
    callMascotTool,
    callNotebookTool,
    callSearchTool,
    callSystemTool,
    callTagTool,
    callTimelineTool,
    listAvTools,
    listBlockTools,
    listDocumentTools,
    listExtensionTools,
    listFileTools,
    listFeedbackTools,
    listFlashcardTools,
    listFsTools,
    listMascotTools,
    listNotebookTools,
    listSearchTools,
    listSystemTools,
    listTagTools,
    listTimelineTools,
    prepareExtensionTools,
} from '@/tools/index';


/**
 * Minimal tool descriptor as consumed by the MCP ListTools response.
 * The per-category list helpers emit these objects directly.
 */
export interface ToolDescriptor {
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
    annotations?: {
        title?: string;
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
}

export const GENERIC_TOOL_OUTPUT_SCHEMA = {
    type: 'object',
    description: 'JSON object corresponding to the tool result. Non-object values are wrapped under value.',
    additionalProperties: true,
} as const;

const TOOL_TITLES: Record<ToolCategory, string> = {
    fs: 'SiYuan Filesystem',
    notebook: 'SiYuan Notebooks',
    document: 'SiYuan Documents',
    block: 'SiYuan Blocks',
    av: 'SiYuan Databases',
    file: 'SiYuan Assets and Exports',
    feedback: 'Sisyphus Feedback',
    search: 'SiYuan Search',
    tag: 'SiYuan Tags',
    timeline: 'SiYuan History',
    system: 'SiYuan System',
    flashcard: 'SiYuan Flashcards',
    extension: 'SiYuan Extension Tools',
    mascot: 'Sisyphus Mascot',
};

/**
 * A single registry entry. Each tool module is erased to the generic config
 * type so iteration across categories works without conditional types.
 * The per-category functions still carry their own precise signatures — this
 * interface only describes what the registry consumer needs.
 */
export interface ToolModule {
    category: ToolCategory;
    prepare?(
        config: ToolConfig[ToolCategory],
        runtime?: OfficialMcpRuntime,
    ): Promise<OfficialMcpDiscoverySnapshot | undefined>;
    listTools(config: ToolConfig[ToolCategory], runtime?: OfficialMcpRuntime): ToolDescriptor[];
    callTool(
        client: SiYuanClient,
        args: Record<string, unknown> | undefined,
        config: ToolConfig[ToolCategory],
        permMgr: PermissionManager,
        runtime?: OfficialMcpRuntime,
    ): Promise<ToolResult>;
}

// The cast at each entry is a controlled widening from the precise per-category
// config type to the erased union. It is safe because we look up by category
// at runtime and always pass the matching config slice back in.
export const TOOL_REGISTRY: Record<ToolCategory, ToolModule> = {
    fs: { category: 'fs', listTools: listFsTools as ToolModule['listTools'], callTool: callFsTool as ToolModule['callTool'] },
    notebook: { category: 'notebook', listTools: listNotebookTools as ToolModule['listTools'], callTool: callNotebookTool as ToolModule['callTool'] },
    document: { category: 'document', listTools: listDocumentTools as ToolModule['listTools'], callTool: callDocumentTool as ToolModule['callTool'] },
    block: { category: 'block', listTools: listBlockTools as ToolModule['listTools'], callTool: callBlockTool as ToolModule['callTool'] },
    av: { category: 'av', listTools: listAvTools as ToolModule['listTools'], callTool: callAvTool as ToolModule['callTool'] },
    file: { category: 'file', listTools: listFileTools as ToolModule['listTools'], callTool: callFileTool as ToolModule['callTool'] },
    feedback: { category: 'feedback', listTools: listFeedbackTools as ToolModule['listTools'], callTool: callFeedbackTool as ToolModule['callTool'] },
    search: { category: 'search', listTools: listSearchTools as ToolModule['listTools'], callTool: callSearchTool as ToolModule['callTool'] },
    tag: { category: 'tag', listTools: listTagTools as ToolModule['listTools'], callTool: callTagTool as ToolModule['callTool'] },
    timeline: { category: 'timeline', listTools: listTimelineTools as ToolModule['listTools'], callTool: callTimelineTool as ToolModule['callTool'] },
    system: { category: 'system', listTools: listSystemTools as ToolModule['listTools'], callTool: callSystemTool as ToolModule['callTool'] },
    flashcard: { category: 'flashcard', listTools: listFlashcardTools as ToolModule['listTools'], callTool: callFlashcardTool as ToolModule['callTool'] },
    extension: {
        category: 'extension',
        prepare: prepareExtensionTools as ToolModule['prepare'],
        listTools: listExtensionTools as ToolModule['listTools'],
        callTool: callExtensionTool as ToolModule['callTool'],
    },
    mascot: { category: 'mascot', listTools: listMascotTools as ToolModule['listTools'], callTool: callMascotTool as ToolModule['callTool'] },
};

export const USER_RULES_TOOL_DESCRIPTION_REMINDER = `Active user custom rules apply. Read fs(action="read", path="${USER_RULES_VIRTUAL_PATH}") or siyuan://help/user-rules before choosing actions.`;
export const AGENT_MEMORY_TOOL_DESCRIPTION_REMINDER = `For SiYuan workspace-aware tasks, first read the virtual memory file with fs(action="read", path="${AGENT_MEMORY_VIRTUAL_PATH}").`;

export function resolveCategory(name: string): ToolCategory | null {
    return TOOL_CATEGORIES.includes(name as ToolCategory) ? (name as ToolCategory) : null;
}

export async function prepareTool(
    category: ToolCategory,
    config: ToolConfig,
    runtime?: OfficialMcpRuntime,
): Promise<OfficialMcpDiscoverySnapshot | undefined> {
    return TOOL_REGISTRY[category].prepare?.(config[category], runtime);
}

export async function prepareAllTools(
    config: ToolConfig,
    runtime?: OfficialMcpRuntime,
): Promise<void> {
    await Promise.all(
        TOOL_CATEGORIES.map((category) => prepareTool(category, config, runtime)),
    );
}

export function listAllTools(config: ToolConfig, runtime?: OfficialMcpRuntime): ToolDescriptor[] {
    const tools = TOOL_CATEGORIES.flatMap((cat) => {
        const enabledDangerousAction = Object.entries(config[cat].actions)
            .some(([action, enabled]) => enabled && isDangerousAction(cat, action));
        return listConfiguredToolsForCategory(cat, config, runtime).map((tool) => ({
            ...tool,
            title: tool.title ?? TOOL_TITLES[cat],
            outputSchema: tool.outputSchema ?? { ...GENERIC_TOOL_OUTPUT_SCHEMA },
            annotations: tool.annotations ?? {
                title: tool.title ?? TOOL_TITLES[cat],
                // Aggregated tools generally mix reads and writes. False is
                // deliberately conservative; action-level semantics remain
                // documented in the discriminated input schema and help.
                readOnlyHint: false,
                destructiveHint: enabledDangerousAction,
                idempotentHint: false,
                openWorldHint: true,
            },
        }));
    });

    return tools.map((tool) => ({
        ...tool,
        description: [
            tool.description,
            AGENT_MEMORY_TOOL_DESCRIPTION_REMINDER,
            config.userRulesText.trim() ? USER_RULES_TOOL_DESCRIPTION_REMINDER : '',
        ].filter(Boolean).join('\n\n'),
    }));
}

export function listConfiguredToolsForCategory(
    category: ToolCategory,
    config: ToolConfig,
    runtime?: OfficialMcpRuntime,
): ToolDescriptor[] {
    const descriptors = TOOL_REGISTRY[category].listTools(config[category], runtime);
    if (!config.writeSafety.strictMode) return descriptors;
    return descriptors.map((descriptor) => decorateStrictWriteSchema(category, descriptor));
}

function decorateStrictWriteSchema(category: ToolCategory, descriptor: ToolDescriptor): ToolDescriptor {
    const inputSchema = { ...descriptor.inputSchema } as Record<string, any>;
    const properties = { ...(inputSchema.properties ?? {}) };
    properties.requestId = {
        type: 'string',
        pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
        description: 'Fresh UUIDv7. Required when executing any strict write; omit for validateOnly preflight.',
    };
    properties.validateOnly = {
        type: 'boolean',
        description: 'Preflight only. Returns a temporary in-memory hash credential and never executes the write.',
    };
    for (const field of Object.values(PRECONDITION_FIELD)) {
        properties[field] = {
            type: 'string',
            pattern: '^(?:sha256:v1:)?[a-fA-F0-9]{4,64}$',
            description: 'Temporary preflight credential (4-64 hex characters, optionally sha256:v1: prefixed). It must resolve to an active lease for this exact mutation scope.',
        };
    }
    properties.expectedHash = {
        type: 'string',
        pattern: '^(?:sha256:v1:)?[a-fA-F0-9]{4,64}$',
        description: 'Alias of expectedStateHash for content-oriented strict writes.',
    };
    inputSchema.properties = properties;

    const originalBranches = descriptor.inputSchema[ACTION_SCHEMA_BRANCHES_KEY] as Array<Record<string, any>> | undefined;
    if (originalBranches) {
        const branches = originalBranches.map((branch) => {
            const action = branch?.properties?.action?.const;
            if (typeof action !== 'string' || action === 'help') return branch;
            // 某些 action 是否写入取决于参数（例如 createIfNotExist 或
            // overwrite=true）。普通分支无法表达这个条件，因此必须把所有
            // 可能写入路径需要的严格字段都放进分支；否则客户端拿到的合法
            // 分支无法携带协调器运行时要求的 requestId/哈希凭据。
            const policies = getPossibleActionSafetyPolicies(category, action);
            const mutationPolicies = policies.filter((policy) => policy.mode === 'mutation');
            if (mutationPolicies.length === 0) return branch;
            const branchProperties = {
                ...(branch.properties ?? {}),
                requestId: properties.requestId,
                validateOnly: properties.validateOnly,
            };
            const preconditions = mutationPolicies
                .map((policy) => policy.mode === 'mutation' ? policy.precondition : 'none')
                .filter((precondition): precondition is keyof typeof PRECONDITION_FIELD => precondition !== 'none');
            if (preconditions.length > 0) {
                // 一个分支只有一张扁平 properties 表，所以保留条件写入
                // 可能需要的每一种前置条件字段。
                for (const precondition of new Set(preconditions)) {
                    const field = PRECONDITION_FIELD[precondition];
                    branchProperties[field] = properties[field];
                    if (field === 'expectedStateHash') branchProperties.expectedHash = properties.expectedHash;
                }
            }
            return { ...branch, properties: branchProperties };
        });
        Object.defineProperty(inputSchema, ACTION_SCHEMA_BRANCHES_KEY, {
            value: branches,
            enumerable: false,
        });
    }

    return {
        ...descriptor,
        description: `${descriptor.description ?? ''}\n\nStrict safe writes are enabled. Run a mutation with validateOnly=true to obtain a temporary in-memory hash credential, then execute with a fresh requestId and that credential before its lease expires.`,
        inputSchema,
    };
}
