import { describe, expect, it, vi } from 'vitest';

import {
    callFlashcardReviewSessionTool,
    callMascotShopAppTool,
    callTimelineAppTool,
    compactMcpAppToolResult,
    decorateToolsWithMcpApps,
    FLASHCARD_APP_HANDOFF_MESSAGE,
    FLASHCARD_APP_MODEL_INSTRUCTION,
    FLASHCARD_REVIEW_SESSION_TOOL_NAME,
    FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME,
    listMcpAppResources,
    MCP_APPS_EXTENSION_ID,
    MCP_APP_LEGACY_RESOURCE_URI_META_KEY,
    MCP_APP_MIME_TYPE,
    MCP_APP_RESOURCE_URIS,
    readMcpAppResource,
    supportsMcpApps,
    TIMELINE_APP_ACTION_TOOL_NAME,
    TIMELINE_APP_SCOPE_INSTRUCTION,
    TIMELINE_APP_TOOL_NAME,
    MASCOT_SHOP_APP_TOOL_NAME,
    MASCOT_SHOP_APP_ACTION_TOOL_NAME,
} from '@/mcp/mcp-apps';
import { buildDefaultToolConfig } from '@/core/config';
import { SHOP_ITEMS } from '@/tools/mascot';
import { withRequestSemantics } from '../../helpers/mock-client';

describe('MCP Apps', () => {
    it('requires the official UI extension and HTML profile', () => {
        expect(supportsMcpApps(undefined)).toBe(false);
        expect(supportsMcpApps({ extensions: { [MCP_APPS_EXTENSION_ID]: {} } } as any)).toBe(false);
        expect(supportsMcpApps({
            extensions: {
                [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] },
            },
        } as any)).toBe(true);
    });

    it('keeps flashcard app-callable and adds a dedicated model-facing review session tool', () => {
        const tools = [
            { name: 'flashcard', inputSchema: { type: 'object' } },
            { name: 'timeline', inputSchema: { type: 'object' } },
            { name: 'mascot', inputSchema: { type: 'object' } },
            { name: 'document', inputSchema: { type: 'object' } },
        ];

        const plain = decorateToolsWithMcpApps(tools, false);
        expect(plain).toBe(tools);

        const decorated = decorateToolsWithMcpApps(tools, true, buildDefaultToolConfig().mcpApps);
        expect(decorated[0]._meta).toBeUndefined();
        expect(decorated[1]._meta).toBeUndefined();
        expect(decorated[2]._meta).toBeUndefined();
        expect(decorated[3]._meta).toBeUndefined();
        const sessionTool = decorated.find((tool) => tool.name === FLASHCARD_REVIEW_SESSION_TOOL_NAME);
        expect(sessionTool?._meta).toEqual({
            ui: {
                resourceUri: MCP_APP_RESOURCE_URIS.flashcard,
                visibility: ['model'],
            },
            [MCP_APP_LEGACY_RESOURCE_URI_META_KEY]: MCP_APP_RESOURCE_URIS.flashcard,
        });
        expect((sessionTool?.inputSchema.properties as any).cards).toMatchObject({ minItems: 1, maxItems: 20 });
        expect(sessionTool?.inputSchema.required).toContain('candidateToken');
        expect(sessionTool?.description).toContain(FLASHCARD_APP_MODEL_INSTRUCTION);
        expect(sessionTool?.description).toContain(FLASHCARD_APP_HANDOFF_MESSAGE);
        expect((decorated.find((tool) => tool.name === TIMELINE_APP_TOOL_NAME)?._meta as any).ui.resourceUri).toBe(MCP_APP_RESOURCE_URIS.timeline);
        expect((decorated.find((tool) => tool.name === MASCOT_SHOP_APP_TOOL_NAME)?._meta as any).ui.resourceUri).toBe(MCP_APP_RESOURCE_URIS.mascot);
        expect((decorated.find((tool) => tool.name === TIMELINE_APP_TOOL_NAME)?._meta as any)[MCP_APP_LEGACY_RESOURCE_URI_META_KEY]).toBe(MCP_APP_RESOURCE_URIS.timeline);
        const timelineApp = decorated.find((tool) => tool.name === TIMELINE_APP_TOOL_NAME);
        expect(timelineApp?.description).toContain(TIMELINE_APP_SCOPE_INSTRUCTION);
        expect((timelineApp?.inputSchema.properties as any).documentId.description).toContain('global-only');
        expect((timelineApp?.inputSchema.properties as any).documentId.description).toContain('only global nodes');
        expect((decorated.find((tool) => tool.name === MASCOT_SHOP_APP_TOOL_NAME)?._meta as any)[MCP_APP_LEGACY_RESOURCE_URI_META_KEY]).toBe(MCP_APP_RESOURCE_URIS.mascot);
        const timelineAppAction = decorated.find((tool) => tool.name === TIMELINE_APP_ACTION_TOOL_NAME);
        expect(timelineAppAction?._meta).toEqual({ ui: { visibility: ['app'] } });
        expect((timelineAppAction?.inputSchema.properties as any).action.enum).toEqual([
            'list_nodes',
            'create_node',
            'compare_node',
            'delete_node',
            'rollback_document',
            'rollback_block',
            'help',
        ]);
        expect((timelineAppAction?._meta as any).ui.resourceUri).toBeUndefined();
        expect(decorated.find((tool) => tool.name === FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME)?._meta).toEqual({ ui: { visibility: ['app'] } });
        expect(decorated.find((tool) => tool.name === MASCOT_SHOP_APP_ACTION_TOOL_NAME)?._meta).toEqual({ ui: { visibility: ['app'] } });
    });

    it('publishes timeline App permissions only in result metadata', () => {
        const config = buildDefaultToolConfig();
        config.mcpApps.timeline.actions.delete_node = false;
        const result = compactMcpAppToolResult(TIMELINE_APP_ACTION_TOOL_NAME, 'list_nodes', {
            content: [{ type: 'text' as const, text: '{}' }],
            structuredContent: { action: 'list_nodes', nodes: [] },
            _meta: {},
        }, true, config.mcpApps);

        expect(result.structuredContent).toEqual({ action: 'list_nodes', nodes: [] });
        expect(result._meta?.['io.siyuan-sisyphus/timeline-permissions']).toEqual({
            appActions: ['list_nodes', 'create_node', 'compare_node', 'rollback_document', 'rollback_block'],
        });
    });

    it('omits only the disabled App while leaving aggregate tools unchanged', () => {
        const config = buildDefaultToolConfig();
        config.mcpApps.timeline.enabled = false;
        const tools = [{ name: 'timeline', inputSchema: { type: 'object' } }, { name: 'mascot', inputSchema: { type: 'object' } }];
        const decorated = decorateToolsWithMcpApps(tools, true, config.mcpApps);

        expect(decorated.find((tool) => tool.name === 'timeline')?._meta).toBeUndefined();
        expect(decorated.find((tool) => tool.name === TIMELINE_APP_TOOL_NAME)).toBeUndefined();
        expect(decorated.find((tool) => tool.name === TIMELINE_APP_ACTION_TOOL_NAME)).toBeUndefined();
        expect(decorated.find((tool) => tool.name === MASCOT_SHOP_APP_TOOL_NAME)).toBeDefined();
    });

    it('validates review session size and selection reason before reading SiYuan', async () => {
        await expect(callFlashcardReviewSessionTool({} as any, {} as any, {
            candidateToken: '123e4567-e89b-42d3-a456-426614174000',
            cards: Array.from({ length: 21 }, (_value, index) => ({ deckID: 'd1', cardID: `c${index}` })),
            selectionReason: 'too many',
        })).rejects.toThrow();
        await expect(callFlashcardReviewSessionTool({} as any, {} as any, {
            candidateToken: '123e4567-e89b-42d3-a456-426614174000',
            cards: [{ deckID: 'd1', cardID: 'c1' }],
            selectionReason: '   ',
        })).rejects.toThrow();
        await expect(callFlashcardReviewSessionTool({} as any, {} as any, {
            candidateToken: '123e4567-e89b-42d3-a456-426614174000',
            cards: [{ deckID: 'd1', cardID: 'c1' }],
            selectionReason: 'expired snapshot',
        })).rejects.toThrow('candidate snapshot is missing or expired');
    });

    it('serves the same self-contained HTML shell through three UI resources', () => {
        const resources = listMcpAppResources();
        expect(resources.map((resource) => resource.uri)).toEqual(Object.values(MCP_APP_RESOURCE_URIS));
        expect(resources.every((resource) => resource.mimeType === MCP_APP_MIME_TYPE)).toBe(true);

        for (const uri of Object.values(MCP_APP_RESOURCE_URIS)) {
            const resource = readMcpAppResource(uri);
            expect(resource).toEqual(expect.objectContaining({
                uri,
                mimeType: MCP_APP_MIME_TYPE,
                text: expect.stringContaining('<!doctype html>'),
            }));
            expect(resource?._meta.ui.prefersBorder).toBe(true);
        }
        expect(readMcpAppResource('ui://unknown')).toBeUndefined();
    });

    it('preserves the shop payload when adding App presentation fields', async () => {
        const config = buildDefaultToolConfig();
        const client = {
            readFile: vi.fn().mockResolvedValue(JSON.stringify({ totalCalls: 12, balance: 9, updatedAt: 1 })),
        };

        const result = await callMascotShopAppTool(
            client as any,
            {} as any,
            {},
            config.mcpApps.mascotShop,
        );

        expect(result.structuredContent).toMatchObject({
            action: 'shop',
            balance: 9,
            totalEarned: 12,
            items: SHOP_ITEMS,
            presentationMode: 'mcp-app-only',
        });
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            action: 'shop',
            balance: 9,
            items: SHOP_ITEMS,
        });
    });

    it('preserves timeline nodes when adding App presentation fields', async () => {
        const config = buildDefaultToolConfig();
        const client = withRequestSemantics({
            request: vi.fn().mockResolvedValue({
                snapshots: [{
                    id: 'snapshot-1',
                    memo: 'Release',
                    tag: 'sisyphustimeline_global_release',
                    created: 123,
                }],
            }),
        });

        const result = await callTimelineAppTool(
            client as any,
            {} as any,
            {},
            config.mcpApps.timeline,
        );

        expect(result.structuredContent).toMatchObject({
            action: 'list_nodes',
            nodes: [{
                name: 'release',
                snapshotId: 'snapshot-1',
                tag: 'sisyphustimeline_global_release',
                scope: 'global',
            }],
            page: 1,
            total: 1,
            presentationMode: 'mcp-app-only',
        });
        expect(JSON.parse(result.content[0].text)).toMatchObject({
            action: 'list_nodes',
            nodes: [{ tag: 'sisyphustimeline_global_release' }],
            total: 1,
        });
    });

    it('returns answer-free candidate summaries to App-capable models', () => {
        const result = {
            content: [{ type: 'text' as const, text: JSON.stringify({ cards: [{ deckID: 'd1', cardID: 'c1', front: '题目', back: '敏感答案' }] }) }],
            structuredContent: {
                action: 'list_cards',
                scope: 'all',
                filter: 'due',
                cards: [{ deckID: 'd1', cardID: 'c1', front: '题目', back: '敏感答案', lapses: 2, reps: 3 }],
                unreviewedCount: 1,
            },
        };

        const compacted = compactMcpAppToolResult('flashcard', 'list_cards', result, true);
        expect(JSON.stringify(compacted.structuredContent)).not.toContain('敏感答案');
        expect(compacted.content[0].text).not.toContain('敏感答案');
        expect(JSON.parse(compacted.content[0].text)).toMatchObject({
            action: 'list_cards',
            candidateView: 'ai-selectable-due-flashcards',
            cardCount: 1,
            cards: [{ deckID: 'd1', cardID: 'c1', front: '题目', lapses: 2, reps: 3 }],
        });
        expect((compacted.structuredContent as any).selectionGuidance).toContain('exact cards array');
        expect((compacted.structuredContent as any).selectionGuidance).toContain('Do not use get_cards');
        expect((compacted.structuredContent as any).selectionGuidance).toContain('sole review surface');
        expect((compacted.structuredContent as any).selectionGuidance).toContain(FLASHCARD_APP_HANDOFF_MESSAGE);
        expect((compacted.structuredContent as any).candidateToken).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(compactMcpAppToolResult('flashcard', 'list_cards', result, false)).toBe(result);
        expect(result.structuredContent.cards[0].back).toBe('敏感答案');
        expect(compactMcpAppToolResult('flashcard', 'get_cards', result, true)).toBe(result);
    });
});
