import {
    buildChangedFiles,
    getDocumentIdFromSnapshotFile,
    getFileTitle,
    getSnapshotFileId,
    type ChangedSnapshotFile,
} from './block-diff';

export interface TimelineSnapshot {
    id: string;
    memo?: string;
    tag?: string;
    created?: string | number; // 思源实际返回 epoch 毫秒 number（dejavu Created int64），也存在字符串格式
    updated?: string | number;
    hCreated?: string;
    [key: string]: unknown;
}

export interface TimelinePair {
    left: TimelineSnapshot;
    right: TimelineSnapshot;
}

export interface TimelinePairDiff extends TimelinePair {
    files: ChangedSnapshotFile[];
}

export interface TimelineDocument {
    key: string;
    title: string;
    documentId?: string;
    latestUpdated?: string | number;
    count: number;
}

export type TimelineNodeScope = 'document' | 'global';

export interface TimelineEntry {
    key: string;
    documentKey: string;
    title: string;
    kind: ChangedSnapshotFile['kind'];
    snapshot: TimelineSnapshot;
    previousSnapshot: TimelineSnapshot;
    file: ChangedSnapshotFile;
    oldFileId: string;
    newFileId: string;
    scope: TimelineNodeScope;
    hasDiff?: boolean;
    noChanges?: boolean;
    updated?: string | number;
}

export interface TimelineEntryContent {
    entry: TimelineEntry;
    oldContent: string;
    newContent: string;
}

export interface DiffViewportState {
    top: number;
    height: number;
    capacity: number;
}

export const TIMELINE_TAG_PREFIX = 'sisyphustimeline';
export const GLOBAL_TIMELINE_TAG_PREFIX = `${TIMELINE_TAG_PREFIX}_global_`;
export const GLOBAL_TIMELINE_TAG_VERIFICATION_ERROR = 'GLOBAL_TIMELINE_TAG_VERIFICATION_FAILED';
export const TIMELINE_NODE_ATTR_KEY = 'custom-sisyphus-timeline';
export const DIFF_VIEWPORT_EPSILON = 0.01;

export interface TimelineNodeRecord {
    name: string;
    created: number;
    snapshotId: string;
    tag?: string;
    scope: TimelineNodeScope;
    source?: 'legacy';
}

export interface TimelineNodeSelection {
    documentId: string;
    documentTitle: string;
    node: TimelineNodeRecord;
}

export interface TimelineNodeReconciliation {
    documentNodes: TimelineNodeRecord[];
    globalNodes: TimelineNodeRecord[];
    legacySnapshots: TimelineSnapshot[];
    recoveredCount: number;
    attrChanged: boolean;
}

export interface LegacyGlobalMigrationResult {
    globalTag: string;
    oldTagRemoved: boolean;
}

export function isTimelineSnapshot(snapshot: TimelineSnapshot): boolean {
    return typeof snapshot.tag === 'string' && snapshot.tag.startsWith(TIMELINE_TAG_PREFIX);
}

export function createTimelineTagName(label: string, documentId: string, existingTags: string[] = []): string {
    const base = `${TIMELINE_TAG_PREFIX}_${documentId}_${sanitizeTimelineTagLabel(label)}`;
    return createUniqueTimelineTagName(base, existingTags);
}

export function createGlobalTimelineTagName(label: string, existingTags: string[] = []): string {
    const base = `${GLOBAL_TIMELINE_TAG_PREFIX}${sanitizeTimelineTagLabel(label)}`;
    return createUniqueTimelineTagName(base, existingTags);
}

function createUniqueTimelineTagName(base: string, existingTags: string[]): string {
    const existing = new Set(existingTags.filter(Boolean));
    if (!existing.has(base)) return base;
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    let candidate = `${base}${stamp}`;
    let suffix = 2;
    while (existing.has(candidate)) {
        candidate = `${base}${stamp}_${suffix}`;
        suffix += 1;
    }
    return candidate;
}

export function isGlobalTimelineTag(tag: string): boolean {
    return tag.startsWith(GLOBAL_TIMELINE_TAG_PREFIX);
}

export async function migrateLegacyTimelineSnapshotToGlobal(
    snapshot: TimelineSnapshot,
    existingTags: string[],
    actions: {
        addTag: (snapshotId: string, tag: string) => Promise<unknown>;
        readTaggedSnapshots: () => Promise<TimelineSnapshot[]>;
        removeTag: (tag: string) => Promise<unknown>;
    },
): Promise<LegacyGlobalMigrationResult> {
    if (!snapshot.id || !snapshot.tag) throw new Error(GLOBAL_TIMELINE_TAG_VERIFICATION_ERROR);
    const globalTag = createGlobalTimelineTagName(snapshotLabel(snapshot), existingTags);
    await actions.addTag(snapshot.id, globalTag);
    const verified = await actions.readTaggedSnapshots();
    if (!verified.some((item) => item.id === snapshot.id && item.tag === globalTag)) {
        throw new Error(GLOBAL_TIMELINE_TAG_VERIFICATION_ERROR);
    }

    let oldTagRemoved = true;
    try {
        await actions.removeTag(snapshot.tag);
    } catch {
        oldTagRemoved = false;
    }
    return { globalTag, oldTagRemoved };
}

/**
 * 思源 tag 名必须通过 gulu.File.IsValidFilename 校验（Windows 文件名非法字符 `<>:"/\|?*` 会被拒绝），
 * 因此分隔符不能用冒号；使用 `_`（合法文件名字符），docId 为思源固定 22 位 ID（\d{14}-[0-9a-z]{7}）。
 */
const TIMELINE_TAG_DOCUMENT_PATTERN = /^_(\d{14}-[0-9a-z]{7})_(.*)$/;

/**
 * 从时间线 tag 中提取文档 ID。
 * 新格式：sisyphustimeline_<docId>_<label>；旧格式（sisyphustimeline<label>）返回 undefined。
 */
export function extractTimelineDocumentId(tag: string): string | undefined {
    if (!tag.startsWith(TIMELINE_TAG_PREFIX)) return undefined;
    if (isGlobalTimelineTag(tag)) return undefined;
    const rest = tag.slice(TIMELINE_TAG_PREFIX.length);
    if (!rest.startsWith('_')) return undefined;
    return rest.match(TIMELINE_TAG_DOCUMENT_PATTERN)?.[1];
}

/**
 * 从时间线 tag 中提取展示用名称（label 部分）。
 * 文档/全局格式返回各自 label；旧格式返回前缀后的整段；非时间线 tag 原样返回。
 */
export function extractTimelineTagLabel(tag: string): string {
    if (!tag.startsWith(TIMELINE_TAG_PREFIX)) return tag;
    if (isGlobalTimelineTag(tag)) return tag.slice(GLOBAL_TIMELINE_TAG_PREFIX.length);
    const rest = tag.slice(TIMELINE_TAG_PREFIX.length);
    if (!rest.startsWith('_')) return rest;
    const match = rest.match(TIMELINE_TAG_DOCUMENT_PATTERN);
    return match ? match[2] : rest;
}

export function parseTimelineNodeRecords(raw: unknown): TimelineNodeRecord[] {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(isTimelineNodeRecordLike)
            .map((item) => ({
                name: item.name,
                created: typeof item.created === 'number' ? item.created : Date.now(),
                snapshotId: item.snapshotId,
                ...(typeof item.tag === 'string' ? { tag: item.tag } : {}),
                scope: item.scope === 'global' ? 'global' as const : 'document' as const,
                ...(item.source === 'legacy' ? { source: 'legacy' as const } : {}),
            }));
    } catch {
        return [];
    }
}

export function isTimelineNodeRecordPayloadValid(raw: unknown): boolean {
    if (raw === undefined || raw === null || raw === '') return true;
    if (typeof raw !== 'string') return false;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.every(isTimelineNodeRecordLike);
    } catch {
        return false;
    }
}

export function serializeTimelineNodeRecords(nodes: TimelineNodeRecord[]): string {
    return JSON.stringify(nodes);
}

export function createTimelineNodeRecord(
    snapshot: TimelineSnapshot,
    scope: TimelineNodeScope = 'document',
    source?: TimelineNodeRecord['source'],
): TimelineNodeRecord {
    return {
        name: snapshotLabel(snapshot),
        created: getSnapshotTime(snapshot) || Date.now(),
        snapshotId: snapshot.id,
        ...(typeof snapshot.tag === 'string' ? { tag: snapshot.tag } : {}),
        scope,
        ...(source ? { source } : {}),
    };
}

/**
 * Merge the document-owned attr index with recoverable document-scoped tags.
 * Legacy tags have no reliable document ownership and remain in a separate archive
 * until the user explicitly associates one with the current document.
 */
export function reconcileDocumentTimelineNodes(
    documentId: string,
    attrNodes: TimelineNodeRecord[],
    taggedSnapshots: TimelineSnapshot[],
): TimelineNodeReconciliation {
    const timelineSnapshots = sortSnapshotsNewestFirst(taggedSnapshots.filter(isTimelineSnapshot));
    const globalNodes = uniqueTimelineNodes(timelineSnapshots
        .filter((snapshot) => isGlobalTimelineTag(snapshot.tag ?? ''))
        .map((snapshot) => createTimelineNodeRecord(snapshot, 'global')));
    const globalMigrationKeys = new Set(globalNodes.map(getTimelineNodeMigrationIdentity));
    const documentNodes = attrNodes
        .filter((node) => node.scope !== 'global')
        .map((node) => ({ ...node, scope: 'document' as const }))
        .filter((node) => !(node.source === 'legacy' && globalMigrationKeys.has(getTimelineNodeMigrationIdentity(node))));
    const existing = new Set(documentNodes.map(getTimelineNodeIdentity));
    let recoveredCount = 0;

    for (const snapshot of timelineSnapshots) {
        if (extractTimelineDocumentId(snapshot.tag ?? '') !== documentId) continue;
        const recovered = { ...createTimelineNodeRecord(snapshot, 'document'), scope: 'document' as const };
        const identity = getTimelineNodeIdentity(recovered);
        if (existing.has(identity)) continue;
        documentNodes.push(recovered);
        existing.add(identity);
        recoveredCount += 1;
    }

    const legacySnapshots = timelineSnapshots.filter((snapshot) => {
        const tag = snapshot.tag ?? '';
        if (isGlobalTimelineTag(tag)) return false;
        if (extractTimelineDocumentId(tag) !== undefined) return false;
        if (tag === `${TIMELINE_TAG_PREFIX}root`) return false;
        return !globalMigrationKeys.has(getTimelineNodeMigrationIdentity(createTimelineNodeRecord(snapshot, 'document', 'legacy')));
    });

    return {
        documentNodes,
        globalNodes,
        legacySnapshots,
        recoveredCount,
        attrChanged: recoveredCount > 0
            || documentNodes.length !== attrNodes.length
            || attrNodes.some((node) => node.scope !== 'document'),
    };
}

export function getTimelineNodeIdentity(node: Pick<TimelineNodeRecord, 'snapshotId' | 'tag'>): string {
    return `${node.snapshotId}\u0000${node.tag ?? ''}`;
}

export function getTimelineNodeSelectionKey(selection: TimelineNodeSelection | null | undefined): string {
    if (!selection) return '';
    return `${selection.documentId}\u0000${getTimelineNodeIdentity(selection.node)}`;
}

export function sortTimelineNodesNewestFirst(nodes: TimelineNodeRecord[]): TimelineNodeRecord[] {
    return [...nodes].sort((left, right) => right.created - left.created);
}

export function getTimelineNodeMigrationIdentity(node: Pick<TimelineNodeRecord, 'snapshotId' | 'name'>): string {
    return `${node.snapshotId}\u0000${sanitizeTimelineTagLabel(node.name)}`;
}

function uniqueTimelineNodes(nodes: TimelineNodeRecord[]): TimelineNodeRecord[] {
    const unique = new Map<string, TimelineNodeRecord>();
    for (const node of nodes) {
        const identity = getTimelineNodeMigrationIdentity(node);
        if (!unique.has(identity)) unique.set(identity, node);
    }
    return [...unique.values()];
}

function isTimelineNodeRecordLike(item: unknown): item is TimelineNodeRecord {
    return Boolean(item)
        && typeof item === 'object'
        && typeof (item as TimelineNodeRecord).name === 'string'
        && typeof (item as TimelineNodeRecord).snapshotId === 'string'
        && ((item as TimelineNodeRecord).scope === undefined
            || (item as TimelineNodeRecord).scope === 'document'
            || (item as TimelineNodeRecord).scope === 'global');
}

export function sortSnapshotsNewestFirst(snapshots: TimelineSnapshot[]): TimelineSnapshot[] {
    return [...snapshots].sort((left, right) => getSnapshotTime(right) - getSnapshotTime(left));
}

export function createAdjacentSnapshotPairs(snapshots: TimelineSnapshot[]): TimelinePair[] {
    const ordered = sortSnapshotsNewestFirst(snapshots).filter((snapshot) => Boolean(snapshot.id));
    const pairs: TimelinePair[] = [];
    for (let index = 0; index < ordered.length - 1; index += 1) {
        pairs.push({ left: ordered[index + 1], right: ordered[index] });
    }
    return pairs;
}

export function buildTimelinePairDiff(
    left: TimelineSnapshot,
    right: TimelineSnapshot,
    diff: Record<string, unknown>,
): TimelinePairDiff {
    return {
        left,
        right,
        files: buildChangedFiles(diff),
    };
}

export function buildDocumentTimeline(pairDiffs: TimelinePairDiff[]): {
    documents: TimelineDocument[];
    entries: TimelineEntry[];
} {
    const documents = new Map<string, TimelineDocument>();
    const entries: TimelineEntry[] = [];

    for (const pair of pairDiffs) {
        for (const file of pair.files) {
            const documentKey = getDocumentKey(file);
            const title = file.title || documentKey;
            const oldFileId = getSnapshotFileId(file.oldFile);
            const newFileId = getSnapshotFileId(file.newFile);
            const updated = file.newFile?.updated ?? file.oldFile?.updated ?? pair.right.updated ?? pair.right.created;
            const entry: TimelineEntry = {
                key: `${pair.right.id}:${documentKey}:${file.kind}:${oldFileId}:${newFileId}`,
                documentKey,
                title,
                kind: file.kind,
                snapshot: pair.right,
                previousSnapshot: pair.left,
                file,
                oldFileId,
                newFileId,
                scope: 'document',
                ...(updated !== undefined ? { updated } : {}),
            };
            entries.push(entry);

            const current = documents.get(documentKey);
            if (current) {
                current.count += 1;
                current.title = title || current.title;
                current.latestUpdated = current.latestUpdated ?? updated;
            } else {
                documents.set(documentKey, {
                    key: documentKey,
                    title,
                    documentId: file.documentId,
                    latestUpdated: updated,
                    count: 1,
                });
            }
        }
    }

    return {
        documents: [...documents.values()].sort((left, right) => String(left.title).localeCompare(String(right.title))),
        entries: entries.sort((left, right) => getSnapshotTime(right.snapshot) - getSnapshotTime(left.snapshot)),
    };
}

export function snapshotLabel(snapshot: TimelineSnapshot): string {
    if (typeof snapshot.tag === 'string' && snapshot.tag.startsWith(TIMELINE_TAG_PREFIX)) {
        const label = extractTimelineTagLabel(snapshot.tag);
        if (label) return label;
        return snapshot.memo || snapshot.id;
    }
    const fallback = snapshot.tag || snapshot.memo || snapshot.hCreated;
    if (fallback) return fallback;
    return snapshot.created !== undefined ? String(snapshot.created) : snapshot.id;
}

export function formatSnapshotTime(snapshot: TimelineSnapshot): string {
    const raw = getSnapshotTimeSource(snapshot);
    if (raw === undefined || raw === null || raw === '') return '';
    const parsed = parseSnapshotTimeValue(raw);
    if (parsed > 0) return formatDate(new Date(parsed));
    return String(raw);
}

export function filterChangedUniqueTimelineEntries(items: TimelineEntryContent[]): TimelineEntry[] {
    const uniqueByKey = new Map<string, TimelineEntry>();
    for (const item of items) {
        if (!item.entry.noChanges && item.oldContent === item.newContent) continue;
        uniqueByKey.set(item.entry.key, item.entry);
    }
    return sortEntriesNewestFirst([...uniqueByKey.values()]);
}

export function sortEntriesNewestFirst(entries: TimelineEntry[]): TimelineEntry[] {
    return [...entries].sort((left, right) => getSnapshotTime(right.snapshot) - getSnapshotTime(left.snapshot));
}

export function selectInitialTimelineEntry(
    entries: TimelineEntry[],
    documentKey: string,
    selectedKey = '',
): TimelineEntry | undefined {
    const ordered = sortEntriesNewestFirst(entries);
    const currentSelection = selectedKey
        ? ordered.find((entry) => entry.key === selectedKey && entry.documentKey === documentKey)
        : undefined;
    if (currentSelection) return currentSelection;
    return ordered.find((entry) => entry.documentKey === documentKey);
}

export function shouldUpdateDiffViewportState(
    current: DiffViewportState,
    next: DiffViewportState,
    epsilon = DIFF_VIEWPORT_EPSILON,
): boolean {
    return Math.abs(current.top - next.top) >= epsilon
        || Math.abs(current.height - next.height) >= epsilon
        || current.capacity !== next.capacity;
}

export function canReuseLiveDocumentBlock(params: {
    blockId: string;
    cachedBlockId: string;
    cachedBlock: { isConnected?: boolean } | null;
    isVisible: boolean;
    isOutsideTimeline: boolean;
    isInCurrentDocument: boolean;
}): boolean {
    return params.blockId === params.cachedBlockId
        && Boolean(params.cachedBlock?.isConnected)
        && params.isVisible
        && params.isOutsideTimeline
        && params.isInCurrentDocument;
}

function sanitizeTimelineTagLabel(label: string): string {
    const sanitized = label.trim().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 48);
    return sanitized || 'snapshot';
}

export function getDocumentKey(file: ChangedSnapshotFile): string {
    return file.documentId
        || getDocumentIdFromSnapshotFile(file.newFile)
        || getDocumentIdFromSnapshotFile(file.oldFile)
        || getFileTitle(file.newFile)
        || getFileTitle(file.oldFile)
        || file.key;
}

function getSnapshotTime(snapshot: TimelineSnapshot): number {
    const value = getSnapshotTimeSource(snapshot);
    return parseSnapshotTimeValue(value);
}

function getSnapshotTimeSource(snapshot: TimelineSnapshot): string | number | undefined {
    for (const key of ['created', 'updated', 'hCreated']) {
        const value = snapshot[key];
        if (typeof value === 'number' || typeof value === 'string') return value;
    }
    return undefined;
}

function parseSnapshotTimeValue(value: unknown): number {
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value; // 10 位 epoch 秒 → 毫秒；毫秒原样
    if (typeof value !== 'string') return 0;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const digits = value.match(/\d+/g)?.join('');
    if (digits) {
        // 纯数字 epoch 字符串：10 位秒 → 毫秒；13 位毫秒原样（与 number 分支一致）
        if (/^\d{10}$/.test(digits)) return Number(digits) * 1000;
        if (/^\d{13}$/.test(digits)) return Number(digits);
        const compact = digits.padEnd(14, '0').slice(0, 14);
        const match = compact.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
        if (match) {
            const [, year, month, day, hour, minute, second] = match;
            const numeric = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
            if (!Number.isNaN(numeric)) return numeric;
        }
    }
    return 0;
}

function formatDate(date: Date): string {
    if (Number.isNaN(date.getTime())) return '';
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
