import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { callFileTool, listFileTools } from '@/tools/file';
import { createMockClient } from '../../helpers/mock-client';
import { parseResult } from '../../helpers/parse-result';

vi.mock('@/api/file', () => ({
    exportMdContent: vi.fn(),
    exportResources: vi.fn(),
    getUnusedAssets: vi.fn(),
    getDocAssets: vi.fn(),
    getDocImageAssets: vi.fn(),
    getImageOCRText: vi.fn(),
    deleteAsset: vi.fn(),
}));

vi.mock('@/api/document', () => ({
    listDocTree: vi.fn(),
    getHPathByID: vi.fn(),
}));

vi.mock('@/api/template', () => ({
    normalizeTemplatePath: vi.fn((input: string) => {
        const normalized = input.replace(/\\/g, '/');
        const marker = '/data/templates/';
        const relativePath = normalized.includes(marker)
            ? normalized.slice(normalized.lastIndexOf(marker) + marker.length)
            : normalized.replace(/^\/?data\/templates\//, '').replace(/^\/?templates\//, '');
        return {
            path: normalized,
            relativePath,
            staticPath: `/templates/${relativePath}`,
        };
    }),
    searchTemplates: vi.fn(),
    resolveTemplate: vi.fn(),
    readTemplateSource: vi.fn(),
    writeTemplateSource: vi.fn(),
    deleteTemplate: vi.fn(),
    saveDocAsTemplate: vi.fn(),
    renderTemplate: vi.fn(),
    renderSprig: vi.fn(),
}));

vi.mock('@/tools/internal/context', () => ({

    ensurePermissionForNotebook: vi.fn(async () => null),
    ensurePermissionForDocumentId: vi.fn(async (_client: unknown, _permMgr: unknown, id: string) => ({
        context: {
            documentId: id,
            notebook: 'nb-1',
            path: `/${id}.sy`,
            hPath: id.startsWith('same-') ? '/Same' : id === 'doc-2' ? '/Doc 2' : id === 'doc-1' ? '/My Document' : '/My Document',
            name: id.startsWith('same-') ? 'Same' : id === 'doc-2' ? 'Doc 2' : 'My Document',
        },
        denied: null,
    })),
}));

describe('file tool asset actions', () => {
    const config = buildDefaultToolConfig();
    const client = createMockClient();

    beforeEach(async () => {
        const fileApi = await import('@/api/file');
        vi.mocked(fileApi.exportMdContent).mockReset();
        vi.mocked(fileApi.exportResources).mockReset();
        vi.mocked(fileApi.getUnusedAssets).mockReset();
        vi.mocked(fileApi.getDocAssets).mockReset();
        vi.mocked(fileApi.getDocImageAssets).mockReset();
        vi.mocked(fileApi.getImageOCRText).mockReset();
        vi.mocked(fileApi.deleteAsset).mockReset();

        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.normalizeTemplatePath).mockClear();
        vi.mocked(templateApi.searchTemplates).mockReset();
        vi.mocked(templateApi.resolveTemplate).mockReset();
        vi.mocked(templateApi.readTemplateSource).mockReset();
        vi.mocked(templateApi.writeTemplateSource).mockReset();
        vi.mocked(templateApi.deleteTemplate).mockReset();
        vi.mocked(templateApi.saveDocAsTemplate).mockReset();
        vi.mocked(templateApi.renderTemplate).mockReset();
        vi.mocked(templateApi.renderSprig).mockReset();

        vi.mocked(fileApi.exportMdContent).mockImplementation(async (_client, id) => ({
            content: String(id).startsWith('2026') ? '![image](assets/cover.png)\n\nSome text\n' : `# ${id}\n`,
            hPath: id.startsWith('same-') ? '/Same'
                : id.startsWith('bulk-') ? `/Bulk ${id.slice(-2)}`
                    : id === 'doc-2' ? '/Doc 2' : '/My Document',
        }));
        vi.mocked(fileApi.exportResources).mockResolvedValue({ path: '/temp/export.zip' });
        vi.mocked(fileApi.getUnusedAssets).mockResolvedValue(['assets/orphan.png']);
        vi.mocked(fileApi.getDocAssets).mockResolvedValue(['assets/manual.pdf', 'assets/cover.png']);
        vi.mocked(fileApi.getDocImageAssets).mockResolvedValue(['assets/cover.png']);
        vi.mocked(fileApi.getImageOCRText).mockResolvedValue({ text: 'recognized text' });
        vi.mocked(fileApi.deleteAsset).mockResolvedValue(null);
        vi.mocked(templateApi.searchTemplates).mockResolvedValue({ k: '', templates: [] });
        vi.mocked(templateApi.resolveTemplate).mockRejectedValue(Object.assign(new Error('Template not found: demo.md'), { reason: 'template_not_found' }));
        vi.mocked(templateApi.readTemplateSource).mockResolvedValue({
            path: '/workspace/data/templates/demo.md',
            relativePath: 'demo.md',
            markdown: 'demo',
        });
        vi.mocked(templateApi.writeTemplateSource).mockResolvedValue({
            path: '/data/templates/demo.md',
            relativePath: 'demo.md',
            totalChars: 4,
        });
        vi.mocked(templateApi.deleteTemplate).mockResolvedValue({
            path: '/workspace/data/templates/demo.md',
            relativePath: 'demo.md',
        });
        vi.mocked(templateApi.saveDocAsTemplate).mockResolvedValue({
            id: 'doc-1',
            name: 'demo',
            relativePath: 'demo.md',
        });
        vi.mocked(templateApi.renderTemplate).mockResolvedValue({
            path: '/workspace/data/templates/demo.md',
            content: '<div>rendered</div>',
        });
        vi.mocked(templateApi.renderSprig).mockResolvedValue('sprig');

        const documentApi = await import('@/api/document');
        vi.mocked(documentApi.listDocTree).mockReset();
        vi.mocked(documentApi.getHPathByID).mockReset();

        const context = await import('@/tools/internal/context');
        vi.mocked(context.ensurePermissionForDocumentId).mockClear();
        vi.mocked(context.ensurePermissionForNotebook).mockClear();
    });

    it('exports a deterministic paginated remote-safe Markdown snapshot from explicit document IDs', async () => {
        const result = await callFileTool(client, {
            action: 'export_markdown_snapshot',
            notebookID: 'nb-1',
            documentIDs: ['doc-2', 'doc-1'],
            limit: 1,
        }, config.file, {} as never);

        const payload = parseResult(result);
        expect(payload).toMatchObject({
            kind: 'siyuan-markdown-snapshot-page',
            status: 'complete',
            page: { offset: 0, limit: 1, total: 2, hasNext: true },
            documents: [expect.objectContaining({
                id: 'doc-1',
                content: '# doc-1\n',
                relativePath: 'My Document [doc-1].md',
                contentHash: expect.stringMatching(/^sha256:v1:/),
                metadataHash: expect.stringMatching(/^sha256:v1:/),
            })],
        });
        expect((payload as any).page.nextCursor).toEqual(expect.any(String));
        const context = await import('@/tools/internal/context');
        expect(context.ensurePermissionForDocumentId).toHaveBeenCalledTimes(1);

        const next = await callFileTool(client, {
            action: 'export_markdown_snapshot',
            notebookID: 'nb-1',
            documentIDs: ['doc-2', 'doc-1'],
            cursor: (payload as any).page.nextCursor,
            limit: 1,
        }, config.file, {} as never);
        expect(parseResult(next)).toMatchObject({
            page: { offset: 1, hasNext: false },
            documents: [expect.objectContaining({ id: 'doc-2', relativePath: 'Doc 2 [doc-2].md' })],
        });
        expect(context.ensurePermissionForDocumentId).toHaveBeenCalledTimes(2);
    });

    it('resolves only the requested root-inventory page before exporting', async () => {
        const documentApi = await import('@/api/document');
        const context = await import('@/tools/internal/context');
        vi.mocked(documentApi.listDocTree).mockResolvedValueOnce({ tree: Array.from({ length: 50 }, (_, index) => ({
            id: `bulk-${String(index).padStart(2, '0')}`,
            name: `Bulk ${String(index).padStart(2, '0')}`,
            hPath: `/Bulk ${String(index).padStart(2, '0')}`,
            path: `/bulk-${String(index).padStart(2, '0')}.sy`,
            children: [],
        })) });

        const result = await callFileTool(client, {
            action: 'export_markdown_snapshot',
            notebookID: 'nb-1',
            roots: ['/'],
            limit: 1,
        }, config.file, {} as never);
        const payload = parseResult(result) as any;

        expect(payload.page).toMatchObject({ offset: 0, limit: 1, total: 50, hasNext: true });
        expect(context.ensurePermissionForDocumentId).toHaveBeenCalledTimes(1);
        expect(payload.documents).toHaveLength(1);
    });

    it('enumerates roots through the document tree and records path conflicts without writing files', async () => {
        const documentApi = await import('@/api/document');
        vi.mocked(documentApi.listDocTree).mockResolvedValueOnce({ tree: [
            { id: 'same-1', name: 'Same', hPath: '/Same', path: '/same-1.sy', children: [] },
            { id: 'same-2', name: 'Same', hPath: '/Same', path: '/same-2.sy', children: [] },
        ] });
        const result = await callFileTool(client, {
            action: 'export_markdown_snapshot',
            notebookID: 'nb-1',
            roots: ['/'],
        }, config.file, {} as never);
        const payload = parseResult(result) as any;
        expect(payload.conflicts).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'relative_path_collision', documentIDs: ['same-1', 'same-2'] }),
        ]));
        expect(payload.documents.map((item: any) => item.relativePath)).toEqual([
            'Same [same-1].md',
            'Same [same-2].md',
        ]);
    });

    it('exposes asset management actions in the grouped schema', () => {
        const schemaConfig = buildDefaultToolConfig();
        schemaConfig.file.actions.delete_template = true;
        const [tool] = listFileTools(schemaConfig.file);
        const actionDescription = tool.inputSchema.properties.action.description;
        expect(actionDescription).toContain('list_templates');
        expect(actionDescription).toContain('read_template');
        expect(actionDescription).toContain('create_template');
        expect(actionDescription).toContain('update_template');
        expect(actionDescription).toContain('delete_template');
        expect(actionDescription).toContain('save_doc_as_template');
        expect(actionDescription).toContain('list_unused_assets');
        expect(actionDescription).toContain('get_doc_assets');
        expect(actionDescription).toContain('audit_image_refs');
        expect(actionDescription).toContain('get_image_ocr_text');
        expect(actionDescription).toContain('remove_unused_assets');
        expect(actionDescription).toContain('rename_asset');
        expect(actionDescription).toContain('delete_asset');
    });

    it('lists templates with reusable read and render arguments', async () => {
        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.searchTemplates).mockResolvedValueOnce({
            k: 'report',
            templates: [
                { path: '/workspace/data/templates/reports/monthly.md', content: 'reports/monthly' },
                { path: '/workspace/data/templates/reports/weekly.md', content: 'reports/weekly' },
            ],
        });

        const result = await callFileTool(client, {
            action: 'list_templates',
            query: 'report',
            page: 1,
            pageSize: 1,
        }, config.file, {} as never);

        expect(templateApi.searchTemplates).toHaveBeenCalledWith(client, 'report');
        expect(parseResult(result)).toEqual({
            data: [{
                path: '/workspace/data/templates/reports/monthly.md',
                relativePath: 'reports/monthly.md',
                name: 'monthly',
                content: 'reports/monthly',
                readArgs: {
                    action: 'read_template',
                    path: '/workspace/data/templates/reports/monthly.md',
                },
                renderArgsTemplate: {
                    action: 'render',
                    engine: 'template',
                    id: '<doc-id>',
                    path: '/workspace/data/templates/reports/monthly.md',
                },
            }],
            total: 2,
            page: 1,
            pageSize: 1,
            pageCount: 2,
            hasNextPage: true,
            query: 'report',
            showing: 1,
            truncated: true,
        });
    });

    it('reads template markdown with offset and limit pagination', async () => {
        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.readTemplateSource).mockResolvedValueOnce({
            path: '/workspace/data/templates/demo.md',
            relativePath: 'demo.md',
            markdown: 'hello world!',
        });

        const result = await callFileTool(client, {
            action: 'read_template',
            path: '/workspace/data/templates/demo.md',
            offset: 6,
            limit: 5,
        }, config.file, {} as never);

        expect(templateApi.readTemplateSource).toHaveBeenCalledWith(client, '/workspace/data/templates/demo.md');
        expect(parseResult(result)).toEqual({
            path: '/workspace/data/templates/demo.md',
            relativePath: 'demo.md',
            markdown: 'world',
            totalChars: 12,
            offset: 6,
            limit: 5,
            truncated: true,
            nextOffset: 11,
        });
    });

    it('returns a structured error when template source cannot be read', async () => {
        const templateApi = await import('@/api/template');
        const error = new Error('Template path must not traverse directories.') as Error & { reason?: string };
        error.reason = 'invalid_template_path';
        vi.mocked(templateApi.readTemplateSource).mockRejectedValueOnce(error);

        const result = await callFileTool(client, {
            action: 'read_template',
            path: '../secret.md',
        }, config.file, {} as never);

        expect(result.isError).toBe(true);
        expect(parseResult(result)).toEqual({
            error: {
                type: 'api_error',
                tool: 'file',
                action: 'read_template',
                message: 'Template path must not traverse directories.',
                reason: 'invalid_template_path',
                hint: 'Use file(action="list_templates") to resolve a valid Markdown template path. If you only need rendered output, use file(action="render", engine="template").',
            },
        });
    });

    it('creates a template when no existing template resolves', async () => {
        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.writeTemplateSource).mockResolvedValueOnce({
            path: '/data/templates/reports/monthly.md',
            relativePath: 'reports/monthly.md',
            totalChars: 8,
        });
        vi.mocked(templateApi.resolveTemplate)
            .mockRejectedValueOnce(Object.assign(new Error('Template not found: reports/monthly.md'), { reason: 'template_not_found' }))
            .mockResolvedValueOnce({
                path: '/workspace/data/templates/reports/monthly.md',
                relativePath: 'reports/monthly.md',
                content: 'reports/monthly',
            });

        const result = await callFileTool(client, {
            action: 'create_template',
            path: 'reports/monthly.md',
            markdown: '# Report',
        }, config.file, {} as never);

        expect(templateApi.writeTemplateSource).toHaveBeenCalledWith(client, 'reports/monthly.md', '# Report');
        expect(parseResult(result)).toEqual({
            success: true,
            path: '/workspace/data/templates/reports/monthly.md',
            relativePath: 'reports/monthly.md',
            name: 'monthly',
            totalChars: 8,
            readArgs: {
                action: 'read_template',
                path: '/workspace/data/templates/reports/monthly.md',
            },
            renderArgsTemplate: {
                action: 'render',
                engine: 'template',
                id: '<doc-id>',
                path: '/workspace/data/templates/reports/monthly.md',
            },
        });
    });

    it('returns template_exists when creating without overwrite over an existing template', async () => {
        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.resolveTemplate).mockResolvedValueOnce({
            path: '/workspace/data/templates/demo.md',
            relativePath: 'demo.md',
            content: 'demo',
        });

        const result = await callFileTool(client, {
            action: 'create_template',
            path: 'demo.md',
            markdown: 'demo',
        }, config.file, {} as never);

        expect(result.isError).toBe(true);
        expect(templateApi.writeTemplateSource).not.toHaveBeenCalled();
        expect(parseResult(result)).toEqual({
            error: {
                type: 'api_error',
                tool: 'file',
                action: 'create_template',
                message: 'Template already exists: demo.md',
                reason: 'template_exists',
                path: '/workspace/data/templates/demo.md',
                relativePath: 'demo.md',
                hint: 'Pass overwrite=true to replace the existing template, or choose a different template path.',
            },
        });
    });

    it('updates an existing template with full markdown source', async () => {
        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.resolveTemplate)
            .mockResolvedValueOnce({
                path: '/workspace/data/templates/demo.md',
                relativePath: 'demo.md',
                content: 'demo',
            })
            .mockResolvedValueOnce({
                path: '/workspace/data/templates/demo.md',
                relativePath: 'demo.md',
                content: 'demo',
            });
        vi.mocked(templateApi.writeTemplateSource).mockResolvedValueOnce({
            path: '/data/templates/demo.md',
            relativePath: 'demo.md',
            totalChars: 12000,
        });
        const markdown = 'x'.repeat(12000);

        const result = await callFileTool(client, {
            action: 'update_template',
            path: '/workspace/data/templates/demo.md',
            markdown,
        }, config.file, {} as never);

        expect(templateApi.writeTemplateSource).toHaveBeenCalledWith(client, 'demo.md', markdown);
        expect(parseResult(result)).toMatchObject({
            success: true,
            path: '/workspace/data/templates/demo.md',
            relativePath: 'demo.md',
            totalChars: 12000,
        });
    });

    it('deletes an enabled template action through the template API', async () => {
        const templateApi = await import('@/api/template');
        const enabledConfig = buildDefaultToolConfig();
        enabledConfig.file.actions.delete_template = true;

        const result = await callFileTool(client, {
            action: 'delete_template',
            path: '/workspace/data/templates/demo.md',
        }, enabledConfig.file, {} as never);

        expect(templateApi.deleteTemplate).toHaveBeenCalledWith(client, '/workspace/data/templates/demo.md');
        expect(parseResult(result)).toEqual({
            success: true,
            path: '/workspace/data/templates/demo.md',
            relativePath: 'demo.md',
        });
    });

    it('saves a document as a template after permission check', async () => {
        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.resolveTemplate).mockResolvedValueOnce({
            path: '/workspace/data/templates/demo.md',
            relativePath: 'demo.md',
            content: 'demo',
        });

        const result = await callFileTool(client, {
            action: 'save_doc_as_template',
            id: 'doc-1',
            name: 'demo',
        }, config.file, {} as never);

        expect(templateApi.saveDocAsTemplate).toHaveBeenCalledWith(client, 'doc-1', 'demo', false);
        expect(parseResult(result)).toEqual({
            success: true,
            id: 'doc-1',
            name: 'demo',
            template: {
                path: '/workspace/data/templates/demo.md',
                relativePath: 'demo.md',
                name: 'demo',
                readArgs: {
                    action: 'read_template',
                    path: '/workspace/data/templates/demo.md',
                },
                renderArgsTemplate: {
                    action: 'render',
                    engine: 'template',
                    id: '<doc-id>',
                    path: '/workspace/data/templates/demo.md',
                },
            },
        });
    });

    it('passes preview through while rendering workspace templates', async () => {
        const templateApi = await import('@/api/template');
        vi.mocked(templateApi.renderTemplate).mockResolvedValueOnce({
            path: '/workspace/data/templates/demo.md',
            content: '<div>preview</div>',
        });

        const result = await callFileTool(client, {
            action: 'render',
            engine: 'template',
            id: 'doc-1',
            path: '/workspace/data/templates/demo.md',
            preview: true,
        }, config.file, {} as never);

        expect(templateApi.renderTemplate).toHaveBeenCalledWith(client, 'doc-1', '/workspace/data/templates/demo.md', true);
        expect(parseResult(result)).toEqual({
            path: '/workspace/data/templates/demo.md',
            content: '<div>preview</div>',
        });
    });

    it('calls unused assets endpoint', async () => {
        const result = await callFileTool(client, {
            action: 'list_unused_assets',
        }, config.file, {} as never);

        expect(parseResult(result)).toEqual({
            assets: ['assets/orphan.png'],
            count: 1,
        });
    });

    it('returns document assets after permission check', async () => {
        const result = await callFileTool(client, {
            action: 'get_doc_assets',
            id: 'doc-1',
        }, config.file, {} as never);

        expect(parseResult(result)).toEqual({
            id: 'doc-1',
            assetType: 'all',
            assets: ['assets/manual.pdf', 'assets/cover.png'],
            count: 2,
        });
    });

    it('returns document image assets after permission check', async () => {
        const result = await callFileTool(client, {
            action: 'get_doc_assets',
            id: 'doc-1',
            assetType: 'image',
        }, config.file, {} as never);

        expect(parseResult(result)).toEqual({
            id: 'doc-1',
            assetType: 'image',
            assets: ['assets/cover.png'],
            count: 1,
        });
    });

    it('audits expected image references without reading or repairing local files', async () => {
        const fileApi = await import('@/api/file');
        vi.mocked(fileApi.getDocImageAssets).mockResolvedValueOnce([
            'assets/cover-20260813120000-abcdefg.png',
            'assets/extra.png',
        ]);

        const result = await callFileTool(client, {
            action: 'audit_image_refs',
            id: 'doc-1',
            expectedRefs: ['assets/cover.png', 'assets/missing.png'],
        }, config.file, {} as never);

        expect(fileApi.getDocImageAssets).toHaveBeenCalledWith(client, 'doc-1');
        expect(parseResult(result)).toEqual({
            id: 'doc-1',
            expectedRefs: ['assets/cover.png', 'assets/missing.png'],
            actualRefs: ['assets/cover-20260813120000-abcdefg.png', 'assets/extra.png'],
            missingRefs: ['assets/missing.png'],
            extraRefs: ['assets/extra.png'],
            expectedCount: 2,
            actualCount: 2,
            ok: false,
            comparison: 'multiset basename; each occurrence is matched once, and SiYuan timestamp/id suffixes are ignored for matching',
        });
    });

    it('returns OCR text for an image asset', async () => {
        const result = await callFileTool(client, {
            action: 'get_image_ocr_text',
            path: 'assets/cover.png',
        }, config.file, {} as never);

        expect(parseResult(result)).toEqual({
            path: 'assets/cover.png',
            text: 'recognized text',
        });
    });

    it('treats an empty delete asset response as success', async () => {
        const fileApi = await import('@/api/file');
        vi.mocked(fileApi.deleteAsset).mockResolvedValueOnce(null);

        const result = await callFileTool(client, {
            action: 'delete_asset',
            path: 'assets/old.png',
        }, config.file, {} as never);

        expect(fileApi.deleteAsset).toHaveBeenCalledWith(client, 'assets/old.png');
        expect(parseResult(result)).toEqual({
            success: true,
            path: 'assets/old.png',
        });
    });

    it('preserves extra fields from delete asset responses', async () => {
        const fileApi = await import('@/api/file');
        vi.mocked(fileApi.deleteAsset).mockResolvedValueOnce({ removed: true, affected: 1 });

        const result = await callFileTool(client, {
            action: 'delete_asset',
            path: 'assets/old.png',
        }, config.file, {} as never);

        expect(parseResult(result)).toEqual({
            success: true,
            path: 'assets/old.png',
            removed: true,
            affected: 1,
        });
    });

    it('exports resources to a local outputPath and reports the written byte count', async () => {
        const fs = (await import('node:fs')).default;
        const readFileBinary = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
        const localClient = createMockClient({ readFileBinary });
        const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation((() => undefined) as typeof fs.mkdirSync);
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((() => undefined) as typeof fs.writeFileSync);

        const result = await callFileTool(localClient, {
            action: 'export_resources',
            paths: ['assets/demo.txt'],
            outputPath: 'tmp/export.zip',
        }, config.file, {} as never);

        expect(readFileBinary).toHaveBeenCalledWith('/temp/export.zip');
        expect(mkdirSpy).toHaveBeenCalled();
        expect(writeSpy).toHaveBeenCalled();
        expect(parseResult(result)).toEqual({
            path: '/temp/export.zip',
            outputPath: expect.stringMatching(/[\\/]tmp[\\/]export\.zip$/),
            bytes: 3,
        });
    });

    it('extracts a document and its assets into an uncompressed folder', async () => {
        const fs = (await import('node:fs')).default;
        const readFileBinary = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
        const localClient = createMockClient({ readFileBinary });
        const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation((() => undefined) as typeof fs.rmSync);
        const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation((() => undefined) as typeof fs.mkdirSync);
        const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((() => undefined) as typeof fs.writeFileSync);

        const result = await callFileTool(localClient, {
            action: 'extract_doc',
            id: '20260128210016-dw9cpey',
        }, config.file, {} as never);

        const parsed = parseResult(result);
        expect(parsed.outputRoot).toContain('siyuan-extracted');
        expect(parsed.defaultOutputDirUsed).toBe(true);
        expect(parsed.hint).toContain('~/siyuan-extracted');
        expect(parsed.extractedDir).toContain('My Document-dw9cpey');
        expect(parsed.docMdFile).toBe('My Document.md');
        expect(parsed.extractedAssetCount).toBe(1);
        expect(parsed.skippedAssetCount).toBe(0);
        expect(parsed.structure).toContain('My Document.md');
        expect(parsed.structure).toContain('assets/cover.png');
        expect(readFileBinary).toHaveBeenCalledWith('data/assets/cover.png');
        expect(existsSyncSpy).toHaveBeenCalled();
        expect(rmSyncSpy).toHaveBeenCalled();
        expect(mkdirSpy).toHaveBeenCalled();
        expect(writeSpy).toHaveBeenCalledTimes(2);
    });

    it('skips missing assets and reports them', async () => {
        const readFileBinary = vi.fn().mockRejectedValue(new Error('not found'));
        const localClient = createMockClient({ readFileBinary });
        const fs = (await import('node:fs')).default;
        vi.spyOn(fs, 'mkdirSync').mockImplementation((() => undefined) as typeof fs.mkdirSync);
        vi.spyOn(fs, 'writeFileSync').mockImplementation((() => undefined) as typeof fs.writeFileSync);

        const result = await callFileTool(localClient, {
            action: 'extract_doc',
            id: '20260128210016-dw9cpey',
        }, config.file, {} as never);

        const parsed = parseResult(result);
        expect(parsed.extractedAssetCount).toBe(0);
        expect(parsed.skippedAssetCount).toBe(1);
    });

    it('extracts images with titles correctly', async () => {
        const fileApi = await import('@/api/file');
        vi.mocked(fileApi.exportMdContent).mockResolvedValue({
            content: '![alt](assets/cover.png "image title")\n\nSome text\n',
            hPath: '/My Document',
        });

        const readFileBinary = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
        const localClient = createMockClient({ readFileBinary });
        const fs = (await import('node:fs')).default;
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'rmSync').mockImplementation((() => undefined) as typeof fs.rmSync);
        vi.spyOn(fs, 'mkdirSync').mockImplementation((() => undefined) as typeof fs.mkdirSync);
        vi.spyOn(fs, 'writeFileSync').mockImplementation((() => undefined) as typeof fs.writeFileSync);

        const result = await callFileTool(localClient, {
            action: 'extract_doc',
            id: '20260128210016-dw9cpey',
        }, config.file, {} as never);

        const parsed = parseResult(result);
        expect(parsed.extractedAssetCount).toBe(1);
        expect(parsed.skippedAssetCount).toBe(0);
        expect(readFileBinary).toHaveBeenCalledWith('data/assets/cover.png');
    });
});
