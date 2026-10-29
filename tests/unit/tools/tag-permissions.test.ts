import { beforeEach, describe, expect, it, vi } from 'vitest';

import { callTagTool } from '@/tools/tag';

vi.mock('@/api/tag', () => ({
    listTags: vi.fn(),
    renameTag: vi.fn(),
    removeTag: vi.fn(),
}));

vi.mock('@/api/notebook', () => ({
    listNotebooks: vi.fn(async () => ({ notebooks: [{ id: 'nb-x', name: 'Archive', closed: true }] })),
}));

vi.mock('@/api/search', () => ({
    querySQL: vi.fn(),
    searchTag: vi.fn(),
}));

const enabled = { enabled: true, actions: { list: true, rename: true, remove: true } } as never;

function permissions(writable: (box: string) => boolean) {
    return {
        reload: vi.fn(async () => undefined),
        canRead: vi.fn(() => true),
        canWrite: vi.fn(writable),
        canDelete: vi.fn(writable),
        get: vi.fn(() => 'r'),
    } as never;
}

describe('tag write permissions', () => {
    beforeEach(async () => {
        const tagApi = await import('@/api/tag');
        const searchApi = await import('@/api/search');
        vi.mocked(tagApi.renameTag).mockReset().mockResolvedValue(null);
        vi.mocked(tagApi.removeTag).mockReset().mockResolvedValue(null);
        vi.mocked(searchApi.querySQL).mockReset().mockResolvedValue([{ box: 'nb-open' }, { box: 'nb-locked' }]);
    });

    it.each([
        ['rename', { action: 'rename', oldLabel: "it's", newLabel: 'b' }],
        ['remove', { action: 'remove', label: "it's" }],
    ] as const)('%s is refused when any notebook carrying the tag is read-only', async (action, args) => {
        const tagApi = await import('@/api/tag');
        const searchApi = await import('@/api/search');
        const client = { requestWrite: vi.fn() } as never;

        const result = await callTagTool(client, args, enabled, permissions((box) => box !== 'nb-locked'));

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('nb-locked');
        expect(vi.mocked(action === 'rename' ? tagApi.renameTag : tagApi.removeTag)).not.toHaveBeenCalled();
        // The label is escaped and sub-tags are covered.
        expect(vi.mocked(searchApi.querySQL).mock.calls[0][1]).toContain("content = 'it''s'");
        expect(vi.mocked(searchApi.querySQL).mock.calls[0][1]).toContain("'it''s/'");
    });

    it('runs when every carrying notebook is writable', async () => {
        const tagApi = await import('@/api/tag');
        const client = { requestWrite: vi.fn(), requestRead: vi.fn() } as never;

        const result = await callTagTool(client, { action: 'rename', oldLabel: 'a', newLabel: 'b' }, enabled, permissions(() => true));

        expect(result.isError).toBeFalsy();
        expect(vi.mocked(tagApi.renameTag)).toHaveBeenCalledWith(client, 'a', 'b');
    });

    it('reports zero affected blocks and closed notebooks instead of a silent success', async () => {
        const searchApi = await import('@/api/search');
        vi.mocked(searchApi.querySQL).mockResolvedValueOnce([]);
        const client = { requestWrite: vi.fn(), requestRead: vi.fn() } as never;

        const result = await callTagTool(client, { action: 'rename', oldLabel: 'a', newLabel: 'b' }, enabled, permissions(() => true));
        const payload = JSON.parse(result.content[0].text);

        expect(payload.count).toBe(0);
        expect(payload.warning).toContain('nothing was changed');
        expect(payload.warning).toContain('Archive');
    });
});
