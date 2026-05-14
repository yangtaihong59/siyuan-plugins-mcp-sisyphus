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

    function buildDebugItems(): ISettingItem[] {
        return [
            {
                type: "checkbox",
                key: "debug__slimResponses",
                value: config.debug.slimResponses,
                title: getLabel("debug_slimResponses_title", "Slim Responses"),
                description: getLabel("debug_slimResponses_desc", "Return only the data an agent usually needs. Turn this off to inspect full debug fields, pagination internals, UI refresh metadata, and raw helper metadata."),
            },
            {
                type: "checkbox",
                key: "versionControl__showDebugMeta",
                value: versionControlSettings.showDebugMeta,
                title: getLabel("version_control_show_debug_meta_title", "Timeline Debug Metadata"),
                description: getLabel("version_control_show_debug_meta_desc", "Show document/block IDs and raw diff statuses such as unchanged in the document timeline."),
            },
            {
                type: "checkbox",
                key: "puppy__testModeEnabled",
                value: puppySettings.testModeEnabled,
                title: getLabel("puppy_testMode_title", "Random Mascot Test"),
                description: getLabel("puppy_testMode_desc", "Randomly cycle real MCP actions for animation testing without calling tools."),
                layout: "inline",
                children: [
                    ...(puppySettings.testModeEnabled
                        ? [{
                            type: "number" as const,
                            key: "puppy__testModeIntervalMs",
                            value: puppySettings.testModeIntervalMs,
                            title: getLabel("puppy_testMode_interval_title", "Interval"),
                            description: getLabel("puppy_testMode_interval_desc", "Delay between random test actions."),
                            inputCompact: true,
                            unit: "ms",
                        }]
                        : []),
                ],
            },
        ];
    }

    $: debugItems = buildDebugItems();
</script>

<SettingPanel {group} settingItems={debugItems} {display} on:changed={onChanged} />
