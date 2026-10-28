/*
 * Strict-write state probes: the pre/post-write state each mutation hashes,
 * plus semantic verification of the post-write readback. Coordinator-internal.
 */
import * as avApi from '../api/av';
import * as blockApi from '../api/block';
import * as documentApi from '../api/document';
import * as fileApi from '../api/file';
import * as flashcardApi from '../api/flashcard';
import * as notebookApi from '../api/notebook';
import * as repoApi from '../api/repo';
import * as searchApi from '../api/search';
import * as systemApi from '../api/system';

import { prepareDocumentConversion } from '../tools/document/conversion';
import { readFlashcardReviewState } from '../tools/flashcard/review-state';
import { assertAvAddRowsStructure } from '../tools/av/add-rows-plan';
import { prepareViewUpdate } from '../tools/av/view-config';
import { getStagedUpload } from '../core/upload-source';
import { verifyAvCellsReadback } from '../tools/av/cell-readback';
import { nodeFs } from '../core/node-loader';
import type { SiYuanClient } from '../api/client';
import { normalizeTemplatePath, readTemplateSource } from '../api/template';
import { readPuppyStats } from '../core/puppy-state';
import { readLinkTargetScope } from '../tools/document/link-targets';
import type { PermissionManager } from '../core/permissions';
import type { ToolResult } from '../core/tool-result';
import { listDocumentBlocksInTreeOrder, readDocumentEditableMarkdown } from '../tools/internal/document-kramdown';
import { assertExactOrder, readDocumentReorderState, resolveFsReorderOrder } from '../tools/internal/helpers/document-reorder';
import { resolveFsCreateTarget, resolveFsScopePath } from '../tools/internal/helpers/fs-path';
import { AGENT_MEMORY_VIRTUAL_PATH, isDangerousAction, MCP_TOOLS_CONFIG_API_PATH, USER_RULES_VIRTUAL_PATH, type ToolCategory } from '../core/config';
import { hashWriteBytes, hashWriteBytesAsync, hashWriteState } from '../core/write-safety-hash';
import { canonicalizeAvCarrierDom, findHtmlOpeningTagEnd, parseHtmlOpeningTagAttributes } from '../shared/av-carrier-dom';
import { type ActionSafetyPolicy } from '../core/write-safety-policy';
import { safetyError } from '../core/write-safety-error';
import { stripSafetyFields } from './write-safety-ledger';
import { extractRawAvDefinition, findRawAvView, inspectHighRiskAvMutation, isCrossObjectAvMutation, requireCarrierWritePermission, verifyAvViewConfigurationReadback } from './write-safety-av';
import { AV_VIEW_CONFIGURATION_ACTIONS, type StateProbe, collectNotebookBoxes, collectPathSelectors, collectStateSelectors, collectTargetSelectors, isRecord, parseResultObject, sqlString } from '../core/write-safety-records';

export function derivePostWriteProbeArgs(
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
    result: ToolResult,
): Record<string, unknown> {
    const payload = parseResultObject(result);
    if (category === 'document' && (action === 'create' || action === 'create_daily_note')) {
        if (!payload || typeof payload.id !== 'string' || !payload.id) {
            throw safetyError('readback_mismatch', 'Document creation did not identify the created document.');
        }
        // A human path can exist in several notebooks and its SQL index may
        // lag. Inspect only the returned document and its intended notebook.
        return { id: payload.id, notebook: args.notebook };
    }
    if (category === 'document' && action === 'duplicate' && payload && typeof payload.id === 'string') {
        return { ...args, id: payload.id };
    }
    if (category === 'document' && action === 'ensure_link_targets' && payload && isRecord(payload.linkMap)) {
        const resolvedTargetIds = Object.values(payload.linkMap)
            .flatMap((value) => isRecord(value) && typeof value.id === 'string' ? [value.id] : []);
        return { ...args, resolvedTargetIds };
    }
    if (category === 'av' && (action === 'duplicate' || action === 'create') && payload && typeof payload.avID === 'string') {
        return {
            ...args,
            avID: payload.avID,
            ...(typeof payload.blockID === 'string' ? { blockID: payload.blockID } : action === 'create' ? { blockID: undefined } : {}),
        };
    }
    return args;
}

export async function probeCreatedNotebook(client: SiYuanClient, result: ToolResult): Promise<StateProbe> {
    const payload = parseResultObject(result);
    const notebookID = payload && typeof payload.id === 'string' ? payload.id : '';
    if (!notebookID) {
        throw safetyError('readback_mismatch', 'The notebook creation response did not identify the new notebook.');
    }

    let notebook: Record<string, unknown> | undefined;
    for (const delay of [0, 50, 100, 200, 400]) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        const listed = await notebookApi.listNotebooks(client);
        notebook = (listed?.notebooks ?? []).find((item) => item.id === notebookID) as unknown as Record<string, unknown> | undefined;
        if (notebook) break;
    }
    if (!notebook) {
        throw safetyError('readback_mismatch', `The created notebook ${notebookID} was not observed during bounded readback.`);
    }

    const conf = await notebookApi.getNotebookConf(client, notebookID);
    const state = { category: 'notebook', action: 'create', notebook, conf };
    return {
        hash: hashWriteState(state),
        targetIds: [notebookID],
        summary: { targetCount: 1 },
    };
}

export async function probePostWriteState(
    client: SiYuanClient,
    permMgr: PermissionManager,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
    policy: Extract<ActionSafetyPolicy, { mode: 'mutation' }>,
    before: StateProbe | undefined,
): Promise<StateProbe> {
    let after = await probeCurrentState(client, permMgr, category, action, args, policy);
    // AV view configuration is deliberately one dispatch plus one exact raw
    // definition/carrier readback. The kernel persists these settings in the
    // same request; polling would turn a response-loss investigation into
    // repeated reads without authorizing a retry or changing the decision.
    if (category === 'av' && AV_VIEW_CONFIGURATION_ACTIONS.has(action)) return after;
    if (!before || after.hash !== before.hash) return after;

    // Several SiYuan mutations acknowledge before secondary indexes and
    // derived file-tree views catch up. A bounded readback poll prevents an
    // actual commit from being mislabeled as no_change while still allowing
    // legitimate idempotent/no-op writes to complete promptly.
    for (const delay of [50, 100, 200, 400, 800]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        after = await probeCurrentState(client, permMgr, category, action, args, policy);
        if (after.hash !== before.hash) break;
    }
    return after;
}

export async function probeUploadedResult(client: SiYuanClient, result: ToolResult, source: StateProbe): Promise<StateProbe> {
    const payload = parseResultObject(result);
    const succMap = payload && isRecord(payload.succMap) ? payload.succMap : undefined;
    const uploadedPath = succMap
        ? Object.values(succMap).find((value): value is string => typeof value === 'string')
        : undefined;
    if (!uploadedPath) {
        throw safetyError('readback_mismatch', 'The upload response did not identify the stored asset.');
    }
    const workspacePath = uploadedPath.startsWith('/data/')
        ? uploadedPath
        : `/data/${uploadedPath.replace(/^\/+/, '')}`;
    const bytes = await client.readFileBinary(workspacePath);
    const uploadedHash = await hashWriteBytesAsync(bytes);
    if (uploadedHash !== source.hash) {
        throw safetyError('readback_mismatch', 'The uploaded asset digest does not match the validated source file.');
    }
    return {
        hash: uploadedHash,
        targetIds: [workspacePath],
        summary: { uploadedPath: workspacePath, uploadedSize: bytes.byteLength },
    };
}

export async function probeCurrentState(
    client: SiYuanClient,
    permMgr: PermissionManager,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
    policy: Extract<ActionSafetyPolicy, { mode: 'mutation' }>,
    precomputed?: Record<string, unknown>,
): Promise<StateProbe> {
    if (policy.precondition === 'source') {
        if (typeof args.uploadSource === 'string') {
            const source = getStagedUpload(client, args.uploadSource);
            return { hash: source.hash, targetIds: [args.uploadSource], summary: { sourceSize: source.bytes.byteLength } };
        }
        const localFilePath = typeof args.localFilePath === 'string' ? args.localFilePath : '';
        if (!localFilePath) throw safetyError('precondition_required', 'localFilePath is required to fingerprint the upload source.');
        const bytes = await nodeFs().promises.readFile(localFilePath);
        return {
            hash: hashWriteBytes(bytes),
            targetIds: [localFilePath],
            summary: { sourceSize: bytes.byteLength },
        };
    }

    let targetIds = collectTargetSelectors(args);
    const state: Record<string, unknown> = {
        category,
        action,
        selectors: collectStateSelectors(args),
    };

    if (isRecord(precomputed?.conversion)) {
        state.conversion = precomputed.conversion;
        const conversion = precomputed.conversion as Awaited<ReturnType<typeof prepareDocumentConversion>>;
        const ids = [conversion.source.documentId, conversion.target.documentId].filter(Boolean);
        targetIds = [...new Set([...targetIds, ...ids, conversion.target.notebook])].sort();
        await appendBlockRows(client, { ids }, state);
    } else if ((category === 'fs' || category === 'document') && action === 'reorder') {
        const reorder = await probeDocumentReorderState(client, permMgr, category, args);
        state.reorder = reorder.state;
        targetIds = reorder.targetIds;
    } else if (category === 'fs') {
        await appendHumanPathState(client, args, state);
    } else if (category === 'mascot') {
        state.mascot = await readPuppyStats(client);
    } else if (category === 'notebook') {
        const notebooks = await notebookApi.listNotebooks(client);
        const selected = (notebooks?.notebooks ?? []).filter((item) => {
            const id = typeof item.id === 'string' ? item.id : '';
            return targetIds.length === 0 || targetIds.includes(id);
        });
        state.notebooks = selected;
        for (const item of selected) {
            const id = typeof item.id === 'string' ? item.id : '';
            if (id) state[`conf:${id}`] = await notebookApi.getNotebookConf(client, id);
        }
        if (action === 'set_permission') state.permissions = permMgr.getAll();
    } else if (category === 'av' && typeof args.avID === 'string') {
        state.av = await avApi.getAttributeView(client, args.avID);
        if (action === 'add_rows' && Array.isArray(args.rows)) {
            // Composite rows write into an existing AV, so the carrier and
            // every column/type/view/group involved in the batch must enter
            // the strict preimage. A structural problem is rejected before
            // any row is inserted.
            const carrier = await requireCarrierWritePermission(
                client,
                permMgr,
                args.avID,
                typeof args.blockID === 'string' ? args.blockID : undefined,
            );
            state.avCarrier = carrier.carrier;
            for (const id of [carrier.carrierBlockID, carrier.notebook]) {
                if (!targetIds.includes(id)) targetIds.push(id);
            }
            targetIds.sort();
            assertAvAddRowsStructure(
                state.av,
                args.rows,
                typeof args.viewID === 'string' ? args.viewID : undefined,
                typeof args.groupID === 'string' ? args.groupID : undefined,
                typeof args.previousID === 'string' ? args.previousID : undefined,
            );
        }
        if (action === 'create') {
            const definition = extractRawAvDefinition(state.av);
            if (definition.id !== args.avID) throw safetyError('readback_mismatch', 'Rendered AV identity was not persisted.');
            const blockID = typeof args.blockID === 'string' ? args.blockID : '';
            if (blockID) {
                const carrier = await blockApi.getBlockDOM(client, blockID);
                if (!carrier.dom?.includes('data-type="NodeAttributeView"') || !carrier.dom.includes(`data-av-id="${args.avID}"`)) {
                    throw safetyError('readback_mismatch', 'Rendered AV carrier does not bind the returned AV identity.');
                }
                state.avCarrier = { blockID, dom: canonicalizeAvCarrierDom(carrier.dom) };
            }
        }
        if (action === 'set_column_options' || isCrossObjectAvMutation(action)) {
            const inspectedAv = await inspectHighRiskAvMutation(
                client,
                permMgr,
                action,
                args,
                state.av,
            );
            state.avMutationScope = inspectedAv.state;
            for (const id of inspectedAv.targetIds) {
                if (!targetIds.includes(id)) targetIds.push(id);
            }
            targetIds.sort();
        }
        if (AV_VIEW_CONFIGURATION_ACTIONS.has(action)) {
            const blockID = typeof args.blockID === 'string' ? args.blockID : '';
            const viewID = typeof args.viewID === 'string' ? args.viewID : '';
            if (!blockID || !viewID) {
                throw safetyError('precondition_required', 'AV view configuration requires explicit avID, blockID, and viewID.');
            }
            const [attrs, dom, blockInfo] = await Promise.all([
                blockApi.getBlockAttrs(client, blockID),
                blockApi.getBlockDOM(client, blockID),
                blockApi.getBlockInfo(client, blockID),
            ]);
            const selectedViewID = isRecord(attrs) && typeof attrs['custom-sy-av-view'] === 'string'
                ? attrs['custom-sy-av-view']
                : '';
            const rawAv = extractRawAvDefinition(state.av);
            if (action === 'update_view') prepareViewUpdate(rawAv, stripSafetyFields(args));
            if (!selectedViewID || !findRawAvView(rawAv, selectedViewID)) {
                throw safetyError('precondition_required', 'The AV carrier does not select one exact persisted view. Refusing kernel fallback.');
            }
            if (action !== 'add_view' && selectedViewID !== viewID) {
                throw safetyError('precondition_required', 'The AV carrier no longer selects the requested view. Refusing kernel fallback.');
            }
            const domText = isRecord(dom) && typeof dom.dom === 'string' ? dom.dom : '';
            if (!domText.includes('data-type="NodeAttributeView"') || !domText.includes(`data-av-id="${args.avID}"`)) {
                throw safetyError('precondition_required', 'The explicit AV carrier does not prove NodeAttributeView ownership of the requested avID.');
            }
            const box = isRecord(blockInfo) && typeof blockInfo.box === 'string' ? blockInfo.box.trim() : '';
            if (!box) {
                throw safetyError('precondition_required', 'The explicit AV carrier has no resolvable notebook owner. Refusing an unscoped write.');
            }
            state.avCarrier = {
                blockID,
                viewID: selectedViewID,
                ...(action === 'add_view' ? { requestedViewID: viewID } : {}),
                // This resolved owner is intentionally part of the strict
                // preimage. A handler must not reach a kernel AV write when a
                // carrier cannot be tied to a notebook permission decision.
                box,
                attrs: {
                    'custom-sy-av-view': attrs['custom-sy-av-view'],
                    'custom-sy-av-visible-views': attrs['custom-sy-av-visible-views'],
                },
                dom: canonicalizeAvCarrierDom(domText),
            };
        }
    } else if (category === 'flashcard') {
        if (action === 'review_card') {
            const card = await readFlashcardReviewState(client, permMgr, String(args.deckID), String(args.cardID));
            state.flashcardReview = card;
            targetIds = [...new Set([...targetIds, card.blockID, card.box])].sort();
        } else if (typeof args.deckID === 'string') {
            const cards = await flashcardApi.getRiffCards(client, args.deckID, 1, 999) as unknown as Record<string, unknown>;
            const cardID = typeof args.cardID === 'string' ? args.cardID : undefined;
            const blockIDs = Array.isArray(args.blockIDs)
                ? args.blockIDs.filter((item): item is string => typeof item === 'string')
                : [];
            const rows = Array.isArray(cards.cards)
                ? cards.cards
                : Array.isArray(cards.blocks)
                    ? cards.blocks
                    : [];
            const selectedRows = cardID
                ? rows.filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).cardID === cardID)
                : blockIDs.length > 0
                    ? rows.filter((item) => {
                        if (!item || typeof item !== 'object') return false;
                        const row = item as Record<string, unknown>;
                        const blockID = typeof row.blockID === 'string' ? row.blockID : typeof row.id === 'string' ? row.id : '';
                        return blockIDs.includes(blockID);
                    })
                    : rows;
            state.flashcards = normalizeFlashcardState(selectedRows);
        } else {
            const blockIDs = Array.isArray(args.blockIDs)
                ? args.blockIDs.filter((item): item is string => typeof item === 'string')
                : [];
            state.flashcards = blockIDs.length > 0
                ? await flashcardApi.getRiffCardsByBlockIDs(client, blockIDs)
                : [];
        }
    } else if (category === 'file') {
        await appendFileState(client, action, args, state);
    } else if (category === 'timeline') {
        state.timelineTags = await repoApi.getRepoTagSnapshots(client);
        if (typeof args.documentId === 'string' && args.documentId) {
            const blocks = await listDocumentBlocksInTreeOrder(client, args.documentId);
            state.timelineDocument = {
                id: args.documentId,
                blocks,
                markdown: await readDocumentEditableMarkdown(client, args.documentId, blocks),
            };
        }
        await appendBlockRows(client, args, state);
    } else if (category === 'system') {
        state.system = await systemApi.getConf(client);
    } else if (category === 'document' && action === 'rename' && Array.isArray(args.items)) {
        if (isRecord(precomputed?.batchRename)) {
            state.batchRename = precomputed.batchRename;
            for (const item of Array.isArray(precomputed.batchRename.items) ? precomputed.batchRename.items : []) {
                if (!isRecord(item)) continue;
                for (const value of [item.id, item.notebook, item.targetHPath]) {
                    if (typeof value === 'string' && value && !targetIds.includes(value)) targetIds.push(value);
                }
            }
            targetIds.sort();
        } else {
            // Post-write probes only need the live block rows for the exact
            // batch items; rebuilding target-conflict state after a partial
            // rename would misreport the already-committed items.
            await appendBlockRows(client, args, state);
        }
    } else if (category === 'document' && action === 'ensure_link_targets') {
        const notebook = typeof args.notebook === 'string' ? args.notebook : '';
        const parentId = typeof args.parentId === 'string' ? args.parentId : '';
        if (!notebook || !parentId) {
            throw safetyError('precondition_required', 'document.ensure_link_targets requires explicit notebook and parentId scope.');
        }
        const scope = await readLinkTargetScope(client, { notebook, parentId });
        const declaredTargetIds = Array.isArray(args.targets)
            ? args.targets.flatMap((target) => isRecord(target) && typeof target.id === 'string' ? [target.id] : [])
            : [];
        const resolvedTargetIds = Array.isArray(args.resolvedTargetIds)
            ? args.resolvedTargetIds.filter((id): id is string => typeof id === 'string')
            : [];
        state.documentLinkTargetScope = {
            notebookID: notebook,
            parent: scope.parent,
            // Creation must freeze the complete direct-child list, not a
            // title search result, so same-title collisions and concurrent
            // child creation invalidate the preflight structure credential.
            children: scope.children,
            declaredTargetIds: [...new Set([...declaredTargetIds, ...resolvedTargetIds])].sort(),
        };
    } else {
        await appendBlockRows(client, args, state);
    }

    const managesNotebookPermission = category === 'notebook' && action === 'set_permission';
    // The coordinator can outlive permission changes. Refresh for every
    // permission decision, including preflight and the final commit probe.
    if (!managesNotebookPermission) await permMgr.reload();
    if (category === 'notebook' && !managesNotebookPermission) {
        for (const notebook of targetIds) {
            const allowed = isDangerousAction(category, action)
                ? permMgr.canDelete(notebook)
                : permMgr.canWrite(notebook);
            if (!allowed) throw safetyError('permission_denied', notebookDeniedMessage(permMgr, notebook, isDangerousAction(category, action)));
        }
    }
    if (!managesNotebookPermission) {
        enforceNotebookPermission(permMgr, state, targetIds, requiresDeletePermission(category, action));
    }
    return {
        hash: hashWriteState(state),
        targetIds,
        summary: { targetCount: targetIds.length },
        state,
    };
}

async function probeDocumentReorderState(
    client: SiYuanClient,
    permMgr: PermissionManager,
    category: 'fs' | 'document',
    args: Record<string, unknown>,
): Promise<{ state: Record<string, unknown>; targetIds: string[] }> {
    if (category === 'fs') {
        const path = typeof args.path === 'string' ? args.path : '';
        const orderedPaths = Array.isArray(args.orderedPaths)
            ? args.orderedPaths.filter((value): value is string => typeof value === 'string')
            : [];
        const scope = await resolveFsScopePath(client, permMgr, path, 'write');
        if (scope.type === 'root') {
            throw safetyError('invalid_arguments', 'fs.reorder requires a notebook or parent document path.');
        }
        const parentID = scope.type === 'document' ? scope.id : scope.notebook;
        const current = await readDocumentReorderState(client, scope.notebook, parentID, scope.storagePath);
        const resolved = resolveFsReorderOrder(current, scope.notebookName, orderedPaths);
        return {
            state: {
                ...current,
                requestedPaths: resolved.orderedPaths,
                requestedIDs: resolved.orderedIDs,
            },
            targetIds: [...new Set([scope.notebook, parentID, ...current.children.map((child) => child.id)])].sort(),
        };
    }

    const parentID = typeof args.parentID === 'string' ? args.parentID : '';
    const orderedIDs = Array.isArray(args.orderedIDs)
        ? args.orderedIDs.filter((value): value is string => typeof value === 'string')
        : [];
    const listed = await notebookApi.listNotebooks(client);
    const isNotebook = (listed?.notebooks ?? []).some((item) => item.id === parentID);
    let notebook: string;
    let parentPath: string;
    if (isNotebook) {
        notebook = parentID;
        parentPath = '/';
    } else {
        const pathInfo = await documentApi.getPathByID(client, parentID);
        notebook = pathInfo.notebook || pathInfo.box || '';
        parentPath = pathInfo.path || '';
        const resolvedID = parentPath.split('/').filter(Boolean).at(-1)?.replace(/\.sy$/i, '');
        if (!notebook || !parentPath || resolvedID !== parentID) {
            throw safetyError('invalid_arguments', `parentID must identify a notebook or document root, got "${parentID}".`);
        }
    }
    const current = await readDocumentReorderState(client, notebook, parentID, parentPath);
    assertExactOrder(current.children.map((child) => child.id), orderedIDs, 'orderedIDs');
    return {
        state: { ...current, requestedIDs: orderedIDs },
        targetIds: [...new Set([notebook, parentID, ...current.children.map((child) => child.id)])].sort(),
    };
}

async function appendFileState(
    client: SiYuanClient,
    action: string,
    args: Record<string, unknown>,
    state: Record<string, unknown>,
): Promise<void> {
    const templateActions = new Set(['create_template', 'update_template', 'delete_template']);
    if (templateActions.has(action) && typeof args.path === 'string') {
        try {
            const source = await readTemplateSource(client, args.path);
            state.template = { path: normalizeTemplatePath(args.path).relativePath, markdown: source.markdown };
        } catch (error) {
            if ((error as { reason?: string })?.reason !== 'template_not_found') throw error;
            state.template = { path: normalizeTemplatePath(args.path).relativePath, missing: true };
        }
        return;
    }
    if (action === 'save_doc_as_template' && typeof args.name === 'string') {
        const relativePath = `${args.name.replace(/\.md$/i, '')}.md`;
        try {
            const source = await readTemplateSource(client, relativePath);
            state.destinationTemplate = { path: relativePath, markdown: source.markdown };
        } catch (error) {
            if ((error as { reason?: string })?.reason !== 'template_not_found') throw error;
            state.destinationTemplate = { path: relativePath, missing: true };
        }
        await appendBlockRows(client, args, state);
        return;
    }
    if (action === 'remove_unused_assets') {
        state.unusedAssets = await fileApi.getUnusedAssets(client);
        return;
    }
    const assetPath = typeof args.oldPath === 'string'
        ? args.oldPath
        : typeof args.path === 'string'
            ? args.path
            : undefined;
    if (assetPath) {
        const workspacePath = assetPath.startsWith('/data/')
            ? assetPath
            : `/data/${assetPath.replace(/^\/+/, '')}`;
        try {
            const bytes = await client.readFileBinary(workspacePath);
            state.asset = { path: workspacePath, hash: await hashWriteBytesAsync(bytes), size: bytes.byteLength };
        } catch {
            state.asset = { path: workspacePath, missing: true };
        }
    }
    await appendBlockRows(client, args, state);
}

async function appendHumanPathState(
    client: SiYuanClient,
    args: Record<string, unknown>,
    state: Record<string, unknown>,
): Promise<void> {
    const paths = collectPathSelectors(args);
    if (paths.some((path) => path === AGENT_MEMORY_VIRTUAL_PATH || path === USER_RULES_VIRTUAL_PATH)) {
        try {
            state.virtualConfig = await client.readFile(MCP_TOOLS_CONFIG_API_PATH);
        } catch {
            state.virtualConfig = '';
        }
    }
    const physicalPaths = paths.filter((path) => path !== AGENT_MEMORY_VIRTUAL_PATH && path !== USER_RULES_VIRTUAL_PATH);
    if (physicalPaths.length === 0) return;

    const response = await notebookApi.listNotebooks(client);
    const notebooks = response?.notebooks ?? [];
    const pathState: Record<string, unknown> = {};
    for (const path of physicalPaths) {
        const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        const notebookName = parts.shift() ?? '';
        const notebook = notebooks.find((item) => item.name === notebookName);
        if (!notebook?.id) {
            pathState[path] = { missing: true, notebookName };
            continue;
        }
        const hpath = `/${parts.join('/')}`;
        let ids: string[] = [];
        try {
            const resolved: unknown = await documentApi.getIDsByHPath(client, hpath, notebook.id);
            if (Array.isArray(resolved)) {
                ids = resolved.filter((value): value is string => typeof value === 'string');
            }
        } catch {
            // Fall through to the SQL compatibility path below.
        }
        if (ids.length === 0) {
            const roots = await searchApi.querySQL(client, `SELECT * FROM blocks WHERE box = ${sqlString(notebook.id)} AND hpath = ${sqlString(hpath)} ORDER BY id LIMIT 1`) as Array<Record<string, unknown>>;
            ids = Array.isArray(roots)
                ? roots.flatMap((row) => typeof row?.id === 'string' ? [row.id] : [])
                : [];
        }
        const rootID = ids[0];
        if (!rootID) {
            pathState[path] = { notebookID: notebook.id, hpath, missing: true };
            continue;
        }
        // Path and SQL indexes can still return a document immediately after
        // deletion. Confirm its live existence before reading the block tree.
        // Only an explicit false proves absence; transport errors must escape.
        if (await blockApi.checkBlockExist(client, rootID) === false) {
            pathState[path] = { notebookID: notebook.id, hpath, missing: true };
            continue;
        }
        // The blocks SQL table is asynchronously indexed. Hashing it allowed
        // a write immediately after block.append to reuse a stale hash. Read
        // the live block tree and each block's current kramdown instead; these
        // APIs observe the editor state used by the actual write handlers.
        const blocks = await listDocumentBlocksInTreeOrder(client, rootID);
        const markdown = await readDocumentEditableMarkdown(client, rootID, blocks);
        pathState[path] = {
            notebookID: notebook.id,
            hpath,
            rootID,
            blocks,
            markdown,
        };
    }
    state.fsPaths = pathState;
}

async function appendBlockRows(
    client: SiYuanClient,
    args: Record<string, unknown>,
    state: Record<string, unknown>,
): Promise<void> {
    const ids = collectTargetSelectors(args).filter((value) => /^\d{14}-[a-z0-9]{7}$/.test(value));
    const paths = collectPathSelectors(args);
    const tag = typeof args.label === 'string'
        ? args.label
        : typeof args.oldLabel === 'string'
            ? args.oldLabel
            : undefined;
    const clauses: string[] = [];
    if (ids.length > 0) {
        const liveBlocks: Record<string, unknown> = {};
        for (const id of ids) {
            let exists: boolean | undefined;
            try {
                const value = await blockApi.checkBlockExist(client, id);
                if (typeof value === 'boolean') exists = value;
            } catch {
                exists = undefined;
            }
            if (exists === false) {
                liveBlocks[id] = { missing: true };
                continue;
            }
            if (exists === true) {
                const [info, attrs, kramdown, children, dom] = await Promise.all([
                    blockApi.getBlockInfo(client, id),
                    blockApi.getBlockAttrs(client, id),
                    blockApi.getBlockKramdown(client, id),
                    blockApi.getChildBlocks(client, id),
                    blockApi.getBlockDOM(client, id),
                ]);
                liveBlocks[id] = normalizeLiveBlockState({ info, attrs, kramdown, children });
                // Kramdown can omit persisted inline textmark attributes.
                // Keep the DOM in the preimage and postimage as well.
                (liveBlocks[id] as Record<string, unknown>).dom = isRecord(dom) && typeof dom.dom === 'string'
                    ? canonicalizeBlockDom(dom.dom)
                    : dom;
                continue;
            }
            const values = ids.map(sqlString).join(',');
            clauses.push(`id IN (${values})`, `root_id IN (${values})`, `parent_id IN (${values})`);
            break;
        }
        state.liveBlocks = liveBlocks;
    }
    for (const path of paths) {
        clauses.push(`path = ${sqlString(path)}`, `hpath = ${sqlString(path)}`);
    }
    if (tag) clauses.push(`markdown LIKE ${sqlString(`%#${tag.replace(/^#|#$/g, '')}#%`)}`);
    if (clauses.length === 0) {
        state.blocks = [];
        return;
    }
    state.blocks = await searchApi.querySQL(client, `SELECT * FROM blocks WHERE ${typeof args.notebook === 'string' ? `box = ${sqlString(args.notebook)} AND ` : ''}(${clauses.join(' OR ')}) ORDER BY id`);
}

function canonicalizeBlockDom(dom: string): string {
    const tags = /<([A-Za-z][A-Za-z0-9:-]*)\b/g;
    let output = '';
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = tags.exec(dom)) !== null) {
        const end = findHtmlOpeningTagEnd(dom, tags.lastIndex);
        if (end === undefined) break;
        const parsed = parseHtmlOpeningTagAttributes(dom.slice(tags.lastIndex, end));
        tags.lastIndex = end + 1;
        if (!parsed) continue;
        const attributes = parsed.attributes
            .filter((attr) => !['updated', 'created', 'data-updated', 'data-created'].includes(attr.name.toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name) || a.index - b.index);
        output += dom.slice(cursor, match.index)
            + `<${match[1]}${attributes.map((attr) => ` ${attr.raw}`).join('')}${parsed.selfClosing ? ' /' : ''}>`;
        cursor = end + 1;
    }
    return output + dom.slice(cursor);
}

function normalizeLiveBlockState(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeLiveBlockState);
    if (typeof value === 'string') return canonicalizeKramdownIal(value);
    if (!value || typeof value !== 'object') return value;

    const normalized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        // These timestamps are derived bookkeeping, not document semantics.
        // SiYuan may also emit IAL attributes in different orders between
        // identical reads, so both forms must be normalized before hashing.
        if (key === 'updated' || key === 'created') continue;
        normalized[key] = normalizeLiveBlockState(nested);
    }
    return normalized;
}

function normalizeFlashcardState(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeFlashcardState);
    if (!value || typeof value !== 'object') return normalizeLiveBlockState(value);
    const normalized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        // The kernel derives a fresh sub-second due timestamp on every read
        // for new cards. Identity, deck binding, reps/state, and lastReview
        // are stable mutation preconditions; the computed due is not.
        if (key === 'due') continue;
        normalized[key] = normalizeFlashcardState(nested);
    }
    return normalizeLiveBlockState(normalized);
}

function canonicalizeKramdownIal(value: string): string {
    return value.replace(/\{:\s*([^}]*)\}/g, (_match, body: string) => {
        const attributes: Array<{ key: string; token: string }> = [];
        const tokenPattern = /([^\s=]+)=("(?:\\.|[^"])*"|[^\s]+)/g;
        let token: RegExpExecArray | null;
        while ((token = tokenPattern.exec(body)) !== null) {
            if (token[1] === 'updated' || token[1] === 'created') continue;
            attributes.push({ key: token[1], token: `${token[1]}=${token[2]}` });
        }
        attributes.sort((left, right) => left.key.localeCompare(right.key));
        return attributes.length > 0 ? `{: ${attributes.map((item) => item.token).join(' ')}}` : '{:}';
    });
}

export async function verifyPostWriteSemanticState(
    client: SiYuanClient,
    permMgr: PermissionManager,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
    before?: StateProbe,
    after?: StateProbe,
): Promise<void> {
    if (category === 'document' && (action === 'create' || action === 'create_daily_note')) {
        const blocks = isRecord(after?.state?.liveBlocks) ? Object.values(after.state.liveBlocks) : [];
        const documents = blocks.flatMap(block => isRecord(block) && isRecord(block.info) ? [block.info] : []);
        if (documents.length !== 1 || documents[0].box !== args.notebook) {
            throw safetyError('readback_mismatch', 'The created document was not observed in the requested notebook.');
        }
        return;
    }
    if ((category === 'fs' || category === 'document') && action === 'reorder') {
        const { state } = await probeDocumentReorderState(client, permMgr, category, args);
        const currentIDs = Array.isArray(state.children)
            ? state.children
                .filter((child): child is Record<string, unknown> => isRecord(child))
                .map((child) => child.id)
                .filter((id): id is string => typeof id === 'string')
            : [];
        const requestedIDs = Array.isArray(state.requestedIDs)
            ? state.requestedIDs.filter((id): id is string => typeof id === 'string')
            : [];
        if (state.sortMode !== 6 || currentIDs.length !== requestedIDs.length || currentIDs.some((id, index) => id !== requestedIDs[index])) {
            throw safetyError('readback_mismatch', 'The document tree did not retain the requested complete order in custom sorting mode.');
        }
        return;
    }
    if (category === 'av' && action === 'set_cells') {
        verifyAvCellsReadback(args, extractRawAvDefinition(after?.state?.av));
        return;
    }
    if (category === 'av' && AV_VIEW_CONFIGURATION_ACTIONS.has(action)) {
        verifyAvViewConfigurationReadback(action, args, before, after);
        return;
    }
    if (category !== 'search' || action !== 'find_replace') return;
    const method = typeof args.method === 'number' ? args.method : undefined;
    const methodName = typeof args.methodName === 'string' ? args.methodName : undefined;
    const isPlainKeyword = (method === undefined || method === 0)
        && (methodName === undefined || methodName === 'keyword')
        && args.paths === undefined
        && args.types === undefined
        && args.replaceTypes === undefined;
    if (!isPlainKeyword) return;

    const ids = Array.isArray(args.ids)
        ? args.ids.filter((value): value is string => typeof value === 'string')
        : [];
    const keyword = typeof args.k === 'string' ? args.k : '';
    const replacement = typeof args.r === 'string' ? args.r : '';
    if (ids.length === 0 || !keyword) return;

    const readbacks = await Promise.all(ids.map((id) => blockApi.getBlockKramdown(client, id)));
    const markdown = readbacks.map((value) => {
        if (isRecord(value) && typeof value.kramdown === 'string') return value.kramdown;
        return typeof value === 'string' ? value : '';
    }).join('\n');
    if (!replacement.includes(keyword) && markdown.includes(keyword)) {
        throw safetyError('readback_mismatch', 'The find/replace response returned, but the original keyword is still present in the requested targets.');
    }
    if (replacement && replacement !== keyword && !markdown.includes(replacement)) {
        throw safetyError('readback_mismatch', 'The find/replace response returned, but the replacement text was not observed in the requested targets.');
    }
}

const DESTINATION_NOTEBOOK_FIELDS = ['notebook', 'toNotebook', 'targetNotebook'] as const;

/**
 * Creations name a destination notebook that has no existing target yet, and
 * additive writes skip the state probe entirely. Check the destination for
 * every strict write so a read-only notebook never yields a preflight lease.
 */
export async function assertDestinationNotebooksWritable(
    client: SiYuanClient,
    permMgr: PermissionManager,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
): Promise<void> {
    const notebooks = await collectDestinationNotebooks(client, permMgr, category, action, args);
    if (notebooks.length === 0) return;
    await permMgr.reload();
    for (const notebook of notebooks) {
        if (!permMgr.canWrite(notebook)) throw safetyError('permission_denied', notebookDeniedMessage(permMgr, notebook, false));
    }
}

async function collectDestinationNotebooks(
    client: SiYuanClient,
    permMgr: PermissionManager,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
): Promise<string[]> {
    if (category === 'notebook') return [];
    const notebooks = new Set<string>();
    for (const field of DESTINATION_NOTEBOOK_FIELDS) {
        const value = args[field];
        if (typeof value === 'string' && /^\d{14}-[a-z0-9]{7}$/.test(value)) notebooks.add(value);
    }
    if (category === 'fs' && action === 'write' && args.overwrite !== true && typeof args.path === 'string') {
        // Unresolvable paths are reported by the handler with path-specific guidance.
        const target = await resolveFsCreateTarget(client, permMgr, args.path).catch(() => undefined);
        if (target) notebooks.add(target.notebook);
    }
    return [...notebooks];
}

function notebookDeniedMessage(permMgr: PermissionManager, notebook: string, destructive: boolean): string {
    const required = destructive ? 'delete (rwd)' : 'write (rw or rwd)';
    return `Notebook ${notebook} has permission "${permMgr.get(notebook)}"; this write needs ${required} access. Nothing was written. Check with notebook(action="get_permissions"); permissions are changed by the user in the plugin settings.`;
}

function enforceNotebookPermission(
    permMgr: PermissionManager,
    state: Record<string, unknown>,
    targetIds: string[],
    destructive: boolean,
): void {
    const boxes = new Set<string>();
    collectNotebookBoxes(state, boxes);
    for (const value of targetIds) {
        if (/^\d{14}-[a-z0-9]{7}$/.test(value) && permMgr.getAll()[value]) boxes.add(value);
    }
    for (const box of boxes) {
        const allowed = destructive ? permMgr.canDelete(box) : permMgr.canWrite(box);
        if (!allowed) throw safetyError('permission_denied', notebookDeniedMessage(permMgr, box, destructive));
    }
}

function requiresDeletePermission(category: ToolCategory, action: string): boolean {
    // AV schema/record changes can be dangerous enough to require an explicit
    // confirmation, yet they are not notebook deletion. Keep confirmation and
    // permission as separate concepts: W2 AV writes require rw/rwd, while
    // actual destructive actions retain the rwd gate.
    return isDangerousAction(category, action) && category !== 'av';
}
