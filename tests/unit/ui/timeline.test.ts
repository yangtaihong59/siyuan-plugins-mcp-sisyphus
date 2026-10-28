import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    buildDocumentTimeline,
    buildTimelinePairDiff,
    createGlobalTimelineTagName,
    createTimelineNodeRecord,
    createTimelineTagName,
    createAdjacentSnapshotPairs,
    canReuseLiveDocumentBlock,
    extractTimelineDocumentId,
    extractTimelineTagLabel,
    filterChangedUniqueTimelineEntries,
    formatSnapshotTime,
    getTimelineNodeSelectionKey,
    isGlobalTimelineTag,
    isTimelineSnapshot,
    isTimelineNodeRecordPayloadValid,
    migrateLegacyTimelineSnapshotToGlobal,
    parseTimelineNodeRecords,
    reconcileDocumentTimelineNodes,
    selectInitialTimelineEntry,
    serializeTimelineNodeRecords,
    shouldUpdateDiffViewportState,
    snapshotLabel,
    sortSnapshotsNewestFirst,
    sortTimelineNodesNewestFirst,
    GLOBAL_TIMELINE_TAG_PREFIX,
    GLOBAL_TIMELINE_TAG_VERIFICATION_ERROR,
    TIMELINE_TAG_PREFIX,
    type TimelineEntry,
} from '@/shared/version-control/timeline';

describe('snapshot document timeline', () => {
    it('builds stable document-scoped selection keys and sorts mixed-scope nodes', () => {
        const selection = {
            documentId: 'doc-a',
            documentTitle: 'Doc A',
            node: { name: 'global', created: 3, snapshotId: 'snapshot-g', tag: 'sisyphustimeline_global_global', scope: 'global' as const },
        };

        expect(getTimelineNodeSelectionKey(selection)).toContain('doc-a');
        expect(getTimelineNodeSelectionKey(null)).toBe('');
        expect(sortTimelineNodesNewestFirst([
            { name: 'document', created: 1, snapshotId: 'snapshot-d', scope: 'document' },
            selection.node,
        ]).map((node) => node.name)).toEqual(['global', 'document']);
    });

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

    it('creates and parses document, global, and legacy timeline tags safely', () => {
        const docId = '20260514120000-aaaaaaa';
        expect(createTimelineTagName('release', docId)).toBe(`${TIMELINE_TAG_PREFIX}_${docId}_release`);
        expect(createTimelineTagName('release', docId, [`${TIMELINE_TAG_PREFIX}_${docId}_release`])).toMatch(new RegExp(`^${TIMELINE_TAG_PREFIX}_${docId}_release\\d{14}$`));
        expect(createTimelineTagName('feat：重构文档', docId)).toBe(`${TIMELINE_TAG_PREFIX}_${docId}_feat重构文档`);
        expect(createGlobalTimelineTagName('release')).toBe(`${GLOBAL_TIMELINE_TAG_PREFIX}release`);
        expect(createGlobalTimelineTagName('release', [`${GLOBAL_TIMELINE_TAG_PREFIX}release`])).toMatch(new RegExp(`^${GLOBAL_TIMELINE_TAG_PREFIX}release\\d{14}$`));
        expect(createGlobalTimelineTagName('<feat>：重构/文档?*')).toBe(`${GLOBAL_TIMELINE_TAG_PREFIX}feat重构文档`);
        // 思源 tag 名必须为合法文件名（gulu.File.IsValidFilename），分隔符不能用冒号
        expect(createTimelineTagName('release', docId)).not.toContain(':');
        expect(createGlobalTimelineTagName('<>:"/\\|?*')).not.toMatch(/[<>:"/\\|?*]/);
        expect(isGlobalTimelineTag(`${GLOBAL_TIMELINE_TAG_PREFIX}release`)).toBe(true);
        expect(isGlobalTimelineTag(`${TIMELINE_TAG_PREFIX}_${docId}_release`)).toBe(false);
        expect(isTimelineSnapshot({ id: 'snap', tag: `${TIMELINE_TAG_PREFIX}_${docId}_release` })).toBe(true);
        expect(isTimelineSnapshot({ id: 'snap', tag: 'release' })).toBe(false);
        expect(snapshotLabel({ id: 'snap', tag: `${TIMELINE_TAG_PREFIX}_${docId}_release`, memo: 'memo' })).toBe('release');
        expect(snapshotLabel({ id: 'snap', tag: `${GLOBAL_TIMELINE_TAG_PREFIX}release`, memo: 'memo' })).toBe('release');
        expect(snapshotLabel({ id: 'snap', tag: `${TIMELINE_TAG_PREFIX}legacy`, memo: 'memo' })).toBe('legacy');
        expect(snapshotLabel({ id: 'snap', memo: 'memo' })).toBe('memo');
    });

    it('extracts the document id and label from per-document timeline tags', () => {
        const docId = '20260514120000-aaaaaaa';
        expect(extractTimelineDocumentId(`${TIMELINE_TAG_PREFIX}_${docId}_release`)).toBe(docId);
        expect(extractTimelineDocumentId(`${GLOBAL_TIMELINE_TAG_PREFIX}release`)).toBeUndefined();
        expect(extractTimelineDocumentId(`${TIMELINE_TAG_PREFIX}legacy`)).toBeUndefined();
        expect(extractTimelineDocumentId('release')).toBeUndefined();
        expect(extractTimelineTagLabel(`${TIMELINE_TAG_PREFIX}_${docId}_feat重构`)).toBe('feat重构');
        expect(extractTimelineTagLabel(`${GLOBAL_TIMELINE_TAG_PREFIX}feat重构`)).toBe('feat重构');
        expect(extractTimelineTagLabel(`${TIMELINE_TAG_PREFIX}legacy`)).toBe('legacy');
        expect(extractTimelineTagLabel('release')).toBe('release');
    });

    it('round-trips timeline node records through the document attr payload', () => {
        const nodes = [
            { name: '发布 v1', created: 1710000000000, snapshotId: 'snap-a', tag: `${TIMELINE_TAG_PREFIX}_20260514120000-aaaaaaa_发布 v1`, scope: 'document' as const },
            { name: '重构', created: 1710000000001, snapshotId: 'snap-b', scope: 'document' as const, source: 'legacy' as const },
        ];
        expect(parseTimelineNodeRecords(serializeTimelineNodeRecords(nodes))).toEqual(nodes);
        expect(parseTimelineNodeRecords('')).toEqual([]);
        expect(parseTimelineNodeRecords('not json')).toEqual([]);
        expect(parseTimelineNodeRecords(JSON.stringify([{ name: 'bad' }]))).toEqual([]);
        expect(parseTimelineNodeRecords(JSON.stringify([{ name: 'ok', snapshotId: 's', created: 'nope' }]))[0].created).toBeGreaterThan(0);
        expect(parseTimelineNodeRecords(JSON.stringify([{ name: 'old', snapshotId: 's', created: 1 }]))[0].scope).toBe('document');
        expect(isTimelineNodeRecordPayloadValid(serializeTimelineNodeRecords(nodes))).toBe(true);
        expect(isTimelineNodeRecordPayloadValid('')).toBe(true);
        expect(isTimelineNodeRecordPayloadValid('not json')).toBe(false);
        expect(isTimelineNodeRecordPayloadValid(JSON.stringify([nodes[0], { name: 'bad' }]))).toBe(false);
    });

    it('recovers document-scoped tags into attrs and keeps unowned tags in the legacy archive', () => {
        const docId = '20260514120000-aaaaaaa';
        const existing = {
            name: '已有节点',
            created: 1710000000000,
            snapshotId: 'snap-existing',
            tag: `${TIMELINE_TAG_PREFIX}_${docId}_existing`,
            scope: 'document' as const,
        };
        const result = reconcileDocumentTimelineNodes(docId, [existing], [
            { id: 'snap-existing', tag: existing.tag, created: 1710000000000 },
            { id: 'snap-recovered', tag: `${TIMELINE_TAG_PREFIX}_${docId}_recovered`, created: 1710000001000 },
            { id: 'snap-foreign', tag: `${TIMELINE_TAG_PREFIX}_20260514120001-bbbbbbb_foreign`, created: 1710000002000 },
            { id: 'snap-legacy', tag: `${TIMELINE_TAG_PREFIX}legacy`, created: 1710000003000 },
            { id: 'snap-root', tag: `${TIMELINE_TAG_PREFIX}root`, created: 1710000004000 },
            { id: 'snap-manual', tag: 'manual', created: 1710000005000 },
        ]);

        expect(result.recoveredCount).toBe(1);
        expect(result.documentNodes).toEqual([
            existing,
            createTimelineNodeRecord({
                id: 'snap-recovered',
                tag: `${TIMELINE_TAG_PREFIX}_${docId}_recovered`,
                created: 1710000001000,
            }),
        ]);
        expect(result.legacySnapshots.map((snapshot) => snapshot.id)).toEqual(['snap-legacy']);
        expect(result.globalNodes).toEqual([]);
        expect(result.attrChanged).toBe(true);
    });

    it('keeps linked legacy nodes in the archive so they can be linked to other documents', () => {
        const legacy = {
            id: 'snap-legacy',
            tag: `${TIMELINE_TAG_PREFIX}legacy`,
            created: 1710000000000,
        };
        const linked = createTimelineNodeRecord(legacy, 'document', 'legacy');
        const result = reconcileDocumentTimelineNodes('20260514120000-aaaaaaa', [linked], [legacy]);

        expect(result.documentNodes).toEqual([linked]);
        expect(result.legacySnapshots).toEqual([legacy]);
        expect(result.recoveredCount).toBe(0);
    });

    it('includes global nodes for every document and ignores other document tags', () => {
        const global = { id: 'snap-global', tag: `${GLOBAL_TIMELINE_TAG_PREFIX}release`, created: 1710000003000 };
        const tags = [
            global,
            { id: 'snap-a', tag: `${TIMELINE_TAG_PREFIX}_20260514120000-aaaaaaa_A`, created: 1710000001000 },
            { id: 'snap-b', tag: `${TIMELINE_TAG_PREFIX}_20260514120001-bbbbbbb_B`, created: 1710000002000 },
        ];
        const resultA = reconcileDocumentTimelineNodes('20260514120000-aaaaaaa', [], tags);
        const resultB = reconcileDocumentTimelineNodes('20260514120001-bbbbbbb', [], tags);

        expect(resultA.globalNodes).toEqual([createTimelineNodeRecord(global, 'global')]);
        expect(resultB.globalNodes).toEqual([createTimelineNodeRecord(global, 'global')]);
        expect(resultA.documentNodes.map((node) => node.name)).toEqual(['A']);
        expect(resultB.documentNodes.map((node) => node.name)).toEqual(['B']);
    });

    it('lets a converted global node override and clean legacy document links', () => {
        const legacy = { id: 'snap-shared', tag: `${TIMELINE_TAG_PREFIX}release`, created: 1710000000000 };
        const linked = createTimelineNodeRecord(legacy, 'document', 'legacy');
        const global = { ...legacy, tag: `${GLOBAL_TIMELINE_TAG_PREFIX}release` };
        const result = reconcileDocumentTimelineNodes('20260514120000-aaaaaaa', [linked], [legacy, global]);

        expect(result.documentNodes).toEqual([]);
        expect(result.globalNodes).toEqual([createTimelineNodeRecord(global, 'global')]);
        expect(result.legacySnapshots).toEqual([]);
        expect(result.attrChanged).toBe(true);
    });

    it('verifies a new global tag before removing the legacy tag', async () => {
        const calls: string[] = [];
        const legacy = { id: 'snap-legacy', tag: `${TIMELINE_TAG_PREFIX}release` };
        const result = await migrateLegacyTimelineSnapshotToGlobal(legacy, [], {
            addTag: async (_id, tag) => { calls.push(`add:${tag}`); },
            readTaggedSnapshots: async () => {
                calls.push('verify');
                return [{ ...legacy, tag: `${GLOBAL_TIMELINE_TAG_PREFIX}release` }];
            },
            removeTag: async (tag) => { calls.push(`remove:${tag}`); },
        });

        expect(result).toEqual({ globalTag: `${GLOBAL_TIMELINE_TAG_PREFIX}release`, oldTagRemoved: true });
        expect(calls).toEqual([
            `add:${GLOBAL_TIMELINE_TAG_PREFIX}release`,
            'verify',
            `remove:${TIMELINE_TAG_PREFIX}release`,
        ]);
    });

    it('never removes the legacy tag when global creation or verification fails', async () => {
        const legacy = { id: 'snap-legacy', tag: `${TIMELINE_TAG_PREFIX}release` };
        let removeCalls = 0;
        const actions = {
            addTag: async () => undefined,
            readTaggedSnapshots: async () => [],
            removeTag: async () => { removeCalls += 1; },
        };

        await expect(migrateLegacyTimelineSnapshotToGlobal(legacy, [], actions))
            .rejects.toThrow(GLOBAL_TIMELINE_TAG_VERIFICATION_ERROR);
        expect(removeCalls).toBe(0);
        await expect(migrateLegacyTimelineSnapshotToGlobal(legacy, [], {
            ...actions,
            addTag: async () => { throw new Error('tag failed'); },
        })).rejects.toThrow('tag failed');
        expect(removeCalls).toBe(0);
    });

    it('keeps both tags protected when removing the legacy tag fails', async () => {
        const legacy = { id: 'snap-legacy', tag: `${TIMELINE_TAG_PREFIX}release` };
        const result = await migrateLegacyTimelineSnapshotToGlobal(legacy, [], {
            addTag: async () => undefined,
            readTaggedSnapshots: async () => [{ ...legacy, tag: `${GLOBAL_TIMELINE_TAG_PREFIX}release` }],
            removeTag: async () => { throw new Error('remove failed'); },
        });

        expect(result.oldTagRemoved).toBe(false);
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

    it('keeps every explicit timeline node when historical contents are identical', () => {
        const oldEntry = createEntry('old', '2026-05-01T00:00:00Z');
        const newEntry = createEntry('new', '2026-05-03T00:00:00Z');
        const otherEntry = createEntry('other', '2026-05-02T00:00:00Z');

        const entries = filterChangedUniqueTimelineEntries([
            { entry: oldEntry, oldContent: 'history A', newContent: 'current' },
            { entry: newEntry, oldContent: 'history A', newContent: 'current' },
            { entry: otherEntry, oldContent: 'history B', newContent: 'current' },
        ]);

        expect(entries.map((entry) => entry.snapshot.id)).toEqual(['new', 'other', 'old']);
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

    it('loads only snapshot metadata in the left panel', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/SnapshotPanel.svelte'), 'utf8');
        const loadSnapshots = source.slice(
            source.indexOf('async function loadSnapshots()'),
            source.indexOf('async function readTimelineTagSnapshots'),
        );

        expect(loadSnapshots).toContain('readTimelineNodes(documentId)');
        expect(loadSnapshots).toContain('readTimelineTagSnapshots()');
        expect(loadSnapshots).not.toContain('createSnapshot');
        expect(loadSnapshots).not.toContain('diffRepoSnapshots');
        expect(loadSnapshots).not.toContain('openRepoSnapshotFile');
    });

    it('uses compact collapsible sections in the snapshot panel without combined sidebar logic', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/SnapshotPanel.svelte'), 'utf8');

        expect(source).toContain('snapshot_action_collapse_all');
        expect(source).toContain('snapshot_create_section_title');
        expect(source).toContain('timeline_section_title');
        expect(source).toContain('timeline_legacy_section_title');
        expect(source).not.toContain('autoTimelineCollapsed');
        expect(source).not.toContain('vc-sidebar');
    });

    it('calculates only the selected node in the diff panel and refreshes only that selection after restore', () => {
        const source = ['src/ui/version-control/VersionDiffPanel.svelte', 'src/ui/version-control/version-diff-logic.ts'].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');
        const loadSelection = source.slice(
            source.indexOf('async function loadSelection('),
            source.indexOf('function snapshotFromSelection'),
        );

        expect(loadSelection).toContain('currentSnapshot = await createCurrentSnapshot()');
        expect(loadSelection.match(/diffRepoSnapshots/g)).toHaveLength(1);
        expect(source).toContain('await refreshSelectedDiff();');
        expect(source).toContain('diff_empty_select_snapshot');
        expect(source).toContain('on:click={onOpenSnapshot}');
        expect(source).not.toContain('<aside');
        expect(source).not.toContain('autoTimelineCollapsed');
    });

    it('drives the document timeline from per-document attrs and shows no-change nodes as markers', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/SnapshotPanel.svelte'), 'utf8');
        const diffSource = ['src/ui/version-control/VersionDiffPanel.svelte', 'src/ui/version-control/version-diff-logic.ts'].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');

        // The per-document node index is read and written only by core/timeline-service.
        expect(source).toContain('return readDocumentNodes(client, documentId);');
        expect(source).toContain('return writeDocumentNodes(client, documentId, nodes);');
        expect(source).not.toContain('"/api/attr/setBlockAttrs"');
        expect(source).toContain('function readTimelineNodes(documentId: string)');
        expect(source).toContain('function writeTimelineNodes(nodes');
        expect(source).toContain('sortTimelineNodesNewestFirst');
        expect(diffSource).toContain('createNoChangeTimelineEntry(nextSelection, currentSnapshot)');
        expect(diffSource).toContain('if (node.snapshotId === currentSnapshot.id)');
        expect(diffSource).toContain('if (oldContent === newContent)');
        expect(diffSource).toContain('noChanges: true');
    });

    it('reconciles scoped tags and exposes legacy tags for explicit document association', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/SnapshotPanel.svelte'), 'utf8');

        expect(source).toContain('reconcileDocumentTimelineNodes(');
        expect(source).toContain('reconciliation.attrChanged');
        expect(source).toContain('await writeTimelineNodes(documentNodes, documentId)');
        expect(source).toContain('async function associateLegacySnapshot(snapshot: Snapshot)');
        expect(source).toContain('createTimelineNodeRecord(snapshot, "document", "legacy")');
        expect(source).toContain('timeline_confirm_link_legacy_node');
        expect(source).toContain('timeline_legacy_section_title');
        expect(source).toContain('timeline_action_link_legacy_node');
        expect(source).toContain('async function convertLegacySnapshotToGlobal(snapshot: Snapshot)');
        expect(source).toContain('migrateLegacyTimelineSnapshotToGlobal(snapshot, existingTags');
        expect(source).toContain('removeRepoTagSnapshot');
    });

    it('creates document or global nodes according to the non-persistent scope selector', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/SnapshotPanel.svelte'), 'utf8');
        const createNode = source.match(/async function createTimelineNode\(\) \{[\s\S]*?\n    \}/)?.[0] ?? '';

        // 文档节点写 attrs；全局节点只写 global tag——都由 core/timeline-service 完成。
        expect(createNode).toContain('await createTimelineNodeRecordInRepo(client, {');
        expect(createNode).toContain('scope: createScope,');
        expect(createNode).toContain('...(createScope === "document" ? { documentId: currentDocumentId } : {})');
        expect(createNode).toContain('if (created.partialFailure)');
        expect(createNode).not.toContain('"/api/repo/createSnapshot"');
        expect(source).toContain('let createScope: TimelineNodeScope = "document";');
        expect(source).toContain('class:active={createScope === "global"}');
        expect(source).toContain('class="snapshot-badge"');
        expect(createNode).toContain('if (!currentDocumentId) {');
        expect(createNode).not.toContain('onSelectNode(');
    });

    it('deletes a timeline node tag without deleting the underlying snapshot', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/ui/version-control/SnapshotPanel.svelte'), 'utf8');
        const deleteNode = source.slice(
            source.indexOf('async function deleteTimelineNode('),
            source.indexOf('async function associateLegacySnapshot'),
        );

        // Index-then-tag removal with index restore lives in core/timeline-service.
        expect(deleteNode).toContain('await removeTimelineNode(client, node, documentId);');
        expect(deleteNode).toContain('if (selectedNodeKey === selectionKey) onSelectNode(null);');
        expect(deleteNode).not.toContain('await loadSnapshots()');
        expect(deleteNode).not.toContain('removeRepoSnapshot');
        expect(deleteNode).not.toContain('removeSnapshot');
        expect(source).toContain('timeline_action_delete_node');
        expect(source).toContain('class="snapshot-node-delete"');
        expect(source).toContain('deleteTimelineNode(createTimelineNodeRecord(snapshot, "document", "legacy"))');
    });

    it('anchors diff scrolling to live document blocks by block id', () => {
        const source = ['src/ui/version-control/VersionDiffPanel.svelte', 'src/ui/version-control/version-diff-logic.ts'].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');

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
        const source = ['src/ui/version-control/VersionDiffPanel.svelte', 'src/ui/version-control/version-diff-logic.ts'].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');

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
        scope: 'document',
    };
}
