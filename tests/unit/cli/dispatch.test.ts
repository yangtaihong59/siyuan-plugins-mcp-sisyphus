import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { ParsedArgs } from '@/cli/args';
import { SiYuanClient } from '@/api/client';
import { runDispatch } from '@/cli/dispatch';
import * as pluginCheck from '@/cli/plugin-check';
import { buildDefaultToolConfig } from '@/core/config';
import { PermissionManager } from '@/core/permissions';
import { runToolCall } from '@/core/tool-lifecycle';
import { TOOL_REGISTRY } from '@/core/tool-registry';

vi.mock('@/core/tool-lifecycle', () => ({
    runToolCall: vi.fn(async (_ctx: unknown, handler: () => Promise<unknown>) => handler()),
}));

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

function okResult() {
    return { content: [{ type: 'text' as const, text: '{"ok":true}' }] };
}

describe('cli/dispatch', () => {
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
    const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stdinSetRawMode = process.stdin.setRawMode;

    beforeEach(() => {
        Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
        Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: false });
        Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
        process.stdin.setRawMode = vi.fn();
        vi.spyOn(pluginCheck, 'ensureRequiredPluginInstalled').mockResolvedValue(undefined);
        vi.spyOn(SiYuanClient.prototype, 'readFile').mockResolvedValue('');
        vi.spyOn(PermissionManager.prototype, 'load').mockResolvedValue(undefined);
        delete process.env.SIYUAN_MCP_TRANSPORT;
        delete process.env.SIYUAN_API_URL;
        delete process.env.SIYUAN_TOKEN;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.SIYUAN_API_URL;
        delete process.env.SIYUAN_TOKEN;
        if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY);
        if (stderrTTY) Object.defineProperty(process.stderr, 'isTTY', stderrTTY);
        if (stdinTTY) Object.defineProperty(process.stdin, 'isTTY', stdinTTY);
        process.stdin.setRawMode = stdinSetRawMode;
    });

    it('uses the requested profile to configure the SiYuan client', async () => {
        const io = captureStdIO();
        const dir = mkdtempSync(join(tmpdir(), 'sisyphus-cli-'));
        const configPath = join(dir, 'config.json');
        writeFileSync(configPath, JSON.stringify({
            currentProfile: 'default',
            profiles: {
                default: { apiUrl: 'http://default', token: 'default-token' },
                work: { apiUrl: 'http://work', token: 'work-token' },
            },
        }));

        vi.mocked(pluginCheck.ensureRequiredPluginInstalled).mockImplementationOnce(async (client) => {
            expect(client.getBaseUrl()).toBe('http://work');
            expect(client.getAuthHeaders()).toEqual({ Connection: 'close', Authorization: 'Token work-token' });
        });
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.notebook, 'callTool').mockResolvedValue(okResult());

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'notebook',
            action: 'list',
            rest: [],
            configPath,
            profile: 'work',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(1);
        rmSync(dir, { recursive: true, force: true });
        io.restore();
    });

    it('uses the current profile when no profile is specified', async () => {
        const io = captureStdIO();
        const dir = mkdtempSync(join(tmpdir(), 'sisyphus-cli-'));
        const configPath = join(dir, 'config.json');
        writeFileSync(configPath, JSON.stringify({
            currentProfile: 'work',
            profiles: {
                default: { apiUrl: 'http://default', token: 'default-token' },
                work: { apiUrl: 'http://work-current', token: 'current-token' },
            },
        }));

        vi.mocked(pluginCheck.ensureRequiredPluginInstalled).mockImplementationOnce(async (client) => {
            expect(client.getBaseUrl()).toBe('http://work-current');
            expect(client.getAuthHeaders()).toEqual({ Connection: 'close', Authorization: 'Token current-token' });
        });
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.notebook, 'callTool').mockResolvedValue(okResult());

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'notebook',
            action: 'list',
            rest: [],
            configPath,
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(1);
        rmSync(dir, { recursive: true, force: true });
        io.restore();
    });

    it('passes kebab-case snake_case fields through to MCP payloads', async () => {
        const io = captureStdIO();
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.mascot, 'callTool').mockResolvedValue(okResult());

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'mascot',
            action: 'buy',
            rest: ['--item-id', 'milk'],
            url: 'http://127.0.0.1:6806',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(1);
        expect(runToolCall).toHaveBeenCalledTimes(1);
        expect(callToolSpy.mock.calls[0]?.[1]).toEqual({
            action: 'buy',
            item_id: 'milk',
        });
        expect(io.stderr).toBe('');
        io.restore();
    });

    it('maps fs path positionals and list alias before dispatch', async () => {
        const io = captureStdIO();
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.fs, 'callTool').mockResolvedValue(okResult());

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'fs',
            action: 'list',
            rest: ['/'],
            url: 'http://127.0.0.1:6806',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(1);
        expect(callToolSpy.mock.calls[0]?.[1]).toEqual({
            action: 'ls',
            path: '/',
        });
        io.restore();
    });

    it('maps fs search and move positionals before dispatch', async () => {
        const io = captureStdIO();
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.fs, 'callTool').mockResolvedValue(okResult());

        const searchCode = await runDispatch({
            command: 'dispatch',
            tool: 'fs',
            action: 'search',
            rest: ['/', 'budget'],
            url: 'http://127.0.0.1:6806',
            json: true,
            debug: false,
        } as ParsedArgs);

        const moveCode = await runDispatch({
            command: 'dispatch',
            tool: 'fs',
            action: 'move',
            rest: ['/Notebook/Old', '/Notebook/New'],
            url: 'http://127.0.0.1:6806',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(searchCode).toBe(0);
        expect(moveCode).toBe(0);
        expect(callToolSpy.mock.calls[0]?.[1]).toEqual({
            action: 'search',
            path: '/',
            query: 'budget',
        });
        expect(callToolSpy.mock.calls[1]?.[1]).toEqual({
            action: 'mv',
            from: '/Notebook/Old',
            to: '/Notebook/New',
        });
        io.restore();
    });

    it('passes repeated array flags through to MCP payloads', async () => {
        const io = captureStdIO();
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.av, 'callTool').mockResolvedValue(okResult());

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'av',
            action: 'add_rows',
            rest: ['--av-id', 'av-1', '--block-ids', 'block-a', '--block-ids', 'block-b'],
            url: 'http://127.0.0.1:6806',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(1);
        expect(callToolSpy.mock.calls[0]?.[1]).toEqual({
            action: 'add_rows',
            avID: 'av-1',
            blockIDs: ['block-a', 'block-b'],
        });
        io.restore();
    });

    it('passes comma-separated array flags through to MCP payloads', async () => {
        const io = captureStdIO();
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.av, 'callTool').mockResolvedValue(okResult());

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'av',
            action: 'remove_rows',
            rest: ['--av-id', 'av-1', '--src-ids', 'row-a,row-b'],
            url: 'http://127.0.0.1:6806',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(1);
        expect(callToolSpy.mock.calls[0]?.[1]).toEqual({
            action: 'remove_rows',
            avID: 'av-1',
            srcIDs: ['row-a', 'row-b'],
        });
        io.restore();
    });

    it('fails fast when the required plugin is not installed', async () => {
        const io = captureStdIO();
        vi.mocked(pluginCheck.ensureRequiredPluginInstalled).mockRejectedValue(
            new Error('This CLI requires the SiYuan plugin "siyuan-plugins-mcp-sisyphus".'),
        );
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.mascot, 'callTool').mockResolvedValue(okResult());

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'mascot',
            action: 'buy',
            rest: ['--item-id', 'milk'],
            url: 'http://127.0.0.1:6806',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(1);
        expect(callToolSpy).not.toHaveBeenCalled();
        expect(io.stderr).toContain('requires the SiYuan plugin');
        io.restore();
    });

    it('refuses to dispatch a tool disabled by the plugin UI config', async () => {
        const io = captureStdIO();
        const config = buildDefaultToolConfig();
        config.mascot.enabled = false;
        vi.spyOn(SiYuanClient.prototype, 'readFile').mockResolvedValueOnce(JSON.stringify(config));
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.mascot, 'callTool');

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'mascot',
            action: 'buy',
            rest: ['--item-id', 'milk'],
            url: 'http://127.0.0.1:6806',
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(1);
        expect(callToolSpy).not.toHaveBeenCalled();
        expect(io.stdout).toContain('Tool "mascot" is disabled.');
        io.restore();
    });

    it('returns action_disabled for an action disabled by the plugin UI config', async () => {
        const io = captureStdIO();
        const config = buildDefaultToolConfig();
        config.mascot.actions.buy = false;
        vi.spyOn(SiYuanClient.prototype, 'readFile').mockResolvedValueOnce(JSON.stringify(config));

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'mascot',
            action: 'buy',
            rest: ['--item-id', 'milk'],
            url: 'http://127.0.0.1:6806',
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(1);
        expect(io.stderr).toContain('[action_disabled]');
        expect(io.stderr).toContain('Action "buy" is disabled for tool "mascot".');
        io.restore();
    });

    it('marks CLI dispatches with cli transport while running lifecycle hooks', async () => {
        const io = captureStdIO();
        const callToolSpy = vi.spyOn(TOOL_REGISTRY.notebook, 'callTool').mockResolvedValue(okResult());
        vi.mocked(runToolCall).mockImplementationOnce(async (ctx, handler) => {
            expect(process.env.SIYUAN_MCP_TRANSPORT).toBe('cli');
            expect(ctx).toMatchObject({
                name: 'notebook',
                action: 'list',
                args: { action: 'list' },
            });
            return handler() as Promise<Awaited<ReturnType<typeof handler>>>;
        });

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'notebook',
            action: 'list',
            rest: [],
            url: 'http://127.0.0.1:6806',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(1);
        expect(process.env.SIYUAN_MCP_TRANSPORT).toBeUndefined();
        io.restore();
    });

    it('supports interactive next-page paging in a TTY', async () => {
        const io = captureStdIO();
        Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
        Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });

        const callToolSpy = vi.spyOn(TOOL_REGISTRY.search, 'callTool')
            .mockResolvedValueOnce({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        data: [{ id: 'doc-1', title: 'Doc 1' }],
                        total: 2,
                        page: 1,
                        pageCount: 2,
                        pageSize: 1,
                        hasNextPage: true,
                    }),
                }],
            })
            .mockResolvedValueOnce({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        data: [{ id: 'doc-2', title: 'Doc 2' }],
                        total: 2,
                        page: 2,
                        pageCount: 2,
                        pageSize: 1,
                        hasNextPage: false,
                    }),
                }],
            });

        setTimeout(() => {
            process.stdin.emit('data', 'n');
            setTimeout(() => process.stdin.emit('data', 'q'), 0);
        }, 0);

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'search',
            action: 'fulltext',
            rest: ['--query', 'todo'],
            url: 'http://127.0.0.1:6806',
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(2);
        expect(callToolSpy.mock.calls[0]?.[1]).toMatchObject({ action: 'fulltext', query: 'todo' });
        expect(callToolSpy.mock.calls[1]?.[1]).toMatchObject({ action: 'fulltext', query: 'todo', page: 2 });
        expect(io.stdout).toContain('Paging: Enter/n next, p previous, q quit');
        io.restore();
    });

    it('supports interactive previous-page paging without going below page one', async () => {
        const io = captureStdIO();
        Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
        Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });

        const callToolSpy = vi.spyOn(TOOL_REGISTRY.search, 'callTool')
            .mockResolvedValueOnce({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        data: [{ id: 'doc-2', title: 'Doc 2' }],
                        total: 2,
                        page: 2,
                        pageCount: 2,
                        pageSize: 1,
                        hasNextPage: false,
                    }),
                }],
            })
            .mockResolvedValueOnce({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        data: [{ id: 'doc-1', title: 'Doc 1' }],
                        total: 2,
                        page: 1,
                        pageCount: 2,
                        pageSize: 1,
                        hasNextPage: true,
                    }),
                }],
            });

        setTimeout(() => {
            process.stdin.emit('data', 'p');
            setTimeout(() => process.stdin.emit('data', 'p'), 0);
            setTimeout(() => process.stdin.emit('data', 'q'), 10);
        }, 0);

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'search',
            action: 'fulltext',
            rest: ['--query', 'todo', '--page', '2'],
            url: 'http://127.0.0.1:6806',
            json: false,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(2);
        expect(callToolSpy.mock.calls[0]?.[1]).toMatchObject({ action: 'fulltext', query: 'todo', page: 2 });
        expect(callToolSpy.mock.calls[1]?.[1]).toMatchObject({ action: 'fulltext', query: 'todo', page: 1 });
        io.restore();
    });

    it('does not enter interactive paging for json output', async () => {
        const io = captureStdIO();
        Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
        Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });

        const callToolSpy = vi.spyOn(TOOL_REGISTRY.search, 'callTool').mockResolvedValue({
            content: [{
                type: 'text',
                text: JSON.stringify({
                    data: [{ id: 'doc-1', title: 'Doc 1' }],
                    total: 2,
                    page: 1,
                    pageCount: 2,
                    pageSize: 1,
                    hasNextPage: true,
                }),
            }],
        });

        const code = await runDispatch({
            command: 'dispatch',
            tool: 'search',
            action: 'fulltext',
            rest: ['--query', 'todo'],
            url: 'http://127.0.0.1:6806',
            json: true,
            debug: false,
        } as ParsedArgs);

        expect(code).toBe(0);
        expect(callToolSpy).toHaveBeenCalledTimes(1);
        expect(io.stdout).not.toContain('Paging: Enter/n next, p previous, q quit');
        io.restore();
    });
});
