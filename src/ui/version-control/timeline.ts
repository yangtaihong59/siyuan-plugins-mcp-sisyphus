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
export const DIFF_VIEWPORT_EPSILON = 0.01;

export interface TimelineNodeRecord {
    name: string;
    created: number;
    snapshotId: string;
    tag?: string;
}

export function isTimelineSnapshot(snapshot: TimelineSnapshot): boolean {
    return typeof snapshot.tag === 'string' && snapshot.tag.startsWith(TIMELINE_TAG_PREFIX);
}

export function createTimelineTagName(label: string, documentId: string, existingTags: string[] = []): string {
    const base = `${TIMELINE_TAG_PREFIX}_${documentId}_${sanitizeTimelineTagLabel(label)}`;
    const existing = new Set(existingTags.filter(Boolean));
    if (!existing.has(base)) return base;
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `${base}${stamp}`;
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
    const rest = tag.slice(TIMELINE_TAG_PREFIX.length);
    if (!rest.startsWith('_')) return undefined;
    return rest.match(TIMELINE_TAG_DOCUMENT_PATTERN)?.[1];
}

/**
 * 从时间线 tag 中提取展示用名称（label 部分）。
 * 新格式返回 _<label> 段；旧格式返回前缀后的整段；非时间线 tag 原样返回。
 */
export function extractTimelineTagLabel(tag: string): string {
    if (!tag.startsWith(TIMELINE_TAG_PREFIX)) return tag;
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
            .filter((item): item is TimelineNodeRecord => Boolean(item)
                && typeof item === 'object'
                && typeof (item as TimelineNodeRecord).name === 'string'
                && typeof (item as TimelineNodeRecord).snapshotId === 'string')
            .map((item) => ({
                name: item.name,
                created: typeof item.created === 'number' ? item.created : Date.now(),
                snapshotId: item.snapshotId,
                ...(typeof item.tag === 'string' ? { tag: item.tag } : {}),
            }));
    } catch {
        return [];
    }
}

export function serializeTimelineNodeRecords(nodes: TimelineNodeRecord[]): string {
    return JSON.stringify(nodes);
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
    const latestByContent = new Map<string, TimelineEntry>();
    for (const item of items) {
        if (!item.entry.noChanges && item.oldContent === item.newContent) continue;
        const contentKey = item.entry.noChanges ? `__sisyphus_nochange__:${item.entry.snapshot.id}` : item.oldContent;
        const existing = latestByContent.get(contentKey);
        if (!existing || getSnapshotTime(item.entry.snapshot) > getSnapshotTime(existing.snapshot)) {
            latestByContent.set(contentKey, item.entry);
        }
    }
    return sortEntriesNewestFirst([...latestByContent.values()]);
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
