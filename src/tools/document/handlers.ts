import type { SiYuanClient } from '../../api/client';
import * as blockApi from '../../api/block';
import * as documentApi from '../../api/document';
import * as notebookApi from '../../api/notebook';
import * as searchApi from '../../api/search';
import * as transactionApi from '../../api/transaction';
import type { DocumentAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import {
    DocumentCreateSchema,
    DocumentCreateDailyNoteSchema,
    DocumentDocToHeadingSchema,
    DocumentDuplicateSchema,
    DocumentGetChildBlocksSchema,
    DocumentGetChildDocsSchema,
    DocumentGetDocSchema,
    DocumentGetOutlineSchema,
    DocumentHeadingToDocSchema,
    DocumentListTreeSchema,
    DocumentMoveSchema,
    DocumentReorderSchema,
    DocumentLookupSchema,
    DocumentRemoveSchema,
    DocumentRenameSchema,
    DocumentSearchDocsSchema,
    DocumentSetAttrSchema,
} from '../../core/types';
import {
    ensurePermissionForDocumentId,
    ensurePermissionForNotebook,
    escapeSqlString,
    listChildDocumentsByPath,
    resolveMoveTargetNotebook,
    resolveNotebookForPath,
} from '../internal/context';
import type { ToolActionHandler } from '../internal/define-tool';
import { resolveNotebookName } from '../internal/helpers/notebook-names';
import { filterBacklinkResultByPermission, filterItemsByPermissionAndPath } from '../search';
import { createJsonResult, createPermissionDeniedResult, createSetIconReminder } from '../internal/shared';
import { applyUiRefresh, type UiRefreshOperation } from '../internal/ui-refresh';
import { sleep } from '../../shared/async';
import { stripRedundantTitleHeading } from '../internal/kramdown-safe';
import { readDocumentBlockWindow } from '../internal/document-kramdown';
import { createFootnoteReferenceHint, createSiyuanBlockLinkHint, createUnresolvedBlockRefHint, hasBlockRefIdFallbackAnchors, hasFootnoteReferences, hasSiyuanBlockLinks } from '../internal/kramdown-safe';
import { normalizeMarkdownInputRefs } from '../internal/markdown-input';
import { applyDocumentReorder, readDocumentReorderState } from '../internal/helpers/document-reorder';

type DocumentActionHandler = ToolActionHandler;

const GET_HPATH_INDEXING_RETRY_DELAYS_MS = [120, 240];

const DEFAULT_DOCUMENT_RESOLVE_INCLUDE = ['path', 'hpath'] as const;

function looksLikeStoragePath(path: string): boolean {
    return path === '/' || /\.sy(?:\/|$)/.test(path);
}

async function setDocumentAttrsViaTransaction(
    client: SiYuanClient,
    id: string,
    attrs: Record<string, string>,
): Promise<void> {
    await transactionApi.performTransactions(client, [{
        doOperations: [{
            action: 'setAttrs',
            id,
            data: JSON.stringify(attrs),
        }],
        undoOperations: [],
    }]);
}

function isIndexingError(error: unknown): boolean {
    return error instanceof Error
        && /SiYuan API error:\s*-1\s*-\s*indexing/i.test(error.message);
}

async function getHPathByIdWithRetry(client: SiYuanClient, id: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= GET_HPATH_INDEXING_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
            return await documentApi.getHPathByID(client, id);
        } catch (error) {
            if (!isIndexingError(error) || attempt === GET_HPATH_INDEXING_RETRY_DELAYS_MS.length) {
                lastError = error;
                break;
            }
            lastError = error;
            await sleep(GET_HPATH_INDEXING_RETRY_DELAYS_MS[attempt]);
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Failed to resolve hierarchical path for document "${id}" because SiYuan indexing is still catching up. Retry shortly after create. Last error: ${message}`);
}

function createLookupPathResult(fields: {
    notebook?: string;
    notebookName?: string;
    path?: { notebook: string; path: string } | string;
    hPath?: string;
    id?: string;
    ids?: string[];
}) {
    const storageNotebook = typeof fields.path === 'object' ? fields.path.notebook : fields.notebook;
    const storagePath = typeof fields.path === 'object' ? fields.path.path : fields.path;

    return {
        humanPath: {
            notebookName: fields.notebookName ?? fields.notebook,
            hPath: fields.hPath,
        },
        idPath: {
            id: fields.id,
            ids: fields.ids,
            notebook: storageNotebook,
            path: storagePath,
        },
    };
}

function normalizeDocumentCoverSource(source: string): { source: string; titleImg: string } {
    const normalizedSource = source.trim();
    if (!normalizedSource) {
        throw new Error('Cover source must not be empty.');
    }

    const isRemoteUrl = /^https?:\/\//i.test(normalizedSource);
    const isAssetPath = normalizedSource.startsWith('/assets/');
    if (!isRemoteUrl && !isAssetPath) {
        throw new Error('Cover source must be an http(s) URL or a SiYuan asset path starting with /assets/.');
    }

    const escapedSource = normalizedSource
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');

    return {
        source: normalizedSource,
        titleImg: `background-image:url("${escapedSource}");`,
    };
}

function normalizeChildDocPath(parentPath: string, title: string): string {
    const normalizedParent = parentPath === '/' ? '' : parentPath.replace(/\/+$/, '');
    return `${normalizedParent}/${title.replace(/^\/+/, '')}`;
}

function deriveTitleFromCreatePath(path: string): string | undefined {
    return path.split('/').filter(Boolean).at(-1);
}

function isStorageDocumentPath(path: string): boolean {
    return /(?:^|\/)\d{14}-[a-z0-9]{7}\.sy$/i.test(path);
}

async function getDocumentIdsByHPathWithSqlFallback(
    client: SiYuanClient,
    notebook: string,
    hpath: string,
): Promise<string[]> {
    const ids = await documentApi.getIDsByHPath(client, hpath, notebook);
    if (ids.length > 0) return ids;

    const rows = await searchApi.querySQL(
        client,
        [
            'SELECT id FROM blocks',
            `WHERE box = '${escapeSqlString(notebook)}'`,
            `AND hpath = '${escapeSqlString(hpath)}'`,
            "AND type = 'd'",
            'ORDER BY updated DESC',
        ].join(' '),
    );
    return rows
        .map((row) => row && typeof row === 'object' ? (row as Record<string, unknown>).id : undefined)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

async function resolveCreateParentPath(client: SiYuanClient, notebook: string, parentPath: string): Promise<string> {
    const normalizedParentPath = parentPath === '/' ? '/' : parentPath.replace(/\/+$/, '');
    if (!isStorageDocumentPath(normalizedParentPath)) {
        return normalizedParentPath;
    }

    return documentApi.getHPathByPath(client, notebook, normalizedParentPath);
}

function truncateTreeByDepth(nodes: unknown, maxDepth: number, currentDepth = 0): unknown {
    if (!Array.isArray(nodes)) return nodes;
    return nodes.map((node) => {
        if (!node || typeof node !== 'object') return node;
        const typedNode = node as Record<string, unknown>;
        if (currentDepth >= maxDepth && Array.isArray(typedNode.children) && typedNode.children.length > 0) {
            const { children, ...rest } = typedNode;
            return { ...rest, childCount: (children as unknown[]).length, childrenTruncated: true };
        }
        if (Array.isArray(typedNode.children)) {
            return { ...typedNode, children: truncateTreeByDepth(typedNode.children, maxDepth, currentDepth + 1) };
        }
        return typedNode;
    });
}

async function enrichTreeNodesWithDocInfo(
    client: SiYuanClient,
    value: unknown,
    cache = new Map<string, Promise<Awaited<ReturnType<typeof blockApi.getDocInfo>>>>(),
): Promise<unknown> {
    if (!Array.isArray(value)) return value;

    return Promise.all(value.map(async (node) => {
        if (!node || typeof node !== 'object') return node;
        const typedNode = node as Record<string, unknown>;
        const enrichedNode: Record<string, unknown> = { ...typedNode };
        const id = typeof typedNode.id === 'string' ? typedNode.id : undefined;

        if (id && (typedNode.name === undefined || typedNode.icon === undefined)) {
            try {
                let pending = cache.get(id);
                if (!pending) {
                    pending = blockApi.getDocInfo(client, id);
                    cache.set(id, pending);
                }
                const info = await pending;
                if (enrichedNode.name === undefined && info.name) {
                    enrichedNode.name = info.name.replace(/\.sy$/, '');
                }
                if (enrichedNode.icon === undefined && info.icon) {
                    enrichedNode.icon = info.icon;
                }
            } catch {
                // Ignore enrichment failures and keep the original node.
            }
        }

        if (Array.isArray(typedNode.children)) {
            enrichedNode.children = await enrichTreeNodesWithDocInfo(client, typedNode.children, cache);
        }

        return enrichedNode;
    }));
}

function filterSearchDocsResultByPermission(result: unknown, permMgr: PermissionManager): unknown {
    if (Array.isArray(result)) {
        return filterBacklinkResultByPermission({ backmentions: result }, permMgr).backmentions;
    }

    if (!result || typeof result !== 'object') return result;
    const typedResult = result as Record<string, unknown>;

    if (Array.isArray(typedResult.files)) {
        return {
            ...typedResult,
            files: filterBacklinkResultByPermission({ backmentions: typedResult.files }, permMgr).backmentions,
        };
    }

    if (Array.isArray(typedResult.docs)) {
        return {
            ...typedResult,
            docs: filterBacklinkResultByPermission({ backmentions: typedResult.docs }, permMgr).backmentions,
        };
    }

    return result;
}

async function filterSearchDocsResult(
    client: SiYuanClient,
    result: unknown,
    permMgr: PermissionManager,
    scopePath?: string,
): Promise<{
    data: unknown;
    permissionFilteredOutCount: number;
    pathFilteredOutCount: number;
}> {
    if (Array.isArray(result)) {
        const filtered = await filterItemsByPermissionAndPath(client, result, permMgr, scopePath);
        return {
            data: filtered.items,
            permissionFilteredOutCount: filtered.permissionFilteredOutCount,
            pathFilteredOutCount: filtered.pathFilteredOutCount,
        };
    }

    if (!result || typeof result !== 'object') {
        return {
            data: result,
            permissionFilteredOutCount: 0,
            pathFilteredOutCount: 0,
        };
    }

    const typedResult = result as Record<string, unknown>;

    if (Array.isArray(typedResult.files)) {
        const filtered = await filterItemsByPermissionAndPath(client, typedResult.files, permMgr, scopePath);
        return {
            data: {
                ...typedResult,
                files: filtered.items,
            },
            permissionFilteredOutCount: filtered.permissionFilteredOutCount,
            pathFilteredOutCount: filtered.pathFilteredOutCount,
        };
    }

    if (Array.isArray(typedResult.docs)) {
        const filtered = await filterItemsByPermissionAndPath(client, typedResult.docs, permMgr, scopePath);
        return {
            data: {
                ...typedResult,
                docs: filtered.items,
            },
            permissionFilteredOutCount: filtered.permissionFilteredOutCount,
            pathFilteredOutCount: filtered.pathFilteredOutCount,
        };
    }

    return {
        data: filterSearchDocsResultByPermission(result, permMgr),
        permissionFilteredOutCount: 0,
        pathFilteredOutCount: 0,
    };
}

const handleCreate: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentCreateSchema.parse(rawArgs);
    await permMgr.reload();
    if (!permMgr.canWrite(parsed.notebook)) {
        return createPermissionDeniedResult(parsed.notebook, permMgr.get(parsed.notebook), 'write');
    }
    const parentPath = parsed.parentPath
        ? await resolveCreateParentPath(client, parsed.notebook, parsed.parentPath)
        : undefined;
    const path = parsed.path ?? normalizeChildDocPath(parentPath!, parsed.title!);
    const markdown = await normalizeMarkdownInputRefs(
        client,
        stripRedundantTitleHeading(parsed.markdown ?? '', parsed.title ?? deriveTitleFromCreatePath(path)),
        'document.create',
    );
    const docId = await documentApi.createDoc(client, parsed.notebook, path, markdown);
    if (parsed.icon) {
        await setDocumentAttrsViaTransaction(client, docId, { icon: parsed.icon });
    }
    return applyUiRefresh(client, createJsonResult({
        success: true,
        notebook: parsed.notebook,
        path,
        ...(hasSiyuanBlockLinks(markdown) ? createSiyuanBlockLinkHint() : {}),
        ...(hasFootnoteReferences(markdown) ? createFootnoteReferenceHint() : {}),
        ...(hasBlockRefIdFallbackAnchors(markdown) ? createUnresolvedBlockRefHint() : {}),
        ...(parsed.parentPath ? { parentPath: parsed.parentPath } : {}),
        ...(parentPath && parentPath !== parsed.parentPath ? { resolvedParentPath: parentPath } : {}),
        ...(parsed.title ? { title: parsed.title } : {}),
        id: docId,
        iconHint: createSetIconReminder('document', Boolean(parsed.icon)),
    }), parsed.icon
        ? [{ type: 'reloadIcon' }]
        : [
            { type: 'reloadProtyle', id: docId },
            { type: 'reloadFiletree' },
        ]);
};

const handleLookup: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentLookupSchema.parse(rawArgs);
    const hpathInput = parsed.hpath ?? parsed.hPath;
    const include = new Set(parsed.include ?? DEFAULT_DOCUMENT_RESOLVE_INCLUDE);
    const result: Record<string, unknown> = {
        source: parsed.id
            ? { type: 'id', id: parsed.id }
            : parsed.path
                ? { type: 'path', notebook: parsed.notebook, path: parsed.path }
                : { type: 'hpath', notebook: parsed.notebook, hPath: hpathInput },
    };

    if (parsed.id) {
        const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
        if (denied) return denied;
        result.id = parsed.id;
        result.notebook = context.notebook;
        result.path = context.path;
        if (include.has('path')) {
            result.path = await documentApi.getPathByID(client, parsed.id);
        }
        result.hPath = await getHPathByIdWithRetry(client, parsed.id);
        if (include.has('docInfo')) {
            result.docInfo = await blockApi.getDocInfo(client, parsed.id);
        }
        const notebookName = await resolveNotebookName(client, context.notebook);
        if (notebookName) result.notebookName = notebookName;
        return createJsonResult(createLookupPathResult(result));
    }

    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook!, 'read');
    if (denied) return denied;
    const notebookName = await resolveNotebookName(client, parsed.notebook);

    if (parsed.path) {
        result.notebook = parsed.notebook;
        if (notebookName) result.notebookName = notebookName;
        result.path = parsed.path;

        if (!looksLikeStoragePath(parsed.path)) {
            const ids = await getDocumentIdsByHPathWithSqlFallback(client, parsed.notebook!, parsed.path);
            const primaryId = ids[0];
            result.source = { type: 'hpath', notebook: parsed.notebook, hPath: parsed.path, providedAs: 'path' };
            result.hPath = parsed.path;
            result.interpretedPathAs = 'hpath';
            result.hint = 'document.lookup path expects a storage path such as /20240318112233-abc123.sy. Human-readable paths should be passed as hpath; this call was interpreted as hpath for compatibility.';
            if (include.has('ids') || include.has('id')) {
                result.ids = ids;
                if (include.has('id')) result.id = primaryId;
            }
            if (primaryId) {
                result.path = await documentApi.getPathByID(client, primaryId);
            }
            if (primaryId && include.has('docInfo')) {
                result.docInfo = await blockApi.getDocInfo(client, primaryId);
            }
            return createJsonResult(createLookupPathResult(result));
        }

        const resolvedHPath = await documentApi.getHPathByPath(client, parsed.notebook!, parsed.path);
        result.hPath = resolvedHPath;
        if (include.has('id') || include.has('ids')) {
            const ids = await getDocumentIdsByHPathWithSqlFallback(client, parsed.notebook!, resolvedHPath ?? parsed.path);
            result.ids = ids;
            if (include.has('id')) result.id = ids[0];
        }
        if (include.has('docInfo') && typeof result.id === 'string') {
            result.docInfo = await blockApi.getDocInfo(client, result.id);
        }
        return createJsonResult(createLookupPathResult(result));
    }

    const ids = await getDocumentIdsByHPathWithSqlFallback(client, parsed.notebook!, hpathInput!);
    result.notebook = parsed.notebook;
    if (notebookName) result.notebookName = notebookName;
    result.hPath = hpathInput;
    if (include.has('ids') || include.has('id')) {
        result.ids = ids;
        if (include.has('id')) result.id = ids[0];
    }
    const primaryId = ids[0];
    if (primaryId) {
        const { denied: idDenied } = await ensurePermissionForDocumentId(client, permMgr, primaryId, 'read');
        if (idDenied) return idDenied;
        result.path = await documentApi.getPathByID(client, primaryId);
    }
    if (primaryId && include.has('docInfo')) {
        const { denied: idDenied } = await ensurePermissionForDocumentId(client, permMgr, primaryId, 'read');
        if (idDenied) return idDenied;
        result.docInfo = await blockApi.getDocInfo(client, primaryId);
    }
    return createJsonResult(createLookupPathResult(result));
};

const handleRename: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentRenameSchema.parse(rawArgs);
    if (parsed.id) {
        const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'write');
        if (denied) return denied;
        await documentApi.renameDocByID(client, parsed.id, parsed.title);
        return applyUiRefresh(client, createJsonResult({ success: true, id: parsed.id, title: parsed.title }), [
            { type: 'reloadProtyle', id: context.documentId },
            { type: 'reloadFiletree' },
        ]);
    }
    if (parsed.notebook) {
        const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'write');
        if (denied) return denied;
    }
    await documentApi.renameDoc(client, parsed.notebook!, parsed.path!, parsed.title);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        notebook: parsed.notebook,
        path: parsed.path,
        title: parsed.title,
    }), [{ type: 'reloadFiletree' }]);
};

const handleRemove: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentRemoveSchema.parse(rawArgs);
    if (parsed.ids) {
        const reloadIds: string[] = [];
        for (const id of parsed.ids) {
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, id, 'delete');
            if (denied) return denied;
            reloadIds.push(context.documentId);
        }
        for (const id of parsed.ids) {
            await documentApi.removeDocByID(client, id);
        }
        return applyUiRefresh(client, createJsonResult({ success: true, ids: parsed.ids, count: parsed.ids.length }), [
            ...reloadIds.map((id) => ({ type: 'reloadProtyle' as const, id })),
            { type: 'reloadFiletree' },
        ]);
    }
    if (parsed.paths) {
        for (const path of parsed.paths) {
            const notebook = await resolveNotebookForPath(client, path);
            if (!notebook) {
                throw new Error(`Unable to resolve notebook for storage path "${path}" while checking permissions.`);
            }
            const denied = await ensurePermissionForNotebook(permMgr, notebook, 'delete');
            if (denied) return denied;
        }
        await documentApi.removeDocs(client, parsed.paths);
        return applyUiRefresh(client, createJsonResult({
            success: true,
            paths: parsed.paths,
            count: parsed.paths.length,
        }), [{ type: 'reloadFiletree' }]);
    }
    if (parsed.id) {
        const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'delete');
        if (denied) return denied;
        await documentApi.removeDocByID(client, parsed.id);
        return applyUiRefresh(client, createJsonResult({ success: true, id: parsed.id }), [
            { type: 'reloadProtyle', id: context.documentId },
            { type: 'reloadFiletree' },
        ]);
    }
    if (parsed.notebook) {
        const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'delete');
        if (denied) return denied;
    }
    await documentApi.removeDoc(client, parsed.notebook!, parsed.path!);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        notebook: parsed.notebook,
        path: parsed.path,
    }), [{ type: 'reloadFiletree' }]);
};

const handleMove: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentMoveSchema.parse(rawArgs);
    if (parsed.toNotebook) {
        const denied = await ensurePermissionForNotebook(permMgr, parsed.toNotebook, 'write');
        if (denied) return denied;
    }
    if (parsed.toID) {
        const targetNotebook = await resolveMoveTargetNotebook(client, parsed.toID);
        const denied = await ensurePermissionForNotebook(permMgr, targetNotebook, 'write');
        if (denied) return denied;
    }
    if (parsed.fromIDs) {
        const sourceDocumentIDs: string[] = [];
        for (const id of parsed.fromIDs) {
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, id, 'write');
            if (denied) return denied;
            sourceDocumentIDs.push(context.documentId);
        }
        await documentApi.moveDocsByID(client, parsed.fromIDs, parsed.toID!);
        return applyUiRefresh(client, createJsonResult({ success: true, fromIDs: parsed.fromIDs, toID: parsed.toID }), [
            ...sourceDocumentIDs.map((id) => ({ type: 'reloadProtyle' as const, id })),
            { type: 'reloadFiletree' },
        ]);
    }
    for (const sourcePath of parsed.fromPaths!) {
        const sourceNotebook = await resolveNotebookForPath(client, sourcePath);
        if (!sourceNotebook) {
            throw new Error(`Unable to resolve source notebook for storage path "${sourcePath}" while checking permissions.`);
        }
        const denied = await ensurePermissionForNotebook(permMgr, sourceNotebook, 'write');
        if (denied) return denied;
    }
    await documentApi.moveDocs(client, parsed.fromPaths!, parsed.toNotebook!, parsed.toPath!);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        fromPaths: parsed.fromPaths,
        toNotebook: parsed.toNotebook,
        toPath: parsed.toPath,
    }), [{ type: 'reloadFiletree' }]);
};

const handleReorder: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentReorderSchema.parse(rawArgs);
    const notebooks = await notebookApi.listNotebooks(client);
    const notebook = notebooks.notebooks.find((item) => item.id === parsed.parentID);
    let targetNotebook: string;
    let parentPath: string;

    if (notebook) {
        targetNotebook = notebook.id;
        parentPath = '/';
        const denied = await ensurePermissionForNotebook(permMgr, targetNotebook, 'write');
        if (denied) return denied;
    } else {
        const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.parentID, 'write');
        if (denied) return denied;
        if (context.documentId !== parsed.parentID) {
            throw new Error(`parentID must identify a notebook or document root, got content block "${parsed.parentID}".`);
        }
        targetNotebook = context.notebook;
        parentPath = context.path;
    }

    const state = await readDocumentReorderState(client, targetNotebook, parsed.parentID, parentPath);
    const result = await applyDocumentReorder(client, state, parsed.orderedIDs);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        parentID: parsed.parentID,
        notebook: targetNotebook,
        changed: result.changed,
        orderChanged: result.orderChanged,
        sortModeChanged: result.sortModeChanged,
        previousOrder: result.previousOrder,
        order: result.order,
    }), [{ type: 'reloadFiletree' }]);
};

const handleGetChildBlocks: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentGetChildBlocksSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = await blockApi.getChildBlocks(client, context.documentId);
    return createJsonResult(result);
};

const handleGetChildDocs: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentGetChildDocsSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = await listChildDocumentsByPath(client, context.notebook, context.path);
    return createJsonResult(result);
};

const handleSetAttr: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentSetAttrSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'write');
    if (denied) return denied;
    const attrs: Record<string, string> = {};
    const response: Record<string, unknown> = { success: true, id: parsed.id };
    const operations: UiRefreshOperation[] = [];
    if (parsed.attrs.icon !== undefined) {
        attrs.icon = parsed.attrs.icon;
        response.icon = parsed.attrs.icon;
        operations.push({ type: 'reloadIcon' }, { type: 'reloadFiletree' });
    }
    if (parsed.attrs.cover !== undefined) {
        const source = parsed.attrs.cover;
        if (!source) {
            attrs['title-img'] = '';
            response.clearedCover = true;
        } else {
            const normalized = normalizeDocumentCoverSource(source);
            attrs['title-img'] = normalized.titleImg;
            response.cover = normalized.source;
            response.titleImg = normalized.titleImg;
        }
        operations.push({ type: 'reloadProtyle', id: context.documentId }, { type: 'reloadFiletree' });
    }
    await setDocumentAttrsViaTransaction(client, parsed.id, attrs);
    return applyUiRefresh(client, createJsonResult(response), operations);
};

const handleListTree: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentListTreeSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'read');
    if (denied) return denied;
    const maxDepth = parsed.maxDepth ?? 3;
    const result = await documentApi.listDocTree(client, parsed.notebook, parsed.path);
    const depthHint = 'Use maxDepth to control tree depth. Use document(action="list_tree") with a deeper path to expand specific subtrees.';
    if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).tree)) {
        const enriched = await enrichTreeNodesWithDocInfo(client, (result as Record<string, unknown>).tree);
        return createJsonResult({
            ...(result as Record<string, unknown>),
            tree: truncateTreeByDepth(enriched, maxDepth),
            maxDepth,
            depthHint,
        });
    }
    const enriched = await enrichTreeNodesWithDocInfo(client, result);
    return createJsonResult({ tree: truncateTreeByDepth(enriched, maxDepth), maxDepth, depthHint });
};

const handleSearchDocs: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentSearchDocsSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'read');
    if (denied) return denied;
    const result = await documentApi.searchDocs(client, parsed.query);
    const filtered = await filterSearchDocsResult(client, result, permMgr, parsed.path);
    const totalFilteredOutCount = filtered.permissionFilteredOutCount + filtered.pathFilteredOutCount;
    return createJsonResult({
        ...((filtered.data && typeof filtered.data === 'object' && !Array.isArray(filtered.data))
            ? filtered.data as Record<string, unknown>
            : { docs: filtered.data }),
        ...(parsed.path ? { path: parsed.path, pathApplied: true } : {}),
        ...(filtered.permissionFilteredOutCount > 0 ? { partial: true, reason: 'permission_filtered' } : {}),
        ...(totalFilteredOutCount > 0 ? { filteredOutCount: totalFilteredOutCount } : {}),
        ...(filtered.pathFilteredOutCount > 0 ? { pathFilteredOutCount: filtered.pathFilteredOutCount } : {}),
    });
};

const handleGetDoc: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentGetDocSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const notebookName = await resolveNotebookName(client, context.notebook);
    if (parsed.mode === 'html') {
        const result = await documentApi.getDoc(client, parsed.id, 0, parsed.size);
        return createJsonResult({
            id: parsed.id,
            mode: 'html',
            notebook: context.notebook,
            ...(notebookName ? { notebookName } : {}),
            ...((result && typeof result === 'object') ? result as Record<string, unknown> : { content: result }),
        });
    }
    const window = await readDocumentBlockWindow(client, parsed.id, {
        blockStart: parsed.blockStart,
        blockLimit: parsed.blockLimit,
        tokenBudget: parsed.tokenBudget,
        includeBlockIds: parsed.includeBlockIds,
    });
    const { nextBlockStart, ...windowPayload } = window;
    const nextWindow = nextBlockStart === undefined
        ? undefined
        : {
            action: 'get_doc',
            id: parsed.id,
            mode: 'markdown',
            blockStart: nextBlockStart,
            blockLimit: window.blockLimit,
            tokenBudget: window.tokenBudget,
            ...(parsed.includeBlockIds ? { includeBlockIds: true } : {}),
        };
    return createJsonResult({
        id: parsed.id,
        mode: 'markdown',
        notebook: context.notebook,
        ...(notebookName ? { notebookName } : {}),
        hPath: await getHPathByIdWithRetry(client, parsed.id),
        ...windowPayload,
        ...(nextWindow ? {
            nextWindow,
            nextWindowHint: `Continue with document(${JSON.stringify(nextWindow)}).`,
        } : {}),
    });
};

function countOutlineNodes(nodes: unknown): number {
    if (!Array.isArray(nodes)) return 0;
    let count = 0;
    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        count += 1;
        const typed = node as Record<string, unknown>;
        count += countOutlineNodes(typed.blocks);
        count += countOutlineNodes(typed.children);
    }
    return count;
}

const handleGetOutline: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentGetOutlineSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const preview = parsed.preview ?? false;
    const result = await documentApi.getDocOutline(
        client,
        context.documentId,
        preview,
        context.notebook,
    );
    const outline = Array.isArray(result) ? result : [];
    return createJsonResult({
        id: context.documentId,
        notebook: context.notebook,
        preview,
        headingCount: countOutlineNodes(outline),
        outline,
    });
};

const handleCreateDailyNote: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentCreateDailyNoteSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'write');
    if (denied) return denied;
    const result = await documentApi.createDailyNote(client, parsed.notebook, parsed.app);
    let hPath: string | undefined;
    try {
        hPath = await documentApi.getHPathByID(client, result.id);
    } catch {
        hPath = undefined;
    }
    return applyUiRefresh(client, createJsonResult({
        success: true,
        notebook: parsed.notebook,
        ...result,
        ...(hPath ? { hPath } : {}),
        iconHint: createSetIconReminder('document'),
    }), [
        { type: 'reloadProtyle', id: result.id },
        { type: 'reloadFiletree' },
    ]);
};

const handleDuplicate: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentDuplicateSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'write');
    if (denied) return denied;
    const result = await documentApi.duplicateDoc(client, parsed.id);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        sourceID: parsed.id,
        ...result,
    }), [
        { type: 'reloadProtyle', id: context.documentId },
        { type: 'reloadFiletree' },
    ]);
};

const handleHeadingToDoc: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentHeadingToDocSchema.parse(rawArgs);
    const source = await ensurePermissionForDocumentId(client, permMgr, parsed.headingID, 'write');
    if (source.denied) return source.denied;
    const denied = await ensurePermissionForNotebook(permMgr, parsed.targetNotebook, 'write');
    if (denied) return denied;
    await documentApi.headingToDoc(client, parsed.headingID, parsed.targetNotebook, parsed.targetPath, parsed.previousPath);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        headingID: parsed.headingID,
        targetNotebook: parsed.targetNotebook,
        ...(parsed.targetPath ? { targetPath: parsed.targetPath } : {}),
        ...(parsed.previousPath ? { previousPath: parsed.previousPath } : {}),
    }), [
        { type: 'reloadProtyle', id: source.context.documentId },
        { type: 'reloadFiletree' },
    ]);
};

const handleDocToHeading: DocumentActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = DocumentDocToHeadingSchema.parse(rawArgs);
    const source = await ensurePermissionForDocumentId(client, permMgr, parsed.srcID, 'write');
    if (source.denied) return source.denied;
    const target = await ensurePermissionForDocumentId(client, permMgr, parsed.targetID, 'write');
    if (target.denied) return target.denied;
    const result = await documentApi.docToHeading(client, parsed.srcID, parsed.targetID, parsed.after ?? false);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        srcID: parsed.srcID,
        targetID: parsed.targetID,
        after: parsed.after ?? false,
        ...result,
    }), [
        { type: 'reloadProtyle', id: source.context.documentId },
        { type: 'reloadProtyle', id: target.context.documentId },
        { type: 'reloadFiletree' },
    ]);
};

export const DOCUMENT_ACTION_HANDLERS: Record<DocumentAction, DocumentActionHandler> = {
    create: handleCreate,
    lookup: handleLookup,
    rename: handleRename,
    remove: handleRemove,
    move: handleMove,
    reorder: handleReorder,
    get_child_blocks: handleGetChildBlocks,
    get_child_docs: handleGetChildDocs,
    set_attr: handleSetAttr,
    list_tree: handleListTree,
    search_docs: handleSearchDocs,
    get_doc: handleGetDoc,
    get_outline: handleGetOutline,
    create_daily_note: handleCreateDailyNote,
    duplicate: handleDuplicate,
    heading_to_doc: handleHeadingToDoc,
    doc_to_heading: handleDocToHeading,
};
