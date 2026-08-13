import { SiYuanClient } from './client';
import type {
    IReqCreateDocWithMd,
    IReqGetIDsByHPath,
    IReqGetHPathByID,
    IReqGetHPathByPath,
    IReqGetPathByID,
    IReqListDocsByPath,
    IReqMoveDocs,
    IReqMoveDocsByID,
    IReqRemoveDoc,
    IReqRemoveDocByID,
    IReqRenameDoc,
    IReqRenameDocByID,
    IResListDocsByPath,
    IResGetPathByID,
    IResDocOutlinePath,
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
    return client.requestWrite<string>('/api/filetree/createDocWithMd', {
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
    return client.requestWrite<null>('/api/filetree/renameDoc', {
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
    return client.requestWrite<null>('/api/filetree/renameDocByID', {
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
    return client.requestWrite<null>('/api/filetree/removeDoc', {
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
    return client.requestWrite<null>('/api/filetree/removeDocByID', {
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
    return client.requestWrite<null>('/api/filetree/moveDocs', {
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
    return client.requestWrite<null>('/api/filetree/moveDocsByID', {
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
    return client.requestRead<string>('/api/filetree/getHPathByPath', {
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
    return client.requestRead<string>('/api/filetree/getHPathByID', {
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
    return client.requestRead<IResGetPathByID>('/api/filetree/getPathByID', {
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
    return client.requestRead<string[]>('/api/filetree/getIDsByHPath', {
        path,
        notebook,
    } as IReqGetIDsByHPath);
}

/**
 * List direct child documents by notebook + storage path
 */
export async function listDocsByPath(
    client: SiYuanClient,
    notebook: string,
    path: string,
    options: Omit<IReqListDocsByPath, 'notebook' | 'path'> = {},
): Promise<IResListDocsByPath> {
    return client.requestRead<IResListDocsByPath>('/api/filetree/listDocsByPath', {
        notebook,
        path,
        ...options,
    } as IReqListDocsByPath);
}

/** Apply a complete manual order to sibling document storage paths. */
export async function changeFileTreeSort(
    client: SiYuanClient,
    notebook: string,
    paths: string[],
): Promise<null> {
    return client.requestWrite<null>('/api/filetree/changeSort', { notebook, paths });
}

export async function listDocTree(
    client: SiYuanClient,
    notebook: string,
    path: string,
): Promise<unknown> {
    return client.requestRead('/api/filetree/listDocTree', { notebook, path });
}

export async function searchDocs(
    client: SiYuanClient,
    keyword: string,
    flashcard?: boolean,
    excludeIDs?: string[],
): Promise<unknown> {
    return client.requestRead('/api/filetree/searchDocs', {
        k: keyword,
        flashcard,
        excludeIDs,
    });
}

export async function getDoc(
    client: SiYuanClient,
    id: string,
    mode?: number,
    size?: number,
): Promise<unknown> {
    return client.requestRead('/api/filetree/getDoc', {
        id,
        mode,
        size,
    });
}

export async function getDocOutline(
    client: SiYuanClient,
    id: string,
    preview = false,
    notebook?: string,
): Promise<IResDocOutlinePath[]> {
    return client.requestRead<IResDocOutlinePath[]>('/api/outline/getDocOutline', {
        id,
        preview,
        ...(notebook ? { notebook } : {}),
    });
}

export async function createDailyNote(
    client: SiYuanClient,
    notebook: string,
    app?: string,
): Promise<{ id: string }> {
    return client.requestWrite<{ id: string }>('/api/filetree/createDailyNote', {
        notebook,
        app,
    });
}

export async function duplicateDoc(
    client: SiYuanClient,
    id: string,
): Promise<{ id: string; notebook: string; path: string; hPath?: string }> {
    return client.requestWrite('/api/filetree/duplicateDoc', { id });
}

export async function removeDocs(
    client: SiYuanClient,
    paths: string[],
): Promise<null> {
    return client.requestWrite('/api/filetree/removeDocs', { paths });
}

export async function createEmptyDoc(
    client: SiYuanClient,
    notebook: string,
    path: string,
    title: string,
    md = '',
    sorts?: string[],
): Promise<{ id: string }> {
    return client.requestWrite('/api/filetree/createDoc', { notebook, path, title, md, sorts });
}

export async function headingToDoc(
    client: SiYuanClient,
    srcHeadingID: string,
    targetNotebook: string,
    targetPath?: string,
    previousPath?: string,
): Promise<null> {
    return client.requestWrite('/api/filetree/heading2Doc', {
        srcHeadingID,
        targetNoteBook: targetNotebook,
        targetPath,
        previousPath,
    });
}

export async function docToHeading(
    client: SiYuanClient,
    srcID: string,
    targetID: string,
    after = false,
): Promise<{ srcTreeBox: string; srcTreePath: string }> {
    return client.requestWrite('/api/filetree/doc2Heading', { srcID, targetID, after });
}
