import { describe, expect, it, vi } from 'vitest';

import { isSiYuanVersionAtLeast, numericVersionParts } from '@/shared/siyuan-version';
import { getCachedSiYuanVersion } from '@/tools/internal/siyuan-version';
import { createMockClient } from '../../helpers/mock-client';

describe('SiYuan version comparison', () => {
    it('accepts release prefixes and prerelease suffixes', () => {
        expect(numericVersionParts('v3.7.0-dev1')).toEqual([3, 7, 0]);
        expect(isSiYuanVersionAtLeast('v3.7.0-dev1', '3.7.0')).toBe(true);
        expect(isSiYuanVersionAtLeast('3.7.1', '3.7.2')).toBe(false);
        expect(isSiYuanVersionAtLeast('3.8.0', '3.7.2')).toBe(true);
        expect(isSiYuanVersionAtLeast('unknown', '3.7.0')).toBe(false);
    });

    it('caches the version request per SiYuan client', async () => {
        const request = vi.fn(async () => '3.8.0');
        const client = createMockClient({ request });

        await expect(Promise.all([
            getCachedSiYuanVersion(client),
            getCachedSiYuanVersion(client),
        ])).resolves.toEqual(['3.8.0', '3.8.0']);
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith('/api/system/version');
    });
});
