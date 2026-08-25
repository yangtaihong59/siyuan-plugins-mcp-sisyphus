import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    appendAnalyticsEvent,
    buildTokenUsageSummary,
    computeAnalyticsSummary,
    getRecentAnalyticsEvents,
    parseJsonl,
    clearAnalyticsData,
    estimateResultSizeHint,
    extractErrorCode,
    truncateAnalyticsText,
    MAX_ANALYTICS_TEXT_CHARS,
    ANALYTICS_PATH,
    ANALYTICS_ROTATED_PATH,
    type AnalyticsEvent,
} from '../../../src/core/analytics';
import { SiYuanClient } from '../../../src/api/client';
import { buildDefaultToolConfig } from '../../../src/core/config';
import { APPROX_TOKEN_MODE } from '../../../src/core/token-usage';

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

        it('preserves token usage fields when present', () => {
            const content = JSON.stringify({
                tool: 'system',
                action: 'get_version',
                ts: 1,
                seq: 1,
                status: 'success',
                durationMs: 10,
                paramKeys: [],
                transport: 'cli',
                requestChars: 24,
                responseChars: 19,
                requestApproxTokens: 6,
                responseApproxTokens: 5,
                totalApproxTokens: 11,
                tokenMode: APPROX_TOKEN_MODE,
                requestText: '{"action":"get_version"}',
                responseText: '{"version":"3.0.0"}',
                requestTextTruncated: false,
                responseTextTruncated: false,
            });
            const [event] = parseJsonl(content);
            expect(event.requestChars).toBe(24);
            expect(event.responseChars).toBe(19);
            expect(event.requestApproxTokens).toBe(6);
            expect(event.responseApproxTokens).toBe(5);
            expect(event.totalApproxTokens).toBe(11);
            expect(event.tokenMode).toBe(APPROX_TOKEN_MODE);
            expect(event.requestText).toBe('{"action":"get_version"}');
            expect(event.responseText).toBe('{"version":"3.0.0"}');
            expect(event.requestTextTruncated).toBe(false);
            expect(event.responseTextTruncated).toBe(false);
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
                requestChars: 10,
                responseChars: 20,
                requestApproxTokens: 3,
                responseApproxTokens: 5,
                totalApproxTokens: 8,
                tokenMode: APPROX_TOKEN_MODE,
                requestText: '{"action":"list"}',
                responseText: '{"ok":true}',
                requestTextTruncated: false,
                responseTextTruncated: false,
            });
            expect(client.writeFile).toHaveBeenCalledWith(ANALYTICS_PATH, expect.stringContaining('"tool":"notebook"'));
            expect(writtenFiles[ANALYTICS_PATH]).toContain('"requestText":"{\\"action\\":\\"list\\"}"');
            expect(writtenFiles[ANALYTICS_PATH]).toContain('"responseText":"{\\"ok\\":true}"');
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
                requestChars: 10,
                responseChars: 10,
                requestApproxTokens: 3,
                responseApproxTokens: 3,
                totalApproxTokens: 6,
                tokenMode: APPROX_TOKEN_MODE,
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
                requestChars: 10,
                responseChars: 10,
                requestApproxTokens: 3,
                responseApproxTokens: 3,
                totalApproxTokens: 6,
                tokenMode: APPROX_TOKEN_MODE,
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
            expect(summary.tokenUsage).toMatchObject({
                tokenMode: APPROX_TOKEN_MODE,
                cliMeasuredCalls: 0,
                mcpMeasuredCalls: 0,
                cliAvgApproxTokens: null,
                mcpAvgApproxTokens: null,
            });
        });

        it('computes correct aggregates', () => {
            const baseDate = new Date('2024-01-15T10:00:00Z').getTime();
            const events: AnalyticsEvent[] = [
                { seq: 1, ts: baseDate, tool: 'notebook', action: 'list', status: 'success', durationMs: 100, paramKeys: [], transport: 'cli', totalApproxTokens: 100, tokenMode: APPROX_TOKEN_MODE },
                { seq: 2, ts: baseDate + 1, tool: 'notebook', action: 'list', status: 'success', durationMs: 200, paramKeys: [], transport: 'stdio', totalApproxTokens: 200, tokenMode: APPROX_TOKEN_MODE },
                { seq: 3, ts: baseDate + 2, tool: 'document', action: 'create', status: 'error', durationMs: 300, paramKeys: ['path'], transport: 'http', errorCode: 'UnknownError', totalApproxTokens: 300, tokenMode: APPROX_TOKEN_MODE },
            ];
            const summary = computeAnalyticsSummary(events, { currentToolConfig: buildDefaultToolConfig() });
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
            expect(summary.tokenUsage).toMatchObject({
                tokenMode: APPROX_TOKEN_MODE,
                cliMeasuredCalls: 1,
                mcpMeasuredCalls: 2,
                cliAvgApproxTokens: 100,
                mcpAvgApproxTokens: 250,
            });
            expect(summary.tokenUsage.mcpInitialApproxTokens).toBeGreaterThan(0);
        });
    });

    describe('buildTokenUsageSummary', () => {
        it('ignores legacy rows without token fields', () => {
            const summary = buildTokenUsageSummary([
                { seq: 1, ts: 1, tool: 'notebook', action: 'list', status: 'success', durationMs: 10, paramKeys: [], transport: 'cli' },
                { seq: 2, ts: 2, tool: 'system', action: 'get_version', status: 'success', durationMs: 10, paramKeys: [], transport: 'http', totalApproxTokens: 20, tokenMode: APPROX_TOKEN_MODE },
            ], buildDefaultToolConfig());

            expect(summary.cliMeasuredCalls).toBe(0);
            expect(summary.cliAvgApproxTokens).toBeNull();
            expect(summary.mcpMeasuredCalls).toBe(1);
            expect(summary.mcpAvgApproxTokens).toBe(20);
            expect(summary.mcpInitialApproxTokens).toBeGreaterThan(0);
        });
    });

    describe('recent event helpers', () => {
        it('truncates captured text with a bounded local snapshot', () => {
            const captured = truncateAnalyticsText('a'.repeat(MAX_ANALYTICS_TEXT_CHARS + 10));
            expect(captured.text).toHaveLength(MAX_ANALYTICS_TEXT_CHARS);
            expect(captured.truncated).toBe(true);

            const short = truncateAnalyticsText('short');
            expect(short).toEqual({ text: 'short', truncated: false });
        });

        it('returns newest events first with a limit', () => {
            const events: AnalyticsEvent[] = [
                { seq: 1, ts: 100, tool: 'a', action: 'one', status: 'success', durationMs: 1, paramKeys: [], transport: 'stdio' },
                { seq: 2, ts: 300, tool: 'b', action: 'two', status: 'success', durationMs: 1, paramKeys: [], transport: 'stdio' },
                { seq: 3, ts: 300, tool: 'c', action: 'three', status: 'success', durationMs: 1, paramKeys: [], transport: 'stdio' },
            ];

            expect(getRecentAnalyticsEvents(events, 2).map((event) => event.tool)).toEqual(['c', 'b']);
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
            expect(estimateResultSizeHint([
                { type: 'text', text: 'metadata' },
                { type: 'image', data: 'a'.repeat(100_000), mimeType: 'image/png' },
            ])).toBe('0-200');
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
            expect(extractErrorCode('permission denied by SiYuan')).toBe('permission_denied');
        });

        it('extracts structured tool error types from JSON results', () => {
            const resultText = JSON.stringify({
                error: {
                    type: 'permission_denied',
                    message: 'Notebook "nb" has permission "r", write access is required.',
                    notebook: 'nb',
                    current_permission: 'r',
                    required_permission: 'write',
                },
            }, null, 2);

            expect(extractErrorCode(resultText)).toBe('permission_denied');
        });

        it('prefers semantic codes for generic API errors', () => {
            const resultText = JSON.stringify({
                error: {
                    type: 'api_error',
                    code: 'block_not_found',
                    message: 'block not found',
                },
            });

            expect(extractErrorCode(resultText)).toBe('block_not_found');
        });

        it('returns UnknownError for unrecognized text', () => {
            expect(extractErrorCode('something went wrong')).toBe('UnknownError');
        });

        it('returns undefined for undefined input', () => {
            expect(extractErrorCode(undefined)).toBeUndefined();
        });
    });
});
