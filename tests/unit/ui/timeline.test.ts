import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    buildDocumentTimeline,
    buildTimelinePairDiff,
    createTimelineTagName,
    createAdjacentSnapshotPairs,
    canReuseLiveDocumentBlock,
    extractTimelineDocumentId,
    extractTimelineTagLabel,
    filterChangedUniqueTimelineEntries,
    formatSnapshotTime,
    isTimelineSnapshot,
    parseTimelineNodeRecords,
    selectInitialTimelineEntry,
    serializeTimelineNodeRecords,
    shouldUpdateDiffViewportState,
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

    it('uses per-document timeline tags for filtering and display labels', () => {
        const docId = '20260514120000-aaaaaaa';
        expect(createTimelineTagName('release', docId)).toBe(`${TIMELINE_TAG_PREFIX}_${docId}_release`);
        expect(createTimelineTagName('release', docId, [`${TIMELINE_TAG_PREFIX}_${docId}_release`])).toMatch(new RegExp(`^${TIMELINE_TAG_PREFIX}_${docId}_release\\d{14}$`));
        expect(createTimelineTagName('feat：重构文档', docId)).toBe(`${TIMELINE_TAG_PREFIX}_${docId}_feat重构文档`);
        // 思源 tag 名必须为合法文件名（gulu.File.IsValidFilename），分隔符不能用冒号
        expect(createTimelineTagName('release', docId)).not.toContain(':');
        expect(isTimelineSnapshot({ id: 'snap', tag: `${TIMELINE_TAG_PREFIX}_${docId}_release` })).toBe(true);
        expect(isTimelineSnapshot({ id: 'snap', tag: 'release' })).toBe(false);
        expect(snapshotLabel({ id: 'snap', tag: `${TIMELINE_TAG_PREFIX}_${docId}_release`, memo: 'memo' })).toBe('release');
        expect(snapshotLabel({ id: 'snap', tag: `${TIMELINE_TAG_PREFIX}legacy`, memo: 'memo' })).toBe('legacy');
        expect(snapshotLabel({ id: 'snap', memo: 'memo' })).toBe('memo');
    });

    it('extracts the document id and label from per-document timeline tags', () => {
        const docId = '20260514120000-aaaaaaa';
        expect(extractTimelineDocumentId(`${TIMELINE_TAG_PREFIX}_${docId}_release`)).toBe(docId);
        expect(extractTimelineDocumentId(`${TIMELINE_TAG_PREFIX}legacy`)).toBeUndefined();
        expect(extractTimelineDocumentId('release')).toBeUndefined();
        expect(extractTimelineTagLabel(`${TIMELINE_TAG_PREFIX}_${docId}_feat重构`)).toBe('feat重构');
        expect(extractTimelineTagLabel(`${TIMELINE_TAG_PREFIX}legacy`)).toBe('legacy');
        expect(extractTimelineTagLabel('release')).toBe('release');
    });

    it('round-trips timeline node records through the document attr payload', () => {
        const nodes = [
            { name: '发布 v1', created: 1710000000000, snapshotId: 'snap-a', tag: `${TIMELINE_TAG_PREFIX}_20260514120000-aaaaaaa_发布 v1` },
            { name: '重构', created: 1710000000001, snapshotId: 'snap-b' },
        ];
        expect(parseTimelineNodeRecords(serializeTimelineNodeRecords(nodes))).toEqual(nodes);
        expect(parseTimelineNodeRecords('')).toEqual([]);
        expect(parseTimelineNodeRecords('not json')).toEqual([]);
        expect(parseTimelineNodeRecords(JSON.stringify([{ name: 'bad' }]))).toEqual([]);
        expect(parseTimelineNodeRecords(JSON.stringify([{ name: 'ok', snapshotId: 's', created: 'nope' }]))[0].created).toBeGreaterThan(0);
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

    it('keeps no-change marker entries while still dropping identical content entries', () => {
        const changedEntry = createEntry('changed', '2026-05-03T00:00:00Z');
        const noChangeEntry = { ...createEntry('nochange', '2026-05-02T00:00:00Z'), noChanges: true };

        expect(filterChangedUniqueTimelineEntries([
            { entry: changedEntry, oldContent: 'same', newContent: 'same' },
            { entry: noChangeEntry, oldContent: '', newContent: '' },
        ]).map((entry) => entry.key)).toEqual(['nochange']);
    });

    it('selects the current document newest entry when opening without an existing selection', () => {
        const oldEntry = createEntry('old', '2026-05-01T00:00:00Z');
        const selectedEntry = createEntry('selected', '2026-05-03T00:00:00Z');
        const otherDocEntry = { ...createEntry('other', '2026-05-04T00:00:00Z'), documentKey: 'doc-2' };

        expect(selectInitialTimelineEntry([oldEntry, selectedEntry, otherDocEntry], 'doc-1')?.key).toBe('selected');
        expect(selectInitialTimelineEntry([oldEntry, selectedEntry, otherDocEntry], 'doc-1', 'selected')?.key).toBe('selected');
        expect(selectInitialTimelineEntry([oldEntry, selectedEntry, otherDocEntry], 'doc-3')).toBeUndefined();
    });

    it('sorts mixed-precision snapshot times with a single millisecond resolution', () => {
        // 思源 created/updated 为 epoch 毫秒（dejavu time.Now().UnixMilli()）；
        // 防御性覆盖：14 位紧凑字符串与 10 位 epoch 秒输入也统一为毫秒后排序（任何时区下顺序一致）
        const snapshots = sortSnapshotsNewestFirst([
            { id: 'epoch-ms', created: 1778803200000 },                       // 2026-05-15T00:00:00Z 毫秒
            { id: 'compact-str', created: '20260513080000' },                 // 本地 05-13 08:00（任何时区都早于其余）
            { id: 'epoch-s', created: 1778792400 },                           // 2026-05-14T21:00:00Z 秒（防御路径）
        ]);
        expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['epoch-ms', 'epoch-s', 'compact-str']);
        // 10 位秒不再被解析成 1970 年或 1784 年伪时间戳（防御生效，强断言：任何 ±14h 时区偏移下都在 05-14/05-15）
        expect(formatSnapshotTime({ id: 'epoch-s', created: 1778792400 })).toMatch(/^2026-05-1[45] /);
        // 字符串形式的纯数字 epoch（digits 分支防御）：10 位秒与 13 位毫秒统一为毫秒
        expect(formatSnapshotTime({ id: 'str-epoch-s', created: '1778792400' })).toMatch(/^2026-05-1[45] /);
        expect(formatSnapshotTime({ id: 'str-epoch-ms', created: '1778803200000' })).toMatch(/^2026-05-1[45] /);
    });

    it('formats snapshot time using created, updated, hCreated, then raw fallback', () => {
        expect(formatSnapshotTime({ id: 'created', created: '2026-05-03T04:05:00' })).toBe('2026-05-03 04:05');
        expect(formatSnapshotTime({ id: 'updated', updated: '20260504050607' })).toBe('2026-05-04 05:06');
        expect(formatSnapshotTime({ id: 'hcreated', hCreated: '2026-05-05 06:07' })).toBe('2026-05-05 06:07');
        expect(formatSnapshotTime({ id: 'raw', created: 'not-a-date' })).toBe('not-a-date');
        expect(formatSnapshotTime({ id: 'empty' })).toBe('');
    });

    it('defers automatic snapshot creation while the timeline dock is hidden', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/VersionControlPanel.svelte'), 'utf8');

        expect(source).toContain('if (shouldAutoLoadTimeline()) await loadTimeline();');
        expect(source).toContain('shouldAutoLoadTimeline() && currentDocumentId !== loadedDocumentId && !loadingSnapshots');
        expect(source).toContain('return mounted && panelVisible && currentDocumentId !== "";');
        expect(source).toContain('if (!shouldAutoLoadTimeline()) return;');
        expect(source).toContain('panelVisible = isShellVisible();');
    });

    it('keeps a collapse control in the snapshot sidebar while a diff is open', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/VersionControlPanel.svelte'), 'utf8');
        const snapshotSection = source.match(/<div class="vc-sidebar-heading vc-snapshot-heading">[\s\S]*?<textarea/);

        expect(snapshotSection?.[0]).toContain('{#if diffOpen}');
        expect(snapshotSection?.[0]).toContain('class="vc-icon-button vc-sidebar-collapse"');
        expect(snapshotSection?.[0]).toContain('on:click={toggleTimelineCollapsed}');
        expect(snapshotSection?.[0]).toContain('timeline_action_collapse');
    });

    it('drives the document timeline from per-document attrs and shows no-change nodes as markers', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/VersionControlPanel.svelte'), 'utf8');

        expect(source).toContain('const TIMELINE_NODE_ATTR_KEY = "custom-sisyphus-timeline";');
        expect(source).toContain('"/api/attr/getBlockAttrs"');
        expect(source).toContain('attrs: { [TIMELINE_NODE_ATTR_KEY]: serializeTimelineNodeRecords(nodes) }');
        expect(source).toContain('async function readTimelineNodes()');
        expect(source).toContain('async function writeTimelineNodes(nodes');
        expect(source).toContain('nodes.length === 0');
        expect(source).toContain('createNoChangeTimelineEntry(node, currentSnapshot)');
        expect(source).toContain('noChanges: true');
    });

    it('appends the new node record to the current document attr when creating a timeline node', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/VersionControlPanel.svelte'), 'utf8');
        const createNode = source.match(/async function createTimelineNode\(\) \{[\s\S]*?\n    \}/)?.[0] ?? '';

        // 创建节点 = createSnapshot → tagSnapshot（带 docId 的 tag，existingTags 收集自 timelineNodes）→ 追加节点记录 → writeTimelineNodes
        expect(createNode).toContain('"/api/repo/createSnapshot"');
        expect(createNode).toContain('createTimelineTagName(text, currentDocumentId, existingTags)');
        expect(createNode).toContain('const existingTags = timelineNodes');
        expect(createNode).toContain('nodes.push({ name: text, created: Date.now(), snapshotId: snapshot.id, tag: tagName })');
        expect(createNode).toContain('await writeTimelineNodes(nodes)');
        // 无文档时拒绝创建，避免误写全局
        expect(createNode).toContain('if (!currentDocumentId) {');
    });

    it('anchors diff scrolling to live document blocks by block id', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/VersionControlPanel.svelte'), 'utf8');

        expect(source).toContain('queueDocumentScrollSync();');
        expect(source).toContain('on:click={handleDiffClick}');
        expect(source).toContain('syncDocumentToBlockId(blockId, { force: true })');
        expect(source).toContain('shouldIgnoreDiffClick(event.target)');
        expect(source).toContain("button, input, textarea, select, a, [role='button']");
        expect(source).toContain('data-sync-block-id={getEntrySyncBlockId(item)}');
        expect(source).toContain('data-sync-block-id={getHiddenSyncBlockId(item)}');
        expect(source).toContain('document.querySelectorAll<HTMLElement>(selector)');
        expect(source).toContain('!shellElement?.contains(element)');
        expect(source).toContain('.protyle-content');
    });

    it('skips diff viewport state writes when measurements do not materially change', () => {
        const current = { top: 12.345, height: 40.005, capacity: 18 };

        expect(shouldUpdateDiffViewportState(current, { top: 12.349, height: 40.01, capacity: 18 })).toBe(false);
        expect(shouldUpdateDiffViewportState(current, { top: 12.36, height: 40.005, capacity: 18 })).toBe(true);
        expect(shouldUpdateDiffViewportState(current, { top: 12.345, height: 40.02, capacity: 18 })).toBe(true);
        expect(shouldUpdateDiffViewportState(current, { top: 12.345, height: 40.005, capacity: 19 })).toBe(true);
    });

    it('reuses a live document block only when the cached target is still valid', () => {
        const cachedBlock = { isConnected: true };
        const base = {
            blockId: 'block-a',
            cachedBlockId: 'block-a',
            cachedBlock,
            isVisible: true,
            isOutsideTimeline: true,
            isInCurrentDocument: true,
        };

        expect(canReuseLiveDocumentBlock(base)).toBe(true);
        expect(canReuseLiveDocumentBlock({ ...base, blockId: 'block-b' })).toBe(false);
        expect(canReuseLiveDocumentBlock({ ...base, cachedBlock: { isConnected: false } })).toBe(false);
        expect(canReuseLiveDocumentBlock({ ...base, isVisible: false })).toBe(false);
        expect(canReuseLiveDocumentBlock({ ...base, isOutsideTimeline: false })).toBe(false);
        expect(canReuseLiveDocumentBlock({ ...base, isInCurrentDocument: false })).toBe(false);
    });

    it('guards diff viewport raf scheduling and live block lookup caches in the panel source', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/VersionControlPanel.svelte'), 'utf8');

        expect(source).toContain('let diffViewportFrame = 0;');
        expect(source).toContain('if (diffViewportFrame) return;');
        expect(source).toContain('cancelDiffViewportUpdate();');
        expect(source).toContain('if (!shouldUpdateDiffViewportState(current, next)) return;');
        expect(source).toContain('if (!blockId || blockId === lastDiffAnchorBlockId) return;');
        expect(source).toContain('canReuseLiveDocumentBlock({');
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
