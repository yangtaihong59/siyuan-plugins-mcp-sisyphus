import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { load, Type, DEFAULT_SCHEMA } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import { generatePresetSnippet, MCP_SERVER_NAME, replacePromptTokens } from '@/ui/setting/mcp-config/http-server-panel-logic';

// Generators come from the panel logic module; only the state-bound prompt
// builder is still read from the component source.
const source = readFileSync('src/ui/setting/mcp-config/HttpServerPanel.svelte', 'utf8');
const promptStart = source.indexOf('    function generateMcpAiSetupPrompt(');
const promptSource = source.slice(promptStart, source.indexOf('\n    }', promptStart) + 6);
function create(workspaceDir: string, token: string, getLabel: (key: string, fallback: string) => string, httpSettings: Record<string, unknown>) {
    const withWindow = <T>(fn: () => T): T => {
        vi.stubGlobal('window', { siyuan: { config: { system: { workspaceDir }, api: { token } } } });
        try { return fn(); } finally { vi.unstubAllGlobals(); }
    };
    const buildPrompt = new Function('generatePresetSnippet', 'replacePromptTokens', 'getLabel', 'httpSettings', 'MCP_SERVER_NAME', `
const selectedMcpClientPreset = 'dsh';
const selectedMcpTransport = 'http';
const dshSetupGuide = 'Desktop: ~/.dsh/profiles/desktop/cordis.patch.yml';
const getSelectedMcpClientTitle = () => 'DSH';
const getSelectedMcpTransportTitle = () => 'HTTP/HTTPS';
${ts.transpileModule(promptSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText}
return generateMcpAiSetupPrompt;`)(generatePresetSnippet, replacePromptTokens, getLabel, httpSettings, MCP_SERVER_NAME);
    return {
        generate: (settings: any, transport: any) => withWindow(() => generatePresetSnippet(settings, 'dsh', transport)),
        prompt: () => withWindow(() => buildPrompt()),
    };
}
// Parse expression tags as inert data; never execute YAML JavaScript in tests.
const schema = DEFAULT_SCHEMA.extend([new Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: expression => ({ expression }) })]);
const settings = { host: '127.0.0.1', port: 36808, tlsEnabled: false, authEnabled: false, token: 'MUST_NOT_LEAK' };
const workspaceDir = 'C:\\工作目录 "test"';
const script = `${workspaceDir}/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs`;
const generator = create(workspaceDir, 'KERNEL_SECRET', (_key, fallback) => fallback, settings);
const parse = (text: string) => (load(text, { schema }) as any)[0].insert[0];

describe('DSH Cordis config copied by settings', () => {
    it('uses an insert entry and the configured HTTP URL without mcpServers', () => {
        const text = generator.generate(settings, 'http');
        expect(text).not.toContain('mcpServers');
        expect(parse(text)).toEqual({ id: 'mcp-siyuan-sisyphus', name: '@deepseek-ai/dsh-mcp-client', config: {
            serverName: 'siyuan-sisyphus', transport: 'streamable-http', url: 'http://127.0.0.1:36808/mcp', failOnStartupError: true,
        } });
    });
    it('supports HTTPS and references the MCP token without serializing secrets', () => {
        const text = generator.generate({ ...settings, tlsEnabled: true, authEnabled: true }, 'http');
        expect(text).not.toContain(settings.token);
        expect(parse(text).config).toMatchObject({ url: 'https://127.0.0.1:36808/mcp', headers: { Authorization: { expression: "'Bearer ' + process.env.MCP_TOKEN" } } });
    });
    it('round-trips quoted Windows script paths and uses a separate kernel token variable', () => {
        const text = generator.generate(settings, 'stdio');
        expect(text).not.toContain('KERNEL_SECRET');
        expect(parse(text).config).toMatchObject({ transport: 'stdio', command: 'node', args: [script], env: {
            SIYUAN_API_URL: 'http://127.0.0.1:6806', SIYUAN_TOKEN: { expression: 'process.env.SIYUAN_TOKEN' },
        } });
        // Without a kernel token the panel still references the environment variable
        // and never serializes its "xxxxxx" placeholder.
        const noToken = create('/ws', '', (_key, fallback) => fallback, settings).generate(settings, 'stdio');
        expect(parse(noToken).config.env.SIYUAN_TOKEN).toEqual({ expression: 'process.env.SIYUAN_TOKEN' });
        expect(noToken).not.toContain('xxxxxx');
    });
    it('copies a YAML AI setup prompt with the Cordis file location', () => {
        const prompt = generator.prompt();
        expect(prompt).toContain('```yaml\n- insert:');
        expect(prompt).toContain('~/.dsh/profiles/desktop/cordis.patch.yml');
        for (const locale of ['zh_CN', 'en_US']) {
            const labels = JSON.parse(readFileSync(`public/i18n/${locale}.json`, 'utf8'));
            expect(labels.mcpPresetDshTitle).toContain('DSH');
            expect(labels.mcpDshSetupGuide).toContain('MCP_TOKEN');
            expect(labels.mcpDshSetupGuide).toContain('mcp__siyuan-sisyphus__<tool>');
        }
    });
});
