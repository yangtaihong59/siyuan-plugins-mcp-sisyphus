import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    appendAnalyticsEvent,
    computeAnalyticsSummary,
    parseJsonl,
    clearAnalyticsData,
    estimateResultSizeHint,
    extractErrorCode,
    ANALYTICS_PATH,
    ANALYTICS_ROTATED_PATH,
    type AnalyticsEvent,
} from '../../../src/mcp/analytics';
import { SiYuanClient } from '../../../src/api/client';

describe('analytics', () => {
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

    describe('parseJsonl', () => {
        it('parses valid lines', () => {
            const content = JSON.stringify({ tool: 'notebook', action: 'list', ts: 1, seq: 1, status: 'success', durationMs: 10, paramKeys: [], transport: 'stdio' })
                + '\n'
                + JSON.stringify({ tool: 'document', action: 'create', ts: 2, seq: 2, status: 'error', durationMs: 20, paramKeys: ['path'], transport: 'http' });
            const events = parseJsonl(content);
            expect(events).toHaveLength(2);
            expect(events[0].tool).toBe('notebook');
            expect(events[1].tool).toBe('document');
        });

        it('ignores malformed lines', () => {
            const content = '{"tool":"ok","action":"a","ts":1,"seq":1,"status":"success","durationMs":0,"paramKeys":[],"transport":"stdio"}\nnot json\n{}';
            const events = parseJsonl(content);
            expect(events).toHaveLength(1);
            expect(events[0].tool).toBe('ok');
        });

        it('defaults unknown or missing transport to stdio', () => {
            const content = JSON.stringify({ tool: 'legacy', action: 'list', ts: 1, seq: 1, status: 'success', durationMs: 10, paramKeys: [] })
                + '\n'
                + JSON.stringify({ tool: 'weird', action: 'list', ts: 2, seq: 2, status: 'success', durationMs: 20, paramKeys: [], transport: 'socket' });
            const events = parseJsonl(content);
            expect(events).toHaveLength(2);
            expect(events[0].transport).toBe('stdio');
            expect(events[1].transport).toBe('stdio');
        });

        it('returns empty array for empty content', () => {
            expect(parseJsonl('')).toEqual([]);
            expect(parseJsonl('   \n  ')).toEqual([]);
        });
    });

    describe('appendAnalyticsEvent', () => {
        it('creates a new file on first write', async () => {
            const client = createMockClient();
            await appendAnalyticsEvent(client, {
                tool: 'notebook',
                action: 'list',
                status: 'success',
                durationMs: 5,
                paramKeys: [],
                transport: 'stdio',
            });
            expect(client.writeFile).toHaveBeenCalledWith(ANALYTICS_PATH, expect.stringContaining('"tool":"notebook"'));
        });

        it('appends to existing file', async () => {
            const client = createMockClient();
            writtenFiles[ANALYTICS_PATH] = '{"tool":"first","action":"a","ts":1,"seq":1,"status":"success","durationMs":0,"paramKeys":[],"transport":"stdio"}';
            await appendAnalyticsEvent(client, {
                tool: 'second',
                action: 'b',
                status: 'success',
                durationMs: 5,
                paramKeys: [],
                transport: 'stdio',
            });
            const content = writtenFiles[ANALYTICS_PATH];
            expect(content).toContain('"tool":"first"');
            expect(content).toContain('"tool":"second"');
            expect(content.split('\n')).toHaveLength(2);
        });

        it('rotates file when size exceeds limit', async () => {
            const client = createMockClient();
            const hugeLine = 'x'.repeat(3 * 1024 * 1024);
            const existing = JSON.stringify({ tool: 'huge', action: 'a', ts: 1, seq: 1, status: 'success', durationMs: 0, paramKeys: [], transport: 'stdio', padding: hugeLine });
            writtenFiles[ANALYTICS_PATH] = existing;

            await appendAnalyticsEvent(client, {
                tool: 'new',
                action: 'b',
                status: 'success',
                durationMs: 5,
                paramKeys: [],
                transport: 'stdio',
            });

            expect(writtenFiles[ANALYTICS_ROTATED_PATH]).toBe(existing);
            expect(writtenFiles[ANALYTICS_PATH]).toContain('"tool":"new"');
            expect(writtenFiles[ANALYTICS_PATH]).not.toContain(hugeLine);
        });
    });

    describe('computeAnalyticsSummary', () => {
        it('returns zeros for empty events', () => {
            const summary = computeAnalyticsSummary([]);
            expect(summary.totalCalls).toBe(0);
            expect(summary.errorRate).toBe(0);
            expect(summary.avgDurationMs).toBe(0);
            expect(summary.topActions).toEqual([]);
            expect(summary.dailyTrend).toEqual([]);
            expect(summary.transportDistribution).toEqual({ cli: 0, stdio: 0, http: 0 });
        });

        it('computes correct aggregates', () => {
            const baseDate = new Date('2024-01-15T10:00:00Z').getTime();
            const events: AnalyticsEvent[] = [
                { seq: 1, ts: baseDate, tool: 'notebook', action: 'list', status: 'success', durationMs: 100, paramKeys: [], transport: 'cli' },
                { seq: 2, ts: baseDate + 1, tool: 'notebook', action: 'list', status: 'success', durationMs: 200, paramKeys: [], transport: 'stdio' },
                { seq: 3, ts: baseDate + 2, tool: 'document', action: 'create', status: 'error', durationMs: 300, paramKeys: ['path'], transport: 'http', errorCode: 'UnknownError' },
            ];
            const summary = computeAnalyticsSummary(events);
            expect(summary.totalCalls).toBe(3);
            expect(summary.errorCalls).toBe(1);
            expect(summary.errorRate).toBeCloseTo(1 / 3);
            expect(summary.avgDurationMs).toBe(200);
            expect(summary.topActions).toHaveLength(2);
            expect(summary.topActions[0]).toMatchObject({ tool: 'notebook', action: 'list', count: 2, errorCount: 0, avgDurationMs: 150 });
            expect(summary.topActions[1]).toMatchObject({ tool: 'document', action: 'create', count: 1, errorCount: 1, avgDurationMs: 300 });
            expect(summary.dailyTrend).toHaveLength(1);
            expect(summary.dailyTrend[0]).toMatchObject({ date: '2024-01-15', count: 3, errorCount: 1 });
            expect(summary.transportDistribution).toEqual({ cli: 1, stdio: 1, http: 1 });
        });
    });

    describe('clearAnalyticsData', () => {
        it('writes empty strings to both files', async () => {
            const client = createMockClient();
            writtenFiles[ANALYTICS_PATH] = 'data';
            writtenFiles[ANALYTICS_ROTATED_PATH] = 'old';
            await clearAnalyticsData(client);
            expect(writtenFiles[ANALYTICS_PATH]).toBe('');
            expect(writtenFiles[ANALYTICS_ROTATED_PATH]).toBe('');
        });
    });

    describe('estimateResultSizeHint', () => {
        it('returns 0 for empty content', () => {
            expect(estimateResultSizeHint([])).toBe('0');
            expect(estimateResultSizeHint(undefined)).toBe('0');
        });

        it('returns correct buckets', () => {
            expect(estimateResultSizeHint([{ type: 'text', text: 'a'.repeat(100) }])).toBe('0-200');
            expect(estimateResultSizeHint([{ type: 'text', text: 'a'.repeat(500) }])).toBe('200-1K');
            expect(estimateResultSizeHint([{ type: 'text', text: 'a'.repeat(3000) }])).toBe('1K-5K');
            expect(estimateResultSizeHint([{ type: 'text', text: 'a'.repeat(10000) }])).toBe('5K-20K');
            expect(estimateResultSizeHint([{ type: 'text', text: 'a'.repeat(50000) }])).toBe('20K+');
        });
    });

    describe('extractErrorCode', () => {
        it('extracts known error patterns', () => {
            expect(extractErrorCode('McpError: InvalidRequest')).toContain('McpError');
            expect(extractErrorCode('SiYuan API error: 500')).toBe('SiYuanApiError');
            expect(extractErrorCode('HTTP error: 404')).toBe('HttpError');
            expect(extractErrorCode('Request timeout after 30000ms')).toBe('Timeout');
            expect(extractErrorCode('Unauthorized')).toBe('Unauthorized');
            expect(extractErrorCode('unauthorized access')).toBe('Unauthorized');
        });

        it('returns UnknownError for unrecognized text', () => {
            expect(extractErrorCode('something went wrong')).toBe('UnknownError');
        });

        it('returns undefined for undefined input', () => {
            expect(extractErrorCode(undefined)).toBeUndefined();
        });
    });
});
