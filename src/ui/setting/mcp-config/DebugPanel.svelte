<script lang="ts">
    import SettingPanel from "../../shared/setting-panel.svelte";
    import type { ToolConfig } from "../tool-config";
    import type { PuppySettings, VersionControlSettings } from "../tool-config-storage";

    export let group: string;
    export let display = false;
    export let config: ToolConfig;
    export let puppySettings: PuppySettings;
    export let versionControlSettings: VersionControlSettings;
    export let getLabel: (key: string, fallback: string) => string;
    export let onChanged: (event: CustomEvent<ChangeEvent>) => void | Promise<void>;

    interface ChangeEvent { key: string; value: any; }

    function buildDebugItems(
        currentConfig: ToolConfig,
        currentPuppySettings: PuppySettings,
        currentVersionControlSettings: VersionControlSettings,
        label: (key: string, fallback: string) => string,
    ): ISettingItem[] {
        return [
            {
                type: "checkbox",
                key: "writeSafety__strictMode",
                value: currentConfig.writeSafety.strictMode,
                title: label("write_safety_strict_title", "Strict Safe Writes"),
                description: label(
                    "write_safety_strict_desc",
                    "Require requestId and a current-state preflight credential for protected mutations, then serialize and read back each write. Turn this off only for legacy write clients.",
                ),
            },
            {
                type: "checkbox",
                key: "versionControl__enabled",
                value: currentVersionControlSettings.enabled,
                title: label("version_control_enabled_title", "Enable Document Snapshots and Diff"),
                description: label("version_control_enabled_desc", "Register the left snapshot dock, right diff dock, command, and editor listeners. Turn this off to remove both docks."),
            },
            {
                type: "checkbox",
                key: "debug__slimResponses",
                value: currentConfig.debug.slimResponses,
                title: label("debug_slimResponses_title", "Slim Responses"),
                description: label("debug_slimResponses_desc", "Return only the data an agent usually needs. Turn this off to inspect full debug fields, pagination internals, UI refresh metadata, and raw helper metadata."),
            },
            {
                type: "checkbox",
                key: "versionControl__showDebugMeta",
                value: currentVersionControlSettings.showDebugMeta,
                title: label("version_control_show_debug_meta_title", "Timeline Debug Metadata"),
                description: label("version_control_show_debug_meta_desc", "Show document/block IDs and raw diff statuses in the snapshot and diff docks."),
            },
            {
                type: "checkbox",
                key: "puppy__testModeEnabled",
                value: currentPuppySettings.testModeEnabled,
                title: label("puppy_testMode_title", "Random Mascot Test"),
                description: label("puppy_testMode_desc", "Randomly cycle real MCP actions for animation testing without calling tools."),
                layout: "inline",
                children: [
                    ...(currentPuppySettings.testModeEnabled
                        ? [{
                            type: "number" as const,
                            key: "puppy__testModeIntervalMs",
                            value: currentPuppySettings.testModeIntervalMs,
                            title: label("puppy_testMode_interval_title", "Interval"),
                            description: label("puppy_testMode_interval_desc", "Delay between random test actions."),
                            inputCompact: true,
                            unit: "ms",
                        }]
                        : []),
                ],
            },
        ];
    }

    $: debugItems = buildDebugItems(config, puppySettings, versionControlSettings, getLabel);
    $: runtimeItems = debugItems.slice(0, 4);
    $: testItems = debugItems.slice(4);
</script>

<div class="debug-settings" class:fn__none={!display}>
    <section class="debug-section">
        <div class="debug-section__heading">
            <span class="debug-section__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                    <path d="M9.5 3.5h5v2h-5v-2ZM7 6.5h10v2h2.5v2H17v3h2.5v2H17v1.25A4.25 4.25 0 0 1 12.75 21h-1.5A4.25 4.25 0 0 1 7 16.75V15.5H4.5v-2H7v-3H4.5v-2H7v-2Zm2 2v8.25A2.25 2.25 0 0 0 11.25 19h1.5A2.25 2.25 0 0 0 15 16.75V8.5H9Z"/>
                </svg>
            </span>
            <div>
                <h3>{getLabel("debug_runtime_section", "Safety settings and diagnostics")}</h3>
                <p>{getLabel("debug_runtime_section_desc", "Control strict safe writes, timeline registration, response detail, and developer metadata. Changes are saved immediately.")}</p>
            </div>
        </div>
        <SettingPanel {group} settingItems={runtimeItems} display={true} on:changed={onChanged} />
    </section>

    <section class="debug-section">
        <div class="debug-section__heading">
            <span class="debug-section__icon debug-section__icon--test" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                    <path d="M10 2h4v2h-1v3.1l5.75 9.96A3.3 3.3 0 0 1 15.9 22H8.1a3.3 3.3 0 0 1-2.85-4.94L11 7.1V4h-1V2Zm.54 9-3.56 6.06A1.3 1.3 0 0 0 8.1 19h7.8a1.3 1.3 0 0 0 1.12-1.94L13.46 11h-2.92Z"/>
                </svg>
            </span>
            <div>
                <h3>{getLabel("debug_test_section", "Visual testing")}</h3>
                <p>{getLabel("debug_test_section_desc", "Preview mascot action states without invoking MCP tools.")}</p>
            </div>
        </div>
        <SettingPanel {group} settingItems={testItems} display={true} on:changed={onChanged} />
    </section>
</div>

<style>
    .debug-settings {
        display: flex;
        flex-direction: column;
        gap: var(--mcp-config-section-gap, 16px);
        max-width: var(--mcp-config-content-max-width, 920px);
    }

    .debug-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .debug-section__heading {
        align-items: center;
        display: flex;
        gap: 10px;
        padding: 0 3px;
    }

    .debug-section__icon {
        align-items: center;
        background: var(--mcp-config-primary-soft, color-mix(in srgb, var(--b3-theme-primary) 12%, transparent));
        border: 1px solid var(--mcp-config-primary-border, color-mix(in srgb, var(--b3-theme-primary) 26%, transparent));
        border-radius: var(--mcp-config-control-radius, 9px);
        color: var(--b3-theme-primary);
        display: inline-flex;
        flex: 0 0 32px;
        height: 32px;
        justify-content: center;
        width: 32px;
    }

    .debug-section__icon--test {
        background: color-mix(in srgb, var(--b3-theme-warning, #d99a24) 10%, transparent);
        border-color: color-mix(in srgb, var(--b3-theme-warning, #d99a24) 24%, transparent);
        color: var(--b3-theme-warning, #d99a24);
    }

    .debug-section__icon svg {
        fill: currentColor;
        height: 17px;
        width: 17px;
    }

    .debug-section__heading h3 {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: 13px;
        font-weight: 650;
        line-height: 1.45;
        margin: 0;
    }

    .debug-section__heading p {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        font-size: 11px;
        line-height: 1.5;
        margin: 2px 0 0;
    }

    .debug-section :global(.config__tab-container) {
        max-width: none;
    }
</style>
