import type { SiYuanClient } from '../api/client';
import type { ToolConfig } from './config';
import type { InvocationTransport } from './runtime';
import {
    APPROX_TOKEN_MODE,
    calculateMcpInitialTokenCost,
} from './token-usage';

export const ANALYTICS_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/analytics.jsonl';
export const ANALYTICS_ROTATED_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/analytics.jsonl.1';
const MAX_ANALYTICS_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_ANALYTICS_TEXT_CHARS = 20_000;

export interface AnalyticsEvent {
    seq: number;
    ts: number;
    tool: string;
    action: string;
    status: 'running' | 'success' | 'error';
    durationMs: number;
    errorCode?: string;
    paramKeys: string[];
    resultSizeHint?: string;
    transport: InvocationTransport;
    sessionIdHash?: string;
    requestChars?: number;
    responseChars?: number;
    requestApproxTokens?: number;
    responseApproxTokens?: number;
    totalApproxTokens?: number;
    tokenMode?: typeof APPROX_TOKEN_MODE;
    requestText?: string;
    responseText?: string;
    requestTextTruncated?: boolean;
    responseTextTruncated?: boolean;
}

export interface TokenUsageSummary {
    tokenMode: typeof APPROX_TOKEN_MODE;
    cliMeasuredCalls: number;
    mcpMeasuredCalls: number;
    cliAvgApproxTokens: number | null;
    mcpAvgApproxTokens: number | null;
    mcpInitialChars?: number;
    mcpInitialApproxTokens?: number;
}

export interface AnalyticsSummary {
    totalCalls: number;
    errorCalls: number;
    errorRate: number;
    avgDurationMs: number;
    topActions: Array<{ tool: string; action: string; count: number; errorCount: number; avgDurationMs: number }>;
    dailyTrend: Array<{ date: string; count: number; errorCount: number }>;
    transportDistribution: Record<InvocationTransport, number>;
    tokenUsage: TokenUsageSummary;
}

export function truncateAnalyticsText(text: string | undefined | null): { text: string; truncated: boolean } {
    const normalized = typeof text === 'string' ? text : '';
    if (normalized.length <= MAX_ANALYTICS_TEXT_CHARS) {
        return { text: normalized, truncated: false };
    }
    return {
        text: normalized.slice(0, MAX_ANALYTICS_TEXT_CHARS),
        truncated: true,
    };
}

export function normalizeAnalyticsTransport(value: unknown): InvocationTransport {
    if (value === 'cli' || value === 'http') {
        return value;
    }
    return 'stdio';
}

export function createTransportDistribution(): Record<InvocationTransport, number> {
    return {
        cli: 0,
        stdio: 0,
        http: 0,
    };
}

function toMeasuredTokenValue(event: AnalyticsEvent): number | null {
    return typeof event.totalApproxTokens === 'number' && Number.isFinite(event.totalApproxTokens) && event.totalApproxTokens >= 0
        ? event.totalApproxTokens
        : null;
}

function getByteLength(text: string): number {
    if (typeof Buffer !== 'undefined') {
        return Buffer.byteLength(text, 'utf8');
    }
    return new TextEncoder().encode(text).length;
}

export function parseJsonl(content: string): AnalyticsEvent[] {
    const events: AnalyticsEvent[] = [];
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed = JSON.parse(trimmed) as Partial<AnalyticsEvent>;
            if (
                typeof parsed.tool === 'string' &&
                typeof parsed.action === 'string' &&
                typeof parsed.ts === 'number'
            ) {
                events.push({
                    ...parsed,
                    transport: normalizeAnalyticsTransport(parsed.transport),
                } as AnalyticsEvent);
            }
        } catch {
            // ignore malformed lines
        }
    }
    return events;
}

export async function appendAnalyticsEvent(
    client: SiYuanClient,
    event: Omit<AnalyticsEvent, 'seq' | 'ts'>,
): Promise<void> {
    const fullEvent: AnalyticsEvent = {
        ...event,
        seq: Date.now(),
        ts: Date.now(),
    };
    const line = JSON.stringify(fullEvent);

    try {
        const existing = await client.readFile(ANALYTICS_PATH);
        if (existing) {
            const newContent = `${existing}\n${line}`;
            if (getByteLength(newContent) > MAX_ANALYTICS_BYTES) {
                await client.writeFile(ANALYTICS_ROTATED_PATH, existing);
                await client.writeFile(ANALYTICS_PATH, line);
            } else {
                await client.writeFile(ANALYTICS_PATH, newContent);
            }
            return;
        }
    } catch {
        // File may not exist yet
    }

    try {
        await client.writeFile(ANALYTICS_PATH, line);
    } catch {
        // Silent fail - analytics must never block tool calls
    }
}

export async function readAnalyticsEvents(
    client: SiYuanClient,
    windowHours = 24 * 7,
): Promise<AnalyticsEvent[]> {
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
    const events: AnalyticsEvent[] = [];

    try {
        const content = await client.readFile(ANALYTICS_PATH);
        if (content) {
            events.push(...parseJsonl(content).filter((e) => e.ts >= cutoff));
        }
    } catch {
        // ignore
    }

    try {
        const rotated = await client.readFile(ANALYTICS_ROTATED_PATH);
        if (rotated) {
            events.push(...parseJsonl(rotated).filter((e) => e.ts >= cutoff));
        }
    } catch {
        // ignore
    }

    return events;
}

export function buildTokenUsageSummary(
    events: AnalyticsEvent[],
    currentToolConfig?: ToolConfig,
): TokenUsageSummary {
    let cliMeasuredCalls = 0;
    let mcpMeasuredCalls = 0;
    let cliTotalApproxTokens = 0;
    let mcpTotalApproxTokens = 0;

    for (const event of events) {
        const measuredTokens = toMeasuredTokenValue(event);
        if (measuredTokens === null) continue;

        if (normalizeAnalyticsTransport(event.transport) === 'cli') {
            cliMeasuredCalls += 1;
            cliTotalApproxTokens += measuredTokens;
            continue;
        }

        mcpMeasuredCalls += 1;
        mcpTotalApproxTokens += measuredTokens;
    }

    const initialCost = currentToolConfig ? calculateMcpInitialTokenCost(currentToolConfig) : null;

    return {
        tokenMode: APPROX_TOKEN_MODE,
        cliMeasuredCalls,
        mcpMeasuredCalls,
        cliAvgApproxTokens: cliMeasuredCalls > 0 ? cliTotalApproxTokens / cliMeasuredCalls : null,
        mcpAvgApproxTokens: mcpMeasuredCalls > 0 ? mcpTotalApproxTokens / mcpMeasuredCalls : null,
        ...(initialCost ?? {}),
    };
}

export function getRecentAnalyticsEvents(events: AnalyticsEvent[], limit = 100): AnalyticsEvent[] {
    return [...events]
        .sort((a, b) => {
            if (b.ts !== a.ts) return b.ts - a.ts;
            return b.seq - a.seq;
        })
        .slice(0, Math.max(0, limit));
}

export function computeAnalyticsSummary(
    events: AnalyticsEvent[],
    options: { currentToolConfig?: ToolConfig } = {},
): AnalyticsSummary {
    const totalCalls = events.length;
    const errorCalls = events.filter((e) => e.status === 'error').length;
    const errorRate = totalCalls > 0 ? errorCalls / totalCalls : 0;
    const avgDurationMs = totalCalls > 0
        ? events.reduce((sum, e) => sum + (e.durationMs || 0), 0) / totalCalls
        : 0;

    const actionMap = new Map<string, { tool: string; action: string; count: number; errorCount: number; totalDuration: number }>();
    const dayMap = new Map<string, { count: number; errorCount: number }>();
    const transportDistribution = createTransportDistribution();

    for (const e of events) {
        const key = `${e.tool}/${e.action}`;
        const existing = actionMap.get(key);
        if (existing) {
            existing.count += 1;
            existing.errorCount += e.status === 'error' ? 1 : 0;
            existing.totalDuration += e.durationMs || 0;
        } else {
            actionMap.set(key, {
                tool: e.tool,
                action: e.action,
                count: 1,
                errorCount: e.status === 'error' ? 1 : 0,
                totalDuration: e.durationMs || 0,
            });
        }

        const date = new Date(e.ts).toISOString().slice(0, 10);
        const dayEntry = dayMap.get(date);
        if (dayEntry) {
            dayEntry.count += 1;
            dayEntry.errorCount += e.status === 'error' ? 1 : 0;
        } else {
            dayMap.set(date, { count: 1, errorCount: e.status === 'error' ? 1 : 0 });
        }

        transportDistribution[normalizeAnalyticsTransport(e.transport)] += 1;
    }

    const topActions = Array.from(actionMap.values())
        .map((a) => ({
            tool: a.tool,
            action: a.action,
            count: a.count,
            errorCount: a.errorCount,
            avgDurationMs: a.count > 0 ? a.totalDuration / a.count : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const dailyTrend = Array.from(dayMap.entries())
        .map(([date, data]) => ({ date, count: data.count, errorCount: data.errorCount }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        totalCalls,
        errorCalls,
        errorRate,
        avgDurationMs,
        topActions,
        dailyTrend,
        transportDistribution,
        tokenUsage: buildTokenUsageSummary(events, options.currentToolConfig),
    };
}

export async function clearAnalyticsData(client: SiYuanClient): Promise<void> {
    try {
        await client.writeFile(ANALYTICS_PATH, '');
    } catch {
        // ignore
    }
    try {
        await client.writeFile(ANALYTICS_ROTATED_PATH, '');
    } catch {
        // ignore
    }
}

export function estimateResultSizeHint(content: Array<{ type: string; text?: string }> | undefined): string | undefined {
    if (!content || content.length === 0) return '0';
    const totalChars = content.reduce((sum, item) => sum + (item.type === 'text' ? item.text?.length ?? 0 : 0), 0);
    if (totalChars <= 200) return '0-200';
    if (totalChars <= 1000) return '200-1K';
    if (totalChars <= 5000) return '1K-5K';
    if (totalChars <= 20000) return '5K-20K';
    return '20K+';
}

function extractStructuredErrorCode(resultText: string): string | undefined {
    try {
        const parsed = JSON.parse(resultText) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

        const error = (parsed as Record<string, unknown>).error;
        if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined;

        const type = (error as Record<string, unknown>).type;
        const code = (error as Record<string, unknown>).code;
        const errorType = typeof type === 'string' && type ? type : undefined;
        const semanticCode = typeof code === 'string' && code ? code : undefined;

        if (semanticCode && (errorType === 'api_error' || errorType === 'internal_error')) {
            return semanticCode;
        }

        return errorType ?? semanticCode;
    } catch {
        return undefined;
    }
}

export function extractErrorCode(resultText: string | undefined): string | undefined {
    if (!resultText) return undefined;
    const structuredCode = extractStructuredErrorCode(resultText);
    if (structuredCode) return structuredCode;

    // Try to extract a concise error indicator without exposing sensitive IDs/paths
    if (resultText.includes('McpError')) {
        const match = resultText.match(/McpError\s*\(?([^:)]{1,40})\)?/);
        if (match) return `McpError:${match[1]}`;
        return 'McpError';
    }
    if (resultText.includes('SiYuan API error')) return 'SiYuanApiError';
    if (resultText.includes('HTTP error')) return 'HttpError';
    if (resultText.includes('timeout')) return 'Timeout';
    if (resultText.includes('Unauthorized') || resultText.includes('unauthorized')) return 'Unauthorized';
    if (/permission denied/i.test(resultText)) return 'permission_denied';
    return 'UnknownError';
}
