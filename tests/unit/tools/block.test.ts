import { describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { BLOCK_VARIANTS, callBlockTool, listBlockTools } from '@/tools/block';
import { isMissingBlockError } from '@/tools/internal/errorTranslation';
import { createMockClient } from '../../helpers/mock-client';
import { parseResult } from '../../helpers/parse-result';

describe('block tool', () => {
    const permMgr = {
        reload: async () => undefined,
        canWrite: () => true,
        canRead: () => true,
        canDelete: () => true,
        get: () => 'rwd',
    };

    function createTestDom(kramdown: string) {
        const content = kramdown.replace(/\n?\{:[\s\S]*$/, '');
        return `<div data-node-id="block-1" data-type="NodeParagraph">${content.replace(/\n/g, '<br>')}</div>`;
    }

    function createBlockReplaceClient(kramdown = 'alpha\nbudget line\nbudget tail', dom = createTestDom(kramdown)) {
        return createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') {
                    return [{
                        id: body?.id ?? 'block-1',
                        root_id: 'doc-1',
                        box: 'nb-1',
                        path: '/doc-1.sy',
                        hpath: '/Doc 1',
                        content: 'Doc 1',
                        type: 'p',
                    }];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: body?.id, kramdown };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return { id: body?.id, dom };
                }
                if (endpoint === '/api/block/updateBlock') {
                    return { updated: true };
                }
                if (endpoint.startsWith('/api/ui/')) {
                    return null;
                }
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
    }

    it('treats missing block API errors as non-existent blocks', () => {
        expect(isMissingBlockError(new Error('SiYuan API error: -1 - 未找到 ID 为 [invalid-block-id-12345] 的内容块'))).toBe(true);
        expect(isMissingBlockError(new Error('some other error'))).toBe(false);
    });

    it('exposes merged batch and daily-note actions in the grouped schema', () => {
        const config = buildDefaultToolConfig();
        const [tool] = listBlockTools(config.block);
        const actionEnum = tool.inputSchema.properties.action.enum;
        expect(actionEnum).toContain('insert');
        expect(actionEnum).toContain('update');
        expect(actionEnum).toContain('replace');
        expect(actionEnum).toContain('batch_kramdown');
        expect(actionEnum).toContain('add_to_daily_note');
        expect(actionEnum).toContain('docs_info');
    });

    it('limits batch_kramdown to 20 IDs', () => {
        const variant = BLOCK_VARIANTS.find((item) => item.action === 'batch_kramdown');

        expect(variant?.schema.properties?.ids?.type).toBe('array');
        expect(variant?.schema.properties?.ids?.maxItems).toBe(20);
    });

    it('batch reads kramdown in input order with per-item permission and lookup errors', async () => {
        const ids = ['allowed-a', 'denied', 'missing', 'allowed-b', 'allowed-a'];
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') {
                    const stmt = String(body?.stmt ?? '');
                    const id = ids.find((candidate) => stmt.includes(`id = '${candidate}'`));
                    if (!id || id === 'missing') return [];
                    return [{
                        id,
                        root_id: `doc-${id}`,
                        box: id === 'denied' ? 'nb-denied' : 'nb-readable',
                        path: `/doc-${id}.sy`,
                        hpath: `/Doc ${id}`,
                        content: `Doc ${id}`,
                        type: 'p',
                    }];
                }
                if (endpoint === '/api/block/getDocInfo' && body?.id === 'missing') {
                    throw new Error('SiYuan API error: -1 - 未找到 ID 为 [missing] 的内容块');
                }
                if (endpoint === '/api/block/getBlockKramdowns') {
                    expect(body).toEqual({
                        ids: ['allowed-a', 'allowed-b'],
                        mode: 'md',
                    });
                    return {
                        'allowed-a': '\u200BAlpha',
                        'allowed-b': 'Beta',
                    };
                }
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const batchPermMgr = {
            reload: vi.fn(async () => undefined),
            canRead: vi.fn((notebook: string) => notebook !== 'nb-denied'),
            get: vi.fn((notebook: string) => notebook === 'nb-denied' ? 'none' : 'r'),
        };

        const result = await callBlockTool(client, {
            action: 'batch_kramdown',
            ids,
        }, buildDefaultToolConfig().block, batchPermMgr as never);

        expect(parseResult(result)).toEqual({
            items: [
                { id: 'allowed-a', ok: true, kramdown: 'Alpha' },
                {
                    id: 'denied',
                    ok: false,
                    error: {
                        type: 'permission_denied',
                        message: 'Notebook "nb-denied" has permission "none", read access is required.',
                        notebook: 'nb-denied',
                        currentPermission: 'none',
                        requiredPermission: 'read',
                    },
                },
                {
                    id: 'missing',
                    ok: false,
                    error: {
                        type: 'not_found',
                        message: 'Block not found: missing',
                    },
                },
                { id: 'allowed-b', ok: true, kramdown: 'Beta' },
                { id: 'allowed-a', ok: true, kramdown: 'Alpha' },
            ],
            requested: 5,
            succeeded: 3,
            failed: 2,
            partial: true,
        });
        expect(batchPermMgr.reload).toHaveBeenCalledTimes(1);
    });

    it('publishes JSON types for object and array parameters', () => {
        const config = buildDefaultToolConfig();
        const [tool] = listBlockTools(config.block);

        expect(tool.inputSchema.properties.attrs.type).toBe('object');
        expect(tool.inputSchema.properties.attrs.additionalProperties).toEqual({ type: 'string' });
        expect(tool.inputSchema.properties.ids.type).toBe('array');
        expect(tool.inputSchema.properties.ids.items).toEqual({ type: 'string' });
    });

    it('documents insert anchors inside each block item', () => {
        const config = buildDefaultToolConfig();
        const [tool] = listBlockTools(config.block);
        const insertSchema = (tool.inputSchema['x-sisyphus-actionSchemas'] as Array<{ properties?: Record<string, any> }>)
            .find((schema) => schema.properties?.action?.const === 'insert');
        const properties = insertSchema?.properties as Record<string, unknown>;
        const batchInsertBlocks = properties.blocks as Record<string, unknown>;

        expect(batchInsertBlocks.description).toContain('top-level');
    });

    it('calls append daily note block endpoint', async () => {
        const client = createMockClient({
            request: async (endpoint: string, body: unknown) => {
                expect(endpoint).toBe('/api/block/appendDailyNoteBlock');
                expect(body).toMatchObject({ notebook: 'nb', dataType: 'markdown', data: 'hello' });
                return [{ doOperations: [] }];
            },
        });

        const result = await callBlockTool(client, {
            action: 'add_to_daily_note',
            notebook: 'nb',
            dataType: 'markdown',
            data: 'hello',
            position: 'append',
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(parseResult(result).success).toBe(true);
    });

    it('converts plain DOM block references and tags before block update', async () => {
        const client = createBlockReplaceClient();

        const result = await callBlockTool(client, {
            action: 'update',
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">See ((20260508123456-abcdefg \'完整标题\')) and #测试标签#</div>',
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(parseResult(result)).toMatchObject({ success: true, id: 'block-1', dataType: 'dom' });
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">See <span data-type="block-ref" data-subtype="s" data-id="20260508123456-abcdefg">完整标题</span> and <span data-type="tag">测试标签</span></div>',
        });
    });

    it('expands naked block references before markdown block update', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') {
                    return [{
                        id: body?.id ?? 'block-1',
                        root_id: 'doc-1',
                        box: 'nb-1',
                        path: '/doc-1.sy',
                        hpath: '/Doc 1',
                        content: 'Doc 1',
                        type: 'p',
                    }];
                }
                if (endpoint === '/api/block/getBlockKramdown' && body?.id === '20260508123456-abcdefg') {
                    return { id: body.id, kramdown: '完整标题\n{: id="20260508123456-abcdefg"}' };
                }
                if (endpoint === '/api/block/updateBlock') return { updated: true };
                if (endpoint.startsWith('/api/ui/')) return null;
                return null;
            }),
        });

        const result = await callBlockTool(client, {
            action: 'update',
            id: 'block-1',
            dataType: 'markdown',
            data: 'See ((20260508123456-abcdefg))',
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(result.isError).toBeUndefined();
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: "See ((20260508123456-abcdefg '完整标题'))",
        });
    });

    it('falls back to the id as anchor when a naked block reference cannot be resolved during append', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') {
                    return [{
                        id: body?.id ?? 'block-1',
                        root_id: 'doc-1',
                        box: 'nb-1',
                        path: '/doc-1.sy',
                        hpath: '/Doc 1',
                        content: 'Doc 1',
                        type: 'p',
                    }];
                }
                if (endpoint === '/api/block/getBlockKramdown' && body?.id === '20250321001215-j3k2u2v') {
                    throw new Error('missing block');
                }
                if (endpoint === '/api/block/getBlockInfo' && body?.id === '20250321001215-j3k2u2v') {
                    throw new Error('missing block');
                }
                if (endpoint === '/api/block/appendBlock') return [{ doOperations: [{ id: 'new-block', parentID: 'block-1' }] }];
                if (endpoint.startsWith('/api/ui/')) return null;
                return null;
            }),
        });

        const result = await callBlockTool(client, {
            action: 'append',
            parentID: 'block-1',
            dataType: 'markdown',
            data: 'See ((20250321001215-j3k2u2v))',
        }, buildDefaultToolConfig().block, permMgr as never);
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed.warning).toBe('Some naked block references used the block ID as fallback anchor text.');
        expect(parsed.hint).toContain('fallback anchor text');
        expect(client.request).toHaveBeenCalledWith('/api/block/appendBlock', {
            dataType: 'markdown',
            data: "See ((20250321001215-j3k2u2v '20250321001215-j3k2u2v'))",
            parentID: 'block-1',
        });
    });

    it('allows siyuan block links during markdown block update with a hint', async () => {
        const client = createBlockReplaceClient();

        const result = await callBlockTool(client, {
            action: 'update',
            id: 'block-1',
            dataType: 'markdown',
            data: '[目标](siyuan://blocks/20260508123456-abcdefg)',
        }, buildDefaultToolConfig().block, permMgr as never);
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed).toMatchObject({
            success: true,
            warning: 'siyuan://blocks Markdown links create mentions, not backlinks.',
        });
        expect(parsed.hint).toContain('mentions, not backlinks');
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: '[目标](siyuan://blocks/20260508123456-abcdefg)',
        });
    });

    it('allows updating an attribute-view block but returns av tool guidance', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') {
                    return [{
                        id: body?.id ?? 'av-block-1',
                        root_id: 'doc-1',
                        box: 'nb-1',
                        path: '/doc-1.sy',
                        hpath: '/Doc 1',
                        content: 'Doc 1',
                        type: 'av',
                    }];
                }
                if (endpoint === '/api/block/updateBlock') return { updated: true };
                if (endpoint.startsWith('/api/ui/')) return null;
                return null;
            }),
        });

        const result = await callBlockTool(client, {
            action: 'update',
            id: 'av-block-1',
            dataType: 'markdown',
            data: '降级为普通文本',
        }, buildDefaultToolConfig().block, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({
            success: true,
            id: 'av-block-1',
            databaseBlock: true,
        });
        expect(parsed.warning).toContain('use av');
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'av-block-1',
            dataType: 'markdown',
            data: '降级为普通文本',
        });
    });

    it('allows deleting an attribute-view block but returns av tool guidance', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/query/sql') {
                    return [{
                        id: 'av-block-1',
                        root_id: 'doc-1',
                        box: 'nb-1',
                        path: '/doc-1.sy',
                        hpath: '/Doc 1',
                        content: 'Doc 1',
                        type: 'av',
                    }];
                }
                if (endpoint === '/api/block/deleteBlock') return {};
                if (endpoint.startsWith('/api/ui/')) return null;
                return null;
            }),
        });

        const result = await callBlockTool(client, {
            action: 'delete',
            id: 'av-block-1',
        }, {
            ...buildDefaultToolConfig().block,
            actions: {
                ...buildDefaultToolConfig().block.actions,
                delete: true,
            },
        }, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({
            success: true,
            id: 'av-block-1',
            databaseBlock: true,
        });
        expect(parsed.warning).toContain('use av');
        expect(client.request).toHaveBeenCalledWith('/api/block/deleteBlock', { id: 'av-block-1' });
    });

    it.each([
        '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |',
        '```ts\nconst a = 1;\nconst b = 2;\n```',
    ])('does not warn that a single multiline block is truncated', async (data) => {
        const client = createBlockReplaceClient();
        const result = await callBlockTool(client, { action: 'update', id: 'block-1', dataType: 'markdown', data }, buildDefaultToolConfig().block, permMgr as never);
        expect(result.isError).toBeUndefined();
        expect(parseResult(result).warning).toBeUndefined();
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', { id: 'block-1', dataType: 'markdown', data });
    });

    it('replaces the first exact match inside one block', async () => {
        const client = createBlockReplaceClient();

        const result = await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: 'budget', new: 'forecast' },
        }, buildDefaultToolConfig().block, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({
            success: true,
            action: 'replace',
            id: 'block-1',
            changed: true,
            editsApplied: 1,
            replacements: [{ index: 1, replaced: 1, replace_all: false }],
        });
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">alpha<br>forecast line<br>budget tail</div>',
        });
    });

    it('supports sequential block replacements with replace_all', async () => {
        const client = createBlockReplaceClient('foo\nbaz\nbaz');

        const result = await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: [
                { old: 'foo', new: 'bar' },
                { old: 'baz', new: 'qux', replace_all: true },
            ],
        }, buildDefaultToolConfig().block, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.replacements).toEqual([
            { index: 1, replaced: 1, replace_all: false },
            { index: 2, replaced: 2, replace_all: true },
        ]);
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">bar<br>qux<br>qux</div>',
        });
    });

    it('fails block replace when an edit does not match any text', async () => {
        const client = createBlockReplaceClient();

        const result = await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: 'missing', new: 'new text' },
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('block.replace edit #1 did not match any text');
        expect(result.content[0].text).toContain('only searches the content body of the single block');
        expect(client.request).not.toHaveBeenCalledWith('/api/block/updateBlock', expect.anything());
    });

    it('writes block references and tags through DOM spans during block replace', async () => {
        const client = createBlockReplaceClient(
            "引用 ((20260609192804-xrabk3d '目标标题')) old #tag#\n{: id=\"block-1\"}",
            '<div data-node-id="block-1" data-type="NodeParagraph">引用 <span data-type="block-ref" data-subtype="s" data-id="20260609192804-xrabk3d">目标标题</span> old <span data-type="tag">#tag#</span></div>',
        );

        await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: 'old', new: 'new' },
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">引用 <span data-type="block-ref" data-subtype="s" data-id="20260609192804-xrabk3d">目标标题</span> new <span data-type="tag">#tag#</span></div>',
        });
    });

    it('replaces a full paragraph containing a block reference', async () => {
        const client = createBlockReplaceClient(
            '引用 ((20260609201939-1qvlh19 "测试笔记本")) 完成\n{: id="block-1"}',
            '<div data-node-id="block-1" data-type="NodeParagraph">引用 <span data-type="block-ref" data-subtype="s" data-id="20260609201939-1qvlh19"><span>测试笔记本</span></span> 完成</div>',
        );

        await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: {
                old: '引用 ((20260609201939-1qvlh19 "测试笔记本")) 完成',
                new: '替换后的普通文本',
            },
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: '替换后的普通文本',
        });
    });

    it('replaces a full paragraph containing a tag', async () => {
        const client = createBlockReplaceClient(
            '这是一段 #测试标签# 内容\n{: id="block-1"}',
            '<div data-node-id="block-1" data-type="NodeParagraph">这是一段 <span data-type="tag">测试标签</span> 内容</div>',
        );

        await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: '这是一段 #测试标签# 内容', new: '替换后的普通文本' },
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: '替换后的普通文本',
        });
    });

    it('replaces protected inline spans when SiYuan DOM data-type has multiple tokens', async () => {
        const client = createBlockReplaceClient(
            '引用 ((20260609201939-1qvlh19 "测试笔记本")) 和 #测试标签#\n{: id="block-1"}',
            '<div data-node-id="block-1" data-type="NodeParagraph">引用 <span data-type="block-ref a" data-subtype="s" data-id="20260609201939-1qvlh19"><span>测试笔记本</span></span> 和 <span data-type="tag strong">测试标签</span></div>',
        );

        await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: {
                old: '引用 ((20260609201939-1qvlh19 "测试笔记本")) 和 #测试标签#',
                new: '替换后的普通文本',
            },
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: '替换后的普通文本',
        });
    });

    it('replaces a whole tag token with plain text', async () => {
        const client = createBlockReplaceClient(
            '这是一段 #测试标签# 内容\n{: id="block-1"}',
            '<div data-node-id="block-1" data-type="NodeParagraph">这是一段 <span data-type="tag">测试标签</span> 内容</div>',
        );

        await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: '#测试标签#', new: '普通文本' },
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: '这是一段 普通文本 内容',
        });
    });

    it('replaces tags when SiYuan DOM inserts zero-width characters around tag text', async () => {
        const client = createBlockReplaceClient(
            '这是一段 #测试标签# 内容\n{: id="block-1"}',
            '<div data-node-id="block-1" data-type="NodeParagraph">这是一段 <span data-type="tag">#\u200B测试标签#\u200B</span> 内容\u200B</div>',
        );

        await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: '#测试标签#', new: '普通文本' },
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: '这是一段 普通文本 内容',
        });
    });

    it('preserves existing inline formatting during block replace', async () => {
        const client = createBlockReplaceClient(
            'alpha **old** tail\n{: id="block-1"}',
            '<div data-node-id="block-1" data-type="NodeParagraph">alpha <strong>old</strong> tail</div>',
        );

        await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: 'old', new: 'new' },
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">alpha <strong>new</strong> tail</div>',
        });
    });

    it('allows footnote-style references during block replace with a hint', async () => {
        const client = createBlockReplaceClient('old [^1]\n{: id="block-1"}');

        const result = await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: 'old', new: 'new' },
        }, buildDefaultToolConfig().block, permMgr as never);
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed.warning).toBe('Footnote-style references create footnotes or note markers, not backlinks.');
        expect(parsed.hint).toContain('not SiYuan backlinks');
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">new [^1]</div>',
        });
    });

    it('denies block replacements when notebook permission is read-only', async () => {
        const client = createBlockReplaceClient();
        const readonlyPermMgr = {
            ...permMgr,
            canWrite: () => false,
            get: () => 'r',
        };

        const result = await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: 'budget', new: 'forecast' },
        }, buildDefaultToolConfig().block, readonlyPermMgr as never);
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            type: 'permission_denied',
            current_permission: 'r',
            required_permission: 'write',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/block/getBlockKramdown', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/block/updateBlock', expect.anything());
    });

    it('skips block update and refresh when replacement output is unchanged', async () => {
        const client = createBlockReplaceClient('same text');

        const result = await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: 'same', new: 'same' },
        }, buildDefaultToolConfig().block, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, changed: false, editsApplied: 1 });
        expect(client.request).not.toHaveBeenCalledWith('/api/block/updateBlock', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/ui/reloadProtyle', expect.anything());
    });

    it('reloads the owning document after block replace changes content', async () => {
        const client = createBlockReplaceClient();

        const result = await callBlockTool(client, {
            action: 'replace',
            id: 'block-1',
            edit: { old: 'budget', new: 'forecast' },
        }, buildDefaultToolConfig().block, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.uiRefresh.operations).toEqual([{ type: 'reloadProtyle', id: 'doc-1' }]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
    });

    it('rejects batched insert when any block is missing parentID, previousID, and nextID', async () => {
        const client = createMockClient();

        const result = await callBlockTool(client, {
            action: 'insert',
            blocks: [
                { dataType: 'markdown', data: 'valid', parentID: 'doc-1' },
                { dataType: 'markdown', data: 'invalid' },
            ],
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(parseResult(result)).toEqual({
            error: {
                type: 'validation_error',
                message: 'Invalid arguments for block(action="insert").',
                tool: 'block',
                action: 'insert',
                hint: 'nextID inserts BEFORE that block; previousID inserts AFTER that block. Provide at least one of nextID, previousID, or parentID. Returns a slim success object with the created block ID. Use #tag# syntax in markdown when you want SiYuan to register a real tag.',
                fields: [{
                    path: 'blocks[1].previousID',
                    message: 'Provide nextID, previousID, or parentID for each block, or set a top-level parentID/previousID/nextID.',
                }],
            },
        });
        expect(client.request).not.toHaveBeenCalled();
    });

    it('inherits a top-level parentID for every batched insert item', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body: unknown) => {
                if (endpoint === '/api/query/sql') {
                    return [{
                        id: 'doc-1',
                        root_id: 'doc-1',
                        box: 'nb-1',
                        path: '/doc-1.sy',
                        hpath: '/Doc 1',
                        content: 'Doc 1',
                        type: 'd',
                    }];
                }
                if (endpoint === '/api/block/batchInsertBlock') {
                    expect(body).toEqual({
                        blocks: [
                            { dataType: 'markdown', data: 'Block A', parentID: 'doc-1' },
                            { dataType: 'markdown', data: 'Block B', parentID: 'doc-1' },
                        ],
                    });
                    return [{
                        doOperations: [
                            { action: 'insert', id: 'block-a', parentID: 'doc-1' },
                            { action: 'insert', id: 'block-b', parentID: 'doc-1' },
                        ],
                        undoOperations: [],
                    }];
                }
                if (endpoint === '/api/ui/reloadProtyle') {
                    expect(body).toEqual({ id: 'doc-1' });
                    return null;
                }
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });

        const result = await callBlockTool(client, {
            action: 'insert',
            parentID: 'doc-1',
            blocks: [
                { dataType: 'markdown', data: 'Block A' },
                { dataType: 'markdown', data: 'Block B' },
            ],
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(parseResult(result)).toEqual({
            success: true,
            action: 'insert',
            count: 2,
            createdBlockIDs: ['block-a', 'block-b'],
            transactions: [{
                doOperations: [
                    { action: 'insert', id: 'block-a', parentID: 'doc-1' },
                    { action: 'insert', id: 'block-b', parentID: 'doc-1' },
                ],
                undoOperations: [],
            }],
            uiRefresh: {
                applied: true,
                operations: [{ type: 'reloadProtyle', id: 'doc-1' }],
            },
        });
    });

    it('fails batched insert when SiYuan returns a no-op transaction payload', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/query/sql') {
                    return [{
                        id: 'doc-1',
                        root_id: 'doc-1',
                        box: 'nb-1',
                        path: '/doc-1.sy',
                        hpath: '/Doc 1',
                        content: 'Doc 1',
                        type: 'd',
                    }];
                }
                if (endpoint === '/api/block/batchInsertBlock') {
                    return [{
                        doOperations: [
                            { action: 'insert', id: '', parentID: '', rootID: '' },
                        ],
                        undoOperations: [],
                    }];
                }
                if (endpoint === '/api/ui/reloadProtyle') {
                    throw new Error('reloadProtyle should not be called for a failed insert');
                }
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });

        const result = await callBlockTool(client, {
            action: 'insert',
            blocks: [
                { dataType: 'markdown', data: 'Block A', parentID: 'doc-1' },
            ],
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(parseResult(result)).toEqual({
            error: {
                type: 'api_error',
                tool: 'block',
                action: 'insert',
                reason: 'empty_transaction_result',
                message: 'SiYuan accepted insert for 1 block(s), but returned no created block IDs.',
                hint: 'Check that each item includes nextID, previousID, or parentID, or provide one batch-level parentID/previousID/nextID, then retry. MCP now rejects no-op insert responses instead of reporting success.',
                transactions: [{
                    doOperations: [
                        { action: 'insert', id: '', parentID: '', rootID: '' },
                    ],
                    undoOperations: [],
                }],
            },
        });
    });

    it('accepts batch ids in final order and calls SiYuan from last to first internally', async () => {
        const moveCalls: Array<Record<string, unknown>> = [];
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') {
                    return [{
                        id: body?.id ?? 'block-1',
                        root_id: 'doc-1',
                        box: 'nb-1',
                        path: '/doc-1.sy',
                        hpath: '/Doc 1',
                        content: 'Doc 1',
                        type: 'p',
                    }];
                }
                if (endpoint === '/api/block/moveBlock') {
                    moveCalls.push(body ?? {});
                    return { moved: true };
                }
                if (endpoint === '/api/ui/reloadProtyle') return null;
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });

        const result = await callBlockTool(client, {
            action: 'move',
            ids: ['block-a', 'block-b', 'block-c'],
            parentID: 'doc-1',
        }, buildDefaultToolConfig().block, permMgr as never);

        expect(parseResult(result)).toMatchObject({
            success: true,
            ids: ['block-a', 'block-b', 'block-c'],
            finalOrder: ['block-a', 'block-b', 'block-c'],
            apiCallOrder: ['block-c', 'block-b', 'block-a'],
            count: 3,
            parentID: 'doc-1',
        });
        expect(moveCalls.map((call) => call.id)).toEqual(['block-c', 'block-b', 'block-a']);
    });
});
