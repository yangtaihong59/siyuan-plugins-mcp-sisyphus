import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '@/tools/internal/shared';
import { extractPaginationInfo, renderCliError, renderToolResult } from '@/cli/render';

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

describe('cli/render', () => {
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');

    beforeEach(() => {
        Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
        Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: false });
    });

    afterEach(() => {
        if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY);
        if (stderrTTY) Object.defineProperty(process.stderr, 'isTTY', stderrTTY);
    });

    it('keeps --json output compact for script usage', () => {
        const io = captureStdIO();
        const result: ToolResult = {
            content: [{ type: 'text', text: '{\n  "ok": true,\n  "count": 2\n}' }],
        };

        const code = renderToolResult(result, { json: true, debug: false });

        expect(code).toBe(0);
        expect(io.stdout).toBe('{"ok":true,"count":2}\n');
        expect(io.stderr).toBe('');
        io.restore();
    });

    it('shows image metadata by default without printing Base64', () => {
        const io = captureStdIO();
        const result: ToolResult = {
            content: [
                { type: 'text', text: JSON.stringify({ documentID: 'doc-1', path: 'assets/image.png', mimeType: 'image/png', bytes: 7 }) },
                { type: 'image', data: 'BASE64_SENTINEL', mimeType: 'image/png' },
            ],
        };

        expect(renderToolResult(result, { json: false, debug: false })).toBe(0);
        expect(io.stdout).toContain('assets/image.png');
        expect(io.stdout).toContain('image/png');
        expect(io.stdout).not.toContain('BASE64_SENTINEL');
        io.restore();
    });

    it('includes non-text image content for explicit --json output', () => {
        const io = captureStdIO();
        const result: ToolResult = {
            content: [
                { type: 'text', text: JSON.stringify({ documentID: 'doc-1', path: 'assets/image.png' }) },
                { type: 'image', data: 'BASE64_SENTINEL', mimeType: 'image/png' },
            ],
        };

        expect(renderToolResult(result, { json: true, debug: false })).toBe(0);
        expect(JSON.parse(io.stdout)).toEqual({
            documentID: 'doc-1',
            path: 'assets/image.png',
            content: [{ type: 'image', data: 'BASE64_SENTINEL', mimeType: 'image/png' }],
        });
        io.restore();
    });

    it('renders paginated data as summary plus list', () => {
        const io = captureStdIO();
        const result: ToolResult = {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    data: [
                        { id: 'doc-1', title: 'Daily Note', path: '/Daily Note' },
                        { id: 'doc-2', title: 'Weekly Note', path: '/Weekly Note' },
                    ],
                    total: 5,
                    page: 1,
                    pageCount: 3,
                    pageSize: 2,
                    hasNextPage: true,
                }),
            }],
        };

        const code = renderToolResult(result, { json: false, debug: false });

        expect(code).toBe(0);
        expect(io.stdout).toContain('✓ 2 of 5 items · page 1/3');
        expect(io.stdout).toContain('Page Size');
        expect(io.stdout).toContain('Has Next Page');
        expect(io.stdout).toContain(': 2');
        expect(io.stdout).toContain(': true');
        expect(io.stdout).toContain('Items');
        expect(io.stdout).toContain('ID: doc-1 · Title: Daily Note · Path: /Daily Note');
        expect(io.stdout).toContain('Next Step');
        expect(io.stdout).toContain('Enter/n for next page');
        io.restore();
    });

    it('shows the full MCP page for paginated output', () => {
        const io = captureStdIO();
        const data = Array.from({ length: 12 }, (_, index) => ({
            id: `doc-${index + 1}`,
            title: `Doc ${index + 1}`,
            path: `/Doc ${index + 1}`,
        }));
        const result: ToolResult = {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    data,
                    total: 24,
                    page: 1,
                    pageCount: 2,
                    pageSize: 12,
                    hasNextPage: true,
                }),
            }],
        };

        const code = renderToolResult(result, { json: false, debug: false });

        expect(code).toBe(0);
        expect(io.stdout).toContain('ID: doc-12 · Title: Doc 12 · Path: /Doc 12');
        expect(io.stdout).not.toContain('more item(s) not shown');
        io.restore();
    });

    it('extracts pagination metadata from tool results', () => {
        const result: ToolResult = {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    data: [{ id: 'doc-1' }],
                    total: 3,
                    page: 2,
                    pageCount: 3,
                    pageSize: 1,
                    hasNextPage: true,
                }),
            }],
        };

        expect(extractPaginationInfo(result)).toEqual({
            page: 2,
            pageCount: 3,
            hasNextPage: true,
        });
    });

    it('formats structured help payloads for terminal reading', () => {
        const io = captureStdIO();
        const result: ToolResult = {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    tool: 'document',
                    action: 'create',
                    hint: 'Use notebook + path + markdown, then verify with document(action="resolve", id="...", include=["path"]).',
                    shapes: ['notebook + path + markdown'],
                    requiredFields: ['notebook', 'path', 'markdown'],
                    example: { action: 'create', notebook: 'nb', path: '/Inbox/Test', markdown: 'Hello' },
                    guidance: ['Parent paths must already exist. Use document(action="resolve", notebook="nb", hpath="/Inbox/Test", include=["ids"]) to resolve IDs.'],
                    requiresConfirmation: false,
                    fullDocResource: 'siyuan://help/action/document/create',
                }),
            }],
        };

        renderToolResult(result, { json: false, debug: false });

        expect(io.stdout).toContain('document create');
        expect(io.stdout).toContain('Use --notebook + --path + --markdown');
        expect(io.stdout).toContain('siyuan-sisyphus document resolve --id ... --include "[\\"path\\"]"');
        expect(io.stdout).toContain('Accepted Shapes');
        expect(io.stdout).toContain('--notebook + --path + --markdown');
        expect(io.stdout).toContain('Required Fields');
        expect(io.stdout).toContain('--notebook, --path, --markdown');
        expect(io.stdout).toContain('siyuan-sisyphus document create --notebook nb --path /Inbox/Test --markdown Hello');
        expect(io.stdout).toContain('siyuan-sisyphus document resolve --notebook nb --hpath /Inbox/Test --include "[\\"ids\\"]"');
        expect(io.stdout).toContain('Resource: siyuan-sisyphus help document create');
        io.restore();
    });

    it('formats curated help examples for terminal reading', () => {
        const io = captureStdIO();
        const result: ToolResult = {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    tool: 'document',
                    action: 'create',
                    shapes: ['notebook'],
                    requiredFields: ['notebook'],
                    example: { action: 'create', notebook: 'nb' },
                    examples: [
                        {
                            title: 'Create a child document by notebook-local hpath (recommended)',
                            description: 'The path is inside the notebook. Do not include the notebook name, and do not pass a .sy storage path here.',
                            mcp: {
                                action: 'create',
                                notebook: 'nb',
                                path: '/Folder/Parent/New Child',
                                markdown: 'Body',
                            },
                        },
                        {
                            title: 'Create with a storage parent path returned by lookup',
                            description: 'Only parentPath accepts this .sy storage path form; path does not.',
                            mcp: {
                                action: 'create',
                                notebook: 'nb',
                                parentPath: '/20240318112233-abc123.sy',
                                title: 'New Child',
                            },
                        },
                    ],
                    guidance: [],
                    requiresConfirmation: false,
                }),
            }],
        };

        renderToolResult(result, { json: false, debug: false });

        expect(io.stdout).toContain('Examples');
        expect(io.stdout).toContain('Create a child document by notebook-local hpath (recommended)');
        expect(io.stdout).toContain('Do not include the notebook name');
        expect(io.stdout).toContain('siyuan-sisyphus document create --notebook nb --path "/Folder/Parent/New Child" --markdown Body');
        expect(io.stdout).toContain('Create with a storage parent path returned by lookup');
        expect(io.stdout).toContain('siyuan-sisyphus document create --notebook nb --parent-path /20240318112233-abc123.sy --title "New Child"');
        expect(io.stdout).not.toContain('siyuan-sisyphus document create --notebook nb\n');
        io.restore();
    });

    it('renders validation errors with fields and hints', () => {
        const io = captureStdIO();
        const result: ToolResult = {
            isError: true,
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: {
                        type: 'validation',
                        message: 'Invalid arguments.',
                        fields: [
                            { path: 'query', message: 'query is required.' },
                            { path: 'pageSize', message: 'must be positive.' },
                        ],
                        hint: 'Verify the block ID with block(action="info", id="...") or locate it via search(action="fulltext", query="...").',
                        details: 'Expected query/pageSize to be valid.',
                    },
                }),
            }],
        };

        const code = renderToolResult(result, { json: false, debug: false });

        expect(code).toBe(1);
        expect(io.stderr).toContain('✗ [validation] Invalid arguments.');
        expect(io.stderr).toContain('Fields');
        expect(io.stderr).toContain('query — query is required.');
        expect(io.stderr).toContain('pageSize — must be positive.');
        expect(io.stderr).toContain('Hint');
        expect(io.stderr).toContain('siyuan-sisyphus block info --id ...');
        expect(io.stderr).toContain('siyuan-sisyphus search fulltext --query ...');
        expect(io.stderr).toContain('Details');
        expect(io.stderr).toContain('query/pageSize');
        io.restore();
    });

    it('emits translated JSON for CLI help payloads', () => {
        const io = captureStdIO();
        const result: ToolResult = {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    tool: 'block',
                    commonActions: ['append'],
                    advancedActions: [],
                    guidance: ['block(action="append") with a document ID targets the document end.'],
                    actionSummaries: {
                        append: 'requires: dataType, data, parentID',
                    },
                    detailsHint: 'Call block(action="help", topic="<actionName>") for required fields.',
                }),
            }],
        };

        renderToolResult(result, { json: true, debug: false });

        expect(JSON.parse(io.stdout)).toMatchObject({
            guidance: ['siyuan-sisyphus block append with a document ID targets the document end.'],
            actionSummaries: {
                append: 'requires: --data-type, --data, --parent-id',
            },
            detailsHint: 'Call siyuan-sisyphus help block <action-name> for required fields.',
        });
        io.restore();
    });

    it('uses the shared CLI error renderer for plain failures', () => {
        const io = captureStdIO();

        renderCliError(new Error('Unknown action "oops".'));

        expect(io.stderr).toContain('✗ Unknown action "oops".');
        io.restore();
    });
});
