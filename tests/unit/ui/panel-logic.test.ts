import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDefaultHttpServerSettings } from '@/ui/setting/tool-config-storage';
import { buildDefaultTelemetryConfig } from '@/core/telemetry-config';
import {
    generateCodexConfig,
    getCurrentWorkspaceApiUrl,
    parseChangelogEntries,
    replacePromptTokens,
} from '@/ui/setting/mcp-config/http-server-panel-logic';
import { buildDailyHeatmap, buildHeatmapMonths, buildTelemetryItems, formatChars, formatTimestamp, getUiLocale } from '@/ui/setting/mcp-config/telemetry-panel-logic';

const label = (_key: string, fallback: string) => fallback;

describe('settings panel logic', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders the telemetry endpoint as a form-input "textinput" field', () => {
        const endpoint = buildTelemetryItems(buildDefaultTelemetryConfig(), label).find((item) => item.key === 'telemetry__endpoint');
        expect(endpoint?.type).toBe('textinput');
    });

    it('generates Codex TOML for HTTP with and without auth', () => {
        const settings = { ...buildDefaultHttpServerSettings(), host: '127.0.0.1' as const, port: 36806, authEnabled: false };
        expect(generateCodexConfig(settings, 'http')).toBe('[mcp_servers.siyuan-sisyphus]\nurl = "http://127.0.0.1:36806/mcp"\nenabled = true');
        expect(generateCodexConfig({ ...settings, authEnabled: true, token: 'a"b' }, 'http'))
            .toContain('http_headers = { "Authorization" = "Bearer a\\"b" }');
    });

    it('parses changelog lines with optional dates and bold segments', () => {
        expect(parseChangelogEntries('`0.6.13` · 2026-10-20 — **Fix** DSH\nplain line')).toEqual([
            { version: '0.6.13', date: '2026-10-20', description: 'Fix DSH', segments: [{ text: 'Fix', strong: true }, { text: ' DSH', strong: false }] },
            { version: '', date: '', description: 'plain line', segments: [{ text: 'plain line', strong: false }] },
        ]);
    });

    it('fills prompt tokens and falls back to the default API URL outside an http(s) origin', () => {
        expect(replacePromptTokens('{{apiUrl}} / {{apiUrl}}', { apiUrl: 'x' })).toBe('x / x');
        vi.stubGlobal('window', { location: { origin: 'app://siyuan' } });
        expect(getCurrentWorkspaceApiUrl()).toBe('http://127.0.0.1:6806');
        vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:6806' } });
        expect(getCurrentWorkspaceApiUrl()).toBe('http://127.0.0.1:6806');
    });

    it('formats character counts for the telemetry summary', () => {
        expect(typeof formatChars(12345)).toBe('string');
    });

    it('formats usage dates in the SiYuan UI language rather than the OS locale', () => {
        expect(getUiLocale('en_US')).toBe('en-US');
        expect(getUiLocale('zh-CN')).toBe('zh-CN');
        expect(getUiLocale('zh_CHT')).toBe('zh-TW');
        expect(getUiLocale('not a locale!')).toBeUndefined();
        vi.stubGlobal('window', { siyuan: { config: { lang: 'en_US' } } });
        expect(getUiLocale()).toBe('en-US');

        const days = buildDailyHeatmap([]);
        expect(buildHeatmapMonths(days, 'en-US').map((month) => month.label)).not.toContain('1月');
        expect(buildHeatmapMonths(days, 'en-US').map((month) => month.label)).toContain('Jan');
        expect(buildHeatmapMonths(days, 'zh-CN').map((month) => month.label)).toContain('1月');
        expect(formatTimestamp(Date.UTC(2026, 9, 29, 1, 2, 3), 'en-US')).toMatch(/10\/2[89]\/2026/);
    });
});
