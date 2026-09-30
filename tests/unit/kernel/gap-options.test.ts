import { expect, it, vi } from 'vitest';
import { normalizeKernelOptions, isKernelOriginAllowed } from '@/core/kernel-options';
it('bounds advanced budgets and rejects wildcard/credential/path origins', () => {
    const options = normalizeKernelOptions({ readMaxMiB: 10000, readRetries: -1, readTimeoutMs: NaN, allowedOrigins: ['*', 'null', 'https://x/path', 'https://user@x', 'https://x', 'https://x'] });
    expect(options).toMatchObject({ readMaxMiB: 64, readRetries: 0, readTimeoutMs: 30000, allowedOrigins: ['https://x'] });
    expect(isKernelOriginAllowed('https://x', 'localhost:6806', options)).toBe(true);
    expect(isKernelOriginAllowed('https://x.evil', 'localhost:6806', options)).toBe(false);
    expect(isKernelOriginAllowed('http://localhost:6806', 'localhost:6806', options)).toBe(true);
    expect(isKernelOriginAllowed('null', 'localhost:6806', options)).toBe(false);
});

it('keeps Origin rules when the host URL.origin omits a non-default port', () => {
    const NativeURL = URL;
    vi.stubGlobal('URL', class extends NativeURL {
        get origin() { return `${this.protocol}//${this.hostname}`; }
    });
    try {
        const options = normalizeKernelOptions({ allowedOrigins: ['https://allowed.example:7443'] });
        expect(options.allowedOrigins).toEqual(['https://allowed.example:7443']);
        expect(isKernelOriginAllowed('http://127.0.0.1:16807', '127.0.0.1:16807', options)).toBe(true);
        expect(isKernelOriginAllowed('https://allowed.example:7443', '127.0.0.1:16807', options)).toBe(true);
        for (const origin of ['http://127.0.0.1:16808', 'http://localhost:16807', 'http://127.0.0.1:16807/', 'http://user@127.0.0.1:16807', 'http://127.0.0.1:16807?x', 'http://127.0.0.1:16807#x', 'http://127.0.0.1:80']) {
            expect(isKernelOriginAllowed(origin, '127.0.0.1:16807', options)).toBe(false);
        }
    } finally { vi.unstubAllGlobals(); }
});
