import { describe, expect, it } from 'vitest';

import { slimToolResult } from '@/core/slim-response';

describe('slim document-window responses', () => {
    it('preserves strict-write commit metadata on slim success responses', () => {
        const result = slimToolResult({
            content: [{ type: 'text', text: JSON.stringify({
                success: true,
                id: 'doc-1',
                safety: {
                    requestId: 'request-1',
                    writeSafetyMode: 'strict',
                    writeSafetyGuaranteed: true,
                    transactionState: 'committed',
                    resultHash: 'sha256:v1:result',
                },
            }) }],
        }, { category: 'document', action: 'create' });

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            id: 'doc-1',
            safety: {
                requestId: 'request-1',
                writeSafetyMode: 'strict',
                writeSafetyGuaranteed: true,
                transactionState: 'committed',
                resultHash: 'sha256:v1:result',
            },
        });
    });

    it('preserves AV row mappings required by the next safe cell write', () => {
        const rows = [{ blockID: 'block-1', rowID: 'row-1' }];
        const result = slimToolResult({
            content: [{ type: 'text', text: JSON.stringify({
                success: true,
                avID: 'av-1',
                rows,
            }) }],
        }, { category: 'av', action: 'add_rows' });

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            avID: 'av-1',
            rows,
        });
    });

    it('preserves uploaded asset paths required by subsequent asset actions', () => {
        const result = slimToolResult({
            content: [{ type: 'text', text: JSON.stringify({
                success: true,
                succMap: { 'source.txt': 'assets/source-20260812.txt' },
                errFiles: [],
                safety: { writeSafetyGuaranteed: true, transactionState: 'committed' },
            }) }],
        }, { category: 'file', action: 'upload_asset' });

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            succMap: { 'source.txt': 'assets/source-20260812.txt' },
            errFiles: [],
        });
    });

    it('preserves the kernel-resolved path returned by asset rename', () => {
        const result = slimToolResult({
            content: [{ type: 'text', text: JSON.stringify({
                success: true,
                oldPath: 'assets/source.txt',
                newName: 'renamed.txt',
                newPath: 'assets/renamed-20260812-id.txt',
            }) }],
        }, { category: 'file', action: 'rename_asset' });

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            newPath: 'assets/renamed-20260812-id.txt',
        });
    });

    it('preserves strict-write recovery metadata on slim error responses', () => {
        const result = slimToolResult({
            content: [{ type: 'text', text: JSON.stringify({
                writeSafetyMode: 'strict',
                writeAttempted: false,
                writeExecuted: false,
                transactionState: 'rejected',
                error: {
                    code: 'state_changed',
                    message: 'changed',
                    expectedHash: 'sha256:v1:old',
                    currentHash: 'sha256:v1:new',
                    revalidateRequired: true,
                    minimumRequiredLength: 5,
                },
            }) }],
            isError: true,
        }, { category: 'fs', action: 'write' });

        expect(JSON.parse(result.content[0].text)).toEqual({
            error: {
                code: 'state_changed',
                message: 'changed',
                expectedHash: 'sha256:v1:old',
                currentHash: 'sha256:v1:new',
                revalidateRequired: true,
                minimumRequiredLength: 5,
            },
            writeSafetyMode: 'strict',
            writeAttempted: false,
            writeExecuted: false,
            transactionState: 'rejected',
        });
    });

    it('keeps navigation, outline, token, and optional block-reference metadata', () => {
        const result = slimToolResult({
            content: [{
                type: 'text',
                text: JSON.stringify({
                    path: '/Notebook/Doc',
                    content: '## Heading',
                    outline: [{ blockIndex: 0, level: 2, title: 'Heading', id: 'heading' }],
                    blockStart: 0,
                    blockLimit: 1,
                    returnedBlocks: 1,
                    totalBlocks: 2,
                    tokenBudget: 2000,
                    estimatedTokens: 3,
                    tokenMode: 'approx_context_v1',
                    truncated: true,
                    hasNextWindow: true,
                    nextWindow: { action: 'read', path: '/Notebook/Doc', blockStart: 1 },
                    nextWindowHint: 'Continue.',
                    blockRefs: [{ blockIndex: 0, id: 'heading', type: 'h', subtype: 'h2' }],
                }),
            }],
        }, { category: 'fs', action: 'read' });

        expect(JSON.parse(result.content[0].text)).toEqual({
            path: '/Notebook/Doc',
            content: '## Heading',
            outline: [{ blockIndex: 0, level: 2, title: 'Heading', id: 'heading' }],
            blockStart: 0,
            blockLimit: 1,
            returnedBlocks: 1,
            totalBlocks: 2,
            tokenBudget: 2000,
            estimatedTokens: 3,
            tokenMode: 'approx_context_v1',
            truncated: true,
            hasNextWindow: true,
            nextWindow: { action: 'read', path: '/Notebook/Doc', blockStart: 1 },
            nextWindowHint: 'Continue.',
            blockRefs: [{ blockIndex: 0, id: 'heading', type: 'h', subtype: 'h2' }],
        });
    });

    it('does not rewrite forwarded official MCP tool results', () => {
        const original = {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    action: 'downstream_action',
                    content: 'plugin-owned content',
                    nested: { action: 'nested_action' },
                }),
            }],
        };

        expect(slimToolResult(original, {
            category: 'extension',
            action: 'plugin__example__tool',
        })).toEqual(original);
    });

    it('preserves every user-selected SQL column', () => {
        const original = {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    data: [{ box: 'notebook-1', content: 'raw content', count: 3 }],
                    total: 1,
                    totalRows: 1,
                    showing: 1,
                    truncated: false,
                }),
            }],
        };

        expect(slimToolResult(original, { category: 'search', action: 'query_sql' })).toEqual(original);
    });
});
