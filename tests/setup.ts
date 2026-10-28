import { afterEach, vi } from 'vitest';

const originalFetch = global.fetch;

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
