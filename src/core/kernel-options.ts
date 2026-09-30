/** Advanced plugin options persisted inside mcpHttpSettings.kernelOptions. */
export interface KernelOptions {
    readMaxRequests: number;
    readMaxMiB: number;
    readTimeoutMs: number;
    readRetries: number;
    templateMaxMiB: number;
    allowedOrigins: string[];
}
// SiYuan 3.8.5's goja URL.origin omits non-default ports. The parsed
// protocol and host retain the canonical authority in both Node and goja.
const parsedOrigin = (url: URL) => `${url.protocol}//${url.host}`;
export function normalizeKernelOptions(raw: unknown): KernelOptions {
    const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const number = (key: string, fallback: number, min: number, max: number) =>
        typeof obj[key] === 'number' && Number.isFinite(obj[key]) ? Math.max(min, Math.min(max, Math.floor(obj[key] as number))) : fallback;
    return {
        readMaxRequests: number('readMaxRequests', 128, 16, 512),
        readMaxMiB: number('readMaxMiB', 8, 1, 64),
        readTimeoutMs: number('readTimeoutMs', 30000, 1000, 120000),
        readRetries: number('readRetries', 3, 0, 3),
        templateMaxMiB: number('templateMaxMiB', 16, 1, 32),
        allowedOrigins: Array.isArray(obj.allowedOrigins) ? [...new Set(obj.allowedOrigins.filter((v): v is string => {
            if (typeof v !== 'string') return false;
            try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && parsedOrigin(u) === v && !u.username && !u.password; }
            catch { return false; }
        }))].slice(0, 32) : [],
    };
}
export function isKernelOriginAllowed(origin: string, host: string, options: KernelOptions): boolean {
    if (!origin) return true;
    try {
        const url = new URL(origin);
        return ['http:', 'https:'].includes(url.protocol) && parsedOrigin(url) === origin
            && (url.host === host || options.allowedOrigins.includes(origin));
    } catch { return false; }
}
