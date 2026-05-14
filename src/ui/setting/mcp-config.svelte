<script lang="ts">
    import { onMount } from "svelte";
    import { fetchPost, showMessage } from "siyuan";

    import { buildDefaultToolConfig, normalizeToolConfig, type ToolCategory, type ToolConfig } from "./tool-config";
    import {
        buildDefaultHttpServerSettings,
        buildDefaultPuppySettings,
        buildDefaultTelemetryConfig,
        buildDefaultVersionControlSettings,
        loadPersistedHttpServerSettings,
        loadPersistedPuppySettings,
        loadPersistedTelemetryConfig,
        loadPersistedToolConfig,
        loadPersistedVersionControlSettings,
        normalizePuppySettings,
        savePersistedPuppySettings,
        savePersistedTelemetryConfig,
        savePersistedToolConfig,
        savePersistedVersionControlSettings,
        type HttpServerSettings,
        type PuppySettings,
        type TelemetryConfig,
        type VersionControlSettings,
    } from "./tool-config-storage";
    import HttpServerPanel from "./mcp-config/HttpServerPanel.svelte";
    import DebugPanel from "./mcp-config/DebugPanel.svelte";
    import PermissionsPanel from "./mcp-config/PermissionsPanel.svelte";
    import PuppyPanel from "./mcp-config/PuppyPanel.svelte";
    import TelemetryPanel from "./mcp-config/TelemetryPanel.svelte";
    import ToolCategoriesPanel from "./mcp-config/ToolCategoriesPanel.svelte";
    import UserRulesPanel from "./mcp-config/UserRulesPanel.svelte";
    import {
        HTTP_GROUP_KEY,
        ICON_SVGS,
        PERM_GROUP_KEY,
        TOOL_GROUP_KEY,
        PUPPY_GROUP_KEY,
        ANALYTICS_GROUP_KEY,
        DEBUG_GROUP_KEY,
        USER_RULES_GROUP_KEY,
        type TabItem,
    } from "./mcp-config-tabs";

    export let plugin: any;

    type NotebookPermission = 'none' | 'r' | 'rw' | 'rwd';
    const VALID_PERMISSIONS: NotebookPermission[] = ['none', 'r', 'rw', 'rwd'];
    const LEGACY_PERMISSION_MAP = {
        none: 'none',
        readonly: 'r',
        write: 'rw',
    } as const;

    interface NotebookInfo { id: string; name: string; }
    interface ChangeEvent { key: string; value: any; }

    const USER_RULES_GROUP_LABEL = "User Rules";
    const PUPPY_GROUP_LABEL = "Mascot Display";
    const PERM_GROUP_LABEL = "Permissions";
    const ANALYTICS_GROUP_LABEL = "Usage Stats";
    const DEBUG_GROUP_LABEL = "Debug";

    let config: ToolConfig = buildDefaultToolConfig();
    let httpSettings: HttpServerSettings = buildDefaultHttpServerSettings();
    let puppySettings: PuppySettings = buildDefaultPuppySettings();
    let telemetryConfig: TelemetryConfig = buildDefaultTelemetryConfig();
    let versionControlSettings: VersionControlSettings = buildDefaultVersionControlSettings();
    let focusGroup = "";
    let notebooks: NotebookInfo[] = [];
    let permissions: Record<string, NotebookPermission> = {};
    let permLoading = true;

    const getLabel = (key: string, fallback: string) => plugin?.i18n?.[key] ?? fallback;

    const normalizePermission = (value: unknown): NotebookPermission => {
        if (VALID_PERMISSIONS.includes(value as NotebookPermission)) {
            return value as NotebookPermission;
        }
        if (typeof value === "string" && value in LEGACY_PERMISSION_MAP) {
            return LEGACY_PERMISSION_MAP[value as keyof typeof LEGACY_PERMISSION_MAP];
        }
        return 'none';
    };

    $: httpGroupLabel = getLabel("httpServerTitle", HTTP_GROUP_KEY);
    $: permGroupLabel = getLabel(PERM_GROUP_KEY, PERM_GROUP_LABEL);
    $: puppyGroupLabel = getLabel(PUPPY_GROUP_KEY, PUPPY_GROUP_LABEL);
    $: analyticsGroupLabel = getLabel(ANALYTICS_GROUP_KEY, ANALYTICS_GROUP_LABEL);
    $: debugGroupLabel = getLabel(DEBUG_GROUP_KEY, DEBUG_GROUP_LABEL);
    $: userRulesGroupLabel = getLabel(USER_RULES_GROUP_KEY, USER_RULES_GROUP_LABEL);

    $: toolGroupLabel = getLabel(TOOL_GROUP_KEY, TOOL_GROUP_KEY);
    $: tabItems = [
        { id: HTTP_GROUP_KEY, label: httpGroupLabel, iconSvg: ICON_SVGS.globe },
        { id: PERM_GROUP_KEY, label: permGroupLabel, iconSvg: ICON_SVGS.lock },
        { id: TOOL_GROUP_KEY, label: toolGroupLabel, iconSvg: ICON_SVGS.folder },
        { id: PUPPY_GROUP_KEY, label: puppyGroupLabel, iconSvg: ICON_SVGS.paw },
        { id: ANALYTICS_GROUP_KEY, label: analyticsGroupLabel, iconSvg: ICON_SVGS.barChart },
        { id: DEBUG_GROUP_KEY, label: debugGroupLabel, iconSvg: ICON_SVGS.bug },
        { id: USER_RULES_GROUP_KEY, label: userRulesGroupLabel, iconSvg: ICON_SVGS.compass },
    ] satisfies TabItem[];

    $: tabIds = tabItems.map((t) => t.id);
    $: if (!tabIds.includes(focusGroup)) {
        focusGroup = tabItems[0]?.id ?? "";
    }

    async function loadNotebooks() {
        try {
            await new Promise<void>((resolve, reject) => {
                fetchPost("/api/notebook/lsNotebooks", {}, (resp: any) => {
                    if (resp?.code === 0) {
                        notebooks = (resp?.data?.notebooks ?? []).map((nb: any) => ({
                            id: nb.id,
                            name: nb.name,
                        }));
                        resolve();
                    } else {
                        reject(new Error(resp?.msg || "Failed to load notebooks"));
                    }
                });
            });
        } catch {
            notebooks = [];
        }
        permLoading = false;
    }

    onMount(async () => {
        config = await loadPersistedToolConfig(plugin);
        puppySettings = await loadPersistedPuppySettings(plugin);
        httpSettings = await loadPersistedHttpServerSettings(plugin);
        telemetryConfig = await loadPersistedTelemetryConfig(plugin);
        versionControlSettings = await loadPersistedVersionControlSettings(plugin);

        const savedPerms = await plugin?.loadData("notebookPermissions");
        if (savedPerms && typeof savedPerms === "object") {
            const normalizedPermissions = Object.fromEntries(
                Object.entries(savedPerms).map(([notebookId, permission]) => [notebookId, normalizePermission(permission)]),
            );
            permissions = normalizedPermissions;
            if (JSON.stringify(savedPerms) !== JSON.stringify(normalizedPermissions)) {
                await plugin.saveData("notebookPermissions", normalizedPermissions);
            }
        }

        await loadNotebooks();
    });

    function setCategoryEnabled(category: ToolCategory, enabled: boolean) {
        config = {
            ...config,
            [category]: {
                ...config[category],
                enabled,
            },
        };
    }

    function setActionEnabled(category: ToolCategory, action: string, enabled: boolean) {
        const nextActions = {
            ...config[category].actions,
            [action]: enabled,
        };
        const hasEnabledActions = Object.values(nextActions).some(Boolean);

        config = {
            ...config,
            [category]: {
                enabled: enabled ? true : hasEnabledActions ? config[category].enabled : false,
                actions: nextActions,
            },
        };
    }

    async function persistPuppySettings() {
        if (plugin) {
            puppySettings = await savePersistedPuppySettings(puppySettings, plugin);
            plugin.updatePuppyTestSettings?.(puppySettings);
        }
    }

    async function persistConfig() {
        if (plugin) {
            config = await savePersistedToolConfig(config, plugin);
        }
    }

    async function persistPermissions() {
        if (plugin) {
            await plugin.saveData("notebookPermissions", permissions);
        }
    }

    async function persistTelemetryConfig() {
        if (plugin) {
            telemetryConfig = await savePersistedTelemetryConfig(telemetryConfig, plugin);
        }
    }

    async function persistVersionControlSettings() {
        if (plugin) {
            versionControlSettings = await savePersistedVersionControlSettings(versionControlSettings, plugin);
            plugin.updateVersionControlSettings?.(versionControlSettings);
        }
    }

    const onChanged = async (event: CustomEvent<ChangeEvent>) => {
        const { key, value } = event.detail;

        if (key === "puppy__visible") {
            puppySettings = { ...puppySettings, visible: Boolean(value) };
            await persistPuppySettings();
            return;
        }

        if (key === "puppy__testModeEnabled") {
            puppySettings = { ...puppySettings, testModeEnabled: Boolean(value) };
            await persistPuppySettings();
            return;
        }

        if (key === "puppy__showBubble") {
            puppySettings = { ...puppySettings, showBubble: Boolean(value) };
            await persistPuppySettings();
            return;
        }

        if (key === "puppy__showClickHint") {
            puppySettings = { ...puppySettings, showClickHint: Boolean(value) };
            await persistPuppySettings();
            return;
        }

        if (key === "puppy__testModeIntervalMs") {
            const numeric = Number(value);
            puppySettings = {
                ...puppySettings,
                testModeIntervalMs: Number.isFinite(numeric) ? Math.max(800, Math.min(10000, Math.floor(numeric))) : puppySettings.testModeIntervalMs,
            };
            await persistPuppySettings();
            return;
        }

        if (key.startsWith("perm__") && key !== "perm__hint") {
            const notebookId = key.slice("perm__".length);
            permissions = { ...permissions, [notebookId]: value as NotebookPermission };
            await persistPermissions();
            return;
        }

        if (key.endsWith("__enabled")) {
            const category = key.replace("__enabled", "") as ToolCategory;
            setCategoryEnabled(category, Boolean(value));
            await persistConfig();
            return;
        }

        if (key === "file__setting__uploadLargeFileThresholdMB") {
            const numeric = Number(value);
            config = {
                ...config,
                file: {
                    ...config.file,
                    uploadLargeFileThresholdMB: Number.isFinite(numeric) ? Math.max(1, Math.min(1024, Math.floor(numeric))) : config.file.uploadLargeFileThresholdMB,
                },
            };
            await persistConfig();
            return;
        }

        if (key === "userRulesText") {
            config = {
                ...config,
                userRulesText: typeof value === "string" ? value : String(value ?? ""),
            };
            await persistConfig();
            try {
                const restarted = await plugin?.refreshHttpServerAfterUserRulesChange?.();
                showMessage(restarted
                    ? getLabel("user_rules_http_restarted", "MCP HTTP server restarted. Reconnect or refresh connected MCP clients to apply updated user rules.")
                    : getLabel("user_rules_saved_reconnect", "User rules saved. Reconnect or refresh MCP clients to apply updated initialize instructions."));
            } catch (err) {
                console.error("[MCP] refresh after user rules change failed:", err);
                showMessage(getLabel("user_rules_refresh_failed", "User rules saved, but MCP HTTP server restart failed. Reconnect or restart it manually to apply updated rules."));
            }
            return;
        }

        if (key === "debug__slimResponses") {
            config = {
                ...config,
                debug: {
                    ...config.debug,
                    slimResponses: Boolean(value),
                },
            };
            await persistConfig();
            return;
        }

        if (key === "versionControl__showDebugMeta") {
            versionControlSettings = {
                ...versionControlSettings,
                showDebugMeta: Boolean(value),
            };
            await persistVersionControlSettings();
            return;
        }

        if (key === "telemetry__enabled") {
            telemetryConfig = { ...telemetryConfig, enabled: Boolean(value) };
            await persistTelemetryConfig();
            return;
        }

        if (key === "telemetry__interval") {
            const hours = parseInt(String(value), 10);
            telemetryConfig = {
                ...telemetryConfig,
                reportIntervalHours: Number.isFinite(hours) ? Math.max(1, Math.min(168, hours)) : telemetryConfig.reportIntervalHours,
            };
            await persistTelemetryConfig();
            return;
        }

        if (key === "telemetry__endpoint") {
            telemetryConfig = {
                ...telemetryConfig,
                endpoint: typeof value === "string" && value.trim() ? value.trim() : undefined,
            };
            await persistTelemetryConfig();
            return;
        }

        const [category, , action] = key.split("__");
        if (category && action) {
            setActionEnabled(category as ToolCategory, action, Boolean(value));
            await persistConfig();
        }
    };

    export async function saveSettings() {
        await persistConfig();
        showMessage(plugin?.i18n?.mcpConfigSaved || "✅ MCP Tools configuration saved");
    }

    export async function resetDefaults() {
        config = normalizeToolConfig(buildDefaultToolConfig());
        puppySettings = normalizePuppySettings(buildDefaultPuppySettings());
        telemetryConfig = buildDefaultTelemetryConfig();
        versionControlSettings = buildDefaultVersionControlSettings();
        await persistConfig();
        await persistPuppySettings();
        await persistTelemetryConfig();
        await persistVersionControlSettings();
        showMessage(plugin?.i18n?.mcpConfigReset || "🔄 MCP Tools configuration reset to defaults");
    }


</script>

<div class="fn__flex-1 fn__flex config__panel">
    <ul class="b3-tab-bar b3-list b3-list--background">
        {#each tabItems as tab}
            <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
            <li
                data-name="mcp-config"
                class:b3-list-item--focus={tab.id === focusGroup}
                class="b3-list-item"
                on:click={() => {
                    focusGroup = tab.id;
                }}
                on:keydown={() => {}}
            >
                <span class="b3-list-item__icon mcp-tab-icon">{@html tab.iconSvg}</span>
                <span class="b3-list-item__text">{tab.label}</span>
            </li>
        {/each}
    </ul>
    <div class="config__tab-wrap">
        <HttpServerPanel {plugin} group={httpGroupLabel} display={focusGroup === HTTP_GROUP_KEY} bind:httpSettings {getLabel} />
        <PermissionsPanel group={permGroupLabel} display={focusGroup === PERM_GROUP_KEY} {notebooks} {permissions} {permLoading} {getLabel} {onChanged} />
        <ToolCategoriesPanel group={toolGroupLabel} display={focusGroup === TOOL_GROUP_KEY} {config} {getLabel} {onChanged} />
        <PuppyPanel group={puppyGroupLabel} display={focusGroup === PUPPY_GROUP_KEY} {puppySettings} {getLabel} {onChanged} />
        <TelemetryPanel analyticsGroup={analyticsGroupLabel} telemetryGroup="" showTelemetry={false} currentToolConfig={config} {focusGroup} {telemetryConfig} {getLabel} {onChanged} />
        <DebugPanel group={debugGroupLabel} display={focusGroup === DEBUG_GROUP_KEY} {config} {puppySettings} {versionControlSettings} {getLabel} {onChanged} />
        <UserRulesPanel group={userRulesGroupLabel} display={focusGroup === USER_RULES_GROUP_KEY} {config} {getLabel} {onChanged} />
    </div>
</div>

<style lang="scss">
    .config__panel {
        height: 100%;
        min-height: 0;
    }

    .config__panel > ul > li {
        padding-left: 1rem;
    }

    .config__tab-wrap {
        max-height: calc(100vh - 250px);
        overflow-y: auto;
        overflow-x: hidden;
        scroll-behavior: smooth;
    }

    @media (max-width: 768px) {
        .config__panel {
            flex-direction: column;
        }

        .config__panel > ul {
            flex-shrink: 0;
            max-height: none;
            overflow-x: hidden;
            overflow-y: hidden;
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            border-bottom: 1px solid var(--b3-border-color);
            padding: 4px 0;
        }

        .config__panel > ul > li {
            padding: 0.25rem 0.4rem;
            margin: 0 2px;
            flex-shrink: 0;
        }

        .config__panel > ul .b3-list-item__text {
            display: none !important;
        }

        .config__panel > ul .mcp-tab-icon {
            margin-right: 0;
        }

        .config__panel > ul .mcp-tab-icon :global(svg) {
            width: 20px;
            height: 20px;
        }

        .config__tab-wrap {
            max-height: none;
            flex: 1;
            overflow-y: auto;
        }
    }

    .mcp-tab-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-right: 8px;
        color: var(--b3-theme-on-background);
    }

    .mcp-tab-icon :global(svg) {
        width: 18px;
        height: 18px;
    }
</style>
