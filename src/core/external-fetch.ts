import type { ExternalResponse, SiYuanClient } from '../api/client';

/** Small explicit HTTP surface; kernel does not install a fake global fetch. */
export type { ExternalResponse };
export type ExternalFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<ExternalResponse>;
export function externalFetch(client: Pick<SiYuanClient, 'fetchExternal'>, timeoutMs = 15000): ExternalFetch {
    if (client.fetchExternal) return (url, init = {}) => client.fetchExternal!(url, init, timeoutMs);
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
