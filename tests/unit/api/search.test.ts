import { describe, expect, it, vi } from 'vitest';

import { getBacklinkDoc, getBackmentionDoc, querySQL } from '@/api/search';

describe('search api wrappers', () => {
    it('preserves null backlink payloads so MCP fallback can run', async () => {
        const request = vi.fn().mockResolvedValueOnce(null);
        const client = { request, requestRead: request } as any;

        await expect(getBacklinkDoc(client, 'target-id')).resolves.toBeNull();
        expect(client.request).toHaveBeenCalledWith('/api/ref/getBacklinkDoc', {
            defID: 'target-id',
            keyword: undefined,
            refTreeID: undefined,
        });
    });

    it('preserves null backmention payloads so MCP fallback can run', async () => {
        const request = vi.fn().mockResolvedValueOnce(null);
        const client = { request, requestRead: request } as any;

        await expect(getBackmentionDoc(client, 'target-id')).resolves.toBeNull();
        expect(client.request).toHaveBeenCalledWith('/api/ref/getBackmentionDoc', {
            defID: 'target-id',
            keyword: undefined,
            refTreeID: undefined,
        });
    });

    it('normalizes null SQL payloads to an empty list', async () => {
        const request = vi.fn().mockResolvedValueOnce(null);
        const client = { request, requestRead: request } as any;

        await expect(querySQL(client, 'SELECT 1')).resolves.toEqual([]);
        expect(client.request).toHaveBeenCalledWith('/api/query/sql', {
            stmt: 'SELECT 1',
        });
    });
});
