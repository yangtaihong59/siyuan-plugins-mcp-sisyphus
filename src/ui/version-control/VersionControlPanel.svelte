<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { fetchPost, showMessage } from "siyuan";
    import {
        buildChangedFiles,
        diffSnapshotBlocks,
        getBlockDiffLineStats,
        getUpdateBlockPayload,
        getRestoreBlockPayload,
        getRestoreInsertPlan,
        getSnapshotFileId,
        type BlockDiffEntry,
        type ChangedSnapshotFile,
        type RepoSnapshotFileChange,
    } from "./block-diff";
    import {
        createTimelineTagName,
        filterChangedUniqueTimelineEntries,
        formatSnapshotTime,
        getDocumentKey,
        canReuseLiveDocumentBlock,
        isTimelineSnapshot,
        selectInitialTimelineEntry,
        shouldUpdateDiffViewportState,
        snapshotLabel,
        sortSnapshotsNewestFirst,
        type TimelineEntry,
        type TimelineEntryContent,
        type TimelineSnapshot,
    } from "./timeline";

    type Snapshot = TimelineSnapshot;
    type CompareMode = "unified" | "split";
    type DiffEntryDisplayItem = {
        kind: "entry";
        key: string;
        entry: BlockDiffEntry;
        changeIndex: number;
        position: number;
    };
    type DiffHiddenDisplayItem = {
        kind: "hidden";
        key: string;
        count: number;
        position: number;
        entries: DiffEntryDisplayItem[];
    };
    type DiffDisplayItem = DiffEntryDisplayItem | DiffHiddenDisplayItem;
    type DiffMinimapItem = {
        key: string;
        entry: BlockDiffEntry;
        displayIndex: number;
        total: number;
    };

    type SnapshotFileContent = {
        title?: string;
        content?: string;
        displayInText?: boolean;
        updated?: string | number;
    };
    const CURRENT_SNAPSHOT_MEMO_PREFIX = "[Sisyphus Timeline Current]";
    const ROOT_TIMELINE_SNAPSHOT_LABEL = "root";
    const TIMELINE_AUTO_COLLAPSE_WIDTH = 920;
    const UNCHANGED_CONTEXT_BLOCKS = 1;
    const MINIMAP_UNIT_HEIGHT = 34;
    const LIVE_DOCUMENT_ANCHOR_OFFSET = 0.14;

    export let currentDocumentId = "";
    export let currentDocumentTitle = "";
    export let showDebugMeta = false;
    export let i18n: Record<string, string> = {};

    let taggedSnapshots: Snapshot[] = [];
    let currentSnapshot: Snapshot | null = null;
    let timelineEntries: TimelineEntry[] = [];
    let selectedEntryKey = "";
    let memo = "";
    let loadingSnapshots = false;
    let loadingDiff = false;
    let loadingFile = false;
    let applying = false;
    let oldContent = "";
    let newContent = "";
    let oldFileContent: SnapshotFileContent | null = null;
    let newFileContent: SnapshotFileContent | null = null;
    let blockEntries: BlockDiffEntry[] = [];
    let error = "";
    let resolvedDocumentTitle = "";
    let mounted = false;
    let loadedDocumentId = "";
    let timelineCollapsed = true;
    let panelVisible = false;
    let autoTimelineCollapsed = false;
    let forceTimelineExpanded = false;
    let compareMode: CompareMode = "unified";
    let refreshingSelection = false;
    let expandedHiddenKeys = new Set<string>();
    let shellElement: HTMLDivElement;
    let diffElement: HTMLElement;
    let shellResizeObserver: ResizeObserver | undefined;
    let shellMutationObserver: MutationObserver | undefined;
    let diffViewportTop = 0;
    let diffViewportHeight = 100;
    let diffMinimapCapacity = 1;
    let diffViewportFrame = 0;
    let documentScrollSyncEnabled = true;
    let documentScrollSyncFrame = 0;
    let lastSyncedDocumentBlockId = "";
    let lastDiffAnchorBlockId = "";
    let lastLiveDocumentBlock: HTMLElement | null = null;
    let lastLiveDocumentBlockId = "";

    $: documentEntries = currentDocumentId ? timelineEntries.filter((entry) => entry.documentKey === currentDocumentId) : [];
    $: selectedEntry = documentEntries.find((entry) => entry.key === selectedEntryKey);
    $: displayDocumentTitle = getReadableDocumentTitle(resolvedDocumentTitle)
        || getReadableDocumentTitle(currentDocumentTitle)
        || getReadableDocumentTitle(selectedEntry?.title)
        || t("timeline_current_document_fallback", "这个文档");
    $: diffOpen = Boolean(selectedEntry);
    $: effectiveTimelineCollapsed = timelineCollapsed;
    $: selectedSnapshotTitle = selectedEntry ? snapshotLabel(selectedEntry.snapshot) : "";
    $: selectedSnapshotTime = selectedEntry ? formatSnapshotTime(selectedEntry.snapshot) : "";
    $: currentSnapshotTime = currentSnapshot ? formatSnapshotTime(currentSnapshot) : "";
    $: currentVersionTime = currentSnapshotTime || newFileContent?.updated || "";
    $: diffLineStats = getBlockDiffLineStats(blockEntries);
    $: diffDisplayItems = buildDiffDisplayItems(blockEntries);
    $: hiddenDisplayItems = diffDisplayItems.filter((item): item is DiffHiddenDisplayItem => item.kind === "hidden");
    $: hasHiddenBlocks = hiddenDisplayItems.length > 0;
    $: allHiddenExpanded = hasHiddenBlocks && hiddenDisplayItems.every((item) => expandedHiddenKeys.has(item.key));
    $: diffMinimapItems = buildDiffMinimapItems(diffDisplayItems, expandedHiddenKeys, diffMinimapCapacity);
    $: compareModeTitle = compareMode === "unified"
        ? t("timeline_compare_split_title", "切换到并排对比")
        : t("timeline_compare_unified_title", "切换到统一对比");
    $: compareModeAction = compareMode === "unified"
        ? t("timeline_action_compare_split", "并排对比")
        : t("timeline_action_compare_unified", "统一对比");
    $: documentScrollSyncTitle = documentScrollSyncEnabled
        ? t("timeline_action_disable_scroll_sync", "停止同步文档滚动")
        : t("timeline_action_enable_scroll_sync", "同步文档滚动");
    $: changeSummaryLabel = t("timeline_change_summary", "新增 ${added} 行，删除 ${removed} 行", {
        added: diffLineStats.added,
        removed: diffLineStats.removed,
    });
    $: hiddenToggleTitle = allHiddenExpanded
        ? t("timeline_action_collapse_all_hidden", "折叠所有隐藏块")
        : t("timeline_action_expand_all_hidden", "展开所有隐藏块");
    $: if (mounted) {
        diffDisplayItems;
        compareMode;
        selectedEntryKey;
        queueDiffViewportUpdate();
    }
    $: if (shouldAutoLoadTimeline() && currentDocumentId !== loadedDocumentId && !loadingSnapshots) {
        void loadTimeline();
    }

    onMount(async () => {
        mounted = true;
        observeShellWidth();
        await tick();
        await nextFrame();
        updateShellVisibility();
        if (shouldAutoLoadTimeline()) await loadTimeline();
    });

    onDestroy(() => {
        shellResizeObserver?.disconnect();
        shellMutationObserver?.disconnect();
        cancelDiffViewportUpdate();
        cancelDocumentScrollSync();
    });

    function observeShellWidth() {
        if (!shellElement) return;
        if (typeof ResizeObserver !== "undefined") {
            shellResizeObserver = new ResizeObserver((entries) => {
                updateShellVisibility(entries[0]?.contentRect.width ?? shellElement.clientWidth);
            });
            shellResizeObserver.observe(shellElement);
        }
        observeShellAncestorVisibility();
        updateShellVisibility();
    }

    function observeShellAncestorVisibility() {
        if (typeof MutationObserver === "undefined") return;
        shellMutationObserver = new MutationObserver(() => updateShellVisibility());
        let element: HTMLElement | null = shellElement;
        while (element) {
            shellMutationObserver.observe(element, {
                attributes: true,
                attributeFilter: ["class", "style", "hidden", "aria-hidden"],
            });
            element = element.parentElement;
        }
    }

    function updateShellVisibility(width = shellElement?.clientWidth ?? 0) {
        panelVisible = isShellVisible();
        autoTimelineCollapsed = !forceTimelineExpanded && width > 0 && width < TIMELINE_AUTO_COLLAPSE_WIDTH;
    }

    function isShellVisible(): boolean {
        if (!shellElement?.getClientRects().length) return false;
        let element: HTMLElement | null = shellElement;
        while (element) {
            if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
            if (typeof getComputedStyle === "function") {
                const style = getComputedStyle(element);
                if (style.display === "none" || style.visibility === "hidden") return false;
            }
            element = element.parentElement;
        }
        return true;
    }

    function toggleTimelineCollapsed() {
        if (!effectiveTimelineCollapsed) {
            forceTimelineExpanded = false;
        }
        timelineCollapsed = !timelineCollapsed;
    }

    function shouldAutoLoadTimeline(): boolean {
        return mounted && panelVisible && currentDocumentId !== "";
    }

    async function toggleCompareMode() {
        const scrollProgress = getDiffScrollProgress();
        compareMode = compareMode === "unified" ? "split" : "unified";
        await tick();
        await nextFrame();
        restoreDiffScrollProgress(scrollProgress);
    }

    function toggleHiddenBlock(key: string) {
        const next = new Set(expandedHiddenKeys);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        expandedHiddenKeys = next;
        queueDiffViewportUpdate();
    }

    function toggleAllHiddenBlocks() {
        if (!hasHiddenBlocks) return;
        expandedHiddenKeys = allHiddenExpanded
            ? new Set()
            : new Set(hiddenDisplayItems.map((item) => item.key));
        queueDiffViewportUpdate();
    }

    function handleDiffScroll() {
        updateDiffViewport();
        queueDocumentScrollSync();
    }

    function handleDiffClick(event: MouseEvent) {
        if (shouldIgnoreDiffClick(event.target)) return;
        const blockId = getClickedDiffBlockId(event.target);
        if (!blockId) return;
        syncDocumentToBlockId(blockId, { force: true });
    }

    function queueDiffViewportUpdate() {
        if (diffViewportFrame) return;
        const run = () => updateDiffViewport();
        if (typeof requestAnimationFrame === "function") {
            diffViewportFrame = requestAnimationFrame(() => {
                diffViewportFrame = 0;
                run();
            });
        } else {
            diffViewportFrame = window.setTimeout(() => {
                diffViewportFrame = 0;
                run();
            }, 0);
        }
    }

    function cancelDiffViewportUpdate() {
        if (!diffViewportFrame) return;
        if (typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(diffViewportFrame);
        } else {
            clearTimeout(diffViewportFrame);
        }
        diffViewportFrame = 0;
    }

    function nextFrame(): Promise<void> {
        return new Promise((resolve) => {
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(() => resolve());
            } else {
                setTimeout(resolve, 0);
            }
        });
    }

    function getDiffScrollProgress(): number {
        if (!diffElement) return 0;
        const maxScrollTop = Math.max(0, diffElement.scrollHeight - diffElement.clientHeight);
        if (maxScrollTop === 0) return 0;
        return Math.min(1, Math.max(0, diffElement.scrollTop / maxScrollTop));
    }

    function restoreDiffScrollProgress(progress: number) {
        if (!diffElement) return;
        const maxScrollTop = Math.max(0, diffElement.scrollHeight - diffElement.clientHeight);
        diffElement.scrollTop = maxScrollTop * Math.min(1, Math.max(0, progress));
        updateDiffViewport();
    }

    function updateDiffViewport() {
        if (!diffElement) {
            setDiffViewportState(0, 100, 1);
            return;
        }
        const scrollHeight = Math.max(diffElement.scrollHeight, 1);
        const clientHeight = Math.max(diffElement.clientHeight, 1);
        const nextHeight = Math.min(100, Math.max(8, (clientHeight / scrollHeight) * 100));
        const nextTop = getDiffScrollProgress() * Math.max(0, 100 - nextHeight);
        const nextCapacity = Math.max(1, Math.ceil(clientHeight / MINIMAP_UNIT_HEIGHT));
        setDiffViewportState(nextTop, nextHeight, nextCapacity);
    }

    function setDiffViewportState(nextTop: number, nextHeight: number, nextCapacity: number) {
        const current = {
            top: diffViewportTop,
            height: diffViewportHeight,
            capacity: diffMinimapCapacity,
        };
        const next = {
            top: nextTop,
            height: nextHeight,
            capacity: nextCapacity,
        };
        if (!shouldUpdateDiffViewportState(current, next)) return;
        diffViewportTop = next.top;
        diffViewportHeight = next.height;
        diffMinimapCapacity = next.capacity;
    }

    function toggleDocumentScrollSync() {
        documentScrollSyncEnabled = !documentScrollSyncEnabled;
        lastSyncedDocumentBlockId = "";
        if (documentScrollSyncEnabled) queueDocumentScrollSync();
    }

    function resetDocumentScrollSync() {
        lastSyncedDocumentBlockId = "";
        lastDiffAnchorBlockId = "";
        lastLiveDocumentBlockId = "";
        lastLiveDocumentBlock = null;
        queueDocumentScrollSync();
    }

    function queueDocumentScrollSync() {
        if (!documentScrollSyncEnabled || !diffElement || loadingFile || !selectedEntry) return;
        if (documentScrollSyncFrame) return;
        const run = () => {
            documentScrollSyncFrame = 0;
            syncDocumentToDiffViewport();
        };
        if (typeof requestAnimationFrame === "function") {
            documentScrollSyncFrame = requestAnimationFrame(run);
        } else {
            documentScrollSyncFrame = window.setTimeout(run, 0);
        }
    }

    function cancelDocumentScrollSync() {
        if (!documentScrollSyncFrame) return;
        if (typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(documentScrollSyncFrame);
        } else {
            clearTimeout(documentScrollSyncFrame);
        }
        documentScrollSyncFrame = 0;
    }

    function syncDocumentToDiffViewport() {
        const blockId = getDiffViewportAnchorBlockId();
        if (!blockId || blockId === lastDiffAnchorBlockId) return;
        if (syncDocumentToBlockId(blockId)) {
            lastDiffAnchorBlockId = blockId;
        }
    }

    function syncDocumentToBlockId(blockId: string, options: { force?: boolean } = {}): boolean {
        if (!blockId || (!options.force && blockId === lastSyncedDocumentBlockId)) return false;
        const blockElement = findLiveDocumentBlock(blockId);
        if (!blockElement) return false;
        scrollLiveDocumentBlockIntoView(blockElement);
        lastSyncedDocumentBlockId = blockId;
        return true;
    }

    function shouldIgnoreDiffClick(target: EventTarget | null): boolean {
        return target instanceof Element && Boolean(target.closest("button, input, textarea, select, a, [role='button']"));
    }

    function getClickedDiffBlockId(target: EventTarget | null): string {
        if (!(target instanceof Element) || !diffElement) return "";
        const anchor = target.closest<HTMLElement>("[data-sync-block-id]");
        if (!anchor || !diffElement.contains(anchor)) return "";
        return anchor.dataset.syncBlockId ?? "";
    }

    function getDiffViewportAnchorBlockId(): string {
        if (!diffElement) return "";
        const anchors = Array.from(diffElement.querySelectorAll<HTMLElement>("[data-sync-block-id]"))
            .filter((element) => Boolean(element.dataset.syncBlockId));
        if (anchors.length === 0) return "";

        const diffRect = diffElement.getBoundingClientRect();
        const headHeight = diffElement.querySelector<HTMLElement>(".vc-diff-head")?.getBoundingClientRect().height ?? 0;
        const viewportTop = diffRect.top + headHeight + 8;
        let nearestAbove: HTMLElement | null = null;
        let nearestAboveDistance = Number.POSITIVE_INFINITY;
        let nearestBelow: HTMLElement | null = null;
        let nearestBelowDistance = Number.POSITIVE_INFINITY;

        for (const anchor of anchors) {
            const rect = anchor.getBoundingClientRect();
            if (rect.height <= 0 || rect.bottom < diffRect.top || rect.top > diffRect.bottom) continue;
            if (rect.top <= viewportTop && rect.bottom >= viewportTop) {
                return anchor.dataset.syncBlockId ?? "";
            }
            if (rect.bottom < viewportTop) {
                const distance = viewportTop - rect.bottom;
                if (distance < nearestAboveDistance) {
                    nearestAbove = anchor;
                    nearestAboveDistance = distance;
                }
                continue;
            }
            const distance = rect.top - viewportTop;
            if (distance < nearestBelowDistance) {
                nearestBelow = anchor;
                nearestBelowDistance = distance;
            }
        }

        return nearestBelow?.dataset.syncBlockId ?? nearestAbove?.dataset.syncBlockId ?? "";
    }

    function getEntrySyncBlockId(item: DiffEntryDisplayItem): string | undefined {
        return item.entry.newBlock?.id || findNeighborCurrentBlockId(item.position);
    }

    function getHiddenSyncBlockId(item: DiffHiddenDisplayItem): string | undefined {
        return item.entries.find((entry) => entry.entry.newBlock?.id)?.entry.newBlock?.id
            || findNeighborCurrentBlockId(item.position);
    }

    function findNeighborCurrentBlockId(position: number): string | undefined {
        for (let index = position + 1; index < blockEntries.length; index += 1) {
            const id = blockEntries[index]?.newBlock?.id;
            if (id) return id;
        }
        for (let index = position - 1; index >= 0; index -= 1) {
            const id = blockEntries[index]?.newBlock?.id;
            if (id) return id;
        }
        return undefined;
    }

    function findLiveDocumentBlock(blockId: string): HTMLElement | null {
        if (typeof document === "undefined") return null;
        const cachedBlock = lastLiveDocumentBlock;
        if (
            cachedBlock
            &&
            canReuseLiveDocumentBlock({
                blockId,
                cachedBlockId: lastLiveDocumentBlockId,
                cachedBlock,
                isVisible: isVisibleElement(cachedBlock),
                isOutsideTimeline: !shellElement?.contains(cachedBlock),
                isInCurrentDocument: isInCurrentDocumentEditor(cachedBlock),
            })
        ) {
            return cachedBlock;
        }
        const selector = `[data-node-id="${escapeCssAttributeValue(blockId)}"]`;
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
            .filter((element) => isVisibleElement(element) && !shellElement?.contains(element));
        const block = candidates.find((element) => isInCurrentDocumentEditor(element)) ?? candidates[0] ?? null;
        lastLiveDocumentBlockId = block ? blockId : "";
        lastLiveDocumentBlock = block;
        return block;
    }

    function isInCurrentDocumentEditor(element: HTMLElement): boolean {
        if (!currentDocumentId) return true;
        const root = element.closest<HTMLElement>(".protyle-wysiwyg");
        if (!root) return true;
        return root.dataset.nodeId === currentDocumentId
            || Boolean(root.querySelector(`[data-node-id="${escapeCssAttributeValue(currentDocumentId)}"]`));
    }

    function scrollLiveDocumentBlockIntoView(blockElement: HTMLElement) {
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

    function findNearestScrollableAncestor(element: HTMLElement): HTMLElement | null {
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

    function isVisibleElement(element: HTMLElement): boolean {
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

    function escapeCssAttributeValue(value: string): string {
        return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    }

    function buildDiffDisplayItems(entries: BlockDiffEntry[]): DiffDisplayItem[] {
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

    function hasNearbyChange(index: number, changedIndexes: Set<number>): boolean {
        for (let offset = 1; offset <= UNCHANGED_CONTEXT_BLOCKS; offset += 1) {
            if (changedIndexes.has(index - offset) || changedIndexes.has(index + offset)) return true;
        }
        return false;
    }

    function hiddenBlocksText(count: number): string {
        return t("timeline_hidden_blocks", "${count} 个隐藏的块", { count });
    }

    function buildDiffMinimapItems(items: DiffDisplayItem[], expandedKeys: Set<string>, capacity: number): DiffMinimapItem[] {
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

    function minimapTop(item: DiffMinimapItem): number {
        if (item.total <= 1) return 0;
        return Math.min(98, Math.max(0, (item.displayIndex / item.total) * 100));
    }

    function minimapHeight(item: DiffMinimapItem): number {
        return Math.min(18, Math.max(4, 100 / item.total));
    }

    function post<T>(endpoint: string, data: Record<string, unknown> = {}): Promise<T> {
        return new Promise((resolve, reject) => {
            fetchPost(endpoint, data, (response: { code: number; msg?: string; data: T }) => {
                if (response?.code === 0) {
                    resolve(response.data);
                } else {
                    reject(new Error(response?.msg || `SiYuan API error from ${endpoint}`));
                }
            });
        });
    }

    function t(key: string, fallback: string, vars: Record<string, string | number> = {}): string {
        const template = i18n?.[key] ?? fallback;
        return Object.entries(vars).reduce((text, [name, value]) => {
            return text.split(`\${${name}}`).join(String(value));
        }, template);
    }

    function timelineSnapshotCountText(count: number): string {
        return t("timeline_snapshot_count", "${count} 个时间线快照", { count });
    }

    function localizeAcceptReason(reason: string | undefined): string {
        if (!reason) return "";
        if (reason === "内容未变化") return t("timeline_accept_reason_unchanged", "内容未变化");
        if (reason === "复杂块仅支持查看或整篇回档") return t("timeline_accept_reason_complex_block", "复杂块仅支持查看或整篇回档");
        return reason;
    }

    async function loadTimeline() {
        if (!shouldAutoLoadTimeline()) return;
        loadingSnapshots = true;
        loadingDiff = true;
        error = "";
        clearDiff();
        loadedDocumentId = currentDocumentId;
        try {
            await refreshDocumentTitle();
            const data = await post<{ snapshots?: Snapshot[] }>("/api/repo/getRepoTagSnapshots", {});
            if (!shouldAutoLoadTimeline()) return;
            taggedSnapshots = await ensureRootTimelineSnapshot(sortSnapshotsNewestFirst((data.snapshots ?? []).filter(isTimelineSnapshot)));
            if (!shouldAutoLoadTimeline()) return;
            currentSnapshot = currentDocumentId ? await createCurrentSnapshot() : null;
            const entryContents: TimelineEntryContent[] = [];
            const contentCache = new Map<string, string>();
            if (currentSnapshot) {
                for (const snapshot of taggedSnapshots) {
                    if (snapshot.id === currentSnapshot.id) continue;
                    const diff = await post<Record<string, RepoSnapshotFileChange[] | unknown>>("/api/repo/diffRepoSnapshots", {
                        left: snapshot.id,
                        right: currentSnapshot.id,
                    });
                    const changedFile = findChangedFileForCurrentDocument(buildChangedFiles(diff));
                    if (!changedFile) {
                        if (isRootTimelineSnapshot(snapshot)) {
                            entryContents.push({
                                entry: createRootTimelineEntry(snapshot, currentSnapshot),
                                oldContent: ROOT_TIMELINE_SNAPSHOT_LABEL,
                                newContent: `${ROOT_TIMELINE_SNAPSHOT_LABEL}:${currentSnapshot.id}`,
                            });
                        }
                        continue;
                    }
                    const entry = createCurrentComparisonEntry(snapshot, currentSnapshot, changedFile);
                    const [oldSnapshotContent, newSnapshotContent] = await Promise.all([
                        readSnapshotFileContent(entry.oldFileId, contentCache),
                        readSnapshotFileContent(entry.newFileId, contentCache),
                    ]);
                    entryContents.push({
                        entry,
                        oldContent: oldSnapshotContent,
                        newContent: newSnapshotContent,
                    });
                }
            }

            timelineEntries = filterChangedUniqueTimelineEntries(entryContents);
            const nextEntry = selectInitialTimelineEntry(timelineEntries, currentDocumentId, selectedEntryKey);
            selectedEntryKey = nextEntry?.key ?? "";
            if (nextEntry) await loadTimelineEntry(nextEntry);
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            loadingSnapshots = false;
            loadingDiff = false;
        }
    }

    async function ensureRootTimelineSnapshot(snapshots: Snapshot[]): Promise<Snapshot[]> {
        if (!currentDocumentId || hasRootTimelineSnapshot(snapshots)) return snapshots;
        await post("/api/repo/createSnapshot", { memo: ROOT_TIMELINE_SNAPSHOT_LABEL });
        const snapshot = await findNewestSnapshotForMemo(ROOT_TIMELINE_SNAPSHOT_LABEL);
        if (!snapshot?.id) throw new Error(t("timeline_error_root_snapshot_not_found", "根快照已创建，但未能定位"));
        await post("/api/repo/tagSnapshot", {
            id: snapshot.id,
            name: createTimelineTagName(ROOT_TIMELINE_SNAPSHOT_LABEL, snapshots),
        });
        const data = await post<{ snapshots?: Snapshot[] }>("/api/repo/getRepoTagSnapshots", {});
        return sortSnapshotsNewestFirst((data.snapshots ?? []).filter(isTimelineSnapshot));
    }

    function hasRootTimelineSnapshot(snapshots: Snapshot[]): boolean {
        return snapshots.some((snapshot) => snapshotLabel(snapshot) === ROOT_TIMELINE_SNAPSHOT_LABEL);
    }

    function isRootTimelineSnapshot(snapshot: Snapshot): boolean {
        return snapshotLabel(snapshot) === ROOT_TIMELINE_SNAPSHOT_LABEL;
    }

    async function refreshDocumentTitle() {
        resolvedDocumentTitle = "";
        if (!currentDocumentId) return;
        const titleFromProp = getReadableDocumentTitle(currentDocumentTitle);
        if (titleFromProp) {
            resolvedDocumentTitle = titleFromProp;
            return;
        }
        try {
            const info = await post<Record<string, unknown>>("/api/block/getDocInfo", { id: currentDocumentId });
            resolvedDocumentTitle = getReadableDocumentTitle(firstReadableString([
                info.name,
                info.title,
                info.hPath,
                info.hpath,
                info.path,
            ]));
        } catch {
            resolvedDocumentTitle = "";
        }
    }

    async function createCurrentSnapshot(): Promise<Snapshot> {
        const text = `${CURRENT_SNAPSHOT_MEMO_PREFIX} ${currentDocumentId} ${new Date().toISOString()}`;
        await post("/api/repo/createSnapshot", { memo: text });
        const snapshot = await findNewestSnapshotForMemo(text);
        if (!snapshot?.id) throw new Error(t("timeline_error_current_snapshot_not_found", "当前状态快照已创建，但未能定位"));
        return snapshot;
    }

    function findChangedFileForCurrentDocument(files: ChangedSnapshotFile[]): ChangedSnapshotFile | undefined {
        return files.find((file) => getDocumentKey(file) === currentDocumentId);
    }

    function createCurrentComparisonEntry(snapshot: Snapshot, current: Snapshot, file: ChangedSnapshotFile): TimelineEntry {
        const oldFileId = getSnapshotFileId(file.oldFile);
        const newFileId = getSnapshotFileId(file.newFile);
        return {
            key: `${snapshot.id}:${current.id}:${currentDocumentId}:${oldFileId}:${newFileId}`,
            documentKey: currentDocumentId,
            title: file.title || currentDocumentTitle || currentDocumentId,
            kind: file.kind,
            snapshot,
            previousSnapshot: current,
            file,
            oldFileId,
            newFileId,
            hasDiff: true,
            updated: file.newFile?.updated ?? file.oldFile?.updated ?? snapshot.updated ?? snapshot.created,
        };
    }

    function createRootTimelineEntry(snapshot: Snapshot, current: Snapshot): TimelineEntry {
        return {
            key: `${snapshot.id}:${current.id}:${currentDocumentId}:root`,
            documentKey: currentDocumentId,
            title: currentDocumentTitle || currentDocumentId,
            kind: "modified",
            snapshot,
            previousSnapshot: current,
            file: {
                key: `${currentDocumentId}:root`,
                kind: "modified",
                title: currentDocumentTitle || currentDocumentId,
                documentId: currentDocumentId,
            },
            oldFileId: "",
            newFileId: "",
            hasDiff: false,
            updated: snapshot.updated ?? snapshot.created,
        };
    }

    async function createTimelineNode() {
        const text = memo.trim();
        if (!text) {
            showMessage(t("timeline_msg_name_required", "请先填写时间线节点名称"));
            return;
        }
        loadingSnapshots = true;
        error = "";
        try {
            await post("/api/repo/createSnapshot", { memo: text });
            const snapshot = await findNewestSnapshotForMemo(text);
            if (!snapshot?.id) throw new Error(t("timeline_error_new_snapshot_not_found", "快照已创建，但未能定位新快照"));
            await post("/api/repo/tagSnapshot", { id: snapshot.id, name: createTimelineTagName(text, taggedSnapshots) });
            memo = "";
            showMessage(t("timeline_msg_node_created", "时间线节点已创建"));
            await loadTimeline();
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            loadingSnapshots = false;
        }
    }

    async function findNewestSnapshotForMemo(text: string): Promise<Snapshot | undefined> {
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

    async function selectEntry(entry: TimelineEntry) {
        selectedEntryKey = entry.key;
        refreshingSelection = true;
        try {
            await refreshCurrentComparisonForSelection(entry.key);
        } finally {
            refreshingSelection = false;
        }
    }

    async function refreshCurrentComparisonForSelection(entryKey: string) {
        loadingDiff = true;
        error = "";
        try {
            currentSnapshot = currentDocumentId ? await createCurrentSnapshot() : null;
            if (!currentSnapshot) {
                clearDiff();
                return;
            }
            const baseEntry = timelineEntries.find((entry) => entry.key === entryKey);
            if (!baseEntry) return;
            const diff = await post<Record<string, RepoSnapshotFileChange[] | unknown>>("/api/repo/diffRepoSnapshots", {
                left: baseEntry.snapshot.id,
                right: currentSnapshot.id,
            });
            const changedFile = findChangedFileForCurrentDocument(buildChangedFiles(diff));
            if (!changedFile) {
                selectedEntryKey = "";
                clearDiff();
                return;
            }
            const refreshedEntry = createCurrentComparisonEntry(baseEntry.snapshot, currentSnapshot, changedFile);
            timelineEntries = timelineEntries.map((entry) => entry.key === entryKey ? refreshedEntry : entry);
            selectedEntryKey = refreshedEntry.key;
            await loadTimelineEntry(refreshedEntry);
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            loadingDiff = false;
        }
    }

    async function loadTimelineEntry(entry = selectedEntry) {
        if (!entry) return;
        loadingFile = true;
        error = "";
        try {
            const [oldData, newData] = await Promise.all([
                entry.oldFileId ? post<SnapshotFileContent>("/api/repo/openRepoSnapshotFile", { id: entry.oldFileId }) : Promise.resolve(null),
                entry.newFileId ? post<SnapshotFileContent>("/api/repo/openRepoSnapshotFile", { id: entry.newFileId }) : Promise.resolve(null),
            ]);
            oldFileContent = oldData;
            newFileContent = newData;
            oldContent = oldData?.content ?? "";
            newContent = newData?.content ?? "";
            blockEntries = diffSnapshotBlocks(oldContent, newContent);
            if (blockEntries.length === 0 && (oldContent || newContent)) {
                blockEntries = diffSnapshotBlocks(
                    createContentFallback(oldContent, t("timeline_old_content_empty_fallback", "左侧版本内容为空或无法解析")),
                    createContentFallback(newContent, t("timeline_new_content_empty_fallback", "右侧版本内容为空或无法解析")),
                );
            }
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            loadingFile = false;
            resetDocumentScrollSync();
        }
    }

    async function readSnapshotFileContent(fileId: string, cache: Map<string, string>): Promise<string> {
        if (!fileId) return "";
        if (cache.has(fileId)) return cache.get(fileId) ?? "";
        const data = await post<SnapshotFileContent>("/api/repo/openRepoSnapshotFile", { id: fileId });
        const content = data?.content ?? "";
        cache.set(fileId, content);
        return content;
    }

    async function rollbackBlock(entry: BlockDiffEntry) {
        if (!entry.canAcceptBlock) {
            showMessage(localizeAcceptReason(entry.acceptReason) || t("timeline_msg_block_restore_unsupported", "该块暂不支持块级回退"));
            return;
        }
        const confirmed = window.confirm(t("timeline_confirm_rollback_block", "将把「${title}」中的这个块回退到历史版本，继续吗？", { title: displayDocumentTitle }));
        if (!confirmed) return;

        applying = true;
        try {
            if (entry.status === "modified" && entry.newBlock?.id && entry.oldBlock) {
                const updatePayload = getUpdateBlockPayload(entry);
                await post("/api/block/updateBlock", {
                    id: entry.newBlock.id,
                    dataType: updatePayload.dataType,
                    data: updatePayload.data,
                });
            } else if (entry.status === "added" && entry.newBlock?.id) {
                await post("/api/block/deleteBlock", { id: entry.newBlock.id });
            } else if (entry.status === "removed" && entry.oldBlock) {
                const insertPlan = getRestoreInsertPlan(entry, blockEntries, {
                    documentId: currentDocumentId,
                    oldFile: selectedEntry?.file.oldFile,
                    newFile: selectedEntry?.file.newFile,
                });
                const parentIDs = insertPlan.parentIDs;
                if (parentIDs.length === 0) throw new Error(t("timeline_error_no_restore_position", "无法识别可恢复位置，不能安全恢复删除块"));
                let restored = false;
                let lastError: unknown;
                const restorePayload = getRestoreBlockPayload(entry);
                for (const parentID of parentIDs) {
                    try {
                        await post("/api/block/insertBlock", {
                            parentID,
                            ...(insertPlan.nextID ? { nextID: insertPlan.nextID } : {}),
                            ...(insertPlan.nextID ? {} : insertPlan.previousID ? { previousID: insertPlan.previousID } : {}),
                            dataType: restorePayload.dataType,
                            data: restorePayload.data,
                        });
                        restored = true;
                        break;
                    } catch (err) {
                        lastError = err;
                    }
                }
                if (!restored) throw lastError ?? new Error(t("timeline_error_restore_removed_block_failed", "无法恢复删除块"));
            }
            showMessage(t("timeline_msg_block_rolled_back", "块已回退"));
            await loadTimeline();
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            applying = false;
        }
    }

    async function rollbackDocument() {
        const id = selectedEntry?.oldFileId;
        if (!id) {
            showMessage(t("timeline_msg_no_rollback_version", "该时间线节点没有可回退的左侧版本"));
            return;
        }
        const confirmed = window.confirm(t("timeline_confirm_rollback_document", "这会把整个文档回退到历史版本。继续吗？"));
        if (!confirmed) return;
        applying = true;
        try {
            await post("/api/repo/rollbackRepoSnapshotFile", { id });
            showMessage(t("timeline_msg_document_rolled_back", "文档已回退到历史版本"));
            await loadTimelineEntry();
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            applying = false;
        }
    }

    function clearDiff() {
        oldContent = "";
        newContent = "";
        oldFileContent = null;
        newFileContent = null;
        blockEntries = [];
        lastSyncedDocumentBlockId = "";
    }

    function blockText(block: BlockDiffEntry["oldBlock"]): string {
        return block?.markdown || block?.text || "";
    }

    function createContentFallback(content: string, fallback: string): string {
        const text = content.trim();
        return text || fallback;
    }

    function getReadableDocumentTitle(value: string | undefined): string {
        if (!value) return "";
        const trimmed = value.trim();
        if (!trimmed || /^[0-9]{14}-[a-z0-9]{7}$/i.test(trimmed)) return "";
        const segment = trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
        return segment.replace(/\.sy$/i, "");
    }

    function firstReadableString(values: unknown[]): string {
        for (const value of values) {
            if (typeof value !== "string") continue;
            const readable = getReadableDocumentTitle(value);
            if (readable) return readable;
        }
        return "";
    }

    function getErrorMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }
</script>

<div
    bind:this={shellElement}
    class:force-expanded={forceTimelineExpanded}
    class:timeline-collapsed={effectiveTimelineCollapsed}
    class:timeline-only={!diffOpen}
    class="vc-shell"
>
    <main class="vc-main">
        <div class="vc-toolbar">
            <div class="vc-toolbar__meta">
                <strong>{displayDocumentTitle}</strong>
                {#if diffOpen}
                    <span class="vc-change-summary" aria-label={changeSummaryLabel}>
                        <span class="added">+{diffLineStats.added}</span>
                        <span class="removed">-{diffLineStats.removed}</span>
                    </span>
                {/if}
                <span class="vc-snapshot-count">{timelineSnapshotCountText(taggedSnapshots.length)}</span>
                {#if showDebugMeta && currentDocumentId}
                    <span class="vc-debug-id">{currentDocumentId}</span>
                {/if}
            </div>
            <div class="vc-toolbar__actions">
                <button type="button" class:active={documentScrollSyncEnabled} class="vc-icon-button" on:click={toggleDocumentScrollSync} disabled={!diffOpen || loadingFile} title={documentScrollSyncTitle} aria-label={documentScrollSyncTitle}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M7.5 5.5h9M7.5 18.5h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                        <path d="M12 8.5v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                        <path d="m9.5 13.2 2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button type="button" class="vc-icon-button" on:click={toggleAllHiddenBlocks} disabled={!hasHiddenBlocks} title={hiddenToggleTitle} aria-label={hiddenToggleTitle}>
                    {#if allHiddenExpanded}
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="m8 14 4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M6 18h12M6 6h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    {:else}
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M6 18h12M6 6h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    {/if}
                </button>
                <button type="button" class="vc-icon-button" on:click={toggleCompareMode} title={compareModeTitle} aria-label={compareModeAction}>
                    {#if compareMode === "unified"}
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M4.5 5.5h6v13h-6zM13.5 5.5h6v13h-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                            <path d="M6.7 9h1.6M15.7 9h1.6M6.7 12h1.6M15.7 12h1.6M6.7 15h1.6M15.7 15h1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                        </svg>
                    {:else}
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M5 5.5h14v13H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                            <path d="M8 9h8M8 12h8M8 15h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                        </svg>
                    {/if}
                </button>
                <button type="button" class="vc-icon-button" on:click={rollbackDocument} disabled={!selectedEntry?.oldFileId || applying} title={t("timeline_action_rollback_document", "整篇回退到历史版本")} aria-label={t("timeline_action_rollback_document", "整篇回退到历史版本")}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M10.8 3.5h3.95L19 7.75v10.5A2.25 2.25 0 0 1 16.75 20.5h-8.5A2.25 2.25 0 0 1 6 18.25V9.9" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M14.5 3.75V8h4.25" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M4.8 9.4V8.5A5 5 0 0 1 9.8 3.5h.65" fill="none" stroke="currentColor" stroke-width="2.05" stroke-linecap="round"/>
                        <path d="M2 6.55 4.8 9.4l2.85-2.85" fill="none" stroke="currentColor" stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button type="button" class="vc-icon-button" on:click={toggleTimelineCollapsed} title={autoTimelineCollapsed ? t("timeline_auto_collapsed_title", "窗口过窄，时间线已自动折叠") : effectiveTimelineCollapsed ? t("timeline_action_expand", "展开时间线") : t("timeline_action_collapse", "折叠时间线")} aria-label={autoTimelineCollapsed ? t("timeline_auto_collapsed_title", "窗口过窄，时间线已自动折叠") : effectiveTimelineCollapsed ? t("timeline_action_expand", "展开时间线") : t("timeline_action_collapse", "折叠时间线")}>
                    {effectiveTimelineCollapsed ? "‹" : "›"}
                </button>
            </div>
        </div>

        {#if error}
            <div class="vc-error">{error}</div>
        {/if}

        <div class="vc-content">
            <section bind:this={diffElement} on:scroll={handleDiffScroll} on:click={handleDiffClick} class:unified-mode={compareMode === "unified"} class:split-mode={compareMode === "split"} class="vc-diff">
                {#if loadingFile}
                    <div class="vc-empty">{t("timeline_loading_snapshot_file", "正在打开快照文件...")}</div>
                {:else if !selectedEntry}
                    <div class="vc-empty">{refreshingSelection ? t("timeline_loading_current_diff", "正在创建当前版本并加载差异...") : t("timeline_empty_select_node", "选择右侧时间线节点，查看历史版本与当前状态的差异")}</div>
                {:else}
                    <div class:unified={compareMode === "unified"} class="vc-diff-head">
                        {#if compareMode === "unified"}
                            <div class="vc-diff-head-cell vc-version-line">
                                <div class="vc-version-card old">
                                    <span class="vc-version-label">{t("timeline_history_version", "历史版本")}</span>
                                    {#if selectedSnapshotTitle}<strong>{selectedSnapshotTitle}</strong>{/if}
                                    {#if selectedSnapshotTime}<time>{selectedSnapshotTime}</time>{/if}
                                </div>
                                <span class="vc-version-arrow" aria-hidden="true">→</span>
                                <div class="vc-version-card current">
                                    <span class="vc-version-label">{t("timeline_current_state", "当前状态")}</span>
                                    {#if currentVersionTime}<time>{currentVersionTime}</time>{/if}
                                </div>
                            </div>
                        {:else}
                            <div class="vc-diff-head-cell">
                                <div class="vc-version-card old">
                                    <span class="vc-version-label">{t("timeline_history_version", "历史版本")}</span>
                                    {#if selectedSnapshotTitle}<strong>{selectedSnapshotTitle}</strong>{/if}
                                    {#if selectedSnapshotTime}<time>{selectedSnapshotTime}</time>{/if}
                                </div>
                            </div>
                            <div class="vc-diff-head-cell vc-diff-head-arrow" aria-hidden="true">→</div>
                            <div class="vc-diff-head-cell">
                                <div class="vc-version-card current">
                                    <span class="vc-version-label">{t("timeline_current_state", "当前状态")}</span>
                                    {#if currentVersionTime}<time>{currentVersionTime}</time>{/if}
                                </div>
                            </div>
                        {/if}
                    </div>
                    {#if blockEntries.length === 0}
                        <div class="vc-empty">{selectedEntry.hasDiff === false ? t("timeline_empty_no_diff", "该节点暂无可显示差异。") : t("timeline_empty_unparseable_file", "该文件内容为空，或当前快照内容暂无法解析为可显示块。")}</div>
                    {/if}
                    {#if compareMode === "unified"}
                        <div class="vc-unified-list">
                            {#each diffDisplayItems as item (item.key)}
                                {#if item.kind === "hidden"}
                                    <div class="vc-hidden-blocks" data-sync-block-id={getHiddenSyncBlockId(item)}>
                                        <button type="button" on:click={() => toggleHiddenBlock(item.key)} title={expandedHiddenKeys.has(item.key) ? t("timeline_action_collapse_hidden", "折叠隐藏块") : t("timeline_action_expand_hidden", "展开隐藏块")} aria-label={expandedHiddenKeys.has(item.key) ? t("timeline_action_collapse_hidden", "折叠隐藏块") : t("timeline_action_expand_hidden", "展开隐藏块")}>
                                            <span>{expandedHiddenKeys.has(item.key) ? "⌃" : "⌄"}</span>
                                            <strong>{hiddenBlocksText(item.count)}</strong>
                                        </button>
                                    </div>
                                    {#if expandedHiddenKeys.has(item.key)}
                                        {#each item.entries as hiddenEntry (hiddenEntry.key)}
                                            <article class="vc-unified-block unchanged expanded-hidden" data-sync-block-id={getEntrySyncBlockId(hiddenEntry)}>
                                                {#if showDebugMeta}
                                                    <div class="vc-block__meta">
                                                        <span>{hiddenEntry.entry.status}</span>
                                                        {#if hiddenEntry.entry.oldBlock?.id}<code>{hiddenEntry.entry.oldBlock.id}</code>{/if}
                                                        {#if hiddenEntry.entry.newBlock?.id}<code>{hiddenEntry.entry.newBlock.id}</code>{/if}
                                                    </div>
                                                {/if}
                                                <div class="vc-unified-row unchanged">
                                                    <span class="vc-line-marker"> </span>
                                                    <div class="vc-line-content">
                                                        <pre>{blockText(hiddenEntry.entry.newBlock ?? hiddenEntry.entry.oldBlock)}</pre>
                                                    </div>
                                                </div>
                                            </article>
                                        {/each}
                                    {/if}
                                {:else}
                                    <article class="vc-unified-block {item.entry.status}" class:first-change={item.changeIndex === 0} data-sync-block-id={getEntrySyncBlockId(item)}>
                                        {#if showDebugMeta}
                                            <div class="vc-block__meta">
                                                <span>{item.entry.status}</span>
                                                {#if item.entry.oldBlock?.id}<code>{item.entry.oldBlock.id}</code>{/if}
                                                {#if item.entry.newBlock?.id}<code>{item.entry.newBlock.id}</code>{/if}
                                            </div>
                                        {/if}
                                        {#if item.entry.status !== "unchanged"}
                                            <div class:first-change={item.changeIndex === 0} class="vc-unified-actions">
                                                <button type="button" class="vc-restore-button" on:click={() => rollbackBlock(item.entry)} disabled={applying || !item.entry.canAcceptBlock} title={t("timeline_action_restore_block", "还原块")} aria-label={t("timeline_action_restore_block", "还原块")}>
                                                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                                        <path d="M9 7 4 12l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                                        <path d="M5 12h9.5A5.5 5.5 0 0 1 20 17.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                                    </svg>
                                                </button>
                                                {#if item.entry.acceptReason}
                                                    <small>{localizeAcceptReason(item.entry.acceptReason)}</small>
                                                {/if}
                                            </div>
                                        {/if}
                                        {#if item.entry.status === "removed" || item.entry.status === "modified"}
                                            <div class="vc-unified-row removed">
                                                <span class="vc-line-marker">-</span>
                                                <div class="vc-line-content">
                                                    {#if item.entry.oldParts}
                                                        <div class="vc-inline-diff">
                                                            {#each item.entry.oldParts as part}
                                                                <span class="vc-diff-part {part.kind}">{part.text}</span>
                                                            {/each}
                                                        </div>
                                                    {:else}
                                                        <pre>{blockText(item.entry.oldBlock)}</pre>
                                                    {/if}
                                                </div>
                                            </div>
                                        {/if}
                                        {#if item.entry.status === "added" || item.entry.status === "modified"}
                                            <div class="vc-unified-row added">
                                                <span class="vc-line-marker">+</span>
                                                <div class="vc-line-content">
                                                    {#if item.entry.newParts}
                                                        <div class="vc-inline-diff">
                                                            {#each item.entry.newParts as part}
                                                                <span class="vc-diff-part {part.kind}">{part.text}</span>
                                                            {/each}
                                                        </div>
                                                    {:else}
                                                        <pre>{blockText(item.entry.newBlock)}</pre>
                                                    {/if}
                                                </div>
                                            </div>
                                        {/if}
                                        {#if item.entry.status === "unchanged"}
                                            <div class="vc-unified-row unchanged">
                                                <span class="vc-line-marker"> </span>
                                                <div class="vc-line-content">
                                                    <pre>{blockText(item.entry.newBlock ?? item.entry.oldBlock)}</pre>
                                                </div>
                                            </div>
                                        {/if}
                                    </article>
                                {/if}
                            {/each}
                        </div>
                    {:else}
                        <div class="vc-diff-grid">
                            {#each diffDisplayItems as item (item.key)}
                                {#if item.kind === "hidden"}
                                    <div class="vc-hidden-blocks split" data-sync-block-id={getHiddenSyncBlockId(item)}>
                                        <button type="button" on:click={() => toggleHiddenBlock(item.key)} title={expandedHiddenKeys.has(item.key) ? t("timeline_action_collapse_hidden", "折叠隐藏块") : t("timeline_action_expand_hidden", "展开隐藏块")} aria-label={expandedHiddenKeys.has(item.key) ? t("timeline_action_collapse_hidden", "折叠隐藏块") : t("timeline_action_expand_hidden", "展开隐藏块")}>
                                            <span>{expandedHiddenKeys.has(item.key) ? "⌃" : "⌄"}</span>
                                            <strong>{hiddenBlocksText(item.count)}</strong>
                                        </button>
                                    </div>
                                    {#if expandedHiddenKeys.has(item.key)}
                                        {#each item.entries as hiddenEntry (hiddenEntry.key)}
                                            <div class="vc-diff-row expanded-hidden">
                                                <article class="vc-block old unchanged">
                                                    {#if showDebugMeta}
                                                        <div class="vc-block__meta">
                                                            <span>{hiddenEntry.entry.status}</span>
                                                            {#if hiddenEntry.entry.oldBlock?.id}<code>{hiddenEntry.entry.oldBlock.id}</code>{/if}
                                                        </div>
                                                    {/if}
                                                    <pre>{hiddenEntry.entry.oldBlock?.markdown || hiddenEntry.entry.oldBlock?.text || ""}</pre>
                                                </article>
                                                <div class="vc-restore-column unchanged"></div>
                                                <article class="vc-block new unchanged" data-sync-block-id={getEntrySyncBlockId(hiddenEntry)}>
                                                    {#if showDebugMeta}
                                                        <div class="vc-block__meta">
                                                            <span>{hiddenEntry.entry.status}</span>
                                                            {#if hiddenEntry.entry.newBlock?.id}<code>{hiddenEntry.entry.newBlock.id}</code>{/if}
                                                        </div>
                                                    {/if}
                                                    <pre>{hiddenEntry.entry.newBlock?.markdown || hiddenEntry.entry.newBlock?.text || ""}</pre>
                                                </article>
                                            </div>
                                        {/each}
                                    {/if}
                                {:else}
                                    <div class="vc-diff-row" class:first-change={item.changeIndex === 0}>
                                        <article class="vc-block old {item.entry.status}">
                                            {#if showDebugMeta}
                                                <div class="vc-block__meta">
                                                    <span>{item.entry.status}</span>
                                                    {#if item.entry.oldBlock?.id}<code>{item.entry.oldBlock.id}</code>{/if}
                                                </div>
                                            {/if}
                                            {#if item.entry.oldParts}
                                                <div class="vc-inline-diff">
                                                    {#each item.entry.oldParts as part}
                                                        <span class="vc-diff-part {part.kind}">{part.text}</span>
                                                    {/each}
                                                </div>
                                            {:else}
                                                <pre>{item.entry.oldBlock?.markdown || item.entry.oldBlock?.text || (item.entry.status === "added" ? t("timeline_old_missing_for_added", "当前新增，历史无内容") : "")}</pre>
                                            {/if}
                                        </article>
                                        <div class="vc-restore-column {item.entry.status}">
                                            {#if item.entry.status !== "unchanged"}
                                                <button type="button" class:first-change={item.changeIndex === 0} class="vc-restore-button" on:click={() => rollbackBlock(item.entry)} disabled={applying || !item.entry.canAcceptBlock} title={t("timeline_action_restore_block", "还原块")} aria-label={t("timeline_action_restore_block", "还原块")}>
                                                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                                        <path d="M9 7 4 12l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                                        <path d="M5 12h9.5A5.5 5.5 0 0 1 20 17.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                                    </svg>
                                                </button>
                                                {#if item.entry.acceptReason}
                                                    <small>{localizeAcceptReason(item.entry.acceptReason)}</small>
                                                {/if}
                                            {/if}
                                        </div>
                                        <article class="vc-block new {item.entry.status}" data-sync-block-id={getEntrySyncBlockId(item)}>
                                            {#if showDebugMeta}
                                                <div class="vc-block__meta">
                                                    <span>{item.entry.status}</span>
                                                    {#if item.entry.newBlock?.id}<code>{item.entry.newBlock.id}</code>{/if}
                                                </div>
                                            {/if}
                                            {#if item.entry.newParts}
                                                <div class="vc-inline-diff">
                                                    {#each item.entry.newParts as part}
                                                        <span class="vc-diff-part {part.kind}">{part.text}</span>
                                                    {/each}
                                                </div>
                                            {:else}
                                                <pre>{item.entry.newBlock?.markdown || item.entry.newBlock?.text || (item.entry.status === "removed" ? t("timeline_new_missing_for_removed", "历史存在，当前已删除") : "")}</pre>
                                            {/if}
                                        </article>
                                    </div>
                                {/if}
                            {/each}
                        </div>
                    {/if}
                {/if}
            </section>
            {#if diffOpen && !loadingFile && diffMinimapItems.length > 0}
                <div class="vc-diff-minimap" aria-hidden="true">
                    <span class="viewport" style={`top: ${diffViewportTop}%; height: ${diffViewportHeight}%;`}></span>
                    {#each diffMinimapItems as item (item.key)}
                        <span
                            class:added={item.entry.status === "added"}
                            class:removed={item.entry.status === "removed"}
                            class:modified={item.entry.status === "modified"}
                            style={`top: ${minimapTop(item)}%; height: ${minimapHeight(item)}%;`}
                        ></span>
                    {/each}
                </div>
            {/if}
        </div>
    </main>

    <aside class:collapsed={effectiveTimelineCollapsed} class="vc-sidebar">
        {#if !effectiveTimelineCollapsed}
            {#if !diffOpen}
                <section class="vc-section vc-document-heading">
                    <div class="vc-section__title">{displayDocumentTitle}</div>
                    {#if showDebugMeta && currentDocumentId}
                        <code>{currentDocumentId}</code>
                    {/if}
                    <small>{timelineSnapshotCountText(taggedSnapshots.length)}</small>
                </section>
            {/if}

            <section class="vc-section">
                <div class="vc-section__title">{t("timeline_snapshot_section_title", "Snapshot")}</div>
                <textarea bind:value={memo} rows="3" placeholder={t("timeline_node_placeholder", "例如 feat：重构文档工具")}></textarea>
                <button type="button" class="vc-primary" on:click={createTimelineNode} disabled={loadingSnapshots}>{t("timeline_action_create_node", "创建节点")}</button>
            </section>

            <section class="vc-section">
                <div class="vc-section__title">{t("timeline_section_title", "Timeline")}</div>
                {#if loadingSnapshots || loadingDiff}
                    <div class="vc-empty compact">{t("timeline_loading", "加载中...")}</div>
                {:else if !currentDocumentId}
                    <div class="vc-empty compact">{t("timeline_no_document", "未检测到可用文档")}</div>
                {:else if documentEntries.length === 0}
                    <div class="vc-empty compact">{t("timeline_no_nodes_for_document", "「${title}」暂无时间线节点", { title: displayDocumentTitle })}</div>
                {:else}
                    <div class="vc-timeline">
                        {#each documentEntries as entry}
                            <button type="button" class:selected={entry.key === selectedEntryKey} on:click={() => selectEntry(entry)}>
                                <span class:added={entry.kind === "added"} class:removed={entry.kind === "removed"} class:modified={entry.kind === "modified"}></span>
                                <strong>
                                    <em>{snapshotLabel(entry.snapshot)}</em>
                                    {#if formatSnapshotTime(entry.snapshot)}
                                        <small>{formatSnapshotTime(entry.snapshot)}</small>
                                    {/if}
                                </strong>
                                {#if showDebugMeta}
                                    <small>{entry.kind}</small>
                                {/if}
                            </button>
                        {/each}
                    </div>
                {/if}
            </section>
        {/if}
    </aside>
</div>

<style>
    .vc-shell {
        position: relative;
        isolation: isolate;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 320px;
        height: 100%;
        min-height: 360px;
        overflow: hidden;
        color: var(--b3-theme-on-background);
        background: var(--b3-theme-background);
    }

    .vc-shell.timeline-collapsed {
        grid-template-columns: minmax(0, 1fr);
    }

    .vc-shell.timeline-only {
        grid-template-columns: minmax(280px, 420px);
        justify-content: end;
    }

    .vc-shell.force-expanded {
        min-width: 0;
    }

    .vc-shell.timeline-only:not(.timeline-collapsed) .vc-main {
        display: none;
    }

    .vc-sidebar {
        position: relative;
        z-index: 2;
        grid-column: 2;
        min-height: 0;
        box-sizing: border-box;
        border-left: 1px solid var(--b3-border-color);
        padding: 12px;
        overflow: auto;
        background: var(--b3-theme-background);
    }

    .vc-sidebar.collapsed {
        display: none;
    }

    .vc-section {
        display: grid;
        gap: 8px;
        margin-bottom: 18px;
    }

    .vc-section__title {
        font-weight: 600;
        font-size: 13px;
    }

    .vc-document-heading code {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--b3-theme-on-surface);
        font-family: var(--b3-font-family-code);
        font-size: 11px;
    }

    textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 8px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        resize: vertical;
    }

    button {
        min-height: 30px;
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 4px 10px;
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        cursor: pointer;
    }

    .vc-icon-button {
        width: 30px;
        min-width: 30px;
        padding: 0;
        text-align: center;
        font-size: 18px;
        line-height: 1;
    }

    .vc-icon-button svg {
        width: 19px;
        height: 19px;
        vertical-align: middle;
    }

    .vc-icon-button.active {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 52%, var(--b3-border-color));
        background: color-mix(in srgb, var(--b3-theme-primary) 12%, var(--b3-theme-surface));
        color: var(--b3-theme-primary);
    }

    button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
    }

    .vc-primary {
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
        border-color: var(--b3-theme-primary);
    }

    .vc-timeline {
        display: grid;
        gap: 6px;
    }

    .vc-timeline button {
        display: grid;
        grid-template-columns: 12px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        text-align: left;
    }

    .vc-timeline button.selected {
        border-color: var(--b3-theme-primary);
        background: var(--b3-list-hover);
    }

    .vc-timeline strong {
        display: grid;
        gap: 2px;
        overflow: hidden;
        font-size: 12px;
    }

    .vc-timeline strong em,
    .vc-timeline strong small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .vc-timeline strong em {
        font-style: normal;
    }

    .vc-timeline strong small {
        margin: 0;
        font-weight: 400;
    }

    .vc-timeline span {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--b3-theme-on-surface);
    }

    .vc-timeline small {
        margin: 0;
        color: var(--b3-theme-on-surface);
        font-size: 11px;
    }

    .vc-timeline .added {
        background: #2ea043;
    }

    .vc-timeline .removed {
        background: #f85149;
    }

    .vc-timeline .modified {
        background: #d29922;
    }

    .vc-main {
        position: relative;
        z-index: 20;
        grid-column: 1;
        min-width: 0;
        min-height: 0;
        height: 100%;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        overflow: hidden;
    }

    .vc-toolbar {
        position: relative;
        z-index: 10;
        background: var(--b3-theme-background);
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        border-bottom: 1px solid var(--b3-border-color);
        padding: 10px 12px;
    }

    .vc-toolbar__meta {
        display: flex;
        gap: 8px;
        align-items: baseline;
        flex-wrap: wrap;
        min-width: 0;
    }

    .vc-toolbar__meta strong,
    .vc-toolbar__meta > span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .vc-toolbar__meta strong {
        display: inline-block;
        max-width: 100%;
        vertical-align: bottom;
    }

    .vc-toolbar__meta > span {
        max-width: min(38vw, 260px);
        color: var(--b3-theme-on-surface);
        font-size: 12px;
    }

    .vc-toolbar__meta > .vc-change-summary {
        display: inline-flex;
        gap: 4px;
        max-width: none;
        font-family: var(--b3-font-family-code);
        font-size: 14px;
        font-weight: 700;
    }

    .vc-change-summary .added {
        color: #00c853;
    }

    .vc-change-summary .removed {
        color: #ff624a;
    }

    .vc-toolbar__actions {
        position: relative;
        z-index: 30;
        display: flex;
        flex: 0 0 auto;
        gap: 8px;
        align-items: center;
    }

    .vc-error {
        margin: 10px 12px 0;
        padding: 8px 10px;
        border: 1px solid var(--b3-theme-error);
        border-radius: 6px;
        color: var(--b3-theme-error);
    }

    .vc-content {
        position: relative;
        z-index: 0;
        min-height: 0;
        height: 100%;
        overflow: hidden;
    }

    .vc-diff {
        position: relative;
        min-width: 0;
        height: 100%;
        overflow: auto;
    }

    .vc-diff-head,
    .vc-diff-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) clamp(22px, 4%, 42px) minmax(0, 1fr);
    }

    .vc-diff-head {
        position: sticky;
        top: 0;
        z-index: 1;
        background: color-mix(in srgb, var(--b3-theme-surface) 82%, var(--b3-theme-background));
        border-bottom: 1px solid var(--b3-border-color);
        font-size: 12px;
        color: var(--b3-theme-on-surface);
    }

    .vc-diff-head-cell {
        min-width: 0;
        padding: 6px 12px;
    }

    .vc-diff-head.unified {
        grid-template-columns: minmax(0, 1fr);
    }

    .vc-version-line {
        display: grid;
        grid-template-columns: minmax(0, auto) 24px minmax(0, auto);
        gap: 8px;
        align-items: center;
        justify-content: start;
    }

    .vc-version-card {
        display: flex;
        min-width: 0;
        max-width: 100%;
        align-items: baseline;
        gap: 6px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--b3-border-color) 78%, transparent);
        border-radius: 6px;
        padding: 5px 8px;
        background: color-mix(in srgb, var(--b3-theme-background) 78%, transparent);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
    }

    .vc-version-card.old {
        border-color: color-mix(in srgb, var(--b3-theme-on-surface) 24%, var(--b3-border-color));
    }

    .vc-version-card.current {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 38%, var(--b3-border-color));
        background: color-mix(in srgb, var(--b3-theme-primary) 8%, var(--b3-theme-background));
    }

    .vc-version-label {
        flex: none;
        color: var(--b3-theme-on-surface-light, var(--b3-theme-on-surface));
        font-size: 11px;
        font-weight: 600;
    }

    .vc-version-card strong,
    .vc-version-card time {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .vc-version-card strong {
        color: var(--b3-theme-on-background);
        font-weight: 650;
    }

    .vc-version-card time {
        color: var(--b3-theme-on-surface);
        font-variant-numeric: tabular-nums;
    }

    .vc-version-arrow,
    .vc-diff-head-arrow {
        color: var(--b3-theme-primary);
        font-size: 15px;
        font-weight: 700;
        text-align: center;
    }

    .vc-diff-head-arrow {
        display: flex;
        align-items: center;
        justify-content: center;
        padding-inline: 0;
    }

    .vc-unified-list {
        display: grid;
        padding-right: 16px;
    }

    .vc-hidden-blocks {
        min-height: 26px;
        border-top: 1px solid rgba(128, 128, 128, 0.12);
        border-bottom: 1px solid rgba(128, 128, 128, 0.12);
        background: color-mix(in srgb, var(--b3-theme-surface) 72%, transparent);
        color: var(--b3-theme-on-surface);
        font-size: 12px;
    }

    .vc-hidden-blocks button {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        width: 100%;
        min-height: 26px;
        border: 0;
        border-radius: 0;
        padding: 2px 12px;
        background: transparent;
        color: inherit;
        text-align: left;
    }

    .vc-hidden-blocks button:hover,
    .vc-hidden-blocks button:focus-visible {
        background: var(--b3-list-hover);
    }

    .vc-hidden-blocks span {
        color: var(--b3-theme-on-surface-light, var(--b3-theme-on-surface));
        font-family: var(--b3-font-family-code);
        font-size: 15px;
        line-height: 1;
    }

    .vc-hidden-blocks strong {
        font-weight: 500;
    }

    .vc-hidden-blocks.split {
        grid-column: 1 / -1;
    }

    .expanded-hidden {
        opacity: 0.86;
    }

    .vc-unified-block {
        position: relative;
        min-width: 0;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .vc-unified-block.modified,
    .vc-unified-block.added,
    .vc-unified-block.removed {
        padding-right: 34px;
    }

    .vc-unified-row {
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr);
        min-width: 0;
    }

    .vc-unified-row.removed {
        background: rgba(248, 81, 73, 0.18);
    }

    .vc-unified-row.added {
        background: rgba(46, 160, 67, 0.18);
    }

    .vc-unified-row.unchanged {
        background: var(--b3-theme-background);
    }

    .vc-line-marker {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        min-width: 0;
        padding: 4px 0;
        border-right: 1px solid var(--b3-border-color);
        color: var(--b3-theme-on-surface);
        font-family: var(--b3-font-family-code);
        font-size: 12px;
        line-height: 1.4;
        user-select: none;
    }

    .vc-unified-row.removed .vc-line-marker {
        color: #ff624a;
    }

    .vc-unified-row.added .vc-line-marker {
        color: #00c853;
    }

    .vc-line-content {
        min-width: 0;
        padding: 1px 10px;
    }

    .vc-unified-actions {
        position: absolute;
        top: 50%;
        right: 8px;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        align-items: center;
        justify-content: center;
        height: 100%;
        opacity: 0;
        transform: translateY(-50%);
        transition: opacity 0.15s ease;
    }

    .vc-unified-actions::before,
    .vc-unified-actions::after {
        content: "";
        position: absolute;
        left: 50%;
        width: 2px;
        transform: translateX(-50%);
        border-radius: 999px;
        background: rgba(128, 128, 128, 0.48);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
    }

    .vc-unified-actions::before {
        top: 8px;
        bottom: calc(50% + 16px);
    }

    .vc-unified-actions::after {
        top: calc(50% + 16px);
        bottom: 8px;
    }

    .vc-unified-block:hover .vc-unified-actions::before,
    .vc-unified-block:hover .vc-unified-actions::after,
    .vc-unified-actions:focus-within::before,
    .vc-unified-actions:focus-within::after {
        opacity: 1;
    }

    .vc-unified-block:hover .vc-unified-actions,
    .vc-unified-actions:focus-within,
    .vc-unified-actions.first-change {
        opacity: 1;
    }

    .vc-restore-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        min-width: 24px;
        min-height: 24px;
        border: 1px solid transparent;
        border-radius: 5px;
        padding: 0;
        background: transparent;
        color: var(--b3-theme-on-surface);
        position: relative;
        z-index: 1;
    }

    .vc-restore-button svg {
        width: 15px;
        height: 15px;
    }

    .vc-restore-button:hover:not(:disabled),
    .vc-restore-button:focus-visible {
        border-color: var(--b3-border-color);
        background: var(--b3-list-hover);
        color: var(--b3-theme-primary);
    }

    .vc-unified-actions small {
        max-width: 36px;
        margin: 0;
        overflow: hidden;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .vc-block {
        min-width: 0;
        border-bottom: 1px solid var(--b3-border-color);
        padding: 4px 10px;
    }

    .vc-diff-row {
        display: contents;
    }

    .vc-restore-column {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: center;
        justify-content: center;
        min-width: 0;
        border-bottom: 1px solid var(--b3-border-color);
        border-left: 1px solid var(--b3-border-color);
        border-right: 1px solid var(--b3-border-color);
        padding: 4px 4px;
        background: var(--b3-theme-background);
    }

    .vc-restore-column.modified::before,
    .vc-restore-column.added::before,
    .vc-restore-column.removed::before,
    .vc-restore-column.modified::after,
    .vc-restore-column.added::after,
    .vc-restore-column.removed::after {
        content: "";
        position: absolute;
        left: 50%;
        width: 2px;
        transform: translateX(-50%);
        border-radius: 999px;
        background: rgba(128, 128, 128, 0.48);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
    }

    .vc-restore-column.modified::before,
    .vc-restore-column.added::before,
    .vc-restore-column.removed::before {
        top: 8px;
        bottom: calc(50% + 16px);
    }

    .vc-restore-column.modified::after,
    .vc-restore-column.added::after,
    .vc-restore-column.removed::after {
        top: calc(50% + 16px);
        bottom: 8px;
    }

    .vc-block:hover + .vc-restore-column::before,
    .vc-block:hover + .vc-restore-column::after,
    .vc-restore-column:has(+ .vc-block:hover)::before,
    .vc-restore-column:has(+ .vc-block:hover)::after,
    .vc-restore-column:hover::before,
    .vc-restore-column:hover::after,
    .vc-restore-column:focus-within::before,
    .vc-restore-column:focus-within::after {
        opacity: 1;
    }

    .vc-restore-column .vc-restore-button {
        opacity: 0;
    }

    .vc-block:hover + .vc-restore-column .vc-restore-button,
    .vc-restore-column:has(+ .vc-block:hover) .vc-restore-button,
    .vc-restore-column:hover .vc-restore-button,
    .vc-restore-column:focus-within .vc-restore-button,
    .vc-restore-column .vc-restore-button.first-change {
        opacity: 1;
    }

    .vc-restore-column small {
        max-width: 32px;
        margin: 0;
        overflow: hidden;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .vc-block.old.modified,
    .vc-block.old.removed {
        background: rgba(248, 81, 73, 0.14);
    }

    .vc-block.new.modified,
    .vc-block.new.added {
        background: rgba(46, 160, 67, 0.14);
    }

    .vc-block__meta {
        display: flex;
        gap: 8px;
        align-items: center;
        min-height: 20px;
        font-size: 11px;
        color: var(--b3-theme-on-surface);
    }

    .vc-block__meta code {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    pre,
    .vc-inline-diff {
        min-height: 18px;
        margin: 1px 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: var(--b3-font-family-code);
        font-size: 12px;
        line-height: 1.42;
    }

    .vc-diff-part {
        border-radius: 3px;
    }

    .vc-diff-part.removed {
        background: rgba(248, 81, 73, 0.28);
        text-decoration: line-through;
        text-decoration-thickness: 1px;
    }

    .vc-diff-part.added {
        background: rgba(46, 160, 67, 0.28);
    }

    .vc-diff-minimap {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        z-index: 3;
        width: 16px;
        min-height: 120px;
        border-left: 1px solid rgba(128, 128, 128, 0.18);
        background: color-mix(in srgb, var(--b3-theme-surface) 58%, transparent);
        pointer-events: none;
    }

    .vc-diff-minimap span {
        position: absolute;
        left: 2px;
        right: 0;
        min-height: 4px;
        opacity: 0.42;
    }

    .vc-diff-minimap .viewport {
        left: 1px;
        right: 1px;
        z-index: 2;
        min-height: 22px;
        border: 1px solid rgba(235, 235, 235, 0.58);
        border-radius: 4px;
        background: rgba(135, 142, 152, 0.42);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.24), 0 0 5px rgba(255, 255, 255, 0.12);
        box-sizing: border-box;
        opacity: 1;
    }

    .vc-diff-minimap .added {
        background: rgba(46, 160, 67, 0.52);
    }

    .vc-diff-minimap .removed {
        background: rgba(248, 81, 73, 0.5);
    }

    .vc-diff-minimap .modified {
        background: linear-gradient(90deg, rgba(248, 81, 73, 0.5) 0 45%, rgba(46, 160, 67, 0.52) 55% 100%);
    }

    small {
        display: block;
        margin-top: 6px;
        color: var(--b3-theme-on-surface);
    }

    .vc-empty {
        padding: 16px;
        color: var(--b3-theme-on-surface);
        font-size: 13px;
    }

    .vc-empty.compact {
        padding: 8px 0;
    }

    @media (max-width: 900px) {
        .vc-shell {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: auto minmax(0, 1fr);
            height: 100%;
        }

        .vc-shell.timeline-collapsed {
            grid-template-rows: minmax(0, 1fr);
        }

        .vc-shell.timeline-only {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: minmax(0, 1fr);
            justify-content: stretch;
        }

        .vc-shell.timeline-only:not(.timeline-collapsed) .vc-main {
            display: none;
        }

        .vc-main {
            grid-column: 1;
            grid-row: 2;
            min-height: 0;
        }

        .vc-sidebar {
            grid-column: 1;
            grid-row: 1;
            max-height: min(48vh, 420px);
            border-left: 0;
            border-bottom: 1px solid var(--b3-border-color);
        }

        .vc-sidebar.collapsed + .vc-main,
        .vc-shell.timeline-collapsed .vc-main {
            grid-row: 1;
        }
    }

    @media (max-width: 520px) {
        .vc-diff-head,
        .vc-diff-grid {
            grid-template-columns: minmax(0, 1fr) clamp(22px, 9%, 36px);
        }

        .vc-diff-head div:nth-child(2) {
            display: none;
        }

        .vc-version-line {
            grid-template-columns: minmax(0, 1fr);
            gap: 4px;
        }

        .vc-version-line .vc-version-arrow {
            display: none;
        }

        .vc-version-card {
            align-items: flex-start;
            flex-direction: column;
            gap: 2px;
        }

        .vc-block.old {
            grid-column: 1 / -1;
        }

        .vc-restore-column {
            grid-column: 2;
            grid-row: span 1;
            border-left: 1px solid var(--b3-border-color);
        }
    }
</style>
