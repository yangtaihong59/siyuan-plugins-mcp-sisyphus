<script lang="ts">
    import { onMount, tick } from "svelte";
    import { fetchPost, showMessage } from "siyuan";

    import { buildDefaultToolConfig, normalizeToolConfig, type ToolCategory, type ToolConfig } from "./tool-config";
    import {
        buildDefaultHttpServerSettings,
        buildDefaultPermissionDisplaySettings,
        buildDefaultPuppyAppearance,
        buildDefaultPuppySettings,
        buildDefaultTelemetryConfig,
        buildDefaultVersionControlSettings,
        buildRandomPuppyAppearance,
        loadPersistedHttpServerSettings,
        loadPersistedPermissionDisplaySettings,
        loadPersistedPuppySettings,
        loadPersistedTelemetryConfig,
        loadPersistedToolConfig,
        loadPersistedVersionControlSettings,
        normalizePuppySettings,
        savePersistedPuppySettings,
        savePersistedPermissionDisplaySettings,
        savePersistedTelemetryConfig,
        savePersistedToolConfig,
        savePersistedVersionControlSettings,
        type HttpServerSettings,
        type PermissionDisplaySettings,
        type PuppySettings,
        type TelemetryConfig,
        type VersionControlSettings,
    } from "./tool-config-storage";
    import {
        normalizeNotebookPermission,
        normalizeNotebookPermissions,
        PERMISSION_TREE_CHANGED_EVENT,
        type NotebookPermission,
    } from "../permission-tree-indicator";
    import HttpServerPanel from "./mcp-config/HttpServerPanel.svelte";
    import DebugPanel from "./mcp-config/DebugPanel.svelte";
    import FeedbackPanel from "./mcp-config/FeedbackPanel.svelte";
    import PermissionsPanel from "./mcp-config/PermissionsPanel.svelte";
    import PuppyPanel from "./mcp-config/PuppyPanel.svelte";
    import TelemetryPanel from "./mcp-config/TelemetryPanel.svelte";
    import ToolCategoriesPanel from "./mcp-config/ToolCategoriesPanel.svelte";
    import McpAppsPanel from "./mcp-config/McpAppsPanel.svelte";
    import UserRulesPanel from "./mcp-config/UserRulesPanel.svelte";
    import {
        discoverOfficialTools,
        type UiOfficialMcpDiscovery,
    } from "./official-plugin-tools";
    import {
        HTTP_GROUP_KEY,
        ICON_SVGS,
        PERM_GROUP_KEY,
        TOOL_GROUP_KEY,
        MCP_APPS_GROUP_KEY,
        PUPPY_GROUP_KEY,
        ANALYTICS_GROUP_KEY,
        DEBUG_GROUP_KEY,
        FEEDBACK_GROUP_KEY,
        USER_RULES_GROUP_KEY,
        type TabItem,
    } from "./mcp-config-tabs";

    export let plugin: any;

    interface NotebookInfo { id: string; name: string; closed?: boolean; }
    interface ChangeEvent { key: string; value: any; }

    const USER_RULES_GROUP_LABEL = "User Rules";
    const PUPPY_GROUP_LABEL = "Mascot Display";
    const PERM_GROUP_LABEL = "Permissions";
    const ANALYTICS_GROUP_LABEL = "Usage Stats";
    const DEBUG_GROUP_LABEL = "Settings & Debug";
    const FEEDBACK_GROUP_LABEL = "Feedback";
    const MCP_APPS_GROUP_LABEL = "MCP Apps";

    let config: ToolConfig = buildDefaultToolConfig();
    let httpSettings: HttpServerSettings = buildDefaultHttpServerSettings();
    let puppySettings: PuppySettings = buildDefaultPuppySettings();
    let telemetryConfig: TelemetryConfig = buildDefaultTelemetryConfig();
    let versionControlSettings: VersionControlSettings = buildDefaultVersionControlSettings();
    let permissionDisplaySettings: PermissionDisplaySettings = buildDefaultPermissionDisplaySettings();
    let focusGroup = "";
    let lastFocusGroup = "";
    let tabWrapElement: HTMLDivElement | null = null;
    let notebooks: NotebookInfo[] = [];
    let permissions: Record<string, NotebookPermission> = {};
    let permLoading = true;
    let extensionDiscovery: UiOfficialMcpDiscovery = {
        loading: false,
        connected: false,
        tools: [],
    };

    const getLabel = (key: string, fallback: string) => plugin?.i18n?.[key] ?? fallback;
    $: pluginIconUrl = `/plugins/${plugin?.name ?? "siyuan-plugins-mcp-sisyphus"}/icon.png`;

    $: httpGroupLabel = getLabel("httpServerTitle", HTTP_GROUP_KEY);
    $: permGroupLabel = getLabel(PERM_GROUP_KEY, PERM_GROUP_LABEL);
    $: puppyGroupLabel = getLabel(PUPPY_GROUP_KEY, PUPPY_GROUP_LABEL);
    $: analyticsGroupLabel = getLabel(ANALYTICS_GROUP_KEY, ANALYTICS_GROUP_LABEL);
    $: debugGroupLabel = getLabel(DEBUG_GROUP_KEY, DEBUG_GROUP_LABEL);
    $: feedbackGroupLabel = getLabel(FEEDBACK_GROUP_KEY, FEEDBACK_GROUP_LABEL);
    $: userRulesGroupLabel = getLabel(USER_RULES_GROUP_KEY, USER_RULES_GROUP_LABEL);

    $: toolGroupLabel = getLabel(TOOL_GROUP_KEY, TOOL_GROUP_KEY);
    $: mcpAppsGroupLabel = getLabel(MCP_APPS_GROUP_KEY, MCP_APPS_GROUP_LABEL);
    $: tabItems = [
        { id: HTTP_GROUP_KEY, label: httpGroupLabel, description: getLabel("settingsConnectionDesc", "Connect MCP clients or use the standalone CLI, then inspect the current service status."), iconSvg: ICON_SVGS.globe },
        { id: PERM_GROUP_KEY, label: permGroupLabel, description: getLabel("settingsPermissionsDesc", "Control which notebooks MCP clients can read, edit, or delete."), iconSvg: ICON_SVGS.lock },
        { id: TOOL_GROUP_KEY, label: toolGroupLabel, description: getLabel("settingsToolsDesc", "Choose the grouped tools and actions exposed to connected agents."), iconSvg: ICON_SVGS.folder },
        { id: MCP_APPS_GROUP_KEY, label: mcpAppsGroupLabel, description: getLabel("settingsMcpAppsDesc", "Control interactive MCP Apps and the actions performed manually inside them."), iconSvg: ICON_SVGS.layout },
        { id: PUPPY_GROUP_KEY, label: puppyGroupLabel, description: getLabel("settingsMascotDesc", "Adjust the on-screen mascot behavior and preview its appearance."), iconSvg: ICON_SVGS.paw },
        { id: ANALYTICS_GROUP_KEY, label: analyticsGroupLabel, description: getLabel("settingsAnalyticsDesc", "Review local usage patterns, activity trends, and tool statistics."), iconSvg: ICON_SVGS.barChart },
        { id: DEBUG_GROUP_KEY, label: debugGroupLabel, description: getLabel("settingsDebugDesc", "Manage safe-write behavior, runtime settings, diagnostics, and developer-oriented display options."), iconSvg: ICON_SVGS.bug },
        { id: USER_RULES_GROUP_KEY, label: userRulesGroupLabel, description: getLabel("settingsRulesDesc", "Add durable instructions and workspace memory for connected agents."), iconSvg: ICON_SVGS.compass },
        { id: FEEDBACK_GROUP_KEY, label: feedbackGroupLabel, description: getLabel("settingsFeedbackDesc", "Send problems, suggestions, or product experience directly to the developer."), iconSvg: ICON_SVGS.message },
    ] satisfies TabItem[];

    $: tabIds = tabItems.map((t) => t.id);
    $: if (!tabIds.includes(focusGroup)) {
        focusGroup = tabItems[0]?.id ?? "";
    }
    $: activeTab = tabItems.find((tab) => tab.id === focusGroup) ?? tabItems[0];

    $: if (focusGroup && focusGroup !== lastFocusGroup) {
        const nextFocusGroup = focusGroup;
        lastFocusGroup = nextFocusGroup;
        void tick().then(() => {
            if (focusGroup === nextFocusGroup) {
                tabWrapElement?.scrollTo({ top: 0, left: 0 });
            }
        });
    }

    async function loadNotebooks() {
        try {
            await new Promise<void>((resolve, reject) => {
                fetchPost("/api/notebook/lsNotebooks", {}, (resp: any) => {
                    if (resp?.code === 0) {
                        notebooks = (resp?.data?.notebooks ?? []).map((nb: any) => ({
                            id: nb.id,
                            name: nb.name,
                            closed: Boolean(nb.closed),
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

    async function refreshExtensionTools() {
        extensionDiscovery = { ...extensionDiscovery, loading: true, error: undefined };
        extensionDiscovery = await discoverOfficialTools();
    }

    onMount(async () => {
        config = await loadPersistedToolConfig(plugin);
        puppySettings = await loadPersistedPuppySettings(plugin);
        httpSettings = await loadPersistedHttpServerSettings(plugin);
        telemetryConfig = await loadPersistedTelemetryConfig(plugin);
        versionControlSettings = await loadPersistedVersionControlSettings(plugin);
        permissionDisplaySettings = await loadPersistedPermissionDisplaySettings(plugin);
        if (config.extension.enabled) {
            await refreshExtensionTools();
        }

        const savedPerms = await plugin?.loadData("notebookPermissions");
        if (savedPerms && typeof savedPerms === "object") {
            const normalizedPermissions = Object.fromEntries(
                Object.entries(savedPerms).map(([notebookId, permission]) => [notebookId, normalizeNotebookPermission(permission)]),
            );
            permissions = normalizedPermissions;
            if (JSON.stringify(savedPerms) !== JSON.stringify(normalizedPermissions)) {
                await plugin.saveData("notebookPermissions", normalizedPermissions);
            }
        }

        await loadNotebooks();
    });

    onMount(() => {
        const handlePermissionTreeChange = (event: Event) => {
            const detail = (event as CustomEvent<{ permissions?: unknown }>).detail;
            permissions = normalizeNotebookPermissions(detail?.permissions);
        };
        window.addEventListener(PERMISSION_TREE_CHANGED_EVENT, handlePermissionTreeChange);
        return () => window.removeEventListener(PERMISSION_TREE_CHANGED_EVENT, handlePermissionTreeChange);
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
                ...config[category],
                enabled: enabled ? true : hasEnabledActions ? config[category].enabled : false,
                actions: nextActions,
            },
        };
    }

    function setMcpAppEnabled(appName: keyof ToolConfig["mcpApps"], enabled: boolean) {
        config = { ...config, mcpApps: { ...config.mcpApps, [appName]: { ...config.mcpApps[appName], enabled } } };
    }

    function setMcpAppActionEnabled(appName: keyof ToolConfig["mcpApps"], action: string, enabled: boolean) {
        const appConfig = config.mcpApps[appName];
        config = {
            ...config,
            mcpApps: {
                ...config.mcpApps,
                [appName]: { ...appConfig, enabled: enabled ? true : appConfig.enabled, actions: { ...appConfig.actions, [action]: enabled } },
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
            plugin.refreshPermissionTreeIndicators?.(permissions);
        }
    }

    async function persistPermissionDisplaySettings() {
        if (plugin) {
            permissionDisplaySettings = await savePersistedPermissionDisplaySettings(permissionDisplaySettings, plugin);
            plugin.updatePermissionDisplaySettings?.(permissionDisplaySettings);
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

        if (key === "puppy__appearance__randomize") {
            puppySettings = {
                ...puppySettings,
                appearance: buildRandomPuppyAppearance(),
            };
            await persistPuppySettings();
            return;
        }

        if (key === "puppy__appearance__reset") {
            puppySettings = {
                ...puppySettings,
                appearance: buildDefaultPuppyAppearance(),
            };
            await persistPuppySettings();
            return;
        }

        if (key.startsWith("puppy__appearance__")) {
            const field = key.slice("puppy__appearance__".length).split("__")[0];
            if (field === "bodyColor" || field === "pawColor" || field === "eyeColor") {
                puppySettings = {
                    ...puppySettings,
                    appearance: {
                        ...puppySettings.appearance,
                        [field]: String(value ?? ""),
                    },
                };
                await persistPuppySettings();
                return;
            }
        }

        if (key.startsWith("perm__") && key !== "perm__hint") {
            const notebookId = key.slice("perm__".length);
            permissions = { ...permissions, [notebookId]: value as NotebookPermission };
            await persistPermissions();
            return;
        }

        if (key === "permissionDisplay__showInFileTree") {
            permissionDisplaySettings = {
                ...permissionDisplaySettings,
                showInFileTree: Boolean(value),
            };
            await persistPermissionDisplaySettings();
            return;
        }

        if (key === "writeSafety__strictMode") {
            const strictMode = Boolean(value);
            if (!strictMode && !window.confirm(getLabel(
                "write_safety_disable_confirm",
                "关闭严格安全写入后，旧写入调用将不再获得 Hash 并发校验、请求幂等和写后验证保护。确定继续吗？",
            ))) {
                config = { ...config };
                return;
            }
            config = {
                ...config,
                writeSafety: { ...config.writeSafety, strictMode },
            };
            await persistConfig();
            try {
                const restarted = await plugin?.refreshHttpServerAfterInstructionConfigChange?.();
                showMessage(getLabel(
                    restarted ? "write_safety_restarted" : "write_safety_saved_reconnect",
                    restarted
                        ? "写入安全模式已保存，MCP HTTP 服务已重启。请刷新或重新连接客户端以获取新 Schema。"
                        : "写入安全模式已保存。请刷新或重新连接 MCP 客户端以获取新 Schema。",
                ));
            } catch (error) {
                console.error("[MCP] refresh after write safety change failed:", error);
                showMessage(getLabel(
                    "write_safety_refresh_failed",
                    "写入安全模式已保存，但 MCP HTTP 服务重启失败。请手动重启并重新连接客户端。",
                ));
            }
            return;
        }

        if (key === "versionControl__enabled") {
            versionControlSettings = {
                ...versionControlSettings,
                enabled: Boolean(value),
            };
            await persistVersionControlSettings();
            return;
        }

        if (key === "telemetry__enabled") {
            telemetryConfig = { ...telemetryConfig, enabled: Boolean(value) };
            await persistTelemetryConfig();
            return;
        }

        if (key.endsWith("__enabled")) {
            const category = key.replace("__enabled", "") as ToolCategory;
            setCategoryEnabled(category, Boolean(value));
            await persistConfig();
            if (category === "extension" && value) {
                await refreshExtensionTools();
            }
            return;
        }

        if (key === "extension__include_native_tools") {
            config = {
                ...config,
                extension: {
                    ...config.extension,
                    includeNativeTools: Boolean(value),
                },
            };
            await persistConfig();
            if (value && !extensionDiscovery.connected) {
                await refreshExtensionTools();
            }
            return;
        }

        if (key.startsWith("extension__tool__")) {
            const toolName = decodeURIComponent(key.slice("extension__tool__".length));
            const blocked = new Set(config.extension.blockedTools);
            if (Boolean(value)) {
                blocked.delete(toolName);
            } else {
                blocked.add(toolName);
            }
            config = {
                ...config,
                extension: {
                    ...config.extension,
                    blockedTools: [...blocked].sort(),
                },
            };
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

        if (key === "userRulesText" || key === "agentSiyuanMemoryText") {
            const nextText = typeof value === "string" ? value : String(value ?? "");
            config = {
                ...config,
                [key]: nextText,
                ...(key === "agentSiyuanMemoryText"
                    ? { agentSiyuanMemoryUpdatedAt: nextText.trim() ? new Date().toISOString() : "" }
                    : {}),
            };
            await persistConfig();
            try {
                const refreshInstructionConfig = plugin?.refreshHttpServerAfterInstructionConfigChange ?? plugin?.refreshHttpServerAfterUserRulesChange;
                const restarted = await refreshInstructionConfig?.call(plugin);
                const isAgentMemoryChange = key === "agentSiyuanMemoryText";
                showMessage(restarted
                    ? getLabel(
                        isAgentMemoryChange ? "agent_memory_http_restarted" : "user_rules_http_restarted",
                        isAgentMemoryChange
                            ? "MCP HTTP server restarted. Reconnect or refresh connected MCP clients to apply updated agent memory."
                            : "MCP HTTP server restarted. Reconnect or refresh connected MCP clients to apply updated user rules.",
                    )
                    : getLabel(
                        isAgentMemoryChange ? "agent_memory_saved_reconnect" : "user_rules_saved_reconnect",
                        isAgentMemoryChange
                            ? "Agent memory saved. Reconnect or refresh MCP clients to apply updated initialize instructions."
                            : "User rules saved. Reconnect or refresh MCP clients to apply updated initialize instructions.",
                    ));
            } catch (err) {
                console.error("[MCP] refresh after user rules change failed:", err);
                const isAgentMemoryChange = key === "agentSiyuanMemoryText";
                showMessage(getLabel(
                    isAgentMemoryChange ? "agent_memory_refresh_failed" : "user_rules_refresh_failed",
                    isAgentMemoryChange
                        ? "Agent memory saved, but MCP HTTP server restart failed. Reconnect or restart it manually to apply updated memory."
                        : "User rules saved, but MCP HTTP server restart failed. Reconnect or restart it manually to apply updated rules.",
                ));
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

        if (key.startsWith("mcpApps__")) {
            const [, appName, kind, action] = key.split("__");
            if (appName && kind === "enabled") setMcpAppEnabled(appName as keyof ToolConfig["mcpApps"], Boolean(value));
            else if (appName && kind === "action" && action) setMcpAppActionEnabled(appName as keyof ToolConfig["mcpApps"], action, Boolean(value));
            await persistConfig();
            return;
        }

        const [category, , action] = key.split("__");
        if (category && action) {
            setActionEnabled(category as ToolCategory, action, Boolean(value));
            await persistConfig();
        }
    };

    export async function saveSettings() {
        await persistPuppySettings();
        await persistTelemetryConfig();
        await persistVersionControlSettings();
        await persistPermissionDisplaySettings();
        await persistConfig();
        showMessage(plugin?.i18n?.mcpConfigSaved || "✅ MCP Tools configuration saved");
    }

    export async function resetDefaults() {
        config = normalizeToolConfig(buildDefaultToolConfig());
        puppySettings = normalizePuppySettings(buildDefaultPuppySettings());
        telemetryConfig = buildDefaultTelemetryConfig();
        versionControlSettings = buildDefaultVersionControlSettings();
        permissionDisplaySettings = buildDefaultPermissionDisplaySettings();
        await persistConfig();
        await persistPuppySettings();
        await persistTelemetryConfig();
        await persistVersionControlSettings();
        await persistPermissionDisplaySettings();
        showMessage(plugin?.i18n?.mcpConfigReset || "🔄 MCP Tools configuration reset to defaults");
    }


</script>

<div class="fn__flex-1 fn__flex config__panel">
    <aside class="config__sidebar">
        <div class="config__brand">
            <span class="config__brand-mark" aria-hidden="true">
                <img src={pluginIconUrl} alt="" />
            </span>
            <span class="config__brand-copy">
                <strong>Sisyphus</strong>
                <span>{getLabel("settingsBrandSubtitle", "MCP workspace control")}</span>
            </span>
        </div>
        <nav class="config__navigation" aria-label={getLabel("settingsNavigationLabel", "Settings navigation")}>
            {#each tabItems as tab}
                <button
                    type="button"
                    data-name="mcp-config"
                    class:config__nav-item--active={tab.id === focusGroup}
                    class="config__nav-item"
                    aria-current={tab.id === focusGroup ? "page" : undefined}
                    on:click={() => {
                        focusGroup = tab.id;
                    }}
                >
                    <span class="config__nav-icon" aria-hidden="true">{@html tab.iconSvg}</span>
                    <span class="config__nav-label">{tab.label}</span>
                </button>
            {/each}
        </nav>
    </aside>
    <div class="config__tab-wrap">
        <div class="config__tab-scroll" bind:this={tabWrapElement}>
            <div class="config__tab-content">
                {#if activeTab}
                    <header class="config__page-header">
                        <span class="config__page-icon" aria-hidden="true">{@html activeTab.iconSvg}</span>
                        <div>
                            <h2>{activeTab.label}</h2>
                            <p>{activeTab.description}</p>
                        </div>
                    </header>
                {/if}
                <HttpServerPanel {plugin} group={httpGroupLabel} display={focusGroup === HTTP_GROUP_KEY} bind:httpSettings {getLabel} />
                <PermissionsPanel group={permGroupLabel} display={focusGroup === PERM_GROUP_KEY} {notebooks} {permissions} {permissionDisplaySettings} {permLoading} {getLabel} {onChanged} />
                <ToolCategoriesPanel
                    group={toolGroupLabel}
                    display={focusGroup === TOOL_GROUP_KEY}
                    {config}
                    {getLabel}
                    {onChanged}
                    {extensionDiscovery}
                    onRefreshExtensionTools={refreshExtensionTools}
                />
                <McpAppsPanel display={focusGroup === MCP_APPS_GROUP_KEY} {config} {getLabel} {onChanged} />
                <PuppyPanel group={puppyGroupLabel} display={focusGroup === PUPPY_GROUP_KEY} {puppySettings} {getLabel} {onChanged} />
                <TelemetryPanel
                    analyticsGroup={analyticsGroupLabel}
                    analyticsDisplay={focusGroup === ANALYTICS_GROUP_KEY}
                    telemetryGroup=""
                    showTelemetry={false}
                    currentToolConfig={config}
                    {telemetryConfig}
                    {getLabel}
                    {onChanged}
                />
                <DebugPanel group={debugGroupLabel} display={focusGroup === DEBUG_GROUP_KEY} {config} {puppySettings} {versionControlSettings} {getLabel} {onChanged} />
                <UserRulesPanel group={userRulesGroupLabel} display={focusGroup === USER_RULES_GROUP_KEY} {config} {getLabel} {onChanged} />
                <FeedbackPanel group={feedbackGroupLabel} display={focusGroup === FEEDBACK_GROUP_KEY} {plugin} {getLabel} />
            </div>
        </div>
    </div>
</div>

<style lang="scss">
    .config__panel {
        --mcp-config-sidebar-width: 208px;
        --mcp-config-content-padding: 28px 32px 36px;
        --mcp-config-content-max-width: 920px;
        --mcp-config-card-radius: max(12px, var(--b3-border-radius, 6px));
        --mcp-config-control-radius: max(9px, var(--b3-border-radius, 6px));
        --mcp-config-icon-radius: max(10px, var(--b3-border-radius, 6px));
        --mcp-config-card-padding: 17px 19px;
        --mcp-config-section-gap: 16px;
        --mcp-config-title-color: var(--b3-theme-on-background);
        --mcp-config-title-font-size: 14px;
        --mcp-config-title-font-weight: 600;
        --mcp-config-caption-color: var(--b3-theme-on-surface-light, var(--b3-theme-on-surface));
        --mcp-config-code-font: var(--b3-font-family-code, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
        --mcp-config-surface: color-mix(in srgb, var(--b3-theme-surface) 91%, var(--b3-theme-background));
        --mcp-config-surface-raised: color-mix(in srgb, var(--b3-theme-surface) 97%, var(--b3-theme-background));
        --mcp-config-border: color-mix(in srgb, var(--b3-border-color) 88%, transparent);
        --mcp-config-primary-soft: color-mix(in srgb, var(--b3-theme-primary) 13%, transparent);
        --mcp-config-primary-border: color-mix(in srgb, var(--b3-theme-primary) 28%, transparent);
        --mcp-config-surface-accent: linear-gradient(135deg, var(--mcp-config-primary-soft), transparent 70%), var(--mcp-config-surface-raised);
        --mcp-config-shadow:
            0 1px 2px color-mix(in srgb, var(--b3-theme-on-background) 7%, transparent),
            0 8px 24px color-mix(in srgb, var(--b3-theme-on-background) 3%, transparent);

        box-sizing: border-box;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        font-size: 13px;
        gap: 0;
        height: 100%;
        line-height: 1.5;
        min-height: 0;
        min-width: 0;
        padding: 0;
        width: 100%;
    }

    .config__sidebar {
        box-sizing: border-box;
        flex: 0 0 var(--mcp-config-sidebar-width);
        max-width: var(--mcp-config-sidebar-width);
        min-width: var(--mcp-config-sidebar-width);
        width: var(--mcp-config-sidebar-width);
        padding: 20px 14px 16px;
        border-right: 1px solid var(--b3-border-color);
        background: color-mix(in srgb, var(--b3-theme-surface) 72%, var(--b3-theme-background));
        overflow-y: auto;
    }

    .config__brand {
        align-items: center;
        display: flex;
        gap: 11px;
        min-width: 0;
        padding: 2px 8px 20px;
    }

    .config__page-icon {
        align-items: center;
        background: var(--mcp-config-primary-soft);
        border: 1px solid var(--mcp-config-primary-border);
        color: var(--b3-theme-primary);
        display: inline-flex;
        justify-content: center;
    }

    .config__brand-mark {
        background: var(--mcp-config-surface-raised);
        border: 1px solid var(--mcp-config-border);
        border-radius: var(--mcp-config-icon-radius);
        box-shadow: var(--mcp-config-shadow);
        display: inline-flex;
        flex: 0 0 36px;
        height: 36px;
        overflow: hidden;
        width: 36px;
    }

    .config__brand-mark img {
        display: block;
        height: 100%;
        object-fit: cover;
        width: 100%;
    }

    .config__brand-copy {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .config__brand-copy strong {
        color: var(--mcp-config-title-color);
        font-size: 15px;
        font-weight: 650;
        letter-spacing: 0.01em;
    }

    .config__brand-copy span {
        color: var(--mcp-config-caption-color);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .config__navigation {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .config__nav-item {
        align-items: center;
        appearance: none;
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--mcp-config-control-radius);
        box-sizing: border-box;
        color: var(--mcp-config-caption-color);
        cursor: pointer;
        display: flex;
        font: inherit;
        gap: 10px;
        min-height: 38px;
        min-width: 0;
        padding: 7px 10px;
        text-align: left;
        transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
        width: 100%;
    }

    .config__nav-item:hover {
        background: var(--b3-list-hover);
        color: var(--mcp-config-title-color);
    }

    .config__nav-item:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--b3-theme-primary) 48%, transparent);
        outline-offset: 1px;
    }

    .config__nav-item--active {
        background: var(--mcp-config-primary-soft);
        border-color: var(--mcp-config-primary-border);
        color: var(--b3-theme-primary);
        font-weight: 600;
    }

    .config__nav-icon {
        align-items: center;
        color: currentColor;
        display: inline-flex;
        flex: 0 0 18px;
        height: 18px;
        justify-content: center;
        width: 18px;
    }

    .config__nav-icon :global(svg) {
        height: 17px;
        width: 17px;
    }

    .config__nav-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .config__tab-wrap {
        flex: 1 1 auto;
        box-sizing: border-box;
        min-width: 0;
        min-height: 0;
        height: 100%;
        overflow: hidden;
    }

    .config__tab-scroll {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        scroll-behavior: smooth;
    }

    .config__tab-content {
        box-sizing: border-box;
        min-height: 100%;
        padding: var(--mcp-config-content-padding);
    }

    .config__page-header {
        align-items: flex-start;
        display: flex;
        gap: 14px;
        margin: 0 0 24px;
        max-width: var(--mcp-config-content-max-width);
    }

    .config__page-icon {
        border-radius: var(--mcp-config-icon-radius);
        flex: 0 0 40px;
        height: 40px;
        width: 40px;
    }

    .config__page-icon :global(svg) {
        height: 21px;
        width: 21px;
    }

    .config__page-header h2 {
        color: var(--mcp-config-title-color);
        font-size: 20px;
        font-weight: 650;
        line-height: 1.35;
        margin: 0;
    }

    .config__page-header p {
        color: var(--mcp-config-caption-color);
        font-size: 12px;
        line-height: 1.6;
        margin: 4px 0 0;
        max-width: 680px;
    }

    .config__tab-content :global(.config__tab-container) {
        box-sizing: border-box;
        width: 100%;
        max-width: var(--mcp-config-content-max-width);
        margin-right: auto;
    }

    .config__tab-content :global(.b3-button) {
        border-radius: var(--mcp-config-control-radius);
        font-weight: 550;
        min-height: 32px;
        transition: background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, color 0.14s ease, transform 0.14s ease;
    }

    .config__tab-content :global(.b3-button:not(:disabled):hover) {
        box-shadow: 0 2px 8px color-mix(in srgb, var(--b3-theme-on-background) 8%, transparent);
    }

    .config__tab-content :global(.b3-text-field),
    .config__tab-content :global(.b3-select) {
        border-radius: var(--mcp-config-control-radius);
        transition: background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
    }

    .config__tab-content :global(.b3-text-field:hover),
    .config__tab-content :global(.b3-select:hover) {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 24%, var(--b3-border-color));
    }

    .config__tab-content :global(.b3-text-field:focus),
    .config__tab-content :global(.b3-select:focus) {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 66%, var(--b3-border-color));
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--b3-theme-primary) 11%, transparent);
        outline: none;
    }

    @media (max-width: 768px) {
        .config__panel {
            --mcp-config-content-padding: 18px 16px 28px;
            --mcp-config-card-padding: 12px 14px;
            --mcp-config-section-gap: 10px;

            flex-direction: column;
        }

        .config__sidebar {
            border-bottom: 1px solid var(--b3-border-color);
            border-right: 0;
            flex: 0 0 auto;
            max-width: none;
            min-width: 0;
            overflow: hidden;
            padding: 10px 12px;
            width: 100%;
        }

        .config__brand {
            display: none;
        }

        .config__navigation {
            display: flex;
            flex-direction: row;
            gap: 6px;
            overflow-x: auto;
            padding-bottom: 2px;
            scrollbar-width: thin;
        }

        .config__nav-item {
            flex: 0 0 auto;
            min-height: 36px;
            padding: 6px 10px;
            width: auto;
        }

        .config__tab-wrap {
            flex: 1;
            height: auto;
        }

        .config__page-header {
            gap: 12px;
            margin-bottom: 18px;
        }

        .config__page-icon {
            flex-basis: 38px;
            height: 38px;
            width: 38px;
        }

        .config__page-header h2 {
            font-size: 18px;
        }
    }
</style>
