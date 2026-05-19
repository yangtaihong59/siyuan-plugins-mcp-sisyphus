import type { SiYuanResponse } from '../types/shared';

export interface SiYuanClientConfig {
    baseUrl?: string;
    timeout?: number;
}

export type { SiYuanResponse } from '../types/shared';

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

    private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
        const DEFAULT_MAX_RETRIES = 3;
        const DEFAULT_RETRY_BASE_DELAY_MS = 300;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            try {
                const response = await fetch(url, { ...init, signal: controller.signal });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    // Do not retry 4xx (except 429).
                    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                        throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
                    }
                    // 5xx / 429 — drain body so the connection can be reused, then retry.
                    await response.arrayBuffer().catch(() => {});
                    lastError = new Error(`HTTP error: ${response.status} ${response.statusText}`);
                    if (attempt < DEFAULT_MAX_RETRIES) continue;
                    throw lastError;
                }
                return response;
            } catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === 'AbortError') {
                    lastError = new Error(`Request timeout after ${this.timeout}ms`);
                } else {
                    lastError = error instanceof Error ? error : new Error(String(error));
                }
                if (attempt >= DEFAULT_MAX_RETRIES) throw lastError;
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
        });
    }

    private async readData<T>(url: string, init: RequestInit): Promise<T> {
        const response = await this.fetchWithTimeout(url, init);
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

        await this.requestFormData<null>('/api/file/putFile', formData);
    }

    async requestFormData<T>(endpoint: string, formData: FormData): Promise<T> {
        // Do not set Content-Type manually for FormData: fetch must add the multipart boundary.
        return this.readData<T>(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: formData,
        });
    }

    async request<T>(endpoint: string, data?: object): Promise<T> {
        return this.readData<T>(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
            body: JSON.stringify(data ?? {}),
        });
    }
}
