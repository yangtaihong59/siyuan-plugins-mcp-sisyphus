import type { SiYuanClient } from '../api/client';
import * as blockApi from '../api/block';
import * as documentApi from '../api/document';

/**
 * The link-target action deliberately resolves only document IDs. Titles are
 * user-facing labels and can repeat or change; accepting them as identities
 * would let an import silently link to the wrong note. Creation is the sole
 * place a title is accepted, and it is never used to adopt an existing note.
 */
export interface LinkTargetDocumentIdentity {
    id: string;
    notebook: string;
    path: string;
    hPath: string;
    name?: string;
}

export interface LinkTargetChildSummary {
    id: string;
    notebook: string;
    path: string;
    hPath?: string;
    name?: string;
}

export interface LinkTargetScope {
    parent: LinkTargetDocumentIdentity;
    children: LinkTargetChildSummary[];
}

export interface LinkTargetScopeRequest {
    notebook: string;
    parentId: string;
}

export function linkTargetError(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { name: 'DocumentLinkTargetError', code });
}

function normalizePath(value: string): string {
    return value.startsWith('/') ? value : `/${value}`;
}

function childIdFromPath(path: string): string | undefined {
    const name = normalizePath(path).split('/').filter(Boolean).at(-1);
    if (!name?.endsWith('.sy')) return undefined;
    return name.slice(0, -3);
}

function stripSySuffix(value: string | undefined): string | undefined {
    return typeof value === 'string' ? value.replace(/\.sy$/i, '') : undefined;
}

/**
 * Read a document through three independent API projections. A successful
 * create response alone is not enough: the returned ID must still resolve to
 * the expected notebook, storage path, hierarchical path, and document root.
 */
export async function readLinkTargetDocumentIdentity(
    client: SiYuanClient,
    id: string,
    expectedNotebook?: string,
): Promise<LinkTargetDocumentIdentity> {
    const [pathInfo, hPath, docInfo] = await Promise.all([
        documentApi.getPathByID(client, id),
        documentApi.getHPathByID(client, id),
        blockApi.getDocInfo(client, id),
    ]);
    if (!docInfo || typeof docInfo !== 'object') {
        throw linkTargetError('target_readback_incomplete', `Link target ${id} did not return document-root metadata.`);
    }
    const rootID = typeof docInfo.rootID === 'string' && docInfo.rootID.length > 0
        ? docInfo.rootID
        : docInfo.id;
    if (rootID !== id) {
        throw linkTargetError(
            'target_not_document_root',
            `Link target ${id} resolved to document root ${rootID}; declare a document ID, not a descendant block ID.`,
        );
    }
    if (!pathInfo.notebook || !pathInfo.path || !hPath) {
        throw linkTargetError('target_readback_incomplete', `Link target ${id} did not return a complete ID/path/HPath readback.`);
    }
    if (expectedNotebook && pathInfo.notebook !== expectedNotebook) {
        throw linkTargetError(
            'target_outside_notebook',
            `Link target ${id} resolved in notebook ${pathInfo.notebook}, outside explicit notebook scope ${expectedNotebook}.`,
        );
    }
    return {
        id,
        notebook: pathInfo.notebook,
        path: normalizePath(pathInfo.path),
        hPath,
        ...(typeof docInfo.name === 'string' && docInfo.name ? { name: stripSySuffix(docInfo.name) } : {}),
    };
}

/**
 * Resolve the parent by its explicit ID and list only its direct child
 * documents. This is the whole authority scope for link provisioning; search
 * results, document titles, and UI position are intentionally not consulted.
 */
export async function readLinkTargetScope(
    client: SiYuanClient,
    request: LinkTargetScopeRequest,
): Promise<LinkTargetScope> {
    const parent = await readLinkTargetDocumentIdentity(client, request.parentId, request.notebook);
    const listed = await documentApi.listDocsByPath(client, request.notebook, parent.path);
    if (listed.box && listed.box !== request.notebook) {
        throw linkTargetError(
            'parent_scope_mismatch',
            `Parent ${request.parentId} listed children from notebook ${listed.box}, outside explicit notebook scope ${request.notebook}.`,
        );
    }
    if ((listed.files ?? []).some((file) => file.box && file.box !== request.notebook)) {
        throw linkTargetError(
            'parent_scope_mismatch',
            `Parent ${request.parentId} returned a child from outside explicit notebook scope ${request.notebook}.`,
        );
    }
    const children = (listed.files ?? []).flatMap((file): LinkTargetChildSummary[] => {
        const id = typeof file.id === 'string' && file.id.length > 0 ? file.id : childIdFromPath(file.path);
        if (!id || !file.path) return [];
        return [{
            id,
            notebook: file.box || listed.box || request.notebook,
            path: normalizePath(file.path),
            ...(typeof file.hPath === 'string' && file.hPath ? { hPath: file.hPath } : {}),
            ...(typeof file.name === 'string' && file.name ? { name: stripSySuffix(file.name) } : {}),
        }];
    });
    return { parent, children };
}

export function findScopedLinkTarget(
    scope: LinkTargetScope,
    id: string,
): LinkTargetChildSummary | undefined {
    return scope.children.find((child) => child.id === id);
}

export function scopedLinkTargetTitleExists(scope: LinkTargetScope, title: string): boolean {
    return scope.children.some((child) => child.name === title);
}
