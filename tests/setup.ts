import { afterEach, vi } from 'vitest';

const originalFetch = global.fetch;

// Unit tests load the real CLI config when no --config is passed. Discovery must not
// scan local kernels or rewrite ~/.siyuan-sisyphus/config.json from those tests.
process.env.SIYUAN_DISCOVER = '0';

afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    process.env.SIYUAN_DISCOVER = '0';
});
