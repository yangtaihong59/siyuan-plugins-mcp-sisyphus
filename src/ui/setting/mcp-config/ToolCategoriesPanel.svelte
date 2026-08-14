<script lang="ts">
    import SettingPanel from "../../shared/setting-panel.svelte";
    import {
        ACTIONS_BY_CATEGORY,
        TOOL_CATEGORIES,
        buildDefaultToolConfig,
        isDangerousAction,
        type AvAction,
        type BlockAction,
        type DocumentAction,
        type ExtensionAction,
        type FeedbackAction,
        type FileAction,
        type FlashcardAction,
        type FsAction,
        type MascotAction,
        type NotebookAction,
        type SearchAction,
        type SystemAction,
        type TagAction,
        type TimelineAction,
        type ToolCategory,
        type ToolConfig,
    } from "../tool-config";
    import { CATEGORY_TAB_DEFS, ICON_SVGS } from "../mcp-config-tabs";
    import type { UiOfficialMcpDiscovery } from "../official-plugin-tools";

    export let group: string;
    export let display = false;
    export let config: ToolConfig;
    export let getLabel: (key: string, fallback: string) => string;
    export let onChanged: (event: CustomEvent<ChangeEvent>) => void | Promise<void>;
    export let extensionDiscovery: UiOfficialMcpDiscovery = {
        loading: false,
        connected: false,
        tools: [],
    };
    export let onRefreshExtensionTools: () => void | Promise<void> = () => {};

    interface ChangeEvent { key: string; value: any; }
    type GroupAction = FsAction | NotebookAction | DocumentAction | BlockAction | AvAction | FileAction | SearchAction | TagAction | TimelineAction | SystemAction | FlashcardAction | ExtensionAction | MascotAction | FeedbackAction;
    const RESERVED_EXTENSION_ACTIONS = new Set(["help", "list"]);

    interface GroupDefinition {
        category: ToolCategory;
        icon: string;
        groupKey: string;
        iconSvg: string;
        actions: Array<{
            key: GroupAction;
            title: string;
            description: string;
        }>;
    }

    const ACTION_METADATA: GroupDefinition[] = [
        {
            category: "fs",
            icon: "📂",
            groupKey: "Filesystem",
            iconSvg: ICON_SVGS.folder,
            actions: [
                { key: "ls", title: "List Path", description: "List direct child documents with compact human-readable paths." },
                { key: "tree", title: "Document Tree", description: "List a recursive document tree using human-readable paths." },
                { key: "read", title: "Read Markdown", description: "Read a document as plain Markdown by human-readable path." },
                { key: "write", title: "Write Markdown", description: "Create a document or replace an existing document body with overwrite=true." },
                { key: "replace", title: "Replace Text", description: "Apply exact old/new text replacement edits inside one Markdown document." },
                { key: "rm", title: "Remove Document", description: "Delete a document by human-readable path." },
                { key: "mv", title: "Move Document", description: "Move or rename a document by human-readable paths." },
                { key: "reorder", title: "Reorder Documents", description: "Apply a complete manual order to all visible direct child documents." },
                { key: "search", title: "Search Path", description: "Search Markdown lines under a human-readable path." },
            ],
        },
        {
            category: "notebook",
            icon: "📚",
            groupKey: "Notebooks",
            iconSvg: ICON_SVGS.book,
            actions: [
                { key: "list", title: "List Notebooks", description: "List all notebooks in the workspace." },
                { key: "create", title: "Create Notebook", description: "Create a new notebook." },
                { key: "set_open_state", title: "Open/Close Notebook", description: "Set notebook open state (open or close)." },
                { key: "remove", title: "Remove Notebook", description: "Remove a notebook." },
                { key: "rename", title: "Rename Notebook", description: "Rename a notebook." },
                { key: "get_conf", title: "Get Notebook Config", description: "Get notebook configuration." },
                { key: "set_conf", title: "Set Notebook Config", description: "Set notebook configuration." },
                { key: "get_permissions", title: "Get Notebook Permissions", description: "Get MCP access permissions for all notebooks." },
                { key: "set_permission", title: "Set Notebook Permission", description: "Set MCP access permission for a notebook." },
                { key: "get_child_docs", title: "Get Child Documents", description: "Get direct child documents at the notebook root." },
                { key: "set_icon", title: "Set Notebook Icon", description: "Set the icon for a notebook." },
            ],
        },
        {
            category: "document",
            icon: "📝",
            groupKey: "Documents",
            iconSvg: ICON_SVGS.fileText,
            actions: [
                { key: "create", title: "Create Document", description: "Create a new document with markdown content at a human-readable target path." },
                { key: "rename", title: "Rename Document", description: "Rename a document by ID or storage path." },
                { key: "remove", title: "Remove Document", description: "Remove a document by ID or storage path." },
                { key: "move", title: "Move Documents", description: "Move multiple documents by ID or storage path." },
                { key: "reorder", title: "Reorder Documents", description: "Apply a complete manual order to all visible direct child document IDs." },
                { key: "lookup", title: "Lookup Document Reference", description: "Look up document IDs, storage paths, human-readable paths, and metadata." },
                { key: "get_child_blocks", title: "Get Child Blocks", description: "Get direct child blocks by document ID." },
                { key: "get_child_docs", title: "Get Child Documents", description: "Get direct child documents by document ID." },
                { key: "set_attr", title: "Set Document Metadata", description: "Set the icon or cover for a document or folder." },
                { key: "list_tree", title: "List Document Tree", description: "List the nested document tree under a notebook path." },
                { key: "search_docs", title: "Search Documents", description: "Search documents by title keyword." },
                { key: "get_doc", title: "Get Document Content", description: "Get document content and metadata by document ID." },
                { key: "get_outline", title: "Get Document Outline", description: "Get the native heading tree without reading the document body." },
                { key: "create_daily_note", title: "Create Daily Note", description: "Create or return today's daily note for a notebook." },
                { key: "duplicate", title: "Duplicate Document", description: "Duplicate a document by ID." },
                { key: "heading_to_doc", title: "Heading To Document", description: "Convert a heading into a document." },
                { key: "doc_to_heading", title: "Document To Heading", description: "Convert a document into a heading under another document or heading." },
            ],
        },
        {
            category: "block",
            icon: "🧱",
            groupKey: "Blocks",
            iconSvg: ICON_SVGS.layout,
            actions: [
                { key: "insert", title: "Insert Block", description: "Insert a new block at a specified position." },
                { key: "prepend", title: "Prepend Block", description: "Insert a block at the beginning of a parent." },
                { key: "append", title: "Append Block", description: "Insert a block at the end of a parent." },
                { key: "update", title: "Update Block", description: "Update block content." },
                { key: "replace", title: "Replace Block Text", description: "Apply exact old/new text replacement edits inside one block kramdown only." },
                { key: "delete", title: "Delete Block", description: "Delete a block." },
                { key: "move", title: "Move Block", description: "Move a block to a new position." },
                { key: "set_fold_state", title: "Fold/Unfold Block", description: "Set the fold state of a foldable block." },
                { key: "get_kramdown", title: "Get Block Kramdown", description: "Get block content in kramdown format." },
                { key: "batch_kramdown", title: "Batch Get Kramdown", description: "Get kramdown for up to 20 blocks with ordered per-item results." },
                { key: "get_children", title: "Get Child Blocks", description: "Get all child blocks of a parent." },
                { key: "transfer_references", title: "Transfer Block References", description: "Transfer block references." },
                { key: "set_attrs", title: "Set Block Attributes", description: "Set block attributes." },
                { key: "get_attrs", title: "Get Block Attributes", description: "Get block attributes." },
                { key: "info", title: "Get Block Info", description: "Get root document metadata for a block." },
                { key: "breadcrumb", title: "Get Block Breadcrumb", description: "Get the breadcrumb path for a block." },
                { key: "dom", title: "Get Block DOM", description: "Get rendered DOM for a block." },
                { key: "recent_updated", title: "Recent Updated Blocks", description: "List recently updated blocks." },
                { key: "word_count", title: "Block Word Count", description: "Get word-count statistics for blocks." },
                { key: "add_to_daily_note", title: "Add To Daily Note", description: "Add a block to today's daily note, creating the note if needed." },
                { key: "docs_info", title: "Get Docs Info", description: "Get document info for one or more documents." },
            ],
        },
        {
            category: "av",
            icon: "🗃️",
            groupKey: "Databases",
            iconSvg: ICON_SVGS.database,
            actions: [
                { key: "get", title: "Get Database", description: "Get the full attribute view payload by AV ID." },
                { key: "render", title: "Render Database View", description: "Render database rows with optional view, pagination, and query context." },
                { key: "get_attribute_view_keys", title: "Get Database Keys", description: "Get keys or columns for a database." },
                { key: "get_attribute_view_filter_sort", title: "Get Database Filter Sort", description: "Get filters and sorts for a database block view." },
                { key: "search", title: "Search Databases", description: "Search attribute views by keyword." },
                { key: "add_rows", title: "Add Rows", description: "Add existing blocks as rows in a database." },
                { key: "remove_rows", title: "Remove Rows", description: "Remove bound rows from a database." },
                { key: "add_column", title: "Add Column", description: "Add a column to a database." },
                { key: "remove_column", title: "Remove Column", description: "Remove a column from a database." },
                { key: "set_cells", title: "Set Cells", description: "Update one or more cells with typed value payloads." },
                { key: "duplicate", title: "Duplicate Database Block", description: "Duplicate an existing database block." },
                { key: "get_primary_key_values", title: "Get Primary Key Values", description: "Get database primary key rows with optional filtering." },
            ],
        },
        {
            category: "file",
            icon: "📎",
            groupKey: "Files",
            iconSvg: ICON_SVGS.paperclip,
            actions: [
                { key: "upload_asset", title: "Upload Asset", description: "Read a local file path and upload that file to the assets directory. Files larger than the configured threshold must stop and ask the user before retrying with confirmLargeFile=true." },
                { key: "list_templates", title: "List Templates", description: "Search or list workspace templates under data/templates." },
                { key: "read_template", title: "Read Template", description: "Read Markdown template source through SiYuan's authenticated template route." },
                { key: "create_template", title: "Create Template", description: "Create a Markdown template under data/templates through SiYuan's workspace file API." },
                { key: "update_template", title: "Update Template", description: "Replace an existing Markdown template under data/templates." },
                { key: "delete_template", title: "Delete Template", description: "Delete an existing Markdown template resolved from SiYuan's template picker." },
                { key: "save_doc_as_template", title: "Save Doc As Template", description: "Save an existing document as a root-level template." },
                { key: "render", title: "Render Template", description: "Render a workspace template or Sprig template." },
                { key: "export_md", title: "Export Markdown Content", description: "Export document content as Markdown." },
                { key: "export_resources", title: "Export Resources", description: "Export resources as a ZIP archive." },
                { key: "list_unused_assets", title: "List Unused Assets", description: "List asset files not currently referenced." },
                { key: "get_doc_assets", title: "Get Direct Document Assets", description: "List assets directly referenced by the current document tree. Use Extract Document for complete content and asset inspection." },
                { key: "get_image_ocr_text", title: "Get Image OCR Text", description: "Get stored OCR text for an image asset." },
                { key: "remove_unused_assets", title: "Remove Unused Assets", description: "Remove all unused asset files." },
                { key: "rename_asset", title: "Rename Asset", description: "Rename an asset file." },
                { key: "delete_asset", title: "Delete Asset", description: "Delete an asset file." },
                { key: "extract_doc", title: "Extract Document", description: "Export a document and referenced assets into an uncompressed local folder." },
            ],
        },
        {
            category: "search",
            icon: "🔍",
            groupKey: "Search",
            iconSvg: ICON_SVGS.search,
            actions: [
                { key: "fulltext", title: "Full-text Search", description: "Search blocks across the workspace." },
                { key: "semantic", title: "Semantic Search", description: "Search embedded workspace blocks by semantic similarity." },
                { key: "query_sql", title: "Query SQL", description: "Run read-only SQL queries against SiYuan data." },
                { key: "get_backlinks", title: "Get Backlinks", description: "Get backlinks or backmentions for a block or document." },
                { key: "search_refs", title: "Search References", description: "Search references to a block or document." },
                { key: "find_replace", title: "Find And Replace", description: "Find and replace content in selected documents or blocks." },
                { key: "search_assets", title: "Search Assets", description: "Search assets by filename and extension filters." },
                { key: "fulltext_asset_content", title: "Search Asset Content", description: "Search OCR or indexed asset content." },
                { key: "list_invalid_refs", title: "List Invalid References", description: "List invalid block references." },
            ],
        },
        {
            category: "tag",
            icon: "🏷️",
            groupKey: "Tags",
            iconSvg: ICON_SVGS.tagIcon,
            actions: [
                { key: "list", title: "List Tags", description: "List tags in the workspace." },
                { key: "rename", title: "Rename Tag", description: "Rename a tag label." },
                { key: "remove", title: "Remove Tag", description: "Remove a tag label." },
            ],
        },
        {
            category: "timeline",
            icon: "🕓",
            groupKey: "Timeline",
            iconSvg: ICON_SVGS.compass,
            actions: [
                { key: "list_nodes", title: "List Nodes", description: "List global or document timeline nodes." },
                { key: "create_node", title: "Create Node", description: "Create a named global or document timeline node." },
                { key: "compare_node", title: "Compare Node", description: "Compare a document with a selected historical node." },
                { key: "delete_node", title: "Delete Node", description: "Remove a timeline tag while retaining the underlying snapshot. Disabled by default." },
                { key: "rollback_document", title: "Rollback Document", description: "Restore one document file from a timeline node. Disabled by default." },
                { key: "rollback_block", title: "Rollback Block", description: "Restore one changed block from a timeline node. Disabled by default." },
            ],
        },
        {
            category: "system",
            icon: "🖥️",
            groupKey: "System",
            iconSvg: ICON_SVGS.monitor,
            actions: [
                { key: "workspace_info", title: "Workspace Info", description: "Get SiYuan workspace metadata. High risk: exposes the absolute workspace path." },
                { key: "network", title: "Network Info", description: "Get masked network proxy information." },
                { key: "conf", title: "Masked Config", description: "Get masked system configuration via summary-first progressive reading." },
                { key: "notify", title: "Notify", description: "Push an info or error notification message." },
                { key: "changelog", title: "Changelog", description: "Read bundled plugin update notes with personalization-impact hints." },
                { key: "perform_sync", title: "Perform Sync", description: "Trigger SiYuan sync immediately. High risk: affects local and remote sync state." },
                { key: "get_version", title: "Get Version", description: "Get the SiYuan system version." },
                { key: "get_current_time", title: "Get Current Time", description: "Get the current system time." },
            ],
        },
        {
            category: "flashcard",
            icon: "🃏",
            groupKey: "Flashcards",
            iconSvg: ICON_SVGS.layers,
            actions: [
                { key: "list_cards", title: "List Cards", description: "List due flashcards by scope and optionally filter to due/new/old cards." },
                { key: "get_decks", title: "Get Decks", description: "List available flashcard decks for discovering deck IDs." },
                { key: "get_cards", title: "Get Cards", description: "List all cards in a flashcard deck with pagination." },
                { key: "review_card", title: "Review Card", description: "Submit a flashcard review rating." },
                { key: "create_card", title: "Create Card", description: "Turn existing blocks into flashcards by writing deck attrs and registering riff cards." },
                { key: "remove_card", title: "Remove Card", description: "Remove existing blocks from a flashcard deck." },
            ],
        },
        {
            category: "mascot",
            icon: "🐾",
            groupKey: "Mascot Tool",
            iconSvg: ICON_SVGS.paw,
            actions: [
                { key: "get_balance", title: "Get Balance", description: "Get the mascot's current balance. Every successful MCP tool call earns 1 coin." },
                { key: "shop", title: "Shop", description: "List the mascot shop inventory." },
                { key: "buy", title: "Buy", description: "Buy one item from the mascot shop by item ID." },
            ],
        },
        {
            category: "extension",
            icon: "🧩",
            groupKey: "Extension Tools",
            iconSvg: ICON_SVGS.layers,
            actions: [
                { key: "list", title: "List Official Tools", description: "Inspect or refresh plugin and native tools from the official SiYuan MCP endpoint." },
                { key: "validate_package", title: "Validate Explicit Package", description: "Statically validate caller-supplied plugin, theme, or widget metadata and text files without reading any local package path or changing SiYuan." },
                { key: "diagnose_plugin_mcp", title: "Diagnose Plugin MCP Registry", description: "Refresh and inspect Source=plugin registry entries for one plugin without enabling, disabling, reloading, or invoking it." },
            ],
        },
        {
            category: "feedback",
            icon: "💬",
            groupKey: "Feedback Tool",
            iconSvg: ICON_SVGS.message,
            actions: [
                { key: "submit", title: "Submit Feedback", description: "Submit plain-text feedback, suggestions, or experience reports to the developer." },
            ],
        },
    ];

    function toTitleCase(action: string): string {
        return action
            .split("_")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    function getCategoryFallback(category: ToolCategory): { icon: string; groupKey: string; iconSvg: string } {
        const tab = CATEGORY_TAB_DEFS.find((item) => item.category === category);
        const iconSvg = tab ? ICON_SVGS[tab.iconKey] : ICON_SVGS.folder;
        return {
            icon: "",
            groupKey: tab?.groupKey ?? category,
            iconSvg,
        };
    }

    function buildCompleteGroupDefinitions(): GroupDefinition[] {
        return TOOL_CATEGORIES.map((category) => {
            const metadata = ACTION_METADATA.find((item) => item.category === category);
            const fallback = getCategoryFallback(category);
            const knownActions = new Map((metadata?.actions ?? []).map((action) => [action.key, action]));
            return {
                category,
                icon: metadata?.icon ?? fallback.icon,
                groupKey: metadata?.groupKey ?? fallback.groupKey,
                iconSvg: metadata?.iconSvg ?? fallback.iconSvg,
                actions: ACTIONS_BY_CATEGORY[category].map((action) => knownActions.get(action) ?? {
                    key: action as GroupAction,
                    title: toTitleCase(action),
                    description: `Expose ${category}(action="${action}") to MCP clients.`,
                }),
            };
        });
    }

    const GROUP_DEFINITIONS: GroupDefinition[] = buildCompleteGroupDefinitions();
    const DEFAULT_OPEN_CATEGORIES: ToolCategory[] = [];

    let openCategories = new Set<ToolCategory>(DEFAULT_OPEN_CATEGORIES);

    const getDangerTitle = (title: string) => `${title} ${getLabel("mcpHighRiskBadge", "[High risk]")}`;
    const DEFAULT_TOOL_CONFIG = buildDefaultToolConfig();
    const getDangerDescription = (category: ToolCategory, action: string, description: string, explicitDefault?: boolean) => {
        const defaultEnabled = explicitDefault ?? Boolean(DEFAULT_TOOL_CONFIG[category].actions[action as never]);
        const defaultState = defaultEnabled
            ? getLabel("mcpDefaultEnabled", "Enabled by default.")
            : getLabel("mcpDefaultDisabled", "Disabled by default.");
        return `${description} ${getLabel("mcpRequiresConfirmation", "Requires explicit user confirmation before execution.")} ${defaultState}`;
    };

    function buildUploadAssetThresholdItem(): ISettingItemCore {
        return {
            type: "number",
            key: "file__setting__uploadLargeFileThresholdMB",
            value: config.file.uploadLargeFileThresholdMB,
            title: getLabel("file_setting_uploadLargeFileThresholdMB", "Large Upload Threshold"),
            description: getLabel("desc_file_setting_uploadLargeFileThresholdMB", "Files larger than this threshold must stop and ask the user before retrying with confirmLargeFile=true."),
            inputCompact: true,
            unit: "MB",
        };
    }

    function buildActionItems(definition: GroupDefinition): ISettingItem[] {
        return definition.actions.flatMap((action) => {
            const baseTitle = getLabel(`${definition.category}_action_${action.key}`, action.title);
            const baseDescription = getLabel(`desc_${definition.category}_action_${action.key}`, action.description);
            const dangerous = isDangerousAction(definition.category, action.key);
            const uploadAssetEnabled = definition.category === "file" && action.key === "upload_asset" && config.file.actions.upload_asset;
            return [{
                type: "checkbox",
                key: `${definition.category}__action__${action.key}`,
                value: config[definition.category].actions[action.key as keyof typeof config[typeof definition.category]["actions"]],
                title: dangerous ? getDangerTitle(baseTitle) : baseTitle,
                description: dangerous ? getDangerDescription(definition.category, action.key, baseDescription) : baseDescription,
                ...(definition.category === "file" && action.key === "upload_asset"
                    ? { layout: "inline" as const }
                    : {}),
                ...(definition.category === "file" && action.key === "upload_asset"
                    ? { children: uploadAssetEnabled ? [buildUploadAssetThresholdItem()] : [] }
                    : {}),
            }] satisfies ISettingItem[];
        });
    }

    function buildCategoryItems(category: ToolCategory): ISettingItem[] {
        const definition = GROUP_DEFINITIONS.find((item) => item.category === category);
        if (!definition) {
            throw new Error(`Unknown tool category: ${category}`);
        }
        if (category !== "extension") return buildActionItems(definition);
        const staticActionItems = buildActionItems(definition);

        const sourceCounts = extensionDiscovery.tools.reduce((counts, tool) => {
            counts[tool.source] += 1;
            return counts;
        }, { plugin: 0, native: 0 });
        const visibleTools = extensionDiscovery.tools.filter((tool) =>
            !RESERVED_EXTENSION_ACTIONS.has(tool.name)
            && (tool.source === "plugin" || config.extension.includeNativeTools)
        );
        const exposedCount = visibleTools.filter((tool) =>
            !config.extension.blockedTools.includes(tool.name)
        ).length;
        const exposedSchemaBytes = visibleTools
            .filter((tool) => !config.extension.blockedTools.includes(tool.name))
            .reduce((total, tool) => total + tool.schemaBytes, 0);
        const statusText = extensionDiscovery.loading
            ? getLabel("extension_discovery_loading", "Discovering official MCP tools…")
            : extensionDiscovery.connected
                ? getLabel("extension_discovery_connected", "Connected")
                    + ` · ${extensionDiscovery.tools.length} `
                    + getLabel("extension_discovery_count", "tool(s)")
                    + ` (${sourceCounts.plugin} plugin / ${sourceCounts.native} native)`
                    + ` · ${exposedCount} ${getLabel("extension_exposed_count", "exposed")}`
                    + ` · ${exposedSchemaBytes} B Schema`
                : getLabel("extension_discovery_unavailable", "Official MCP unavailable")
                    + (extensionDiscovery.error ? `: ${extensionDiscovery.error}` : "");
        const discoveredByName = new Map(extensionDiscovery.tools.map((tool) => [tool.name, tool]));
        const names = [...new Set([
            ...visibleTools.map((tool) => tool.name),
            ...config.extension.blockedTools.filter((name) => {
                const tool = discoveredByName.get(name);
                return !tool || tool.source === "plugin" || config.extension.includeNativeTools;
            }),
        ])].sort();
        const dynamicItems: ISettingItem[] = names.map((name) => {
            const tool = discoveredByName.get(name);
            const safety = tool?.readOnlyHint
                ? getLabel("extension_read_only", "Declared read-only")
                : getLabel("extension_confirmation_required", "Confirmation required");
            const source = tool?.source === "native"
                ? getLabel("extension_source_native", "SiYuan native")
                : getLabel("extension_source_plugin", "Plugin");
            return {
                type: "checkbox",
                key: `extension__tool__${encodeURIComponent(name)}`,
                value: !config.extension.blockedTools.includes(name),
                title: tool?.title ? `${tool.title} · ${name}` : name,
                description: `[${source}] ${tool?.description ?? getLabel("extension_tool_unavailable", "Not present in the latest discovery result.")} ${safety}.`,
            };
        });
        return staticActionItems.concat([
            {
                type: "checkbox",
                key: "extension__include_native_tools",
                value: config.extension.includeNativeTools,
                title: getLabel("extension_include_native_title", "Include native SiYuan MCP tools (high risk)"),
                description: getLabel(
                    "extension_include_native_desc",
                    "<strong>⚠️ Security boundary:</strong> Native tools execute with the current SiYuan administrator session or API Token and bypass Sisyphus notebook permissions, disabled actions, and dangerous-action confirmation, so they may read or modify all workspace data accessible to that identity.",
                ),
            },
            {
                type: "hint",
                key: "extension__discovery__status",
                value: statusText,
                title: getLabel("extension_discovery_status", "Discovery status"),
                description: getLabel("extension_discovery_status_desc", "Requires SiYuan 3.7.0+, an administrator session, and a valid API token."),
            },
            {
                type: "button",
                key: "extension__discovery__refresh",
                value: "",
                title: getLabel("extension_refresh_title", "Refresh official tools"),
                description: getLabel("extension_refresh_desc", "Reload plugin and native tools from the official SiYuan MCP registry."),
                button: {
                    label: extensionDiscovery.loading
                        ? getLabel("extension_refreshing", "Refreshing…")
                        : getLabel("extension_refresh", "Refresh"),
                    callback: () => void onRefreshExtensionTools(),
                },
            },
            ...dynamicItems,
        ]);
    }

    function toggleCategory(category: ToolCategory) {
        const next = new Set(openCategories);
        if (next.has(category)) {
            next.delete(category);
        } else {
            next.add(category);
            if (
                category === "extension"
                && !extensionDiscovery.loading
                && !extensionDiscovery.refreshedAt
            ) {
                void onRefreshExtensionTools();
            }
        }
        openCategories = next;
    }

    function isCategoryOpen(category: ToolCategory) {
        return openCategories.has(category);
    }

    function countEnabledActions(category: ToolCategory) {
        if (category === "extension") {
            const staticDiagnostics = ACTIONS_BY_CATEGORY.extension
                .filter((action) => config.extension.actions[action]).length;
            return staticDiagnostics
                + extensionDiscovery.tools.filter((tool) =>
                    !RESERVED_EXTENSION_ACTIONS.has(tool.name)
                    && (tool.source === "plugin" || config.extension.includeNativeTools)
                    && !config.extension.blockedTools.includes(tool.name)
                ).length;
        }
        return ACTIONS_BY_CATEGORY[category].filter((action) => config[category].actions[action]).length;
    }

    function countDangerousActions(category: ToolCategory) {
        if (category === "extension") {
            return extensionDiscovery.tools.filter((tool) =>
                !RESERVED_EXTENSION_ACTIONS.has(tool.name)
                && (tool.source === "plugin" || config.extension.includeNativeTools)
                && !tool.readOnlyHint
            ).length;
        }
        return ACTIONS_BY_CATEGORY[category].filter((action) => isDangerousAction(category, action)).length;
    }

    function dispatchToolToggle(category: ToolCategory, checked: boolean) {
        void onChanged(new CustomEvent("changed", {
            detail: {
                key: `${category}__enabled`,
                value: checked,
            },
        }));
    }

    let groupDefinitions: Array<GroupDefinition & {
        title: string;
        enabledActions: number;
        totalActions: number;
        dangerousActions: number;
        items: ISettingItem[];
        open: boolean;
    }> = [];

    $: {
        config;
        getLabel;
        openCategories;
        groupDefinitions = GROUP_DEFINITIONS.map((definition) => ({
            ...definition,
            title: getLabel(definition.groupKey, definition.groupKey),
            enabledActions: countEnabledActions(definition.category),
            totalActions: definition.category === "extension"
                ? ACTIONS_BY_CATEGORY.extension.length + extensionDiscovery.tools.filter((tool) =>
                    !RESERVED_EXTENSION_ACTIONS.has(tool.name)
                    && (tool.source === "plugin" || config.extension.includeNativeTools)
                ).length
                : ACTIONS_BY_CATEGORY[definition.category].length,
            dangerousActions: countDangerousActions(definition.category),
            items: buildCategoryItems(definition.category),
            open: isCategoryOpen(definition.category),
        }));
    }
</script>

<SettingPanel {group} settingItems={[]} {display}>
    <div class="tool-settings-accordion">
        {#each groupDefinitions as definition (definition.category)}
            <section
                class="tool-settings-group"
                class:tool-settings-group--open={definition.open}
                class:tool-settings-group--disabled={!config[definition.category].enabled}
                data-category={definition.category}
            >
                <div class="tool-settings-group__header">
                    <button
                        type="button"
                        class="tool-settings-group__summary"
                        aria-expanded={definition.open}
                        on:click={() => toggleCategory(definition.category)}
                    >
                        <span class="tool-settings-group__icon" aria-hidden="true">{@html definition.iconSvg}</span>
                        <span class="tool-settings-group__meta">
                            <span class="tool-settings-group__title-row">
                                <span class="tool-settings-group__title">{definition.title}</span>
                                <span class="tool-settings-group__badge">
                                    {definition.enabledActions}/{definition.totalActions}
                                </span>
                                {#if definition.dangerousActions > 0}
                                    <span class="tool-settings-group__danger-badge">
                                        {definition.dangerousActions} {getLabel("mcpHighRiskBadge", "[High risk]").replace(/[\[\]【】]/g, "")}
                                    </span>
                                {/if}
                            </span>
                            <span class="tool-settings-group__subtitle">
                                {getLabel(`${definition.category}_tool_desc`, `Expose the grouped ${definition.category} tool to MCP clients.`)}
                            </span>
                        </span>
                    </button>
                    <span class="tool-settings-group__controls">
                        <label class="tool-settings-group__switch">
                            <input
                                type="checkbox"
                                class="b3-switch fn__flex-center"
                                checked={config[definition.category].enabled}
                                on:change={(event) => dispatchToolToggle(definition.category, event.currentTarget.checked)}
                            />
                        </label>
                        <button
                            type="button"
                            class="tool-settings-group__chevron-button"
                            aria-expanded={definition.open}
                            on:click={() => toggleCategory(definition.category)}
                        >
                            <span class:tool-settings-group__chevron-open={definition.open} class="tool-settings-group__chevron" aria-hidden="true">▾</span>
                        </button>
                    </span>
                </div>

                {#if definition.open}
                    <div class="tool-settings-group__content">
                        <SettingPanel
                            group={definition.title}
                            settingItems={definition.items}
                            display={true}
                            on:changed={onChanged}
                        />
                    </div>
                {/if}
            </section>
        {/each}
    </div>
</SettingPanel>

<style>
    .tool-settings-accordion {
        display: flex;
        flex-direction: column;
        gap: var(--mcp-config-section-gap, 14px);
        width: 100%;
    }

    .tool-settings-group {
        box-sizing: border-box;
        border: 1px solid var(--mcp-config-border, var(--b3-border-color));
        border-radius: var(--mcp-config-card-radius, 8px);
        background: var(--mcp-config-surface, var(--b3-theme-surface));
        box-shadow: var(--mcp-config-shadow, none);
        overflow: hidden;
        transition: border-color 0.14s ease, background 0.14s ease, opacity 0.14s ease;
    }

    .tool-settings-group:hover,
    .tool-settings-group--open {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 25%, var(--b3-border-color));
    }

    .tool-settings-group--disabled {
        background: color-mix(in srgb, var(--mcp-config-surface, var(--b3-theme-surface)) 76%, transparent);
        opacity: 0.72;
    }

    .tool-settings-group__header {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: var(--mcp-config-card-padding, 16px);
        border: 0;
        background: transparent;
        color: inherit;
        text-align: left;
    }

    .tool-settings-group__summary {
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        gap: 12px;
        border: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        text-align: left;
    }

    .tool-settings-group__icon {
        flex: 0 0 auto;
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--mcp-config-primary-soft, transparent);
        border: 1px solid var(--mcp-config-primary-border, transparent);
        border-radius: var(--mcp-config-icon-radius, 8px);
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
    }

    .tool-settings-group__icon :global(svg) {
        width: 18px;
        height: 18px;
    }

    .tool-settings-group__meta {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .tool-settings-group__title-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }

    .tool-settings-group__title {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: var(--mcp-config-title-font-size, 14px);
        font-weight: var(--mcp-config-title-font-weight, 500);
        line-height: 1.5;
    }

    .tool-settings-group__subtitle {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        font-size: 12px;
        line-height: 1.5;
    }

    .tool-settings-group__badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 40px;
        padding: 1px 8px;
        border: 1px solid var(--b3-border-color);
        border-radius: 999px;
        background: color-mix(in srgb, var(--b3-theme-background) 72%, transparent);
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        font-size: 12px;
        font-weight: 500;
    }

    .tool-settings-group__danger-badge {
        align-items: center;
        background: color-mix(in srgb, var(--b3-theme-warning, #d99a24) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--b3-theme-warning, #d99a24) 28%, transparent);
        border-radius: 999px;
        color: var(--b3-theme-warning, var(--b3-card-warning-color));
        display: inline-flex;
        font-size: 10px;
        font-weight: 600;
        line-height: 1.4;
        padding: 2px 7px;
    }

    .tool-settings-group__controls {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .tool-settings-group__switch {
        display: inline-flex;
        align-items: center;
    }

    .tool-settings-group__chevron-button {
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--b3-border-radius);
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .tool-settings-group__chevron-button:hover {
        background: var(--b3-list-hover);
    }

    .tool-settings-group__chevron {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        transition: transform 0.16s ease;
    }

    .tool-settings-group__chevron-open {
        transform: rotate(180deg);
    }

    .tool-settings-group__content {
        box-sizing: border-box;
        padding: var(--mcp-config-card-padding, 16px);
        border-top: 1px solid var(--mcp-config-border, var(--b3-border-color));
        background: color-mix(in srgb, var(--b3-theme-background) 28%, transparent);
    }

    .tool-settings-group__content :global(.config__tab-container) {
        box-sizing: border-box;
        max-width: none;
        padding: 0;
    }

    .tool-settings-group__content :global(.config__settings-card) {
        border-color: var(--mcp-config-border, var(--b3-border-color));
        box-shadow: none;
    }

    @media (max-width: 768px) {
        .tool-settings-group__header {
            align-items: flex-start;
            padding: 12px;
        }

        .tool-settings-group__controls {
            gap: 8px;
        }

        .tool-settings-group__content :global(.config__tab-container) {
            padding: 0;
        }
    }
</style>
