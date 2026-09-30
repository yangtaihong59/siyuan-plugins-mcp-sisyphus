import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UploadStagingStore, UPLOAD_STAGE_TTL_MS, MAX_TRANSFER_FILE_BYTES } from '@/core/upload-source';
import { stageKernelUpload, saveKernelExport } from '@/cli/kernel-file-transfer';
import { SiYuanClient } from '@/api/client';
import { hashWriteBytes } from '@/core/write-safety-hash';

const dirs: string[] = [];
const temp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-transfer-')); dirs.push(d); return d; };
afterEach(() => { vi.unstubAllGlobals(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const result = (payload: any) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload });

it('stages an immutable snapshot, deduplicates content, changes identity for changed bytes and expires', () => {
    let now = 100;
    const store = new UploadStagingStore(() => now);
    const a = store.stage('中文.txt', Buffer.from('one').toString('base64'));
    expect(store.stage('中文.txt', 'b25l').uploadSource).toBe(a.uploadSource);
    store.getUploadSource(a.uploadSource).bytes.fill(0);
    expect(Buffer.from(store.getUploadSource(a.uploadSource).bytes).toString()).toBe('one');
    expect(store.stage('中文.txt', 'dHdv').uploadSource).not.toBe(a.uploadSource);
    now += UPLOAD_STAGE_TTL_MS;
    expect(() => store.getUploadSource(a.uploadSource)).toThrow('upload_source_expired');
});
it('rejects malformed base64, unsafe names and oversized uploads', () => {
    const store = new UploadStagingStore();
    for (const data of ['!bad', 'YQ=', 'YR==']) expect(() => store.stage('x.txt', data)).toThrow();
    for (const name of ['../x', 'x/y', 'x\\y', 'x\r\nheader', '..']) expect(() => store.stage(name, 'YQ==')).toThrow();
    expect(() => store.stage('x', Buffer.alloc(MAX_TRANSFER_FILE_BYTES + 1).toString('base64'))).toThrow();
});
it('bounds stage entry count without evicting active uploads', () => {
    const store = new UploadStagingStore();
    for (let i = 0; i < 64; i++) store.stage(String(i), '');
    expect(() => store.stage('overflow', '')).toThrow('full');
    expect(store.stage('0', '').bytes).toBe(0);
});
it('transfers local bytes separately, verifies receipt, and preserves business/safety arguments', async () => {
    const file = path.join(temp(), '中文.txt'); fs.writeFileSync(file, 'one');
    const store = new UploadStagingStore();
    const fetch = vi.fn(async (_url: URL, init: RequestInit) => { if (_url.pathname.endsWith('/lookup')) { const body = JSON.parse(String(init.body)); const found = store.lookup(body.fileName, body.sha256, body.bytes); return new Response(JSON.stringify(found ?? {}), { status: found ? 200 : 404 }); } const fileName = decodeURIComponent(new Headers(init.headers).get('X-Sisyphus-File-Name')!); return new Response(JSON.stringify(store.stageBytes(fileName, init.body as Uint8Array))); });
    vi.stubGlobal('fetch', fetch);
    const args = { action: 'upload_asset', localFilePath: file, assetsDirPath: '/assets/', requestId: 'abcd', expectedSourceHash: '1234' };
    const first = await stageKernelUpload({ url: 'http://localhost/plugin/private/p/mcp' }, args);
    expect(first).toMatchObject({ requestId: 'abcd', expectedSourceHash: '1234', assetsDirPath: '/assets/' });
    expect(first).not.toHaveProperty('localFilePath'); expect(first).not.toHaveProperty('dataBase64');
    expect(String(fetch.mock.calls[1][0])).toBe('http://localhost/plugin/private/p/transfer/upload');
    expect((await stageKernelUpload({ url: 'http://localhost/plugin/private/p/mcp' }, args)).uploadSource).toBe(first.uploadSource);
    expect(fetch.mock.calls.filter(([url]) => url.pathname.endsWith('/upload'))).toHaveLength(1);
    fs.writeFileSync(file, 'two');
    expect((await stageKernelUpload({ url: 'http://localhost/plugin/private/p/mcp' }, args)).uploadSource).not.toBe(first.uploadSource);
});
it('saves ZIP exactly once, reports digest, and never overwrites an existing destination', async () => {
    const outputPath = path.join(temp(), '导出.zip');
    const bytes = new Uint8Array([0, 1, 255]);
    const client = { streamFile: vi.fn(async (_p, consume) => { await consume(bytes.subarray(0, 1)); await consume(bytes.subarray(1)); return bytes.length; }) } as any;
    const remote = result({ delivery: 'download', downloadPath: '/temp/export/a.zip', safety: { writeSafetyGuaranteed: false } });
    const saved = await saveKernelExport(client, { action: 'export_resources', outputPath }, remote);
    expect(saved.structuredContent).toMatchObject({ sha256: hashWriteBytes(bytes), bytes: 3 });
    expect(fs.readFileSync(outputPath)).toEqual(Buffer.from(bytes));
    await expect(saveKernelExport(client, { action: 'export_resources', outputPath }, remote)).rejects.toThrow('already exists');
    expect(client.streamFile).toHaveBeenCalledTimes(1);
});
it('extracts Unicode assets into a fresh directory, preserves siblings, and cleans partial failures', async () => {
    const outputDir = temp(); fs.writeFileSync(path.join(outputDir, 'keep.txt'), 'keep');
    const client = { streamFile: vi.fn(async (_p, consume) => { await consume(new Uint8Array([9, 8])); return 2; }) } as any;
    const remote = result({ delivery: 'download', docId: 'doc-1234567', docName: '测试', markdown: '![x](assets/%E4%B8%AD.txt)', assets: [{ path: '%E4%B8%AD.txt' }, { path: '%E4%B8%AD.txt' }] });
    const saved: any = await saveKernelExport(client, { action: 'extract_doc', id: 'doc-1234567', outputDir }, remote);
    expect(fs.readFileSync(path.join(saved.structuredContent.extractedDir, 'assets/中.txt'))).toEqual(Buffer.from([9, 8]));
    expect(fs.readFileSync(path.join(outputDir, 'keep.txt'), 'utf8')).toBe('keep');
    expect(client.streamFile).toHaveBeenCalledTimes(1);
    await expect(saveKernelExport(client, { action: 'extract_doc', id: 'doc-1234567', outputDir }, remote)).rejects.toThrow();
    const failed = result({ ...remote.structuredContent, docName: '失败' });
    client.streamFile.mockRejectedValue(new Error('download failed'));
    await expect(saveKernelExport(client, { action: 'extract_doc', id: 'doc-1234567', outputDir }, failed)).rejects.toThrow('download failed');
    expect(fs.existsSync(path.join(outputDir, '失败-1234567'))).toBe(false);
});
it('rejects encoded traversal and malformed manifests before creating output or fetching files', async () => {
    const client = { streamFile: vi.fn() } as any;
    const outputDir = path.join(temp(), 'new');
    for (const bad of ['../outside', '%2e%2e/outside', '/absolute', 'a\\b', 'a/../b']) {
        await expect(saveKernelExport(client, { action: 'extract_doc', id: 'doc', outputDir }, result({ delivery: 'download', docId: 'doc', docName: 'test', markdown: '', assets: [{ path: bad }] }))).rejects.toThrow();
    }
    expect(fs.existsSync(outputDir)).toBe(false); expect(client.streamFile).not.toHaveBeenCalled();
});
it('accepts exactly 10 MiB and rejects the next byte', () => {
    expect(MAX_TRANSFER_FILE_BYTES).toBe(10 * 1024 * 1024);
    const store = new UploadStagingStore();
    const exact = Buffer.alloc(10 * 1024 * 1024, 37);
    const staged = store.stage('boundary.bin', exact.toString('base64'));
    expect(staged.bytes).toBe(exact.length);
    expect(staged.sha256).toBe(hashWriteBytes(exact));
    expect(() => store.stage('too-big.bin', Buffer.alloc(exact.length + 1).toString('base64'))).toThrow();
});

it('removes a partially streamed ZIP after cancellation and preserves other files', async () => {
    const dir = temp(), outputPath = path.join(dir, 'partial.zip');
    fs.writeFileSync(path.join(dir, 'keep'), 'keep');
    const stop = new AbortController();
    const client = new SiYuanClient({ baseUrl: 'http://test' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
        start(c) { c.enqueue(new Uint8Array([1, 2])); },
    }))));
    const promise = saveKernelExport(client, { action: 'export_resources', outputPath }, result({ delivery: 'download', downloadPath: '/temp/x.zip' }), stop.signal);
    await new Promise(resolve => setTimeout(resolve, 30));
    stop.abort();
    await expect(promise).rejects.toThrow('cancelled');
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'keep'), 'utf8')).toBe('keep');
});
it('rejects oversized streams without Content-Length and HTTP 202 error envelopes', async () => {
    const client = new SiYuanClient({ baseUrl: 'http://test' });
    const consume = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4))));
    await expect(client.streamFile('/x', consume, { maxBytes: 3 })).rejects.toThrow('exceeds');
    expect(consume).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":404}', { status: 202 })));
    await expect(client.streamFile('/x', consume)).rejects.toThrow('HTTP 202');
    expect(consume).not.toHaveBeenCalled();
});
it('times out a stalled body and does not retry after receiving bytes', async () => {
    const client = new SiYuanClient({ baseUrl: 'http://test' });
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); } })));
    vi.stubGlobal('fetch', fetcher);
    const consume = vi.fn(async () => {});
    await expect(client.streamFile('/x', consume, { timeoutMs: 20 })).rejects.toThrow('timed out');
    expect(consume).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
});

it('lookup never trusts a claimed digest without an existing live immutable source', () => {
    let now = 0;
    const store = new UploadStagingStore(() => now);
    const bytes = new Uint8Array([1, 2, 3]), hash = hashWriteBytes(bytes);
    expect(store.lookup('test', hash, 3)).toBeUndefined();
    const staged = store.stageBytes('test', bytes);
    expect(store.lookup('test', hash, 4)).toBeUndefined();
    expect(store.lookup('different', hash, 3)).toBeUndefined();
    expect(store.lookup('test', hash, 3)?.uploadSource).toBe(staged.uploadSource);
    now += UPLOAD_STAGE_TTL_MS;
    expect(store.lookup('test', hash, 3)).toBeUndefined();
});
