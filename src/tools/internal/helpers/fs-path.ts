import type { SiYuanClient } from '../../../api/client';
import * as documentApi from '../../../api/document';
import * as notebookApi from '../../../api/notebook';
import * as searchApi from '../../../api/search';
import type { PermissionManager } from '../../../core/permissions';
import { normalizeFsPath as normalizeHumanPath, stripSySuffix } from '../../../shared/siyuan-path';
import { escapeSqlString } from '../../../shared/sql';

type PermissionRequirement = 'read' | 'write' | 'delete';

export interface FsNotebook {
    id: string;
    name: string;
    closed?: boolean;
}

export interface FsDocumentPath {
    type: 'document';
    id: string;
    notebook: string;
    notebookName: string;
    hPath: string;
    storagePath: string;
    canonicalPath: string;
    name: string;
}

export interface FsNotebookPath {
    type: 'notebook';
    notebook: string;
    notebookName: string;
    hPath: '/';
    storagePath: '/';
    canonicalPath: string;
}

export interface FsRootPath {
    type: 'root';
    canonicalPath: '/';
}

export type FsScopePath = FsRootPath | FsNotebookPath | FsDocumentPath;

export interface FsCreateTarget {
    notebook: string;
    notebookName: string;
    title: string;
    parentHPath: string;
    parentStoragePath: string;
    parentId?: string;
    hPath: string;
    canonicalPath: string;
}

function lastPathSegment(path: string): string {
    return path.split('/').filter(Boolean).at(-1) ?? '';
}

function joinHPath(parent: string, title: string): string {
    const normalizedParent = parent === '/' ? '' : parent.replace(/\/+$/, '');
    return `${normalizedParent}/${title.replace(/^\/+/, '')}`;
}

function canonicalPath(notebookName: string, hPath: string): string {
    return hPath === '/'
        ? `/${notebookName}`
        : `/${notebookName}${hPath}`;
}

function canAccess(permMgr: PermissionManager, notebook: string, required: PermissionRequirement): boolean {
    if (required === 'delete') return permMgr.canDelete(notebook);
    if (required === 'write') return permMgr.canWrite(notebook);
    return permMgr.canRead(notebook);
}

async function listNotebooks(client: SiYuanClient): Promise<FsNotebook[]> {
    const result = await notebookApi.listNotebooks(client);
    return result.notebooks.map((notebook) => ({
        id: notebook.id,
        name: notebook.name,
        closed: notebook.closed,
    }));
}

async function getDocByHPath(
    client: SiYuanClient,
    notebook: FsNotebook,
    hPath: string,
): Promise<FsDocumentPath[]> {
    let ids: string[];
    try {
        ids = await documentApi.getIDsByHPath(client, hPath, notebook.id);
    } catch {
        ids = [];
    }
    const rows = await searchApi.querySQL(
        client,
        [
            'SELECT id',
            'FROM blocks',
            `WHERE type = 'd'`,
            `AND box = '${escapeSqlString(notebook.id)}'`,
            `AND hpath = '${escapeSqlString(hPath)}'`,
            'LIMIT 100',
        ].join(' '),
    ).catch(() => []);
    for (const row of rows) {
        if (row && typeof row === 'object' && typeof (row as Record<string, unknown>).id === 'string') {
            ids.push((row as Record<string, string>).id);
        }
    }

    const uniqueIds = [...new Set(ids)];
    const docs: FsDocumentPath[] = [];
    for (const id of uniqueIds) {
        const pathInfo = await documentApi.getPathByID(client, id);
        const resolvedHPath = await documentApi.getHPathByID(client, id).catch(() => hPath);
        const normalizedHPath = normalizeHumanPath(resolvedHPath);
        const name = lastPathSegment(normalizedHPath) || stripSySuffix(lastPathSegment(pathInfo.path)) || id;
        docs.push({
            type: 'document',
            id,
            notebook: pathInfo.notebook || notebook.id,
            notebookName: notebook.name,
            hPath: normalizedHPath,
            storagePath: pathInfo.path,
            canonicalPath: canonicalPath(notebook.name, normalizedHPath),
            name,
        });
    }
    return docs;
}

function formatCandidates(candidates: FsDocumentPath[]): string {
    return candidates.map((candidate) => candidate.canonicalPath).join(', ');
}

export function getFsPathErrorCode(error: unknown): string | undefined {
    return error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
}

function createFsError(code: string, message: string): Error {
    const error = new Error(message);
    Object.assign(error, { code });
    return error;
}

export async function resolveFsScopePath(
    client: SiYuanClient,
    permMgr: PermissionManager,
    inputPath: string,
    required: PermissionRequirement = 'read',
): Promise<FsScopePath> {
    const path = normalizeHumanPath(inputPath);
    if (path === '/') return { type: 'root', canonicalPath: '/' };

    await permMgr.reload();
    const notebooks = await listNotebooks(client);
    const segments = path.split('/').filter(Boolean);
    const first = segments[0];
    const canonicalNotebook = notebooks.find((notebook) => notebook.name === first);

    if (canonicalNotebook) {
        const hPath = segments.length === 1 ? '/' : `/${segments.slice(1).join('/')}`;
        if (hPath === '/') {
            return {
                type: 'notebook',
                notebook: canonicalNotebook.id,
                notebookName: canonicalNotebook.name,
                hPath: '/',
                storagePath: '/',
                canonicalPath: canonicalPath(canonicalNotebook.name, '/'),
            };
        }
        const docs = await getDocByHPath(client, canonicalNotebook, hPath);
        if (docs.length === 0) {
            throw createFsError('not_found', `No document found at "${path}".`);
        }
        if (docs.length > 1) {
            throw createFsError('ambiguous_path', `Ambiguous fs path "${path}". Candidates: ${formatCandidates(docs)}.`);
        }
        return docs[0];
    }

    const candidates: FsDocumentPath[] = [];
    for (const notebook of notebooks) {
        if (!canAccess(permMgr, notebook.id, required)) continue;
        try {
            candidates.push(...await getDocByHPath(client, notebook, path));
        } catch {
            // Try the next notebook; not every notebook contains every hPath.
        }
    }

    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
        throw createFsError('ambiguous_path', `Ambiguous fs path "${path}". Candidates: ${formatCandidates(candidates)}.`);
    }
    throw createFsError('not_found', `No document found at "${path}". Use /<notebook name>/<document path> for an unambiguous path.`);
}

export async function resolveFsCreateTarget(
    client: SiYuanClient,
    permMgr: PermissionManager,
    inputPath: string,
): Promise<FsCreateTarget> {
    const path = normalizeHumanPath(inputPath);
    if (path === '/') {
        throw createFsError('invalid_path', 'Cannot create a document at "/". Use /<notebook name>/<title>.');
    }

    const segments = path.split('/').filter(Boolean);
    const title = segments.at(-1);
    if (!title) {
        throw createFsError('invalid_path', `Cannot create a document at "${path}".`);
    }

    await permMgr.reload();
    const notebooks = await listNotebooks(client);
    const canonicalNotebook = notebooks.find((notebook) => notebook.name === segments[0]);
    if (canonicalNotebook) {
        const parentSegments = segments.slice(1, -1);
        const parentHPath = parentSegments.length === 0 ? '/' : `/${parentSegments.join('/')}`;
        let parentStoragePath = '/';
        let parentId: string | undefined;
        if (parentHPath !== '/') {
            const parents = await getDocByHPath(client, canonicalNotebook, parentHPath);
            if (parents.length === 0) throw createFsError('not_found', `Parent document not found at "${canonicalPath(canonicalNotebook.name, parentHPath)}".`);
            if (parents.length > 1) throw createFsError('ambiguous_path', `Ambiguous parent path "${canonicalPath(canonicalNotebook.name, parentHPath)}". Candidates: ${formatCandidates(parents)}.`);
            const parent = parents[0];
            parentStoragePath = parent.storagePath;
            parentId = parent.id;
        }
        const hPath = joinHPath(parentHPath, title);
        return {
            notebook: canonicalNotebook.id,
            notebookName: canonicalNotebook.name,
            title,
            parentHPath,
            parentStoragePath,
            parentId,
            hPath,
            canonicalPath: canonicalPath(canonicalNotebook.name, hPath),
        };
    }

    if (segments.length === 1) {
        throw createFsError('invalid_path', 'Root-level create must use /<notebook name>/<title>.');
    }

    const parentInput = `/${segments.slice(0, -1).join('/')}`;
    const parent = await resolveFsScopePath(client, permMgr, parentInput, 'write');
    if (parent.type !== 'document') {
        throw createFsError('invalid_path', `Parent path "${parentInput}" must resolve to a document folder.`);
    }
    const hPath = joinHPath(parent.hPath, title);
    return {
        notebook: parent.notebook,
        notebookName: parent.notebookName,
        title,
        parentHPath: parent.hPath,
        parentStoragePath: parent.storagePath,
        parentId: parent.id,
        hPath,
        canonicalPath: canonicalPath(parent.notebookName, hPath),
    };
}

export async function resolveFsDestinationTarget(
    client: SiYuanClient,
    permMgr: PermissionManager,
    inputPath: string,
): Promise<FsCreateTarget> {
    return resolveFsCreateTarget(client, permMgr, inputPath);
}
