import { describe, expect, it, vi } from 'vitest';

import {
    deleteAsset,
    exportResources,
    getDocAssets,
    getDocImageAssets,
    renameAsset,
    uploadAsset,
} from '@/api/file';

describe('file api wrappers', () => {
    it('delegates uploadAsset through requestFormData', async () => {
        const requestFormData = vi.fn().mockResolvedValueOnce({
            errFiles: [],
            succMap: { 'demo.txt': '/assets/demo.txt' },
        });
        const client = {
            requestFormData,
            requestFormDataWrite: requestFormData,
        } as never;

        const result = await uploadAsset(client, '/assets/', new Uint8Array([65, 66, 67]), 'demo.txt');

        expect(result).toEqual({
            errFiles: [],
            succMap: { 'demo.txt': '/assets/demo.txt' },
        });
        expect(requestFormData).toHaveBeenCalledTimes(1);
        const [endpoint, formData] = requestFormData.mock.calls[0] as [string, FormData];
        expect(endpoint).toBe('/api/asset/upload');
        expect(formData.get('assetsDirPath')).toBe('/assets/');
        const uploadedFile = formData.get('file[]');
        expect(uploadedFile).toBeInstanceOf(File);
        expect((uploadedFile as File).name).toBe('demo.txt');
    });

    it('propagates multipart upload timeouts', async () => {
        const requestFormData = vi.fn().mockRejectedValueOnce(new Error('Request timeout after 5000ms'));
        const client = {
            requestFormData,
            requestFormDataWrite: requestFormData,
        } as never;

        await expect(uploadAsset(client, '/assets/', new Uint8Array([1]), 'demo.txt')).rejects.toThrow('Request timeout');
    });

    it('propagates multipart upload HTTP errors', async () => {
        const requestFormData = vi.fn().mockRejectedValueOnce(new Error('HTTP error: 413 Payload Too Large'));
        const client = {
            requestFormData,
            requestFormDataWrite: requestFormData,
        } as never;

        await expect(uploadAsset(client, '/assets/', new Uint8Array([1]), 'demo.txt')).rejects.toThrow('HTTP error: 413');
    });

    it('passes exportResources payload through request()', async () => {
        const request = vi.fn().mockResolvedValueOnce({ path: '/temp/export.zip' });
        const client = {
            request,
            requestRead: request,
        } as never;

        await expect(exportResources(client, ['/data/assets/demo.txt'], 'bundle.zip')).resolves.toEqual({
            path: '/temp/export.zip',
        });
        expect(request).toHaveBeenCalledWith('/api/export/exportResources', {
            paths: ['/data/assets/demo.txt'],
            name: 'bundle.zip',
        });
    });

    it('routes document asset queries to the matching endpoints', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce(['assets/manual.pdf'])
            .mockResolvedValueOnce(['assets/cover.png']);
        const client = {
            request,
            requestRead: request,
        } as never;

        await expect(getDocAssets(client, 'doc-1')).resolves.toEqual(['assets/manual.pdf']);
        await expect(getDocImageAssets(client, 'doc-1')).resolves.toEqual(['assets/cover.png']);

        expect(request).toHaveBeenNthCalledWith(1, '/api/asset/getDocAssets', { id: 'doc-1' });
        expect(request).toHaveBeenNthCalledWith(2, '/api/asset/getDocImageAssets', { id: 'doc-1' });
    });

    it('routes asset mutations through request()', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce({ newPath: '/assets/renamed.txt' })
            .mockResolvedValueOnce({ ok: true });
        const client = {
            request,
            requestWrite: request,
        } as never;

        await expect(renameAsset(client, '/assets/demo.txt', 'renamed.txt')).resolves.toEqual({
            newPath: '/assets/renamed.txt',
        });
        await expect(deleteAsset(client, '/assets/demo.txt')).resolves.toEqual({ ok: true });

        expect(request).toHaveBeenNthCalledWith(1, '/api/asset/renameAsset', {
            oldPath: '/assets/demo.txt',
            newName: 'renamed.txt',
        });
        expect(request).toHaveBeenNthCalledWith(2, '/api/asset/removeUnusedAsset', {
            path: '/assets/demo.txt',
        });
    });
});
