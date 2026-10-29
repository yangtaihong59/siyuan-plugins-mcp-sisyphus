import type { SiYuanClient } from '../api/client';
import { isDangerousAction, TOOL_CATEGORIES, type ToolCategory, type ToolConfig } from '../core/config';
import type { PermissionManager } from '../core/permissions';
import type { ToolDescriptor, ToolResult } from '../core/tool-result';
import type { OfficialMcpRuntime, OfficialMcpDiscoverySnapshot } from '../core/official-mcp-bridge';
import { ACTION_SCHEMA_BRANCHES_KEY } from '@/tools/internal/shared';
import { PRECONDITION_FIELD, getPossibleActionSafetyPolicies } from '../core/write-safety-policy';
import { SHA256_V1_CREDENTIAL_PATTERN } from '../shared/sha256-v1';

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


export const GENERIC_TOOL_OUTPUT_SCHEMA = {
    type: 'object',
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

    // Session-wide guidance (user rules, /AGENTS.md memory, strict-write flow)
    // lives once in server instructions instead of being repeated per tool.
    return tools;
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

/** Detail of the preflight's write-impact preview; stripped before hashing and commit. */
const WRITE_PREVIEW_PROPERTY = {
    type: 'string',
    enum: ['summary', 'full'],
    description: 'Preflight preview detail; full = complete before/after text.',
} as const;

const REQUEST_ID_PATTERN = '^[a-f0-9]{4,64}$';
const BRANCH_REQUEST_ID_PROPERTY = {
    type: 'string',
    pattern: REQUEST_ID_PATTERN,
    description: 'Server-issued preflight ID; reuse unchanged.',
} as const;
const BRANCH_VALIDATE_ONLY_PROPERTY = { type: 'boolean', description: 'true: preflight only, no mutation.' } as const;
const BRANCH_HASH_PROPERTY = {
    type: 'string',
    pattern: SHA256_V1_CREDENTIAL_PATTERN,
    description: 'Preflight-issued hash; copy unchanged.',
} as const;
// expectedHash stays accepted as an alias of expectedStateHash in the
// per-action branches but is not advertised in the merged schema.
const BRANCH_EXPECTED_HASH_ALIAS = {
    type: 'string',
    pattern: SHA256_V1_CREDENTIAL_PATTERN,
    description: 'Alias of expectedStateHash.',
} as const;

function decorateStrictWriteSchema(category: ToolCategory, descriptor: ToolDescriptor): ToolDescriptor {
    const inputSchema = { ...descriptor.inputSchema } as Record<string, any>;
    const properties = { ...(inputSchema.properties ?? {}) };
    const actions: string[] = properties.action?.enum ?? [];
    const mutationActions = actions.filter(action => getPossibleActionSafetyPolicies(category, action).some(policy => policy.mode === 'mutation'));
    if (mutationActions.length === 0) return descriptor;
    const preconditions = new Set(mutationActions.flatMap(action => getPossibleActionSafetyPolicies(category, action))
        .flatMap(policy => policy.mode === 'mutation' && policy.precondition !== 'none' ? [policy.precondition] : []));
    // The mounted (merged) schema carries the bare field contracts only: the
    // server instructions explain the preflight/commit flow once per session
    // instead of repeating it on every tool (about 2k chars of the initial
    // payload). Per-action branches (help, CLI) keep the descriptions.
    properties.requestId = { type: 'string', pattern: REQUEST_ID_PATTERN };
    properties.validateOnly = { type: 'boolean' };
    // The optional write `preview` detail is deliberately not advertised in
    // the mounted schema (it would cost ~1.6k chars of the initial payload
    // budget). Tool schemas allow additional properties, the server
    // instructions mention it, and per-action branches (help, CLI) carry it.
    for (const precondition of preconditions) {
        properties[PRECONDITION_FIELD[precondition]] = { type: 'string', pattern: SHA256_V1_CREDENTIAL_PATTERN };
    }
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
                requestId: BRANCH_REQUEST_ID_PROPERTY,
                validateOnly: BRANCH_VALIDATE_ONLY_PROPERTY,
                preview: WRITE_PREVIEW_PROPERTY,
            };
            const preconditions = mutationPolicies
                .map((policy) => policy.mode === 'mutation' ? policy.precondition : 'none')
                .filter((precondition): precondition is keyof typeof PRECONDITION_FIELD => precondition !== 'none');
            if (preconditions.length > 0) {
                // 一个分支只有一张扁平 properties 表，所以保留条件写入
                // 可能需要的每一种前置条件字段。
                for (const precondition of new Set(preconditions)) {
                    const field = PRECONDITION_FIELD[precondition];
                    branchProperties[field] = BRANCH_HASH_PROPERTY;
                    if (field === 'expectedStateHash') branchProperties.expectedHash = BRANCH_EXPECTED_HASH_ALIAS;
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
        inputSchema,
    };
}
