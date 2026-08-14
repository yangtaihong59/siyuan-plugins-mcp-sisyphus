import { describe, expect, it, vi } from 'vitest';

import {
    createSyntheticDocumentBlockWindow,
    listDocumentBlocksInTreeOrder,
    readDocumentBlockWindow,
} from '@/tools/internal/document-kramdown';
import { createMockClient } from '../../helpers/mock-client';

function createWindowClient() {
    const markdown: Record<string, string> = {
        heading: '## Overview\n{: id="heading"}',
        paragraph: 'Paragraph text.\n{: id="paragraph"}',
        code: '```ts\nconst value = 42;\n```\n{: id="code"}',
        list: '- first\n- second\n{: id="list"}',
        table: '| A | B |\n| --- | --- |\n| 1 | 2 |\n{: id="table"}',
        details: '### Details\n{: id="details"}',
    };
    return createMockClient({
        request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
            if (endpoint === '/api/block/getChildBlocks') {
                if (body?.id === 'doc') return [
                    { id: 'heading', type: 'h', subtype: 'h2' },
                    { id: 'paragraph', type: 'p' },
                    { id: 'code', type: 'c', subtype: 'typescript' },
                    { id: 'list', type: 'l', subtype: 'u' },
                    { id: 'table', type: 't' },
                    { id: 'details', type: 'h', subtype: 'h3' },
                ];
                return [];
            }
            if (endpoint === '/api/block/getBlockKramdown') {
                return { id: body?.id, kramdown: markdown[String(body?.id)] ?? '' };
            }
            throw new Error(`Unexpected endpoint: ${endpoint}`);
        }),
    });
}

describe('document block windows', () => {
    it('uses tree-ordered complete blocks and returns a full outline with optional IDs', async () => {
        const client = createWindowClient();
        const blocks = await listDocumentBlocksInTreeOrder(client, 'doc');
        const window = await readDocumentBlockWindow(client, 'doc', {
            blockStart: 0,
            blockLimit: 2,
            includeBlockIds: true,
        }, blocks);

        expect(window.content).toBe('## Overview\n\nParagraph text.');
        expect(window).toMatchObject({
            blockStart: 0,
            blockLimit: 2,
            returnedBlocks: 2,
            totalBlocks: 6,
            tokenBudget: 2000,
            truncated: true,
            hasNextWindow: true,
            nextBlockStart: 2,
        });
        expect(window.outline).toEqual([
            { blockIndex: 0, level: 2, title: 'Overview', id: 'heading' },
            { blockIndex: 5, level: 3, title: 'Details', id: 'details' },
        ]);
        expect(window.blockRefs).toEqual([
            { blockIndex: 0, id: 'heading', type: 'h', subtype: 'h2' },
            { blockIndex: 1, id: 'paragraph', type: 'p' },
        ]);
        expect(window.content).not.toContain('{:');
        expect(window.content).not.toContain('id="');
    });

    it('returns an oversized code block whole instead of cutting it at the token budget', async () => {
        const window = await readDocumentBlockWindow(createWindowClient(), 'doc', {
            blockStart: 2,
            blockLimit: 4,
            tokenBudget: 1,
        });

        expect(window.content).toBe('```ts\nconst value = 42;\n```');
        expect(window.returnedBlocks).toBe(1);
        expect(window.nextBlockStart).toBe(3);
        expect(window.budgetExceeded).toBe(true);
        expect(window.estimatedTokens).toBeGreaterThan(window.tokenBudget);
    });

    it('keeps leading headings with the first body block even when the complete block exceeds the budget', async () => {
        const window = await readDocumentBlockWindow(createWindowClient(), 'doc', {
            blockStart: 0,
            blockLimit: 50,
            tokenBudget: 3,
        });

        expect(window.content).toBe('## Overview\n\nParagraph text.');
        expect(window.returnedBlocks).toBe(2);
        expect(window.nextBlockStart).toBe(2);
        expect(window.budgetExceeded).toBe(true);
    });

    it('keeps consecutive leading headings with the first body block', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    return body?.id === 'doc'
                        ? [{ id: 'h1', type: 'h', subtype: 'h1' }, { id: 'h2', type: 'h', subtype: 'h2' }, { id: 'body', type: 'p' }]
                        : [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { kramdown: { h1: '# One', h2: '## Two', body: 'Body text.' }[String(body?.id)] ?? '' };
                }
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const window = await readDocumentBlockWindow(client, 'doc', { tokenBudget: 1 });

        expect(window.content).toBe('# One\n\n## Two\n\nBody text.');
        expect(window.returnedBlocks).toBe(3);
        expect(window.budgetExceeded).toBe(true);
    });

    it('allows a small complete-block overrun instead of wasting the remaining budget', async () => {
        const window = await readDocumentBlockWindow(createWindowClient(), 'doc', {
            blockStart: 1,
            blockLimit: 50,
            tokenBudget: 3,
        });

        expect(window.content).toBe('Paragraph text.');
        expect(window.returnedBlocks).toBe(1);
        expect(window.budgetExceeded).toBe(true);
    });

    it('advances consecutive windows without overlap and returns an empty out-of-range window', async () => {
        const client = createWindowClient();
        const first = await readDocumentBlockWindow(client, 'doc', { blockStart: 3, blockLimit: 2 });
        const second = await readDocumentBlockWindow(client, 'doc', { blockStart: first.nextBlockStart, blockLimit: 2 });
        const pastEnd = await readDocumentBlockWindow(client, 'doc', { blockStart: 99, blockLimit: 2 });

        expect(first.content).toBe('- first\n- second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
        expect(first.nextBlockStart).toBe(5);
        expect(second.content).toBe('### Details');
        expect(second.hasNextWindow).toBe(false);
        expect(pastEnd).toMatchObject({
            content: '',
            blockStart: 99,
            returnedBlocks: 0,
            totalBlocks: 6,
            truncated: false,
            hasNextWindow: false,
        });
    });

    it('treats virtual Markdown as one indivisible synthetic block', () => {
        const window = createSyntheticDocumentBlockWindow('# Rules\n\n```md\n# not outline\n```\n\n## Work', {
            tokenBudget: 1,
            includeBlockIds: true,
        });

        expect(window.returnedBlocks).toBe(1);
        expect(window.totalBlocks).toBe(1);
        expect(window.budgetExceeded).toBe(true);
        expect(window.blockRefs).toBeUndefined();
        expect(window.outline).toEqual([
            { blockIndex: 0, level: 1, title: 'Rules' },
            { blockIndex: 0, level: 2, title: 'Work' },
        ]);
    });
});
