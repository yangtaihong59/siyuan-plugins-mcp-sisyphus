import { describe, expect, it } from 'vitest';

import {
    buildDocumentTimeline,
    buildTimelinePairDiff,
    createTimelineTagName,
    createAdjacentSnapshotPairs,
    filterChangedUniqueTimelineEntries,
    formatSnapshotTime,
    isTimelineSnapshot,
    snapshotLabel,
    sortSnapshotsNewestFirst,
    TIMELINE_TAG_PREFIX,
    type TimelineEntry,
} from '@/ui/version-control/timeline';

describe('snapshot document timeline', () => {
    it('sorts tagged snapshots and creates adjacent old-to-new pairs', () => {
        const snapshots = sortSnapshotsNewestFirst([
            { id: 'old', tag: 'old', created: '2026-05-01T00:00:00Z' },
            { id: 'new', tag: 'new', created: '2026-05-03T00:00:00Z' },
            { id: 'mid', tag: 'mid', created: '2026-05-02T00:00:00Z' },
        ]);

        expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['new', 'mid', 'old']);
        expect(createAdjacentSnapshotPairs(snapshots).map((pair) => [pair.left.id, pair.right.id])).toEqual([
            ['mid', 'new'],
            ['old', 'mid'],
        ]);
    });

    it('builds a per-document timeline from adjacent tagged snapshot diffs', () => {
        const old = { id: 'old', tag: 'feat: old', created: '2026-05-01T00:00:00Z' };
        const mid = { id: 'mid', tag: 'feat: mid', created: '2026-05-02T00:00:00Z' };
        const newer = { id: 'new', tag: 'feat: new', created: '2026-05-03T00:00:00Z' };
        const pairDiffs = [
            buildTimelinePairDiff(mid, newer, {
                updatesLeft: [{ fileID: 'left-doc', title: 'Doc', path: '/nb/20260514120000-aaaaaaa.sy' }],
                updatesRight: [{ fileID: 'right-doc', title: 'Doc', path: '/nb/20260514120000-aaaaaaa.sy' }],
                addsLeft: [{ fileID: 'asset', title: 'Asset', path: '/assets/a.png' }],
            }),
            buildTimelinePairDiff(old, mid, {
                updatesLeft: [{ fileID: 'left-other', title: 'Other', path: '/nb/20260514120001-bbbbbbb.sy' }],
                updatesRight: [{ fileID: 'right-other', title: 'Other', path: '/nb/20260514120001-bbbbbbb.sy' }],
            }),
        ];

        const timeline = buildDocumentTimeline(pairDiffs);

        expect(timeline.documents.map((document) => document.title)).toEqual(['Doc', 'Other']);
        expect(timeline.entries).toHaveLength(2);
        expect(timeline.entries[0]).toMatchObject({
            documentKey: '20260514120000-aaaaaaa',
            title: 'Doc',
            kind: 'modified',
            oldFileId: 'left-doc',
            newFileId: 'right-doc',
            snapshot: { id: 'new' },
            previousSnapshot: { id: 'mid' },
        });
    });

    it('uses the plugin timeline tag namespace for filtering and display labels', () => {
        expect(createTimelineTagName('release')).toBe(`${TIMELINE_TAG_PREFIX}release`);
        expect(createTimelineTagName('release', [{ id: 'snap', tag: `${TIMELINE_TAG_PREFIX}release` }])).toMatch(/^sisyphustimelinerelease\d{14}$/);
        expect(createTimelineTagName('feat：重构文档')).toBe(`${TIMELINE_TAG_PREFIX}feat重构文档`);
        expect(isTimelineSnapshot({ id: 'snap', tag: `${TIMELINE_TAG_PREFIX}release` })).toBe(true);
        expect(isTimelineSnapshot({ id: 'snap', tag: 'release' })).toBe(false);
        expect(snapshotLabel({ id: 'snap', tag: `${TIMELINE_TAG_PREFIX}release`, memo: 'memo' })).toBe('release');
        expect(snapshotLabel({ id: 'snap', tag: 'release', memo: 'memo' })).toBe('release');
        expect(snapshotLabel({ id: 'snap', memo: 'memo' })).toBe('memo');
    });

    it('keeps only timeline-tagged snapshots before building document timelines', () => {
        const snapshots = [
            { id: 'timeline', tag: `${TIMELINE_TAG_PREFIX}release` },
            { id: 'manual', tag: 'release' },
            { id: 'untagged', memo: 'draft' },
        ];

        expect(snapshots.filter(isTimelineSnapshot).map((snapshot) => snapshot.id)).toEqual(['timeline']);
    });

    it('drops entries whose historical content is identical to current content', () => {
        const entry = createEntry('same', '2026-05-03T00:00:00Z');

        expect(filterChangedUniqueTimelineEntries([
            { entry, oldContent: 'same content', newContent: 'same content' },
        ])).toEqual([]);
    });

    it('keeps the newest timeline entry when historical contents are identical', () => {
        const oldEntry = createEntry('old', '2026-05-01T00:00:00Z');
        const newEntry = createEntry('new', '2026-05-03T00:00:00Z');
        const otherEntry = createEntry('other', '2026-05-02T00:00:00Z');

        const entries = filterChangedUniqueTimelineEntries([
            { entry: oldEntry, oldContent: 'history A', newContent: 'current' },
            { entry: newEntry, oldContent: 'history A', newContent: 'current' },
            { entry: otherEntry, oldContent: 'history B', newContent: 'current' },
        ]);

        expect(entries.map((entry) => entry.snapshot.id)).toEqual(['new', 'other']);
    });

    it('formats snapshot time using created, updated, hCreated, then raw fallback', () => {
        expect(formatSnapshotTime({ id: 'created', created: '2026-05-03T04:05:00' })).toBe('2026-05-03 04:05');
        expect(formatSnapshotTime({ id: 'updated', updated: '20260504050607' })).toBe('2026-05-04 05:06');
        expect(formatSnapshotTime({ id: 'hcreated', hCreated: '2026-05-05 06:07' })).toBe('2026-05-05 06:07');
        expect(formatSnapshotTime({ id: 'raw', created: 'not-a-date' })).toBe('not-a-date');
        expect(formatSnapshotTime({ id: 'empty' })).toBe('');
    });
});

function createEntry(id: string, created: string): TimelineEntry {
    return {
        key: id,
        documentKey: 'doc-1',
        title: 'Doc',
        kind: 'modified',
        snapshot: { id, tag: `${TIMELINE_TAG_PREFIX}${id}`, created },
        previousSnapshot: { id: `${id}-previous` },
        file: {
            key: id,
            kind: 'modified',
            title: 'Doc',
        },
        oldFileId: `${id}-old`,
        newFileId: `${id}-new`,
    };
}
