export interface SiYuanClientConfig {
    baseUrl?: string;
    timeout?: number;
}

export interface SiYuanResponse<T = any> {
    code: number;
    msg: string;
    data: T;
}

export class SiYuanClient {
    private baseUrl: string;
    private timeout: number;
    private token: string = '';

    constructor(config: SiYuanClientConfig = {}) {
        this.baseUrl = config.baseUrl || 'http://127.0.0.1:6806';
        this.timeout = config.timeout || 30000;
    }

    setToken(token: string): void {
        this.token = token;
    }

    async request<T>(endpoint: string, data?: object): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.token) {
            headers['Authorization'] = `Token ${this.token}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: data ? JSON.stringify(data) : undefined,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
            }

            const result: SiYuanResponse<T> = await response.json();

            if (result.code !== 0) {
                throw new Error(`SiYuan API error: ${result.code} - ${result.msg}`);
            }

            return result.data;
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error instanceof Error) {
                if (error.name === 'AbortError') {
                    throw new Error(`Request timeout after ${this.timeout}ms`);
                }
                throw error;
            }
            
            throw new Error('Unknown error occurred during request');
        }
    }
}
