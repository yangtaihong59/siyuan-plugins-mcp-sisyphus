import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runToolCall } from '@/mcp/tool-lifecycle';

vi.mock('@/mcp/analytics', () => ({
    appendAnalyticsEvent: vi.fn(() => Promise.resolve()),
    estimateResultSizeHint: vi.fn(() => '0-200'),
    extractErrorCode: vi.fn(() => 'UnknownError'),
}));

vi.mock('@/mcp/puppy-state', () => ({
    earnPuppyBalance: vi.fn(async () => ({ totalCalls: 1, balance: 1 })),
    readPuppyStats: vi.fn(async () => ({ totalCalls: 0, balance: 0 })),
    writePuppyEvent: vi.fn(async () => undefined),
}));

vi.mock('@/mcp/telemetry', () => ({
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
        const { appendAnalyticsEvent } = await import('@/mcp/analytics');

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
            },
            async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
        ).then(() => {
            finished = true;
        });

        await vi.waitFor(() => {
            expect(appendAnalyticsEvent).toHaveBeenCalledTimes(1);
            expect(release).toBeTypeOf('function');
        });
        expect(finished).toBe(false);

        release();
        await promise;
        expect(finished).toBe(true);
    });

    it('does not await analytics persistence for stdio invocations', async () => {
        process.env.SIYUAN_MCP_TRANSPORT = 'stdio';
        const { appendAnalyticsEvent } = await import('@/mcp/analytics');

        vi.mocked(appendAnalyticsEvent).mockImplementationOnce(() => new Promise<void>(() => {}));

        await expect(runToolCall(
            {
                client: {} as never,
                category: 'notebook',
                name: 'notebook',
                action: 'list',
                args: { action: 'list' },
            },
            async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
        )).resolves.toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] });
    });
});
