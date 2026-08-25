import { describe, expect, it } from 'vitest';

import { buildDefaultToolConfig, normalizeToolConfig } from '@/ui/setting/tool-config';

describe('setting tool config', () => {
    it('enables document cover actions by default', () => {
        const config = buildDefaultToolConfig();

        expect(config.document.actions.set_attr).toBe(true);
        expect(config.document.actions.duplicate).toBe(true);
        expect(config.file.actions.upload_asset).toBe(true);
        expect(config.file.actions.list_templates).toBe(true);
        expect(config.file.actions.read_template).toBe(true);
        expect(config.file.actions.create_template).toBe(true);
        expect(config.file.actions.update_template).toBe(true);
        expect(config.file.actions.save_doc_as_template).toBe(true);
        expect(config.file.actions.delete_template).toBe(false);
        expect(config.file.uploadLargeFileThresholdMB).toBe(10);
        expect(config.av.actions.get).toBe(true);
        expect(config.av.actions.set_cells).toBe(true);
        expect(config.search.actions.semantic).toBe(true);
        expect(config.flashcard.actions.list_cards).toBe(true);
        expect(config.flashcard.actions.create_card).toBe(true);
        expect(config.flashcard.actions.remove_card).toBe(true);
        expect(config.extension.enabled).toBe(true);
        expect(config.extension.actions.list).toBe(true);
        expect(config.extension.actions.validate_package).toBe(true);
        expect(config.extension.actions.diagnose_plugin_mcp).toBe(true);
        expect(config.extension.includeNativeTools).toBe(false);
        expect(config.extension.blockedTools).toEqual([]);
        expect(config.mascot.actions.get_balance).toBe(true);
        expect(config.mascot.actions.shop).toBe(true);
        expect(config.mascot.actions.buy).toBe(true);
        expect(config.feedback.actions.submit).toBe(true);
        expect(config.timeline.enabled).toBe(true);
        expect(config.timeline.actions.list_nodes).toBe(true);
        expect(config.timeline.actions.create_node).toBe(true);
        expect(config.timeline.actions.compare_node).toBe(true);
        expect(config.timeline.actions.delete_node).toBe(false);
        expect(config.timeline.actions.rollback_document).toBe(false);
        expect(config.timeline.actions.rollback_block).toBe(false);
        expect(config.mcpApps.timeline.actions).toEqual({
            list_nodes: true,
            create_node: true,
            compare_node: true,
            delete_node: true,
            rollback_document: true,
            rollback_block: true,
        });
        expect(config.userRulesText).toBe('创建文档/日记后主动设图标');
        expect(config.agentSiyuanMemoryText).toBe('');
        expect(config.agentSiyuanMemoryUpdatedAt).toBe('');
        expect(config.writeSafety.strictMode).toBe(true);
        expect(config.debug.includeUiRefreshMetadata).toBe(false);
        expect(config.debug.slimResponses).toBe(true);
    });

    it('enables semantic search when migrating an older nested search config', () => {
        const config = normalizeToolConfig({
            search: {
                enabled: true,
                actions: {
                    fulltext: true,
                    query_sql: false,
                },
            },
        });

        expect(config.search.enabled).toBe(true);
        expect(config.search.actions.fulltext).toBe(true);
        expect(config.search.actions.query_sql).toBe(false);
        expect(config.search.actions.semantic).toBe(true);
    });

    it('keeps nested file config action toggles and upload threshold together', () => {
        const config = normalizeToolConfig({
            file: {
                enabled: true,
                uploadLargeFileThresholdMB: 25,
                actions: {
                    upload_asset: false,
                    render: true,
                },
            },
        });

        expect(config.file.enabled).toBe(true);
        expect(config.file.uploadLargeFileThresholdMB).toBe(25);
        expect(config.file.actions.upload_asset).toBe(false);
        expect(config.file.actions.render).toBe(true);
    });

    it('keeps mascot nested action toggles', () => {
        const config = normalizeToolConfig({
            mascot: {
                enabled: true,
                actions: {
                    get_balance: true,
                    shop: false,
                },
            },
        });

        expect(config.mascot.enabled).toBe(true);
        expect(config.mascot.actions.get_balance).toBe(true);
        expect(config.mascot.actions.shop).toBe(false);
        expect(config.mascot.actions.buy).toBe(true);
    });

    it('keeps feedback nested action toggles', () => {
        const config = normalizeToolConfig({
            feedback: {
                enabled: true,
                actions: {
                    submit: false,
                },
            },
        });

        expect(config.feedback.enabled).toBe(false);
        expect(config.feedback.actions.submit).toBe(false);
    });

    it('normalizes extension blocked tool names without duplicates', () => {
        const config = normalizeToolConfig({
            extension: {
                enabled: true,
                actions: { list: true },
                includeNativeTools: true,
                blockedTools: [' plugin__beta__write ', 'plugin__alpha__read', 'plugin__beta__write', 42],
            },
        });

        expect(config.extension.enabled).toBe(true);
        expect(config.extension.includeNativeTools).toBe(true);
        expect(config.extension.blockedTools).toEqual([
            'plugin__alpha__read',
            'plugin__beta__write',
        ]);
    });

    it('keeps native official tools disabled when old extension config omits the switch', () => {
        const config = normalizeToolConfig({
            extension: {
                enabled: true,
                actions: { list: true },
                blockedTools: [],
            },
        });

        expect(config.extension.includeNativeTools).toBe(false);
    });

    it('keeps flashcard nested action toggles', () => {
        const config = normalizeToolConfig({
            flashcard: {
                enabled: true,
                actions: {
                    list_cards: true,
                    remove_card: false,
                },
            },
        });

        expect(config.flashcard.enabled).toBe(true);
        expect(config.flashcard.actions.list_cards).toBe(true);
        expect(config.flashcard.actions.create_card).toBe(true);
        expect(config.flashcard.actions.remove_card).toBe(false);
        expect(config.flashcard.actions.review_card).toBe(true);
    });

    it('keeps MCP App timeline mutations independent from AI actions', () => {
        const config = normalizeToolConfig({
            timeline: {
                enabled: true,
                actions: {
                    list_nodes: true,
                    create_node: false,
                    rollback_document: false,
                },
                appActions: {
                    create_node: true,
                    delete_node: false,
                    rollback_document: true,
                    rollback_block: false,
                },
            },
        });

        expect(config.timeline.actions.create_node).toBe(false);
        expect(config.timeline.actions.rollback_document).toBe(false);
        expect(config.mcpApps.timeline.actions).toEqual({
            list_nodes: true,
            create_node: true,
            compare_node: true,
            delete_node: false,
            rollback_document: true,
            rollback_block: false,
        });
    });

    it('keeps the Timeline App enabled independently when the AI timeline tool is disabled', () => {
        const config = normalizeToolConfig({
            timeline: {
                enabled: true,
                actions: Object.fromEntries([
                    'list_nodes',
                    'create_node',
                    'compare_node',
                    'delete_node',
                    'rollback_document',
                    'rollback_block',
                ].map((action) => [action, false])),
                appActions: {
                    create_node: false,
                    delete_node: false,
                    rollback_document: true,
                    rollback_block: false,
                },
            },
        });

        expect(config.timeline.enabled).toBe(false);
        expect(config.mcpApps.timeline.enabled).toBe(true);
        expect(config.mcpApps.timeline.actions.rollback_document).toBe(true);
    });

    it('normalizes independent switches for all three MCP Apps', () => {
        const config = normalizeToolConfig({
            mcpApps: {
                timeline: { enabled: false, actions: { rollback_document: false } },
                flashcardReview: { enabled: true, actions: { review_card: false } },
                mascotShop: { enabled: true, actions: { get_balance: true, shop: false, buy: false } },
            },
        });

        expect(config.mcpApps.timeline.enabled).toBe(false);
        expect(config.mcpApps.timeline.actions.rollback_document).toBe(false);
        expect(config.mcpApps.flashcardReview.actions.review_card).toBe(false);
        expect(config.mcpApps.mascotShop.actions).toEqual({ get_balance: true, shop: false, buy: false });
        expect(config.flashcard.actions.review_card).toBe(true);
        expect(config.mascot.actions.buy).toBe(true);
    });

    it('keeps av nested action toggles', () => {
        const config = normalizeToolConfig({
            av: {
                enabled: true,
                actions: {
                    get: true,
                    set_cells: false,
                },
            },
        });

        expect(config.av.enabled).toBe(true);
        expect(config.av.actions.get).toBe(true);
        expect(config.av.actions.set_cells).toBe(false);
    });

    it.each([
        { input: 'bad', expected: 10, label: 'falls back for non-numeric values' },
        { input: 0, expected: 1, label: 'clamps low values to 1' },
        { input: 1.9, expected: 1, label: 'floors decimal values' },
        { input: 9999, expected: 1024, label: 'clamps high values to 1024' },
    ])('$label', ({ input, expected }) => {
        const config = normalizeToolConfig({
            file: {
                enabled: true,
                uploadLargeFileThresholdMB: input,
                actions: {
                    upload_asset: true,
                },
            },
        });

        expect(config.file.uploadLargeFileThresholdMB).toBe(expected);
    });

    it('keeps userRulesText in nested config and defaults it for old config', () => {
        const configWithRules = normalizeToolConfig({
            userRulesText: 'Always prefer setting icons after create.',
            agentSiyuanMemoryText: 'Workspace has Inbox and Projects notebooks.',
            agentSiyuanMemoryUpdatedAt: '2026-05-20T10:00:00.000Z',
            document: {
                enabled: true,
                actions: {
                    create: true,
                },
            },
        });
        const configWithoutRules = normalizeToolConfig({
            document: {
                enabled: true,
                actions: {
                    create: true,
                },
            },
        });

        expect(configWithRules.userRulesText).toBe('Always prefer setting icons after create.');
        expect(configWithRules.agentSiyuanMemoryText).toBe('Workspace has Inbox and Projects notebooks.');
        expect(configWithRules.agentSiyuanMemoryUpdatedAt).toBe('2026-05-20T10:00:00.000Z');
        expect(configWithoutRules.userRulesText).toBe('创建文档/日记后主动设图标');
        expect(configWithoutRules.agentSiyuanMemoryText).toBe('');
        expect(configWithoutRules.agentSiyuanMemoryUpdatedAt).toBe('');
    });

    it('keeps debug settings in nested config', () => {
        const config = normalizeToolConfig({
            debug: {
                includeUiRefreshMetadata: true,
                slimResponses: false,
            },
        });

        expect(config.debug.includeUiRefreshMetadata).toBe(true);
        expect(config.debug.slimResponses).toBe(false);
    });

    it('keeps strict write safety enabled for old config and honors an explicit opt-out', () => {
        expect(normalizeToolConfig({}).writeSafety.strictMode).toBe(true);
        expect(normalizeToolConfig({ writeSafety: { strictMode: false } }).writeSafety.strictMode).toBe(false);
    });

    it('ignores legacy flat and category config formats', () => {
        const config = normalizeToolConfig({
            notebook: ['list', 'rename'],
            file: ['upload_asset', 'render'],
            remove_document: true,
            find_replace: false,
        });
        const defaults = buildDefaultToolConfig();

        expect(config).toEqual(defaults);
    });
});
