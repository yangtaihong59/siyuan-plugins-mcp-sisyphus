/** Small explicit HTTP surface; kernel does not install a fake global fetch. */
export interface ExternalResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
}
export type ExternalFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<ExternalResponse>;
export function externalFetch(client: object, timeoutMs = 15000): ExternalFetch {
    const adapter = client as { fetchExternal?: (url: string, init: unknown, timeoutMs: number) => Promise<ExternalResponse> };
    if (typeof adapter.fetchExternal === 'function') return (url, init = {}) => adapter.fetchExternal!(url, init, timeoutMs);
    return async (url, init = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { ...init, signal: controller.signal });
            // Include body consumption in the timeout, as the kernel proxy does.
            const text = await response.text();
            return { ok: response.ok, status: response.status, text: async () => text };
        } finally { clearTimeout(timer); }
    };
}
