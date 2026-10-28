import { describe, expect, it } from 'vitest';

import {
    buildDefaultToolConfig,
    loadToolConfigForExecution,
    loadToolConfigFromApiFileWithStatus,
    UnsupportedToolConfigVersionError,
} from '@/core/config';

const clientReading = (read: () => Promise<string>) => ({ readFile: read }) as never;

describe('shared tool-config load policy', () => {
    it('fails closed for executions on an unsupported config version', async () => {
        const client = clientReading(async () => '{"avActionsVersion":99}');
        await expect(loadToolConfigForExecution(client)).rejects.toBeInstanceOf(UnsupportedToolConfigVersionError);
        const status = await loadToolConfigFromApiFileWithStatus(client);
        expect(status).toMatchObject({ ok: false, unsupportedVersion: true });
        expect(status.config.av.enabled).toBe(false);
    });

    it('keeps the last good config across an unreadable or corrupt file', async () => {
        const previous = buildDefaultToolConfig();
        previous.block.enabled = false;
        await expect(loadToolConfigForExecution(clientReading(async () => { throw new Error('fetch failed'); }), previous)).resolves.toBe(previous);
        await expect(loadToolConfigForExecution(clientReading(async () => '{not json'), previous)).resolves.toBe(previous);
        expect((await loadToolConfigForExecution(clientReading(async () => '{not json'))).block.enabled).toBe(true);
    });
});
