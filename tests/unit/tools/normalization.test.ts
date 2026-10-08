import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeToolArguments } from '@/core/argument-aliases';
import { callBlockTool } from '@/tools/block';
import { callDocumentTool } from '@/tools/document';
import { callFileTool } from '@/tools/file';
import { callSearchTool } from '@/tools/search';

vi.mock('@/tools/internal/context', () => ({
    escapeSqlString: (value: string) => value.replace(/\0/g, '').replace(/'/g, "''"),
    ensurePermissionForDocumentId: vi.fn(async () => ({
        context: { documentId: 'doc-1', notebook: 'nb-1', path: '/doc-1.sy' },
        denied: null,
    })),
    ensurePermissionForNotebook: vi.fn(async () => null),
    listChildDocumentsByPath: vi.fn(),
    resolveMoveTargetNotebook: vi.fn(),
    resolveNotebookForPath: vi.fn(),
}));

vi.mock('@/api/file', () => ({
    uploadAsset: vi.fn(),
    exportMdContent: vi.fn(),
}));

vi.mock('@/api/template', () => ({
    renderTemplate: vi.fn(),
    renderSprig: vi.fn(),
}));

vi.mock('@/api/document', () => ({
    getDoc: vi.fn(),
    getHPathByID: vi.fn(),
}));

vi.mock('@/api/notebook', () => ({
    listNotebooks: vi.fn(),
}));

vi.mock('@/api/block', () => ({
    setBlockAttrs: vi.fn(),
    updateBlock: vi.fn(),
    getBlockKramdown: vi.fn(),
    getChildBlocks: vi.fn(),
    getBlocksWordCount: vi.fn(),
}));

vi.mock('@/api/transaction', () => ({
    performTransactions: vi.fn(),
}));

vi.mock('@/api/search', () => ({
    fullTextSearchBlock: vi.fn(),
    getBacklinkDoc: vi.fn(),
    getBackmentionDoc: vi.fn(),
    querySQL: vi.fn(),
    searchTag: vi.fn(),
}));

describe('tool result normalization', () => {
    const enabledActions = <T extends string>(...actions: T[]) => ({
        enabled: true,
        actions: Object.fromEntries(actions.map((action) => [action, true])) as Record<T, boolean>,
    });

    const permMgr = {} as any;
    const client = {} as any;

    beforeEach(async () => {
        const fileApi = await import('@/api/file');
        const documentApi = await import('@/api/document');
        const notebookApi = await import('@/api/notebook');
        const attributeApi = await import('@/api/block');
        const blockApi = await import('@/api/block');
        const transactionApi = await import('@/api/transaction');
        const searchApi = await import('@/api/search');

        vi.mocked(fileApi.uploadAsset).mockReset();
        vi.mocked(fileApi.exportMdContent).mockReset();
        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.renderTemplate).mockReset();
        vi.mocked(documentApi.getDoc).mockReset();
        vi.mocked(documentApi.getHPathByID).mockReset();
        vi.mocked(notebookApi.listNotebooks).mockReset();
        vi.mocked(notebookApi.listNotebooks).mockResolvedValue({
            notebooks: [{ id: 'nb-1', name: 'Notebook One', icon: '', sort: 0, closed: false }],
        });
        vi.mocked(attributeApi.setBlockAttrs).mockReset();
        vi.mocked(transactionApi.performTransactions).mockReset();
        vi.mocked(blockApi.updateBlock).mockReset();
        vi.mocked(blockApi.getBlockKramdown).mockReset();
        vi.mocked(blockApi.getChildBlocks).mockReset();
        vi.mocked(searchApi.fullTextSearchBlock).mockReset();
        vi.mocked(searchApi.querySQL).mockReset();
    });

    it('returns clean markdown for document.get_doc markdown mode', async () => {
        const blockApi = await import('@/api/block');
        const documentApi = await import('@/api/document');
        vi.mocked(blockApi.getChildBlocks).mockResolvedValue([{ id: 'block-1', type: 'p' } as any]);
        vi.mocked(blockApi.getBlockKramdown).mockResolvedValue({ id: 'block-1', kramdown: 'hello #tag#\n{: id="block-1"}' });
        vi.mocked(documentApi.getHPathByID).mockResolvedValue('/Doc');

        const result = await callDocumentTool(client, {
            action: 'get_doc',
            id: 'doc-1',
            mode: 'markdown',
        }, enabledActions('get_doc'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            readInfo: { scope: 'document', coverage: 'complete', representation: 'markdown', limitations: [] },
            id: 'doc-1',
            mode: 'markdown',
            notebook: 'nb-1',
            notebookName: 'Notebook One',
            hPath: '/Doc',
            content: 'hello #tag#',
            outline: [],
            outlineScope: 'window',
            contentBytes: 11,
            maxContentBytes: 262144,
            blockStart: 0,
            returnedBlocks: 1,
            totalBlocks: 1,
            estimatedTokens: 3,
            tokenMode: 'approx_context_v1',
            truncated: false,
            hasNextWindow: false,
        });
    });

    it('uploads an asset from localFilePath', async () => {
        const fileApi = await import('@/api/file');
        const fs = (await import('node:fs')).default;
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({
            isFile: () => true,
        } as any);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(new Uint8Array([65, 66, 67]) as any);
        vi.mocked(fileApi.uploadAsset).mockResolvedValue({
            errFiles: [],
            succMap: { 'demo.txt': '/assets/demo.txt' },
        });

        const result = await callFileTool(client, {
            action: 'upload_asset',
            assetsDirPath: '/assets/',
            localFilePath: 'tmp/demo.txt',
        }, enabledActions('upload_asset'), permMgr);

        expect(vi.mocked(fileApi.uploadAsset)).toHaveBeenCalledWith(
            client,
            '/assets/',
            new Uint8Array([65, 66, 67]),
            'demo.txt',
        );
        expect(JSON.parse(result.content[0].text)).toEqual({
            errFiles: [],
            succMap: { 'demo.txt': '/assets/demo.txt' },
            localFilePath: expect.stringMatching(/tmp[\\/]+demo\.txt$/),
            uploadedFileName: 'demo.txt',
        });
    });

    it('uploads an asset from file alias with the default assets directory', async () => {
        const fileApi = await import('@/api/file');
        const fs = (await import('node:fs')).default;
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({
            isFile: () => true,
        } as any);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(new Uint8Array([65]) as any);
        vi.mocked(fileApi.uploadAsset).mockResolvedValue({
            errFiles: [],
            succMap: { 'demo.txt': '/assets/demo.txt' },
        });

        const result = await callFileTool(client, {
            action: 'upload_asset',
            file: 'tmp/demo.txt',
        }, enabledActions('upload_asset'), permMgr);

        expect(result.isError).toBeUndefined();
        expect(vi.mocked(fileApi.uploadAsset)).toHaveBeenCalledWith(
            client,
            '/assets/',
            new Uint8Array([65]),
            'demo.txt',
        );
    });

    it('maps block.word_count id alias to ids', async () => {
        const blockApi = await import('@/api/block');
        vi.mocked(blockApi.getBlocksWordCount).mockResolvedValue({ wordCount: 12 } as any);

        const result = await callBlockTool(client, {
            action: 'word_count',
            id: 'block-1',
        }, enabledActions('word_count'), permMgr);

        expect(result.isError).toBeUndefined();
        expect(vi.mocked(blockApi.getBlocksWordCount)).toHaveBeenCalledWith(client, ['block-1']);
    });

    it('normalizes fs.replace old/new shorthand before validation', () => {
        expect(normalizeToolArguments('fs', {
            action: 'replace',
            path: '/Notebook/Doc',
            old: 'alpha',
            new: 'beta',
            replace_all: true,
        })).toEqual({
            action: 'replace',
            path: '/Notebook/Doc',
            edit: {
                old: 'alpha',
                new: 'beta',
                replace_all: true,
            },
        });
    });

    it('rejects the removed base64 upload_asset shape', async () => {
        const result = await callFileTool(client, {
            action: 'upload_asset',
            assetsDirPath: '/assets/',
            fileName: 'demo.txt',
            file: 'QUJD',
        }, enabledActions('upload_asset'), permMgr);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.type).toBe('validation_error');
    });

    it('stops oversized uploads until the user explicitly confirms', async () => {
        const fileApi = await import('@/api/file');
        const fs = (await import('node:fs')).default;
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({
            isFile: () => true,
            size: 10 * 1024 * 1024 + 1,
        } as any);

        const result = await callFileTool(client, {
            action: 'upload_asset',
            assetsDirPath: '/assets/',
            localFilePath: 'tmp/huge.bin',
        }, enabledActions('upload_asset'), permMgr);

        expect(vi.mocked(fileApi.uploadAsset)).not.toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: false,
            requiresConfirmation: true,
            reason: 'file_too_large',
            localFilePath: expect.stringMatching(/tmp[\\/]+huge\.bin$/),
            fileSizeBytes: 10 * 1024 * 1024 + 1,
            thresholdBytes: 10 * 1024 * 1024,
            thresholdMB: 10,
            message: 'File exceeds the large-upload safety threshold (10 MB). Stop the current operation and ask the user for explicit confirmation before retrying with confirmLargeFile=true.',
        });
    });

    it('allows oversized uploads after explicit confirmation', async () => {
        const fileApi = await import('@/api/file');
        const fs = (await import('node:fs')).default;
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({
            isFile: () => true,
            size: 10 * 1024 * 1024 + 1,
        } as any);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(new Uint8Array([70]) as any);
        vi.mocked(fileApi.uploadAsset).mockResolvedValue({
            errFiles: [],
            succMap: { 'huge.bin': '/assets/huge.bin' },
        });

        const result = await callFileTool(client, {
            action: 'upload_asset',
            assetsDirPath: '/assets/',
            localFilePath: 'tmp/huge.bin',
            confirmLargeFile: true,
        }, enabledActions('upload_asset'), permMgr);

        expect(vi.mocked(fileApi.uploadAsset)).toHaveBeenCalled();
        expect(JSON.parse(result.content[0].text)).toEqual({
            errFiles: [],
            succMap: { 'huge.bin': '/assets/huge.bin' },
            localFilePath: expect.stringMatching(/tmp[\\/]+huge\.bin$/),
            uploadedFileName: 'huge.bin',
            largeFileConfirmed: true,
        });
    });

    it('uses the configured large upload threshold from file tool config', async () => {
        const fileApi = await import('@/api/file');
        const fs = (await import('node:fs')).default;
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({
            isFile: () => true,
            size: 2 * 1024 * 1024,
        } as any);

        const result = await callFileTool(client, {
            action: 'upload_asset',
            assetsDirPath: '/assets/',
            localFilePath: 'tmp/custom-threshold.bin',
        }, {
            ...enabledActions('upload_asset'),
            uploadLargeFileThresholdMB: 1,
        }, permMgr);

        expect(vi.mocked(fileApi.uploadAsset)).not.toHaveBeenCalled();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.reason).toBe('file_too_large');
        expect(parsed.thresholdMB).toBe(1);
        expect(parsed.thresholdBytes).toBe(1024 * 1024);
    });

    it('does not infer truncation from multi-line markdown alone', async () => {
        const blockApi = await import('@/api/block');
        vi.mocked(blockApi.updateBlock).mockResolvedValue({ updated: 1 });

        const result = await callBlockTool(client, {
            action: 'update',
            id: 'block-1',
            dataType: 'markdown',
            data: '# Title\n\n| A | B |\n| - | - |',
        }, enabledActions('update'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            id: 'block-1',
            dataType: 'markdown',
            markdown: '# Title\n\n| A | B |\n| - | - |',
            updated: 1,
        });
    });

    it('keeps block.update clean for single-line markdown', async () => {
        const blockApi = await import('@/api/block');
        vi.mocked(blockApi.updateBlock).mockResolvedValue({ updated: 1 });

        const result = await callBlockTool(client, {
            action: 'update',
            id: 'block-1',
            dataType: 'markdown',
            data: 'hello',
        }, enabledActions('update'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            id: 'block-1',
            dataType: 'markdown',
            markdown: 'hello',
            updated: 1,
        });
    });

    it('returns a workspace-specific error for template render paths outside the workspace', async () => {
        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.renderTemplate).mockRejectedValue(new Error('Path [/tmp/siyuan.tpl] is not in workspace'));

        const result = await callFileTool(client, {
            action: 'render',
            engine: 'template',
            id: 'doc-1',
            path: '/tmp/siyuan.tpl',
        }, enabledActions('render'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            error: {
                type: 'api_error',
                tool: 'file',
                action: 'render',
                message: 'Path [/tmp/siyuan.tpl] is not in workspace',
                reason: 'path_not_in_workspace',
                workspacePathRequired: true,
                hint: 'The template path must point to a file inside the SiYuan workspace, not an arbitrary local path such as /tmp/... or your repo checkout. Use file(action="list_templates") to resolve a valid template path.',
            },
        });
    });

    it('keeps html mode routed through document.getDoc', async () => {
        const documentApi = await import('@/api/document');
        vi.mocked(documentApi.getDoc).mockResolvedValue({
            content: '<div>doc</div>',
            extra: 'value',
        });

        const result = await callDocumentTool(client, {
            action: 'get_doc',
            id: 'doc-1',
            mode: 'html',
        }, enabledActions('get_doc'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            readInfo: { scope: 'document', coverage: 'unknown', representation: 'html', limitations: ['kernel_window', 'database_contents_not_included'] },
            id: 'doc-1',
            mode: 'html',
            notebook: 'nb-1',
            notebookName: 'Notebook One',
            content: '<div>doc</div>',
            extra: 'value',
        });
    });

    it('returns complete block windows for document.get_doc', async () => {
        const blockApi = await import('@/api/block');
        const documentApi = await import('@/api/document');
        vi.mocked(blockApi.getChildBlocks).mockResolvedValue([
            { id: 'block-1', type: 'p' } as any,
            { id: 'block-2', type: 'c' } as any,
        ]);
        vi.mocked(blockApi.getBlockKramdown).mockImplementation(async (_client, id) => ({
            id,
            kramdown: id === 'block-1'
                ? 'abcdefghij\n{: id="block-1"}'
                : '```ts\nconst value = 1;\n```\n{: id="block-2"}',
        }));
        vi.mocked(documentApi.getHPathByID).mockResolvedValue('/Doc');

        const result = await callDocumentTool(client, {
            action: 'get_doc',
            id: 'doc-1',
            mode: 'markdown',
            blockLimit: 1,
        }, enabledActions('get_doc'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            readInfo: { scope: 'document', coverage: 'partial', representation: 'markdown', limitations: ['block_limit', 'unknown_total'] },
            id: 'doc-1',
            mode: 'markdown',
            notebook: 'nb-1',
            notebookName: 'Notebook One',
            hPath: '/Doc',
            content: 'abcdefghij',
            outline: [],
            outlineScope: 'window',
            contentBytes: 10,
            maxContentBytes: 262144,
            blockStart: 0,
            blockLimit: 1,
            returnedBlocks: 1,
            totalBlocks: null,
            limitReason: 'block_limit',
            estimatedTokens: 3,
            tokenMode: 'approx_context_v1',
            truncated: true,
            hasNextWindow: true,
            nextWindow: {
                action: 'get_doc',
                id: 'doc-1',
                mode: 'markdown',
                blockStart: 1,
                blockLimit: 1,
            },
            nextWindowHint: 'Continue with document({"action":"get_doc","id":"doc-1","mode":"markdown","blockStart":1,"blockLimit":1}).',
        });
    });

    it('returns slim payload for block.update', async () => {
        const blockApi = await import('@/api/block');
        vi.mocked(blockApi.updateBlock).mockResolvedValue({
            doOperations: [{ id: 'block-1' }],
            undoOperations: null,
        } as any);

        const result = await callBlockTool(client, {
            action: 'update',
            id: 'block-1',
            dataType: 'markdown',
            data: 'updated\u200B text',
        }, enabledActions('update'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            id: 'block-1',
            dataType: 'markdown',
            markdown: 'updated text',
        });
    });

    it('cleans zero-width chars for file.export_md and block.get_kramdown', async () => {
        const fileApi = await import('@/api/file');
        const blockApi = await import('@/api/block');
        vi.mocked(fileApi.exportMdContent).mockResolvedValue({
            hPath: '/Doc',
            content: '\u200B#tag#\u200B',
        });
        vi.mocked(blockApi.getBlockKramdown).mockResolvedValue({
            id: 'block-1',
            kramdown: '\u200B#tag#\u200B',
        } as any);

        const exportResult = await callFileTool(client, {
            action: 'export_md',
            id: 'doc-1',
        }, enabledActions('export_md'), permMgr);
        const kramdownResult = await callBlockTool(client, {
            action: 'get_kramdown',
            id: 'block-1',
        }, enabledActions('get_kramdown'), permMgr);

        expect(JSON.parse(exportResult.content[0].text).content).toBe('#tag#');
        expect(JSON.parse(kramdownResult.content[0].text).kramdown).toBe('#tag#');
    });

    it('normalizes document cover sources into title-img attributes', async () => {
        const transactionApi = await import('@/api/transaction');
        const refreshClient = { request: vi.fn().mockResolvedValue(null) } as any;

        const result = await callDocumentTool(refreshClient, {
            action: 'set_attr',
            id: 'doc-1',
            attrs: { cover: ' /assets/covers/demo "cover".png ' },
        }, enabledActions('set_attr'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(refreshClient, [{
            doOperations: [{
                action: 'setAttrs',
                id: 'doc-1',
                data: JSON.stringify({ 'title-img': 'background-image:url("/assets/covers/demo \\"cover\\".png");' }),
            }],
            undoOperations: [],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            id: 'doc-1',
            cover: '/assets/covers/demo "cover".png',
            titleImg: 'background-image:url("/assets/covers/demo \\"cover\\".png");',
            uiRefresh: {
                applied: true,
                operations: [
                    { type: 'reloadProtyle', id: 'doc-1' },
                    { type: 'reloadFiletree' },
                ],
            },
        });
        expect(refreshClient.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
        expect(refreshClient.request).toHaveBeenCalledWith('/api/ui/reloadFiletree', {});
    });

    it('clears document cover attributes', async () => {
        const transactionApi = await import('@/api/transaction');
        const refreshClient = { request: vi.fn().mockResolvedValue(null) } as any;

        const result = await callDocumentTool(refreshClient, {
            action: 'set_attr',
            id: 'doc-1',
            attrs: { cover: '' },
        }, enabledActions('set_attr'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(refreshClient, [{
            doOperations: [{
                action: 'setAttrs',
                id: 'doc-1',
                data: JSON.stringify({ 'title-img': '' }),
            }],
            undoOperations: [],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            id: 'doc-1',
            clearedCover: true,
            uiRefresh: {
                applied: true,
                operations: [
                    { type: 'reloadProtyle', id: 'doc-1' },
                    { type: 'reloadFiletree' },
                ],
            },
        });
        expect(refreshClient.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
        expect(refreshClient.request).toHaveBeenCalledWith('/api/ui/reloadFiletree', {});
    });

    it('refreshes icon cache and file tree for document icon changes', async () => {
        const transactionApi = await import('@/api/transaction');
        const refreshClient = { request: vi.fn().mockResolvedValue(null) } as any;

        const result = await callDocumentTool(refreshClient, {
            action: 'set_attr',
            id: 'doc-1',
            attrs: { icon: '1f4d8' },
        }, enabledActions('set_attr'), permMgr);

        expect(vi.mocked(transactionApi.performTransactions)).toHaveBeenCalledWith(refreshClient, [{
            doOperations: [{
                action: 'setAttrs',
                id: 'doc-1',
                data: JSON.stringify({ icon: '1f4d8' }),
            }],
            undoOperations: [],
        }]);
        expect(JSON.parse(result.content[0].text)).toEqual({
            success: true,
            id: 'doc-1',
            icon: '1f4d8',
            uiRefresh: {
                applied: true,
                operations: [
                    { type: 'reloadIcon' },
                    { type: 'reloadFiletree' },
                ],
            },
        });
        expect(refreshClient.request).toHaveBeenCalledWith('/api/ui/reloadIcon', {});
        expect(refreshClient.request).toHaveBeenCalledWith('/api/ui/reloadFiletree', {});
    });

    it('adds plainContent when search.fulltext stripHtml is enabled', async () => {
        const searchApi = await import('@/api/search');
        vi.mocked(searchApi.fullTextSearchBlock).mockResolvedValue({
            blocks: [{ id: 'b1', content: 'before <mark>hit</mark> after' }],
            matchedBlockCount: 1,
            matchedRootCount: 1,
            pageCount: 1,
        });

        const result = await callSearchTool(client, {
            action: 'fulltext',
            query: 'hit',
            stripHtml: true,
        }, enabledActions('fulltext'), permMgr);

        expect(JSON.parse(result.content[0].text)).toMatchObject({
            data: [{ id: 'b1', content: 'before <mark>hit</mark> after', plainContent: 'before hit after', excerpt: 'before hit after' }],
            total: 1,
            page: 1,
            pageSize: 32,
            pageCount: 1,
            hasNextPage: false,
            matchedBlockCount: 1,
            matchedRootCount: 1,
            returnedTotal: 1,
            returnedPageCount: 1,
            returnedHasNextPage: false,
            kernelMatchedBlockCount: 1,
            kernelMatchedRootCount: 1,
            kernelPageCount: 1,
            kernelHasNextPage: false,
            showing: 1,
            truncated: false,
        });
    });

    it('paginates block.get_children results', async () => {
        const blockApi = await import('@/api/block');
        vi.mocked(blockApi.getChildBlocks).mockResolvedValue([
            { id: 'child-1' },
            { id: 'child-2' },
            { id: 'child-3' },
            { id: 'child-4' },
            { id: 'child-5' },
        ] as any);

        const result = await callBlockTool(client, {
            action: 'get_children',
            id: 'doc-1',
            page: 2,
            pageSize: 2,
        }, enabledActions('get_children'), permMgr);

        expect(JSON.parse(result.content[0].text)).toEqual({
            data: [
                { id: 'child-3' },
                { id: 'child-4' },
            ],
            total: 5,
            page: 2,
            pageSize: 2,
            pageCount: 3,
            hasNextPage: true,
            hint: 'Use page/pageSize to paginate. For focused reads, use block(action="get_kramdown") or search(action="query_sql") with a parent_id filter.',
        });
    });
});
