import type { SiYuanClient } from '../api/client';
import { actionNames, type ActionSpec, type ActionTier } from './action-spec';
import { FS_ACTION_SPECS } from '../tools/fs/actions';
import { NOTEBOOK_ACTION_SPECS } from '../tools/notebook/actions';
import { DOCUMENT_ACTION_SPECS } from '../tools/document/actions';
import { BLOCK_ACTION_SPECS } from '../tools/block/actions';
import { AV_ACTION_SPECS } from '../tools/av/actions';
import { FILE_ACTION_SPECS } from '../tools/file/actions';
import { SEARCH_ACTION_SPECS } from '../tools/search/actions';
import { TAG_ACTION_SPECS } from '../tools/tag/actions';
import { TIMELINE_ACTION_SPECS } from '../tools/timeline/actions';
import { SYSTEM_ACTION_SPECS } from '../tools/system/actions';
import { FLASHCARD_ACTION_SPECS } from '../tools/flashcard/actions';
import { EXTENSION_ACTION_SPECS } from '../tools/extension/actions';
import { MASCOT_ACTION_SPECS } from '../tools/mascot/actions';
import { FEEDBACK_ACTION_SPECS } from '../tools/feedback/actions';


export const TOOL_CATEGORIES = ['fs', 'notebook', 'document', 'block', 'av', 'file', 'search', 'tag', 'timeline', 'system', 'flashcard', 'extension', 'mascot', 'feedback'] as const;

export type ToolCategory = typeof TOOL_CATEGORIES[number];

export const FS_ACTIONS = actionNames(FS_ACTION_SPECS);
export const NOTEBOOK_ACTIONS = actionNames(NOTEBOOK_ACTION_SPECS);
export const DOCUMENT_ACTIONS = actionNames(DOCUMENT_ACTION_SPECS);
export const BLOCK_ACTIONS = actionNames(BLOCK_ACTION_SPECS);
export const AV_ACTIONS = actionNames(AV_ACTION_SPECS);
export const FILE_ACTIONS = actionNames(FILE_ACTION_SPECS);
export const SEARCH_ACTIONS = actionNames(SEARCH_ACTION_SPECS);
export const TAG_ACTIONS = actionNames(TAG_ACTION_SPECS);
export const TIMELINE_ACTIONS = actionNames(TIMELINE_ACTION_SPECS);
export const TIMELINE_APP_ACTIONS = TIMELINE_ACTIONS;
export const FLASHCARD_REVIEW_APP_ACTIONS = ['review_card'] as const;
export const MASCOT_SHOP_APP_ACTIONS = ['get_balance', 'shop', 'buy'] as const;
export const SYSTEM_ACTIONS = actionNames(SYSTEM_ACTION_SPECS);
export const FLASHCARD_ACTIONS = actionNames(FLASHCARD_ACTION_SPECS);
export const EXTENSION_ACTIONS = actionNames(EXTENSION_ACTION_SPECS);
export const MASCOT_ACTIONS = actionNames(MASCOT_ACTION_SPECS);
export const FEEDBACK_ACTIONS = actionNames(FEEDBACK_ACTION_SPECS);

export type FsAction = typeof FS_ACTIONS[number];
export type NotebookAction = typeof NOTEBOOK_ACTIONS[number];
export type DocumentAction = typeof DOCUMENT_ACTIONS[number];
export type BlockAction = typeof BLOCK_ACTIONS[number];
export type AvAction = typeof AV_ACTIONS[number];
export type FileAction = typeof FILE_ACTIONS[number];
export type SearchAction = typeof SEARCH_ACTIONS[number];
export type TagAction = typeof TAG_ACTIONS[number];
export type TimelineAction = typeof TIMELINE_ACTIONS[number];
export type TimelineAppAction = typeof TIMELINE_APP_ACTIONS[number];
export type FlashcardReviewAppAction = typeof FLASHCARD_REVIEW_APP_ACTIONS[number];
export type MascotShopAppAction = typeof MASCOT_SHOP_APP_ACTIONS[number];
export type SystemAction = typeof SYSTEM_ACTIONS[number];
export type FlashcardAction = typeof FLASHCARD_ACTIONS[number];
export type ExtensionAction = typeof EXTENSION_ACTIONS[number];
export type MascotAction = typeof MASCOT_ACTIONS[number];
export type FeedbackAction = typeof FEEDBACK_ACTIONS[number];

export type ToolActionMap = {
    fs: FsAction;
    notebook: NotebookAction;
    document: DocumentAction;
    block: BlockAction;
    av: AvAction;
    file: FileAction;
    search: SearchAction;
    tag: TagAction;
    timeline: TimelineAction;
    system: SystemAction;
    flashcard: FlashcardAction;
    extension: ExtensionAction;
    mascot: MascotAction;
    feedback: FeedbackAction;
};

export interface CategoryToolConfig<Action extends string = string> {
    enabled: boolean;
    actions: Partial<Record<Action, boolean>>;
}

export interface FileCategoryToolConfig<Action extends string = string> extends CategoryToolConfig<Action> {
    uploadLargeFileThresholdMB: number;
}

export interface ExtensionCategoryToolConfig extends CategoryToolConfig<ExtensionAction> {
    includeNativeTools: boolean;
    blockedTools: string[];
}

export type TimelineCategoryToolConfig = CategoryToolConfig<TimelineAction>;

export interface McpAppConfig<Action extends string> {
    enabled: boolean;
    actions: Record<Action, boolean>;
}

export interface McpAppsConfig {
    timeline: McpAppConfig<TimelineAppAction>;
    flashcardReview: McpAppConfig<FlashcardReviewAppAction>;
    mascotShop: McpAppConfig<MascotShopAppAction>;
}

export interface DebugToolConfig {
    includeUiRefreshMetadata: boolean;
    slimResponses: boolean;
}

export interface WriteSafetyConfig {
    /**
     * Enforce optimistic concurrency and idempotency for every Sisyphus-owned
     * mutation. This deliberately defaults to true when the field is absent
     * or the persisted configuration cannot be read.
     */
    strictMode: boolean;
}

export type ToolConfig = {
    avActionsVersion: 2;
    fs: CategoryToolConfig<FsAction>;
    notebook: CategoryToolConfig<NotebookAction>;
    document: CategoryToolConfig<DocumentAction>;
    block: CategoryToolConfig<BlockAction>;
    av: CategoryToolConfig<AvAction>;
    file: FileCategoryToolConfig<FileAction>;
    search: CategoryToolConfig<SearchAction>;
    tag: CategoryToolConfig<TagAction>;
    timeline: TimelineCategoryToolConfig;
    system: CategoryToolConfig<SystemAction>;
    flashcard: CategoryToolConfig<FlashcardAction>;
    extension: ExtensionCategoryToolConfig;
    mascot: CategoryToolConfig<MascotAction>;
    feedback: CategoryToolConfig<FeedbackAction>;
    mcpApps: McpAppsConfig;
    userRulesText: string;
    agentSiyuanMemoryText: string;
    agentSiyuanMemoryUpdatedAt: string;
    writeSafety: WriteSafetyConfig;
    debug: DebugToolConfig;
};

export interface ToolConfigLoadResult {
    config: ToolConfig;
    ok: boolean;
    source: 'api_file' | 'default_fallback';
    errorMessage?: string;
    rawLength?: number;
}

export const MCP_TOOLS_CONFIG_API_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig';
export const AGENT_MEMORY_VIRTUAL_PATH = '/AGENTS.md';
export const USER_RULES_VIRTUAL_PATH = '/USER_RULES.md';
export const AGENT_MEMORY_STALE_AFTER_DAYS = 7;
const EMITTED_TOOL_CONFIG_WARNINGS = new Set<string>();

export const ACTIONS_BY_CATEGORY: { [Category in ToolCategory]: readonly ToolActionMap[Category][] } = {
    fs: FS_ACTIONS,
    notebook: NOTEBOOK_ACTIONS,
    document: DOCUMENT_ACTIONS,
    block: BLOCK_ACTIONS,
    av: AV_ACTIONS,
    file: FILE_ACTIONS,
    search: SEARCH_ACTIONS,
    tag: TAG_ACTIONS,
    timeline: TIMELINE_ACTIONS,
    system: SYSTEM_ACTIONS,
    flashcard: FLASHCARD_ACTIONS,
    extension: EXTENSION_ACTIONS,
    mascot: MASCOT_ACTIONS,
    feedback: FEEDBACK_ACTIONS,
};

export type { ActionTier };

/** Per-tool action declarations (src/tools/<tool>/actions.ts), the single source for action metadata. */
export const ACTION_SPECS_BY_CATEGORY: { [Category in ToolCategory]: Record<ToolActionMap[Category], ActionSpec> } = {
    fs: FS_ACTION_SPECS,
    notebook: NOTEBOOK_ACTION_SPECS,
    document: DOCUMENT_ACTION_SPECS,
    block: BLOCK_ACTION_SPECS,
    av: AV_ACTION_SPECS,
    file: FILE_ACTION_SPECS,
    search: SEARCH_ACTION_SPECS,
    tag: TAG_ACTION_SPECS,
    timeline: TIMELINE_ACTION_SPECS,
    system: SYSTEM_ACTION_SPECS,
    flashcard: FLASHCARD_ACTION_SPECS,
    extension: EXTENSION_ACTION_SPECS,
    mascot: MASCOT_ACTION_SPECS,
    feedback: FEEDBACK_ACTION_SPECS,
};

const specOf = (category: ToolCategory, action: string): ActionSpec | undefined =>
    (ACTION_SPECS_BY_CATEGORY[category] as Record<string, ActionSpec>)?.[action];

export function getActionTier(category: ToolCategory, action: string): ActionTier {
    return specOf(category, action)?.tier ?? 'advanced';
}

export const DANGEROUS_ACTIONS: Record<ToolCategory, Set<string>> = Object.fromEntries(
    TOOL_CATEGORIES.map((category) => [category, new Set(
        Object.entries(ACTION_SPECS_BY_CATEGORY[category] as Record<string, ActionSpec>)
            .filter(([, spec]) => spec.dangerous === true)
            .map(([action]) => action),
    )]),
) as Record<ToolCategory, Set<string>>;

const allEnabled = <Action extends string>(actions: readonly Action[]): Record<Action, boolean> =>
    Object.fromEntries(actions.map((action) => [action, true])) as Record<Action, boolean>;

const defaultActionsRecord = <Action extends string>(specs: Record<Action, ActionSpec>): Record<Action, boolean> =>
    Object.fromEntries(Object.entries(specs).map(([action, spec]) => [action, (spec as ActionSpec).defaultEnabled])) as Record<Action, boolean>;

export function buildDefaultToolConfig(): ToolConfig {
    return {
        avActionsVersion: 2,
        fs: {
            enabled: true,
            actions: defaultActionsRecord(FS_ACTION_SPECS),
        },
        notebook: {
            enabled: true,
            actions: defaultActionsRecord(NOTEBOOK_ACTION_SPECS),
        },
        document: {
            enabled: true,
            actions: defaultActionsRecord(DOCUMENT_ACTION_SPECS),
        },
        block: {
            enabled: true,
            actions: defaultActionsRecord(BLOCK_ACTION_SPECS),
        },
        av: {
            enabled: true,
            actions: defaultActionsRecord(AV_ACTION_SPECS),
        },
        file: {
            enabled: true,
            actions: defaultActionsRecord(FILE_ACTION_SPECS),
            uploadLargeFileThresholdMB: 10,
        },
        search: {
            enabled: true,
            actions: defaultActionsRecord(SEARCH_ACTION_SPECS),
        },
        tag: {
            enabled: true,
            actions: defaultActionsRecord(TAG_ACTION_SPECS),
        },
        timeline: {
            enabled: true,
            actions: defaultActionsRecord(TIMELINE_ACTION_SPECS),
        },
        system: {
            enabled: true,
            actions: defaultActionsRecord(SYSTEM_ACTION_SPECS),
        },
        flashcard: {
            enabled: true,
            actions: defaultActionsRecord(FLASHCARD_ACTION_SPECS),
        },
        extension: {
            enabled: true,
            actions: defaultActionsRecord(EXTENSION_ACTION_SPECS),
            includeNativeTools: false,
            blockedTools: [],
        },
        mascot: {
            enabled: true,
            actions: defaultActionsRecord(MASCOT_ACTION_SPECS),
        },
        feedback: {
            enabled: true,
            actions: defaultActionsRecord(FEEDBACK_ACTION_SPECS),
        },
        mcpApps: {
            timeline: {
                enabled: true,
                actions: allEnabled(TIMELINE_APP_ACTIONS),
            },
            flashcardReview: {
                enabled: true,
                actions: allEnabled(FLASHCARD_REVIEW_APP_ACTIONS),
            },
            mascotShop: {
                enabled: true,
                actions: allEnabled(MASCOT_SHOP_APP_ACTIONS),
            },
        },
        userRulesText: '创建文档/日记后主动设图标',
        agentSiyuanMemoryText: '',
        agentSiyuanMemoryUpdatedAt: '',
        writeSafety: {
            strictMode: true,
        },
        debug: {
            includeUiRefreshMetadata: false,
            slimResponses: true,
        },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectLegacyToolConfigSignals(raw: Record<string, unknown>): string[] {
    const signals: string[] = [];

    for (const category of TOOL_CATEGORIES) {
        const value = raw[category];
        if (typeof value === 'boolean') {
            signals.push(`${category}=<boolean>`);
            continue;
        }
        if (Array.isArray(value)) {
            signals.push(`${category}=[...]`);
        }
    }

    const flatActionKeys = Object.entries(raw)
        .filter(([key, value]) => !['userRulesText', 'agentSiyuanMemoryText', 'agentSiyuanMemoryUpdatedAt'].includes(key) && !TOOL_CATEGORIES.includes(key as ToolCategory) && typeof value === 'boolean')
        .map(([key]) => key);
    if (flatActionKeys.length > 0) {
        const preview = flatActionKeys.slice(0, 3).join(', ');
        signals.push(flatActionKeys.length > 3 ? `${preview}, ...` : preview);
    }

    return signals;
}

export function getLegacyToolConfigWarning(raw: unknown, source = 'mcpToolsConfig'): string | null {
    if (!isRecord(raw)) return null;

    const signals = collectLegacyToolConfigSignals(raw);
    if (signals.length === 0) return null;

    return [
        `[MCP] Detected legacy tool config format in ${source}.`,
        'Only nested { category: { enabled, actions } } config is supported now.',
        'Legacy keys are ignored and defaults may be used instead.',
        'Open MCP settings and save once to rewrite the config.',
        `Detected legacy fields: ${signals.join('; ')}`,
    ].join(' ');
}

export function emitToolConfigWarningOnce(
    warning: string | null | undefined,
    warn: (message: string) => void = (message) => console.warn(message),
): string | null {
    if (!warning) return null;
    if (EMITTED_TOOL_CONFIG_WARNINGS.has(warning)) return warning;
    EMITTED_TOOL_CONFIG_WARNINGS.add(warning);
    warn(warning);
    return warning;
}

export function warnLegacyToolConfigOnce(
    raw: unknown,
    options: {
        source?: string;
        warn?: (message: string) => void;
    } = {},
): string | null {
    const warning = getLegacyToolConfigWarning(raw, options.source);
    return emitToolConfigWarningOnce(warning, options.warn);
}

export function resetToolConfigWarningStateForTests(): void {
    EMITTED_TOOL_CONFIG_WARNINGS.clear();
}

function normalizeUploadLargeFileThresholdMB(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 10;
    const normalized = Math.floor(value);
    if (normalized < 1) return 1;
    if (normalized > 1024) return 1024;
    return normalized;
}

function applyNestedConfig(config: ToolConfig, raw: Record<string, unknown>) {
    if (typeof raw.userRulesText === 'string') {
        config.userRulesText = raw.userRulesText;
    }
    if (typeof raw.agentSiyuanMemoryText === 'string') {
        config.agentSiyuanMemoryText = raw.agentSiyuanMemoryText;
    }
    if (typeof raw.agentSiyuanMemoryUpdatedAt === 'string') {
        config.agentSiyuanMemoryUpdatedAt = raw.agentSiyuanMemoryUpdatedAt;
    }
    if (isRecord(raw.writeSafety) && typeof raw.writeSafety.strictMode === 'boolean') {
        config.writeSafety.strictMode = raw.writeSafety.strictMode;
    }
    if (isRecord(raw.debug)) {
        if (typeof raw.debug.includeUiRefreshMetadata === 'boolean') {
            config.debug.includeUiRefreshMetadata = raw.debug.includeUiRefreshMetadata;
        }
        if (typeof raw.debug.slimResponses === 'boolean') {
            config.debug.slimResponses = raw.debug.slimResponses;
        }
    }

    const appActionSets = {
        timeline: TIMELINE_APP_ACTIONS,
        flashcardReview: FLASHCARD_REVIEW_APP_ACTIONS,
        mascotShop: MASCOT_SHOP_APP_ACTIONS,
    } as const;
    if (isRecord(raw.mcpApps)) {
        for (const appName of Object.keys(appActionSets) as Array<keyof McpAppsConfig>) {
            const appValue = raw.mcpApps[appName];
            if (!isRecord(appValue)) continue;
            if (typeof appValue.enabled === 'boolean') config.mcpApps[appName].enabled = appValue.enabled;
            if (!isRecord(appValue.actions)) continue;
            for (const action of appActionSets[appName]) {
                const value = appValue.actions[action];
                if (typeof value === 'boolean') {
                    (config.mcpApps[appName].actions as Record<string, boolean>)[action] = value;
                }
            }
        }
    }

    for (const category of TOOL_CATEGORIES) {
        const categoryValue = raw[category];
        if (!isRecord(categoryValue)) continue;
        if (typeof categoryValue.enabled === 'boolean') {
            config[category].enabled = categoryValue.enabled;
        }
        if (category === 'file' && 'uploadLargeFileThresholdMB' in categoryValue) {
            config.file.uploadLargeFileThresholdMB = normalizeUploadLargeFileThresholdMB(categoryValue.uploadLargeFileThresholdMB);
        }
        if (category === 'extension') {
            if (typeof categoryValue.includeNativeTools === 'boolean') {
                config.extension.includeNativeTools = categoryValue.includeNativeTools;
            }
            if (Array.isArray(categoryValue.blockedTools)) {
                config.extension.blockedTools = Array.from(new Set(
                    categoryValue.blockedTools
                        .filter((name): name is string => typeof name === 'string')
                        .map((name) => name.trim())
                        .filter(Boolean),
                )).sort();
            }
        }
        // Migrate the short-lived timeline.appActions format into the dedicated
        // MCP Apps permission namespace without changing AI tool permissions.
        if (category === 'timeline' && !isRecord(raw.mcpApps) && isRecord(categoryValue.appActions)) {
            for (const action of TIMELINE_APP_ACTIONS) {
                const value = categoryValue.appActions[action];
                if (typeof value === 'boolean') {
                    config.mcpApps.timeline.actions[action] = value;
                }
            }
        }
        if (!isRecord(categoryValue.actions)) continue;
        for (const action of ACTIONS_BY_CATEGORY[category]) {
            const value = categoryValue.actions[action];
            if (typeof value === 'boolean') {
                config[category].actions[action] = value;
            }
        }
    }
}

/** Migrate explicit raw flags before defaults; get exists in both formats. */
export function normalizeToolConfig(raw: unknown): ToolConfig {
    if (isRecord(raw) && raw.avActionsVersion !== undefined && raw.avActionsVersion !== 1 && raw.avActionsVersion !== 2) {
        throw new Error(`Unsupported avActionsVersion: ${String(raw.avActionsVersion)}`);
    }
    let source = raw;
    if (isRecord(raw) && raw.avActionsVersion !== 2 && isRecord(raw.av)) {
        const old = isRecord(raw.av.actions) ? raw.av.actions : {};
        const actions = { ...old };
        const migration = {
            create: ['render'],
            get: ['get', 'get_attribute_view_keys', 'get_attribute_view_filter_sort'],
            query: ['render', 'get_primary_key_values'],
            update_view: ['set_filters', 'set_sorts', 'set_group', 'set_column_visibility', 'set_column_order'],
        };
        for (const [target, origins] of Object.entries(migration)) {
            delete actions[target];
            const explicit = origins.map(key => old[key]).filter(value => typeof value === 'boolean');
            if (explicit.length) actions[target] = !explicit.includes(false);
        }
        source = { ...raw, av: { ...raw.av, actions } };
    }
    const config = buildDefaultToolConfig();
    if (!isRecord(source)) return config;
    applyNestedConfig(config, source);
    for (const category of TOOL_CATEGORIES) {
        if (config[category].enabled && getEnabledActions(config[category]).length === 0) config[category].enabled = false;
    }
    return config;
}

export function getEnabledActions(categoryConfig: CategoryToolConfig<string>): string[] {
    return Object.entries(categoryConfig.actions)
        .filter(([, enabled]) => enabled)
        .map(([action]) => action);
}

function formatConfigLoadError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

export async function loadToolConfigFromApiFileWithStatus(client: SiYuanClient): Promise<ToolConfigLoadResult> {
    try {
        const content = await client.readFile(MCP_TOOLS_CONFIG_API_PATH);
        if (!content) {
            return {
                config: buildDefaultToolConfig(),
                ok: true,
                source: 'api_file',
                rawLength: 0,
            };
        }
        const raw = JSON.parse(content);
        warnLegacyToolConfigOnce(raw, { source: `SiYuan API file "${MCP_TOOLS_CONFIG_API_PATH}"` });
        return {
            config: normalizeToolConfig(raw),
            ok: true,
            source: 'api_file',
            rawLength: content.length,
        };
    } catch (error) {
        const config = buildDefaultToolConfig();
        if (formatConfigLoadError(error).includes('Unsupported avActionsVersion')) config.av.enabled = false;
        return {
            config,
            ok: false,
            source: 'default_fallback',
            errorMessage: formatConfigLoadError(error),
        };
    }
}

export async function loadToolConfigFromApiFile(client: SiYuanClient): Promise<ToolConfig> {
    return (await loadToolConfigFromApiFileWithStatus(client)).config;
}

export async function saveToolConfigToApiFile(client: SiYuanClient, config: ToolConfig): Promise<ToolConfig> {
    const normalized = normalizeToolConfig(config);
    await client.writeFile(MCP_TOOLS_CONFIG_API_PATH, JSON.stringify(normalized, null, 2));
    return normalized;
}

export async function readAgentSiyuanMemory(client: SiYuanClient): Promise<string> {
    return (await loadToolConfigFromApiFile(client)).agentSiyuanMemoryText ?? '';
}

export async function writeAgentSiyuanMemory(client: SiYuanClient, text: string): Promise<ToolConfig> {
    const config = await loadToolConfigFromApiFile(client);
    return saveToolConfigToApiFile(client, {
        ...config,
        agentSiyuanMemoryText: text,
        agentSiyuanMemoryUpdatedAt: text.trim() ? new Date().toISOString() : '',
    });
}

export function isDangerousAction(category: ToolCategory, action: string): boolean {
    return DANGEROUS_ACTIONS[category].has(action);
}

export function formatDangerousActionsList(): string[] {
    const lines: string[] = [];
    for (const category of TOOL_CATEGORIES) {
        const actions = DANGEROUS_ACTIONS[category];
        if (actions.size === 0) continue;
        const items = [...actions].map(a => `\`${category}(action="${a}")\``);
        lines.push(`- ${items.join(', ')}`);
    }
    return lines;
}
