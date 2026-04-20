import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParsedArgs } from '@/cli/args';
import { runDispatch } from '@/cli/dispatch';
import * as pluginCheck from '@/cli/plugin-check';
import { PermissionManager } from '@/mcp/permissions';
import { runToolCall } from '@/mcp/tool-lifecycle';
import { TOOL_REGISTRY } from '@/mcp/tool-registry';

vi.mock('@/mcp/tool-lifecycle', () => ({
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

    beforeEach(() => {
        Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
        Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: false });
        vi.spyOn(pluginCheck, 'ensureRequiredPluginInstalled').mockResolvedValue(undefined);
        vi.spyOn(PermissionManager.prototype, 'load').mockResolvedValue(undefined);
        delete process.env.SIYUAN_MCP_TRANSPORT;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY);
        if (stderrTTY) Object.defineProperty(process.stderr, 'isTTY', stderrTTY);
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
});
