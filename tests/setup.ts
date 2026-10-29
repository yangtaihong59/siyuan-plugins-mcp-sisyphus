import { afterEach, vi } from 'vitest';

// Unmocked requests to the default SiYuan port must fail fast: on a developer
// machine 127.0.0.1:6806 is usually a real workspace (or a tunnel to one).
const realFetch = global.fetch;
const originalFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.port === '6806') throw new TypeError(`fetch failed: unit tests may not reach a live SiYuan (${url.origin}); mock fetch instead.`);
    return realFetch(input, init);
};
global.fetch = originalFetch;

// Automated tests must never inherit a real SiYuan/MCP connection from the shell
// (e.g. SIYUAN_API_URL exported for live acceptance runs): fetch mocks only match
// the default http://127.0.0.1:6806 endpoint. Tests that need these set them explicitly.
for (const key of Object.keys(process.env)) {
    if (key.startsWith('SIYUAN_')) delete process.env[key];
}

// Unit tests load the real CLI config when no --config is passed. Discovery must not
// scan local kernels or rewrite ~/.siyuan-sisyphus/config.json from those tests.
process.env.SIYUAN_DISCOVER = '0';

afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    process.env.SIYUAN_DISCOVER = '0';
});
