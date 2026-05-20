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
    created?: string;
    updated?: string;
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

export function isTimelineSnapshot(snapshot: TimelineSnapshot): boolean {
    return typeof snapshot.tag === 'string' && snapshot.tag.startsWith(TIMELINE_TAG_PREFIX);
}

export function createTimelineTagName(label: string, existingSnapshots: TimelineSnapshot[] = []): string {
    const base = `${TIMELINE_TAG_PREFIX}${sanitizeTimelineTagLabel(label)}`;
    const existing = new Set(existingSnapshots.map((snapshot) => snapshot.tag).filter(Boolean));
    if (!existing.has(base)) return base;
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `${base}${stamp}`;
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
        return snapshot.tag.slice(TIMELINE_TAG_PREFIX.length) || snapshot.memo || snapshot.id;
    }
    return snapshot.tag || snapshot.memo || snapshot.hCreated || snapshot.created || snapshot.id;
}

export function formatSnapshotTime(snapshot: TimelineSnapshot): string {
    const raw = getSnapshotTimeSource(snapshot);
    if (raw === undefined || raw === null || raw === '') return '';
    if (typeof raw === 'number') return formatDate(new Date(raw));
    const parsed = parseSnapshotTimeValue(raw);
    if (parsed > 0) return formatDate(new Date(parsed));
    return String(raw);
}

export function filterChangedUniqueTimelineEntries(items: TimelineEntryContent[]): TimelineEntry[] {
    const latestByContent = new Map<string, TimelineEntry>();
    for (const item of items) {
        if (item.oldContent === item.newContent) continue;
        const contentKey = item.oldContent;
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
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return 0;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const digits = value.match(/\d+/g)?.join('');
    if (digits) {
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
