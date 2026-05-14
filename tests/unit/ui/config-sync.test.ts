import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as mcpConfig from '@/core/config';
import * as settingConfig from '@/ui/setting/tool-config';

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
    });

    it('keeps tool categories grouped under one settings page', () => {
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');
        const rootSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config.svelte'), 'utf8');

        expect(rootSource).toContain('{ id: TOOL_GROUP_KEY, label: toolGroupLabel, iconSvg: ICON_SVGS.folder }');
        expect(rootSource).not.toContain('...CATEGORY_TAB_DEFS.map');
        expect(panelSource).toContain('tool-settings-accordion');
        expect(panelSource).toContain('tool-settings-group__header');
        expect(panelSource).toContain('dispatchToolToggle');
        expect(panelSource).toContain('SettingPanel');
    });

    it('keeps accordion state reactive when categories are toggled', () => {
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');

        expect(panelSource).toContain('openCategories;');
        expect(panelSource).toContain('groupDefinitions = GROUP_DEFINITIONS.map');
    });

    it('keeps notebook permission rows reactive after notebooks load', () => {
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/PermissionsPanel.svelte'), 'utf8');

        expect(panelSource).toContain('notebooks;');
        expect(panelSource).toContain('permissions;');
        expect(panelSource).toContain('permLoading;');
        expect(panelSource).toContain('permItems = buildPermItems();');
    });

    it('keeps mascot tool settings out of the mascot display panel', () => {
        const puppySource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/PuppyPanel.svelte'), 'utf8');
        const panelSource = readFileSync(resolve(process.cwd(), 'src/ui/setting/mcp-config/ToolCategoriesPanel.svelte'), 'utf8');

        expect(puppySource).not.toContain('mascot__enabled');
        expect(puppySource).not.toContain('mascot__action__');
        expect(panelSource).toContain('category: "mascot"');
        expect(panelSource).toContain('groupKey: "Mascot Tool"');
    });
});
