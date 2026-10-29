import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { ParsedArgs } from '@/cli/args';
import { HttpSiYuanClient } from '@/api/client';
import { runHelp, runList } from '@/cli/list-help';
import * as pluginCheck from '@/cli/plugin-check';
import { buildDefaultToolConfig } from '@/core/config';
import { TOOL_REGISTRY } from '@/mcp/tool-registry';
import { DocumentEnsureLinkTargetsSchema } from '@/tools/document/schemas';

function captureStdIO() {
    let stdout = '';
    let stderr = '';

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        stdout += String(chunk);
        return true;
    }) as typeof process.stdout.write);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        stderr += String(chunk);
        return true;
    }) as typeof process.stderr.write);

    return {
        get stdout() { return stdout; },
        get stderr() { return stderr; },
        restore() {
            stdoutSpy.mockRestore();
            stderrSpy.mockRestore();
        },
    };
}

describe('cli/list-help', () => {
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');

    beforeEach(() => {
        Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
        Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: false });
        vi.spyOn(pluginCheck, 'ensureRequiredPluginInstalled').mockResolvedValue(undefined);
        vi.spyOn(HttpSiYuanClient.prototype, 'readFile').mockResolvedValue('');
        // Extension discovery must not probe the user's running kernel or reuse its CLI profile token.
        vi.spyOn(HttpSiYuanClient.prototype, 'requestRead').mockRejectedValue(new Error('Live API access is disabled in CLI help unit tests'));
        delete process.env.SIYUAN_API_URL;
        delete process.env.SIYUAN_TOKEN;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.SIYUAN_API_URL;
        delete process.env.SIYUAN_TOKEN;
        if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY);
        if (stderrTTY) Object.defineProperty(process.stderr, 'isTTY', stderrTTY);
    });

    it('uses valid shared link-target examples in CLI action help', async () => {
        const io = captureStdIO();
        try {
            const code = await runHelp({
                command: 'help', tool: 'document', action: 'ensure_link_targets',
                rest: [], json: true, debug: false,
            } as ParsedArgs);
            expect(code, io.stderr || io.stdout).toBe(0);
            const output = JSON.parse(io.stdout);
            expect(output.example).toEqual(output.examples[0].mcp);
            const modes = output.examples.map(({ mcp }: { mcp: string }) => {
                const mode = mcp.match(/--mode (\w+)/)![1];
                const targets = JSON.parse(mcp.match(/--targets-json '([^']+)'/)![1]);
                expect(DocumentEnsureLinkTargetsSchema.safeParse({
                    action: 'ensure_link_targets', notebook: 'notebook-id', parentId: 'parent-id', mode, targets,
                }).success).toBe(true);
                expect(mcp).toContain('--parent-id 20240318112233-abc1234');
                return mode;
            });
            expect(modes).toEqual(['resolve', 'reuse', 'create']);
            expect(output.example).toContain('--mode resolve');
        } finally {
            io.restore();
        }
    });

    it('renders a grouped tool overview', async () => {
        const io = captureStdIO();
        const code = await runList({
            command: 'list',
            rest: [],
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code, io.stderr || io.stdout).toBe(0);
        expect(io.stdout).toContain('SiYuan tools');
        expect(io.stdout).toContain('notebook —');
        expect(io.stdout).toContain('document —');
        expect(io.stdout).toContain('Next Step');
        expect(io.stdout).toContain('siyuan-sisyphus list <tool>');
        expect(io.stderr).toBe('');
        io.restore();
    });

    it('renders action tiers and confirmation markers for a specific tool', async () => {
        const io = captureStdIO();
        const code = await runList({
            command: 'list',
            tool: 'document',
            rest: [],
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code, io.stderr || io.stdout).toBe(0);
        expect(io.stdout).toContain('document actions');
        expect(io.stdout).toContain('create — common');
        expect(io.stdout).toContain('move — advanced · confirmation required');
        expect(io.stdout).toContain('siyuan-sisyphus help document <action>');
        io.restore();
    });

    it('warns but still shows all tools for an unknown filter', async () => {
        const io = captureStdIO();
        const code = await runList({
            command: 'list',
            tool: 'unknown-tool',
            rest: [],
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(io.stderr).toContain('Unknown tool "unknown-tool". Showing all tools instead.');
        expect(io.stdout).toContain('SiYuan tools');
        io.restore();
    });

    it('hides tools and actions disabled by the plugin UI config', async () => {
        const io = captureStdIO();
        const config = buildDefaultToolConfig();
        config.document.enabled = false;
        config.mascot.actions.buy = false;
        vi.spyOn(HttpSiYuanClient.prototype, 'readFile').mockResolvedValue(JSON.stringify(config));

        const overviewCode = await runList({
            command: 'list',
            rest: [],
            json: false,
            debug: false,
        } as ParsedArgs);
        const actionCode = await runList({
            command: 'list',
            tool: 'mascot',
            rest: [],
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(overviewCode).toBe(0);
        expect(actionCode).toBe(0);
        expect(io.stdout).not.toContain('document —');
        expect(io.stdout).toContain('mascot actions');
        expect(io.stdout).not.toContain('buy —');
        io.restore();
    });

    it('fails list for a specific tool disabled by the plugin UI config', async () => {
        const io = captureStdIO();
        const config = buildDefaultToolConfig();
        config.document.enabled = false;
        vi.spyOn(HttpSiYuanClient.prototype, 'readFile').mockResolvedValue(JSON.stringify(config));

        const code = await runList({
            command: 'list',
            tool: 'document',
            rest: [],
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(1);
        expect(io.stderr).toContain('Tool "document" is disabled.');
        io.restore();
    });

    it('uses a selected profile for help calls that reach SiYuan tooling', async () => {
        const io = captureStdIO();
        const dir = mkdtempSync(join(tmpdir(), 'sisyphus-cli-'));
        const configPath = join(dir, 'config.json');
        writeFileSync(configPath, JSON.stringify({
            currentProfile: 'default',
            profiles: {
                default: { apiUrl: 'http://default', token: 'default-token' },
                work: { apiUrl: 'http://work-help', token: 'help-token' },
            },
        }));

        const callToolSpy = vi.spyOn(TOOL_REGISTRY.notebook, 'callTool').mockImplementationOnce(async (client) => {
            expect(client.getBaseUrl()).toBe('http://work-help');
            expect(client.getAuthHeaders()).toEqual({ Connection: 'close', Authorization: 'Token help-token' });
            return { content: [{ type: 'text', text: '{"ok":true}' }] };
        });

        const code = await runHelp({
            command: 'help',
            tool: 'notebook',
            rest: [],
            configPath,
            profile: 'work',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code, io.stderr || io.stdout).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(1);
        rmSync(dir, { recursive: true, force: true });
        io.restore();
    });

    describe('one-step help (CLI only, shown only when enabled)', () => {
        const help = async (tool: string | undefined, action: string | undefined, oneStep: 'off' | 'low_risk') => {
            const config = buildDefaultToolConfig();
            config.writeSafety.oneStep = oneStep;
            vi.spyOn(HttpSiYuanClient.prototype, 'readFile').mockResolvedValue(JSON.stringify(config));
            const io = captureStdIO();
            try {
                const code = await runHelp({ command: 'help', tool, action, rest: [], json: false, debug: false } as ParsedArgs);
                return { code, stdout: io.stdout };
            } finally {
                io.restore();
            }
        };

        it('summarizes tiers for bare help, a tool, and an action', async () => {
            const bare = await help(undefined, undefined, 'low_risk');
            expect(bare.code).toBe(0);
            expect(bare.stdout).toContain('One-step writes (enabled)');
            expect(bare.stdout).toMatch(/One step \(no --validate-only needed\): .*document create/);
            expect(bare.stdout).toMatch(/only with --if-match from a fresh read: .*block update/);
            expect(bare.stdout).toContain('Reads that print If Match (it covers only the exact id/path read): block get-kramdown --id');
            expect(bare.stdout).toContain('not that it is the right block');

            const tool = await help('block', undefined, 'low_risk');
            expect(tool.stdout).toContain('One step (no --validate-only needed): insert, prepend, append, set-attrs');
            expect(tool.stdout).toContain('One step only with --if-match from a fresh read: update, replace');
            expect(tool.stdout).toMatch(/Always two steps: .*move/);
            expect(tool.stdout).toContain('document get-doc --id');

            const update = await help('block', 'update', 'low_risk');
            expect(update.stdout).toContain('If Match (from a read of this exact target id/path) is printed by: siyuan-sisyphus block get-kramdown --id');
            const remove = await help('document', 'rename', 'low_risk');
            expect(remove.stdout).toContain('One-step write');
            const tier3 = await help('block', 'move', 'low_risk');
            expect(tier3.stdout).toContain('always uses the two steps');
        });

        it('adds nothing while one-step is off', async () => {
            expect((await help(undefined, undefined, 'off')).code).toBe(2);
            expect((await help('block', undefined, 'off')).stdout).not.toContain('One-step');
            expect((await help('block', 'move', 'off')).stdout).not.toContain('One-step');
        });
    });

    it('does not show help for a tool disabled by the plugin UI config', async () => {
        const io = captureStdIO();
        const config = buildDefaultToolConfig();
        config.notebook.enabled = false;
        vi.spyOn(HttpSiYuanClient.prototype, 'readFile').mockResolvedValue(JSON.stringify(config));
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.notebook, 'callTool');

        const code = await runHelp({
            command: 'help',
            tool: 'notebook',
            rest: [],
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(1);
        expect(callToolSpy).not.toHaveBeenCalled();
        expect(io.stderr).toContain('[tool_disabled] Tool "notebook" is disabled.');
        io.restore();
    });

    it('does not show action help for an action disabled by the plugin UI config', async () => {
        const io = captureStdIO();
        const config = buildDefaultToolConfig();
        config.mascot.actions.buy = false;
        vi.spyOn(HttpSiYuanClient.prototype, 'readFile').mockResolvedValue(JSON.stringify(config));

        const code = await runHelp({
            command: 'help',
            tool: 'mascot',
            action: 'buy',
            rest: [],
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(1);
        expect(io.stderr).toContain('[unknown_help_topic]');
        expect(io.stderr).toContain('Unknown help topic "buy" for tool "mascot".');
        io.restore();
    });
});
