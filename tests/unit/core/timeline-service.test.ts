import { describe, expect, it, vi } from 'vitest';

import { removeTimelineNode } from '@/core/timeline-service';
import { serializeTimelineNodeRecords, TIMELINE_NODE_ATTR_KEY, type TimelineNodeRecord } from '@/shared/version-control/timeline';

function fakeClient(nodes: TimelineNodeRecord[], removeTag: () => Promise<unknown>) {
    const attrs: Record<string, string> = { [TIMELINE_NODE_ATTR_KEY]: serializeTimelineNodeRecords(nodes) };
    const writes: string[] = [];
    const client = {
        requestRead: vi.fn(async (endpoint: string) => {
            if (endpoint === '/api/attr/getBlockAttrs') return { ...attrs };
            throw new Error(`unexpected read ${endpoint}`);
        }),
        requestWrite: vi.fn(async (endpoint: string, data: { attrs?: Record<string, string> }) => {
            if (endpoint === '/api/attr/setBlockAttrs') {
                attrs[TIMELINE_NODE_ATTR_KEY] = data.attrs![TIMELINE_NODE_ATTR_KEY];
                writes.push(attrs[TIMELINE_NODE_ATTR_KEY]);
                return null;
            }
            if (endpoint === '/api/repo/removeRepoTagSnapshot') return removeTag();
            throw new Error(`unexpected write ${endpoint}`);
        }),
    };
    return { client: client as never, attrs, writes };
}

const legacy: TimelineNodeRecord = { name: 'old', created: 1, snapshotId: 's1', tag: 'legacy-tag', scope: 'document', source: 'legacy' };
const other: TimelineNodeRecord = { name: 'keep', created: 2, snapshotId: 's2', tag: 'sisyphus-keep', scope: 'document' };

describe('timeline service node removal', () => {
    it('removes a legacy document node that the tool API refuses', async () => {
        const { client, attrs } = fakeClient([legacy, other], async () => null);
        await removeTimelineNode(client, legacy, 'doc-1');
        expect(attrs[TIMELINE_NODE_ATTR_KEY]).toBe(serializeTimelineNodeRecords([other]));
    });

    it('restores the document index when the tag removal fails', async () => {
        const { client, attrs } = fakeClient([legacy, other], async () => { throw new Error('tag busy'); });
        await expect(removeTimelineNode(client, legacy, 'doc-1')).rejects.toThrow('tag busy');
        expect(attrs[TIMELINE_NODE_ATTR_KEY]).toBe(serializeTimelineNodeRecords([legacy, other]));
    });
});
