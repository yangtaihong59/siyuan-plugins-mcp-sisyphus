/* Pure helpers for VersionDiffPanel: diff display items, minimap geometry and DOM lookups. */
import { rendererPost as post } from "@/ui/plugin/renderer-client";
import { type BlockDiffEntry } from "@/shared/version-control/block-diff";
import { sortSnapshotsNewestFirst, type TimelineEntry, type TimelineNodeSelection, type TimelineSnapshot } from "@/shared/version-control/timeline";

export type Snapshot = TimelineSnapshot;

export type DiffEntryDisplayItem = {
    kind: "entry";
    key: string;
    entry: BlockDiffEntry;
    changeIndex: number;
    position: number;
};

export type DiffHiddenDisplayItem = {
    kind: "hidden";
    key: string;
    count: number;
    position: number;
    entries: DiffEntryDisplayItem[];
};

export type DiffDisplayItem = DiffEntryDisplayItem | DiffHiddenDisplayItem;

export type DiffMinimapItem = {
    key: string;
    entry: BlockDiffEntry;
    displayIndex: number;
    total: number;
};

export const UNCHANGED_CONTEXT_BLOCKS = 1;

export const LIVE_DOCUMENT_ANCHOR_OFFSET = 0.14;

export function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 0);
        }
    });
}

export function shouldIgnoreDiffClick(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest("button, input, textarea, select, a, [role='button']"));
}

export function scrollLiveDocumentBlockIntoView(blockElement: HTMLElement) {
    const container = blockElement.closest<HTMLElement>(".protyle-content") ?? findNearestScrollableAncestor(blockElement);
    if (!container) {
        blockElement.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        return;
    }
    const blockRect = blockElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const targetTop = container.scrollTop + blockRect.top - containerRect.top - containerRect.height * LIVE_DOCUMENT_ANCHOR_OFFSET;
    container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "auto",
    });
}

export function findNearestScrollableAncestor(element: HTMLElement): HTMLElement | null {
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|overlay)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 4) {
            return parent;
        }
        parent = parent.parentElement;
    }
    return null;
}

export function isVisibleElement(element: HTMLElement): boolean {
    if (!element.getClientRects().length) return false;
    let current: HTMLElement | null = element;
    while (current) {
        if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
        current = current.parentElement;
    }
    return true;
}

export function escapeCssAttributeValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

export function buildDiffDisplayItems(entries: BlockDiffEntry[]): DiffDisplayItem[] {
    const items: DiffDisplayItem[] = [];
    const changedIndexes = new Set(entries
        .map((entry, index) => entry.status === "unchanged" ? -1 : index)
        .filter((index) => index >= 0));
    let hiddenCount = 0;
    let hiddenStart = 0;
    let hiddenEntries: DiffEntryDisplayItem[] = [];
    let changeIndex = 0;

    entries.forEach((entry, index) => {
        const shouldShowUnchanged = entry.status === "unchanged" && hasNearbyChange(index, changedIndexes);
        if (entry.status === "unchanged" && !shouldShowUnchanged) {
            if (hiddenCount === 0) hiddenStart = index;
            hiddenCount += 1;
            hiddenEntries.push({
                kind: "entry",
                key: entry.key,
                entry,
                changeIndex: -1,
                position: index,
            });
            return;
        }

        if (hiddenCount > 0) {
            items.push({
                kind: "hidden",
                key: `hidden:${hiddenStart}:${hiddenCount}`,
                count: hiddenCount,
                position: hiddenStart,
                entries: hiddenEntries,
            });
            hiddenCount = 0;
            hiddenEntries = [];
        }

        items.push({
            kind: "entry",
            key: entry.key,
            entry,
            changeIndex: entry.status === "unchanged" ? -1 : changeIndex,
            position: index,
        });
        if (entry.status !== "unchanged") changeIndex += 1;
    });

    if (hiddenCount > 0) {
        items.push({
            kind: "hidden",
            key: `hidden:${hiddenStart}:${hiddenCount}`,
            count: hiddenCount,
            position: hiddenStart,
            entries: hiddenEntries,
        });
    }

    return items;
}

export function hasNearbyChange(index: number, changedIndexes: Set<number>): boolean {
    for (let offset = 1; offset <= UNCHANGED_CONTEXT_BLOCKS; offset += 1) {
        if (changedIndexes.has(index - offset) || changedIndexes.has(index + offset)) return true;
    }
    return false;
}

export function buildDiffMinimapItems(items: DiffDisplayItem[], expandedKeys: Set<string>, capacity: number): DiffMinimapItem[] {
    const changes: Array<Omit<DiffMinimapItem, "total">> = [];
    let displayIndex = 0;

    for (const item of items) {
        if (item.kind === "hidden") {
            if (expandedKeys.has(item.key)) {
                for (const hiddenEntry of item.entries) {
                    if (hiddenEntry.entry.status !== "unchanged") {
                        changes.push({ key: hiddenEntry.key, entry: hiddenEntry.entry, displayIndex });
                    }
                    displayIndex += 1;
                }
            } else {
                displayIndex += 1;
            }
            continue;
        }

        if (item.entry.status !== "unchanged") {
            changes.push({ key: item.key, entry: item.entry, displayIndex });
        }
        displayIndex += 1;
    }

    const total = Math.max(displayIndex, capacity, 1);
    return changes.map((item) => ({ ...item, total }));
}

export function minimapTop(item: DiffMinimapItem): number {
    if (item.total <= 1) return 0;
    return Math.min(98, Math.max(0, (item.displayIndex / item.total) * 100));
}

export function minimapHeight(item: DiffMinimapItem): number {
    return Math.min(18, Math.max(4, 100 / item.total));
}

export { rendererPost as post } from "@/ui/plugin/renderer-client";

export function snapshotFromSelection(nextSelection: TimelineNodeSelection): Snapshot {
    const node = nextSelection.node;
    return {
        id: node.snapshotId,
        ...(typeof node.tag === 'string' ? { tag: node.tag } : {}),
        created: node.created,
    };
}

export function createNoChangeTimelineEntry(nextSelection: TimelineNodeSelection, current: Snapshot): TimelineEntry {
    const node = nextSelection.node;
    const nodeKey = encodeURIComponent(node.tag || node.name);
    return {
        key: `${node.snapshotId}:${current.id}:${nextSelection.documentId}:nochange:${nodeKey}`,
        documentKey: nextSelection.documentId,
        title: nextSelection.documentTitle || node.name || nextSelection.documentId,
        kind: "modified",
        snapshot: snapshotFromSelection(nextSelection),
        previousSnapshot: current,
        file: {
            key: `${nextSelection.documentId}:nochange:${node.snapshotId}:${nodeKey}`,
            kind: "modified",
            title: nextSelection.documentTitle || node.name || nextSelection.documentId,
            documentId: nextSelection.documentId,
        },
        oldFileId: "",
        newFileId: "",
        scope: node.scope,
        hasDiff: false,
        noChanges: true,
        updated: node.created,
    };
}

export async function findNewestSnapshotForMemo(text: string): Promise<Snapshot | undefined> {
    const [snapshotData, tagData] = await Promise.all([
        post<{ snapshots?: Snapshot[] }>("/api/repo/getRepoSnapshots", { page: 1 }),
        post<{ snapshots?: Snapshot[] }>("/api/repo/getRepoTagSnapshots", {}),
    ]);
    const taggedIds = new Set((tagData.snapshots ?? []).map((snapshot) => snapshot.id));
    const ordered = sortSnapshotsNewestFirst(snapshotData.snapshots ?? []);
    return ordered.find((snapshot) => snapshot.memo === text && !taggedIds.has(snapshot.id))
        ?? ordered.find((snapshot) => snapshot.memo === text)
        ?? ordered[0];
}

export function blockText(block: BlockDiffEntry["oldBlock"]): string {
    return block?.markdown || block?.text || "";
}

export function createContentFallback(content: string, fallback: string): string {
    const text = content.trim();
    return text || fallback;
}

export function getReadableDocumentTitle(value: string | undefined): string {
    if (!value) return "";
    const trimmed = value.trim();
    if (!trimmed || /^[0-9]{14}-[a-z0-9]{7}$/i.test(trimmed)) return "";
    const segment = trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
    return segment.replace(/\.sy$/i, "");
}

export function firstReadableString(values: unknown[]): string {
    for (const value of values) {
        if (typeof value !== "string") continue;
        const readable = getReadableDocumentTitle(value);
        if (readable) return readable;
    }
    return "";
}

export function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
