import { fetchPost } from 'siyuan';

import type { SiYuanClient } from '../../api/client';
import { SiYuanRequestError } from '../../api/errors';

/**
 * SiYuanClient over the renderer's authenticated `fetchPost`, so UI panels
 * run the same core services (e.g. core/timeline-service) as the tools.
 * Only JSON endpoints are available; the error message stays SiYuan's own
 * text because panels show it to the user as-is.
 */
function post<T>(endpoint: string, data: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
        fetchPost(endpoint, data, (response: { code: number; msg?: string; data: T }) => {
            if (response?.code === 0) resolve(response.data);
            else reject(new SiYuanRequestError('api', response?.msg || `SiYuan API error from ${endpoint}`, {
                apiCode: typeof response?.code === 'number' ? response.code : undefined,
            }));
        });
    });
}

function unavailable(member: string): () => Promise<never> {
    return () => Promise.reject(new Error(`${member} is not available in the renderer client`));
}

export const rendererClient: SiYuanClient = {
    setToken: () => {},
    getBaseUrl: () => '',
    getAuthHeaders: () => ({}),
    requestRead: post,
    requestWrite: post,
    requestResource: unavailable('requestResource'),
    requestFormDataRead: unavailable('requestFormDataRead'),
    requestFormDataWrite: unavailable('requestFormDataWrite'),
    readFile: unavailable('readFile'),
    readFileBinary: unavailable('readFileBinary'),
    writeFile: unavailable('writeFile'),
};

/** Raw JSON call for panel reads that have no api/ wrapper. */
export const rendererPost = post;
