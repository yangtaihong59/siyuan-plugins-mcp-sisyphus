import type { SiYuanClient } from '../../api/client';
import type { PermissionManager } from '../../core/permissions';
import { asRecord } from '../../shared/record';

export const BATCH_RENAME_MAX_ITEMS = 50;
export const BATCH_RENAME_MAX_INPUT_BYTES = 256 * 1024;

export type BatchRenameItemState =
    | 'committed'
    | 'no_change'
    | 'failed_before_execute'
    | 'unknown'
    | 'not_started';

export type BatchRenameOverallState = 'committed' | 'partial' | 'failed' | 'unknown';

export interface BatchRenameItemPlan {
    index: number;
    id: string;
    title: string;
    notebook: string;
    currentPath: string;
    currentHPath: string;
    parentID: string;
    parentHPath: string;
    targetHPath: string;
    noChange: boolean;
}

export interface BatchRenamePlan {
    items: BatchRenameItemPlan[];
}

export interface BatchRenameItemReceipt {
    index: number;
    id: string;
    title: string;
    state: BatchRenameItemState;
    previousHPath?: string;
    targetHPath?: string;
    reason?: string;
}

export interface BatchRenameProgress {
    overallState: BatchRenameOverallState;
    items: BatchRenameItemReceipt[];
    inProgressIndex?: number;
}

export interface BatchRenameContext {
    plan: BatchRenamePlan;
    checkpoint(progress: BatchRenameProgress): Promise<void>;
}

/** In-process hand-off only; never serialized into tool arguments. */
export const BATCH_RENAME_CONTEXT = Symbol.for('siyuan.sisyphus.batchRenameContext');

function safetyError(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { name: 'BatchRenameError', code });
}

function normalizeTitle(value: unknown, index: number): string {
    if (typeof value !== 'string') {
        throw safetyError('validation_error', `items[${index}].title is required. No document was renamed.`);
    }
    const title = value.trim();
    if (!title) {
        throw safetyError('validation_error', `items[${index}].title must not be blank. No document was renamed.`);
    }
    if (/[/\\\u0000-\u001f]/.test(title)) {
        throw safetyError('validation_error', `items[${index}].title must not contain path separators or control characters. No document was renamed.`);
    }
    if (title.length > 255) {
        throw safetyError('validation_error', `items[${index}].title exceeds 255 characters. No document was renamed.`);
    }
    return title;
}

function parentStoragePath(path: string): string {
    const index = path.lastIndexOf('/');
    return index <= 0 ? '' : path.slice(0, index);
}

function parentHumanPath(hpath: string): string {
    const index = hpath.lastIndexOf('/');
    return index <= 0 ? '' : hpath.slice(0, index);
}

function ancestorStorageIDs(path: string): string[] {
    const segments = path.split('/').filter(Boolean);
    return segments.slice(0, -1).map((segment) => segment.replace(/\.sy$/i, ''));
}

function documentIDFromStoragePath(path: string): string | undefined {
    const name = path.split('/').filter(Boolean).at(-1);
    if (!name?.toLowerCase().endsWith('.sy')) return undefined;
    return name.slice(0, -3);
}

function hpathKey(notebook: string, hpath: string): string {
    // Human-readable paths can repeat across notebooks. Include the notebook
    // so two independent notes never conflict merely because they share a
    // title path in different notebooks.
    return `${notebook}\u0000${hpath.toLowerCase()}`;
}

export function assertBatchRenameInput(items: unknown): asserts items is Array<Record<string, unknown>> {
    if (!Array.isArray(items) || items.length === 0) {
        throw safetyError('validation_error', 'items must contain at least one rename. No document was renamed.');
    }
    if (items.length > BATCH_RENAME_MAX_ITEMS) {
        throw safetyError('validation_error', `items exceeds the ${BATCH_RENAME_MAX_ITEMS}-document batch limit. Split the batch; no document was renamed.`);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(items)).length;
    if (bytes > BATCH_RENAME_MAX_INPUT_BYTES) {
        throw safetyError('validation_error', `items exceeds the ${BATCH_RENAME_MAX_INPUT_BYTES}-byte serialized input limit. Split the batch; no document was renamed.`);
    }
}

/**
 * Resolve every document, target name, sibling collision, permission, and
 * parent-child dependency before a batch commit can start. The resulting plan
 * is part of the strict preimage; any path or sibling change invalidates it.
 */
export async function buildBatchRenamePlan(
    client: SiYuanClient,
    permMgr: PermissionManager,
    items: unknown,
): Promise<BatchRenamePlan> {
    assertBatchRenameInput(items);
    await permMgr.reload();

    const ids = new Set<string>();
    const resolved: Array<Omit<BatchRenameItemPlan, 'noChange' | 'targetHPath' | 'parentHPath' | 'parentID'>> = [];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        if (!id) throw safetyError('validation_error', `items[${index}].id is required. No document was renamed.`);
        if (ids.has(id)) {
            throw safetyError('validation_error', `items[${index}].id "${id}" is duplicated within the batch. No document was renamed.`);
        }
        ids.add(id);
        const title = normalizeTitle(item.title, index);

        const pathInfo = await client.requestRead<{ notebook?: string; box?: string; path?: string }>('/api/filetree/getPathByID', { id });
        const notebook = pathInfo?.notebook || pathInfo?.box || '';
        if (!notebook) {
            throw safetyError('validation_error', `items[${index}].id "${id}" did not resolve to a notebook. No document was renamed.`);
        }
        // Permission is the first gate after the owning notebook is known.
        // Unreadable notebooks must be rejected before we spend more reads on
        // block metadata, and must never be skipped merely because the
        // document identity cannot be proven later.
        if (!permMgr.canWrite(notebook)) {
            throw safetyError('permission_denied', `Notebook ${notebook} does not allow renaming document ${id}. No document was renamed.`);
        }
        const currentPath = typeof pathInfo?.path === 'string' ? pathInfo.path : '';
        if (!currentPath) {
            throw safetyError('validation_error', `items[${index}].id "${id}" did not resolve to a document path. No document was renamed.`);
        }
        // SiYuan 3.8.7 getBlockInfo returns {box, path, rootID, rootChildID,
        // rootTitle}; it does not return id or type. Prove document identity
        // from all three independent projections instead: the block is its own
        // root, its storage path ends with <id>.sy, and its box agrees with
        // getPathByID. A descendant block or a non-document block fails closed.
        const info = asRecord(await client.requestRead<Record<string, unknown>>('/api/block/getBlockInfo', { id }));
        const rootID = typeof info?.rootID === 'string' ? info.rootID : '';
        const blockPath = typeof info?.path === 'string' ? info.path : '';
        const blockBox = typeof info?.box === 'string' ? info.box : '';
        const storageID = documentIDFromStoragePath(blockPath);
        if (rootID !== id || storageID !== id || blockBox !== notebook) {
            throw safetyError('validation_error', `items[${index}].id "${id}" is not a document. No document was renamed.`);
        }
        const currentHPath = await client.requestRead<string>('/api/filetree/getHPathByID', { id });
        if (typeof currentHPath !== 'string' || !currentHPath.startsWith('/')) {
            throw safetyError('validation_error', `items[${index}].id "${id}" has no resolvable human-readable path. No document was renamed.`);
        }
        resolved.push({ index, id, title, notebook, currentPath, currentHPath });
    }

    // Reject parent-child batches: renaming an ancestor would change the
    // descendant's path and invalidate the per-item preimage mid-batch.
    for (const item of resolved) {
        for (const ancestorID of ancestorStorageIDs(item.currentPath)) {
            if (ids.has(ancestorID) && ancestorID !== item.id) {
                throw safetyError(
                    'validation_error',
                    `Items ${ancestorID} and ${item.id} have a parent-child dependency. Split the batch; no document was renamed.`,
                );
            }
        }
    }

    const currentHPaths = new Map(resolved.map((item) => [hpathKey(item.notebook, item.currentHPath), item.id]));
    const targetHPaths = new Map<string, string>();
    const planItems: BatchRenameItemPlan[] = [];

    for (const item of resolved) {
        const parentHPath = parentHumanPath(item.currentHPath);
        const targetHPath = `${parentHPath}/${item.title}`;
        const targetKey = hpathKey(item.notebook, targetHPath);
        const duplicate = targetHPaths.get(targetKey);
        if (duplicate && duplicate !== item.id) {
            throw safetyError('validation_error', `Items ${duplicate} and ${item.id} rename to the same target path "${targetHPath}" in notebook ${item.notebook}. No document was renamed.`);
        }
        targetHPaths.set(targetKey, item.id);

        const otherCurrent = currentHPaths.get(targetKey);
        if (otherCurrent && otherCurrent !== item.id) {
            throw safetyError(
                'validation_error',
                `items[${item.index}] target "${targetHPath}" conflicts with another batch document's current path in notebook ${item.notebook}. No document was renamed.`,
            );
        }

        const existingIDs = await client.requestRead<string[]>('/api/filetree/getIDsByHPath', {
            path: targetHPath,
            notebook: item.notebook,
        });
        const conflicts = (Array.isArray(existingIDs) ? existingIDs : []).filter((id) => id !== item.id);
        if ((existingIDs?.length ?? 0) > 0 && conflicts.length === 0 && item.currentHPath !== targetHPath) {
            throw safetyError(
                'validation_error',
                `items[${item.index}] target "${targetHPath}" already resolves to this document with a different current path. Inspect the index; no document was renamed.`,
            );
        }
        if (conflicts.length > 0) {
            const inBatch = conflicts.find((id) => ids.has(id));
            throw safetyError(
                'validation_error',
                inBatch
                    ? `items[${item.index}] target "${targetHPath}" belongs to batch document ${inBatch}. Renaming into another batch item's current path is rejected; no document was renamed.`
                    : `items[${item.index}] target "${targetHPath}" already exists in notebook ${item.notebook}. Choose a different title; no document was renamed.`,
            );
        }

        const parentPath = parentStoragePath(item.currentPath);
        const parentSegment = parentPath.split('/').filter(Boolean).at(-1)?.replace(/\.sy$/i, '');
        planItems.push({
            ...item,
            parentID: parentSegment || item.notebook,
            parentHPath,
            targetHPath,
            noChange: item.currentHPath === targetHPath,
        });
    }

    return { items: planItems };
}

export function initialBatchRenameProgress(plan: BatchRenamePlan): BatchRenameProgress {
    return {
        overallState: 'unknown',
        items: plan.items.map((item) => ({
            index: item.index,
            id: item.id,
            title: item.title,
            state: 'not_started',
            previousHPath: item.currentHPath,
            targetHPath: item.targetHPath,
        })),
    };
}

export function overallBatchRenameState(items: BatchRenameItemReceipt[]): BatchRenameOverallState {
    if (items.some((item) => item.state === 'unknown')) return 'unknown';
    if (items.some((item) => item.state === 'failed_before_execute')) {
        return items.some((item) => item.state === 'committed' || item.state === 'no_change') ? 'partial' : 'failed';
    }
    if (items.every((item) => item.state === 'committed' || item.state === 'no_change')) return 'committed';
    return 'partial';
}
