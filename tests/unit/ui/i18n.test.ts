import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACTIONS_BY_CATEGORY, FEEDBACK_ACTIONS, FS_ACTIONS, TOOL_CATEGORIES } from '@/core/config';

function readI18n(locale: string): Record<string, unknown> {
    const raw = readFileSync(join(process.cwd(), 'public', 'i18n', `${locale}.json`), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
}

function readPackageVersion(): string {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version: string }).version;
}

describe('settings i18n', () => {
    it('covers polished settings navigation and page summaries in bundled locales', () => {
        const shellKeys = [
            'mcpToolsSettingTitle',
            'settingsBrandSubtitle',
            'settingsNavigationLabel',
            'settingsConnectionDesc',
            'settingsPermissionsDesc',
            'settingsToolsDesc',
            'embeddingGroupTitle',
            'settingsEmbeddingDesc',
            'settingsMascotDesc',
            'settingsAnalyticsDesc',
            'settingsDebugDesc',
            'settingsRulesDesc',
            'settingsFeedbackDesc',
            'mcpPermOverview',
            'mcpPermOverviewDesc',
            'puppy_preview_title',
            'puppy_preview_desc',
            'puppy_preview_visible',
            'puppy_preview_hidden',
        ];

        for (const locale of ['en_US', 'zh_CN']) {
            const i18n = readI18n(locale);
            for (const key of shellKeys) {
                expect(i18n[key], `${locale} ${key}`).toEqual(expect.any(String));
            }
        }
    });

    it('covers embedding configuration, testing, and index management copy', () => {
        const keys = [
            'embedding_unsupported_title',
            'embedding_management_unsupported_desc',
            'embedding_enabled',
            'embedding_base_url',
            'embedding_api_key',
            'embedding_model_name',
            'embedding_dimensions',
            'embedding_timeout',
            'embedding_save',
            'embedding_save_test',
            'embedding_reindex_required',
            'embedding_indexed',
            'embedding_pending',
            'embedding_failed',
            'embedding_ignored_length',
            'embedding_ignored_config',
            'embedding_rebuild_confirm',
            'embedding_retry_failed_items',
        ];

        for (const locale of ['en_US', 'zh_CN']) {
            const i18n = readI18n(locale);
            for (const key of keys) {
                expect(i18n[key], `${locale} ${key}`).toEqual(expect.any(String));
            }
        }
    });

    it('labels the combined settings and debug page consistently', () => {
        expect(readI18n('zh_CN').debugGroupTitle).toBe('设置与调试');
        expect(readI18n('en_US').debugGroupTitle).toBe('Settings & Debug');
    });

    it('keeps the settings changelog aligned with the current plugin version', () => {
        const version = readPackageVersion();

        for (const locale of ['en_US', 'zh_CN']) {
            const i18n = readI18n(locale);

            expect(i18n.toolSettingsChangelogTitle, `${locale} toolSettingsChangelogTitle`).toEqual(expect.any(String));
            expect(i18n.toolSettingsChangelogText, `${locale} toolSettingsChangelogText`).toEqual(expect.any(String));
            expect(i18n.toolSettingsChangelogExpand, `${locale} toolSettingsChangelogExpand`).toEqual(expect.any(String));
            expect(i18n.toolSettingsChangelogCollapse, `${locale} toolSettingsChangelogCollapse`).toEqual(expect.any(String));
            expect(i18n.toolSettingsChangelogText, `${locale} toolSettingsChangelogText`).toContain(`v${version}`);
            for (const line of String(i18n.toolSettingsChangelogText).split('\n')) {
                expect(line, `${locale} changelog date`).toMatch(/· \d{4}-\d{2}-\d{2} —/);
            }
            for (const milestone of ['v0.5.1', 'v0.5.0', 'v0.4.0', 'v0.3.7', 'v0.3.0', 'v0.2.0', 'v0.1.5', 'v0.1.0']) {
                expect(i18n.toolSettingsChangelogText, `${locale} ${milestone}`).toContain(milestone);
            }
            for (const pr of [45, 43, 33, 26, 25, 21, 10, 6]) {
                expect(i18n.toolSettingsChangelogText, `${locale} PR #${pr} emphasis`).toMatch(
                    new RegExp(`\\*\\*[^\\n]*PR #${pr}[^\\n]*\\*\\*`),
                );
            }
        }
    });

    it('covers all tool action labels in bundled locales', () => {
        for (const locale of ['en_US', 'zh_CN']) {
            const i18n = readI18n(locale);

            for (const category of TOOL_CATEGORIES) {
                expect(i18n[`${category}_tool_title`], `${locale} ${category}_tool_title`).toEqual(expect.any(String));
                expect(i18n[`${category}_tool_desc`], `${locale} ${category}_tool_desc`).toEqual(expect.any(String));

                for (const action of ACTIONS_BY_CATEGORY[category]) {
                    expect(i18n[`${category}_action_${action}`], `${locale} ${category}_action_${action}`).toEqual(expect.any(String));
                    expect(i18n[`desc_${category}_action_${action}`], `${locale} desc_${category}_action_${action}`).toEqual(expect.any(String));
                }
            }
        }
    });

    it('covers filesystem tool labels in bundled locales', () => {
        for (const locale of ['en_US', 'zh_CN']) {
            const i18n = readI18n(locale);

            expect(i18n.Filesystem).toEqual(expect.any(String));
            expect(i18n.fs_tool_title).toEqual(expect.any(String));
            expect(i18n.fs_tool_desc).toEqual(expect.any(String));

            for (const action of FS_ACTIONS) {
                expect(i18n[`fs_action_${action}`], `${locale} fs_action_${action}`).toEqual(expect.any(String));
                expect(i18n[`desc_fs_action_${action}`], `${locale} desc_fs_action_${action}`).toEqual(expect.any(String));
            }
        }
    });

    it('localizes the timeline tool group name', () => {
        expect(readI18n('en_US').Timeline).toBe('Timeline');
        expect(readI18n('zh_CN').Timeline).toBe('时间线');
    });

    it('covers feedback tool labels and form copy in bundled locales', () => {
        const formKeys = [
            'feedbackGroupTitle',
            'feedback_panel_title',
            'feedback_panel_desc',
            'feedback_description_label',
            'feedback_description_placeholder',
            'feedback_impact_label',
            'feedback_impact_placeholder',
            'feedback_suggestion_label',
            'feedback_suggestion_placeholder',
            'feedback_submit_button',
            'feedback_submitting',
            'feedback_submit_success',
            'feedback_submit_success_with_id',
        ];

        for (const locale of ['en_US', 'zh_CN']) {
            const i18n = readI18n(locale);

            expect(i18n.feedback_tool_title).toEqual(expect.any(String));
            expect(i18n.feedback_tool_desc).toEqual(expect.any(String));
            for (const action of FEEDBACK_ACTIONS) {
                expect(i18n[`feedback_action_${action}`], `${locale} feedback_action_${action}`).toEqual(expect.any(String));
                expect(i18n[`desc_feedback_action_${action}`], `${locale} desc_feedback_action_${action}`).toEqual(expect.any(String));
            }
            for (const key of formKeys) {
                expect(i18n[key], `${locale} ${key}`).toEqual(expect.any(String));
            }
        }
    });

    it('covers agent memory settings copy in bundled locales', () => {
        for (const locale of ['en_US', 'zh_CN']) {
            const i18n = readI18n(locale);

            expect(i18n.agent_memory_title, `${locale} agent_memory_title`).toEqual(expect.any(String));
            expect(i18n.agent_memory_desc, `${locale} agent_memory_desc`).toEqual(expect.any(String));
            expect(i18n.agent_memory_placeholder, `${locale} agent_memory_placeholder`).toEqual(expect.any(String));
            expect(i18n.agent_memory_http_restarted, `${locale} agent_memory_http_restarted`).toEqual(expect.any(String));
            expect(i18n.agent_memory_saved_reconnect, `${locale} agent_memory_saved_reconnect`).toEqual(expect.any(String));
            expect(i18n.agent_memory_refresh_failed, `${locale} agent_memory_refresh_failed`).toEqual(expect.any(String));
        }
    });

    it('covers AI-assisted MCP and CLI connection prompts in bundled locales', () => {
        const promptKeys = [
            'mcpAiSetupTitle',
            'mcpAiSetupDesc',
            'mcpAiSetupPrompt',
            'cliAiSetupTitle',
            'cliAiSetupDesc',
            'cliAiSetupPrompt',
            'copyPromptForAi',
            'aiSetupSecretWarning',
        ];

        for (const locale of ['en_US', 'zh_CN']) {
            const i18n = readI18n(locale);
            for (const key of promptKeys) {
                expect(i18n[key], `${locale} ${key}`).toEqual(expect.any(String));
            }
            expect(i18n.mcpAiSetupPrompt).toContain('{{config}}');
            expect(i18n.cliAiSetupPrompt).toContain('{{apiToken}}');
        }
    });

    it('covers Skills over MCP experimental settings in bundled locales', () => {
        const keys = [
            'skillsOverMcpTitle',
            'experimentalFeatureBadge',
            'skillsOverMcpDesc',
            'skillsOverMcpEnabled',
            'skillsOverMcpRestartHint',
        ];

        for (const locale of ['en_US', 'zh_CN']) {
            const i18n = readI18n(locale);
            for (const key of keys) {
                expect(i18n[key], `${locale} ${key}`).toEqual(expect.any(String));
            }
        }
    });
});
