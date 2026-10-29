import { describe, expect, it, vi } from 'vitest';

import { loadWriteCoordinatorSettings } from '@/core/write-coordinator-settings';
import { supportsKernelEndpoint } from '@/shared/siyuan-version';
import { callCliWriteCoordinator } from '@/core/write-coordinator-client';

function clientFor(settings: Record<string, unknown>, version: () => Promise<string>) {
    return {
        getBaseUrl: () => 'http://127.0.0.1:6806',
        readFile: vi.fn(async () => JSON.stringify(settings)),
        requestRead: vi.fn(async (path: string) => {
            if (path === '/api/system/version') return version();
            throw new Error(`unexpected ${path}`);
        }),
    } as never;
}

describe('kernel endpoint version gate', () => {
    it('needs SiYuan 3.7.0, the first release with the kernel plugin system', () => {
        expect(supportsKernelEndpoint('3.1.32')).toBe(false);
        expect(supportsKernelEndpoint('3.6.5')).toBe(false);
        expect(supportsKernelEndpoint('3.7.0')).toBe(true);
        expect(supportsKernelEndpoint('3.8.8')).toBe(true);
    });

    it('keeps the kernel owner but marks it unsupported on an old SiYuan, without choosing another owner', async () => {
        const settings = await loadWriteCoordinatorSettings(clientFor({ enabled: true, kernelEndpointEnabled: true }, async () => '3.1.32'));
        expect(settings?.owner).toBe('kernel');
        expect(settings?.unsupportedReason).toMatch(/SiYuan 3\.1\.32 cannot host it \(requires SiYuan 3\.7\.0/);

        const result = await callCliWriteCoordinator(settings, 'document', { action: 'create' });
        const payload = JSON.parse(result.content[0].text);
        expect(payload).toMatchObject({ success: false, writeAttempted: false, error: { code: 'kernel_endpoint_unsupported' } });
    });

    it('leaves supported or unknown versions on the normal path', async () => {
        const supported = await loadWriteCoordinatorSettings(clientFor({ kernelEndpointEnabled: true }, async () => '3.8.8'));
        expect(supported?.unsupportedReason).toBeUndefined();
        const unknown = await loadWriteCoordinatorSettings(clientFor({ kernelEndpointEnabled: true }, async () => { throw new Error('offline'); }));
        expect(unknown).toMatchObject({ owner: 'kernel' });
        expect(unknown?.unsupportedReason).toBeUndefined();
        const node = await loadWriteCoordinatorSettings(clientFor({ enabled: true, kernelEndpointEnabled: false }, async () => '3.1.32'));
        expect(node).toMatchObject({ owner: 'node' });
        expect(node?.unsupportedReason).toBeUndefined();
    });
});
