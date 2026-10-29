import { describe, expect, it } from 'vitest';

import { slimToolResult } from '@/core/slim-response';

describe('slim document-window responses', () => {
    it('preserves explicit document query fields, statistics and scope', () => {
        const payload = { data: [{ id: 'doc', notebook: 'readable', title: 'Doc', blockCount: 0, contentChars: 0, sameTitleCount: 2 }],
            total: 1, scope: { notebooks: ['readable'], excludedClosedNotebooks: ['archive'] }, metrics: { contentChars: 'indexed characters' },
            readInfo: { scope: 'sql_query', limitations: ['sql_index_may_lag'] } };
        const result = { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
        expect(slimToolResult(result, { category: 'document', action: 'query' })).toEqual(result);
    });
    it('preserves flashcard identities, scheduling, answers and executable session continuation', () => {
        for (const action of ['get_cards', 'list_cards', 'review_card']) {
            const payload = { cards: [{ id: 'block', rootID: 'doc', cardID: 'card', blockID: 'block', reps: 2, lastReview: 123, front: 'question', back: 'answer' }],
                reviewSession: { nextListArgs: { action: 'list_cards', scope: 'deck', filter: 'due', deckID: 'deck', reviewedCards: [{ cardID: 'card' }] } } };
            const original = { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
            expect(slimToolResult(original, { category: 'flashcard', action })).toEqual(original);
        }
    });

    it.each(['resolve', 'reuse', 'create', 'dryRun'])('preserves link identities and dispositions for %s', (mode) => {
        const payload = {
            success: true, changed: mode === 'create', mode,
            scope: { notebook: 'nb-1', parentId: 'parent-1' },
            created: [], resolved: [{ key: 'a', id: 'doc-1', disposition: 'resolved' }],
            reused: [], unresolved: [{ key: 'b', reason: 'not_found' }],
            linkMap: { a: { id: 'doc-1', notebook: 'nb-1', path: '/parent/doc-1.sy', hPath: '/Parent/Child' } },
            createdCount: 0, resolvedCount: 1, reusedCount: 0, unresolvedCount: 1,
        };
        const original = { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
        expect(slimToolResult(original, { category: 'document', action: 'ensure_link_targets' })).toEqual(original);
    });

    it('preserves the Markdown content of an export snapshot page', () => {
        const payload = { kind: 'markdown_snapshot', documents: [{ id: 'doc', relativePath: 'Doc [doc].md', content: '# Body', contentHash: 'sha256:v1:x' }] };
        const result = { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
        expect(slimToolResult(result, { category: 'file', action: 'export_markdown_snapshot' })).toEqual(result);
    });

    it('preserves read_image metadata, structured content, and the image block verbatim', () => {
        const original = {
            content: [
                { type: 'text' as const, text: JSON.stringify({ documentID: 'doc-1', path: 'assets/image.png', bytes: 4 }) },
                { type: 'image' as const, data: 'iVBORw==', mimeType: 'image/png' },
            ],
            structuredContent: { documentID: 'doc-1', path: 'assets/image.png', bytes: 4 },
        };

        expect(slimToolResult(original, { category: 'file', action: 'read_image' })).toEqual(original);
    });

    it('preserves executable preflight commitArgs verbatim even when general slimming is enabled', () => {
        const preflight = {
            version: 2,
            requestId: 'request-1',
            expiresAt: 1,
            ttlMs: 600000,
            counts: { operationCount: 1, rowCount: 1, cellCount: 1, guardTargetCount: 1 },
            commitArgs: {
                action: 'set_cells',
                avID: 'av-1',
                cells: [{ rowID: 'row-1', columnID: 'key-1', valueType: 'text', text: 'x' }],
                validateOnly: false,
                requestId: 'request-1',
                expectedManifestHash: 'abcd',
            },
        };
        const result = slimToolResult({
            content: [{ type: 'text', text: JSON.stringify({
                action: 'set_cells',
                validateOnly: true,
                writeAttempted: false,
                writeExecuted: false,
                requestId: 'request-1',
                preflight,
            }) }],
        }, { category: 'av', action: 'set_cells' });

        expect(JSON.parse(result.content[0].text).preflight).toEqual(preflight);
    });

    it('keeps the write-impact preview verbatim under general slimming', () => {
        const preview = {
            detail: 'summary',
            targets: [{ id: '20260101000000-abcdefg', kind: 'document', title: 'Plans', hPath: '/Plans', notebook: { id: 'nb', name: 'Work', permission: 'rw' } }],
            changes: [{ kind: 'delete', summary: 'Removes document «Plans».', content: 'kept', markdown: 'kept', rootID: 'kept' }],
            risk: ['deletes'],
        };
        const result = slimToolResult({
            content: [{ type: 'text', text: JSON.stringify({ action: 'remove', validateOnly: true, requestId: 'r', preview }) }],
        }, { category: 'document', action: 'remove' });
        expect(JSON.parse(result.content[0].text).preview).toEqual(preview);
    });

    it('preserves partial batch rename receipts and counts byte-for-byte', () => {
        const payload = {
            success: false,
            changed: true,
            overallState: 'partial',
            partial: true,
            requestId: 'request-rename',
            items: [
                { index: 0, id: 'doc-1', title: 'Renamed', state: 'committed', previousHPath: '/A', targetHPath: '/Renamed' },
                { index: 1, id: 'doc-2', title: 'Blocked', state: 'unknown', reason: 'kernel_error: timeout', previousHPath: '/B', targetHPath: '/Blocked' },
                { index: 2, id: 'doc-3', title: 'Later', state: 'not_started', previousHPath: '/C', targetHPath: '/Later' },
            ],
            counts: { requested: 3, committed: 1, noChange: 0, failedBeforeExecute: 0, unknown: 1, notStarted: 1 },
            next: 'Inspect the unknown item before any retry.',
        };
        const original = {
            content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
            structuredContent: payload,
            isError: true,
        };

        expect(slimToolResult(original, { category: 'document', action: 'rename' })).toEqual(original);
    });

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

describe('slim write-success responses', () => {
    it('keeps the identities and executable follow-ups of flashcard and timeline writes', () => {
        const payload = {
            success: true,
            action: 'review_card',
            skip: true,
            deckID: 'deck-1',
            cardID: 'card-1',
            reviewSession: { nextListArgs: { action: 'list_cards', deckID: 'deck-1' } },
            node: { tag: 't', snapshotId: 's' },
        };
        const slim = slimToolResult(
            { content: [{ type: 'text', text: JSON.stringify(payload) }] },
            { category: 'flashcard', action: 'review_card' },
        );
        const parsed = JSON.parse(slim.content[0].text as string);
        expect(parsed).toMatchObject({ success: true, skip: true, deckID: 'deck-1', cardID: 'card-1', reviewSession: payload.reviewSession, node: payload.node });
    });
});
