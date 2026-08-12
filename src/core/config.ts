import type { SiYuanClient } from '../api/client';

export const TOOL_CATEGORIES = ['fs', 'notebook', 'document', 'block', 'av', 'file', 'search', 'tag', 'timeline', 'system', 'flashcard', 'extension', 'mascot', 'feedback'] as const;

export type ToolCategory = typeof TOOL_CATEGORIES[number];

export const FS_ACTIONS = ['ls', 'tree', 'read', 'write', 'replace', 'rm', 'mv', 'search'] as const;
export const NOTEBOOK_ACTIONS = ['list', 'create', 'set_open_state', 'remove', 'rename', 'get_conf', 'set_conf', 'set_icon', 'get_permissions', 'set_permission', 'get_child_docs'] as const;
export const DOCUMENT_ACTIONS = ['create', 'lookup', 'rename', 'remove', 'move', 'get_child_blocks', 'get_child_docs', 'set_attr', 'list_tree', 'search_docs', 'get_doc', 'get_outline', 'create_daily_note', 'duplicate', 'heading_to_doc', 'doc_to_heading'] as const;
export const BLOCK_ACTIONS = ['insert', 'prepend', 'append', 'update', 'replace', 'delete', 'move', 'set_fold_state', 'get_kramdown', 'batch_kramdown', 'get_children', 'transfer_references', 'set_attrs', 'get_attrs', 'info', 'breadcrumb', 'dom', 'recent_updated', 'word_count', 'add_to_daily_note', 'docs_info'] as const;
export const AV_ACTIONS = ['get', 'render', 'get_attribute_view_keys', 'get_attribute_view_filter_sort', 'search', 'add_rows', 'remove_rows', 'add_column', 'remove_column', 'set_cells', 'set_column_options', 'duplicate_rows', 'duplicate', 'get_primary_key_values'] as const;
export const FILE_ACTIONS = ['upload_asset', 'list_templates', 'read_template', 'create_template', 'update_template', 'delete_template', 'save_doc_as_template', 'render', 'export_md', 'export_resources', 'list_unused_assets', 'get_doc_assets', 'get_image_ocr_text', 'remove_unused_assets', 'rename_asset', 'delete_asset', 'extract_doc'] as const;
export const SEARCH_ACTIONS = ['fulltext', 'query_sql', 'get_backlinks', 'search_refs', 'find_replace', 'search_assets', 'fulltext_asset_content', 'list_invalid_refs'] as const;
export const TAG_ACTIONS = ['list', 'rename', 'remove'] as const;
export const TIMELINE_ACTIONS = ['list_nodes', 'create_node', 'compare_node', 'delete_node', 'rollback_document', 'rollback_block'] as const;
export const TIMELINE_APP_ACTIONS = TIMELINE_ACTIONS;
export const FLASHCARD_REVIEW_APP_ACTIONS = ['review_card'] as const;
export const MASCOT_SHOP_APP_ACTIONS = ['get_balance', 'shop', 'buy'] as const;
export const SYSTEM_ACTIONS = ['workspace_info', 'network', 'conf', 'notify', 'changelog', 'perform_sync', 'get_version', 'get_current_time'] as const;
export const FLASHCARD_ACTIONS = ['list_cards', 'get_decks', 'get_cards', 'review_card', 'create_card', 'remove_card'] as const;
export const EXTENSION_ACTIONS = ['list'] as const;
export const MASCOT_ACTIONS = ['get_balance', 'shop', 'buy'] as const;
export const FEEDBACK_ACTIONS = ['submit'] as const;

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

export type ActionTier = 'basic' | 'advanced';

const ACTION_TIERS: Record<ToolCategory, Record<string, ActionTier>> = {
    fs: {
        ls: 'basic', tree: 'basic', read: 'basic', write: 'basic', replace: 'basic',
        search: 'basic',
        rm: 'advanced', mv: 'advanced',
    },
    notebook: {
        list: 'basic', create: 'basic', set_open_state: 'basic',
        rename: 'basic', get_conf: 'basic', get_child_docs: 'basic',
        remove: 'advanced', set_conf: 'advanced', set_icon: 'advanced',
        get_permissions: 'advanced', set_permission: 'advanced',
    },
    document: {
        create: 'basic', lookup: 'basic', get_doc: 'basic', get_outline: 'basic',
        get_child_blocks: 'basic', get_child_docs: 'basic',
        search_docs: 'basic', rename: 'basic',
        remove: 'advanced', move: 'advanced', set_attr: 'advanced',
        list_tree: 'advanced', create_daily_note: 'advanced', duplicate: 'advanced',
        heading_to_doc: 'advanced', doc_to_heading: 'advanced',
    },
    block: {
        get_kramdown: 'basic', batch_kramdown: 'basic', get_children: 'basic', get_attrs: 'basic',
        info: 'basic', append: 'basic', prepend: 'basic',
        insert: 'basic', update: 'basic', replace: 'basic',
        delete: 'advanced', move: 'advanced', set_fold_state: 'advanced',
        transfer_references: 'advanced', set_attrs: 'advanced', breadcrumb: 'advanced',
        dom: 'advanced', recent_updated: 'advanced', word_count: 'advanced',
        add_to_daily_note: 'advanced', docs_info: 'advanced',
    },
    av: {
        get: 'basic', render: 'basic',
        get_attribute_view_keys: 'basic', get_attribute_view_filter_sort: 'basic',
        search: 'basic', get_primary_key_values: 'basic',
        add_rows: 'advanced', remove_rows: 'advanced', add_column: 'advanced',
        remove_column: 'advanced', set_cells: 'advanced', set_column_options: 'advanced',
        duplicate_rows: 'advanced',
        duplicate: 'advanced',
    },
    file: {
        export_md: 'basic', upload_asset: 'basic',
        list_templates: 'basic', read_template: 'basic',
        create_template: 'basic', update_template: 'basic', save_doc_as_template: 'basic',
        get_doc_assets: 'basic', extract_doc: 'basic',
        render: 'advanced',
        delete_template: 'advanced',
        export_resources: 'advanced', list_unused_assets: 'advanced',
        get_image_ocr_text: 'advanced',
        remove_unused_assets: 'advanced', rename_asset: 'advanced',
        delete_asset: 'advanced',
    },
    search: {
        fulltext: 'basic', query_sql: 'basic',
        get_backlinks: 'basic',
        search_refs: 'advanced', find_replace: 'advanced', search_assets: 'advanced',
        fulltext_asset_content: 'advanced', list_invalid_refs: 'advanced',
    },
    tag: {
        list: 'basic', rename: 'basic',
        remove: 'advanced',
    },
    timeline: {
        list_nodes: 'basic', create_node: 'basic', compare_node: 'basic',
        delete_node: 'advanced', rollback_document: 'advanced', rollback_block: 'advanced',
    },
    system: {
        get_version: 'basic', get_current_time: 'basic', conf: 'basic', changelog: 'basic',
        workspace_info: 'advanced', network: 'advanced', notify: 'advanced', perform_sync: 'advanced',
    },
    flashcard: {
        list_cards: 'basic', get_decks: 'basic', get_cards: 'basic',
        review_card: 'advanced', create_card: 'advanced', remove_card: 'advanced',
    },
    extension: {
        list: 'basic',
    },
    mascot: {
        get_balance: 'basic', shop: 'basic', buy: 'basic',
    },
    feedback: {
        submit: 'basic',
    },
};

export function getActionTier(category: ToolCategory, action: string): ActionTier {
    return ACTION_TIERS[category]?.[action] ?? 'advanced';
}

export const DANGEROUS_ACTIONS: Record<ToolCategory, Set<string>> = {
    fs: new Set(['rm', 'mv']),
    notebook: new Set(['remove', 'set_permission']),
    document: new Set(['remove', 'move']),
    block: new Set(['delete', 'move']),
    av: new Set(['set_column_options', 'duplicate_rows']),
    file: new Set(['upload_asset', 'delete_template', 'remove_unused_assets', 'delete_asset']),
    search: new Set(['find_replace']),
    tag: new Set(['remove']),
    timeline: new Set(['delete_node', 'rollback_document', 'rollback_block']),
    system: new Set(['workspace_info', 'perform_sync']),
    flashcard: new Set(['remove_card']),
    extension: new Set(),
    mascot: new Set(),
    feedback: new Set(),
};

const createActionsRecord = <Action extends string>(
    actions: readonly Action[],
    enabledByDefault: readonly Action[],
): Record<Action, boolean> => {
    const enabledSet = new Set(enabledByDefault);
    return actions.reduce((acc, action) => {
        acc[action] = enabledSet.has(action);
        return acc;
    }, {} as Record<Action, boolean>);
};

export function buildDefaultToolConfig(): ToolConfig {
    return {
        fs: {
            enabled: true,
            actions: createActionsRecord(FS_ACTIONS, ['ls', 'tree', 'read', 'write', 'replace', 'rm', 'mv', 'search']),
        },
        notebook: {
            enabled: true,
            actions: createActionsRecord(NOTEBOOK_ACTIONS, ['list', 'create', 'set_open_state', 'rename', 'get_conf', 'set_conf', 'set_icon', 'get_permissions', 'get_child_docs']),
        },
        document: {
            enabled: true,
            actions: createActionsRecord(DOCUMENT_ACTIONS, ['create', 'lookup', 'rename', 'move', 'get_child_blocks', 'get_child_docs', 'set_attr', 'list_tree', 'search_docs', 'get_doc', 'get_outline', 'create_daily_note', 'duplicate', 'heading_to_doc', 'doc_to_heading']),
        },
        block: {
            enabled: true,
            actions: createActionsRecord(BLOCK_ACTIONS, ['insert', 'prepend', 'append', 'update', 'replace', 'move', 'set_fold_state', 'get_kramdown', 'batch_kramdown', 'get_children', 'transfer_references', 'set_attrs', 'get_attrs', 'info', 'breadcrumb', 'dom', 'recent_updated', 'word_count', 'add_to_daily_note', 'docs_info']),
        },
        av: {
            enabled: true,
            actions: createActionsRecord(AV_ACTIONS, ['get', 'render', 'get_attribute_view_keys', 'get_attribute_view_filter_sort', 'search', 'add_rows', 'remove_rows', 'add_column', 'remove_column', 'set_cells', 'set_column_options', 'duplicate_rows', 'duplicate', 'get_primary_key_values']),
        },
        file: {
            enabled: true,
            actions: createActionsRecord(FILE_ACTIONS, ['upload_asset', 'list_templates', 'read_template', 'create_template', 'update_template', 'save_doc_as_template', 'render', 'export_md', 'export_resources', 'list_unused_assets', 'get_doc_assets', 'get_image_ocr_text', 'remove_unused_assets', 'rename_asset', 'delete_asset', 'extract_doc']),
            uploadLargeFileThresholdMB: 10,
        },
        search: {
            enabled: true,
            actions: createActionsRecord(SEARCH_ACTIONS, ['fulltext', 'query_sql', 'get_backlinks', 'search_refs', 'find_replace', 'search_assets', 'fulltext_asset_content', 'list_invalid_refs']),
        },
        tag: {
            enabled: true,
            actions: createActionsRecord(TAG_ACTIONS, ['list', 'rename', 'remove']),
        },
        timeline: {
            enabled: true,
            actions: createActionsRecord(TIMELINE_ACTIONS, ['list_nodes', 'create_node', 'compare_node']),
        },
        system: {
            enabled: true,
            actions: createActionsRecord(SYSTEM_ACTIONS, ['network', 'conf', 'notify', 'changelog', 'perform_sync', 'get_version', 'get_current_time']),
        },
        flashcard: {
            enabled: true,
            actions: createActionsRecord(FLASHCARD_ACTIONS, ['list_cards', 'get_decks', 'get_cards', 'review_card', 'create_card', 'remove_card']),
        },
        extension: {
            enabled: true,
            actions: createActionsRecord(EXTENSION_ACTIONS, ['list']),
            includeNativeTools: false,
            blockedTools: [],
        },
        mascot: {
            enabled: true,
            actions: createActionsRecord(MASCOT_ACTIONS, ['get_balance', 'shop', 'buy']),
        },
        feedback: {
            enabled: true,
            actions: createActionsRecord(FEEDBACK_ACTIONS, ['submit']),
        },
        mcpApps: {
            timeline: {
                enabled: true,
                actions: createActionsRecord(TIMELINE_APP_ACTIONS, TIMELINE_APP_ACTIONS),
            },
            flashcardReview: {
                enabled: true,
                actions: createActionsRecord(FLASHCARD_REVIEW_APP_ACTIONS, FLASHCARD_REVIEW_APP_ACTIONS),
            },
            mascotShop: {
                enabled: true,
                actions: createActionsRecord(MASCOT_SHOP_APP_ACTIONS, MASCOT_SHOP_APP_ACTIONS),
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

export function normalizeToolConfig(raw: unknown): ToolConfig {
    const config = buildDefaultToolConfig();
    if (!isRecord(raw)) return config;

    applyNestedConfig(config, raw);

    for (const category of TOOL_CATEGORIES) {
        if (!config[category].enabled) continue;
        if (getEnabledActions(config[category]).length === 0) {
            config[category].enabled = false;
        }
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
        return {
            config: buildDefaultToolConfig(),
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
