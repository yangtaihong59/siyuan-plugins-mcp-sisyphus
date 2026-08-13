import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import type { ToolResult } from '../tools/internal/shared';
import type { CliWriteCoordinatorSettings } from './runtime';

export async function callCliWriteCoordinator(
    settings: CliWriteCoordinatorSettings | undefined,
    name: string,
    args: Record<string, unknown>,
): Promise<ToolResult> {
    if (!settings) {
        return failure(
            'write_coordinator_unavailable',
            'Strict safe writes require the plugin-hosted MCP HTTP server. Enable it in plugin settings and retry.',
        );
    }

    const client = new Client(
        { name: 'siyuan-sisyphus-cli-write-coordinator', version: '1.0.0' },
        { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(new URL(settings.url), {
        ...(settings.token ? {
            authProvider: { token: async () => settings.token! },
        } : {}),
        reconnectionOptions: { maxReconnectionDelay: 0, initialReconnectionDelay: 0, reconnectionDelayGrowFactor: 1, maxRetries: 0 },
    });
    try {
        await client.connect(transport);
        const result = await client.callTool({ name, arguments: args });
        const content = result.content
            .filter((item): item is Extract<typeof item, { type: 'text' }> => item.type === 'text')
            .map((item) => ({ type: 'text' as const, text: item.text }));
        return {
            content: content.length > 0
                ? content
                : [{ type: 'text', text: JSON.stringify(result.structuredContent ?? {}) }],
            ...(result.isError ? { isError: true } : {}),
            ...(result.structuredContent && typeof result.structuredContent === 'object'
                ? { structuredContent: result.structuredContent as Record<string, unknown> }
                : {}),
        };
    } catch (error) {
        return failure(
            'write_coordinator_unavailable',
            `Could not call the plugin write coordinator: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
        await client.close().catch(() => {});
    }
}

function failure(code: string, message: string): ToolResult {
    const payload = {
        success: false,
        writeSafetyMode: 'strict',
        writeAttempted: false,
        writeExecuted: false,
        error: { code, message },
    };
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        isError: true,
    };
}
