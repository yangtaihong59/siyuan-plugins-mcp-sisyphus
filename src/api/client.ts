import type { SiYuanResponse } from '../types/shared';

export interface SiYuanClientConfig {
    baseUrl?: string;
    timeout?: number;
}

export type { SiYuanResponse } from '../types/shared';

export type RequestSemantics = 'read' | 'write';

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
                        throw Object.assign(
                            new Error(`HTTP error: ${response.status} ${response.statusText}`),
                            { retryable: false },
                        );
                    }
                    // 5xx / 429 — drain body so the connection can be reused, then retry.
                    await response.arrayBuffer().catch(() => {});
                    lastError = new Error(`HTTP error: ${response.status} ${response.statusText}`);
                    if (attempt < maxRetries) continue;
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

    private async readData<T>(url: string, init: RequestInit, semantics: RequestSemantics): Promise<T> {
        const response = await this.fetchWithTimeout(url, init, semantics);
        const rawText = await response.text();
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

    async requestRead<T>(endpoint: string, data?: object): Promise<T> {
        return this.readData<T>(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
            body: JSON.stringify(data ?? {}),
        }, 'read');
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
