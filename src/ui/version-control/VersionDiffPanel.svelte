<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { showMessage } from "siyuan";
    import * as repoApi from "@/api/repo";
    import { applyTimelineBlockRestore } from "@/core/timeline-service";
    import { rendererClient as client } from "@/ui/plugin/renderer-client";
    import {
        buildChangedFiles,
        diffSnapshotBlocks,
        getBlockDiffLineStats,
        getSnapshotFileId,
        type BlockDiffEntry,
        type ChangedSnapshotFile,
        type RepoSnapshotFileChange,
    } from "@/shared/version-control/block-diff";
    import {
        formatSnapshotTime,
        getDocumentKey,
        getTimelineNodeSelectionKey,
        canReuseLiveDocumentBlock,
        shouldUpdateDiffViewportState,
        snapshotLabel,
        type TimelineEntry,
        type TimelineNodeScope,
        type TimelineNodeSelection,
    } from "@/shared/version-control/timeline";
    import { type DiffEntryDisplayItem, type DiffHiddenDisplayItem, type Snapshot, blockText, buildDiffDisplayItems, buildDiffMinimapItems, createContentFallback, createNoChangeTimelineEntry, escapeCssAttributeValue, findNewestSnapshotForMemo, firstReadableString, getErrorMessage, getReadableDocumentTitle, isVisibleElement, minimapHeight, minimapTop, nextFrame, post, scrollLiveDocumentBlockIntoView, shouldIgnoreDiffClick, snapshotFromSelection } from "./version-diff-logic";
    type CompareMode = "unified" | "split";

    type SnapshotFileContent = {
        title?: string;
        content?: string;
        displayInText?: boolean;
        updated?: string | number;
    };
    const CURRENT_SNAPSHOT_MEMO_PREFIX = "[Sisyphus Timeline Current]";
    const MINIMAP_UNIT_HEIGHT = 34;

    export let currentDocumentId = "";
    export let currentDocumentTitle = "";
    export let selection: TimelineNodeSelection | null = null;
    export let showDebugMeta = false;
    export let i18n: Record<string, string> = {};
    export let onOpenSnapshot: () => void = () => {};

    let currentSnapshot: Snapshot | null = null;
    let selectedEntry: TimelineEntry | undefined;
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
    let loadedSelectionKey = "";
    let selectionLoadVersion = 0;
    let compareMode: CompareMode = "unified";
    let expandedHiddenKeys = new Set<string>();
    let shellElement: HTMLDivElement;
    let diffElement: HTMLElement;
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

    $: selectionKey = getTimelineNodeSelectionKey(selection);
    $: displayDocumentTitle = getReadableDocumentTitle(resolvedDocumentTitle)
        || getReadableDocumentTitle(currentDocumentTitle)
        || getReadableDocumentTitle(selection?.documentTitle)
        || getReadableDocumentTitle(selectedEntry?.title)
        || t("timeline_current_document_fallback", "这个文档");
    $: diffOpen = Boolean(selectedEntry);
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
        queueDiffViewportUpdate();
    }
    $: if (mounted && selectionKey !== loadedSelectionKey) {
        loadedSelectionKey = selectionKey;
        if (selection && selection.documentId === currentDocumentId) {
            void loadSelection(selection);
        } else {
            selectionLoadVersion += 1;
            clearSelectedDiff();
        }
    }

    onMount(async () => {
        mounted = true;
        await tick();
        queueDiffViewportUpdate();
    });

    onDestroy(() => {
        selectionLoadVersion += 1;
        cancelDiffViewportUpdate();
        cancelDocumentScrollSync();
    });

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

    function hiddenBlocksText(count: number): string {
        return t("timeline_hidden_blocks", "${count} 个隐藏的块", { count });
    }

    function t(key: string, fallback: string, vars: Record<string, string | number> = {}): string {
        const template = i18n?.[key] ?? fallback;
        return Object.entries(vars).reduce((text, [name, value]) => {
            return text.split(`\${${name}}`).join(String(value));
        }, template);
    }

    function localizeAcceptReason(reason: string | undefined): string {
        if (!reason) return "";
        if (reason === "内容未变化") return t("timeline_accept_reason_unchanged", "内容未变化");
        if (reason === "复杂块仅支持查看或整篇回档") return t("timeline_accept_reason_complex_block", "复杂块仅支持查看或整篇回档");
        return reason;
    }

    async function loadSelection(nextSelection: TimelineNodeSelection) {
        const loadVersion = ++selectionLoadVersion;
        loadingDiff = true;
        error = "";
        selectedEntry = undefined;
        currentSnapshot = null;
        expandedHiddenKeys = new Set();
        clearDiff();
        try {
            await refreshDocumentTitle();
            if (loadVersion !== selectionLoadVersion || nextSelection.documentId !== currentDocumentId) return;
            currentSnapshot = await createCurrentSnapshot();
            if (loadVersion !== selectionLoadVersion) return;
            const node = nextSelection.node;
            if (node.snapshotId === currentSnapshot.id) {
                selectedEntry = createNoChangeTimelineEntry(nextSelection, currentSnapshot);
                return;
            }
            const diff = await post<Record<string, RepoSnapshotFileChange[] | unknown>>("/api/repo/diffRepoSnapshots", {
                left: node.snapshotId,
                right: currentSnapshot.id,
            });
            if (loadVersion !== selectionLoadVersion) return;
            const changedFile = findChangedFileForCurrentDocument(buildChangedFiles(diff));
            if (!changedFile) {
                selectedEntry = createNoChangeTimelineEntry(nextSelection, currentSnapshot);
                return;
            }
            const entry = createCurrentComparisonEntry(snapshotFromSelection(nextSelection), currentSnapshot, changedFile, node.scope);
            selectedEntry = entry;
            await loadTimelineEntry(entry, loadVersion);
            if (loadVersion !== selectionLoadVersion) return;
            if (oldContent === newContent) {
                selectedEntry = createNoChangeTimelineEntry(nextSelection, currentSnapshot);
                clearDiff();
            }
        } catch (err) {
            if (loadVersion === selectionLoadVersion) error = getErrorMessage(err);
        } finally {
            if (loadVersion === selectionLoadVersion) loadingDiff = false;
        }
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
        await repoApi.createSnapshot(client, text);
        const snapshot = await findNewestSnapshotForMemo(text);
        if (!snapshot?.id) throw new Error(t("timeline_error_current_snapshot_not_found", "当前状态快照已创建，但未能定位"));
        return snapshot;
    }

    function findChangedFileForCurrentDocument(files: ChangedSnapshotFile[]): ChangedSnapshotFile | undefined {
        return files.find((file) => getDocumentKey(file) === currentDocumentId);
    }

    function createCurrentComparisonEntry(
        snapshot: Snapshot,
        current: Snapshot,
        file: ChangedSnapshotFile,
        scope: TimelineNodeScope,
    ): TimelineEntry {
        const oldFileId = getSnapshotFileId(file.oldFile);
        const newFileId = getSnapshotFileId(file.newFile);
        const snapshotKey = encodeURIComponent(snapshot.tag || snapshot.id);
        return {
            key: `${snapshot.id}:${snapshotKey}:${current.id}:${currentDocumentId}:${oldFileId}:${newFileId}`,
            documentKey: currentDocumentId,
            title: file.title || currentDocumentTitle || currentDocumentId,
            kind: file.kind,
            snapshot,
            previousSnapshot: current,
            file,
            oldFileId,
            newFileId,
            scope,
            hasDiff: true,
            updated: file.newFile?.updated ?? file.oldFile?.updated ?? snapshot.updated ?? snapshot.created,
        };
    }

    async function refreshSelectedDiff() {
        if (!selection || selection.documentId !== currentDocumentId) {
            clearSelectedDiff();
            return;
        }
        await loadSelection(selection);
    }

    async function loadTimelineEntry(entry: TimelineEntry, expectedLoadVersion = selectionLoadVersion) {
        if (!entry) return;
        loadingFile = true;
        error = "";
        try {
            const [oldData, newData] = await Promise.all([
                entry.oldFileId ? post<SnapshotFileContent>("/api/repo/openRepoSnapshotFile", { id: entry.oldFileId }) : Promise.resolve(null),
                entry.newFileId ? post<SnapshotFileContent>("/api/repo/openRepoSnapshotFile", { id: entry.newFileId }) : Promise.resolve(null),
            ]);
            if (expectedLoadVersion !== selectionLoadVersion) return;
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
            if (expectedLoadVersion === selectionLoadVersion) error = getErrorMessage(err);
        } finally {
            if (expectedLoadVersion === selectionLoadVersion) {
                loadingFile = false;
                resetDocumentScrollSync();
            }
        }
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
            await applyTimelineBlockRestore(client, entry, blockEntries, {
                documentId: currentDocumentId,
                oldFile: selectedEntry?.file.oldFile,
                newFile: selectedEntry?.file.newFile,
            });
            showMessage(t("timeline_msg_block_rolled_back", "块已回退"));
            await refreshSelectedDiff();
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
            await repoApi.rollbackRepoSnapshotFile(client, id);
            showMessage(t("timeline_msg_document_rolled_back", "文档已回退到历史版本"));
            await refreshSelectedDiff();
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

    function clearSelectedDiff() {
        selectedEntry = undefined;
        currentSnapshot = null;
        loadingDiff = false;
        loadingFile = false;
        error = "";
        expandedHiddenKeys = new Set();
        clearDiff();
    }
</script>

<div bind:this={shellElement} class="vc-shell">
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
                {#if selection}
                    <span class:global={selection.node.scope === "global"} class="vc-scope-badge">
                        {selection.node.scope === "global"
                            ? t("timeline_scope_global_badge", "全局")
                            : t("timeline_scope_document_badge", "文档")}
                    </span>
                {/if}
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
            </div>
        </div>

        {#if error}
            <div class="vc-error">{error}</div>
        {/if}

        <div class="vc-content">
            <section bind:this={diffElement} on:scroll={handleDiffScroll} on:click={handleDiffClick} class:unified-mode={compareMode === "unified"} class:split-mode={compareMode === "split"} class="vc-diff">
                {#if loadingDiff}
                    <div class="vc-empty">{t("diff_loading_selection", "正在创建当前状态快照并计算所选节点差异...")}</div>
                {:else if loadingFile}
                    <div class="vc-empty">{t("timeline_loading_snapshot_file", "正在打开快照文件...")}</div>
                {:else if !selectedEntry}
                    <div class="vc-empty vc-empty-selection">
                        <p>{t("diff_empty_select_snapshot", "从左侧文档快照页选择一个节点，查看历史版本与当前状态的差异")}</p>
                        <button type="button" class="vc-open-snapshot" on:click={onOpenSnapshot}>{t("diff_action_open_snapshot", "打开文档快照")}</button>
                    </div>
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

</div>

<style lang="scss">
    @use "./VersionDiffPanel";
</style>
