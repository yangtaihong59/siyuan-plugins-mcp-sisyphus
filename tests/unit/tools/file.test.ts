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

vi.mock('@/api/template', () => ({
    renderTemplate: vi.fn(),
    renderSprig: vi.fn(),
}));

vi.mock('@/tools/internal/context', () => ({

    ensurePermissionForDocumentId: vi.fn(async () => ({
        context: { documentId: 'doc-1', notebook: 'nb-1', path: '/doc-1.sy' },
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

        vi.mocked(fileApi.exportMdContent).mockResolvedValue({
            content: '![image](assets/cover.png)\n\nSome text\n',
            hPath: '/My Document',
        });
        vi.mocked(fileApi.exportResources).mockResolvedValue({ path: '/temp/export.zip' });
        vi.mocked(fileApi.getUnusedAssets).mockResolvedValue(['assets/orphan.png']);
        vi.mocked(fileApi.getDocAssets).mockResolvedValue(['assets/manual.pdf', 'assets/cover.png']);
        vi.mocked(fileApi.getDocImageAssets).mockResolvedValue(['assets/cover.png']);
        vi.mocked(fileApi.getImageOCRText).mockResolvedValue({ text: 'recognized text' });
        vi.mocked(fileApi.deleteAsset).mockResolvedValue(null);
    });

    it('exposes asset management actions in the grouped schema', () => {
        const [tool] = listFileTools(config.file);
        const actionDescription = tool.inputSchema.properties.action.description;
        expect(actionDescription).toContain('list_unused_assets');
        expect(actionDescription).toContain('get_doc_assets');
        expect(actionDescription).toContain('get_image_ocr_text');
        expect(actionDescription).toContain('remove_unused_assets');
        expect(actionDescription).toContain('rename_asset');
        expect(actionDescription).toContain('delete_asset');
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
