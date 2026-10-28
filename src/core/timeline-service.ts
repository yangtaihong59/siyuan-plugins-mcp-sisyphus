import * as blockApi from '../api/block';
import type { SiYuanClient } from '../api/client';
import * as repoApi from '../api/repo';
import {
    buildChangedFiles,
    diffSnapshotBlocks,
    getBlockDiffLineStats,
    getDocumentIdFromSnapshotFile,
    getRestoreBlockPayload,
    getRestoreInsertPlan,
    getSnapshotFileId,
    getUpdateBlockPayload,
    type BlockDiffEntry,
    type ChangedSnapshotFile,
    type SnapshotBlock,
} from '../shared/version-control/block-diff';
import {
    createGlobalTimelineTagName,
    createTimelineTagName,
    extractTimelineDocumentId,
    getTimelineNodeIdentity,
    isGlobalTimelineTag,
    isTimelineNodeRecordPayloadValid,
    parseTimelineNodeRecords,
    reconcileDocumentTimelineNodes,
    serializeTimelineNodeRecords,
    sortSnapshotsNewestFirst,
    sortTimelineNodesNewestFirst,
    TIMELINE_NODE_ATTR_KEY,
    TIMELINE_TAG_PREFIX,
    type TimelineNodeRecord,
    type TimelineNodeScope,
    type TimelineSnapshot,
} from '../shared/version-control/timeline';

export type TimelineListScope = TimelineNodeScope | 'all';

export interface TimelineNodePage {
    nodes: TimelineNodeRecord[];
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
    hasMore: boolean;
}

export interface TimelineNodeCreateResult {
    node: TimelineNodeRecord;
    documentId?: string;
    partialFailure?: {
        stage: 'document_index';
        message: string;
        recoverableFromTag: true;
    };
}

export interface TimelineComparisonChange {
    changeKey: string;
    status: BlockDiffEntry['status'];
    old?: TimelineComparisonBlock;
    current?: TimelineComparisonBlock;
    rollbackable: boolean;
    reason?: string;
}

export interface TimelineComparisonBlock {
    id?: string;
    parentID?: string;
    rootID?: string;
    type?: string;
    subtype?: string;
    markdown: string;
    order: number;
    depth: number;
}

export interface TimelineComparisonResult {
    node: TimelineNodeRecord;
    documentId: string;
    currentSnapshotId: string;
    noChanges: boolean;
    stats: {
        addedLines: number;
        removedLines: number;
        changedBlocks: number;
        rollbackableBlocks: number;
    };
    changes: TimelineComparisonChange[];
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
    hasMore: boolean;
}

interface InternalTimelineComparison extends TimelineComparisonResult {
    file?: ChangedSnapshotFile;
    oldFileId: string;
    currentFileId: string;
    allEntries: BlockDiffEntry[];
}

const CURRENT_SNAPSHOT_MEMO_PREFIX = '[Sisyphus Timeline Current]';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function normalizePage(page = 1, pageSize = 20): { page: number; pageSize: number } {
    return {
        page: Math.max(1, Math.floor(page)),
        pageSize: Math.min(100, Math.max(1, Math.floor(pageSize))),
    };
}

function paginate<T>(items: T[], page = 1, pageSize = 20) {
    const normalized = normalizePage(page, pageSize);
    const start = (normalized.page - 1) * normalized.pageSize;
    const total = items.length;
    const pageCount = total === 0 ? 0 : Math.ceil(total / normalized.pageSize);
    return {
        items: items.slice(start, start + normalized.pageSize),
        ...normalized,
        total,
        pageCount,
        hasMore: normalized.page < pageCount,
    };
}

/** Message of the error thrown for a corrupt document node index (the UI localizes it). */
export const TIMELINE_INDEX_INVALID_ERROR = 'Document timeline index is invalid; refusing to modify it.';

function requireValidNodeIndex(raw: unknown): TimelineNodeRecord[] {
    if (!isTimelineNodeRecordPayloadValid(raw)) {
        throw new Error(TIMELINE_INDEX_INVALID_ERROR);
    }
    return parseTimelineNodeRecords(raw);
}

/** The document's node index; throws TIMELINE_INDEX_INVALID_ERROR rather than overwrite a corrupt one. */
export async function readDocumentNodes(client: SiYuanClient, documentId: string): Promise<TimelineNodeRecord[]> {
    const attrs = await blockApi.getBlockAttrs(client, documentId);
    return requireValidNodeIndex(attrs?.[TIMELINE_NODE_ATTR_KEY]);
}

export async function writeDocumentNodes(client: SiYuanClient, documentId: string, nodes: TimelineNodeRecord[]): Promise<void> {
    await blockApi.setBlockAttrs(
        client,
        documentId,
        { [TIMELINE_NODE_ATTR_KEY]: serializeTimelineNodeRecords(nodes.filter((node) => node.scope === 'document')) },
    );
}

async function createAndLocateSnapshot(client: SiYuanClient, memo: string): Promise<TimelineSnapshot> {
    const before = await repoApi.getRepoSnapshots(client, 1);
    const beforeIds = new Set((before.snapshots ?? []).map((snapshot) => snapshot.id));
    await repoApi.createSnapshot(client, memo);
    const after = await repoApi.getRepoSnapshots(client, 1);
    const ordered = sortSnapshotsNewestFirst(after.snapshots ?? []);
    const created = ordered.find((snapshot) => snapshot.id && !beforeIds.has(snapshot.id) && snapshot.memo === memo)
        ?? ordered.find((snapshot) => snapshot.id && !beforeIds.has(snapshot.id));
    if (!created?.id) {
        throw new Error('Snapshot was created, but the new snapshot could not be located.');
    }
    return created;
}

async function resolveTaggedNode(
    client: SiYuanClient,
    tag: string,
    documentId?: string,
): Promise<{ snapshot: TimelineSnapshot; node: TimelineNodeRecord }> {
    if (!tag.startsWith(TIMELINE_TAG_PREFIX)) {
        throw new Error('The tag is not a Sisyphus timeline node.');
    }
    const tagged = await repoApi.getRepoTagSnapshots(client);
    const snapshot = (tagged.snapshots ?? []).find((item) => item.tag === tag);
    if (!snapshot?.id) throw new Error(`Timeline node not found for tag "${tag}".`);

    const global = isGlobalTimelineTag(tag);
    const tagDocumentId = extractTimelineDocumentId(tag);
    if (!global && !tagDocumentId) {
        throw new Error('Legacy timeline tags are managed from the timeline UI and are not supported by this tool.');
    }
    if (!global && (!documentId || documentId !== tagDocumentId)) {
        throw new Error(`Document timeline tag belongs to ${tagDocumentId}; pass that documentId explicitly.`);
    }
    const node: TimelineNodeRecord = {
        name: snapshot.memo || tag,
        created: typeof snapshot.created === 'number' ? snapshot.created : Date.now(),
        snapshotId: snapshot.id,
        tag,
        scope: global ? 'global' : 'document',
    };
    return { snapshot, node };
}

export async function listTimelineNodes(
    client: SiYuanClient,
    options: { scope: TimelineListScope; documentId?: string; page?: number; pageSize?: number },
): Promise<TimelineNodePage> {
    const tagged = await repoApi.getRepoTagSnapshots(client);
    let nodes: TimelineNodeRecord[];
    if (options.scope === 'global') {
        nodes = reconcileDocumentTimelineNodes('', [], tagged.snapshots ?? []).globalNodes;
    } else {
        if (!options.documentId) throw new Error('documentId is required for document or all scope.');
        const attrNodes = await readDocumentNodes(client, options.documentId);
        const reconciled = reconcileDocumentTimelineNodes(options.documentId, attrNodes, tagged.snapshots ?? []);
        nodes = options.scope === 'document'
            ? reconciled.documentNodes
            : [...reconciled.documentNodes, ...reconciled.globalNodes];
    }
    const page = paginate(sortTimelineNodesNewestFirst(nodes), options.page ?? 1, options.pageSize ?? 50);
    return {
        nodes: page.items,
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        pageCount: page.pageCount,
        hasMore: page.hasMore,
    };
}

export async function createTimelineNode(
    client: SiYuanClient,
    options: { name: string; scope: TimelineNodeScope; documentId?: string },
): Promise<TimelineNodeCreateResult> {
    const name = options.name.trim();
    if (!name) throw new Error('Timeline node name must not be empty.');
    let existingDocumentNodes: TimelineNodeRecord[] = [];
    if (options.scope === 'document') {
        if (!options.documentId) throw new Error('documentId is required for document scope.');
        existingDocumentNodes = await readDocumentNodes(client, options.documentId);
    }

    const snapshot = await createAndLocateSnapshot(client, name);
    const tagged = await repoApi.getRepoTagSnapshots(client);
    const existingTags = (tagged.snapshots ?? []).map((item) => item.tag).filter((tag): tag is string => Boolean(tag));
    const tag = options.scope === 'global'
        ? createGlobalTimelineTagName(name, existingTags)
        : createTimelineTagName(name, options.documentId!, existingTags);
    try {
        await repoApi.tagSnapshot(client, snapshot.id, tag);
    } catch (error) {
        throw new Error(`Timeline tag creation failed; untagged snapshot ${snapshot.id} remains: ${errorMessage(error)}`);
    }

    const node: TimelineNodeRecord = {
        name,
        created: Date.now(),
        snapshotId: snapshot.id,
        tag,
        scope: options.scope,
    };
    if (options.scope === 'global') return { node };

    try {
        await writeDocumentNodes(client, options.documentId!, [...existingDocumentNodes, node]);
        return { node, documentId: options.documentId };
    } catch (error) {
        return {
            node,
            documentId: options.documentId,
            partialFailure: {
                stage: 'document_index',
                message: errorMessage(error),
                recoverableFromTag: true,
            },
        };
    }
}

/**
 * Remove a node: drop it from the document index first, then delete its tag
 * (the snapshot is kept). A failed tag removal restores the index. Accepts
 * any node kind, including legacy ones the tool API refuses.
 */
export async function removeTimelineNode(
    client: SiYuanClient,
    node: Pick<TimelineNodeRecord, 'tag' | 'scope' | 'snapshotId'>,
    documentId?: string,
): Promise<void> {
    if (!node.tag) throw new Error('The timeline node has no tag to remove.');
    let previousNodes: TimelineNodeRecord[] | undefined;
    if (node.scope === 'document') {
        if (!documentId) throw new Error('documentId is required for document scope.');
        const identity = getTimelineNodeIdentity(node);
        previousNodes = await readDocumentNodes(client, documentId);
        await writeDocumentNodes(
            client,
            documentId,
            previousNodes.filter((item) => getTimelineNodeIdentity(item) !== identity),
        );
    }
    try {
        await repoApi.removeRepoTagSnapshot(client, node.tag);
    } catch (error) {
        if (previousNodes) {
            try {
                await writeDocumentNodes(client, documentId!, previousNodes);
            } catch {
                // The document-scoped tag remains and can repair the index later.
            }
        }
        throw error;
    }
}

export async function deleteTimelineNode(
    client: SiYuanClient,
    options: { tag: string; documentId?: string },
): Promise<{ success: true; tag: string; snapshotId: string; scope: TimelineNodeScope; snapshotRetained: true }> {
    const { node } = await resolveTaggedNode(client, options.tag, options.documentId);
    await removeTimelineNode(client, node, options.documentId);
    return {
        success: true,
        tag: options.tag,
        snapshotId: node.snapshotId,
        scope: node.scope,
        snapshotRetained: true,
    };
}

function matchesDocument(file: ChangedSnapshotFile, documentId: string): boolean {
    return file.documentId === documentId
        || getDocumentIdFromSnapshotFile(file.oldFile) === documentId
        || getDocumentIdFromSnapshotFile(file.newFile) === documentId;
}

function publicBlock(block: SnapshotBlock | undefined): TimelineComparisonBlock | undefined {
    if (!block) return undefined;
    return {
        ...(block.id ? { id: block.id } : {}),
        ...(block.parentID ? { parentID: block.parentID } : {}),
        ...(block.rootID ? { rootID: block.rootID } : {}),
        ...(block.type ? { type: block.type } : {}),
        ...(block.subtype ? { subtype: block.subtype } : {}),
        markdown: block.markdown || block.text,
        order: block.order,
        depth: block.depth,
    };
}

function publicChange(entry: BlockDiffEntry): TimelineComparisonChange {
    return {
        changeKey: entry.key,
        status: entry.status,
        ...(entry.oldBlock ? { old: publicBlock(entry.oldBlock) } : {}),
        ...(entry.newBlock ? { current: publicBlock(entry.newBlock) } : {}),
        rollbackable: entry.canAcceptBlock,
        ...(entry.acceptReason ? { reason: entry.acceptReason } : {}),
    };
}

async function compareTimelineNodeInternal(
    client: SiYuanClient,
    options: {
        documentId: string;
        tag: string;
        page?: number;
        pageSize?: number;
        includeUnchanged?: boolean;
    },
): Promise<InternalTimelineComparison> {
    const { snapshot, node } = await resolveTaggedNode(client, options.tag, options.documentId);
    const currentMemo = `${CURRENT_SNAPSHOT_MEMO_PREFIX} ${options.documentId} ${new Date().toISOString()}`;
    const currentSnapshot = await createAndLocateSnapshot(client, currentMemo);
    const diff = await repoApi.diffRepoSnapshots(client, snapshot.id, currentSnapshot.id);
    const file = buildChangedFiles(diff as Record<string, repoApi.RepoSnapshotFileChange[] | unknown>)
        .find((item) => matchesDocument(item, options.documentId));
    const oldFileId = getSnapshotFileId(file?.oldFile);
    const currentFileId = getSnapshotFileId(file?.newFile);
    const [oldFile, currentFile] = await Promise.all([
        oldFileId ? repoApi.openRepoSnapshotFile(client, oldFileId) : Promise.resolve(undefined),
        currentFileId ? repoApi.openRepoSnapshotFile(client, currentFileId) : Promise.resolve(undefined),
    ]);
    const allEntries = diffSnapshotBlocks(oldFile?.content ?? '', currentFile?.content ?? '');
    const visibleEntries = options.includeUnchanged ? allEntries : allEntries.filter((entry) => entry.status !== 'unchanged');
    const page = paginate(visibleEntries, options.page ?? 1, options.pageSize ?? 20);
    const lineStats = getBlockDiffLineStats(allEntries);
    const changed = allEntries.filter((entry) => entry.status !== 'unchanged');
    return {
        node,
        documentId: options.documentId,
        currentSnapshotId: currentSnapshot.id,
        noChanges: !file || changed.length === 0,
        stats: {
            addedLines: lineStats.added,
            removedLines: lineStats.removed,
            changedBlocks: changed.length,
            rollbackableBlocks: changed.filter((entry) => entry.canAcceptBlock).length,
        },
        changes: page.items.map(publicChange),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        pageCount: page.pageCount,
        hasMore: page.hasMore,
        file,
        oldFileId,
        currentFileId,
        allEntries,
    };
}

export async function compareTimelineNode(
    client: SiYuanClient,
    options: {
        documentId: string;
        tag: string;
        page?: number;
        pageSize?: number;
        includeUnchanged?: boolean;
    },
): Promise<TimelineComparisonResult> {
    const result = await compareTimelineNodeInternal(client, options);
    const { file: _file, oldFileId: _oldFileId, currentFileId: _currentFileId, allEntries: _allEntries, ...publicResult } = result;
    return publicResult;
}

export async function rollbackTimelineDocument(
    client: SiYuanClient,
    options: { documentId: string; tag: string },
): Promise<{ success: true; documentId: string; tag: string; snapshotFileId: string }> {
    const comparison = await compareTimelineNodeInternal(client, options);
    if (!comparison.oldFileId) {
        throw new Error('This node has no historical document file that can be restored.');
    }
    if (comparison.noChanges) throw new Error('The document already matches this timeline node.');
    await repoApi.rollbackRepoSnapshotFile(client, comparison.oldFileId);
    return {
        success: true,
        documentId: options.documentId,
        tag: options.tag,
        snapshotFileId: comparison.oldFileId,
    };
}

/**
 * Restore one block of a comparison: revert a modified block, delete an added
 * one, or re-insert a removed one at the first safe position.
 */
export async function applyTimelineBlockRestore(
    client: SiYuanClient,
    entry: BlockDiffEntry,
    allEntries: BlockDiffEntry[],
    context: Parameters<typeof getRestoreInsertPlan>[2],
): Promise<void> {
    if (!entry.canAcceptBlock) throw new Error(entry.acceptReason || 'This block cannot be restored safely.');
    if (entry.status === 'modified' && entry.newBlock?.id && entry.oldBlock) {
        const payload = getUpdateBlockPayload(entry);
        await blockApi.updateBlock(client, payload.dataType, payload.data, entry.newBlock.id);
    } else if (entry.status === 'added' && entry.newBlock?.id) {
        await blockApi.deleteBlock(client, entry.newBlock.id);
    } else if (entry.status === 'removed' && entry.oldBlock) {
        const plan = getRestoreInsertPlan(entry, allEntries, context);
        if (plan.parentIDs.length === 0) throw new Error('No safe insertion position could be resolved for the removed block.');
        const payload = getRestoreBlockPayload(entry);
        let lastError: unknown;
        let restored = false;
        for (const parentID of plan.parentIDs) {
            try {
                await blockApi.insertBlock(client, {
                    dataType: payload.dataType,
                    data: payload.data,
                    parentID,
                    ...(plan.nextID ? { nextID: plan.nextID } : {}),
                    ...(!plan.nextID && plan.previousID ? { previousID: plan.previousID } : {}),
                });
                restored = true;
                break;
            } catch (error) {
                lastError = error;
            }
        }
        if (!restored) throw lastError ?? new Error('Failed to restore the removed block.');
    } else {
        throw new Error('The selected block change cannot be restored safely.');
    }
}

export async function rollbackTimelineBlock(
    client: SiYuanClient,
    options: { documentId: string; tag: string; changeKey: string },
): Promise<{ success: true; documentId: string; tag: string; changeKey: string; status: BlockDiffEntry['status'] }> {
    const comparison = await compareTimelineNodeInternal(client, options);
    const entry = comparison.allEntries.find((item) => item.key === options.changeKey && item.status !== 'unchanged');
    if (!entry) throw new Error('The changeKey no longer matches the current document state; run compare_node again.');
    if (!entry.canAcceptBlock) throw new Error(entry.acceptReason || 'This block cannot be restored safely.');

    await applyTimelineBlockRestore(client, entry, comparison.allEntries, {
        documentId: options.documentId,
        oldFile: comparison.file?.oldFile,
        newFile: comparison.file?.newFile,
    });

    return {
        success: true,
        documentId: options.documentId,
        tag: options.tag,
        changeKey: options.changeKey,
        status: entry.status,
    };
}
