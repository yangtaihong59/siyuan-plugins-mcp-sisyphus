import type { SiYuanClient } from '../../../api/client';
import * as notebookApi from '../../../api/notebook';
import type { PermissionManager } from '../../../core/permissions';

/** Diagnose a name supplied where an ID is required without resolving it implicitly. */
export async function getNotebookNameArgumentHint(
    client: SiYuanClient, permMgr: PermissionManager, value: string,
): Promise<string | undefined> {
    const notebooks = await notebookApi.listNotebooks(client).catch(() => undefined);
    const matches = (notebooks?.notebooks ?? []).filter(item =>
        item.name === value && item.id !== value && permMgr.canRead(item.id));
    if (matches.length === 0) return undefined;
    return `notebook requires an ID, not its name. Use the intended notebook ID from notebook(action="list"): ${matches.map(item => item.id).join(', ')}. Keep path relative to that notebook; do not change permissions to resolve this argument error.`;
}

function getNotebookId(item: Record<string, unknown>): string | undefined {
    const value = item.notebook ?? item.box ?? item.boxID ?? item.notebookId;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function loadNotebookNameMap(client: SiYuanClient): Promise<Map<string, string>> {
    const result = await notebookApi.listNotebooks(client);
    const map = new Map<string, string>();
    for (const notebook of result.notebooks ?? []) {
        if (notebook.id && notebook.name) {
            map.set(notebook.id, notebook.name);
        }
    }
    return map;
}

export async function resolveNotebookName(client: SiYuanClient, notebookId: string | undefined): Promise<string | undefined> {
    if (!notebookId) return undefined;
    try {
        return (await loadNotebookNameMap(client)).get(notebookId);
    } catch {
        return undefined;
    }
}

export async function enrichItemsWithNotebookNames<T>(client: SiYuanClient, items: T[]): Promise<T[]> {
    const records = items.filter((item): item is T & Record<string, unknown> =>
        item !== null && typeof item === 'object',
    );
    if (records.length === 0) return items;

    try {
        const names = await loadNotebookNameMap(client);
        return items.map((item) => {
            if (item === null || typeof item !== 'object') return item;
            const record = item as T & Record<string, unknown>;
            const notebookId = getNotebookId(record);
            const notebookName = notebookId ? names.get(notebookId) : undefined;
            return notebookName ? { ...record, notebookName } : item;
        });
    } catch {
        return items;
    }
}
