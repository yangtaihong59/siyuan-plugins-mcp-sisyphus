import type { SiYuanClient } from '../../../api/client';
import * as documentApi from '../../../api/document';
import * as notebookApi from '../../../api/notebook';
import type { NotebookConf } from '../../../types/shared';

export const CUSTOM_FILE_TREE_SORT_MODE = 6;

export interface ReorderChild {
    id: string;
    path: string;
    hPath: string;
    name?: string;
    sort?: number;
}

export interface DocumentReorderState {
    notebook: string;
    parentID: string;
    parentPath: string;
    notebookConf: NotebookConf;
    sortMode?: number;
    children: ReorderChild[];
}

function extractDocumentId(path: string): string | undefined {
    return path.split('/').filter(Boolean).at(-1)?.replace(/\.sy$/i, '');
}

export async function readDocumentReorderState(
    client: SiYuanClient,
    notebook: string,
    parentID: string,
    parentPath: string,
): Promise<DocumentReorderState> {
    const [conf, listed] = await Promise.all([
        notebookApi.getNotebookConf(client, notebook),
        documentApi.listDocsByPath(client, notebook, parentPath, {
            sort: CUSTOM_FILE_TREE_SORT_MODE,
            maxListCount: 0,
            showHidden: false,
            ignoreMaxListHint: true,
        }),
    ]);
    const children = await Promise.all(listed.files.map(async (file): Promise<ReorderChild> => {
        const id = file.id || extractDocumentId(file.path);
        if (!id) throw new Error(`Unable to resolve a document ID from child path "${file.path}".`);
        const hPath = file.hPath || await documentApi.getHPathByID(client, id);
        return {
            id,
            path: file.path,
            hPath,
            name: file.name?.replace(/\.sy$/i, ''),
            sort: file.sort,
        };
    }));
    return {
        notebook,
        parentID,
        parentPath,
        notebookConf: conf.conf,
        sortMode: conf.conf.sortMode,
        children,
    };
}

export function assertExactOrder(
    current: string[],
    requested: string[],
    fieldName: 'orderedIDs' | 'orderedPaths',
): void {
    const duplicates = [...new Set(requested.filter((value, index) => requested.indexOf(value) !== index))];
    const currentSet = new Set(current);
    const requestedSet = new Set(requested);
    const missing = current.filter((value) => !requestedSet.has(value));
    const unexpected = requested.filter((value) => !currentSet.has(value));
    if (duplicates.length === 0 && missing.length === 0 && unexpected.length === 0 && requested.length === current.length) {
        return;
    }
    throw new Error(`${fieldName} must contain every visible direct child exactly once. Details: ${JSON.stringify({ duplicates, missing, unexpected })}`);
}

function normalizeFsPath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) throw new Error('fs path must not be empty.');
    const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const collapsed = withLeadingSlash.replace(/\/+/g, '/');
    return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

export function resolveFsReorderOrder(
    state: DocumentReorderState,
    notebookName: string,
    requestedPaths: string[],
): { currentPaths: string[]; orderedPaths: string[]; orderedIDs: string[] } {
    const currentPaths = state.children.map((child) => normalizeFsPath(`/${notebookName}${child.hPath}`));
    const orderedPaths = requestedPaths.map(normalizeFsPath);
    assertExactOrder(currentPaths, orderedPaths, 'orderedPaths');
    const idByPath = new Map(currentPaths.map((path, index) => [path, state.children[index].id]));
    return {
        currentPaths,
        orderedPaths,
        orderedIDs: orderedPaths.map((path) => idByPath.get(path)!),
    };
}

export async function applyDocumentReorder(
    client: SiYuanClient,
    state: DocumentReorderState,
    orderedIDs: string[],
): Promise<{
    changed: boolean;
    orderChanged: boolean;
    sortModeChanged: boolean;
    previousOrder: string[];
    order: string[];
}> {
    const previousOrder = state.children.map((child) => child.id);
    assertExactOrder(previousOrder, orderedIDs, 'orderedIDs');
    const orderChanged = previousOrder.some((id, index) => id !== orderedIDs[index]);
    const sortModeChanged = state.sortMode !== CUSTOM_FILE_TREE_SORT_MODE;

    if (orderChanged) {
        const childByID = new Map(state.children.map((child) => [child.id, child]));
        await documentApi.changeFileTreeSort(
            client,
            state.notebook,
            orderedIDs.map((id) => childByID.get(id)!.path),
        );
    }
    if (sortModeChanged) {
        await notebookApi.setNotebookConf(client, state.notebook, { sortMode: CUSTOM_FILE_TREE_SORT_MODE });
    }

    return {
        changed: orderChanged || sortModeChanged,
        orderChanged,
        sortModeChanged,
        previousOrder,
        order: orderedIDs,
    };
}
