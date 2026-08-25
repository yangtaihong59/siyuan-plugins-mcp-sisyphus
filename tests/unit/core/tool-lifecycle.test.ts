import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runToolCall } from '@/core/tool-lifecycle';

vi.mock('@/core/analytics', () => ({
    appendAnalyticsEvent: vi.fn(() => Promise.resolve()),
    estimateResultSizeHint: vi.fn(() => '0-200'),
    extractErrorCode: vi.fn(() => 'UnknownError'),
    truncateAnalyticsText: vi.fn((text: string | undefined | null) => ({
        text: typeof text === 'string' ? text : '',
        truncated: false,
    })),
}));

vi.mock('@/core/puppy-state', () => ({
    earnPuppyBalance: vi.fn(async () => ({ totalCalls: 1, balance: 1 })),
    readPuppyStats: vi.fn(async () => ({ totalCalls: 0, balance: 0 })),
    writePuppyEvent: vi.fn(async () => undefined),
}));

vi.mock('@/core/telemetry', () => ({
    maybeSendTelemetry: vi.fn(async () => undefined),
}));

describe('mcp/tool-lifecycle', () => {
    beforeEach(() => {
        delete process.env.SIYUAN_MCP_TRANSPORT;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.SIYUAN_MCP_TRANSPORT;
    });

    it('awaits analytics persistence for CLI invocations', async () => {
        process.env.SIYUAN_MCP_TRANSPORT = 'cli';
        const { appendAnalyticsEvent } = await import('@/core/analytics');

        let release!: () => void;
        vi.mocked(appendAnalyticsEvent).mockImplementationOnce(() => new Promise<void>((resolve) => {
            release = resolve;
        }));

        let finished = false;
        const promise = runToolCall(
            {
                client: {} as never,
                category: 'notebook',
                name: 'notebook',
                action: 'list',
                args: { action: 'list' },
                requestText: 'siyuan-sisyphus notebook list',
            },
            async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
        ).then(() => {
            finished = true;
        });

        await vi.waitFor(() => {
            expect(appendAnalyticsEvent).toHaveBeenCalledTimes(1);
            expect(release).toBeTypeOf('function');
        });
        expect(vi.mocked(appendAnalyticsEvent).mock.calls[0][1]).toMatchObject({
            requestChars: 'siyuan-sisyphus notebook list'.length,
            responseChars: '{"ok":true}'.length,
            requestApproxTokens: Math.ceil('siyuan-sisyphus notebook list'.length / 4),
            responseApproxTokens: Math.ceil('{"ok":true}'.length / 4),
            totalApproxTokens: Math.ceil('siyuan-sisyphus notebook list'.length / 4) + Math.ceil('{"ok":true}'.length / 4),
            tokenMode: 'approx_context_v1',
            requestText: 'siyuan-sisyphus notebook list',
            responseText: '{"ok":true}',
            requestTextTruncated: false,
            responseTextTruncated: false,
        });
        expect(finished).toBe(false);

        release();
        await promise;
        expect(finished).toBe(true);
    });

    it('does not await analytics persistence for stdio invocations', async () => {
        process.env.SIYUAN_MCP_TRANSPORT = 'stdio';
        const { appendAnalyticsEvent } = await import('@/core/analytics');

        vi.mocked(appendAnalyticsEvent).mockImplementationOnce(() => new Promise<void>(() => {}));

        await expect(runToolCall(
            {
                client: {} as never,
                category: 'notebook',
                name: 'notebook',
                action: 'list',
                args: { action: 'list' },
                requestText: '{"name":"notebook","arguments":{"action":"list"}}',
            },
            async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
        )).resolves.toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] });

        expect(vi.mocked(appendAnalyticsEvent).mock.calls[0][1]).toMatchObject({
            requestChars: '{"name":"notebook","arguments":{"action":"list"}}'.length,
            responseChars: '{"ok":true}'.length,
            tokenMode: 'approx_context_v1',
            requestText: '{"name":"notebook","arguments":{"action":"list"}}',
            responseText: '{"ok":true}',
        });
    });

    it('preserves image blocks while excluding Base64 from analytics and token fields', async () => {
        const { appendAnalyticsEvent } = await import('@/core/analytics');
        const metadataText = JSON.stringify({ documentID: 'doc-1', path: 'assets/image.png', bytes: 4 });
        const base64 = 'BASE64_SENTINEL_SHOULD_NOT_BE_LOGGED';

        const result = await runToolCall(
            {
                client: {} as never,
                category: 'file',
                name: 'file',
                action: 'read_image',
                args: { action: 'read_image', id: 'doc-1', path: 'assets/image.png' },
                requestText: '{"action":"read_image"}',
            },
            async () => ({
                content: [
                    { type: 'text', text: metadataText },
                    { type: 'image', data: base64, mimeType: 'image/png' },
                ],
                structuredContent: { documentID: 'doc-1', path: 'assets/image.png', bytes: 4 },
            }),
        );

        expect(result.content[1]).toEqual({ type: 'image', data: base64, mimeType: 'image/png' });
        expect(result.structuredContent).toEqual({ documentID: 'doc-1', path: 'assets/image.png', bytes: 4 });
        const analytics = vi.mocked(appendAnalyticsEvent).mock.calls[0][1];
        expect(analytics.responseText).toBe(metadataText);
        expect(analytics.responseChars).toBe(metadataText.length);
        expect(analytics.responseApproxTokens).toBe(Math.ceil(metadataText.length / 4));
        expect(JSON.stringify(analytics)).not.toContain(base64);
    });

    it('strips successful uiRefresh metadata by default before returning and logging analytics', async () => {
        const { appendAnalyticsEvent } = await import('@/core/analytics');

        const result = await runToolCall(
            {
                client: {} as never,
                category: 'notebook',
                name: 'notebook',
                action: 'rename',
                args: { action: 'rename' },
            },
            async () => ({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        uiRefresh: {
                            applied: true,
                            operations: [{ type: 'reloadFiletree' }],
                        },
                    }, null, 2),
                }],
            }),
        );

        const payload = JSON.parse(result.content[0].text);
        expect(payload).toEqual({ success: true });
        expect(vi.mocked(appendAnalyticsEvent).mock.calls[0][1]).toMatchObject({
            responseText: JSON.stringify({ success: true }, null, 2),
        });
    });

    it('keeps successful uiRefresh metadata when slim responses are disabled', async () => {
        const result = await runToolCall(
            {
                client: {} as never,
                category: 'notebook',
                name: 'notebook',
                action: 'rename',
                args: { action: 'rename' },
                slimResponses: false,
            },
            async () => ({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        uiRefresh: {
                            applied: true,
                            operations: [{ type: 'reloadFiletree' }],
                        },
                    }, null, 2),
                }],
            }),
        );

        const payload = JSON.parse(result.content[0].text);
        expect(payload.uiRefresh.operations).toEqual([{ type: 'reloadFiletree' }]);
    });

    it('keeps uiRefresh metadata when it contains a partial failure', async () => {
        const result = await runToolCall(
            {
                client: {} as never,
                category: 'notebook',
                name: 'notebook',
                action: 'rename',
                args: { action: 'rename' },
            },
            async () => ({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        uiRefresh: {
                            applied: true,
                            operations: [{ type: 'reloadFiletree' }],
                            partialFailure: [{ type: 'reloadFiletree', message: 'reload failed' }],
                        },
                    }, null, 2),
                }],
            }),
        );

        const payload = JSON.parse(result.content[0].text);
        expect(payload.uiRefresh.partialFailure).toEqual([{ type: 'reloadFiletree', message: 'reload failed' }]);
    });

    it('slims write success responses by default before analytics', async () => {
        const { appendAnalyticsEvent } = await import('@/core/analytics');

        const result = await runToolCall(
            {
                client: {} as never,
                category: 'block',
                name: 'block',
                action: 'append',
                args: { action: 'append' },
                slimResponses: true,
            },
            async () => ({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        action: 'append',
                        id: '20260507000100-abcdefg',
                        parentID: '20260507000100-parent0',
                        previousID: '20260507000100-prev000',
                        dataType: 'markdown',
                        uiRefresh: {
                            applied: true,
                            operations: [{ type: 'reloadProtyle', id: '20260507000100-parent0' }],
                        },
                    }, null, 2),
                }],
            }),
        );

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            id: '20260507000100-abcdefg',
        });
        expect(vi.mocked(appendAnalyticsEvent).mock.calls[0][1]).toMatchObject({
            responseText: JSON.stringify({
                success: true,
                id: '20260507000100-abcdefg',
            }, null, 2),
        });
    });

    it('keeps mascot purchase metadata in the puppy event when responses are slimmed', async () => {
        const { writePuppyEvent } = await import('@/core/puppy-state');

        const result = await runToolCall(
            {
                client: {} as never,
                category: 'mascot',
                name: 'mascot_shop_app_action',
                action: 'buy',
                args: { action: 'buy', item_id: 'dried-fish' },
                slimResponses: true,
            },
            async () => ({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        action: 'buy',
                        item_id: 'dried-fish',
                        item: 'Dried Fish',
                        type: 'food',
                        emoji: '🐟',
                        cost: 4,
                        balance: 6,
                    }),
                }],
            }),
        );

        expect(JSON.parse(result.content[0].text)).toEqual({ success: true });
        expect(vi.mocked(writePuppyEvent)).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                tool: 'mascot',
                action: 'buy',
                status: 'success',
                itemId: 'dried-fish',
                itemLabel: 'Dried Fish',
                itemType: 'food',
                itemEmoji: '🐟',
            }),
        );
    });

    it('keeps full successful responses when slim responses is disabled', async () => {
        const fullPayload = {
            success: true,
            action: 'append',
            id: '20260507000100-abcdefg',
            parentID: '20260507000100-parent0',
            previousID: '20260507000100-prev000',
            dataType: 'markdown',
        };

        const result = await runToolCall(
            {
                client: {} as never,
                category: 'block',
                name: 'block',
                action: 'append',
                args: { action: 'append' },
                slimResponses: false,
            },
            async () => ({
                content: [{
                    type: 'text',
                    text: JSON.stringify(fullPayload, null, 2),
                }],
            }),
        );

        expect(JSON.parse(result.content[0].text)).toEqual(fullPayload);
    });

    it('keeps fs.replace diagnostics in slim success responses', async () => {
        const result = await runToolCall(
            {
                client: {} as never,
                category: 'fs',
                name: 'fs',
                action: 'replace',
                args: { action: 'replace' },
                slimResponses: true,
            },
            async () => ({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        path: '/Notebook/Doc',
                        changed: true,
                        editsApplied: 1,
                        replacements: [{ index: 1, replaced: 1, replace_all: false }],
                        warning: 'This document contains SiYuan-native complex blocks.',
                        skippedComplexBlocks: [{ id: '20260612000000-complex', type: 's' }],
                        recommendedTools: ['block.dom', 'block.update'],
                        uiRefresh: {
                            applied: true,
                            operations: [{ type: 'reloadProtyle', id: 'doc' }],
                        },
                    }, null, 2),
                }],
            }),
        );

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            path: '/Notebook/Doc',
            changed: true,
            editsApplied: 1,
            replacements: [{ index: 1, replaced: 1, replace_all: false }],
            warning: 'This document contains SiYuan-native complex blocks.',
            skippedComplexBlocks: [{ id: '20260612000000-complex', type: 's' }],
            recommendedTools: ['block.dom', 'block.update'],
        });
    });

    it('slims search results and removes kernel pagination diagnostics', async () => {
        const result = await runToolCall(
            {
                client: {} as never,
                category: 'search',
                name: 'search',
                action: 'fulltext',
                args: { action: 'fulltext' },
                slimResponses: true,
            },
            async () => ({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        data: [{
                            id: '20260507000100-search0',
                            type: 'NodeParagraph',
                            box: 'notebook-id',
                            hPath: '/Doc',
                            content: '<mark>needle</mark>',
                            plainContent: 'needle',
                            markdown: 'needle',
                            path: '/20260507000100-doc.sy',
                            rootID: '20260507000100-doc',
                            notebookName: 'Notebook',
                        }],
                        total: 1,
                        page: 1,
                        pageSize: 32,
                        pageCount: 1,
                        hasNextPage: false,
                        showing: 1,
                        returnedTotal: 1,
                        kernelMatchedBlockCount: 1,
                        kernelPageCount: 1,
                    }, null, 2),
                }],
            }),
        );

        expect(JSON.parse(result.content[0].text)).toEqual({
            data: [{
                id: '20260507000100-search0',
                type: 'NodeParagraph',
                hPath: '/Doc',
                path: '/20260507000100-doc.sy',
                notebookName: 'Notebook',
                plainContent: 'needle',
            }],
            total: 1,
            page: 1,
            pageSize: 32,
            pageCount: 1,
            hasNextPage: false,
        });
    });

    it('slims permission errors while preserving actionable fields', async () => {
        const result = await runToolCall(
            {
                client: {} as never,
                category: 'block',
                name: 'block',
                action: 'append',
                args: { action: 'append' },
                slimResponses: true,
            },
            async () => ({
                isError: true,
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        error: {
                            type: 'permission_denied',
                            message: 'Notebook "nb" has permission "r".',
                            tool: 'block',
                            action: 'append',
                            notebook: 'nb',
                            current_permission: 'r',
                            required_permission: 'write',
                            hint: 'Use notebook(action="set_permission") to change.',
                        },
                    }, null, 2),
                }],
            }),
        );

        expect(JSON.parse(result.content[0].text)).toEqual({
            error: {
                type: 'permission_denied',
                message: 'Notebook "nb" has permission "r".',
                notebook: 'nb',
                current_permission: 'r',
                required_permission: 'write',
                hint: 'Use notebook(action="set_permission") to change.',
            },
        });
    });
});
