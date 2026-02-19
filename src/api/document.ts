import { SiYuanClient } from './client';
import type {
    IReqCreateDocWithMd,
    IReqRenameDoc,
    IReqRenameDocByID,
    IReqRemoveDoc,
    IReqRemoveDocByID,
    IReqMoveDocs,
    IReqMoveDocsByID,
    IReqGetHPathByPath,
    IReqGetHPathByID,
    IReqGetPathByID,
    IReqGetIDsByHPath,
    IResGetPathByID,
} from '../types/api';

/**
 * Create a new document with markdown content
 * @returns Document ID (string)
 */
export async function createDoc(
    client: SiYuanClient,
    notebook: string,
    path: string,
    markdown: string
): Promise<string> {
    return client.request<string>('/api/filetree/createDocWithMd', {
        notebook,
        path,
        markdown,
    } as IReqCreateDocWithMd);
}

/**
 * Rename a document by path
 */
export async function renameDoc(
    client: SiYuanClient,
    notebook: string,
    path: string,
    title: string
): Promise<null> {
    return client.request<null>('/api/filetree/renameDoc', {
        notebook,
        path,
        title,
    } as IReqRenameDoc);
}

/**
 * Rename a document by ID
 */
export async function renameDocByID(
    client: SiYuanClient,
    id: string,
    title: string
): Promise<null> {
    return client.request<null>('/api/filetree/renameDocByID', {
        id,
        title,
    } as IReqRenameDocByID);
}

/**
 * Remove a document by path
 */
export async function removeDoc(
    client: SiYuanClient,
    notebook: string,
    path: string
): Promise<null> {
    return client.request<null>('/api/filetree/removeDoc', {
        notebook,
        path,
    } as IReqRemoveDoc);
}

/**
 * Remove a document by ID
 */
export async function removeDocByID(
    client: SiYuanClient,
    id: string
): Promise<null> {
    return client.request<null>('/api/filetree/removeDocByID', {
        id,
    } as IReqRemoveDocByID);
}

/**
 * Move multiple documents to a new location
 */
export async function moveDocs(
    client: SiYuanClient,
    fromPaths: string[],
    toNotebook: string,
    toPath: string
): Promise<null> {
    return client.request<null>('/api/filetree/moveDocs', {
        fromPaths,
        toNotebook,
        toPath,
    } as IReqMoveDocs);
}

/**
 * Move multiple documents by ID to a new parent
 */
export async function moveDocsByID(
    client: SiYuanClient,
    fromIDs: string[],
    toID: string
): Promise<null> {
    return client.request<null>('/api/filetree/moveDocsByID', {
        fromIDs,
        toID,
    } as IReqMoveDocsByID);
}

/**
 * Get hierarchical path by file path
 */
export async function getHPathByPath(
    client: SiYuanClient,
    notebook: string,
    path: string
): Promise<string> {
    return client.request<string>('/api/filetree/getHPathByPath', {
        notebook,
        path,
    } as IReqGetHPathByPath);
}

/**
 * Get hierarchical path by document ID
 */
export async function getHPathByID(
    client: SiYuanClient,
    id: string
): Promise<string> {
    return client.request<string>('/api/filetree/getHPathByID', {
        id,
    } as IReqGetHPathByID);
}

/**
 * Get file path by document ID
 */
export async function getPathByID(
    client: SiYuanClient,
    id: string
): Promise<IResGetPathByID> {
    return client.request<IResGetPathByID>('/api/filetree/getPathByID', {
        id,
    } as IReqGetPathByID);
}

/**
 * Get document IDs by hierarchical path
 */
export async function getIDsByHPath(
    client: SiYuanClient,
    path: string,
    notebook: string
): Promise<string[]> {
    return client.request<string[]>('/api/filetree/getIDsByHPath', {
        path,
        notebook,
    } as IReqGetIDsByHPath);
}
