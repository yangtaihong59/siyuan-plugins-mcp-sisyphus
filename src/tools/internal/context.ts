import type { SiYuanClient } from '../../api/client';
import * as blockApi from '../../api/block';
import * as documentApi from '../../api/document';
import * as notebookApi from '../../api/notebook';
import * as searchApi from '../../api/search';
import type { PermissionManager } from '../../core/permissions';
import { createPermissionDeniedResult, type ToolResult } from './shared';
import { stripSySuffix } from '../../shared/siyuan-path';
import { escapeSqlString } from '../../shared/sql';

export interface ResolvedDocumentContext {
    documentId: string;
    notebook: string;
    path: string;
    hPath?: string;
    name?: string;
}

export interface ChildDocumentSummary {
    id: string;
    notebook: string;
    path: string;
    hPath?: string;
    name?: string;
    icon?: string;
    subFileCount?: number;
}

export interface ResultItemContext {
    notebook?: string;
    path?: string;
    documentId?: string;
}

export interface ResultResolutionCache {
    documentContextById: Map<string, Promise<ResolvedDocumentContext>>;
    notebookByPath: Map<string, Promise<string | null>>;
}

type PermissionRequirement = 'read' | 'write' | 'delete';

export function normalizePath(value: string): string {
    return value.startsWith('/') ? value : `/${value}`;
}

export function isPathWithinScope(pathValue: string, scopePath: string): boolean {
    const normalizedPath = normalizePath(pathValue);
    const normalizedScope = normalizePath(scopePath);
    if (normalizedScope === '/') return true;
    return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

export function extractDocumentId(pathValue: string): string {
    const segment = normalizePath(pathValue).split('/').filter(Boolean).at(-1) ?? '';
    return segment.endsWith('.sy') ? segment.slice(0, -3) : segment;
}


async function resolveDocumentContextViaSql(client: SiYuanClient, id: string): Promise<ResolvedDocumentContext | null> {
    const rows = await searchApi.querySQL(
        client,
        `SELECT id, root_id, box, path, hpath, content, type FROM blocks WHERE id = '${escapeSqlString(id)}' LIMIT 1`,
    );
    const row = Array.isArray(rows) && rows.length > 0 && rows[0] && typeof rows[0] === 'object'
        ? rows[0] as Record<string, unknown>
        : null;
    if (!row) return null;

    const notebook = typeof row.box === 'string' && row.box.length > 0 ? row.box : null;
    const path = typeof row.path === 'string' && row.path.length > 0 ? row.path : null;
    if (!notebook || !path) return null;

    const rootDocumentId = typeof row.root_id === 'string' && row.root_id.length > 0
        ? row.root_id
        : typeof row.id === 'string' && row.id.length > 0
            ? row.id
            : id;
    const hPath = typeof row.hpath === 'string' && row.hpath.length > 0 ? row.hpath : undefined;
    const name = typeof row.content === 'string' && row.content.length > 0 ? row.content : undefined;

    return {
        documentId: rootDocumentId,
        notebook,
        path: normalizePath(path),
        hPath,
        name,
    };
}

export async function resolveDocumentContextById(client: SiYuanClient, id: string): Promise<ResolvedDocumentContext> {
    try {
        const sqlContext = await resolveDocumentContextViaSql(client, id);
        if (sqlContext) return sqlContext;
    } catch {
        // Fall back to the filetree/block APIs when SQL lookup is unavailable.
    }

    const docInfo = await blockApi.getDocInfo(client, id);
    const rootDocumentId = docInfo.rootID || docInfo.id;
    const pathInfo = await documentApi.getPathByID(client, rootDocumentId);
    return {
        documentId: rootDocumentId,
        notebook: pathInfo.notebook,
        path: normalizePath(pathInfo.path),
        name: docInfo.name,
    };
}

const CACHE_MAX_SIZE = 500;

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
    if (map.size >= CACHE_MAX_SIZE) {
        const firstKey = map.keys().next().value;
        if (firstKey !== undefined) map.delete(firstKey);
    }
    map.set(key, value);
}

export function createResultResolutionCache(): ResultResolutionCache {
    return {
        documentContextById: new Map(),
        notebookByPath: new Map(),
    };
}

async function resolveDocumentContextCached(
    client: SiYuanClient,
    id: string,
    cache?: ResultResolutionCache,
): Promise<ResolvedDocumentContext> {
    if (!cache) {
        return resolveDocumentContextById(client, id);
    }
    let pending = cache.documentContextById.get(id);
    if (!pending) {
        pending = resolveDocumentContextById(client, id);
        boundedSet(cache.documentContextById, id, pending);
    }
    return pending;
}

async function resolveNotebookForPathCached(
    client: SiYuanClient,
    pathValue: string,
    cache?: ResultResolutionCache,
): Promise<string | null> {
    const normalizedPath = normalizePath(pathValue);
    if (!cache) {
        return resolveNotebookForPath(client, normalizedPath);
    }
    let pending = cache.notebookByPath.get(normalizedPath);
    if (!pending) {
        pending = resolveNotebookForPath(client, normalizedPath);
        boundedSet(cache.notebookByPath, normalizedPath, pending);
    }
    return pending;
}

export async function resolveResultItemContext(
    client: SiYuanClient,
    item: unknown,
    cache?: ResultResolutionCache,
): Promise<ResultItemContext | null> {
    if (!item || typeof item !== 'object') return null;

    const typedItem = item as Record<string, unknown>;
    const notebook = [typedItem.notebook, typedItem.box, typedItem.boxID, typedItem.notebookId]
        .find((value): value is string => typeof value === 'string' && value.length > 0);
    const path = [typedItem.path]
        .find((value): value is string => typeof value === 'string' && value.length > 0);
    const documentId = [
        typedItem.blockID,
        typedItem.blockId,
        typedItem.rootID,
        typedItem.rootId,
        typedItem.root_id,
        typedItem.docID,
        typedItem.docId,
        typedItem.id,
    ].find((value): value is string => typeof value === 'string' && value.length > 0);

    if (notebook && path) {
        return {
            notebook,
            path: normalizePath(path),
            documentId,
        };
    }

    if (documentId) {
        try {
            const context = await resolveDocumentContextCached(client, documentId, cache);
            return {
                notebook: context.notebook,
                path: context.path,
                documentId: context.documentId,
            };
        } catch {
            // Fall through to weaker signals.
        }
    }

    if (path) {
        const resolvedNotebook = await resolveNotebookForPathCached(client, path, cache);
        if (resolvedNotebook) {
            return {
                notebook: notebook ?? resolvedNotebook,
                path: normalizePath(path),
                documentId,
            };
        }
    }

    if (notebook) {
        return {
            notebook,
            path: path ? normalizePath(path) : undefined,
            documentId,
        };
    }

    return null;
}

async function checkPermissionForDocumentContext(
    permMgr: PermissionManager,
    context: ResolvedDocumentContext,
    required: PermissionRequirement,
): Promise<ToolResult | null> {
    await permMgr.reload();
    const allowed = required === 'delete'
        ? permMgr.canDelete(context.notebook)
        : required === 'write'
            ? permMgr.canWrite(context.notebook)
            : permMgr.canRead(context.notebook);
    if (!allowed) {
        return createPermissionDeniedResult(context.notebook, permMgr.get(context.notebook), required);
    }
    return null;
}

export async function ensurePermissionForDocumentId(
    client: SiYuanClient,
    permMgr: PermissionManager,
    id: string,
    required: PermissionRequirement,
): Promise<{ context: ResolvedDocumentContext; denied: ToolResult | null }> {
    const context = await resolveDocumentContextById(client, id);
    const denied = await checkPermissionForDocumentContext(permMgr, context, required);
    return { context, denied };
}

export async function ensurePermissionForNotebook(
    permMgr: PermissionManager,
    notebookId: string,
    required: PermissionRequirement,
): Promise<ToolResult | null> {
    await permMgr.reload();
    const allowed = required === 'delete'
        ? permMgr.canDelete(notebookId)
        : required === 'write'
            ? permMgr.canWrite(notebookId)
            : permMgr.canRead(notebookId);
    if (!allowed) {
        return createPermissionDeniedResult(notebookId, permMgr.get(notebookId), required);
    }
    return null;
}

export async function resolveMoveTargetNotebook(client: SiYuanClient, toID: string): Promise<string> {
    const notebooks = await notebookApi.listNotebooks(client);
    const notebook = notebooks.notebooks.find((item) => item.id === toID);
    if (notebook) {
        return notebook.id;
    }
    const context = await resolveDocumentContextById(client, toID);
    return context.notebook;
}

export async function resolveNotebookForPath(client: SiYuanClient, pathValue: string): Promise<string | null> {
    const notebooks = await notebookApi.listNotebooks(client);
    for (const notebook of notebooks.notebooks) {
        try {
            await documentApi.getHPathByPath(client, notebook.id, pathValue);
            return notebook.id;
        } catch {
            continue;
        }
    }
    return null;
}

export async function listChildDocumentsByPath(
    client: SiYuanClient,
    notebook: string,
    pathValue: string,
): Promise<ChildDocumentSummary[]> {
    const response = await documentApi.listDocsByPath(client, notebook, pathValue);
    return response.files.map((child) => ({
        id: typeof child.id === 'string' && child.id.length > 0 ? child.id : extractDocumentId(child.path),
        notebook: child.box || response.box || notebook,
        path: normalizePath(child.path),
        hPath: child.hPath,
        name: stripSySuffix(child.name),
        icon: child.icon,
        subFileCount: child.subFileCount ?? child.count,
    }));
}
