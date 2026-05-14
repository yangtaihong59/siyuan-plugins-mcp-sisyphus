<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { fetchPost, showMessage } from "siyuan";
    import {
        buildChangedFiles,
        diffSnapshotBlocks,
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
        isTimelineSnapshot,
        snapshotLabel,
        sortSnapshotsNewestFirst,
        type TimelineEntry,
        type TimelineEntryContent,
        type TimelineSnapshot,
    } from "./timeline";

    type Snapshot = TimelineSnapshot;

    type SnapshotFileContent = {
        title?: string;
        content?: string;
        displayInText?: boolean;
        updated?: string | number;
    };

    const CURRENT_SNAPSHOT_MEMO_PREFIX = "[Sisyphus Timeline Current]";
    const TIMELINE_AUTO_COLLAPSE_WIDTH = 920;

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
    let timelineCollapsed = false;
    let autoTimelineCollapsed = false;
    let forceTimelineExpanded = false;
    let refreshingSelection = false;
    let shellElement: HTMLDivElement;
    let shellResizeObserver: ResizeObserver | undefined;

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
    $: if (mounted && currentDocumentId !== loadedDocumentId && !loadingSnapshots) {
        void loadTimeline();
    }

    onMount(async () => {
        mounted = true;
        observeShellWidth();
        await loadTimeline();
    });

    onDestroy(() => {
        shellResizeObserver?.disconnect();
    });

    function observeShellWidth() {
        if (!shellElement || typeof ResizeObserver === "undefined") return;
        shellResizeObserver = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width ?? shellElement.clientWidth;
            autoTimelineCollapsed = !forceTimelineExpanded && width > 0 && width < TIMELINE_AUTO_COLLAPSE_WIDTH;
        });
        shellResizeObserver.observe(shellElement);
        autoTimelineCollapsed = !forceTimelineExpanded && shellElement.clientWidth > 0 && shellElement.clientWidth < TIMELINE_AUTO_COLLAPSE_WIDTH;
    }

    function toggleTimelineCollapsed() {
        if (!effectiveTimelineCollapsed) {
            forceTimelineExpanded = false;
        }
        timelineCollapsed = !timelineCollapsed;
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
        loadingSnapshots = true;
        loadingDiff = true;
        error = "";
        clearDiff();
        loadedDocumentId = currentDocumentId;
        try {
            await refreshDocumentTitle();
            const data = await post<{ snapshots?: Snapshot[] }>("/api/repo/getRepoTagSnapshots", {});
            taggedSnapshots = sortSnapshotsNewestFirst((data.snapshots ?? []).filter(isTimelineSnapshot));
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
                    if (!changedFile) continue;
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
            const nextEntry = selectedEntryKey
                ? timelineEntries.find((entry) => entry.key === selectedEntryKey)
                : undefined;
            selectedEntryKey = nextEntry?.key ?? "";
            if (nextEntry) await loadTimelineEntry(nextEntry);
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            loadingSnapshots = false;
            loadingDiff = false;
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
            updated: file.newFile?.updated ?? file.oldFile?.updated ?? snapshot.updated ?? snapshot.created,
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
        const confirmed = window.confirm(t("timeline_confirm_rollback_block", "将把「${title}」中的这个块回退到左侧历史版本，继续吗？", { title: displayDocumentTitle }));
        if (!confirmed) return;

        applying = true;
        try {
            if (entry.status === "modified" && entry.newBlock?.id && entry.oldBlock) {
                await post("/api/block/updateBlock", {
                    id: entry.newBlock.id,
                    dataType: "markdown",
                    data: entry.oldBlock.markdown || entry.oldBlock.text,
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
        const confirmed = window.confirm(t("timeline_confirm_rollback_document", "这会把整个文档回退到左侧历史版本。继续吗？"));
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
                <span>{timelineSnapshotCountText(taggedSnapshots.length)}</span>
                {#if showDebugMeta && currentDocumentId}
                    <span>{currentDocumentId}</span>
                {/if}
            </div>
            <div class="vc-toolbar__actions">
                <button class="vc-icon-button" on:click={rollbackDocument} disabled={!selectedEntry?.oldFileId || applying} title={t("timeline_action_rollback_document", "整篇回退到历史版本")} aria-label={t("timeline_action_rollback_document", "整篇回退到历史版本")}>↶</button>
                <button class="vc-icon-button" on:click={toggleTimelineCollapsed} title={autoTimelineCollapsed ? t("timeline_auto_collapsed_title", "窗口过窄，时间线已自动折叠") : effectiveTimelineCollapsed ? t("timeline_action_expand", "展开时间线") : t("timeline_action_collapse", "折叠时间线")} aria-label={autoTimelineCollapsed ? t("timeline_auto_collapsed_title", "窗口过窄，时间线已自动折叠") : effectiveTimelineCollapsed ? t("timeline_action_expand", "展开时间线") : t("timeline_action_collapse", "折叠时间线")}>
                    {effectiveTimelineCollapsed ? "‹" : "›"}
                </button>
            </div>
        </div>

        {#if error}
            <div class="vc-error">{error}</div>
        {/if}

        <div class="vc-content">
            <section class="vc-diff">
                {#if loadingFile}
                    <div class="vc-empty">{t("timeline_loading_snapshot_file", "正在打开快照文件...")}</div>
                {:else if !selectedEntry}
                    <div class="vc-empty">{refreshingSelection ? t("timeline_loading_current_diff", "正在创建当前版本并加载差异...") : t("timeline_empty_select_node", "选择右侧时间线节点，查看历史版本与当前状态的差异")}</div>
                {:else}
                    <div class="vc-diff-head">
                        <div>{t("timeline_history_version", "历史版本")} {selectedSnapshotTitle ? `· ${selectedSnapshotTitle}` : ""}{selectedSnapshotTime ? ` · ${selectedSnapshotTime}` : ""}</div>
                        <div aria-hidden="true"></div>
                        <div>{t("timeline_current_state", "当前状态")} {currentSnapshotTime ? `· ${currentSnapshotTime}` : newFileContent?.updated ? `· ${newFileContent.updated}` : ""}</div>
                    </div>
                    {#if blockEntries.length === 0}
                        <div class="vc-empty">{t("timeline_empty_unparseable_file", "该文件内容为空，或当前快照内容暂无法解析为可显示块。")}</div>
                    {/if}
                    <div class="vc-diff-grid">
                        {#each blockEntries as entry}
                            <article class="vc-block old {entry.status}">
                                {#if showDebugMeta}
                                    <div class="vc-block__meta">
                                        <span>{entry.status}</span>
                                        {#if entry.oldBlock?.id}<code>{entry.oldBlock.id}</code>{/if}
                                    </div>
                                {/if}
                                {#if entry.oldParts}
                                    <div class="vc-inline-diff">
                                        {#each entry.oldParts as part}
                                            <span class="vc-diff-part {part.kind}">{part.text}</span>
                                        {/each}
                                    </div>
                                {:else}
                                    <pre>{entry.oldBlock?.markdown || entry.oldBlock?.text || (entry.status === "added" ? t("timeline_old_missing_for_added", "当前新增，历史无内容") : "")}</pre>
                                {/if}
                            </article>
                            <div class="vc-restore-column {entry.status}">
                                {#if entry.status !== "unchanged"}
                                    <button class="vc-icon-button" on:click={() => rollbackBlock(entry)} disabled={applying || !entry.canAcceptBlock} title={t("timeline_action_restore_block", "还原块")} aria-label={t("timeline_action_restore_block", "还原块")}>→</button>
                                    {#if entry.acceptReason}
                                        <small>{localizeAcceptReason(entry.acceptReason)}</small>
                                    {/if}
                                {/if}
                            </div>
                            <article class="vc-block new {entry.status}">
                                {#if showDebugMeta}
                                    <div class="vc-block__meta">
                                        <span>{entry.status}</span>
                                        {#if entry.newBlock?.id}<code>{entry.newBlock.id}</code>{/if}
                                    </div>
                                {/if}
                                {#if entry.newParts}
                                    <div class="vc-inline-diff">
                                        {#each entry.newParts as part}
                                            <span class="vc-diff-part {part.kind}">{part.text}</span>
                                        {/each}
                                    </div>
                                {:else}
                                    <pre>{entry.newBlock?.markdown || entry.newBlock?.text || (entry.status === "removed" ? t("timeline_new_missing_for_removed", "历史存在，当前已删除") : "")}</pre>
                                {/if}
                            </article>
                        {/each}
                    </div>
                {/if}
            </section>
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
                <button class="vc-primary" on:click={createTimelineNode} disabled={loadingSnapshots}>{t("timeline_action_create_node", "创建节点")}</button>
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
                            <button class:selected={entry.key === selectedEntryKey} on:click={() => selectEntry(entry)}>
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
        min-width: 0;
        min-height: 0;
        height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
    }

    .vc-toolbar {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        border-bottom: 1px solid var(--b3-border-color);
        padding: 10px 12px;
    }

    .vc-toolbar__meta {
        min-width: 0;
    }

    .vc-toolbar__meta strong,
    .vc-toolbar span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .vc-toolbar__meta strong {
        display: inline-block;
        max-width: 100%;
        vertical-align: bottom;
    }

    .vc-toolbar span {
        display: inline-block;
        max-width: min(38vw, 260px);
        margin-left: 8px;
        color: var(--b3-theme-on-surface);
        font-size: 12px;
    }

    .vc-toolbar__actions {
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
        min-height: 0;
        height: 100%;
        overflow: hidden;
    }

    .vc-diff {
        min-width: 0;
        height: 100%;
        overflow: auto;
    }

    .vc-diff-head,
    .vc-diff-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 42px minmax(0, 1fr);
    }

    .vc-diff-head {
        position: sticky;
        top: 0;
        z-index: 1;
        background: var(--b3-theme-background);
        border-bottom: 1px solid var(--b3-border-color);
        font-size: 12px;
        color: var(--b3-theme-on-surface);
    }

    .vc-diff-head div {
        padding: 8px 12px;
    }

    .vc-block {
        min-width: 0;
        border-bottom: 1px solid var(--b3-border-color);
        padding: 8px 12px;
    }

    .vc-restore-column {
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: center;
        justify-content: center;
        min-width: 0;
        border-bottom: 1px solid var(--b3-border-color);
        border-left: 1px solid var(--b3-border-color);
        border-right: 1px solid var(--b3-border-color);
        padding: 8px 5px;
        background: var(--b3-theme-background);
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
        min-height: 22px;
        margin: 4px 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: var(--b3-font-family-code);
        font-size: 12px;
        line-height: 1.55;
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
            grid-row: 2;
            min-height: 0;
        }

        .vc-sidebar {
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
            grid-template-columns: minmax(0, 1fr) 36px;
        }

        .vc-diff-head div:nth-child(2) {
            display: none;
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
