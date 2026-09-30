import type { SiYuanResponse } from '../types/shared';

export interface SiYuanClientConfig {
    baseUrl?: string;
    timeout?: number;
}

export type { SiYuanResponse } from '../types/shared';

export type RequestSemantics = 'read' | 'write';

export class ResponseSizeLimitError extends Error {
    readonly code = 'response_too_large';
    constructor(readonly maxBytes: number) {
        super(`SiYuan response exceeds the ${maxBytes}-byte read limit. Narrow the requested content.`);
    }
}

/** A write may already have reached SiYuan when transport acknowledgement fails. */
export class WriteOutcomeUnknownError extends Error {
    readonly code = 'outcome_unknown';
    readonly endpoint: string;

    constructor(endpoint: string, cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        super(`Write outcome is unknown for ${endpoint}: ${message}`);
        this.name = 'WriteOutcomeUnknownError';
        this.endpoint = endpoint;
        (this as Error & { cause?: unknown }).cause = cause;
    }
}

export class SiYuanClient {
    private baseUrl: string;
    private timeout: number;
    private token: string = '';

    constructor(config: SiYuanClientConfig = {}) {
        const rawBaseUrl = config.baseUrl
            || process.env.SIYUAN_API_URL
            || 'http://127.0.0.1:6806';
        this.baseUrl = rawBaseUrl.replace(/\/+$/, '');
        this.timeout = config.timeout || 5000;
    }

    setToken(token: string): void {
        this.token = token;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    getAuthHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Connection': 'close',
        };
        if (this.token) {
            headers['Authorization'] = `Token ${this.token}`;
        }
        return headers;
    }

    /** Authenticated workspace resource read, shared with the kernel adapter. */
    async requestResource(path: string): Promise<Pick<Response, 'ok' | 'status' | 'statusText' | 'text'>> {
        return this.fetchWithTimeout(`${this.baseUrl}${path}`, {
            method: 'GET', headers: this.getAuthHeaders(),
        }, 'read');
    }

    private async fetchWithTimeout(
        url: string,
        init: RequestInit,
        semantics: RequestSemantics,
    ): Promise<Response> {
        const DEFAULT_MAX_RETRIES = 3;
        const DEFAULT_RETRY_BASE_DELAY_MS = 300;
        let lastError: Error | null = null;

        const maxRetries = semantics === 'read' ? DEFAULT_MAX_RETRIES : 0;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            try {
                const response = await fetch(url, { ...init, signal: controller.signal });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    // Do not retry 4xx (except 429).
                    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                        await response.body?.cancel().catch(() => {});
                        throw Object.assign(
                            new Error(`HTTP error: ${response.status} ${response.statusText}`),
                            { retryable: false },
                        );
                    }
                    // Cancel instead of buffering an arbitrarily large error response.
                    await response.body?.cancel().catch(() => {});
                    lastError = new Error(`HTTP error: ${response.status} ${response.statusText}`);
                    throw lastError;
                }
                return response;
            } catch (error) {
                clearTimeout(timeoutId);
                if (error && typeof error === 'object' && (error as { retryable?: unknown }).retryable === false) {
                    throw error;
                }
                if (error instanceof Error && error.name === 'AbortError') {
                    lastError = new Error(`Request timeout after ${this.timeout}ms`);
                } else {
                    lastError = error instanceof Error ? error : new Error(String(error));
                }
                if (attempt >= maxRetries) throw lastError;
            }

            // Exponential backoff: 0.3s, 0.6s, 0.9s (matches siyuan-agent-bridge).
            const delay = DEFAULT_RETRY_BASE_DELAY_MS * (attempt + 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        throw lastError ?? new Error('Unknown fetch error');
    }

    private async readRemoteFile(path: string): Promise<Response> {
        return this.fetchWithTimeout(`${this.baseUrl}/api/file/getFile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
            body: JSON.stringify({ path }),
        }, 'read');
    }

    private async readData<T>(url: string, init: RequestInit, semantics: RequestSemantics, maxResponseBytes?: number): Promise<T> {
        const response = await this.fetchWithTimeout(url, init, semantics);
        let rawText: string;
        if (maxResponseBytes !== undefined) {
            const declaredSize = Number(response.headers.get('content-length'));
            if (declaredSize > maxResponseBytes) {
                await response.body?.cancel().catch(() => {});
                throw new ResponseSizeLimitError(maxResponseBytes);
            }
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let bytes = 0;
            rawText = '';
            const timer = setTimeout(() => { void reader?.cancel().catch(() => {}); }, this.timeout);
            const deadline = Date.now() + this.timeout;
            try {
                while (reader) {
                    const { done, value } = await reader.read();
                    if (Date.now() >= deadline) throw new Error(`Request timeout after ${this.timeout}ms`);
                    if (done) break;
                    bytes += value.byteLength;
                    if (bytes > maxResponseBytes) throw new ResponseSizeLimitError(maxResponseBytes);
                    rawText += decoder.decode(value, { stream: true });
                }
                rawText += decoder.decode();
            } finally {
                clearTimeout(timer);
                await reader?.cancel().catch(() => {});
                reader?.releaseLock();
            }
        } else {
            rawText = await response.text();
        }
        if (rawText.trim() === '') {
            return null as T;
        }

        let result: SiYuanResponse<T>;
        try {
            result = JSON.parse(rawText) as SiYuanResponse<T>;
        } catch {
            const snippet = rawText.length > 200 ? `${rawText.slice(0, 200)}...` : rawText;
            const status = [response.status, response.statusText].filter(Boolean).join(' ');
            throw new Error(`Invalid SiYuan API response from ${url}${status ? ` (HTTP ${status})` : ''}: ${snippet}`);
        }

        if (result.code !== 0) {
            throw new Error(`SiYuan API error: ${result.code} - ${result.msg}`);
        }

        return result.data;
    }

    async readFile(path: string): Promise<string> {
        const response = await this.readRemoteFile(path);
        return await response.text();
    }

    async readFileBinary(path: string): Promise<Uint8Array> {
        const response = await this.readRemoteFile(path);
        return new Uint8Array(await response.arrayBuffer());
    }

    /** Caller-side streaming; no filesystem access in the API layer, no replay after bytes are delivered. */
    async streamFile(path: string, consume: (chunk: Uint8Array) => Promise<void>, options: {
        signal?: AbortSignal; maxBytes?: number; timeoutMs?: number;
    } = {}): Promise<number> {
        const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
        const timeoutMs = options.timeoutMs ?? 120_000;
        const controller = new AbortController();
        const abort = () => controller.abort();
        const check = () => { if (controller.signal.aborted) throw new Error('Download cancelled or timed out'); };
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        const timer = setTimeout(abort, timeoutMs);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const cancelReader = () => { void reader?.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancelReader);
        try {
            check();
            const response = await fetch(`${this.baseUrl}/api/file/getFile`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
                body: JSON.stringify({ path }), signal: controller.signal,
            });
            // getFile errors may be HTTP 202 with a JSON envelope. Never save it as a file.
            if (response.status !== 200) {
                await response.body?.cancel().catch(() => {});
                throw new Error(`File download failed: HTTP ${response.status}`);
            }
            if (Number(response.headers.get('content-length')) > maxBytes) {
                await response.body?.cancel().catch(() => {});
                throw new ResponseSizeLimitError(maxBytes);
            }
            reader = response.body?.getReader();
            if (!reader) throw new Error('File download has no readable body');
            let bytes = 0;
            while (true) {
                check();
                const next = await reader.read();
                check();
                if (next.done) return bytes;
                bytes += next.value.byteLength;
                if (bytes > maxBytes) throw new ResponseSizeLimitError(maxBytes);
                await consume(next.value);
            }
        } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            controller.signal.removeEventListener('abort', cancelReader);
            await reader?.cancel().catch(() => {});
            reader?.releaseLock();
        }
    }

    async writeFile(path: string, content: string): Promise<void> {
        const formData = new FormData();
        const file = new File([content], 'content');
        formData.append('path', path);
        formData.append('isDir', 'false');
        formData.append('modTime', String(Date.now()));
        formData.append('file', file);

        await this.requestFormDataWrite<null>('/api/file/putFile', formData);
    }

    /** @deprecated Prefer requestFormDataRead/requestFormDataWrite. Defaults to write-safe semantics. */
    async requestFormData<T>(endpoint: string, formData: FormData): Promise<T> {
        return this.requestFormDataWrite(endpoint, formData);
    }

    async requestFormDataRead<T>(endpoint: string, formData: FormData): Promise<T> {
        return this.requestFormDataWithSemantics(endpoint, formData, 'read');
    }

    async requestFormDataWrite<T>(endpoint: string, formData: FormData): Promise<T> {
        try {
            return await this.requestFormDataWithSemantics(endpoint, formData, 'write');
        } catch (error) {
            if (isAmbiguousTransportFailure(error)) throw new WriteOutcomeUnknownError(endpoint, error);
            throw error;
        }
    }

    private async requestFormDataWithSemantics<T>(endpoint: string, formData: FormData, semantics: RequestSemantics): Promise<T> {
        // Do not set Content-Type manually for FormData: fetch must add the multipart boundary.
        return this.readData<T>(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: formData,
        }, semantics);
    }

    /** @deprecated Prefer requestRead/requestWrite. Defaults to write-safe semantics. */
    async request<T>(endpoint: string, data?: object): Promise<T> {
        return this.requestWrite(endpoint, data);
    }

    async requestRead<T>(endpoint: string, data?: object, maxResponseBytes?: number): Promise<T> {
        return this.readData<T>(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
            body: JSON.stringify(data ?? {}),
        }, 'read', maxResponseBytes);
    }

    async requestWrite<T>(endpoint: string, data?: object): Promise<T> {
        try {
            return await this.readData<T>(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
                body: JSON.stringify(data ?? {}),
            }, 'write');
        } catch (error) {
            if (isAmbiguousTransportFailure(error)) throw new WriteOutcomeUnknownError(endpoint, error);
            throw error;
        }
    }
}

function isAmbiguousTransportFailure(error: unknown): boolean {
    if (!(error instanceof Error)) return true;
    return error.message.startsWith('Request timeout')
        || !error.message.startsWith('SiYuan API error:')
            && !error.message.startsWith('HTTP error: 4');
}
