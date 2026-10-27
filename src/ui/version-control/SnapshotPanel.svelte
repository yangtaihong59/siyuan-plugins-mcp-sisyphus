<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { fetchPost, showMessage } from "siyuan";
    import {
        createGlobalTimelineTagName,
        createTimelineNodeRecord,
        createTimelineTagName,
        formatSnapshotTime,
        getTimelineNodeIdentity,
        getTimelineNodeSelectionKey,
        isTimelineNodeRecordPayloadValid,
        migrateLegacyTimelineSnapshotToGlobal,
        parseTimelineNodeRecords,
        reconcileDocumentTimelineNodes,
        serializeTimelineNodeRecords,
        snapshotLabel,
        sortSnapshotsNewestFirst,
        sortTimelineNodesNewestFirst,
        GLOBAL_TIMELINE_TAG_VERIFICATION_ERROR,
        type TimelineNodeRecord,
        type TimelineNodeScope,
        type TimelineNodeSelection,
        type TimelineSnapshot,
    } from "@/shared/version-control/timeline";

    type Snapshot = TimelineSnapshot;
    const TIMELINE_NODE_ATTR_KEY = "custom-sisyphus-timeline";

    export let currentDocumentId = "";
    export let currentDocumentTitle = "";
    export let selectedNodeKey = "";
    export let showDebugMeta = false;
    export let i18n: Record<string, string> = {};
    export let onSelectNode: (selection: TimelineNodeSelection | null) => void = () => {};

    let timelineNodes: TimelineNodeRecord[] = [];
    let legacySnapshots: Snapshot[] = [];
    let memo = "";
    let createScope: TimelineNodeScope = "document";
    let createExpanded = true;
    let timelineExpanded = true;
    let legacyExpanded = false;
    let loading = false;
    let linkingLegacySnapshotId = "";
    let convertingLegacySnapshotId = "";
    let deletingNodeIdentity = "";
    let error = "";
    let resolvedDocumentTitle = "";
    let loadedDocumentId = "";
    let panelVisible = false;
    let mounted = false;
    let highlightedNodeIdentity = "";
    let shellElement: HTMLElement;
    let visibilityObserver: MutationObserver | undefined;

    $: displayDocumentTitle = getReadableDocumentTitle(resolvedDocumentTitle)
        || getReadableDocumentTitle(currentDocumentTitle)
        || t("timeline_current_document_fallback", "这个文档");
    $: allSectionsCollapsed = !createExpanded && !timelineExpanded && !legacyExpanded;
    $: if (mounted && panelVisible && currentDocumentId && currentDocumentId !== loadedDocumentId && !loading) {
        void loadSnapshots();
    }

    onMount(async () => {
        mounted = true;
        observeVisibility();
        await tick();
        updateVisibility();
        if (panelVisible && currentDocumentId) await loadSnapshots();
    });

    onDestroy(() => visibilityObserver?.disconnect());

    function observeVisibility() {
        if (typeof MutationObserver === "undefined") return;
        visibilityObserver = new MutationObserver(() => updateVisibility());
        let element: HTMLElement | null = shellElement;
        while (element) {
            visibilityObserver.observe(element, {
                attributes: true,
                attributeFilter: ["class", "style", "hidden", "aria-hidden"],
            });
            element = element.parentElement;
        }
    }

    function updateVisibility() {
        panelVisible = isVisible(shellElement);
        if (panelVisible && currentDocumentId && currentDocumentId !== loadedDocumentId && !loading) {
            void loadSnapshots();
        }
    }

    function isVisible(element: HTMLElement | undefined): boolean {
        if (!element?.getClientRects().length) return false;
        let current: HTMLElement | null = element;
        while (current) {
            if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
            if (typeof getComputedStyle === "function") {
                const style = getComputedStyle(current);
                if (style.display === "none" || style.visibility === "hidden") return false;
            }
            current = current.parentElement;
        }
        return true;
    }

    function post<T>(endpoint: string, data: Record<string, unknown> = {}): Promise<T> {
        return new Promise((resolve, reject) => {
            fetchPost(endpoint, data, (response: { code: number; msg?: string; data: T }) => {
                if (response?.code === 0) resolve(response.data);
                else reject(new Error(response?.msg || `SiYuan API error from ${endpoint}`));
            });
        });
    }

    function t(key: string, fallback: string, vars: Record<string, string | number> = {}): string {
        const template = i18n?.[key] ?? fallback;
        return Object.entries(vars).reduce((text, [name, value]) => text.split(`\${${name}}`).join(String(value)), template);
    }

    async function loadSnapshots() {
        if (!currentDocumentId) return;
        const documentId = currentDocumentId;
        loading = true;
        error = "";
        loadedDocumentId = documentId;
        try {
            await refreshDocumentTitle(documentId);
            const [attrNodes, tagData] = await Promise.all([
                readTimelineNodes(documentId),
                readTimelineTagSnapshots(),
            ]);
            if (currentDocumentId !== documentId) return;
            const reconciliation = reconcileDocumentTimelineNodes(documentId, attrNodes, tagData);
            const documentNodes = reconciliation.documentNodes;
            timelineNodes = sortTimelineNodesNewestFirst([...documentNodes, ...reconciliation.globalNodes]);
            legacySnapshots = reconciliation.legacySnapshots;
            if (reconciliation.attrChanged) {
                try {
                    await writeTimelineNodes(documentNodes, documentId);
                } catch {
                    // Document-scoped tags remain the recovery source; retry on the next load.
                }
            }
            if (selectedNodeKey && !timelineNodes.some((node) => nodeKey(node) === selectedNodeKey)) {
                onSelectNode(null);
            }
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            loading = false;
        }
    }

    async function readTimelineTagSnapshots(): Promise<Snapshot[]> {
        try {
            const data = await post<{ snapshots?: Snapshot[] }>("/api/repo/getRepoTagSnapshots", {});
            return data.snapshots ?? [];
        } catch {
            return [];
        }
    }

    async function readTimelineNodes(documentId: string): Promise<TimelineNodeRecord[]> {
        const attrs = await post<Record<string, string>>("/api/attr/getBlockAttrs", { id: documentId });
        const raw = attrs?.[TIMELINE_NODE_ATTR_KEY];
        if (!isTimelineNodeRecordPayloadValid(raw)) {
            throw new Error(t("timeline_error_invalid_node_index", "文档时间线索引损坏，已停止写入以保护历史节点"));
        }
        return parseTimelineNodeRecords(raw);
    }

    async function writeTimelineNodes(nodes: TimelineNodeRecord[], documentId: string) {
        const documentNodes = nodes.filter((node) => node.scope === "document");
        await post("/api/attr/setBlockAttrs", {
            id: documentId,
            attrs: { [TIMELINE_NODE_ATTR_KEY]: serializeTimelineNodeRecords(documentNodes) },
        });
    }

    function nodeKey(node: TimelineNodeRecord): string {
        return getTimelineNodeSelectionKey({
            documentId: currentDocumentId,
            documentTitle: displayDocumentTitle,
            node,
        });
    }

    function selectNode(node: TimelineNodeRecord) {
        onSelectNode({
            documentId: currentDocumentId,
            documentTitle: displayDocumentTitle,
            node: { ...node },
        });
    }

    async function createTimelineNode() {
        const text = memo.trim();
        if (!text) {
            showMessage(t("timeline_msg_name_required", "请先填写时间线节点名称"));
            return;
        }
        if (!currentDocumentId) {
            showMessage(t("timeline_no_document", "未检测到可用文档"));
            return;
        }
        loading = true;
        error = "";
        try {
            await post("/api/repo/createSnapshot", { memo: text });
            const snapshot = await findNewestSnapshotForMemo(text);
            if (!snapshot?.id) throw new Error(t("timeline_error_new_snapshot_not_found", "快照已创建，但未能定位新快照"));
            const taggedSnapshots = await readTimelineTagSnapshots();
            const existingTags = taggedSnapshots.map((item) => item.tag).filter((tag): tag is string => Boolean(tag));
            const tagName = createScope === "global"
                ? createGlobalTimelineTagName(text, existingTags)
                : createTimelineTagName(text, currentDocumentId, existingTags);
            await post("/api/repo/tagSnapshot", { id: snapshot.id, name: tagName });
            if (createScope === "document") {
                const nodes = await readTimelineNodes(currentDocumentId);
                nodes.push({
                    name: text,
                    created: Date.now(),
                    snapshotId: snapshot.id,
                    tag: tagName,
                    scope: "document",
                });
                await writeTimelineNodes(nodes, currentDocumentId);
            }
            highlightedNodeIdentity = getTimelineNodeIdentity({ snapshotId: snapshot.id, tag: tagName });
            memo = "";
            showMessage(createScope === "global"
                ? t("timeline_msg_global_node_created", "全局时间线节点已创建")
                : t("timeline_msg_document_node_created", "文档时间线节点已创建"));
            await loadSnapshots();
            window.setTimeout(() => {
                highlightedNodeIdentity = "";
            }, 1800);
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            loading = false;
        }
    }

    async function deleteTimelineNode(node: TimelineNodeRecord) {
        if (!currentDocumentId || deletingNodeIdentity || loading) return;
        if (!node.tag) {
            showMessage(t("timeline_error_node_tag_missing", "该节点没有可删除的 tag"));
            return;
        }
        const confirmKey = node.scope === "global"
            ? "timeline_confirm_delete_global_node"
            : node.source === "legacy"
                ? "timeline_confirm_delete_legacy_node"
                : "timeline_confirm_delete_document_node";
        const confirmFallback = node.scope === "global"
            ? "删除全局节点「${node}」？它将从所有文档中消失。只删除 tag，不删除底层快照。"
            : node.source === "legacy"
                ? "删除旧版节点「${node}」？旧 tag 将被删除，其他已关联文档也可能受影响；底层快照不会删除。"
                : "删除文档节点「${node}」？只删除 tag，不删除底层快照。";
        if (!window.confirm(t(confirmKey, confirmFallback, { node: node.name }))) return;

        const documentId = currentDocumentId;
        const identity = getTimelineNodeIdentity(node);
        const selectionKey = nodeKey(node);
        deletingNodeIdentity = identity;
        error = "";
        let previousDocumentNodes: TimelineNodeRecord[] | undefined;
        try {
            if (node.scope === "document") {
                previousDocumentNodes = await readTimelineNodes(documentId);
                await writeTimelineNodes(
                    previousDocumentNodes.filter((item) => getTimelineNodeIdentity(item) !== identity),
                    documentId,
                );
            }
            try {
                await post("/api/repo/removeRepoTagSnapshot", { tag: node.tag });
            } catch (tagError) {
                if (previousDocumentNodes) {
                    try {
                        await writeTimelineNodes(previousDocumentNodes, documentId);
                    } catch {
                        // A document-scoped tag can repair its attrs record on the next refresh.
                    }
                }
                throw tagError;
            }
            timelineNodes = timelineNodes.filter((item) => getTimelineNodeIdentity(item) !== identity);
            legacySnapshots = legacySnapshots.filter((snapshot) => snapshot.tag !== node.tag);
            if (selectedNodeKey === selectionKey) onSelectNode(null);
            showMessage(t("timeline_msg_node_deleted", "时间线节点已删除，底层快照仍保留"));
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            deletingNodeIdentity = "";
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

    async function associateLegacySnapshot(snapshot: Snapshot) {
        if (!currentDocumentId || !snapshot.id || linkingLegacySnapshotId || convertingLegacySnapshotId) return;
        const confirmed = window.confirm(t(
            "timeline_confirm_link_legacy_node",
            "将旧版节点「${node}」关联到文档「${title}」？旧 tag 会保留。",
            { node: snapshotLabel(snapshot), title: displayDocumentTitle },
        ));
        if (!confirmed) return;
        linkingLegacySnapshotId = snapshot.id;
        error = "";
        try {
            const nodes = await readTimelineNodes(currentDocumentId);
            const legacyNode = createTimelineNodeRecord(snapshot, "document", "legacy");
            const identity = getTimelineNodeIdentity(legacyNode);
            if (!nodes.some((node) => getTimelineNodeIdentity(node) === identity)) {
                nodes.push(legacyNode);
                await writeTimelineNodes(nodes, currentDocumentId);
            }
            showMessage(t("timeline_msg_legacy_node_linked", "旧版节点已关联到当前文档"));
            await loadSnapshots();
        } catch (err) {
            error = getErrorMessage(err);
        } finally {
            linkingLegacySnapshotId = "";
        }
    }

    function isLegacySnapshotLinked(snapshot: Snapshot): boolean {
        const identity = getTimelineNodeIdentity(createTimelineNodeRecord(snapshot, "document", "legacy"));
        return timelineNodes.some((node) => node.scope === "document" && node.source === "legacy" && getTimelineNodeIdentity(node) === identity);
    }

    async function convertLegacySnapshotToGlobal(snapshot: Snapshot) {
        if (!snapshot.id || !snapshot.tag || linkingLegacySnapshotId || convertingLegacySnapshotId) return;
        const confirmed = window.confirm(t(
            "timeline_confirm_convert_legacy_global",
            "将旧版节点「${node}」转为全局节点？它将显示在所有文档的时间线中。",
            { node: snapshotLabel(snapshot) },
        ));
        if (!confirmed) return;
        convertingLegacySnapshotId = snapshot.id;
        error = "";
        try {
            const taggedSnapshots = await readTimelineTagSnapshots();
            const existingTags = taggedSnapshots.map((item) => item.tag).filter((tag): tag is string => Boolean(tag));
            const migration = await migrateLegacyTimelineSnapshotToGlobal(snapshot, existingTags, {
                addTag: (snapshotId, tag) => post("/api/repo/tagSnapshot", { id: snapshotId, name: tag }),
                readTaggedSnapshots: readTimelineTagSnapshots,
                removeTag: (tag) => post("/api/repo/removeRepoTagSnapshot", { tag }),
            });
            showMessage(migration.oldTagRemoved
                ? t("timeline_msg_legacy_global_converted", "旧版节点已转为全局节点")
                : t("timeline_msg_legacy_global_partial", "已创建全局节点，但旧 tag 删除失败；两者均已保留，时间线会自动隐藏重复项"));
            await loadSnapshots();
        } catch (err) {
            error = getErrorMessage(err) === GLOBAL_TIMELINE_TAG_VERIFICATION_ERROR
                ? t("timeline_error_global_tag_verification_failed", "全局 tag 创建后未能验证，旧 tag 已保留")
                : getErrorMessage(err);
        } finally {
            convertingLegacySnapshotId = "";
        }
    }

    async function refreshDocumentTitle(documentId: string) {
        resolvedDocumentTitle = "";
        const titleFromProp = getReadableDocumentTitle(currentDocumentTitle);
        if (titleFromProp) {
            resolvedDocumentTitle = titleFromProp;
            return;
        }
        try {
            const info = await post<Record<string, unknown>>("/api/block/getDocInfo", { id: documentId });
            resolvedDocumentTitle = firstReadableString([info.name, info.title, info.hPath, info.hpath, info.path]);
        } catch {
            resolvedDocumentTitle = "";
        }
    }

    function toggleAllSections() {
        const expand = allSectionsCollapsed;
        createExpanded = expand;
        timelineExpanded = expand;
        legacyExpanded = expand && legacySnapshots.length > 0;
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

<div bind:this={shellElement} class="snapshot-shell">
    <header class="snapshot-toolbar">
        <div>
            <strong>{t("snapshot_panel_title", "文档快照")}</strong>
            <small title={displayDocumentTitle}>{displayDocumentTitle}</small>
        </div>
        <div class="snapshot-toolbar__actions">
            <button type="button" on:click={() => loadSnapshots()} disabled={loading || !currentDocumentId} title={t("snapshot_action_refresh", "刷新快照")} aria-label={t("snapshot_action_refresh", "刷新快照")}>↻</button>
            <button type="button" on:click={toggleAllSections} title={allSectionsCollapsed ? t("snapshot_action_expand_all", "展开全部") : t("snapshot_action_collapse_all", "折叠全部")} aria-label={allSectionsCollapsed ? t("snapshot_action_expand_all", "展开全部") : t("snapshot_action_collapse_all", "折叠全部")}>{allSectionsCollapsed ? "⌄" : "⌃"}</button>
        </div>
    </header>

    {#if error}<div class="snapshot-error">{error}</div>{/if}

    <div class="snapshot-sections">
        <section>
            <button type="button" class="snapshot-section-heading" on:click={() => createExpanded = !createExpanded} aria-expanded={createExpanded}>
                <span>{createExpanded ? "⌄" : "›"}</span>
                <strong>{t("snapshot_create_section_title", "新建节点")}</strong>
            </button>
            {#if createExpanded}
                <div class="snapshot-create">
                    <div class="snapshot-scope" role="group" aria-label={t("timeline_create_scope", "节点作用域")}>
                        <button type="button" class:active={createScope === "document"} on:click={() => createScope = "document"}>{t("timeline_scope_document_node", "文档节点")}</button>
                        <button type="button" class:active={createScope === "global"} on:click={() => createScope = "global"}>{t("timeline_scope_global_node", "全局节点")}</button>
                    </div>
                    <textarea bind:value={memo} rows="2" placeholder={t("timeline_node_placeholder", "例如 feat：重构文档工具")}></textarea>
                    <button type="button" class="snapshot-primary" on:click={createTimelineNode} disabled={loading || !currentDocumentId}>{loading ? t("timeline_loading", "加载中...") : t("timeline_action_create_node", "创建节点")}</button>
                </div>
            {/if}
        </section>

        <section class="snapshot-timeline-section">
            <button type="button" class="snapshot-section-heading" on:click={() => timelineExpanded = !timelineExpanded} aria-expanded={timelineExpanded}>
                <span>{timelineExpanded ? "⌄" : "›"}</span>
                <strong>{t("timeline_section_title", "时间线")}</strong>
                <small>{timelineNodes.length}</small>
            </button>
            {#if timelineExpanded}
                {#if loading && timelineNodes.length === 0}
                    <div class="snapshot-empty">{t("timeline_loading", "加载中...")}</div>
                {:else if !currentDocumentId}
                    <div class="snapshot-empty">{t("timeline_no_document", "未检测到可用文档")}</div>
                {:else if timelineNodes.length === 0}
                    <div class="snapshot-empty">{t("timeline_no_nodes_for_document", "「${title}」暂无时间线节点", { title: displayDocumentTitle })}</div>
                {:else}
                    <div class="snapshot-list">
                        {#each timelineNodes as node (getTimelineNodeIdentity(node))}
                            <div
                                class="snapshot-row"
                                class:selected={nodeKey(node) === selectedNodeKey}
                                class:highlighted={getTimelineNodeIdentity(node) === highlightedNodeIdentity}
                            >
                                <button type="button" class="snapshot-node-select" on:click={() => selectNode(node)}>
                                    <span class="snapshot-dot" class:global={node.scope === "global"}></span>
                                    <span class="snapshot-node-copy">
                                        <strong>{node.name}</strong>
                                        {#if formatSnapshotTime({ id: node.snapshotId, created: node.created })}<small>{formatSnapshotTime({ id: node.snapshotId, created: node.created })}</small>{/if}
                                        {#if showDebugMeta}<code>{node.snapshotId}</code>{/if}
                                    </span>
                                    <span class="snapshot-badge" class:global={node.scope === "global"}>{node.scope === "global" ? t("timeline_scope_global_badge", "全局") : t("timeline_scope_document_badge", "文档")}</span>
                                </button>
                                <button
                                    type="button"
                                    class="snapshot-node-delete"
                                    on:click={() => deleteTimelineNode(node)}
                                    disabled={Boolean(deletingNodeIdentity) || loading}
                                    title={deletingNodeIdentity === getTimelineNodeIdentity(node) ? t("timeline_action_deleting_node", "正在删除...") : t("timeline_action_delete_node", "删除节点")}
                                    aria-label={deletingNodeIdentity === getTimelineNodeIdentity(node) ? t("timeline_action_deleting_node", "正在删除...") : t("timeline_action_delete_node", "删除节点")}
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 6h10l-1 14H8L7 6Zm2-3h6l1 2H8l1-2Zm-3 2h12v2H6V5Z" /></svg>
                                </button>
                            </div>
                        {/each}
                    </div>
                {/if}
            {/if}
        </section>

        {#if legacySnapshots.length > 0}
            <section>
                <button type="button" class="snapshot-section-heading" on:click={() => legacyExpanded = !legacyExpanded} aria-expanded={legacyExpanded}>
                    <span>{legacyExpanded ? "⌄" : "›"}</span>
                    <strong>{t("timeline_legacy_section_title", "旧版全局节点")}</strong>
                    <small>{legacySnapshots.length}</small>
                </button>
                {#if legacyExpanded}
                    <p class="snapshot-legacy-description">{t("timeline_legacy_description", "这些节点由旧版本创建，快照仍受原 tag 保护。可关联到多个文档，或转为所有文档可见的全局节点。")}</p>
                    <div class="snapshot-legacy-list">
                        {#each legacySnapshots as snapshot (`${snapshot.id}:${snapshot.tag ?? ""}`)}
                            <article>
                                <div><strong>{snapshotLabel(snapshot)}</strong><small>{formatSnapshotTime(snapshot)}</small></div>
                                <div class="snapshot-legacy-actions">
                                    <button type="button" on:click={() => associateLegacySnapshot(snapshot)} disabled={isLegacySnapshotLinked(snapshot) || Boolean(linkingLegacySnapshotId) || Boolean(convertingLegacySnapshotId) || loading}>{isLegacySnapshotLinked(snapshot) ? t("timeline_action_legacy_node_linked", "已关联当前文档") : linkingLegacySnapshotId === snapshot.id ? t("timeline_action_linking_legacy_node", "正在关联...") : t("timeline_action_link_legacy_node", "添加为文档节点")}</button>
                                    <button type="button" class="global" on:click={() => convertLegacySnapshotToGlobal(snapshot)} disabled={Boolean(linkingLegacySnapshotId) || Boolean(convertingLegacySnapshotId) || loading}>{convertingLegacySnapshotId === snapshot.id ? t("timeline_action_converting_legacy_global", "正在转换...") : t("timeline_action_convert_legacy_global", "转为全局节点")}</button>
                                    <button
                                        type="button"
                                        class="danger"
                                        on:click={() => deleteTimelineNode(createTimelineNodeRecord(snapshot, "document", "legacy"))}
                                        disabled={Boolean(deletingNodeIdentity) || Boolean(linkingLegacySnapshotId) || Boolean(convertingLegacySnapshotId) || loading}
                                        title={t("timeline_action_delete_node", "删除节点")}
                                        aria-label={t("timeline_action_delete_node", "删除节点")}
                                    >
                                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 6h10l-1 14H8L7 6Zm2-3h6l1 2H8l1-2Zm-3 2h12v2H6V5Z" /></svg>
                                    </button>
                                </div>
                            </article>
                        {/each}
                    </div>
                {/if}
            </section>
        {/if}
    </div>
</div>

<style>
    .snapshot-shell { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; color: var(--b3-theme-on-background); background: var(--b3-theme-background); font-size: 12px; }
    .snapshot-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 8px 8px 7px 12px; border-bottom: 1px solid var(--b3-border-color); }
    .snapshot-toolbar > div:first-child { min-width: 0; display: grid; gap: 2px; }
    .snapshot-toolbar strong, .snapshot-toolbar small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .snapshot-toolbar small { color: var(--b3-theme-on-surface); font-size: 11px; }
    .snapshot-toolbar__actions { display: flex; gap: 3px; }
    button { border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }
    button:hover:not(:disabled), button:focus-visible { background: var(--b3-list-hover); }
    button:disabled { cursor: not-allowed; opacity: .5; }
    .snapshot-toolbar__actions button { width: 26px; min-height: 26px; padding: 0; font-size: 16px; }
    .snapshot-error { margin: 8px; padding: 7px 8px; border: 1px solid var(--b3-theme-error); border-radius: 4px; color: var(--b3-theme-error); }
    .snapshot-sections { flex: 1 1 auto; min-height: 0; overflow: auto; padding-bottom: 10px; }
    .snapshot-sections section { border-bottom: 1px solid var(--b3-border-color); }
    .snapshot-section-heading { width: 100%; min-height: 30px; display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: 4px; align-items: center; padding: 3px 8px; text-align: left; }
    .snapshot-section-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
    .snapshot-section-heading small { color: var(--b3-theme-on-surface); }
    .snapshot-create { display: grid; gap: 6px; padding: 0 8px 9px; }
    textarea { width: 100%; box-sizing: border-box; min-height: 52px; border: 1px solid var(--b3-border-color); border-radius: 3px; padding: 6px 7px; resize: vertical; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface); font: inherit; }
    textarea:focus { outline: 1px solid var(--b3-theme-primary); border-color: var(--b3-theme-primary); }
    .snapshot-scope { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--b3-border-color); border-radius: 4px; padding: 2px; }
    .snapshot-scope button { min-height: 25px; font-size: 11px; }
    .snapshot-scope button.active { background: var(--b3-list-hover); color: var(--b3-theme-primary); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--b3-theme-primary) 45%, transparent); }
    .snapshot-primary { min-height: 29px; background: var(--b3-theme-primary); color: var(--b3-theme-on-primary); font-weight: 600; }
    .snapshot-primary:hover:not(:disabled), .snapshot-primary:focus-visible { background: var(--b3-theme-primary-light, var(--b3-theme-primary)); }
    .snapshot-list { display: grid; padding-bottom: 4px; }
    .snapshot-row { width: 100%; min-height: 38px; display: grid; grid-template-columns: minmax(0, 1fr) 28px; align-items: stretch; border-radius: 0; }
    .snapshot-row:hover { background: var(--b3-list-hover); }
    .snapshot-row.selected { background: var(--b3-list-hover); box-shadow: inset 2px 0 0 var(--b3-theme-primary); }
    .snapshot-row.highlighted { animation: snapshot-highlight 1.8s ease-out; }
    .snapshot-node-select { min-width: 0; display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 6px; align-items: center; padding: 4px 4px 4px 12px; text-align: left; border-radius: 0; }
    .snapshot-node-select:hover:not(:disabled), .snapshot-node-select:focus-visible { background: transparent; }
    .snapshot-node-delete { width: 28px; min-height: 28px; align-self: center; display: grid; place-items: center; padding: 6px; color: var(--b3-theme-on-surface); opacity: .58; }
    .snapshot-row:hover .snapshot-node-delete, .snapshot-node-delete:focus-visible, .snapshot-node-delete:disabled { opacity: 1; }
    .snapshot-node-delete:hover:not(:disabled), .snapshot-node-delete:focus-visible { color: var(--b3-theme-error); background: color-mix(in srgb, var(--b3-theme-error) 12%, transparent); }
    .snapshot-node-delete svg { width: 14px; height: 14px; fill: currentColor; }
    @keyframes snapshot-highlight { 0%, 45% { background: color-mix(in srgb, var(--b3-theme-primary) 22%, transparent); } 100% { background: transparent; } }
    .snapshot-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--b3-theme-primary); }
    .snapshot-dot.global { background: #7657e8; }
    .snapshot-node-copy { min-width: 0; display: grid; gap: 1px; }
    .snapshot-node-copy strong, .snapshot-node-copy small, .snapshot-node-copy code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .snapshot-node-copy strong { font-weight: 500; }
    .snapshot-node-copy small { color: var(--b3-theme-on-surface); font-size: 10px; }
    .snapshot-node-copy code { color: var(--b3-theme-on-surface); font-size: 9px; }
    .snapshot-badge { border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 40%, var(--b3-border-color)); border-radius: 999px; padding: 1px 5px; color: var(--b3-theme-primary); font-size: 9px; }
    .snapshot-badge.global { border-color: color-mix(in srgb, #7657e8 50%, var(--b3-border-color)); color: #7657e8; }
    .snapshot-empty { padding: 10px 12px 12px; color: var(--b3-theme-on-surface); line-height: 1.45; }
    .snapshot-legacy-description { margin: 0; padding: 0 10px 8px; color: var(--b3-theme-on-surface); font-size: 10px; line-height: 1.45; }
    .snapshot-legacy-list { display: grid; gap: 5px; padding: 0 8px 8px; }
    .snapshot-legacy-list article { display: grid; gap: 5px; padding: 7px; border: 1px solid var(--b3-border-color); border-radius: 4px; background: var(--b3-theme-surface); }
    .snapshot-legacy-list article > div:first-child { min-width: 0; display: grid; gap: 2px; }
    .snapshot-legacy-list strong, .snapshot-legacy-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .snapshot-legacy-list small { color: var(--b3-theme-on-surface); font-size: 10px; }
    .snapshot-legacy-actions { display: grid; grid-template-columns: 1fr 1fr 28px; gap: 4px; }
    .snapshot-legacy-actions button { min-height: 25px; border: 1px solid var(--b3-border-color); padding: 2px 4px; font-size: 10px; }
    .snapshot-legacy-actions button.global { border-color: color-mix(in srgb, #7657e8 48%, var(--b3-border-color)); color: #7657e8; }
    .snapshot-legacy-actions button.danger { display: grid; place-items: center; padding: 5px; color: var(--b3-theme-error); }
    .snapshot-legacy-actions button.danger svg { width: 13px; height: 13px; fill: currentColor; }
</style>
