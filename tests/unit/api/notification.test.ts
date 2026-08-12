import { describe, expect, it, vi } from 'vitest';

import { pushMsg, pushErrMsg } from '@/api/notification';

describe('notification api wrappers', () => {
    it('pushes a message notification', async () => {
        const request = vi.fn().mockResolvedValueOnce({ id: 'push-1' });
        const client = { request, requestWrite: request } as never;

        await expect(pushMsg(client, 'hello', 3000)).resolves.toEqual({ id: 'push-1' });
        expect(request).toHaveBeenCalledWith('/api/notification/pushMsg', {
            msg: 'hello',
            timeout: 3000,
        });
    });

    it('pushes an error message notification', async () => {
        const request = vi.fn().mockResolvedValueOnce({ id: 'push-2' });
        const client = { request, requestWrite: request } as never;

        await expect(pushErrMsg(client, 'error', 5000)).resolves.toEqual({ id: 'push-2' });
        expect(request).toHaveBeenCalledWith('/api/notification/pushErrMsg', {
            msg: 'error',
            timeout: 5000,
        });
    });

    it('pushes without timeout when omitted', async () => {
        const request = vi.fn().mockResolvedValueOnce({ id: 'push-3' });
        const client = { request, requestWrite: request } as never;

        await expect(pushMsg(client, 'no-timeout')).resolves.toEqual({ id: 'push-3' });
        expect(request).toHaveBeenCalledWith('/api/notification/pushMsg', {
            msg: 'no-timeout',
            timeout: undefined,
        });
    });
});
