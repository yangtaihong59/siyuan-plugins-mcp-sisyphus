import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { ParsedArgs } from '@/cli/args';
import { SiYuanClient } from '@/api/client';
import { runHelp, runList } from '@/cli/list-help';
import * as pluginCheck from '@/cli/plugin-check';
import { buildDefaultToolConfig } from '@/core/config';
import { TOOL_REGISTRY } from '@/core/tool-registry';

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
        vi.spyOn(SiYuanClient.prototype, 'readFile').mockResolvedValue('');
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
        vi.spyOn(SiYuanClient.prototype, 'readFile').mockResolvedValue(JSON.stringify(config));

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
        vi.spyOn(SiYuanClient.prototype, 'readFile').mockResolvedValue(JSON.stringify(config));

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

    it('does not show help for a tool disabled by the plugin UI config', async () => {
        const io = captureStdIO();
        const config = buildDefaultToolConfig();
        config.notebook.enabled = false;
        vi.spyOn(SiYuanClient.prototype, 'readFile').mockResolvedValue(JSON.stringify(config));
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
        expect(io.stdout).toContain('Tool "notebook" is disabled.');
        io.restore();
    });

    it('does not show action help for an action disabled by the plugin UI config', async () => {
        const io = captureStdIO();
        const config = buildDefaultToolConfig();
        config.mascot.actions.buy = false;
        vi.spyOn(SiYuanClient.prototype, 'readFile').mockResolvedValue(JSON.stringify(config));

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
