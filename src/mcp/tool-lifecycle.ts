import type { SiYuanClient } from '../api/client';
import { appendAnalyticsEvent, estimateResultSizeHint, extractErrorCode } from './analytics';
import type { ToolCategory } from './config';
import { earnPuppyBalance, readPuppyStats, writePuppyEvent } from './puppy-state';
import { getInvocationTransport } from './runtime';
import { maybeSendTelemetry } from './telemetry';
import type { ToolResult } from './tools/shared';

/**
 * Context handed to runToolCall. Enough for the lifecycle wrappers
 * (puppy events, analytics, telemetry) to do their work without looking
 * anything else up.
 */
export interface ToolCallContext {
    client: SiYuanClient;
    category: ToolCategory;
    name: string;
    action: string;
    args: Record<string, unknown> | undefined;
}

function buildAnalyticsEvent(
    name: string,
    action: string,
    args: unknown,
    status: 'success' | 'error',
    durationMs: number,
    resultText?: string,
    content?: { type: 'text'; text: string }[],
) {
    const paramKeys = args && typeof args === 'object'
        ? Object.keys(args as Record<string, unknown>).filter((key) => key !== 'action')
        : [];
    return {
        tool: name,
        action,
        status,
        durationMs,
        errorCode: status === 'error' ? extractErrorCode(resultText) : undefined,
        paramKeys,
        resultSizeHint: estimateResultSizeHint(content),
        transport: getInvocationTransport(),
    };
}

function extractMascotEventMeta(result: ToolResult): {
    itemId?: string; itemLabel?: string; itemType?: string; itemEmoji?: string;
} {
    if (result.isError) return {};
    try {
        const payload = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
        return {
            itemId: typeof payload.item_id === 'string' ? payload.item_id : undefined,
            itemLabel: typeof payload.item === 'string' ? payload.item : undefined,
            itemType: typeof payload.type === 'string' ? payload.type : undefined,
            itemEmoji: typeof payload.emoji === 'string' ? payload.emoji : undefined,
        };
    } catch {
        return {};
    }
}

async function persistAnalyticsEvent(
    client: SiYuanClient,
    event: Parameters<typeof appendAnalyticsEvent>[1],
): Promise<void> {
    const task = appendAnalyticsEvent(client, event).catch(() => { /* never block on analytics */ });
    if (getInvocationTransport() === 'cli') {
        await task;
    }
}

/**
 * Wrap one MCP tool call with the full side-effect lifecycle: puppy events,
 * analytics, telemetry ping. This sits between the MCP request handler and
 * the category-specific handlers so none of these pipelines get forgotten
 * or duplicated inline.
 *
 * Contract:
 * - Always writes a 'running' puppy event before `handler` runs.
 * - On success, writes a terminal puppy event ('success' or 'error' from
 *   ToolResult.isError) and enqueues an analytics event.
 * - On throw, enqueues an error analytics event and re-throws so the MCP
 *   protocol error path still fires.
 * - Analytics / telemetry always fire-and-forget: a write failure never
 *   blocks or fails the tool call.
 */
export async function runToolCall(
    ctx: ToolCallContext,
    handler: () => Promise<ToolResult>,
): Promise<ToolResult> {
    const { client, category, name, action, args } = ctx;
    const startTime = Date.now();

    // Mascot actions read the current puppy balance (they may spend it);
    // every other tool call earns +1 balance before running.
    const preStats = category === 'mascot'
        ? await readPuppyStats(client)
        : await earnPuppyBalance(client, `${name}/${action}`);
    await writePuppyEvent(client, {
        tool: name,
        action,
        status: 'running',
        totalCalls: preStats.totalCalls,
        balance: preStats.balance,
    });

    let result: ToolResult;
    try {
        result = await handler();
    } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorText = error instanceof Error ? error.message : String(error);
        await persistAnalyticsEvent(client, buildAnalyticsEvent(name, action, args, 'error', durationMs, errorText));
        maybeSendTelemetry(client).catch(() => { /* never block on telemetry */ });
        throw error;
    }

    const postStats = category === 'mascot' ? await readPuppyStats(client) : preStats;
    const mascotMeta = category === 'mascot' ? extractMascotEventMeta(result) : {};
    await writePuppyEvent(client, {
        tool: name,
        action,
        status: result.isError ? 'error' : 'success',
        totalCalls: postStats.totalCalls,
        balance: postStats.balance,
        ...mascotMeta,
    });

    const durationMs = Date.now() - startTime;
    await persistAnalyticsEvent(
        client,
        buildAnalyticsEvent(
            name,
            action,
            args,
            result.isError ? 'error' : 'success',
            durationMs,
            result.content[0]?.text,
            result.content,
        ),
    );
    maybeSendTelemetry(client).catch(() => { /* never block */ });

    return result;
}
