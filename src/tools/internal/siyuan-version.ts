import type { SiYuanClient } from '../../api/client';
import { getVersion } from '../../api/system';

const VERSION_CACHE = new WeakMap<SiYuanClient, Promise<string>>();

export async function getCachedSiYuanVersion(client: SiYuanClient): Promise<string> {
    const cached = VERSION_CACHE.get(client);
    if (cached) return cached;

    const pending = getVersion(client).catch((error) => {
        VERSION_CACHE.delete(client);
        throw error;
    });
    VERSION_CACHE.set(client, pending);
    return pending;
}

export function resetSiYuanVersionCacheForTests(client?: SiYuanClient): void {
    if (client) VERSION_CACHE.delete(client);
}
