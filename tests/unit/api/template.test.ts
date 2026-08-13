import { describe, expect, it, vi } from 'vitest';

import {
    deleteTemplate,
    readTemplateSource,
    renderTemplate,
    renderSprig,
    saveDocAsTemplate,
    searchTemplates,
    writeTemplateSource,
} from '@/api/template';

describe('template api wrappers', () => {
    it('searches templates with the kernel picker endpoint', async () => {
        const request = vi.fn().mockResolvedValueOnce({
            k: 'report',
            templates: [{ path: '/workspace/data/templates/report.md', content: 'report' }],
        });
        const client = { request, requestRead: request } as never;

        await expect(searchTemplates(client, 'report')).resolves.toEqual({
            k: 'report',
            templates: [{ path: '/workspace/data/templates/report.md', content: 'report' }],
        });
        expect(request).toHaveBeenCalledWith('/api/search/searchTemplate', { k: 'report' });
    });

    it('requests template render by id and path', async () => {
        const request = vi.fn().mockResolvedValueOnce({ path: '/templates/note.md', content: 'rendered html' });
        const client = { request, requestRead: request } as never;

        await expect(renderTemplate(client, 'tpl-id', '/templates/note.md', true)).resolves.toEqual({
            path: '/templates/note.md',
            content: 'rendered html',
        });
        expect(request).toHaveBeenCalledWith('/api/template/render', {
            id: 'tpl-id',
            path: '/templates/note.md',
            preview: true,
        });
    });

    it('requests sprig template render', async () => {
        const request = vi.fn().mockResolvedValueOnce('sprig output');
        const client = { request, requestRead: request } as never;

        await expect(renderSprig(client, 'Hello {{ .Name }}')).resolves.toBe('sprig output');
        expect(request).toHaveBeenCalledWith('/api/template/renderSprig', {
            template: 'Hello {{ .Name }}',
        });
    });

    it('reads template source through the authenticated static route', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce({
            ok: true,
            text: vi.fn().mockResolvedValueOnce('# Report'),
        });
        global.fetch = fetchMock as never;
        const client = {
            getBaseUrl: () => 'http://127.0.0.1:6806',
            getAuthHeaders: () => ({ Authorization: 'Token test' }),
        } as never;

        await expect(readTemplateSource(client, '/Users/me/siyuan/data/templates/reports/monthly.md')).resolves.toEqual({
            path: '/Users/me/siyuan/data/templates/reports/monthly.md',
            relativePath: 'reports/monthly.md',
            markdown: '# Report',
        });
        expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:6806/templates/reports/monthly.md', {
            method: 'GET',
            headers: { Authorization: 'Token test' },
        });
    });

    it('writes template source through the workspace file API path', async () => {
        const writeFile = vi.fn().mockResolvedValueOnce(undefined);
        const client = { writeFile } as never;

        await expect(writeTemplateSource(client, '/Users/me/siyuan/data/templates/reports/monthly.md', '# Report')).resolves.toEqual({
            path: '/data/templates/reports/monthly.md',
            relativePath: 'reports/monthly.md',
            totalChars: 8,
        });
        expect(writeFile).toHaveBeenCalledWith('/data/templates/reports/monthly.md', '# Report');
    });

    it('deletes templates by resolving the picker path exactly', async () => {
        const request = vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
            if (endpoint === '/api/search/searchTemplate') {
                expect(body).toEqual({ k: 'reports/monthly' });
                return {
                    k: body?.k,
                    templates: [
                        { path: '/workspace/data/templates/reports/monthly.md', content: 'reports/monthly' },
                        { path: '/workspace/data/templates/reports/weekly.md', content: 'reports/weekly' },
                    ],
                };
            }
            if (endpoint === '/api/search/removeTemplate') {
                expect(body).toEqual({ path: '/workspace/data/templates/reports/monthly.md' });
                return null;
            }
            throw new Error(`Unexpected endpoint ${endpoint}`);
        });
        const client = { request, requestRead: request, requestWrite: request } as never;

        await expect(deleteTemplate(client, 'reports/monthly.md')).resolves.toEqual({
            path: '/workspace/data/templates/reports/monthly.md',
            relativePath: 'reports/monthly.md',
        });
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('saves a document as a root template and strips a .md suffix', async () => {
        const request = vi.fn().mockResolvedValueOnce(null);
        const client = { request, requestWrite: request } as never;

        await expect(saveDocAsTemplate(client, 'doc-1', 'meeting-note.md', true)).resolves.toEqual({
            id: 'doc-1',
            name: 'meeting-note',
            relativePath: 'meeting-note.md',
        });
        expect(request).toHaveBeenCalledWith('/api/template/docSaveAsTemplate', {
            id: 'doc-1',
            name: 'meeting-note',
            overwrite: true,
        });
    });

    it('accepts static and data/templates relative template paths', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue('content'),
        });
        global.fetch = fetchMock as never;
        const client = {
            getBaseUrl: () => 'http://127.0.0.1:6806',
            getAuthHeaders: () => ({}),
        } as never;

        await readTemplateSource(client, '/templates/demo.md');
        await readTemplateSource(client, 'data/templates/nested/demo.md');
        await readTemplateSource(client, 'nested/demo.md');

        expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:6806/templates/demo.md', expect.any(Object));
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:6806/templates/nested/demo.md', expect.any(Object));
        expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:6806/templates/nested/demo.md', expect.any(Object));
    });

    it('rejects unsafe or non-markdown template source paths', async () => {
        const client = {
            getBaseUrl: () => 'http://127.0.0.1:6806',
            getAuthHeaders: () => ({}),
        } as never;

        await expect(readTemplateSource(client, '/tmp/not-a-template.md')).rejects.toThrow(/data\/templates|static route/);
        await expect(writeTemplateSource(client, '/tmp/not-a-template.md', '')).rejects.toThrow(/data\/templates|static route/);
        await expect(readTemplateSource(client, 'templates/../secret.md')).rejects.toThrow(/traverse/);
        await expect(readTemplateSource(client, 'templates/demo.txt')).rejects.toThrow(/Markdown/);
        await expect(readTemplateSource(client, 'C:/tmp/demo.md')).rejects.toThrow(/drive paths/);
        await expect(saveDocAsTemplate(client, 'doc-1', 'nested/demo', false)).rejects.toThrow(/root template name/);
    });
});
