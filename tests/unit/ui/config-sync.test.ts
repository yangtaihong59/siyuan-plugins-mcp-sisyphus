import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as mcpConfig from '@/core/config';
import * as settingConfig from '@/ui/setting/tool-config';
import {
    DEFAULT_PUPPY_APPEARANCE,
    buildDefaultPermissionDisplaySettings,
    buildDefaultPuppySettings,
    buildDefaultVersionControlSettings,
    normalizePuppySettings,
    normalizePermissionDisplaySettings,
    normalizeVersionControlSettings,
} from '@/ui/setting/tool-config-storage';

describe('setting and mcp config stay behaviorally aligned', () => {
    it('re-exports the mcp config helpers directly', () => {
        expect(settingConfig.buildDefaultToolConfig).toBe(mcpConfig.buildDefaultToolConfig);
        expect(settingConfig.normalizeToolConfig).toBe(mcpConfig.normalizeToolConfig);
        expect(settingConfig.isDangerousAction).toBe(mcpConfig.isDangerousAction);
    });

    it('keeps defaults aligned', () => {
        expect(settingConfig.buildDefaultToolConfig()).toEqual(mcpConfig.buildDefaultToolConfig());
    });

    it('keeps exported action metadata aligned', () => {
        expect(settingConfig.TOOL_CATEGORIES).toEqual(mcpConfig.TOOL_CATEGORIES);
        expect(settingConfig.FS_ACTIONS).toEqual(mcpConfig.FS_ACTIONS);
        expect(settingConfig.NOTEBOOK_ACTIONS).toEqual(mcpConfig.NOTEBOOK_ACTIONS);
        expect(settingConfig.DOCUMENT_ACTIONS).toEqual(mcpConfig.DOCUMENT_ACTIONS);
        expect(settingConfig.BLOCK_ACTIONS).toEqual(mcpConfig.BLOCK_ACTIONS);
        expect(settingConfig.AV_ACTIONS).toEqual(mcpConfig.AV_ACTIONS);
        expect(settingConfig.FILE_ACTIONS).toEqual(mcpConfig.FILE_ACTIONS);
        expect(settingConfig.SEARCH_ACTIONS).toEqual(mcpConfig.SEARCH_ACTIONS);
        expect(settingConfig.TAG_ACTIONS).toEqual(mcpConfig.TAG_ACTIONS);
        expect(settingConfig.SYSTEM_ACTIONS).toEqual(mcpConfig.SYSTEM_ACTIONS);
        expect(settingConfig.FLASHCARD_ACTIONS).toEqual(mcpConfig.FLASHCARD_ACTIONS);
        expect(settingConfig.MASCOT_ACTIONS).toEqual(mcpConfig.MASCOT_ACTIONS);
        expect(settingConfig.FEEDBACK_ACTIONS).toEqual(mcpConfig.FEEDBACK_ACTIONS);
    });

    it('keeps normalization aligned for nested shapes', () => {
        const samples: unknown[] = [
            undefined,
            {
                userRulesText: 'Always set icons.',
                file: {
                    enabled: true,
                    uploadLargeFileThresholdMB: 27.7,
                    actions: {
                        upload_asset: false,
                        render: true,
                    },
                },
                flashcard: {
                    enabled: true,
                    actions: {
                        remove_card: false,
                    },
                },
            },
        ];

        for (const sample of samples) {
            expect(settingConfig.normalizeToolConfig(sample)).toEqual(mcpConfig.normalizeToolConfig(sample));
        }
    });

    it('keeps danger detection aligned', () => {
        for (const category of settingConfig.TOOL_CATEGORIES) {
            for (const action of settingConfig.ACTIONS_BY_CATEGORY[category]) {
                expect(settingConfig.isDangerousAction(category, action)).toBe(
                    mcpConfig.isDangerousAction(category, action),
                );
            }
        }
    });

    it('lists block replace in the settings panel', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');

        expect(source).toContain('ACTIONS_BY_CATEGORY');
        expect(source).toContain('buildCompleteGroupDefinitions');
        expect(source).toContain('category: "block"');
        expect(source).toContain('key: "replace"');
        expect(source).toContain('Replace Block Text');
        expect(source).toContain('category: "mascot"');
        expect(source).toContain('category: "feedback"');
        expect(source).toContain('category: "timeline"');
        expect(source).toContain('key: "rollback_document"');
    });

    it('renders MCP App permissions on a separate settings page', () => {
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');
        const appsSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/McpAppsPanel.svelte'), 'utf8');

        expect(panelSource).not.toContain('timeline__app_action__');
        expect(rootSource).toContain('{ id: MCP_APPS_GROUP_KEY');
        expect(rootSource).toContain('key.startsWith("mcpApps__")');
        expect(appsSource).toContain('config.mcpApps[definition.key]');
        expect(appsSource).toContain('mcpApps__${definition.key}__action__${action.key}');
    });

    it('keeps tool categories grouped under one settings page', () => {
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');

        expect(rootSource).toContain('{ id: TOOL_GROUP_KEY, label: toolGroupLabel, description: getLabel("settingsToolsDesc"');
        expect(rootSource).not.toContain('...CATEGORY_TAB_DEFS.map');
        expect(panelSource).toContain('tool-settings-accordion');
        expect(panelSource).toContain('tool-settings-group__header');
        expect(panelSource).toContain('dispatchToolToggle');
        expect(panelSource).toContain('SettingPanel');
    });

    it('renders the category enable switch only in the accordion header', () => {
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');

        expect(panelSource).toContain('class="tool-settings-group__switch"');
        expect(panelSource).toContain('dispatchToolToggle(definition.category, event.currentTarget.checked)');
        expect(panelSource).toContain('return buildActionItems(definition);');
        expect(panelSource).not.toMatch(/return \[\s*\.\.\.buildActionItems\(definition\),/);
        expect(panelSource).not.toContain('function buildToolToggleItem');
    });

    it('renders a semantic responsive settings shell with centralized page metadata', () => {
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');
        const tabsSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config-tabs.ts'), 'utf8');

        expect(tabsSource).toContain('description: string;');
        expect(rootSource.match(/description: getLabel\("settings[A-Za-z]+Desc"/g)).toHaveLength(10);
        expect(rootSource).toContain('<aside class="config__sidebar">');
        expect(rootSource).toContain('<nav class="config__navigation"');
        expect(rootSource).toContain('class="config__nav-item"');
        expect(rootSource).toContain('aria-current={tab.id === focusGroup ? "page" : undefined}');
        expect(rootSource).toContain('<header class="config__page-header">');
        expect(rootSource).toContain('overflow-x: auto;');
        expect(rootSource).not.toContain('.b3-list-item__text {\n            display: none');
    });

    it('keeps embedding settings on a native-AI-only page without plugin persistence', () => {
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/EmbeddingPanel.svelte'), 'utf8');

        expect(rootSource).toContain('{ id: EMBEDDING_GROUP_KEY');
        expect(rootSource).toContain('<EmbeddingPanel display={focusGroup === EMBEDDING_GROUP_KEY}');
        expect(panelSource).toContain('type="password"');
        expect(panelSource).toContain('/api/system/getConf');
        expect(panelSource).toContain('/api/setting/setAI');
        expect(panelSource).toContain('/api/ai/testEmbeddingModel');
        expect(panelSource).toContain('/api/ai/embeddingStat');
        expect(panelSource).toContain('/api/ai/reindexEmbedding');
        expect(panelSource).toContain('/api/ai/retryFailedEmbedding');
        expect(panelSource).toContain('window.setInterval(() => void refreshStats(), 3000)');
        expect(panelSource).toContain('window.clearInterval(statsTimer)');
        expect(panelSource).not.toContain('plugin.saveData');
        expect(panelSource).not.toContain('savePersisted');
        expect(panelSource).not.toContain('console.');
    });

    it('keeps the settings pages on one shared visual system', () => {
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');

        expect(rootSource).toContain('--mcp-config-card-radius: max(12px');
        expect(rootSource).toContain('--mcp-config-control-radius: max(9px');
        expect(rootSource).toContain('--mcp-config-card-padding: 17px 19px');
        expect(rootSource).toContain('.config__tab-content :global(.b3-button)');
        expect(rootSource).toContain('.config__tab-content :global(.b3-text-field)');
        expect(rootSource).toContain('.config__tab-content :global(.b3-select)');
    });

    it('adds hierarchy to dense settings pages without changing their behavior', () => {
        const rulesSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/UserRulesPanel.svelte'), 'utf8');
        const debugSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/DebugPanel.svelte'), 'utf8');
        const connectionSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/HttpServerPanel.svelte'), 'utf8');
        const analyticsSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/TelemetryPanel.svelte'), 'utf8');

        expect(rulesSource).toContain('user-rules-editor__index');
        expect(rulesSource).toContain('user_rules_auto_save');
        expect(rulesSource).toContain('user_rules_reconnect_hint');
        expect(debugSource.match(/<section class="debug-section">/g)).toHaveLength(2);
        expect(debugSource).toContain('debug_runtime_section');
        expect(debugSource).toContain('debug_test_section');
        expect(connectionSource).toContain('class="http-changelog"');
        expect(connectionSource).toContain('toolSettingsChangelogBadge');
        expect(connectionSource).toContain('parseChangelogEntries');
        expect(connectionSource).toContain('let changelogExpanded = false;');
        expect(connectionSource).toContain('changelogEntries.slice(0, 1)');
        expect(connectionSource).toContain('parseChangelogDescription');
        expect(connectionSource).toContain('<strong>{segment.text}</strong>');
        expect(connectionSource).toContain('aria-expanded={changelogExpanded}');
        expect(connectionSource).toContain('class="http-changelog-timeline"');
        expect(connectionSource).toContain('class:http-changelog-timeline--collapsed={!changelogExpanded}');
        expect(connectionSource).toContain('class:http-changelog-timeline__item--latest={index === 0}');
        expect(connectionSource).toContain('max-height: calc(var(--changelog-item-height) * 3)');
        expect(connectionSource).toContain('overflow-y: auto;');
        expect(connectionSource).toContain('<time datetime={entry.date}>{entry.date}</time>');
        expect(connectionSource.match(/<details class="http-guide">/g)).toHaveLength(2);
        expect(connectionSource.match(/class="ai-setup-card"/g)).toHaveLength(2);
        expect(connectionSource).toContain('generateMcpAiSetupPrompt');
        expect(connectionSource).toContain('generateCliAiSetupPrompt');
        expect(connectionSource).toContain('class="experimental-features"');
        expect(connectionSource).toContain('skillsExtensionEnabled');
        expect(connectionSource).not.toContain('skillsExtensionCatalog');
        expect(analyticsSource).toContain('class="analytics-heatmap"');
        expect(analyticsSource).toContain('analytics-heatmap__cell--level-4');
        expect(analyticsSource).not.toContain('analytics-heatmap__legend');
        expect(analyticsSource).toContain('grid-template-columns: repeat(52, minmax(8px, 1fr))');
        expect(analyticsSource).toContain('buildDailyHeatmap');
        expect(analyticsSource).toContain('52 * 7');
        expect(analyticsSource).toContain('class="analytics-bar-chart"');
        expect(analyticsSource).toContain('class="analytics-bar-chart__summary"');
        expect(analyticsSource).toContain('class="analytics-donut"');
        expect(analyticsSource).toContain('class="analytics-token-chart"');
        expect(analyticsSource).toContain('buildTransportGradient');
        expect(analyticsSource).not.toContain('class="analytics-list"');
        expect(analyticsSource).toContain('analytics-actions__primary');
        expect(analyticsSource).toContain('analytics-actions__danger');
    });

    it('uses stable tab keys to display the analytics panel', () => {
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/TelemetryPanel.svelte'), 'utf8');
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');

        expect(rootSource).toContain('analyticsDisplay={focusGroup === ANALYTICS_GROUP_KEY}');
        expect(rootSource).toContain('display={focusGroup === FEEDBACK_GROUP_KEY}');
        expect(panelSource).toContain('export let analyticsDisplay = true;');
        expect(panelSource).toContain('display={analyticsDisplay}');
        expect(panelSource).not.toContain('display={focusGroup === analyticsGroup}');
    });

    it('keeps accordion state reactive when categories are toggled', () => {
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');

        expect(panelSource).toContain('openCategories;');
        expect(panelSource).toContain('groupDefinitions = GROUP_DEFINITIONS.map');
    });

    it('keeps notebook permission rows reactive after notebooks load', () => {
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/PermissionsPanel.svelte'), 'utf8');
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');

        expect(rootSource).toContain('closed: Boolean(nb.closed)');
        expect(panelSource).toContain('notebooks;');
        expect(panelSource).toContain('permissions;');
        expect(panelSource).toContain('permissionDisplaySettings;');
        expect(panelSource).toContain('permissionDisplay__showInFileTree');
        expect(panelSource).toContain('type: "checkbox"');
        expect(panelSource).not.toContain('type: "switch"');
        expect(rootSource).toContain('PERMISSION_TREE_CHANGED_EVENT');
        expect(rootSource).toContain('handlePermissionTreeChange');
        expect(panelSource).toContain('permLoading;');
        expect(panelSource).toContain('permItems = buildPermItems();');
        expect(panelSource).toContain('closedPermItems = buildClosedPermItems();');
        expect(panelSource).toContain('mcpPermClosedGroup');
        expect(panelSource).toContain('permissionCounts');
        expect(panelSource).toContain('permission-overview');
        expect(panelSource).toContain('description: ""');
        expect(panelSource).not.toContain('mcpPermDesc');
        expect(panelSource).toContain('sisyphus-permission-badge');
        expect(panelSource).toContain('buildPermissionTreeDescription()');
        expect(panelSource).not.toContain('mcpPermClosedHint');
    });

    it('defaults the file-tree permission indicator to enabled and preserves an explicit opt-out', () => {
        expect(buildDefaultPermissionDisplaySettings()).toEqual({ showInFileTree: true });
        expect(normalizePermissionDisplaySettings(undefined)).toEqual({ showInFileTree: true });
        expect(normalizePermissionDisplaySettings({ showInFileTree: false })).toEqual({ showInFileTree: false });
        expect(normalizePermissionDisplaySettings({ showInFileTree: 'no' })).toEqual({ showInFileTree: true });
    });

    it('wires the permission indicator into plugin lifecycle and websocket file-tree refreshes', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');

        expect(source).toContain('this.syncPermissionTreeFeature();');
        expect(source).toContain('eventBus.on("ws-main", this.handlePermissionTreeWebSocket as any)');
        expect(source).toContain('event?.detail?.cmd === "reloadFiletree"');
        expect(source).toContain('clearPermissionTreeIndicators(document)');
        expect(source).toContain('this.disablePermissionTreeFeature();');
        expect(source).toContain('handlePermissionTreeBadgeClick');
        expect(source).toContain('getNextNotebookPermission(currentPermission)');
        expect(source).toContain('event.stopImmediatePropagation()');
    });

    it('keeps mascot tool settings out of the mascot display panel', () => {
        const puppySource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/PuppyPanel.svelte'), 'utf8');
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');

        expect(puppySource).not.toContain('mascot__enabled');
        expect(puppySource).not.toContain('mascot__action__');
        expect(panelSource).toContain('category: "mascot"');
        expect(panelSource).toContain('groupKey: "Mascot Tool"');
    });

    it('keeps feedback form separate from tool toggles', () => {
        const feedbackSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/FeedbackPanel.svelte'), 'utf8');
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');

        expect(feedbackSource).toContain('submitFeedback');
        expect(feedbackSource).toContain('feedback_description_label');
        expect(feedbackSource).toContain('feedback_impact_label');
        expect(feedbackSource).toContain('feedback_suggestion_label');
        expect(feedbackSource).not.toContain('feedback_agent_label');
        expect(feedbackSource).not.toContain('bind:value={agent}');
        expect(panelSource).toContain('groupKey: "Feedback Tool"');
        expect(panelSource).toContain('key: "submit"');
    });

    it('gives the feedback form a clear primary flow and responsive secondary fields', () => {
        const feedbackSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/FeedbackPanel.svelte'), 'utf8');

        expect(feedbackSource).toContain('<form class="feedback-panel__form" on:submit|preventDefault={submit}>');
        expect(feedbackSource).toContain('class="feedback-panel__secondary-grid"');
        expect(feedbackSource).toContain('class="b3-button feedback-panel__submit" type="submit"');
        expect(feedbackSource).toContain('aria-live="polite"');
        expect(feedbackSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
        expect(feedbackSource).toContain('grid-template-columns: 1fr;');
    });

    it('keeps user custom rules editable while preserving deferred save behavior', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/UserRulesPanel.svelte'), 'utf8');

        expect(source).not.toContain('$: userRulesText = config.userRulesText');
        expect(source).toContain('hasDraftChanges');
        expect(source).toContain('agentSiyuanMemoryText');
        expect(source).toContain('AGENT_MEMORY_KEY = "agentSiyuanMemoryText"');
        expect(source).toContain('agent_memory_title');
        expect(source).toContain('on:input={markDraftChanged}');
        expect(source).toContain('on:input={markAgentMemoryDraftChanged}');
        expect(source).toContain('on:blur={dispatchChanged}');
        expect(source).toContain('on:blur={dispatchAgentMemoryChanged}');
        expect(source).toContain('lastSyncedUserRulesText = userRulesText');
        expect(source).toContain('lastSyncedAgentSiyuanMemoryText = agentSiyuanMemoryText');
    });

    it('persists agent memory through the same instruction refresh path as user rules', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');

        expect(source).toContain('key === "userRulesText" || key === "agentSiyuanMemoryText"');
        expect(source).toContain('agentSiyuanMemoryUpdatedAt');
        expect(source).toContain('refreshHttpServerAfterInstructionConfigChange');
        expect(source).toContain('refreshHttpServerAfterUserRulesChange');
    });

    it('keeps mascot display appearance settings in the mascot display panel', () => {
        const puppySource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/PuppyPanel.svelte'), 'utf8');
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');
        const formSource = readFileSync(resolve(process.cwd(), 'src/ui/shared/Form/form-input.svelte'), 'utf8');

        expect(puppySource).toContain('puppy__appearance__randomize');
        expect(puppySource).toContain('puppy__appearance__reset');
        expect(puppySource).toContain('puppy__appearance__bodyColor');
        expect(puppySource).toContain('puppy__appearance__pawColor');
        expect(puppySource).toContain('puppy__appearance__eyeColor');
        expect(puppySource).toContain('value={puppySettings.appearance.bodyColor}');
        expect(puppySource).toContain('on:input={(event) => emitColor("bodyColor", event)}');
        expect(puppySource).toContain('PuppyAwakeSVG');
        expect(puppySource).toContain('puppy-preview');
        expect(puppySource).toContain('class="puppy-preview__appearance"');
        expect(puppySource).toContain('class="puppy-preview__buttons"');
        expect(puppySource).not.toContain('class="puppy-appearance-actions"');
        expect(puppySource).not.toContain('class="config__tab-container puppy-appearance-panel"');
        expect(rootSource).toContain('buildRandomPuppyAppearance');
        expect(rootSource).toContain('buildDefaultPuppyAppearance');
        expect(rootSource).toContain('key.startsWith("puppy__appearance__")');
        expect(formSource).toContain('type === "color"');
    });

    it('uses the bundled plugin icon for the settings brand while keeping the paw for mascot navigation', () => {
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');

        expect(rootSource).toContain('/plugins/${plugin?.name ?? "siyuan-plugins-mcp-sisyphus"}/icon.png');
        expect(rootSource).toContain('<img src={pluginIconUrl} alt="" />');
        expect(rootSource).toContain('iconSvg: ICON_SVGS.paw');
    });

    it('keeps document timeline enable switch in debug settings', () => {
        const debugSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/DebugPanel.svelte'), 'utf8');
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');

        expect(debugSource).toContain('versionControl__enabled');
        expect(debugSource).toContain('version_control_enabled_title');
        expect(debugSource).toContain('buildDebugItems(config, puppySettings, versionControlSettings, getLabel)');
        expect(rootSource).toContain('key === "versionControl__enabled"');
    });

    it('places strict safe writes in Settings & Debug instead of Permissions', () => {
        const debugSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/DebugPanel.svelte'), 'utf8');
        const permissionsSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/PermissionsPanel.svelte'), 'utf8');

        expect(debugSource).toContain('key: "writeSafety__strictMode"');
        expect(debugSource).toContain('write_safety_strict_title');
        expect(permissionsSource).not.toContain('writeSafety__strictMode');
    });

    it('rebuilds persisted settings panels from explicit Svelte reactive dependencies', () => {
        const debugSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/DebugPanel.svelte'), 'utf8');
        const puppySource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/PuppyPanel.svelte'), 'utf8');
        const telemetrySource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/TelemetryPanel.svelte'), 'utf8');
        const permissionsSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/PermissionsPanel.svelte'), 'utf8');

        expect(debugSource).toContain('buildDebugItems(config, puppySettings, versionControlSettings, getLabel)');
        expect(debugSource).not.toContain('$: debugItems = buildDebugItems();');
        expect(puppySource).toContain('buildPuppyItems(puppySettings, getLabel)');
        expect(puppySource).not.toContain('$: puppyItems = buildPuppyItems();');
        expect(telemetrySource).toContain('buildTelemetryItems(telemetryConfig, getLabel)');
        expect(telemetrySource).not.toContain('$: telemetryItems = buildTelemetryItems();');
        expect(permissionsSource).toContain('permItems = buildPermItems();');
    });

    it('handles non-tool enabled toggles before generic category toggles', () => {
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');
        const genericEnabledIndex = rootSource.indexOf('key.endsWith("__enabled")');

        expect(rootSource.indexOf('key === "versionControl__enabled"')).toBeGreaterThanOrEqual(0);
        expect(rootSource.indexOf('key === "telemetry__enabled"')).toBeGreaterThanOrEqual(0);
        expect(rootSource.indexOf('key === "versionControl__enabled"')).toBeLessThan(genericEnabledIndex);
        expect(rootSource.indexOf('key === "telemetry__enabled"')).toBeLessThan(genericEnabledIndex);
    });

    it('saves independent debug-related setting stores from the settings dialog save hook', () => {
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');
        const saveSettingsIndex = rootSource.indexOf('export async function saveSettings()');

        expect(saveSettingsIndex).toBeGreaterThanOrEqual(0);
        expect(rootSource.indexOf('await persistPuppySettings();', saveSettingsIndex)).toBeGreaterThan(saveSettingsIndex);
        expect(rootSource.indexOf('await persistTelemetryConfig();', saveSettingsIndex)).toBeGreaterThan(saveSettingsIndex);
        expect(rootSource.indexOf('await persistVersionControlSettings();', saveSettingsIndex)).toBeGreaterThan(saveSettingsIndex);
        expect(rootSource.indexOf('await persistConfig();', saveSettingsIndex)).toBeGreaterThan(saveSettingsIndex);
    });

    it('dispatches checkbox changes from DOM checked state', () => {
        const formSource = readFileSync(resolve(process.cwd(), 'src/ui/shared/Form/form-input.svelte'), 'utf8');

        expect(formSource).toContain('event.currentTarget');
        expect(formSource).toContain('target.checked');
        expect(formSource).toContain('target.type === "checkbox"');
        expect(formSource).toContain('dispatch("changed", { key: key, value: nextValue })');
    });

    it('keeps mascot appearance defaults shared across settings and runtime display', () => {
        const toolPuppySource = readFileSync(resolve(process.cwd(), 'src/ui/components/ToolPuppy.svelte'), 'utf8');
        const awakeSvgSource = readFileSync(resolve(process.cwd(), 'src/ui/components/PuppyAwakeSVG.svelte'), 'utf8');

        expect(toolPuppySource).toContain('export let visible = false;');
        expect(toolPuppySource).toContain('buildDefaultPuppyAppearance');
        expect(toolPuppySource).toContain('appearance: PuppyAppearanceSettings = buildDefaultPuppyAppearance()');
        expect(awakeSvgSource).toContain(`var(--sy-puppy-body-color, ${DEFAULT_PUPPY_APPEARANCE.bodyColor})`);
        expect(awakeSvgSource).toContain(`var(--sy-puppy-paw-color, ${DEFAULT_PUPPY_APPEARANCE.pawColor})`);
        expect(awakeSvgSource).toContain(`var(--sy-puppy-eye-color, ${DEFAULT_PUPPY_APPEARANCE.eyeColor})`);
    });

    it('normalizes mascot appearance colors and preserves legacy settings', () => {
        expect(buildDefaultPuppySettings().visible).toBe(false);
        expect(normalizePuppySettings(undefined).visible).toBe(false);
        expect(normalizePuppySettings({ visible: 'invalid' }).visible).toBe(false);
        expect(normalizePuppySettings({ visible: false })).toMatchObject({
            visible: false,
            appearance: DEFAULT_PUPPY_APPEARANCE,
        });
        expect(normalizePuppySettings({ visible: true }).visible).toBe(true);

        expect(normalizePuppySettings({
            appearance: {
                bodyColor: '#ABCDEF',
                pawColor: 'not-a-color',
                eyeColor: '#123456',
            },
        }).appearance).toEqual({
            bodyColor: '#abcdef',
            pawColor: DEFAULT_PUPPY_APPEARANCE.pawColor,
            eyeColor: '#123456',
        });
    });

    it('normalizes document timeline settings while preserving legacy debug-only settings', () => {
        expect(buildDefaultVersionControlSettings()).toEqual({
            enabled: true,
            showDebugMeta: false,
        });
        expect(normalizeVersionControlSettings({ showDebugMeta: true })).toEqual({
            enabled: true,
            showDebugMeta: true,
        });
        expect(normalizeVersionControlSettings({ enabled: false, showDebugMeta: true })).toEqual({
            enabled: false,
            showDebugMeta: true,
        });
    });
});
