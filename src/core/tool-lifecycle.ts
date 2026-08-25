import type { SiYuanClient } from '../api/client';
import { appendAnalyticsEvent, estimateResultSizeHint, extractErrorCode, truncateAnalyticsText } from './analytics';
import type { ToolCategory } from './config';
import { earnPuppyBalance, readPuppyStats, writePuppyEvent } from './puppy-state';
import { getInvocationTransport } from './runtime';
import { slimToolResult } from './slim-response';
import { maybeSendTelemetry } from './telemetry';
import { APPROX_TOKEN_MODE, measureApproxContent, measureApproxText } from './token-usage';
import type { ToolContent, ToolResult } from '@/tools/internal/shared';

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
    requestText?: string;
    includeUiRefreshMetadata?: boolean;
    slimResponses?: boolean;
}

function buildAnalyticsEvent(
    name: string,
    action: string,
    args: unknown,
    requestText: string | undefined,
    status: 'success' | 'error',
    durationMs: number,
    resultText?: string,
    content?: ToolContent[],
) {
    const requestMetrics = measureApproxText(requestText);
    const responseMetrics = content ? measureApproxContent(content) : measureApproxText(resultText);
    const responseText = content ? content.map((item) => item.type === 'text' ? item.text : '').join('') : (resultText ?? '');
    const requestSnapshot = truncateAnalyticsText(requestText);
    const responseSnapshot = truncateAnalyticsText(responseText);
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
        requestChars: requestMetrics.chars,
        responseChars: responseMetrics.chars,
        requestApproxTokens: requestMetrics.approxTokens,
        responseApproxTokens: responseMetrics.approxTokens,
        totalApproxTokens: requestMetrics.approxTokens + responseMetrics.approxTokens,
        tokenMode: APPROX_TOKEN_MODE,
        requestText: requestSnapshot.text,
        responseText: responseSnapshot.text,
        requestTextTruncated: requestSnapshot.truncated,
        responseTextTruncated: responseSnapshot.truncated,
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

function filterUiRefreshMetadata(result: ToolResult, includeUiRefreshMetadata: boolean | undefined): ToolResult {
    if (includeUiRefreshMetadata || result.isError) return result;

    const first = result.content[0];
    if (!first || first.type !== 'text') return result;

    let payload: Record<string, unknown>;
    try {
        const parsed = JSON.parse(first.text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
        payload = parsed as Record<string, unknown>;
    } catch {
        return result;
    }

    const uiRefresh = payload.uiRefresh;
    if (!uiRefresh || typeof uiRefresh !== 'object' || Array.isArray(uiRefresh)) return result;
    if ('partialFailure' in uiRefresh) return result;

    const nextPayload = { ...payload };
    delete nextPayload.uiRefresh;
    return {
        ...result,
        content: [{ ...first, text: JSON.stringify(nextPayload, null, 2) }, ...result.content.slice(1)],
    };
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
    // App-only action tools use transport-facing aliases such as
    // `mascot_shop_app_action`. The desktop puppy consumes canonical tool
    // categories, otherwise mascot-only decorations (hearts and the bought
    // item) are skipped even though the cat still enters its generic action
    // animation. Extension tools are the exception: their concrete name is
    // the only useful identity available to the puppy event stream.
    const puppyTool = category === 'extension' ? name : category;
    const requestText = ctx.requestText;
    const startTime = Date.now();

    // Mascot actions read the current puppy balance (they may spend it);
    // every other tool call earns +1 balance before running.
    const preStats = category === 'mascot'
        ? await readPuppyStats(client)
        : await earnPuppyBalance(client, `${name}/${action}`);
    await writePuppyEvent(client, {
        tool: puppyTool,
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
        await persistAnalyticsEvent(client, buildAnalyticsEvent(name, action, args, requestText, 'error', durationMs, errorText));
        maybeSendTelemetry(client).catch(() => { /* never block on telemetry */ });
        throw error;
    }
    // The desktop mascot needs the complete purchase payload. Extract it before
    // slim responses discard display-only fields such as emoji and item type.
    const mascotMeta = category === 'mascot' ? extractMascotEventMeta(result) : {};
    if (ctx.slimResponses) {
        result = slimToolResult(result, {
            category,
            action,
        });
    } else if (ctx.slimResponses === undefined) {
        result = filterUiRefreshMetadata(result, ctx.includeUiRefreshMetadata);
    }

    const postStats = category === 'mascot' ? await readPuppyStats(client) : preStats;
    await writePuppyEvent(client, {
        tool: puppyTool,
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
            requestText,
            result.isError ? 'error' : 'success',
            durationMs,
            result.content.find((item) => item.type === 'text')?.text,
            result.content,
        ),
    );
    maybeSendTelemetry(client).catch(() => { /* never block */ });

    return result;
}
