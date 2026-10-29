/*
 * User attributes that survive a Markdown rewrite. The kernel's updateBlock
 * rebuilds a block from Markdown without its own IAL, so custom-*, name,
 * alias, memo and bookmark vanish. DOM updates, findReplace and tag
 * rename/remove edit the tree in place and keep them. Shared by every
 * handler that rewrites a block from Markdown and by the write-impact preview.
 */
import type { SiYuanClient } from '../../../api/client';
import * as blockApi from '../../../api/block';

export const PRESERVED_ATTR_NAMES = new Set(['name', 'alias', 'memo', 'bookmark']);

export function preservableAttrs(attrs: Record<string, string> | null | undefined): Record<string, string> {
    return Object.fromEntries(Object.entries(attrs ?? {})
        .filter(([key, value]) => value !== '' && (key.startsWith('custom-') || PRESERVED_ATTR_NAMES.has(key))));
}

/** block.update only restores for Markdown input without an explicit IAL. */
export function updateRestoresAttrs(dataType: unknown, data: unknown): boolean {
    return dataType === 'markdown' && typeof data === 'string' && !/\{:\s/.test(data);
}

async function readAttrsOrNull(client: SiYuanClient, id: string): Promise<Record<string, string> | null> {
    try {
        return await blockApi.getBlockAttrs(client, id);
    } catch {
        return null;
    }
}

export interface AttrPreservingItem {
    id: string;
    dataType: string;
    data: string;
    /** Restore even when the Markdown carries IALs (edits of an existing body). */
    alwaysRestore?: boolean;
}

/**
 * Snapshot user attributes of Markdown rewrites, run the update, then put
 * back any attribute the update dropped. Returns the restored names per id.
 */
export async function updatePreservingAttrs<T>(
    client: SiYuanClient,
    items: AttrPreservingItem[],
    update: () => Promise<T>,
): Promise<{ result: T; restoredAttrs: Record<string, string[]> }> {
    const kept = new Map<string, Record<string, string>>();
    for (const item of items) {
        const restores = item.alwaysRestore ? item.dataType === 'markdown' : updateRestoresAttrs(item.dataType, item.data);
        if (!restores) continue;
        const attrs = preservableAttrs(await readAttrsOrNull(client, item.id));
        if (Object.keys(attrs).length > 0) kept.set(item.id, attrs);
    }
    const result = await update();
    const restoredAttrs: Record<string, string[]> = {};
    for (const [id, attrs] of kept) {
        const after = await readAttrsOrNull(client, id);
        if (!after) continue;
        const missing = Object.fromEntries(Object.entries(attrs).filter(([key]) => after[key] === undefined));
        if (Object.keys(missing).length === 0) continue;
        await blockApi.setBlockAttrs(client, id, missing);
        restoredAttrs[id] = Object.keys(missing);
    }
    return { result, restoredAttrs };
}
