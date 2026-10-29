import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { getStdioServerConfig } from '@/ui/setting/mcp-config/http-server-panel-logic';

// Exercise the configuration generator that the Svelte copy buttons use.
const source = readFileSync(resolve('src/ui/setting/mcp-config/HttpServerPanel.svelte'), 'utf8');
const scriptFor = (workspaceDir: string) => `${workspaceDir}/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs`;
function generate(win: Record<string, unknown>, workspaceDir: string, token: string) {
    vi.stubGlobal('window', { ...win, siyuan: { config: { system: { workspaceDir }, api: { token } } } });
    try {
        return getStdioServerConfig(true);
    } finally {
        vi.unstubAllGlobals();
    }
}

describe('stable stdio connection snippets', () => {
    it('uses the fixed API endpoint across workspace origins while preserving token and script path', () => {
        for (const [port, workspace, token] of [[56602, 'SiYuan', 'first-token'], [58134, 'SiYuanDev', 'second-token']] as const) {
            const script = scriptFor(`/workspaces/${workspace}`);
            const config = generate({ location: { origin: `https://127.0.0.1:${port}` } }, `/workspaces/${workspace}`, token);
            expect(JSON.parse(JSON.stringify(config))).toEqual({
                command: 'node', args: [script], type: 'stdio',
                env: { SIYUAN_API_URL: 'http://127.0.0.1:6806', SIYUAN_TOKEN: token },
            });
        }
    });

    it('generates the fixed endpoint even when the workspace origin is unavailable', () => {
        const config = generate({ location: { origin: 'null' } }, '/ws', 'test-token');
        expect(config.env.SIYUAN_API_URL).toBe('http://127.0.0.1:6806');
    });
});

describe('default MCP transport', () => {
    const expression = source.match(/\$: selectedMcpTransport = (.*);/)![1];
    const select = new Function('preferredMcpTransport', 'httpStatus', `return ${expression};`);

    it('defaults to HTTP only while the service is running', () => {
        expect(select(null, { running: false })).toBe('stdio');
        expect(select(null, { running: true })).toBe('http');
    });

    it('preserves the user selection when service status changes', () => {
        expect(select('stdio', { running: true })).toBe('stdio');
        expect(select('http', { running: false })).toBe('http');
    });
});
