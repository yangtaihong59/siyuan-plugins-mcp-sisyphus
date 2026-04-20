import type { SiYuanClient } from '../api/client';
import {
    ANALYTICS_PATH,
    ANALYTICS_ROTATED_PATH,
    createTransportDistribution,
    normalizeAnalyticsTransport,
    type AnalyticsEvent,
    parseJsonl,
} from './analytics';
import type { InvocationTransport } from './runtime';
import {
    TELEMETRY_CONFIG_PATH,
    buildDefaultTelemetryConfig,
    normalizeTelemetryConfig,
    type TelemetryConfig,
} from './telemetry-config';

export {
    buildDefaultTelemetryConfig,
    normalizeTelemetryConfig,
    type TelemetryConfig,
} from './telemetry-config';

export interface TelemetryPayload {
    v: 1;
    reportedAt: number;
    since: number;
    aggregates: {
        totalCalls: number;
        errorCalls: number;
        errorRate: number;
        avgDurationMs: number;
        actionBreakdown: Array<{
            tool: string;
            action: string;
            count: number;
            errorCount: number;
            avgDurationMs: number;
        }>;
        hourlyDistribution: number[];
        transportDistribution: Record<InvocationTransport, number>;
    };
    meta: {
        pluginVersion?: string;
        nodeVersion?: string;
        platform?: string;
    };
}

export async function loadTelemetryConfig(client: SiYuanClient): Promise<TelemetryConfig> {
    try {
        const content = await client.readFile(TELEMETRY_CONFIG_PATH);
        if (content) {
            return normalizeTelemetryConfig(JSON.parse(content));
        }
    } catch {
        // ignore missing or invalid config
    }
    return buildDefaultTelemetryConfig();
}

export async function saveTelemetryConfig(client: SiYuanClient, config: TelemetryConfig): Promise<TelemetryConfig> {
    const normalized = normalizeTelemetryConfig(config);
    try {
        await client.writeFile(TELEMETRY_CONFIG_PATH, JSON.stringify(normalized));
    } catch {
        // ignore write failure
    }
    return normalized;
}

async function readAllAnalyticsEvents(client: SiYuanClient): Promise<AnalyticsEvent[]> {
    const events: AnalyticsEvent[] = [];
    try {
        const content = await client.readFile(ANALYTICS_PATH);
        if (content) events.push(...parseJsonl(content));
    } catch {
        // ignore
    }
    try {
        const rotated = await client.readFile(ANALYTICS_ROTATED_PATH);
        if (rotated) events.push(...parseJsonl(rotated));
    } catch {
        // ignore
    }
    return events;
}

export async function buildTelemetryPayload(
    client: SiYuanClient,
    since: number,
): Promise<TelemetryPayload | null> {
    const events = await readAllAnalyticsEvents(client);
    const windowed = events.filter((e) => e.ts >= since);
    if (windowed.length === 0) {
        return null;
    }

    const totalCalls = windowed.length;
    const errorCalls = windowed.filter((e) => e.status === 'error').length;
    const totalDuration = windowed.reduce((sum, e) => sum + (e.durationMs || 0), 0);

    const actionMap = new Map<string, { tool: string; action: string; count: number; errorCount: number; totalDuration: number }>();
    const hourlyDistribution = new Array(24).fill(0);
    const transportDistribution = createTransportDistribution();

    for (const e of windowed) {
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

        const hour = new Date(e.ts).getHours();
        if (hour >= 0 && hour < 24) {
            hourlyDistribution[hour] += 1;
        }

        transportDistribution[normalizeAnalyticsTransport(e.transport)] += 1;
    }

    const actionBreakdown = Array.from(actionMap.values())
        .map((a) => ({
            tool: a.tool,
            action: a.action,
            count: a.count,
            errorCount: a.errorCount,
            avgDurationMs: a.count > 0 ? Math.round(a.totalDuration / a.count) : 0,
        }))
        .sort((a, b) => b.count - a.count);

    return {
        v: 1,
        reportedAt: Date.now(),
        since,
        aggregates: {
            totalCalls,
            errorCalls,
            errorRate: totalCalls > 0 ? Math.round((errorCalls / totalCalls) * 1000) / 1000 : 0,
            avgDurationMs: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
            actionBreakdown,
            hourlyDistribution,
            transportDistribution,
        },
        meta: {
            pluginVersion: process.env.SIYUAN_MCP_PLUGIN_VERSION,
            nodeVersion: process.version,
            platform: process.platform,
        },
    };
}

export async function maybeSendTelemetry(client: SiYuanClient): Promise<void> {
    const config = await loadTelemetryConfig(client);
    if (!config.enabled || !config.endpoint) {
        return;
    }

    const intervalMs = config.reportIntervalHours * 60 * 60 * 1000;
    const nextReportAt = config.lastReportAt + intervalMs;
    if (Date.now() < nextReportAt) {
        return;
    }

    const payload = await buildTelemetryPayload(client, config.lastReportAt || Date.now() - intervalMs);
    if (!payload) {
        // Nothing to report; still update lastReportAt to avoid endless retries
        await saveTelemetryConfig(client, { ...config, lastReportAt: Date.now() });
        return;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(config.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            await saveTelemetryConfig(client, { ...config, lastReportAt: Date.now() });
        }
    } catch {
        // Silent fail - telemetry must never block tool calls
    }
}
