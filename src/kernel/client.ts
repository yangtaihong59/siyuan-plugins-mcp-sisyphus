import { normalizeKernelOptions, type KernelOptions } from '../core/kernel-options';
import type { ExternalResponse } from '../core/external-fetch';
import { UploadStagingStore, MAX_TRANSFER_FILE_BYTES } from '../core/upload-source';
import { randomUUID } from './node-shims';
/*
 * KernelSiYuanClient — a SiYuanClient-compatible adapter backed by the
 * kernel petal's siyuan.client.fetch API.
 *
 * Runs inside the goja sandbox. `siyuan.client.fetch(path, init)` hits
 * http://127.0.0.1:<kernelPort><path> with the plugin's auth token injected
 * automatically — no manual Authorization header needed. The response object
 * exposes .json()/.text()/.arrayBuffer()/.ok/.status instead of a fetch
 * Response, so we normalize it here.
 *
 * Only the methods that WriteSafetyCoordinator + tool handlers actually
 * call are implemented. Workspace writes use bounded multipart bodies; host filesystem access
 * remains unavailable in the kernel sandbox.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const siyuan: any;

export class KernelResponseError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly retryable: boolean,
    ) {
        super(message);
        this.name = 'KernelResponseError';
    }
}

export class KernelSiYuanClient {
    declare readonly storageIdentity: object;
    constructor() {
        // Object.create task scopes inherit this non-writable identity; task
        // proxies pass non-function properties through without rebinding them.
        Object.defineProperty(this, 'storageIdentity', { value: Object.freeze({}) });
    }
    private token = '';
    private options = normalizeKernelOptions(undefined);
    private checkpoint = () => {};
    private retryCheckpoint = () => {};
    configure(options: KernelOptions) { this.options = options; }
    forTask(checkpoint: () => void, retryCheckpoint = () => {}): KernelSiYuanClient {
        const scoped = Object.create(this) as KernelSiYuanClient;
        scoped.checkpoint = checkpoint;
        scoped.retryCheckpoint = retryCheckpoint;
        scoped.options = { ...this.options };
        return scoped;
    }
    private async retryRead<T>(run: () => Promise<T>): Promise<T> {
        for (let attempt = 0;; attempt++) {
            this.checkpoint();
            if (attempt > 0) this.retryCheckpoint();
            try { const result = await run(); this.checkpoint(); return result; }
            catch (error) {
                this.checkpoint();
                // Retry transport failures and transient HTTP errors, never API/schema/size errors.
                if (attempt >= this.options.readRetries || (error instanceof KernelResponseError && !error.retryable)) throw error;
                await new Promise(resolve => setTimeout(resolve, Math.min(100 * 2 ** attempt, 1000)));
            }
        }
    }
    async fetchExternal(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }, timeoutMs: number): Promise<ExternalResponse> {
        const target = new URL(url);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('External request requires an HTTP(S) URL without credentials');
        // Existing authenticated SiYuan proxy enforces destination and response-size policy.
        // External submissions are never retried: a lost response may follow a successful POST.
        const result = await this.requestWrite<{ status: number; body: string }>('/api/network/forwardProxy', {
            url, method: init.method ?? 'GET', timeout: Math.max(1000, Math.min(30000, timeoutMs)),
            headers: Object.entries(init.headers ?? {}).map(([key, value]) => ({ [key]: value })),
            contentType: init.headers?.['Content-Type'] ?? 'application/json',
            payload: Buffer.from(init.body ?? '', 'utf8').toString('base64'), payloadEncoding: 'base64', responseEncoding: 'text', redirect: false,
        });
        if (!result || typeof result.status !== 'number' || typeof result.body !== 'string') throw new Error('Invalid network proxy response');
        return { ok: result.status >= 200 && result.status < 300, status: result.status, text: async () => result.body };
    }
    readonly uploads = new UploadStagingStore();
    getUploadSource(id: string) { return this.uploads.getUploadSource(id); }
    async uploadAssetBytes<T>(assetsDirPath: string, bytes: Uint8Array, fileName: string): Promise<T> {
        if (bytes.byteLength > MAX_TRANSFER_FILE_BYTES) throw new Error('Kernel upload exceeds 10 MiB');
        return this.sendMultipart<T>('/api/asset/upload', [
            { name: 'assetsDirPath', value: assetsDirPath },
            { name: 'file[]', filename: fileName, value: bytes },
        ], MAX_TRANSFER_FILE_BYTES + 64 * 1024);
    }

    setToken(token: string): void {
        // The kernel injects the plugin token automatically; storing it is
        // harmless and keeps parity with SiYuanClient's surface.
        this.token = token;
    }

    getBaseUrl(): string {
        return 'kernel://localhost';
    }

    getAuthHeaders(): Record<string, string> {
        return {};
    }

    async requestResource(path: string) {
        return this.retryRead(async () => {
            const response = await this.doFetch(path, { method: 'GET' });
            if (!response.ok && (response.status === 429 || response.status >= 500)) throw new KernelResponseError(`HTTP error: ${response.status}`, response.status, true);
            return { ...response, statusText: '' };
        });
    }

    private async doFetch(
        path: string,
        init: { method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer },
    ): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown>; arrayBuffer: () => Promise<unknown> }> {
        const resp = await siyuan.client.fetch(path, {
            method: init.method ?? 'GET',
            headers: init.headers ?? {},
            body: init.body,
        });
        return {
            ok: !!resp?.ok,
            status: typeof resp?.status === 'number' ? resp.status : 0,
            text: () => resp.text(),
            json: () => resp.json(),
            arrayBuffer: () => resp.arrayBuffer(),
        };
    }

    private async readData<T>(
        path: string,
        init: { method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer },
        maxResponseBytes?: number,
    ): Promise<T> {
        const resp = await this.doFetch(path, init);
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            const retryable = !(resp.status >= 400 && resp.status < 500 && resp.status !== 429);
            throw new KernelResponseError(
                `HTTP error: ${resp.status} ${text.slice(0, 200)}`,
                resp.status,
                retryable,
            );
        }
        const rawText = await resp.text();
        if (maxResponseBytes !== undefined && new TextEncoder().encode(rawText).byteLength > maxResponseBytes) {
            throw new KernelResponseError(`Response exceeds ${maxResponseBytes} bytes`, resp.status, false);
        }
        if (rawText.trim() === '') return null as T;
        let result: { code?: number; msg?: string; data?: T };
        try {
            result = JSON.parse(rawText) as { code?: number; msg?: string; data?: T };
        } catch {
            throw new KernelResponseError(
                `Invalid SiYuan API response from ${path}: ${rawText.slice(0, 200)}`,
                resp.status,
                false,
            );
        }
        if (result.code !== 0) {
            throw new KernelResponseError(
                `SiYuan API error: ${result.code} - ${result.msg}`,
                resp.status,
                false,
            );
        }
        return result.data as T;
    }

    async requestRead<T>(endpoint: string, data?: object, maxResponseBytes?: number): Promise<T> {
        return this.retryRead(() => this.readData<T>(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data ?? {}),
        }, maxResponseBytes));
    }

    async requestWrite<T>(endpoint: string, data?: object): Promise<T> {
        return this.readData<T>(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data ?? {}),
        });
    }

    /** @deprecated parity with SiYuanClient; defaults to write semantics. */
    async request<T>(endpoint: string, data?: object): Promise<T> {
        return this.requestWrite(endpoint, data);
    }

    async requestApi(endpoint: string, method: string, body?: string | ArrayBuffer): Promise<unknown> {
        const upper = method.toUpperCase();
        const init: { method: string; headers: Record<string, string>; body?: string | ArrayBuffer } = {
            method: upper,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body !== undefined && upper !== 'GET' && upper !== 'HEAD') init.body = body;
        return this.readData<unknown>(endpoint, init);
    }

    async readFile(path: string): Promise<string> { return this.retryRead(() => this.readFileOnce(path)); }
    private async readFileOnce(path: string): Promise<string> {
        // storage/petal paths resolve via siyuan.storage; workspace paths go
        // through the kernel getFile API. A missing petal file surfaces from
        // goja as "open <path>: no such file or directory", which callers like
        // WriteSafetyLedger treat as absent only when the message matches a
        // not-found pattern — normalize it to an empty read.
        if (isPetalPath(path)) {
            try {
                const obj = await siyuan.storage.get(petalRelative(path));
                if (!obj) return '';
                return await obj.text();
            } catch (error) {
                if (isMissingFileError(error)) return '';
                throw error;
            }
        }
        const resp = await this.doFetch('/api/file/getFile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        if (!resp.ok) throw new KernelResponseError(`HTTP error: ${resp.status} reading ${path}`, resp.status, resp.status === 429 || resp.status >= 500);
        return await resp.text();
    }

    async readFileBinary(path: string): Promise<Uint8Array> { return this.retryRead(() => this.readFileBinaryOnce(path)); }
    private async readFileBinaryOnce(path: string): Promise<Uint8Array> {
        if (isPetalPath(path)) {
            try {
                const obj = await siyuan.storage.get(petalRelative(path));
                if (!obj) return new Uint8Array(0);
                const ab = await obj.arrayBuffer();
                return new Uint8Array(ab as ArrayBuffer);
            } catch (error) {
                if (isMissingFileError(error)) return new Uint8Array(0);
                throw error;
            }
        }
        const resp = await this.doFetch('/api/file/getFile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        if (!resp.ok) throw new KernelResponseError(`HTTP error: ${resp.status} reading ${path}`, resp.status, resp.status === 429 || resp.status >= 500);
        const ab = await resp.arrayBuffer();
        return new Uint8Array(ab as ArrayBuffer);
    }

    async writeFile(path: string, content: string): Promise<void> {
        if (isPetalPath(path)) {
            await siyuan.storage.put(petalRelative(path), content);
            return;
        }
        const bytes = new TextEncoder().encode(content);
        const template = /^\/?data\/templates\//.test(path);
        const templateLimit = this.options.templateMaxMiB * 1024 * 1024;
        if (template && bytes.byteLength > templateLimit) throw new Error(`Template exceeds ${this.options.templateMaxMiB} MiB`);
        await this.sendMultipart('/api/file/putFile', [
            { name: 'path', value: path },
            { name: 'isDir', value: 'false' },
            { name: 'modTime', value: String(Date.now()) },
            { name: 'file', filename: 'content', value: bytes },
        ], template ? templateLimit + 64 * 1024 : MAX_MULTIPART_BYTES);
    }

    private async sendMultipart<T>(endpoint: string, fields: MultipartField[], maxBytes = MAX_MULTIPART_BYTES): Promise<T> {
        const body = encodeMultipart(fields, maxBytes);
        return this.readData<T>(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${body.boundary}` },
            body: body.bytes.buffer as ArrayBuffer,
        });
    }

    async requestFormDataRead<T>(endpoint: string, formData: unknown): Promise<T> {
        return this.retryRead(() => this.requestFormDataWrite<T>(endpoint, formData));
    }

    async requestFormDataWrite<T>(endpoint: string, formData: any): Promise<T> {
        if (typeof formData?.entries !== 'function') throw new Error('Expected iterable multipart form data');
        const fields: MultipartField[] = [];
        for (const [name, value] of formData.entries()) {
            fields.push(typeof value === 'string'
                ? { name, value }
                : { name, filename: value.name || 'file', value: new Uint8Array(await value.arrayBuffer()) });
        }
        return this.sendMultipart<T>(endpoint, fields);
    }

    async requestFormData<T>(endpoint: string, formData: unknown): Promise<T> {
        return this.requestFormDataWrite<T>(endpoint, formData);
    }
}

const PETAL_PREFIX = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/';

function isPetalPath(path: string): boolean {
    return typeof path === 'string' && path.startsWith(PETAL_PREFIX);
}

function petalRelative(path: string): string {
    return path.slice(PETAL_PREFIX.length);
}

// goja's storage.get throws a Go-flavored message for absent files; the
// desktop getFile API instead returns an HTTP 202 error envelope. Treat the
// kernel-side throw as the same "missing" condition.
function isMissingFileError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return /no such file or directory|not exist|file does not exist|cannot find/i.test(msg);
}

interface MultipartField { name: string; filename?: string; value: string | Uint8Array }
const MAX_MULTIPART_BYTES = 8 * 1024 * 1024;

/** Native siyuan.client.fetch accepts ArrayBuffer; no Blob/FormData globals needed. */
function encodeMultipart(fields: MultipartField[], maxBytes: number): { boundary: string; bytes: Uint8Array } {
    const encoder = new TextEncoder();
    const boundary = `sisyphus-${randomUUID()}`;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const append = (chunk: string | Uint8Array) => {
        const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
        size += bytes.byteLength;
        if (size > maxBytes) throw new Error(`Kernel multipart body exceeds ${maxBytes / 1024 / 1024} MiB including framing.`);
        chunks.push(bytes);
    };
    for (const field of fields) {
        if (/[\r\n"\\]/.test(field.name) || (field.filename && /[\r\n"\\]/.test(field.filename))) {
            throw new Error('Invalid multipart field name');
        }
        append(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"${field.filename ? `; filename="${field.filename}"` : ''}\r\n${field.filename ? 'Content-Type: application/octet-stream\r\n' : ''}\r\n`);
        append(field.value);
        append('\r\n');
    }
    append(`--${boundary}--\r\n`);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { boundary, bytes };
}
