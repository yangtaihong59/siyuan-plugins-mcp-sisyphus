import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Exercise the configuration generator that the Svelte copy buttons use.
const source = readFileSync(resolve('src/ui/setting/mcp-config/HttpServerPanel.svelte'), 'utf8');
const functions = ['getStdioServerConfig'].map(name => {
    const start = source.indexOf(`    function ${name}(`);
    return source.slice(start, source.indexOf('\n    }', start) + 6);
}).join('\n');
const generate = new Function('window', 'getWorkspaceScriptPath', 'getSiYuanApiToken',
    ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + '\nreturn getStdioServerConfig(true);');

describe('stable stdio connection snippets', () => {
    it('uses the fixed API endpoint across workspace origins while preserving token and script path', () => {
        for (const [port, workspace, token] of [[56602, 'SiYuan', 'first-token'], [58134, 'SiYuanDev', 'second-token']] as const) {
            const script = `/workspaces/${workspace}/data/plugins/sisyphus/mcp-server.cjs`;
            const config = generate({ location: { origin: `https://127.0.0.1:${port}` } }, () => script, () => token);
            expect(JSON.parse(JSON.stringify(config))).toEqual({
                command: 'node', args: [script], type: 'stdio',
                env: { SIYUAN_API_URL: 'http://127.0.0.1:6806', SIYUAN_TOKEN: token },
            });
        }
    });

    it('generates the fixed endpoint even when the workspace origin is unavailable', () => {
        const config = generate({ location: { origin: 'null' } }, () => '/server.cjs', () => 'test-token');
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
