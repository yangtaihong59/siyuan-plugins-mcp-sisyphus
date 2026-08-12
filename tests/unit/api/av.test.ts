import { describe, expect, it, vi } from 'vitest';

import { getAttributeViewFilterSort } from '@/api/av';

describe('av api', () => {
    it('sends an empty blockID for getAttributeViewFilterSort when omitted', async () => {
        const request = vi.fn().mockResolvedValue({ filters: [], sorts: [] });
        const client = { request, requestRead: request } as never;

        await getAttributeViewFilterSort(client, { id: 'av-1' });

        expect(request).toHaveBeenCalledWith('/api/av/getAttributeViewFilterSort', {
            id: 'av-1',
            blockID: '',
        });
    });
});
