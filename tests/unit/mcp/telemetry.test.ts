import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    buildDefaultTelemetryConfig,
    normalizeTelemetryConfig,
    buildTelemetryPayload,
    maybeSendTelemetry,
    type TelemetryConfig,
} from '../../../src/mcp/telemetry';
import { ANALYTICS_PATH, ANALYTICS_ROTATED_PATH } from '../../../src/mcp/analytics';
import { TELEMETRY_CONFIG_PATH } from '../../../src/mcp/telemetry-config';
import { SiYuanClient } from '../../../src/api/client';

describe('telemetry', () => {
    let writtenFiles: Record<string, string> = {};

    function createMockClient(): SiYuanClient {
        writtenFiles = {};
        const client = new SiYuanClient();
        client.readFile = vi.fn(async (path: string) => {
            if (path in writtenFiles) {
                return writtenFiles[path];
            }
            throw new Error('File not found');
        });
        client.writeFile = vi.fn(async (path: string, content: string) => {
            writtenFiles[path] = content;
        });
        return client;
    }

    beforeEach(() => {
        writtenFiles = {};
    });

    describe('buildDefaultTelemetryConfig', () => {
        it('defaults to disabled', () => {
            const cfg = buildDefaultTelemetryConfig();
            expect(cfg.enabled).toBe(false);
            expect(cfg.reportIntervalHours).toBe(24);
            expect(cfg.lastReportAt).toBe(0);
            expect(cfg.endpoint).toBeUndefined();
        });
    });

    describe('normalizeTelemetryConfig', () => {
        it('returns defaults for invalid input', () => {
            expect(normalizeTelemetryConfig(null)).toEqual(buildDefaultTelemetryConfig());
            expect(normalizeTelemetryConfig('bad')).toEqual(buildDefaultTelemetryConfig());
            expect(normalizeTelemetryConfig([])).toEqual(buildDefaultTelemetryConfig());
        });

        it('clamps reportIntervalHours', () => {
            expect(normalizeTelemetryConfig({ reportIntervalHours: 0 })).toMatchObject({ reportIntervalHours: 1 });
            expect(normalizeTelemetryConfig({ reportIntervalHours: 999 })).toMatchObject({ reportIntervalHours: 168 });
            expect(normalizeTelemetryConfig({ reportIntervalHours: 48 })).toMatchObject({ reportIntervalHours: 48 });
        });

        it('preserves valid values', () => {
            const raw: TelemetryConfig = {
                enabled: true,
                lastReportAt: 123456,
                reportIntervalHours: 12,
                endpoint: 'https://example.com',
            };
            expect(normalizeTelemetryConfig(raw)).toEqual(raw);
        });
    });

    describe('buildTelemetryPayload', () => {
        it('returns null when no analytics events exist', async () => {
            const client = createMockClient();
            const payload = await buildTelemetryPayload(client, 0);
            expect(payload).toBeNull();
        });

        it('returns null when all events are before since', async () => {
            const client = createMockClient();
            const line = JSON.stringify({ seq: 1, ts: 1000, tool: 'notebook', action: 'list', status: 'success', durationMs: 10, paramKeys: [], transport: 'stdio' });
            writtenFiles[ANALYTICS_PATH] = line;
            const payload = await buildTelemetryPayload(client, 5000);
            expect(payload).toBeNull();
        });

        it('builds aggregate payload correctly', async () => {
            const client = createMockClient();
            const since = 0;
            const events = [
                { seq: 1, ts: 1000, tool: 'notebook', action: 'list', status: 'success', durationMs: 100, paramKeys: [], transport: 'cli' },
                { seq: 2, ts: 2000, tool: 'notebook', action: 'list', status: 'success', durationMs: 200, paramKeys: [], transport: 'stdio' },
                { seq: 3, ts: 3000, tool: 'document', action: 'create', status: 'error', durationMs: 300, paramKeys: ['path'], transport: 'http', errorCode: 'UnknownError' },
            ];
            writtenFiles[ANALYTICS_PATH] = events.map((e) => JSON.stringify(e)).join('\n');

            const payload = await buildTelemetryPayload(client, since);
            expect(payload).not.toBeNull();
            expect(payload!.v).toBe(1);
            expect(payload!.since).toBe(since);
            expect(payload!.aggregates.totalCalls).toBe(3);
            expect(payload!.aggregates.errorCalls).toBe(1);
            expect(payload!.aggregates.errorRate).toBeCloseTo(1 / 3);
            expect(payload!.aggregates.avgDurationMs).toBe(200);
            expect(payload!.aggregates.actionBreakdown).toHaveLength(2);
            expect(payload!.aggregates.hourlyDistribution).toHaveLength(24);
            expect(payload!.aggregates.transportDistribution).toEqual({ cli: 1, stdio: 1, http: 1 });
        });

        it('reads from rotated file as well', async () => {
            const client = createMockClient();
            const e1 = { seq: 1, ts: 1000, tool: 'notebook', action: 'list', status: 'success', durationMs: 10, paramKeys: [], transport: 'stdio' };
            const e2 = { seq: 2, ts: 2000, tool: 'document', action: 'create', status: 'success', durationMs: 20, paramKeys: [], transport: 'http' };
            writtenFiles[ANALYTICS_PATH] = JSON.stringify(e1);
            writtenFiles[ANALYTICS_ROTATED_PATH] = JSON.stringify(e2);

            const payload = await buildTelemetryPayload(client, 0);
            expect(payload!.aggregates.totalCalls).toBe(2);
        });

        it('treats legacy analytics rows without transport as stdio', async () => {
            const client = createMockClient();
            writtenFiles[ANALYTICS_PATH] = JSON.stringify({
                seq: 1,
                ts: 1000,
                tool: 'notebook',
                action: 'list',
                status: 'success',
                durationMs: 10,
                paramKeys: [],
            });

            const payload = await buildTelemetryPayload(client, 0);
            expect(payload!.aggregates.transportDistribution).toEqual({ cli: 0, stdio: 1, http: 0 });
        });
    });

    describe('maybeSendTelemetry', () => {
        it('does not send without endpoint', async () => {
            const client = createMockClient();
            const fetchSpy = vi.fn();
            vi.stubGlobal('fetch', fetchSpy);

            writtenFiles[TELEMETRY_CONFIG_PATH] = JSON.stringify({
                enabled: true,
                lastReportAt: 0,
                reportIntervalHours: 24,
            });

            await maybeSendTelemetry(client);
            expect(fetchSpy).not.toHaveBeenCalled();
        });
    });
});
