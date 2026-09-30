import { afterEach, expect, it, vi } from 'vitest';
import { KernelSiYuanClient } from '@/kernel/client';

afterEach(() => { vi.unstubAllGlobals(); });
it('writes Unicode template content through the native ArrayBuffer multipart contract exactly once', async () => {
    const fetch = vi.fn(async (_path: string, init: any) => {
        const response = new Response(init.body, { headers: init.headers });
        const form = await response.formData();
        expect(form.get('path')).toBe('/data/templates/中文.md');
        expect(form.get('isDir')).toBe('false');
        expect(await (form.get('file') as File).text()).toBe('中文 🌏\n.action{.title}');
        return { ok: true, status: 200, text: async () => '{"code":0}' };
    });
    vi.stubGlobal('siyuan', { client: { fetch } });
    await new KernelSiYuanClient().writeFile('/data/templates/中文.md', '中文 🌏\n.action{.title}');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/file/putFile');
});
it('rejects oversized writes before network and bounds API response parsing', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"code":0,"data":"中文"}' }));
    vi.stubGlobal('siyuan', { client: { fetch } });
    const client = new KernelSiYuanClient();
    await expect(client.writeFile('/data/templates/big.md', 'x'.repeat(16 * 1024 * 1024 + 1))).rejects.toThrow('16 MiB');
    expect(fetch).not.toHaveBeenCalled();
    await expect(client.requestRead('/api/test', {}, 10)).rejects.toThrow('exceeds');
});
it('does not turn HTTP file read failures into file content', async () => {
    vi.stubGlobal('siyuan', { client: { fetch: async () => ({ ok: false, status: 403 }) } });
    const client = new KernelSiYuanClient();
    await expect(client.readFile('/data/templates/a.md')).rejects.toThrow('403');
    await expect(client.readFileBinary('/data/assets/a.png')).rejects.toThrow('403');
});

import { readTemplateSource } from '@/api/template';
import { WriteSafetyCoordinator } from '@/core/write-safety-coordinator';
import { PermissionManager } from '@/core/permissions';
it('reads template bytes through native fetch without a global fetch implementation', async () => {
    const fetch = vi.fn(async (_path: string) => ({ ok: true, status: 200, text: async () => '中文模板 🌏' }));
    vi.stubGlobal('siyuan', { client: { fetch } });
    vi.stubGlobal('fetch', undefined);
    const source = await readTemplateSource(new KernelSiYuanClient() as any, 'fixture.md');
    expect(source.markdown).toBe('中文模板 🌏');
    expect(fetch.mock.calls[0][0]).toBe('/templates/fixture.md');
});
it('does not issue a template lease when reading state fails with HTTP 503', async () => {
    const client = { readFile: async () => '', requestResource: async () => ({ ok: false, status: 503, statusText: 'Unavailable' }) } as any;
    const coordinator = new WriteSafetyCoordinator(client);
    const execute = vi.fn();
    const result = await coordinator.run({ client, permMgr: new PermissionManager(client), category: 'file', action: 'update_template', args: { action: 'update_template', path: 'fixture.md', markdown: 'new', validateOnly: true }, strictMode: true, execute });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('503');
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('leaseExpiresAt');
});
it('allows 10 MiB asset bytes plus multipart framing while keeping template bounds unchanged', async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024); bytes[bytes.length - 1] = 255;
    vi.stubGlobal('siyuan', { client: { fetch: async (_path: string, init: any) => {
        const form = await new Response(init.body, { headers: init.headers }).formData();
        const file = form.get('file[]') as File;
        expect(file.size).toBe(10 * 1024 * 1024);
        expect(new Uint8Array(await file.arrayBuffer())[bytes.length - 1]).toBe(255);
        return { ok: true, status: 200, text: async () => '{"code":0,"data":{}}' };
    } } });
    await new KernelSiYuanClient().uploadAssetBytes('/assets/', bytes, 'boundary.bin');
});
it('retries only transient reads, never writes or permanent errors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503, text: async () => '' })
        .mockResolvedValue({ ok: true, status: 200, text: async () => '{"code":0,"data":42}' });
    vi.stubGlobal('siyuan', { client: { fetch } });
    const client = new KernelSiYuanClient();
    await expect(client.requestRead('/api/test')).resolves.toBe(42);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockReset().mockRejectedValue(new Error('lost'));
    await expect(client.requestWrite('/api/test')).rejects.toThrow('lost');
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockReset().mockResolvedValue({ ok: false, status: 403, text: async () => '' });
    await expect(client.requestRead('/api/test')).rejects.toThrow('403');
    expect(fetch).toHaveBeenCalledTimes(1);
});
it('checks cancellation before a retry, with no second transport call', async () => {
    let cancelled = false;
    const fetch = vi.fn(async () => { cancelled = true; throw new Error('network'); });
    vi.stubGlobal('siyuan', { client: { fetch } });
    const client = new KernelSiYuanClient().forTask(() => { if (cancelled) throw new Error('cancelled'); });
    await expect(client.requestRead('/api/test')).rejects.toThrow('cancelled');
    expect(fetch).toHaveBeenCalledTimes(1);
});
it('proxies external payload bytes without global fetch, redirects or automatic POST retry', async () => {
    const fetch = vi.fn(async (path, init) => {
        expect(path).toBe('/api/network/forwardProxy');
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ method: 'POST', payloadEncoding: 'base64', redirect: false, timeout: 15000 });
        expect(Buffer.from(body.payload, 'base64').toString()).toBe('{"text":"中文"}');
        expect(body.headers).toEqual([{ Cookie: 'csrf=test' }]);
        return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { status: 201, body: '{"ok":true}' } }) };
    });
    vi.stubGlobal('siyuan', { client: { fetch } }); vi.stubGlobal('fetch', undefined); vi.stubGlobal('AbortController', undefined);
    const client = new KernelSiYuanClient();
    const result = await client.fetchExternal('https://example.com/submit', { method: 'POST', headers: { Cookie: 'csrf=test' }, body: '{"text":"中文"}' }, 15000);
    expect(result.ok).toBe(true); expect(await result.text()).toBe('{"ok":true}'); expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRejectedValue(new Error('lost'));
    await expect(client.fetchExternal('https://example.com/submit', {}, 15000)).rejects.toThrow('lost');
    expect(fetch).toHaveBeenCalledTimes(2);
});
it('accepts templates beyond 8 MiB while leaving other multipart writes bounded', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"code":0}' }));
    vi.stubGlobal('siyuan', { client: { fetch } });
    const client = new KernelSiYuanClient();
    const content = 'x'.repeat(9 * 1024 * 1024);
    await expect(client.writeFile('/data/templates/large.md', content)).resolves.toBeUndefined();
    await expect(client.writeFile('/data/other/file', content)).rejects.toThrow('8 MiB');
    expect(fetch).toHaveBeenCalledTimes(1);
});
